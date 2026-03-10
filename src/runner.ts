import type { AppContext } from './type.ts'

type DepInstallExecutorOptions = {
  packageDirectory: string
  catalogName?: string
  depName: string
  depVersion: string
  depVersionIsCatalog: boolean
  dev: boolean
  peer: boolean
}

export async function depInstallExecutor(
  ctx: AppContext<DepInstallExecutorOptions>,
): Promise<void> {
  const { provider, options, log } = ctx
  const { catalogName, depName, depVersion, depVersionIsCatalog } = options

  let versionIdentifier = depVersion
  let isCatalog = depVersionIsCatalog

  if (catalogName != null) {
    await provider.addCatalog({
      catalogName,
      depName,
      depVersion,
    })
    versionIdentifier = catalogName
    isCatalog = true
  }

  await provider.addDependency({
    directory: options.packageDirectory,
    depName,
    depVersion: versionIdentifier,
    isCatalog,
    dev: options.dev,
    peer: options.peer,
  })

  log.info('done')

  await provider.runInstall({
    packageDirectory: options.packageDirectory,
  })
}
