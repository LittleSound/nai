import spawn from 'cross-spawn'

export interface RunCommandOptions {
  command: string
  args?: string[]
  cwd?: string
}

/**
 * Run a command synchronously with inherited stdio.
 *
 * Uses `cross-spawn` instead of `node:child_process` so that package manager
 * binaries installed as `.cmd`/`.ps1` shims on Windows (pnpm, npm, yarn, ...)
 * resolve correctly. Arguments are escaped by `cross-spawn` and never
 * interpreted by a shell, so user-provided package names are safe.
 *
 * Mirrors `execFileSync` failure semantics: throws the spawn error (e.g.
 * ENOENT) as-is, or an Error carrying the child's exit `status` when it exits
 * non-zero or is killed by a signal.
 */
export function runCommand(options: RunCommandOptions): void {
  const { command, args = [], cwd } = options
  const result = spawn.sync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const reason =
      result.status === null
        ? `was killed by signal ${result.signal}`
        : `exited with code ${result.status}`
    throw Object.assign(
      new Error(`Command failed: ${command} ${args.join(' ')} ${reason}`),
      { status: result.status ?? 1, signal: result.signal },
    )
  }
}
