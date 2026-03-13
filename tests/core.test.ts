import { describe, expect, it, vi } from 'vitest'
import {
  buildSummary,
  checkCatalogSupport,
  findExistingEntries,
  getDepField,
  resolvePackageVersions,
} from '../src/core.ts'
import type { Provider } from '../src/type.ts'

describe('findExistingEntries', () => {
  it('returns empty when dep not in any catalog', () => {
    const catalogs = { prod: { react: '^18.3.1' } }
    expect(findExistingEntries('vue', catalogs)).toEqual([])
  })

  it('finds dep in a single catalog', () => {
    const catalogs = { prod: { react: '^18.3.1', vue: '^3.5.0' } }
    const entries = findExistingEntries('react', catalogs)
    expect(entries).toEqual([{ catalogName: 'prod', version: '^18.3.1' }])
  })

  it('finds dep across multiple catalogs', () => {
    const catalogs = {
      '': { lodash: '^4.17.21' },
      prod: { lodash: '^4.17.20' },
    }
    const entries = findExistingEntries('lodash', catalogs)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({ catalogName: '', version: '^4.17.21' })
    expect(entries[1]).toEqual({ catalogName: 'prod', version: '^4.17.20' })
  })
})

describe('getDepField', () => {
  it('returns dependencies by default', () => {
    expect(getDepField(false, false)).toBe('dependencies')
  })

  it('returns devDependencies when dev', () => {
    expect(getDepField(true, false)).toBe('devDependencies')
  })

  it('returns peerDependencies when peer', () => {
    expect(getDepField(false, true)).toBe('peerDependencies')
  })

  it('peer takes precedence over dev', () => {
    expect(getDepField(true, true)).toBe('peerDependencies')
  })
})

describe('buildSummary', () => {
  it('builds summary with direct deps', () => {
    const summary = buildSummary({
      providerName: 'pnpm',
      depType: 'dependencies',
      deps: [{ name: 'react', version: '^18.3.1' }],
      targetNames: ['my-app'],
    })
    expect(summary).toContain('Package manager: pnpm')
    expect(summary).toContain('Install as: dependencies')
    expect(summary).toContain('react ^18.3.1 (direct)')
    expect(summary).toContain('Packages: my-app')
  })

  it('builds summary with catalog deps', () => {
    const summary = buildSummary({
      providerName: 'pnpm',
      depType: 'devDependencies',
      deps: [
        {
          name: 'vitest',
          version: '^4.0.0',
          catalogName: 'dev',
          existsInCatalog: false,
        },
      ],
      targetNames: ['pkg-a', 'pkg-b'],
    })
    expect(summary).toContain('vitest ^4.0.0 → catalog:dev (new)')
    expect(summary).toContain('Packages: pkg-a, pkg-b')
  })

  it('shows existing status for reused catalog entries', () => {
    const summary = buildSummary({
      providerName: 'pnpm',
      depType: 'dependencies',
      deps: [
        {
          name: 'react',
          version: '^18.3.1',
          catalogName: 'prod',
          existsInCatalog: true,
        },
      ],
      targetNames: ['app'],
    })
    expect(summary).toContain('catalog:prod (existing)')
  })

  it('uses catalog: for default catalog', () => {
    const summary = buildSummary({
      providerName: 'pnpm',
      depType: 'dependencies',
      deps: [{ name: 'lodash', version: '^4.17.21', catalogName: '' }],
      targetNames: ['app'],
    })
    expect(summary).toContain('→ catalog: (new)')
  })
})

