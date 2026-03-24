import c from 'ansis'
import { highlightPositions } from '../highlight.ts'
import type { SearchOption } from '../prompts/search.ts'
import type { RepoPackageItem } from '../type.ts'
import type { FzfResultItem } from 'fzf'

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
  return scripts.map((entry) => buildOption(entry, isMonorepo))
}

/**
 * Build highlighted search options from fzf results.
 * Maps fzf positions back to label/hint parts based on the selector layout.
 *
 * Selector layout (monorepo): `${scriptName} ${packageName} ${command}`
 * Selector layout (single):   `${scriptName} ${command}`
 */
export function buildHighlightedOptions(
  results: FzfResultItem<ScriptEntry>[],
  isMonorepo: boolean,
): SearchOption<ScriptEntry>[] {
  return results.map((r) => {
    const entry = r.item
    const pos = r.positions

    const sLen = entry.scriptName.length
    const pLen = entry.packageName.length

    // Map selector offsets to display parts
    const scriptOffset = 0
    const commandOffset = isMonorepo ? sLen + 1 + pLen + 1 : sLen + 1

    const highlightedScript = highlightPositions(
      entry.scriptName,
      pos,
      scriptOffset,
    )
    const highlightedCommand = highlightPositions(
      entry.command,
      pos,
      commandOffset,
    )

    let label: string
    if (isMonorepo && !entry.isRoot) {
      const pkgOffset = sLen + 1
      const highlightedPkg = highlightPositions(
        entry.packageName,
        pos,
        pkgOffset,
      )
      label = `${c.magenta(highlightedPkg)} ${c.dim('>')} ${highlightedScript}`
    } else {
      label = highlightedScript
    }

    return {
      value: entry,
      label,
      hint: highlightedCommand,
    }
  })
}

function buildOption(
  entry: ScriptEntry,
  isMonorepo: boolean,
): SearchOption<ScriptEntry> {
  return {
    value: entry,
    label:
      isMonorepo && !entry.isRoot
        ? `${c.magenta(entry.packageName)} ${c.dim('>')} ${entry.scriptName}`
        : entry.scriptName,
    hint: entry.command,
  }
}
