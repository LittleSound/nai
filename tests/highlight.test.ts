import { describe, expect, it } from 'vitest'
import {
  highlightKeywords,
  highlightPositions,
  matchKeywordPositions,
} from '../src/highlight.ts'

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[\d;]*m/g
function strip(str: string): string {
  return str.replaceAll(ANSI_RE, '')
}

describe('highlightPositions', () => {
  it('highlights characters at given positions', () => {
    const result = highlightPositions('hello', new Set([1, 3]))
    expect(strip(result)).toBe('hello')
    expect(result).not.toBe('hello')
  })

  it('returns plain text when no positions match', () => {
    expect(highlightPositions('hello', new Set([10]))).toBe('hello')
  })

  it('applies offset', () => {
    const result = highlightPositions('ab', new Set([5, 6]), 5)
    expect(strip(result)).toBe('ab')
    expect(result).not.toBe('ab')
  })
})

describe('matchKeywordPositions', () => {
  it('finds single keyword positions', () => {
    const pos = matchKeywordPositions('hello world', 'world')
    expect(pos).toEqual(new Set([6, 7, 8, 9, 10]))
  })

  it('is case-insensitive', () => {
    const pos = matchKeywordPositions('Hello World', 'hello')
    expect(pos).toEqual(new Set([0, 1, 2, 3, 4]))
  })

  it('splits query by whitespace into multiple keywords', () => {
    const pos = matchKeywordPositions('foo-bar-baz', 'foo baz')
    expect(pos).toEqual(new Set([0, 1, 2, 8, 9, 10]))
  })

  it('finds all occurrences of a keyword', () => {
    const pos = matchKeywordPositions('abab', 'ab')
    expect(pos).toEqual(new Set([0, 1, 2, 3]))
  })

  it('returns empty set for no match', () => {
    const pos = matchKeywordPositions('hello', 'xyz')
    expect(pos.size).toBe(0)
  })

  it('returns empty set for empty query', () => {
    const pos = matchKeywordPositions('hello', '')
    expect(pos.size).toBe(0)
  })

  it('returns empty set for whitespace-only query', () => {
    const pos = matchKeywordPositions('hello', '   ')
    expect(pos.size).toBe(0)
  })
})

describe('highlightKeywords', () => {
  it('highlights matching keywords in text', () => {
    const result = highlightKeywords('vue-router', 'vue')
    expect(strip(result)).toBe('vue-router')
    expect(result).not.toBe('vue-router')
  })

  it('returns plain text when nothing matches', () => {
    expect(highlightKeywords('lodash', 'xyz')).toBe('lodash')
  })

  it('returns plain text for empty query', () => {
    expect(highlightKeywords('lodash', '')).toBe('lodash')
  })

  it('highlights multiple keywords', () => {
    const result = highlightKeywords('vue-router-next', 'vue next')
    expect(strip(result)).toBe('vue-router-next')
    expect(result).not.toBe('vue-router-next')
  })

  it('is case-insensitive', () => {
    const result = highlightKeywords('TypeScript', 'type')
    expect(strip(result)).toBe('TypeScript')
    expect(result).not.toBe('TypeScript')
  })
})
