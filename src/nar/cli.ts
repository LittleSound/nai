#!/usr/bin/env node
import process from 'node:process'
import * as p from '@clack/prompts'
import c from 'ansis'
import { byLengthAsc, Fzf } from 'fzf'
import { version } from '../../package.json'
import { detectProvider } from '../detect.ts'
import { commandOverviewText } from '../help.ts'
import { selectSearchPrompt } from '../prompts/select-search.ts'
import { providers } from '../providers/index.ts'
import { maybePromptForCliUpdate } from '../update.ts'
import {
  buildHighlightedOptions,
  buildScriptOptions,
  collectScripts,
  type ScriptEntry,
} from './core.ts'

function printHelp(): void {
  console.log(
    [
      `nar v${version}`,
      '',
      String(c.bold('Usage')),
      `  ${c.green('nar')}                    Interactive script selection`,
      `  ${c.green('nar')} ${c.dim('<script>')}          Run a script directly`,
      `  ${c.green('nar')} ${c.dim('<script> [args]')}   Run a script with extra arguments`,
      '',
      String(c.bold('Options')),
      `  ${c.green('-h, --help')}           Show this help message`,
      `  ${c.green('-v, --version')}        Show version`,
    ].join('\n'),
  )

  console.log(commandOverviewText())
}

async function run() {
  const rawArgs = process.argv.slice(2)

  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp()
    return
  }

  if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
    console.log(`nar v${version}`)
    return
  }

  // --- Detect provider ---
  const detected = await detectProvider(providers)
  if (!detected) {
    console.error('No package manager detected.')
    process.exit(1)
  }
  const { provider } = detected

  const updateResult = await maybePromptForCliUpdate({
    toolName: 'nar',
    providerName: provider.name,
  })

  if (updateResult === 'cancelled') {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  if (updateResult === 'updated') {
    p.outro('')
    return
  }

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

  const selected = await selectSearchPrompt<ScriptEntry>({
    message: 'Run a script',
    options() {
      const input = (this.userInput ?? '').trim()
      if (!input) return allOptions
      return buildHighlightedOptions(fzf.find(input), isMonorepo)
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
