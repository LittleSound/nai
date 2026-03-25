import process from 'node:process'
import * as p from '@clack/prompts'
import c from 'ansis'
import { getLatestVersion } from 'fast-npm-meta'
import { version as currentVersion } from '../package.json'
import { compareVersions } from './utils.ts'

const PACKAGE_NAME = '@rizumu/nai'

/**
 * Kick off an async update check that resolves to a display function.
 * Call the returned function after the main CLI work is done to print
 * the notification (if an update is available). Non-blocking — the
 * check runs in parallel with the rest of the CLI.
 */
export function checkForUpdates(): Promise<() => void> {
  if (process.env.NO_UPDATE_NOTIFIER) return Promise.resolve(() => {})

  return getLatestVersion(PACKAGE_NAME)
    .then((meta) => {
      if (!meta.version) return () => {}
      if (compareVersions(meta.version, currentVersion) <= 0) return () => {}

      const upgradeCmd = getUpgradeCommand()
      return () => {
        p.log.warn(
          [
            `${c.yellow('Update available:')} ${c.dim(currentVersion)} → ${c.green(meta.version!)}`,
            `Run: ${c.cyan(upgradeCmd)}`,
          ].join('\n'),
        )
      }
    })
    .catch(() => () => {})
}

/** Detect how the user installed the package and suggest the matching upgrade command */
function getUpgradeCommand(): string {
  const userAgent = process.env.npm_config_user_agent ?? ''
  const pm = userAgent.split('/')[0]

  switch (pm) {
    case 'pnpm':
      return `pnpm add -g ${PACKAGE_NAME}@latest`
    case 'yarn':
      return `yarn global add ${PACKAGE_NAME}@latest`
    case 'bun':
      return `bun add -g ${PACKAGE_NAME}@latest`
    default:
      return `npm i -g ${PACKAGE_NAME}@latest`
  }
}
