import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDetectCache } from '../../src/detect.ts'
import { createYarnProvider } from '../../src/providers/yarn.ts'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nai-yarn-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  resetDetectCache()
})

const DEFAULT_PKG = { name: 'test-pkg' }

function writePkg(dir: string, pkg: Record<string, unknown> = DEFAULT_PKG) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
}

describe('yarn provider', () => {
  describe('checkExistence', () => {
    it('returns false when no lock file', async () => {
      const provider = createYarnProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(false)
    })

    it('returns true when yarn.lock exists', async () => {
      writeFileSync(join(tempDir, 'yarn.lock'), '')
      const provider = createYarnProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(true)
    })

    it('detects from packageManager field and returns version', async () => {
      writePkg(tempDir, { name: 'test', packageManager: 'yarn@4.10.0' })
      const provider = createYarnProvider(tempDir)
      const { exists, version } = await provider.checkExistence()
      expect(exists).toBe(true)
      expect(version).toBe('4.10.0')
    })

    it('does not match when packageManager is a different PM', async () => {
      writePkg(tempDir, { name: 'test', packageManager: 'pnpm@10.31.0' })
      const provider = createYarnProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(false)
    })
  })

  describe('listCatalogs', () => {
    it('returns empty when no .yarnrc.yml', async () => {
      const provider = createYarnProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()
      expect(catalogs).toEqual({})
    })

    it('parses named catalogs', async () => {
      writeFileSync(
        join(tempDir, '.yarnrc.yml'),
        [
          'catalogs:',
          '  react18:',
          '    react: ^18.3.1',
          '    react-dom: ^18.3.1',
          '  react17:',
          '    react: ^17.0.2',
        ].join('\n'),
      )
      const provider = createYarnProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()

      expect(catalogs.react18).toEqual({
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      })
      expect(catalogs.react17).toEqual({ react: '^17.0.2' })
    })

    it('parses default catalog', async () => {
      writeFileSync(
        join(tempDir, '.yarnrc.yml'),
        ['catalog:', '  lodash: ^4.17.21'].join('\n'),
      )
      const provider = createYarnProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()

      expect(catalogs['']).toEqual({ lodash: '^4.17.21' })
    })

    it('parses both default and named catalogs', async () => {
      writeFileSync(
        join(tempDir, '.yarnrc.yml'),
        [
          'catalog:',
          '  lodash: ^4.17.21',
          'catalogs:',
          '  prod:',
          '    react: ^18.3.1',
        ].join('\n'),
      )
      const provider = createYarnProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()

      expect(catalogs['']).toEqual({ lodash: '^4.17.21' })
      expect(catalogs.prod).toEqual({ react: '^18.3.1' })
    })
  })

  describe('listPackages', () => {
    it('returns root package for single-package repo', async () => {
      writePkg(tempDir, { name: 'my-app', description: 'test' })
      const provider = createYarnProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(1)
      expect(packages[0].name).toBe('my-app')
    })

    it('returns empty when no package.json', async () => {
      const provider = createYarnProvider(tempDir)
      const { packages } = await provider.listPackages()
      expect(packages).toHaveLength(0)
    })

    it('resolves workspace packages from workspaces field', async () => {
      writePkg(tempDir, {
        name: 'root',
        workspaces: ['packages/*'],
      })

      const pkgA = join(tempDir, 'packages', 'pkg-a')
      const pkgB = join(tempDir, 'packages', 'pkg-b')
      mkdirSync(pkgA, { recursive: true })
      mkdirSync(pkgB, { recursive: true })
      writePkg(pkgA, { name: '@test/pkg-a' })
      writePkg(pkgB, { name: '@test/pkg-b' })

      const provider = createYarnProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(3)
      const names = packages.map((p) => p.name)
      expect(names).toContain('root')
      expect(names).toContain('@test/pkg-a')
      expect(names).toContain('@test/pkg-b')
    })
  })

  describe('depInstallExecutor', () => {
    it('writes new catalog entries to .yarnrc.yml', async () => {
      writePkg(tempDir)

      const provider = createYarnProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'react', version: '^18.3.1', catalogName: 'prod' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
        })
      } catch {
        // yarn install may fail in test env
      }

      // Verify .yarnrc.yml was created with catalog entry
      const yml = readFileSync(join(tempDir, '.yarnrc.yml'), 'utf8')
      expect(yml).toContain('react')
      expect(yml).toContain('^18.3.1')

      // Verify package.json uses catalog reference
      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.react).toBe('catalog:prod')
    })

    it('writes to default catalog when catalogName is empty', async () => {
      writePkg(tempDir)
      const provider = createYarnProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'lodash', version: '^4.17.21', catalogName: '' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
        })
      } catch {
        // yarn install may fail
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.lodash).toBe('catalog:')
    })

    it('writes direct version when no catalogName', async () => {
      writePkg(tempDir)
      const provider = createYarnProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'lodash', version: '^4.17.21' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
        })
      } catch {
        // yarn install may fail
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.lodash).toBe('^4.17.21')
    })

    it('writes to devDependencies when dev is true', async () => {
      writePkg(tempDir)
      const provider = createYarnProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'vitest', version: '^4.0.0', catalogName: 'dev' }],
          targetPackages: [tempDir],
          dev: true,
          peer: false,
        })
      } catch {
        // yarn install may fail
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.devDependencies.vitest).toBe('catalog:dev')
    })

    it('skips catalog write for existing entries', async () => {
      writePkg(tempDir)
      writeFileSync(
        join(tempDir, '.yarnrc.yml'),
        'catalogs:\n  prod:\n    react: ^18.3.1\n',
      )

      const provider = createYarnProvider(tempDir)

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
        // yarn install may fail
      }

      // .yarnrc.yml should be unchanged
      const yml = readFileSync(join(tempDir, '.yarnrc.yml'), 'utf8')
      expect(yml).toBe('catalogs:\n  prod:\n    react: ^18.3.1\n')

      // But package.json should still have the catalog ref
      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.react).toBe('catalog:prod')
    })

    it('sorts dependencies alphabetically', async () => {
      writePkg(tempDir, {
        name: 'test-pkg',
        dependencies: { zod: '^3.0.0' },
      })
      const provider = createYarnProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'axios', version: '^1.0.0' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
        })
      } catch {
        // yarn install may fail
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      const keys = Object.keys(pkg.dependencies)
      expect(keys).toEqual(['axios', 'zod'])
    })
  })
})
