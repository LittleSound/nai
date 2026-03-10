export type AppContext<Options> = {
  provider: Provider
  log: LogTool
  options: Options
}

export type Provider = {
  // does it exist?
  checkExistence: () => Promise<{
    exists: boolean
  }>

  listCatalogs: () => Promise<{
    /**
     * catalog name -> (deps name : deps version)
     */
    catalogs: Record<string, Record<string, string>>
  }>

  addCatalog: (options: {
    catalogName: string
    depName: string
    depVersion: string
  }) => Promise<void>

  listPackages: () => Promise<{
    packages: RepoPackageItem[]
  }>

  addDependency: (options: {
    directory: string
    depName: string
    depVersion: string
    isCatalog: boolean
    dev: boolean
    peer: boolean
  }) => Promise<void>

  runInstall: (options: { packageDirectory?: string }) => Promise<void>
}

type RepoPackageItem = {
  name: string
  directory: string
  description: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

export type LogTool = {
  info: (message: string) => void
  error: (message: string) => void
}