describe('checkCatalogSupport', () => {
  const baseProvider = {
    supportsPeerDependencies: true,
    checkExistence: vi.fn(),
    listCatalogs: vi.fn(),
    listPackages: vi.fn(),
    depInstallExecutor: vi.fn(),
    install: vi.fn(),
  } satisfies Omit<Provider, 'name' | 'catalogSupport'>

  it('returns supported when catalogSupport is set and no version', () => {
    const result = checkCatalogSupport({
      ...baseProvider,
      name: 'pnpm',
      catalogSupport: { minVersion: '9.5.0' },
    })
    expect(result.supported).toBe(true)
  })

  it('returns supported when version >= minVersion', () => {
    const result = checkCatalogSupport(
      {
        ...baseProvider,
        name: 'pnpm',
        catalogSupport: { minVersion: '9.5.0' },
      },
      '10.31.0',
    )
    expect(result.supported).toBe(true)
  })

  it('returns version-too-low when version < minVersion', () => {
    const result = checkCatalogSupport(
      {
        ...baseProvider,
        name: 'pnpm',
        catalogSupport: { minVersion: '9.5.0' },
      },
      '9.4.0',
    )
    expect(result).toEqual({
      supported: false,
      reason: 'version-too-low',
      minVersion: '9.5.0',
    })
  })

  it('returns unsupported when catalogSupport is false', () => {
    const result = checkCatalogSupport({
      ...baseProvider,
      name: 'npm',
      catalogSupport: false,
    })
    expect(result).toEqual({
      supported: false,
      reason: 'unsupported',
    })
  })

  it('returns supported when version equals minVersion', () => {
    const result = checkCatalogSupport(
      {
        ...baseProvider,
        name: 'yarn',
        catalogSupport: { minVersion: '4.10.0' },
      },
      '4.10.0',
    )
    expect(result.supported).toBe(true)
  })
})

describe('resolvePackageVersions', () => {
  const emptyCatalogs: Record<string, Record<string, string>> = {}

  it('uses version from package spec without catalog assignment', async () => {
    const result = await resolvePackageVersions(
      [{ name: 'react', version: '^18.3.1' }],
      {
        catalogs: emptyCatalogs,
        onExistingFound: vi.fn(),
        onFetchVersion: vi.fn(),
      },
    )
    expect(result).toEqual([
      { name: 'react', version: '^18.3.1', existsInCatalog: false },
    ])
  })

  it('skips fetch when existing catalog entry is chosen', async () => {
    const onFetchVersion = vi.fn()
    const result = await resolvePackageVersions([{ name: 'react' }], {
      catalogs: { prod: { react: '^18.3.1' } },
      onExistingFound: vi.fn().mockResolvedValue({
        catalogName: 'prod',
        version: '^18.3.1',
      }),
      onFetchVersion,
    })
    expect(result).toEqual([
      {
        name: 'react',
        version: '^18.3.1',
        catalogName: 'prod',
        existsInCatalog: true,
      },
    ])
    expect(onFetchVersion).not.toHaveBeenCalled()
  })

  it('fetches from npm when user declines existing entry', async () => {
    const result = await resolvePackageVersions([{ name: 'react' }], {
      catalogs: { prod: { react: '^18.0.0' } },
      onExistingFound: vi.fn().mockResolvedValue(null),
      onFetchVersion: vi.fn().mockResolvedValue('^18.3.1'),
    })
    expect(result).toEqual([
      { name: 'react', version: '^18.3.1', existsInCatalog: false },
    ])
  })

  it('fetches from npm when not in any catalog', async () => {
    const result = await resolvePackageVersions([{ name: 'lodash' }], {
      catalogs: emptyCatalogs,
      onExistingFound: vi.fn(),
      onFetchVersion: vi.fn().mockResolvedValue('^4.17.21'),
    })
    expect(result).toEqual([
      { name: 'lodash', version: '^4.17.21', existsInCatalog: false },
    ])
  })

  it('skips package when fetch returns null', async () => {
    const result = await resolvePackageVersions([{ name: 'nonexistent-pkg' }], {
      catalogs: emptyCatalogs,
      onExistingFound: vi.fn(),
      onFetchVersion: vi.fn().mockResolvedValue(null),
    })
    expect(result).toEqual([])
  })

  it('resolves multiple packages in order', async () => {
    const result = await resolvePackageVersions(
      [
        { name: 'react', version: '^18.3.1' },
        { name: 'vue' },
        { name: 'lodash' },
      ],
      {
        catalogs: { prod: { vue: '^3.5.0' } },
        onExistingFound: vi.fn().mockResolvedValue({
          catalogName: 'prod',
          version: '^3.5.0',
        }),
        onFetchVersion: vi.fn().mockResolvedValue('^4.17.21'),
      },
    )
    expect(result).toHaveLength(3)
    expect(result[0].name).toBe('react')
    expect(result[0].version).toBe('^18.3.1')
    expect(result[0].existsInCatalog).toBe(false)
    expect(result[1].name).toBe('vue')
    expect(result[1].existsInCatalog).toBe(true)
    expect(result[2].name).toBe('lodash')
    expect(result[2].version).toBe('^4.17.21')
    expect(result[2].existsInCatalog).toBe(false)
  })
})
