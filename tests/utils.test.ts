import { describe, expect, it } from 'vitest'
import { parsePackageSpec } from '../src/utils.ts'

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
