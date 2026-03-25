import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  detectFromPackageJson,
  detectProvider,
  parsePackageManagerField,
  resetDetectCache,
} from '../src/detect.ts'
import type { Provider } from '../src/type.ts'

describe('parsePackageManagerField', () => {
  it('parses name and version', () => {
    expect(parsePackageManagerField('pnpm@10.31.0')).toEqual({
      name: 'pnpm',
      version: '10.31.0',
    })
  })

  it('strips hash suffix', () => {
    expect(parsePackageManagerField('pnpm@10.31.0+sha512.abc123')).toEqual({
      name: 'pnpm',
      version: '10.31.0',
    })
  })

  it('parses yarn', () => {
    expect(parsePackageManagerField('yarn@4.10.0')).toEqual({
      name: 'yarn',
      version: '4.10.0',
    })
  })

  it('parses npm', () => {
    expect(parsePackageManagerField('npm@10.0.0')).toEqual({
      name: 'npm',
      version: '10.0.0',
    })
  })

  it('returns null for invalid format', () => {
    expect(parsePackageManagerField('just-a-name')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parsePackageManagerField('')).toBeNull()
  })
})

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nai-detect-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  resetDetectCache()
})

describe('detectFromPackageJson', () => {
  it('returns null when no package.json', () => {
    expect(detectFromPackageJson(tempDir)).toBeNull()
  })

  it('detects from packageManager field', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test', packageManager: 'pnpm@10.31.0' }),
    )
    expect(detectFromPackageJson(tempDir)).toEqual({
      name: 'pnpm',
      version: '10.31.0',
    })
  })

  it('detects from packageManager with hash', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test',
        packageManager: 'yarn@4.10.0+sha512.abc',
      }),
    )
    expect(detectFromPackageJson(tempDir)).toEqual({
      name: 'yarn',
      version: '4.10.0',
    })
  })

  it('detects from devEngines.packageManager', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test',
        devEngines: {
          packageManager: {
            name: 'yarn',
            version: '>=4.0.0',
          },
        },
      }),
    )
    expect(detectFromPackageJson(tempDir)).toEqual({
      name: 'yarn',
      version: '>=4.0.0',
    })
  })

  it('prefers packageManager over devEngines', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test',
        packageManager: 'pnpm@9.0.0',
        devEngines: {
          packageManager: { name: 'yarn' },
        },
      }),
    )
    expect(detectFromPackageJson(tempDir)).toEqual({
      name: 'pnpm',
      version: '9.0.0',
    })
  })

  it('returns null when no relevant fields', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test' }),
    )
    expect(detectFromPackageJson(tempDir)).toBeNull()
  })
})

describe('detectProvider', () => {
  function makeProvider(
    name: string,
    exists: boolean,
    version?: string,
  ): Provider {
    return {
      name,
      catalogSupport: false,
      supportsPeerDependencies: false,
      checkExistence: () => Promise.resolve({ exists, version }),
      listCatalogs: () => Promise.resolve({ catalogs: {} }),
      listPackages: () => Promise.resolve({ packages: [] }),
      depInstallExecutor: () => Promise.resolve(),
      install: () => Promise.resolve(),
      runScript: () => Promise.resolve(''),
    }
  }

  it('returns the first available provider', async () => {
    const providers = [
      makeProvider('pnpm', false),
      makeProvider('yarn', true, '4.10.0'),
      makeProvider('npm', true),
    ]
    const result = await detectProvider(providers)
    expect(result?.provider.name).toBe('yarn')
    expect(result?.version).toBe('4.10.0')
  })

  it('returns undefined when no provider matches', async () => {
    const providers = [makeProvider('pnpm', false), makeProvider('npm', false)]
    const result = await detectProvider(providers)
    expect(result).toBeUndefined()
  })

  it('returns undefined for empty list', async () => {
    const result = await detectProvider([])
    expect(result).toBeUndefined()
  })
})
