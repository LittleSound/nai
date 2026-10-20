import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDetectCache } from '../../src/detect.ts'
import { runCommand } from '../../src/exec.ts'
import { createBunProvider } from '../../src/providers/bun.ts'

vi.mock('../../src/exec.ts', () => ({ runCommand: vi.fn() }))

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nai-bun-test-'))
})

afterEach(() => {
  vi.mocked(runCommand).mockReset()
  rmSync(tempDir, { recursive: true, force: true })
  resetDetectCache()
})

const DEFAULT_PKG = { name: 'test-pkg' }

function writePkg(dir: string, pkg: Record<string, unknown> = DEFAULT_PKG) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
}

/** Assert the provider ran `bun install` (mocked) exactly once in `tempDir` */
function expectInstallRan() {
  expect(runCommand).toHaveBeenCalledOnce()
  expect(runCommand).toHaveBeenCalledWith({
    command: 'bun',
    args: ['install'],
    cwd: tempDir,
  })
}

describe('bun provider', () => {
  describe('checkExistence', () => {
    it('returns false when no lock file', async () => {
      const provider = createBunProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(false)
    })

    it('returns true when bun.lock exists', async () => {
      writeFileSync(join(tempDir, 'bun.lock'), '')
      const provider = createBunProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(true)
    })

    it('returns true when bun.lockb exists (legacy)', async () => {
      writeFileSync(join(tempDir, 'bun.lockb'), '')
      const provider = createBunProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(true)
    })

    it('detects from packageManager field and returns version', async () => {
      writePkg(tempDir, { name: 'test', packageManager: 'bun@1.3.0' })
      const provider = createBunProvider(tempDir)
      const { exists, version } = await provider.checkExistence()
      expect(exists).toBe(true)
      expect(version).toBe('1.3.0')
    })

    it('does not match when packageManager is a different PM', async () => {
      writePkg(tempDir, { name: 'test', packageManager: 'pnpm@10.31.0' })
      const provider = createBunProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(false)
    })
  })

  describe('listCatalogs', () => {
    it('returns empty when no package.json', async () => {
      const provider = createBunProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()
      expect(catalogs).toEqual({})
    })

    it('parses catalogs from workspaces object', async () => {
      writePkg(tempDir, {
        name: 'test',
        workspaces: {
          packages: ['packages/*'],
          catalog: { react: '^19.0.0' },
          catalogs: {
            build: { webpack: '^5.0.0' },
          },
        },
      })
      const provider = createBunProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()

      expect(catalogs['']).toEqual({ react: '^19.0.0' })
      expect(catalogs.build).toEqual({ webpack: '^5.0.0' })
    })

    it('parses catalogs from top level', async () => {
      writePkg(tempDir, {
        name: 'test',
        workspaces: ['packages/*'],
        catalog: { lodash: '^4.17.21' },
        catalogs: {
          prod: { react: '^18.3.1', vue: '^3.5.0' },
        },
      })
      const provider = createBunProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()

      expect(catalogs['']).toEqual({ lodash: '^4.17.21' })
      expect(catalogs.prod).toEqual({ react: '^18.3.1', vue: '^3.5.0' })
    })

    it('returns empty when no catalog fields', async () => {
      writePkg(tempDir, { name: 'test' })
      const provider = createBunProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()
      expect(catalogs).toEqual({})
    })
  })

  describe('listPackages', () => {
    it('returns root package for single-package repo', async () => {
      writePkg(tempDir, { name: 'my-app', description: 'test' })
      const provider = createBunProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(1)
      expect(packages[0].name).toBe('my-app')
    })

    it('returns empty when no package.json', async () => {
      const provider = createBunProvider(tempDir)
      const { packages } = await provider.listPackages()
      expect(packages).toHaveLength(0)
    })

    it('resolves workspaces from array format', async () => {
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

      const provider = createBunProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(3)
      const names = packages.map((p) => p.name)
      expect(names).toContain('root')
      expect(names).toContain('@test/pkg-a')
      expect(names).toContain('@test/pkg-b')
    })

    it('resolves workspaces from object format', async () => {
      writePkg(tempDir, {
        name: 'root',
        workspaces: {
          packages: ['packages/*'],
        },
      })

      const pkgA = join(tempDir, 'packages', 'pkg-a')
      mkdirSync(pkgA, { recursive: true })
      writePkg(pkgA, { name: '@test/pkg-a' })

      const provider = createBunProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(2)
      const names = packages.map((p) => p.name)
      expect(names).toContain('root')
      expect(names).toContain('@test/pkg-a')
    })
  })

  describe('depInstallExecutor', () => {
    it('writes new catalog entries to root package.json (top level)', async () => {
      writePkg(tempDir, {
        name: 'test-pkg',
        workspaces: ['packages/*'],
      })

      const provider = createBunProvider(tempDir)

      await provider.depInstallExecutor({
        deps: [{ name: 'react', version: '^19.0.0', catalogName: 'prod' }],
        targetPackages: [tempDir],
        dev: false,
        peer: false,
        peerOptional: false,
      })
      expectInstallRan()

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      // Catalogs written at top level (workspaces is array)
      expect(pkg.catalogs.prod.react).toBe('^19.0.0')
      // Dep uses catalog reference
      expect(pkg.dependencies.react).toBe('catalog:prod')
    })

    it('writes new catalog entries inside workspaces object', async () => {
      writePkg(tempDir, {
        name: 'test-pkg',
        workspaces: {
          packages: ['packages/*'],
        },
      })

      const provider = createBunProvider(tempDir)

      await provider.depInstallExecutor({
        deps: [{ name: 'react', version: '^19.0.0', catalogName: 'prod' }],
        targetPackages: [tempDir],
        dev: false,
        peer: false,
        peerOptional: false,
      })
      expectInstallRan()

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      // Catalogs written inside workspaces object
      expect(pkg.workspaces.catalogs.prod.react).toBe('^19.0.0')
      expect(pkg.dependencies.react).toBe('catalog:prod')
    })

    it('writes to default catalog when catalogName is empty', async () => {
      writePkg(tempDir, {
        name: 'test-pkg',
        workspaces: ['packages/*'],
      })
      const provider = createBunProvider(tempDir)

      await provider.depInstallExecutor({
        deps: [{ name: 'lodash', version: '^4.17.21', catalogName: '' }],
        targetPackages: [tempDir],
        dev: false,
        peer: false,
        peerOptional: false,
      })
      expectInstallRan()

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.catalog.lodash).toBe('^4.17.21')
      expect(pkg.dependencies.lodash).toBe('catalog:')
    })

    it('writes direct version when no catalogName', async () => {
      writePkg(tempDir)
      const provider = createBunProvider(tempDir)

      await provider.depInstallExecutor({
        deps: [{ name: 'lodash', version: '^4.17.21' }],
        targetPackages: [tempDir],
        dev: false,
        peer: false,
        peerOptional: false,
      })
      expectInstallRan()

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.lodash).toBe('^4.17.21')
    })

    it('writes to devDependencies when dev is true', async () => {
      writePkg(tempDir)
      const provider = createBunProvider(tempDir)

      await provider.depInstallExecutor({
        deps: [{ name: 'lodash', version: '^4.17.21', catalogName: 'dev' }],
        targetPackages: [tempDir],
        dev: true,
        peer: false,
        peerOptional: false,
      })
      expectInstallRan()

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.devDependencies.lodash).toBe('catalog:dev')
    })

    it('creates workspaces object for catalogs in non-workspace project', async () => {
      writePkg(tempDir, { name: 'test-pkg' })
      const provider = createBunProvider(tempDir)

      await provider.depInstallExecutor({
        deps: [{ name: 'react', version: '^19.0.0', catalogName: 'prod' }],
        targetPackages: [tempDir],
        dev: false,
        peer: false,
        peerOptional: false,
      })
      expectInstallRan()

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      // Auto-created workspaces with catalog inside
      expect(pkg.workspaces.catalogs.prod.react).toBe('^19.0.0')
      expect(pkg.dependencies.react).toBe('catalog:prod')
    })

    it('skips catalog write for existing entries', async () => {
      writePkg(tempDir, {
        name: 'test-pkg',
        workspaces: ['packages/*'],
        catalogs: {
          prod: { react: '^18.3.1' },
        },
      })

      const provider = createBunProvider(tempDir)

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
      expectInstallRan()

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      // Catalogs should be unchanged (no new entries)
      expect(pkg.catalogs).toEqual({ prod: { react: '^18.3.1' } })
      // But package.json should have the catalog ref
      expect(pkg.dependencies.react).toBe('catalog:prod')
    })

    it('sorts dependencies alphabetically', async () => {
      writePkg(tempDir, {
        name: 'test-pkg',
        dependencies: { zod: '^3.0.0' },
      })
      const provider = createBunProvider(tempDir)

      await provider.depInstallExecutor({
        deps: [{ name: 'axios', version: '^1.0.0' }],
        targetPackages: [tempDir],
        dev: false,
        peer: false,
        peerOptional: false,
      })
      expectInstallRan()

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      const keys = Object.keys(pkg.dependencies)
      expect(keys).toEqual(['axios', 'zod'])
    })
  })
})
