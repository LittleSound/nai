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
import { createVltProvider } from '../../src/providers/vlt.ts'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nai-vlt-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  resetDetectCache()
})

const DEFAULT_PKG = { name: 'test-pkg' }

function writePkg(dir: string, pkg: Record<string, unknown> = DEFAULT_PKG) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
}

function writeConfig(dir: string, config: Record<string, unknown>) {
  writeFileSync(join(dir, 'vlt.json'), JSON.stringify(config, null, 2))
}

describe('vlt provider', () => {
  describe('checkExistence', () => {
    it('returns false when no lock file', async () => {
      const provider = createVltProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(false)
    })

    it('returns true when vlt-lock.json exists', async () => {
      writeFileSync(join(tempDir, 'vlt-lock.json'), '{}')
      const provider = createVltProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(true)
    })

    it('detects from packageManager field and returns version', async () => {
      writePkg(tempDir, { name: 'test', packageManager: 'vlt@1.0.0' })
      const provider = createVltProvider(tempDir)
      const { exists, version } = await provider.checkExistence()
      expect(exists).toBe(true)
      expect(version).toBe('1.0.0')
    })

    it('does not match when packageManager is a different PM', async () => {
      writePkg(tempDir, { name: 'test', packageManager: 'pnpm@10.31.0' })
      const provider = createVltProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(false)
    })
  })

  describe('listCatalogs', () => {
    it('returns empty when no vlt.json', async () => {
      const provider = createVltProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()
      expect(catalogs).toEqual({})
    })

    it('parses default catalog', async () => {
      writeConfig(tempDir, {
        catalog: { react: '^19.0.0', typescript: '^5.0.0' },
      })
      const provider = createVltProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()

      expect(catalogs['']).toEqual({ react: '^19.0.0', typescript: '^5.0.0' })
    })

    it('parses named catalogs', async () => {
      writeConfig(tempDir, {
        catalogs: {
          build: { typescript: '^5.0.0' },
          testing: { vitest: '^1.0.0' },
        },
      })
      const provider = createVltProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()

      expect(catalogs.build).toEqual({ typescript: '^5.0.0' })
      expect(catalogs.testing).toEqual({ vitest: '^1.0.0' })
    })

    it('parses both default and named catalogs', async () => {
      writeConfig(tempDir, {
        catalog: { react: '^19.0.0' },
        catalogs: {
          build: { webpack: '^5.0.0' },
        },
      })
      const provider = createVltProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()

      expect(catalogs['']).toEqual({ react: '^19.0.0' })
      expect(catalogs.build).toEqual({ webpack: '^5.0.0' })
    })

    it('returns empty when vlt.json has no catalog fields', async () => {
      writeConfig(tempDir, { workspaces: ['packages/*'] })
      const provider = createVltProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()
      expect(catalogs).toEqual({})
    })
  })

  describe('listPackages', () => {
    it('returns root package for single-package repo', async () => {
      writePkg(tempDir, { name: 'my-app', description: 'test' })
      const provider = createVltProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(1)
      expect(packages[0].name).toBe('my-app')
    })

    it('returns empty when no package.json', async () => {
      const provider = createVltProvider(tempDir)
      const { packages } = await provider.listPackages()
      expect(packages).toHaveLength(0)
    })

    it('resolves workspaces from array format', async () => {
      writePkg(tempDir, { name: 'root' })
      writeConfig(tempDir, { workspaces: ['packages/*'] })

      const pkgA = join(tempDir, 'packages', 'pkg-a')
      const pkgB = join(tempDir, 'packages', 'pkg-b')
      mkdirSync(pkgA, { recursive: true })
      mkdirSync(pkgB, { recursive: true })
      writePkg(pkgA, { name: '@test/pkg-a' })
      writePkg(pkgB, { name: '@test/pkg-b' })

      const provider = createVltProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(3)
      const names = packages.map((p) => p.name)
      expect(names).toContain('root')
      expect(names).toContain('@test/pkg-a')
      expect(names).toContain('@test/pkg-b')
    })

    it('resolves workspaces from string format', async () => {
      writePkg(tempDir, { name: 'root' })
      writeConfig(tempDir, { workspaces: 'packages/*' })

      const pkgA = join(tempDir, 'packages', 'pkg-a')
      mkdirSync(pkgA, { recursive: true })
      writePkg(pkgA, { name: '@test/pkg-a' })

      const provider = createVltProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(2)
      const names = packages.map((p) => p.name)
      expect(names).toContain('root')
      expect(names).toContain('@test/pkg-a')
    })

    it('resolves workspaces from named groups object format', async () => {
      writePkg(tempDir, { name: 'root' })
      writeConfig(tempDir, {
        workspaces: {
          apps: ['apps/*'],
          libs: ['packages/*'],
        },
      })

      const app = join(tempDir, 'apps', 'web')
      const lib = join(tempDir, 'packages', 'utils')
      mkdirSync(app, { recursive: true })
      mkdirSync(lib, { recursive: true })
      writePkg(app, { name: '@test/web' })
      writePkg(lib, { name: '@test/utils' })

      const provider = createVltProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(3)
      const names = packages.map((p) => p.name)
      expect(names).toContain('root')
      expect(names).toContain('@test/web')
      expect(names).toContain('@test/utils')
    })
  })

  describe('depInstallExecutor', () => {
    it('writes new catalog entries to vlt.json (named catalog)', async () => {
      writePkg(tempDir)
      writeConfig(tempDir, { workspaces: ['packages/*'] })

      const provider = createVltProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'react', version: '^19.0.0', catalogName: 'prod' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
          peerOptional: false,
        })
      } catch {
        // vlt install may fail in test env
      }

      const config = JSON.parse(readFileSync(join(tempDir, 'vlt.json'), 'utf8'))
      expect(config.catalogs.prod.react).toBe('^19.0.0')

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.react).toBe('catalog:prod')
    })

    it('writes to default catalog when catalogName is empty', async () => {
      writePkg(tempDir)
      writeConfig(tempDir, {})

      const provider = createVltProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'lodash', version: '^4.17.21', catalogName: '' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
          peerOptional: false,
        })
      } catch {
        // vlt install may fail in test env
      }

      const config = JSON.parse(readFileSync(join(tempDir, 'vlt.json'), 'utf8'))
      expect(config.catalog.lodash).toBe('^4.17.21')

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.lodash).toBe('catalog:')
    })

    it('creates vlt.json when it does not exist', async () => {
      writePkg(tempDir)

      const provider = createVltProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'react', version: '^19.0.0', catalogName: 'ui' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
          peerOptional: false,
        })
      } catch {
        // vlt install may fail in test env
      }

      const config = JSON.parse(readFileSync(join(tempDir, 'vlt.json'), 'utf8'))
      expect(config.catalogs.ui.react).toBe('^19.0.0')
    })

    it('writes direct version when no catalogName', async () => {
      writePkg(tempDir)
      const provider = createVltProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'lodash', version: '^4.17.21' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
          peerOptional: false,
        })
      } catch {
        // vlt install may fail in test env
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.lodash).toBe('^4.17.21')
    })

    it('writes to devDependencies when dev is true', async () => {
      writePkg(tempDir)
      const provider = createVltProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'typescript', version: '^5.0.0', catalogName: 'dev' }],
          targetPackages: [tempDir],
          dev: true,
          peer: false,
          peerOptional: false,
        })
      } catch {
        // vlt install may fail in test env
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.devDependencies.typescript).toBe('catalog:dev')
    })

    it('skips catalog write for existing entries', async () => {
      writePkg(tempDir)
      writeConfig(tempDir, {
        catalogs: { prod: { react: '^18.3.1' } },
      })

      const provider = createVltProvider(tempDir)

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
          peerOptional: false,
        })
      } catch {
        // vlt install may fail in test env
      }

      const config = JSON.parse(readFileSync(join(tempDir, 'vlt.json'), 'utf8'))
      expect(config.catalogs).toEqual({ prod: { react: '^18.3.1' } })

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
      const provider = createVltProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'axios', version: '^1.0.0' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
          peerOptional: false,
        })
      } catch {
        // vlt install may fail in test env
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      const keys = Object.keys(pkg.dependencies)
      expect(keys).toEqual(['axios', 'zod'])
    })

    it('writes peerDependenciesMeta when peerOptional is true', async () => {
      writePkg(tempDir)
      const provider = createVltProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [
            { name: 'react', version: '^19.0.0' },
            { name: 'sass', version: '^1.3.0' },
          ],
          targetPackages: [tempDir],
          dev: false,
          peer: true,
          peerOptional: true,
        })
      } catch {
        // vlt install may fail in test env
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.peerDependencies.react).toBe('^19.0.0')
      expect(pkg.peerDependenciesMeta).toEqual({
        react: { optional: true },
        sass: { optional: true },
      })
    })

    it('sorts catalog entries alphabetically', async () => {
      writePkg(tempDir)
      writeConfig(tempDir, {})

      const provider = createVltProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [
            { name: 'zod', version: '^3.0.0', catalogName: '' },
            { name: 'axios', version: '^1.0.0', catalogName: '' },
          ],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
          peerOptional: false,
        })
      } catch {
        // vlt install may fail in test env
      }

      const config = JSON.parse(readFileSync(join(tempDir, 'vlt.json'), 'utf8'))
      const keys = Object.keys(config.catalog)
      expect(keys).toEqual(['axios', 'zod'])
    })
  })
})
