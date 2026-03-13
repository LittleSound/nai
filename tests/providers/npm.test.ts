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
import { createNpmProvider } from '../../src/providers/npm.ts'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nai-npm-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  resetDetectCache()
})

const DEFAULT_PKG = { name: 'test-pkg' }

function writePkg(dir: string, pkg: Record<string, unknown> = DEFAULT_PKG) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
}

describe('npm provider', () => {
  describe('checkExistence', () => {
    it('returns false when no lock file', async () => {
      const provider = createNpmProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(false)
    })

    it('returns true when package-lock.json exists', async () => {
      writeFileSync(join(tempDir, 'package-lock.json'), '{}')
      const provider = createNpmProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(true)
    })

    it('detects from packageManager field and returns version', async () => {
      writePkg(tempDir, { name: 'test', packageManager: 'npm@10.0.0' })
      const provider = createNpmProvider(tempDir)
      const { exists, version } = await provider.checkExistence()
      expect(exists).toBe(true)
      expect(version).toBe('10.0.0')
    })

    it('does not match when packageManager is a different PM', async () => {
      writePkg(tempDir, { name: 'test', packageManager: 'pnpm@10.31.0' })
      const provider = createNpmProvider(tempDir)
      const { exists } = await provider.checkExistence()
      expect(exists).toBe(false)
    })
  })

  describe('catalogSupport', () => {
    it('is false (npm does not support catalogs)', () => {
      const provider = createNpmProvider(tempDir)
      expect(provider.catalogSupport).toBe(false)
    })
  })

  describe('listCatalogs', () => {
    it('always returns empty catalogs', async () => {
      const provider = createNpmProvider(tempDir)
      const { catalogs } = await provider.listCatalogs()
      expect(catalogs).toEqual({})
    })
  })

  describe('listPackages', () => {
    it('returns root package for single-package repo', async () => {
      writePkg(tempDir, { name: 'my-app', description: 'test' })
      const provider = createNpmProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(1)
      expect(packages[0].name).toBe('my-app')
    })

    it('returns empty when no package.json', async () => {
      const provider = createNpmProvider(tempDir)
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

      const provider = createNpmProvider(tempDir)
      const { packages } = await provider.listPackages()

      expect(packages).toHaveLength(3)
      const names = packages.map((p) => p.name)
      expect(names).toContain('root')
      expect(names).toContain('@test/pkg-a')
      expect(names).toContain('@test/pkg-b')
    })
  })

  describe('depInstallExecutor', () => {
    it('writes direct version to dependencies', async () => {
      writePkg(tempDir)
      const provider = createNpmProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'lodash', version: '^4.17.21' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
          peerOptional: false,
        })
      } catch {
        // npm install may fail in test env
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.lodash).toBe('^4.17.21')
    })

    it('writes to devDependencies when dev is true', async () => {
      writePkg(tempDir)
      const provider = createNpmProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'typescript', version: '^5.0.0' }],
          targetPackages: [tempDir],
          dev: true,
          peer: false,
          peerOptional: false,
        })
      } catch {
        // npm install may fail in test env
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.devDependencies.typescript).toBe('^5.0.0')
    })

    it('writes to peerDependencies when peer is true', async () => {
      writePkg(tempDir)
      const provider = createNpmProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'react', version: '^19.0.0' }],
          targetPackages: [tempDir],
          dev: false,
          peer: true,
          peerOptional: false,
        })
      } catch {
        // npm install may fail in test env
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.peerDependencies.react).toBe('^19.0.0')
      expect(pkg.peerDependenciesMeta).toBeUndefined()
    })

    it('writes peerDependenciesMeta when peerOptional is true', async () => {
      writePkg(tempDir)
      const provider = createNpmProvider(tempDir)

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
        // npm install may fail in test env
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.peerDependencies.react).toBe('^19.0.0')
      expect(pkg.peerDependencies.sass).toBe('^1.3.0')
      expect(pkg.peerDependenciesMeta).toEqual({
        react: { optional: true },
        sass: { optional: true },
      })
    })

    it('sorts peerDependenciesMeta alphabetically', async () => {
      writePkg(tempDir)
      const provider = createNpmProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [
            { name: 'zod', version: '^3.0.0' },
            { name: 'axios', version: '^1.0.0' },
          ],
          targetPackages: [tempDir],
          dev: false,
          peer: true,
          peerOptional: true,
        })
      } catch {
        // npm install may fail in test env
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      const metaKeys = Object.keys(pkg.peerDependenciesMeta)
      expect(metaKeys).toEqual(['axios', 'zod'])
    })

    it('does not write peerDependenciesMeta when not peer', async () => {
      writePkg(tempDir)
      const provider = createNpmProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'lodash', version: '^4.17.21' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
          peerOptional: true,
        })
      } catch {
        // npm install may fail in test env
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      expect(pkg.dependencies.lodash).toBe('^4.17.21')
      expect(pkg.peerDependenciesMeta).toBeUndefined()
    })

    it('sorts dependencies alphabetically', async () => {
      writePkg(tempDir, {
        name: 'test-pkg',
        dependencies: { zod: '^3.0.0' },
      })
      const provider = createNpmProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'axios', version: '^1.0.0' }],
          targetPackages: [tempDir],
          dev: false,
          peer: false,
          peerOptional: false,
        })
      } catch {
        // npm install may fail in test env
      }

      const pkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      const keys = Object.keys(pkg.dependencies)
      expect(keys).toEqual(['axios', 'zod'])
    })

    it('writes to multiple target packages', async () => {
      writePkg(tempDir, {
        name: 'root',
        workspaces: ['packages/*'],
      })

      const pkgA = join(tempDir, 'packages', 'pkg-a')
      mkdirSync(pkgA, { recursive: true })
      writePkg(pkgA, { name: '@test/pkg-a' })

      const provider = createNpmProvider(tempDir)

      try {
        await provider.depInstallExecutor({
          deps: [{ name: 'lodash', version: '^4.17.21' }],
          targetPackages: [tempDir, pkgA],
          dev: false,
          peer: false,
          peerOptional: false,
        })
      } catch {
        // npm install may fail in test env
      }

      const rootPkg = JSON.parse(
        readFileSync(join(tempDir, 'package.json'), 'utf8'),
      )
      const aPkg = JSON.parse(readFileSync(join(pkgA, 'package.json'), 'utf8'))
      expect(rootPkg.dependencies.lodash).toBe('^4.17.21')
      expect(aPkg.dependencies.lodash).toBe('^4.17.21')
    })
  })
})
