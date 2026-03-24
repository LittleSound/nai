/**
 * Abstraction for a package manager.
 *
 * Design principle — deep modules with simple interfaces:
 *
 * 1. **Actions execute internally.** Every method that performs an action
 *    (depInstallExecutor, install, runScript) owns the full execution.
 *    Callers never need to know which binary to spawn, how arguments are
 *    assembled, or which separator a PM requires. Do NOT return a command
 *    tuple for the caller to execute — that leaks implementation details
 *    and forces every call site to duplicate spawn/exit-code logic.
 *
 * 2. **Use `logger` for caller-visible output.** When the caller needs to
 *    display what is happening, pass a `logger` callback in the options
 *    object. The provider decides *what* to log and *when*; the caller
 *    decides *how* to display it. Avoid lifecycle-specific hooks like
 *    `onBeforeRun` — they couple the caller to the provider's internal
 *    execution steps. A single generic `logger` is more composable and
 *    survives refactors that change the execution order.
 *
 * 3. **Options objects over positional args.** Methods that accept
 *    configuration use a single options object so new fields can be added
 *    without breaking existing call sites.
 */
export type Provider = {
  name: string

  /** Catalog support info. `false` means the PM never supports catalogs. */
  catalogSupport: { minVersion: string } | false

  /** Whether this package manager supports installing peer dependencies */
  supportsPeerDependencies: boolean

  /** Check if this package manager is used in the current project */
  checkExistence: () => Promise<{ exists: boolean; version?: string }>

  /**
   * List all defined catalogs.
   * Key is catalog name (empty string = default catalog).
   * Value is a map of dep name → version.
   */
  listCatalogs: () => Promise<{
    catalogs: Record<string, Record<string, string>>
  }>

  /** List all packages in the workspace (including root) */
  listPackages: () => Promise<{
    packages: RepoPackageItem[]
  }>

  /**
   * Execute the full dependency installation flow.
   * Each provider handles catalog writes, package.json updates,
   * and running install in its own way.
   */
  depInstallExecutor: (options: DepInstallOptions) => Promise<void>

  /** Run bare install (e.g. `pnpm install`) without adding new dependencies */
  install: () => Promise<void>

  /**
   * Run a package.json script through this package manager.
   * Handles PM-specific argument forwarding (e.g. npm requires `--` before
   * extra args) and spawns the process with inherited stdio.
   */
  runScript: (options: RunScriptOptions) => Promise<void>
}

export type DepInstallOptions = {
  deps: ResolvedDep[]
  /** Target package directories to add dependencies to */
  targetPackages: string[]
  dev: boolean
  peer: boolean
  /** Whether to mark peer dependencies as optional in peerDependenciesMeta */
  peerOptional: boolean
  /** Log progress messages during execution */
  logger?: (message: string) => void
}

export type ResolvedDep = {
  name: string
  version: string
  /** Catalog name. undefined = direct install (no catalog). Empty string = default catalog. */
  catalogName?: string
  /** Whether the catalog entry already exists (skip creation) */
  existsInCatalog?: boolean
}

export type RunScriptOptions = {
  /** Script name from package.json "scripts" */
  scriptName: string
  /** Extra arguments forwarded to the script */
  args?: string[]
  /** Working directory to run the script in */
  cwd?: string
  /** Log progress messages during execution */
  logger?: (message: string) => void
}

export type RepoPackageItem = {
  name: string
  directory: string
  description: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  scripts: Record<string, string>
}
