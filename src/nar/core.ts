import c from 'ansis'
import type { FzfResultItem } from 'fzf'
import { highlightPositions } from '../highlight.ts'
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

export interface ScriptGroupMarker {
  kind: 'group'
  id: string
  label: string
}

export type ScriptOptionValue = ScriptEntry | ScriptGroupMarker

const ROOT_GROUP_ID = '__root__'

function getGroupId(entry: ScriptEntry): string {
  return entry.isRoot ? ROOT_GROUP_ID : entry.packageName
}

function getGroupLabel(entry: ScriptEntry): string {
  return entry.isRoot ? 'Root scripts' : entry.packageName
}

export function getScriptGroupOrder(scripts: ScriptEntry[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []

  for (const entry of scripts) {
    const groupId = getGroupId(entry)
    if (seen.has(groupId)) continue
    seen.add(groupId)
    order.push(groupId)
  }

  return order
}

export function isScriptEntry(value: ScriptOptionValue): value is ScriptEntry {
  return 'scriptName' in value
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

/** Build grouped search options for monorepos, with root scripts listed first. */
export function buildScriptOptions(
  scripts: ScriptEntry[],
  isMonorepo: boolean,
  groupOrder: string[] = getScriptGroupOrder(scripts),
): SearchOption<ScriptOptionValue>[] {
  if (!isMonorepo) {
    return scripts.map((entry) => ({
      value: entry,
      label: entry.scriptName,
      hint: entry.command,
    }))
  }

  const groups = new Map<string, SearchOption<ScriptOptionValue>[]>()
  const groupLabels = new Map<string, string>()

  for (const entry of scripts) {
    const groupId = getGroupId(entry)
    if (!groups.has(groupId)) groups.set(groupId, [])
    groupLabels.set(groupId, getGroupLabel(entry))
    groups.get(groupId)!.push({
      value: entry,
      label: entry.scriptName,
      hint: entry.command,
    })
  }

  const orderedGroupIds = [
    ...groupOrder.filter((groupId) => groups.has(groupId)),
    ...[...groups.keys()].filter((groupId) => !groupOrder.includes(groupId)),
  ]

  return orderedGroupIds.flatMap((groupId) => {
    const label = groupLabels.get(groupId) ?? groupId
    return [
      {
        value: { kind: 'group', id: groupId, label },
        label: c.bold(label),
        disabled: true,
      },
      ...groups.get(groupId)!,
    ]
  })
}

/**
 * Build highlighted search options from fzf results while preserving monorepo grouping.
 * Selector layout (monorepo): `${scriptName} ${packageName} ${command}`
 * Selector layout (single):   `${scriptName} ${command}`
 */
export function buildHighlightedOptions(
  results: FzfResultItem<ScriptEntry>[],
  isMonorepo: boolean,
  groupOrder: string[] = getScriptGroupOrder(results.map((result) => result.item)),
): SearchOption<ScriptOptionValue>[] {
  if (!isMonorepo) {
    return results.map((result) => buildHighlightedOption(result, false))
  }

  const groups = new Map<string, SearchOption<ScriptOptionValue>[]>()
  const groupLabels = new Map<string, string>()

  for (const result of results) {
    const entry = result.item
    const groupId = getGroupId(entry)

    if (!groups.has(groupId)) groups.set(groupId, [])
    if (!groupLabels.has(groupId)) {
      groupLabels.set(groupId, buildHighlightedGroupLabel(result))
    }

    groups.get(groupId)!.push(buildHighlightedOption(result, true))
  }

  const orderedGroupIds = [
    ...groupOrder.filter((groupId) => groups.has(groupId)),
    ...[...groups.keys()].filter((groupId) => !groupOrder.includes(groupId)),
  ]

  return orderedGroupIds.flatMap((groupId) => {
    const label = groupLabels.get(groupId) ?? groupId
    return [
      {
        value: {
          kind: 'group',
          id: groupId,
          label: stripAnsi(label),
        },
        label: c.bold(label),
        disabled: true,
      },
      ...groups.get(groupId)!,
    ]
  })
}

function buildHighlightedOption(
  result: FzfResultItem<ScriptEntry>,
  isMonorepo: boolean,
): SearchOption<ScriptOptionValue> {
  const entry = result.item
  const positions = result.positions

  const scriptOffset = 0
  const commandOffset = isMonorepo
    ? entry.scriptName.length + 1 + entry.packageName.length + 1
    : entry.scriptName.length + 1

  return {
    value: entry,
    label: highlightPositions(entry.scriptName, positions, scriptOffset),
    hint: highlightPositions(entry.command, positions, commandOffset),
  }
}

function buildHighlightedGroupLabel(result: FzfResultItem<ScriptEntry>): string {
  const entry = result.item
  if (entry.isRoot) return 'Root scripts'

  const packageOffset = entry.scriptName.length + 1
  return highlightPositions(entry.packageName, result.positions, packageOffset)
}

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[\d;]*m/g, '')
}
