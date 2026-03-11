import { describe, expect, it } from 'vitest'
import { compareVersions, parsePackageSpec } from '../src/utils.ts'

describe('parsePackageSpec', () => {
  it('parses a simple package name', () => {
    expect(parsePackageSpec('react')).toEqual({ name: 'react' })
  })

  it('parses package with version', () => {
    expect(parsePackageSpec('react@^18.3.1')).toEqual({
      name: 'react',
      version: '^18.3.1',
    })
  })

  it('parses scoped package without version', () => {
    expect(parsePackageSpec('@types/node')).toEqual({
      name: '@types/node',
    })
  })

  it('parses scoped package with version', () => {
    expect(parsePackageSpec('@types/node@^20')).toEqual({
      name: '@types/node',
      version: '^20',
    })
  })

  it('parses package with exact version', () => {
    expect(parsePackageSpec('typescript@5.9.3')).toEqual({
      name: 'typescript',
      version: '5.9.3',
    })
  })

  it('ignores trailing @ with no version', () => {
    expect(parsePackageSpec('react@')).toEqual({ name: 'react' })
  })
})

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('returns -1 when a < b (patch)', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1)
  })

  it('returns 1 when a > b (patch)', () => {
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1)
  })

  it('compares minor versions', () => {
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1)
    expect(compareVersions('1.2.0', '1.3.0')).toBe(-1)
  })

  it('compares major versions', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1)
  })

  it('handles missing patch version', () => {
    expect(compareVersions('9.5', '9.5.0')).toBe(0)
    expect(compareVersions('9.5', '9.4.0')).toBe(1)
  })

  it('strips leading non-digit chars (e.g. range prefixes)', () => {
    expect(compareVersions('^1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('>=9.5.0', '9.5.0')).toBe(0)
  })

  it('handles real-world catalog version checks', () => {
    expect(compareVersions('10.31.0', '9.5.0')).toBe(1)
    expect(compareVersions('9.4.0', '9.5.0')).toBe(-1)
    expect(compareVersions('4.10.0', '4.10.0')).toBe(0)
    expect(compareVersions('4.9.0', '4.10.0')).toBe(-1)
  })
})
