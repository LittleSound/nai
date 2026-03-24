import { execFileSync } from 'node:child_process'
import process from 'node:process'
import * as p from '@clack/prompts'
import { getLatestVersion } from 'fast-npm-meta'
import { version as currentVersion, name as packageName } from '../package.json'
import { compareVersions } from './utils.ts'

export interface UpdateCommand {
  command: string
  args: string[]
}

export type UpdatePromptResult =
  | 'up-to-date'
  | 'outdated'
  | 'updated'
  | 'update-failed'
  | 'skipped'
  | 'cancelled'

export interface UpdateLogger {
  success: (message: string) => void
  error: (message: string) => void
}

export function shouldSkipUpdateCheck(options?: {
  env?: NodeJS.ProcessEnv
  isTTY?: boolean
}): boolean {
  const env = options?.env ?? process.env
  const isTTY =
    options?.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)

  return (
    !isTTY ||
    env.CI === 'true' ||
    env.NAI_DISABLE_UPDATE_CHECK === '1' ||
    env.NAI_DISABLE_UPDATE_CHECK === 'true'
  )
}

export function getSelfUpdateCommand(
  providerName?: string,
  targetPackage = packageName,
): UpdateCommand {
  const spec = `${targetPackage}@latest`

  switch (providerName) {
    case 'pnpm':
      return { command: 'pnpm', args: ['add', '-g', spec] }
    case 'bun':
      return { command: 'bun', args: ['add', '-g', spec] }
    case 'npm':
    default:
      return { command: 'npm', args: ['install', '-g', spec] }
  }
}

export async function fetchLatestCliVersion(
  targetPackage = packageName,
  options?: {
    timeoutMs?: number
    fetchLatestVersion?: typeof getLatestVersion
  },
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 1500
  const fetcher = options?.fetchLatestVersion ?? getLatestVersion

  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), timeoutMs)
      timeoutId.unref?.()
    })

    const meta = await Promise.race([fetcher(targetPackage), timeoutPromise])
    return meta?.version ?? null
  } catch {
    return null
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function runUpdateCommand(command: UpdateCommand): void {
  execFileSync(command.command, command.args, {
    stdio: 'inherit',
  })
}

export async function maybePromptForCliUpdate(options: {
  toolName: 'nai' | 'nar'
  providerName?: string
  packageName?: string
  localVersion?: string
  env?: NodeJS.ProcessEnv
  isTTY?: boolean
  fetchLatestVersion?: (packageName: string) => Promise<string | null>
  confirmUpdate?: (
    localVersion: string,
    latestVersion: string,
  ) => Promise<boolean | symbol>
  runUpdate?: (command: UpdateCommand) => Promise<void> | void
  logger?: UpdateLogger
}): Promise<UpdatePromptResult> {
  if (
    shouldSkipUpdateCheck({
      env: options.env,
      isTTY: options.isTTY,
    })
  ) {
    return 'skipped'
  }

  const targetPackage = options.packageName ?? packageName
  const localVersion = options.localVersion ?? currentVersion
  const latestVersion = await (
    options.fetchLatestVersion ?? fetchLatestCliVersion
  )(targetPackage)

  if (!latestVersion || compareVersions(localVersion, latestVersion) >= 0) {
    return 'up-to-date'
  }

  const confirmed = await (
    options.confirmUpdate ??
    ((current, latest) =>
      p.confirm({
        message: `A newer ${targetPackage} version is available (${current} → ${latest}). Update now?`,
        initialValue: false,
      }))
  )(localVersion, latestVersion)

  if (p.isCancel(confirmed)) return 'cancelled'
  if (!confirmed) return 'outdated'

  try {
    await (options.runUpdate ?? runUpdateCommand)(
      getSelfUpdateCommand(options.providerName, targetPackage),
    )
    ;(options.logger ?? p.log).success(
      `Updated ${targetPackage} to v${latestVersion}. Please rerun ${options.toolName}.`,
    )
    return 'updated'
  } catch (error) {
    ;(options.logger ?? p.log).error(
      `Failed to update ${targetPackage}: ${error instanceof Error ? error.message : error}`,
    )
    return 'update-failed'
  }
}
