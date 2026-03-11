import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDetectCache } from '../../src/detect.ts'
import { createPnpmProvider } from '../../src/providers/pnpm.ts'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nai-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  resetDetectCache()
})

const DEFAULT_PKG = { name: 'test-pkg' }

/** Write a minimal package.json to a directory */
function writePkg(dir: string, pkg: Record<string, unknown> = DEFAULT_PKG) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
}

describe('pnpm provider', () => {
  describe('checkExistence', () => {
    it('returns false when no lock file', async () => {
      const provider = createPnpmProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(false)
    })

    it('returns true when lock file exists', async () => {
      writeFileSync(join(tempDir, 'pnpm-lock.yaml'), '')
      const provider = createPnpmProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(true)
    })

    it('detects from packageManager field and returns version', async () => {
      writePkg(tempDir, { name: 'test', packageManager: 'pnpm@10.31.0' })
      const provider = createPnpmProvider(tempDir)
      const { exists, version } = await provider.checkExistence()
      expect(exists).toBe(true)
      expect(version).toBe('10.31.0')
    })

    it('does not return version when detected via lock file', async () => {
      writePkg(tempDir)
      writeFileSync(join(tempDir, 'pnpm-lock.yaml'), '')
      const provider = createPnpmProvider(tempDir)
      const { exists, version } = await provider.checkExistence()
      expect(exists).toBe(true)
      expect(version).toBeUndefined()
    })
  })

  describe('listCatalogs', () => {
    it('returns empty when no workspace file', async () => {
      const provider = createPnpmProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()
      expect(catalogs).toEqual({})
    })

    it('parses named catalogs', async () => {
      writeFileSync(
        join(tempDir, 'pnpm-workspace.yaml'),
        [
          'catalogs:',
          '  prod:',
          '    react: ^18.3.1',
          '    vue: ^3.5.0',
          '  dev:',
          '    vitest: ^4.0.0',
        ].join('\n'),
      )
      const provider = createPnpmProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()

      expect(catalogs.prod).toEqual({ react: '^18.3.1', vue: '^3.5.0' })
      expect(catalogs.dev).toEqual({ vitest: '^4.0.0' })
    })

    it('parses default catalog', async () => {
      writeFileSync(
        join(tempDir, 'pnpm-workspace.yaml'),
        ['catalog:', '  lodash: ^4.17.21'].join('\n'),
      )
      const provider = createPnpmProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()

      expect(catalogs['']).toEqual({ lodash: '^4.17.21' })
    })
  })

  describe('listPackages', () => {
    it('returns root package for single-package repo', async () => {
      writePkg(tempDir, { name: 'my-app', description: 'test' })
      const provider = createPnpmProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(1)
      expect(packages[0].name).toBe('my-app')
    })

    it('resolves workspace packages from glob patterns', async () => {
      writePkg(tempDir, { name: 'root' })
      writeFileSync(
        join(tempDir, 'pnpm-workspace.yaml'),
        'packages:\n  - packages/*\n',
      )

      // Create workspace packages
      const pkgA = join(tempDir, 'packages', 'pkg-a')
      const pkgB = join(tempDir, 'packages', 'pkg-b')
      mkdirSync(pkgA, { recursive: true })
      mkdirSync(pkgB, { recursive: true })
      writePkg(pkgA, { name: '@test/pkg-a' })
      writePkg(pkgB, { name: '@test/pkg-b' })

      const provider = createPnpmProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(3)
      const names = packages.map((p) => p.name)
      expect(names).toContain('root')
      expect(names).toContain('@test/pkg-a')
      expect(names).toContain('@test/pkg-b')
    })
  })

  describe('depInstallExecutor', () => {
    it('writes new catalog entries to workspace yaml', async () => {
      writePkg(tempDir, { name: 'test-pkg' })
      writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), 'packages: []\n')

      const provider = createPnpmProvider(tempDir)
      // Skip pnpm install since pnpm might not be available in test env
      // We test the file modifications only
      const { readFileSync } = await import('node:fs')

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'react', version: '^18.3.1', catalogName: 'prod' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
        })
      } catch {
        // pnpm install may fail in test env, that's ok
      }

      // Verify workspace yaml was updated
      const yaml = readFileSync(join(tempDir, 'pnpm-workspace.yaml'), 'utf8')
      expect(yaml).toContain('react')
      expect(yaml).toContain('^18.3.1')

      // Verify package.json was updated
      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.react).toBe('catalog:prod')
    })

    it('writes to default catalog when catalogName is empty', async () => {
      writePkg(tempDir, { name: 'test-pkg' })

      const provider = createPnpmProvider(tempDir)
      const { readFileSync } = await import('node:fs')

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'lodash', version: '^4.17.21', catalogName: '' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
        })
      } catch {
        // pnpm install may fail
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.lodash).toBe('catalog:')
    })

    it('writes direct version when no catalogName', async () => {
      writePkg(tempDir, { name: 'test-pkg' })

      const provider = createPnpmProvider(tempDir)
      const { readFileSync } = await import('node:fs')

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'lodash', version: '^4.17.21' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
        })
      } catch {
        // pnpm install may fail
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.lodash).toBe('^4.17.21')
    })

    it('writes to devDependencies when dev is true', async () => {
      writePkg(tempDir, { name: 'test-pkg' })

      const provider = createPnpmProvider(tempDir)
      const { readFileSync } = await import('node:fs')

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'vitest', version: '^4.0.0', catalogName: 'dev' }],
          targetPackages: [tempDir],
          dev: true,
          peer: false,
        })
      } catch {
        // pnpm install may fail
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.devDependencies.vitest).toBe('catalog:dev')
    })

    it('skips catalog write for existing entries', async () => {
      writePkg(tempDir, { name: 'test-pkg' })
      writeFileSync(
        join(tempDir, 'pnpm-workspace.yaml'),
        'catalogs:\n  prod:\n    react: ^18.3.1\n',
      )

      const provider = createPnpmProvider(tempDir)
      const { readFileSync } = await import('node:fs')

      try {
        await provider.depInstallExecutor({
          deps: [
            {
              name: 'react',
              version: '^18.3.1',
              catalogName: 'prod',
              existsInCatalog: true,
            },
          ],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
        })
      } catch {
        // pnpm install may fail
      }

      // Workspace yaml should be unchanged (no extra writes)
      const yaml = readFileSync(join(tempDir, 'pnpm-workspace.yaml'), 'utf8')
      expect(yaml).toBe('catalogs:\n  prod:\n    react: ^18.3.1\n')

      // But package.json should still have the catalog ref
      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.react).toBe('catalog:prod')
    })
  })
})
