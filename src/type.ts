export type Provider = {
  name: string

  /** Whether this package manager supports installing peer dependencies */
  supportsPeerDependencies: boolean

  /** Check if this package manager is used in the current project */
  checkExistence: () => Promise<{ exists: boolean }>

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
}

export type DepInstallOptions = {
  deps: ResolvedDep[]
  /** Target package directories to add dependencies to */
  targetPackages: string[]
  dev: boolean
  peer: boolean
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

export type RepoPackageItem = {
  name: string
  directory: string
  description: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}
