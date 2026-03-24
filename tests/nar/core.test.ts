import { describe, expect, it } from 'vitest'
import { highlightPositions } from '../../src/highlight.ts'
import {
  buildHighlightedOptions,
  buildScriptOptions,
  collectScripts,
  type ScriptEntry,
} from '../../src/nar/core.ts'
import type { RepoPackageItem } from '../../src/type.ts'

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[\d;]*m/g
function strip(str: string): string {
  return str.replaceAll(ANSI_RE, '')
}

function makePackage(
  overrides: Partial<RepoPackageItem> & { name: string },
): RepoPackageItem {
  return {
    directory: `/workspace/${overrides.name}`,
    description: '',
    dependencies: {},
    devDependencies: {},
    scripts: {},
    ...overrides,
  }
}

describe('collectScripts', () => {
  it('collects scripts from a single package', () => {
    const packages = [
      makePackage({
        name: 'my-app',
        scripts: { dev: 'vite', build: 'tsdown' },
      }),
    ]

    const result = collectScripts(packages)

    expect(result).toEqual([
      {
        scriptName: 'dev',
        command: 'vite',
        packageName: 'my-app',
        cwd: '/workspace/my-app',
        isRoot: true,
      },
      {
        scriptName: 'build',
        command: 'tsdown',
        packageName: 'my-app',
        cwd: '/workspace/my-app',
        isRoot: true,
      },
    ])
  })

  it('marks first package as root and others as non-root', () => {
    const packages = [
      makePackage({
        name: 'root',
        scripts: { lint: 'eslint .' },
      }),
      makePackage({
        name: '@scope/pkg-a',
        scripts: { dev: 'vite', test: 'vitest' },
      }),
    ]

    const result = collectScripts(packages)

    expect(result).toHaveLength(3)
    expect(result[0].isRoot).toBe(true)
    expect(result[0].scriptName).toBe('lint')
    expect(result[1].isRoot).toBe(false)
    expect(result[1].packageName).toBe('@scope/pkg-a')
    expect(result[2].isRoot).toBe(false)
  })

  it('returns empty array when no scripts exist', () => {
    const packages = [makePackage({ name: 'empty-pkg' })]
    expect(collectScripts(packages)).toEqual([])
  })

  it('returns empty array for empty package list', () => {
    expect(collectScripts([])).toEqual([])
  })

  it('preserves cwd from each package', () => {
    const packages = [
      makePackage({
        name: 'root',
        directory: '/project',
        scripts: { dev: 'vite' },
      }),
      makePackage({
        name: 'sub',
        directory: '/project/packages/sub',
        scripts: { dev: 'vite' },
      }),
    ]

    const result = collectScripts(packages)

    expect(result[0].cwd).toBe('/project')
    expect(result[1].cwd).toBe('/project/packages/sub')
  })
})

describe('buildScriptOptions', () => {
  const rootEntry = {
    scriptName: 'dev',
    command: 'vite',
    packageName: 'root',
    cwd: '/workspace/root',
    isRoot: true,
  }
  const workspaceEntry = {
    scriptName: 'build',
    command: 'tsdown',
    packageName: '@scope/pkg-a',
    cwd: '/workspace/pkg-a',
    isRoot: false,
  }
  const entries = [rootEntry, workspaceEntry]

  it('uses plain script name as label for single-package repos', () => {
    const options = buildScriptOptions(entries, false)

    expect(options[0].label).toBe('dev')
    expect(options[1].label).toBe('build')
  })

  it('omits package name for root scripts in monorepo', () => {
    const options = buildScriptOptions(entries, true)

    expect(strip(options[0].label)).toBe('dev')
  })

  it('prefixes package name for non-root scripts in monorepo', () => {
    const options = buildScriptOptions(entries, true)

    expect(strip(options[1].label)).toBe('@scope/pkg-a > build')
  })

  it('sets command as hint', () => {
    const options = buildScriptOptions(entries, false)

    expect(options[0].hint).toBe('vite')
    expect(options[1].hint).toBe('tsdown')
  })

  it('passes through the ScriptEntry as value', () => {
    const options = buildScriptOptions(entries, false)

    expect(options[0].value).toBe(entries[0])
    expect(options[1].value).toBe(entries[1])
  })

  it('returns empty array for empty input', () => {
    expect(buildScriptOptions([], false)).toEqual([])
    expect(buildScriptOptions([], true)).toEqual([])
  })
})

describe('highlightPositions (via shared highlight module)', () => {
  it('highlights characters at matched positions', () => {
    const result = highlightPositions('dev', new Set([0, 2]), 0)
    expect(strip(result)).toBe('dev')
    expect(result).not.toBe('dev')
  })

  it('returns plain text when no positions match', () => {
    expect(highlightPositions('dev', new Set([10, 20]), 0)).toBe('dev')
  })

  it('applies offset correctly', () => {
    const result = highlightPositions('dev', new Set([5, 6]), 5)
    expect(strip(result)).toBe('dev')
    expect(result).not.toBe('dev')
  })

  it('returns empty string for empty text', () => {
    expect(highlightPositions('', new Set([0]), 0)).toBe('')
  })
})

describe('buildHighlightedOptions', () => {
  function makeFzfResult(entry: ScriptEntry, positions: number[]) {
    return {
      item: entry,
      positions: new Set(positions),
      start: 0,
      end: 0,
      score: 100,
    }
  }

  const rootEntry: ScriptEntry = {
    scriptName: 'dev',
    command: 'vite',
    packageName: 'root',
    cwd: '/workspace/root',
    isRoot: true,
  }
  const wsEntry: ScriptEntry = {
    scriptName: 'build',
    command: 'tsdown',
    packageName: '@scope/pkg-a',
    cwd: '/workspace/pkg-a',
    isRoot: false,
  }

  it('highlights script name in single-package mode', () => {
    // selector: "dev vite", position 0 = 'd'
    const results = [makeFzfResult(rootEntry, [0])]
    const options = buildHighlightedOptions(results, false)

    expect(strip(options[0].label)).toBe('dev')
    // 'd' should be highlighted
    expect(options[0].label).not.toBe('dev')
  })

  it('highlights command in hint', () => {
    // selector: "dev vite", positions 4,5,6,7 = 'vite'
    const results = [makeFzfResult(rootEntry, [4, 5, 6, 7])]
    const options = buildHighlightedOptions(results, false)

    expect(strip(options[0].hint!)).toBe('vite')
    expect(options[0].hint).not.toBe('vite')
  })

  it('highlights package name in monorepo mode', () => {
    // selector: "build @scope/pkg-a tsdown"
    // packageName starts at offset 6, '@' = position 6
    const results = [makeFzfResult(wsEntry, [6])]
    const options = buildHighlightedOptions(results, true)

    expect(strip(options[0].label)).toBe('@scope/pkg-a > build')
    // Label should contain highlighting ANSI codes beyond normal styling
    expect(options[0].label.length).toBeGreaterThan(
      '@scope/pkg-a > build'.length,
    )
  })

  it('does not prefix package name for root scripts in monorepo', () => {
    const results = [makeFzfResult(rootEntry, [0])]
    const options = buildHighlightedOptions(results, true)

    expect(strip(options[0].label)).toBe('dev')
  })

  it('preserves ScriptEntry as value', () => {
    const results = [makeFzfResult(rootEntry, [])]
    const options = buildHighlightedOptions(results, false)

    expect(options[0].value).toBe(rootEntry)
  })
})
