import { describe, expect, it } from 'vitest'
import {
  buildHighlightedOptions,
  buildScriptOptions,
  collectScripts,
  getScriptGroupOrder,
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

function makeFzfResult(entry: ScriptEntry, positions: number[]) {
  return {
    item: entry,
    positions: new Set(positions),
    start: 0,
    end: 0,
    score: 100,
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
    expect(result[1].isRoot).toBe(false)
    expect(result[1].packageName).toBe('@scope/pkg-a')
  })

  it('returns empty array when no scripts exist', () => {
    expect(collectScripts([makePackage({ name: 'empty-pkg' })])).toEqual([])
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
  const rootEntry: ScriptEntry = {
    scriptName: 'dev',
    command: 'vite',
    packageName: 'root',
    cwd: '/workspace/root',
    isRoot: true,
  }
  const workspaceEntry: ScriptEntry = {
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

  it('adds root and package group headers in monorepos', () => {
    const options = buildScriptOptions(entries, true)

    expect(strip(options[0].label)).toBe('Root scripts')
    expect(options[0].disabled).toBe(true)
    expect(strip(options[1].label)).toBe('dev')
    expect(strip(options[2].label)).toBe('@scope/pkg-a')
    expect(options[2].disabled).toBe(true)
    expect(strip(options[3].label)).toBe('build')
  })

  it('sets command as hint', () => {
    const options = buildScriptOptions(entries, false)

    expect(options[0].hint).toBe('vite')
    expect(options[1].hint).toBe('tsdown')
  })

  it('preserves group order as root first, then workspace packages', () => {
    const packageBEntry: ScriptEntry = {
      scriptName: 'lint',
      command: 'eslint .',
      packageName: '@scope/pkg-b',
      cwd: '/workspace/pkg-b',
      isRoot: false,
    }
    const fullEntries = [rootEntry, workspaceEntry, packageBEntry]
    const filteredEntries = [packageBEntry, rootEntry, workspaceEntry]

    const options = buildScriptOptions(
      filteredEntries,
      true,
      getScriptGroupOrder(fullEntries),
    )

    expect(options.map((option) => strip(option.label))).toEqual([
      'Root scripts',
      'dev',
      '@scope/pkg-a',
      'build',
      '@scope/pkg-b',
      'lint',
    ])
  })
})

describe('buildHighlightedOptions', () => {
  const rootEntry: ScriptEntry = {
    scriptName: 'dev',
    command: 'vite',
    packageName: 'root',
    cwd: '/workspace/root',
    isRoot: true,
  }
  const workspaceEntry: ScriptEntry = {
    scriptName: 'build',
    command: 'tsdown',
    packageName: '@scope/pkg-a',
    cwd: '/workspace/pkg-a',
    isRoot: false,
  }

  it('highlights script names in single-package mode', () => {
    const options = buildHighlightedOptions(
      [makeFzfResult(rootEntry, [0])],
      false,
    )

    expect(strip(options[0].label)).toBe('dev')
    expect(options[0].label).not.toBe('dev')
  })

  it('highlights commands in hints', () => {
    const options = buildHighlightedOptions(
      [makeFzfResult(rootEntry, [4, 5, 6, 7])],
      false,
    )

    expect(strip(options[0].hint!)).toBe('vite')
    expect(options[0].hint).not.toBe('vite')
  })

  it('renders highlighted package group headers in monorepos', () => {
    const options = buildHighlightedOptions(
      [makeFzfResult(workspaceEntry, [6])],
      true,
    )

    expect(options[0].disabled).toBe(true)
    expect(strip(options[0].label)).toBe('@scope/pkg-a')
    expect(options[0].label.length).toBeGreaterThan('@scope/pkg-a'.length)
    expect(strip(options[1].label)).toBe('build')
  })

  it('keeps root group ahead of workspace groups when given full group order', () => {
    const options = buildHighlightedOptions(
      [
        makeFzfResult(workspaceEntry, [0]),
        makeFzfResult(rootEntry, [0]),
      ],
      true,
      getScriptGroupOrder([rootEntry, workspaceEntry]),
    )

    expect(options.map((option) => strip(option.label))).toEqual([
      'Root scripts',
      'dev',
      '@scope/pkg-a',
      'build',
    ])
  })
})
