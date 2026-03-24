#!/usr/bin/env node
import process from 'node:process'
import * as p from '@clack/prompts'
import c from 'ansis'
import { byLengthAsc, Fzf } from 'fzf'
import { version } from '../../package.json'
import { detectProvider } from '../detect.ts'
import { selectSearchPrompt } from '../prompts/select-search.ts'
import { providers } from '../providers/index.ts'
import { buildScriptOptions, collectScripts, type ScriptEntry } from './core.ts'
import type { SearchOption } from '../prompts/search.ts'

async function run() {
  const rawArgs = process.argv.slice(2)

  // --- Detect provider ---
  const detected = await detectProvider(providers)
  if (!detected) {
    console.error('No package manager detected.')
    process.exit(1)
  }
  const { provider } = detected

  // --- Direct mode: nar <script> [...args] ---
  if (rawArgs.length > 0) {
    try {
      await provider.runScript({
        scriptName: rawArgs[0],
        args: rawArgs.slice(1),
      })
    } catch (error: unknown) {
      const status = (error as { status?: number }).status ?? 1
      process.exit(status)
    }
    return
  }

  // --- Interactive mode ---
  p.intro(`${c.magenta`nar`} ${c.dim`v${version}`}`)

  const { packages } = await provider.listPackages()
  const scripts = collectScripts(packages)

  if (scripts.length === 0) {
    p.log.warn('No scripts found.')
    p.outro('')
    return
  }

  const isMonorepo = packages.length > 1
  const allOptions = buildScriptOptions(scripts, isMonorepo)

  /** Tiebreaker: root scripts rank higher than workspace scripts */
  const byRootFirst = (
    a: { item: ScriptEntry },
    b: { item: ScriptEntry },
  ): number => Number(b.item.isRoot) - Number(a.item.isRoot)

  const fzf = new Fzf(scripts, {
    selector: isMonorepo
      ? (item) => `${item.scriptName} ${item.packageName} ${item.command}`
      : (item) => `${item.scriptName} ${item.command}`,
    casing: 'case-insensitive',
    tiebreakers: [byRootFirst, byLengthAsc],
  })

  const optionMap = new Map(allOptions.map((opt) => [opt.value, opt]))

  const selected = await selectSearchPrompt<ScriptEntry>({
    message: 'Run a script',
    options() {
      const input = (this.userInput ?? '').trim()
      if (!input) return allOptions
      const results = fzf.find(input)
      return results
        .map((r) => optionMap.get(r.item))
        .filter((o): o is SearchOption<ScriptEntry> => o != null)
    },
    filter: () => true,
  })

  if (p.isCancel(selected)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  const entry = selected as ScriptEntry

  try {
    await provider.runScript({
      scriptName: entry.scriptName,
      cwd: entry.cwd,
      logger: (msg) => p.outro(`${c.dim`$`} ${c.green(msg)}`),
    })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 1
    process.exit(status)
  }
}

run()
