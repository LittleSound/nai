import { describe, expect, it } from 'vitest'
import { buildScriptOptions, collectScripts } from '../../src/nar/core.ts'
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
