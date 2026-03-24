import c from 'ansis'
import type { SearchOption } from '../prompts/search.ts'
import type { RepoPackageItem } from '../type.ts'

export interface ScriptEntry {
  scriptName: string
  command: string
  packageName: string
  cwd: string
  /** Whether this script belongs to the root package (first in listPackages) */
  isRoot: boolean
}

/**
 * Collect all runnable scripts from workspace packages.
 * The first package is treated as root.
 */
export function collectScripts(packages: RepoPackageItem[]): ScriptEntry[] {
  const entries: ScriptEntry[] = []
  for (const [i, pkg] of packages.entries()) {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      entries.push({
        scriptName: name,
        command,
        packageName: pkg.name,
        cwd: pkg.directory,
        isRoot: i === 0,
      })
    }
  }
  return entries
}

/** Build search options from script entries, prefixing package name for non-root in monorepos */
export function buildScriptOptions(
  scripts: ScriptEntry[],
  isMonorepo: boolean,
): SearchOption<ScriptEntry>[] {
  return scripts.map((entry) => ({
    value: entry,
    label:
      isMonorepo && !entry.isRoot
        ? `${c.dim(entry.packageName)} ${c.dim('>')} ${entry.scriptName}`
        : entry.scriptName,
    hint: entry.command,
  }))
}
