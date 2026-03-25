#!/usr/bin/env node
import { execSync } from 'node:child_process'
import process from 'node:process'
import * as p from '@clack/prompts'
import c from 'ansis'
import { byLengthAsc, Fzf } from 'fzf'
import { version } from '../../package.json'
import { copyToClipboard } from '../clipboard.ts'
import { detectProvider } from '../detect.ts'
import { commandOverviewText } from '../help.ts'
import { editArgsPrompt } from '../prompts/edit-args.ts'
import { selectSearchPrompt } from '../prompts/select-search.ts'
import { providers } from '../providers/index.ts'
import { checkForUpdates } from '../update-check.ts'
import { getAppStartIntro } from '../utils.ts'
import {
  buildHighlightedOptions,
  buildScriptOptions,
  collectScripts,
  type ScriptEntry,
} from './core.ts'

function printHelp(): void {
  console.log(
    [
      getAppStartIntro(),
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
    console.log(`@rizumu/nai v${version}`)
    return
  }

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
  const showUpdateNotification = checkForUpdates()

  p.intro(getAppStartIntro())

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
    onCopy(entry) {
      provider
        .runScript({ scriptName: entry.scriptName, execute: false })
        .then((cmd) => {
          if (copyToClipboard(cmd)) {
            p.log.info(`Copied: ${c.dim(cmd)}`)
          }
        })
    },
  })

  if (p.isCancel(selected)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  const { action, value: entry } = selected as {
    action: string
    value: ScriptEntry
  }

  const notify = await showUpdateNotification

  if (action === 'edit') {
    const baseCommand = await provider.runScript({
      scriptName: entry.scriptName,
      execute: false,
    })

    const extra = await editArgsPrompt({
      message: 'Edit command',
      prefix: `${baseCommand} `,
      onCopy(fullCommand) {
        if (copyToClipboard(fullCommand)) {
          p.log.info(`Copied: ${c.dim(fullCommand)}`)
        }
      },
    })

    if (p.isCancel(extra)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }

    const fullCommand =
      (extra as string).trim().length > 0
        ? `${baseCommand} ${(extra as string).trim()}`
        : baseCommand

    notify()
    p.outro(`${c.dim`$`} ${c.green(fullCommand)}`)

    try {
      execSync(fullCommand, { cwd: entry.cwd, stdio: 'inherit' })
    } catch (error: unknown) {
      const status = (error as { status?: number }).status ?? 1
      process.exit(status)
    }
  } else {
    try {
      await provider.runScript({
        scriptName: entry.scriptName,
        cwd: entry.cwd,
        logger(cmd) {
          notify()
          p.outro(`${c.dim`$`} ${c.green(cmd)}`)
        },
      })
    } catch (error: unknown) {
      const status = (error as { status?: number }).status ?? 1
      process.exit(status)
    }
  }
}

run()
