import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDetectCache } from '../../src/detect.ts'
import { createNpmProvider } from '../../src/providers/npm.ts'
import { createPnpmProvider } from '../../src/providers/pnpm.ts'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nai-scripts-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  resetDetectCache()
})

function writePkg(dir: string, pkg: Record<string, unknown>) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
}

describe('listPackages includes scripts', () => {
  it('extracts scripts from root package', async () => {
    writePkg(tempDir, {
      name: 'my-app',
      scripts: { dev: 'vite', build: 'tsdown', test: 'vitest' },
    })
    writeFileSync(join(tempDir, 'pnpm-lock.yaml'), '')

    const provider = createPnpmProvider(tempDir)
    const { packages } = await provider.listPackages()

    expect(packages[0].scripts).toEqual({
      dev: 'vite',
      build: 'tsdown',
      test: 'vitest',
    })
  })

  it('returns empty scripts when none defined', async () => {
    writePkg(tempDir, { name: 'no-scripts' })
    writeFileSync(join(tempDir, 'pnpm-lock.yaml'), '')

    const provider = createPnpmProvider(tempDir)
    const { packages } = await provider.listPackages()

    expect(packages[0].scripts).toEqual({})
  })

  it('extracts scripts from workspace packages', async () => {
    writePkg(tempDir, { name: 'root', scripts: { lint: 'eslint .' } })
    writeFileSync(
      join(tempDir, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )

    const pkgA = join(tempDir, 'packages', 'pkg-a')
    mkdirSync(pkgA, { recursive: true })
    writePkg(pkgA, {
      name: '@test/pkg-a',
      scripts: { dev: 'vite', build: 'tsc' },
    })

    const provider = createPnpmProvider(tempDir)
    const { packages } = await provider.listPackages()

    const root = packages.find((p) => p.name === 'root')!
    const pkgAItem = packages.find((p) => p.name === '@test/pkg-a')!

    expect(root.scripts).toEqual({ lint: 'eslint .' })
    expect(pkgAItem.scripts).toEqual({ dev: 'vite', build: 'tsc' })
  })

  it('works across different providers (npm)', async () => {
    writePkg(tempDir, {
      name: 'npm-app',
      scripts: { start: 'node index.js' },
    })
    writeFileSync(join(tempDir, 'package-lock.json'), '{}')

    const provider = createNpmProvider(tempDir)
    const { packages } = await provider.listPackages()

    expect(packages[0].scripts).toEqual({ start: 'node index.js' })
  })
})
