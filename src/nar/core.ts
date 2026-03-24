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

/** Build search options from script entries, prefixing package name for non-root in monorepos */
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
        value: {
          kind: 'group',
          id: groupId,
          label,
        },
        label: c.bold(label),
        disabled: true,
      },
      ...groups.get(groupId)!,
    ]
  })
}
