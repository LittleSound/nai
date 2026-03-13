#!/usr/bin/env node
import process from 'node:process'
import * as p from '@clack/prompts'
import c from 'ansis'
import cac from 'cac'
import { getLatestVersion } from 'fast-npm-meta'
import { version } from '../package.json'
import {
  checkCatalogSupport,
  getDepField,
  resolvePackageVersions,
} from './core.ts'
import {
  checkOutdated,
  getPackageVersions,
} from './npm.ts'
import { providers } from './providers/index.ts'
import { getCachedVersion, promptPackages } from './search.ts'
import { parsePackageSpec, type ParsedPackage } from './utils.ts'
import type { Provider, ResolvedDep } from './type.ts'

/** Auto-detect the first available provider */
async function detectProvider(): Promise<
  { provider: Provider; version?: string } | undefined
> {
  for (const provider of providers) {
    const { exists, version } = await provider.checkExistence()
    if (exists) return { provider, version }
  }
}

/** Guard against user cancellation (Ctrl+C) */
function guardCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Operation cancelled.')
    process.exit(0)
  }
  return value
}

async function run(
  names: string[],
  options: {
    dev?: boolean
    peer?: boolean
    peerOptional?: boolean
    catalog?: string
  },
) {
  p.intro(`${c.yellow`@rizumu/nai`} ${c.dim`v${version}`}`)

  // --- Detect or select package manager ---
  let provider: Provider
  let pmVersion: string | undefined
  const detected = await detectProvider()
  if (detected) {
    provider = detected.provider
    pmVersion = detected.version
    const versionStr = pmVersion ? ` ${c.dim(`v${pmVersion}`)}` : ''
    p.log.info(`Detected: ${c.bold(provider.name)}${versionStr}`)
  } else if (providers.length > 0) {
    const selectedName = guardCancel(
      await p.select({
        message: 'No package manager detected. Select one:',
        options: providers.map((prov) => ({
          value: prov.name,
          label: prov.name,
        })),
      }),
    )
    provider = providers.find((prov) => prov.name === selectedName)!
  } else {
    p.log.error('No package manager providers available.')
    p.outro('Exiting')
    process.exit(1)
  }

  // --- Parse or prompt for package names ---
  let packages: ParsedPackage[]
  if (names.length > 0) {
    packages = names.map(parsePackageSpec)
  } else {
    const result = await promptPackages()
    if (result === null) {
      p.cancel('Operation cancelled.')
      process.exit(0)
    }

    // install all dependencies
    if (result === 'install') {
      p.log.step(`Running ${c.bold(provider.name)} install`)
      try {
        await provider.install()
      } catch (error) {
        p.log.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
      return
    }

    packages = result
    if (packages.length === 0) {
      p.log.error('No packages to install.')
      p.outro('Exiting')
      return
    }
  }

  // --- Check catalog support ---
  const catalogCheck = checkCatalogSupport(provider, pmVersion)
  let catalogsEnabled = true

  if (!catalogCheck.supported) {
    if (catalogCheck.reason === 'unsupported') {
      p.log.warn(
        `${c.bold(provider.name)} does not support catalogs. Dependencies will be installed directly.`,
      )
    } else if (catalogCheck.reason === 'version-too-low') {
      p.log.warn(
        `${c.bold(provider.name)} ${c.dim(`v${pmVersion}`)} does not support catalogs (requires ${c.green(`>= ${catalogCheck.minVersion}`)}). Dependencies will be installed directly.`,
      )
    }
    catalogsEnabled = false
  }

  // --- Resolve versions (check existing catalogs first, then fetch) ---
  const { catalogs } = catalogsEnabled
    ? await provider.listCatalogs()
    : { catalogs: {} }

  const resolved = await resolvePackageVersions(packages, {
    catalogs,
    async onExistingFound(depName, entries) {
      const existingOptions = [
        ...entries.map((e) => ({
          value: `${e.catalogName}\0${e.version}`,
          label: `${c.yellow(e.catalogName || '(default)')} → ${c.green(e.version)}`,
        })),
        { value: '', label: c.dim('Choose another catalog') },
      ]
      const selected = guardCancel(
        await p.select({
          message: `${c.cyan(depName)} found in existing catalog(s)`,
          options: existingOptions,
        }),
      )
      if (!selected) return null
      const [catalogName, version] = selected.split('\0')
      return { catalogName, version }
    },
    async onFetchVersion(depName) {
      const infoMsg = (name: string, version: string) =>
        `${c.cyan(name)}@${c.green(`^${version}`)}`

      const cached = getCachedVersion(depName)
      if (cached) {
        p.log.info(infoMsg(depName, cached))
        return `^${cached}`
      }

      const s = p.spinner()
      s.start(`Resolving ${c.cyan(depName)} from npm...`)
      try {
        const meta = await getLatestVersion(depName)
        if (!meta.version) {
          s.stop(`Package ${c.cyan(depName)} not found`)
          p.log.error(
            `Could not resolve version for ${c.cyan(depName)}. Skipping.`,
          )
          return null
        }
        s.stop(infoMsg(depName, meta.version))
        return `^${meta.version}`
      } catch (error) {
        s.stop(`Failed to fetch ${c.cyan(depName)}`)
        p.log.error(
          `Could not fetch ${c.cyan(depName)}: ${error instanceof Error ? error.message : error}`,
        )
        return null
      }
    },
  })

  if (resolved.length === 0) {
    p.log.error('No packages to install.')
    p.outro('Exiting')
    return
  }

  // --- Select catalog for new packages (ones not reusing an existing entry) ---
  const newDeps = resolved.filter((d) => !d.existsInCatalog)
  if (catalogsEnabled && newDeps.length > 0) {
    const catalogNames = Object.keys(catalogs)
    let targetCatalog: string | null

    if (options.catalog == null) {
      const catalogOptions = [
        ...catalogNames.map((name) => ({
          value: name,
          label: c.yellow(name || '(default)'),
          hint: c.dim(`${Object.keys(catalogs[name]).length} deps`),
        })),
        { value: '__new__', label: '+ Create new catalog' },
        { value: '__skip__', label: c.dim('Skip (no catalog)') },
      ]

      const selected = guardCancel(
        await p.select({
          message: 'Select a catalog for new packages',
          options: catalogOptions,
        }),
      )

      if (selected === '__new__') {
        targetCatalog = guardCancel(
          await p.text({
            message: 'New catalog name',
            validate: (v) => {
              if (!v?.trim()) return 'Catalog name is required.'
            },
          }),
        )
      } else if (selected === '__skip__') {
        targetCatalog = null
      } else {
        targetCatalog = selected
      }
    } else {
      targetCatalog = options.catalog
    }

    if (targetCatalog != null) {
      for (const dep of newDeps) {
        dep.catalogName = targetCatalog
      }
    }
  }

  // --- Select workspace packages (if monorepo) ---
  const { packages: repoPackages } = await provider.listPackages()
  let targetDirs: string[]

  if (repoPackages.length <= 1) {
    targetDirs = repoPackages.length === 1 ? [repoPackages[0].directory] : ['.']
  } else {
    targetDirs = guardCancel(
      await p.multiselect({
        message: 'Select packages to install to',
        options: repoPackages.map((pkg) => ({
          value: pkg.directory,
          label: pkg.name,
          hint: pkg.description || undefined,
        })),
      }),
    )
  }

  // --- Dependency type ---
  let dev = options.dev ?? false
  let peer = options.peer ?? false
  let peerOptional = options.peerOptional ?? false

  if (!dev && !peer) {
    const depTypeChoice = guardCancel(
      await p.select({
        message: 'Install as',
        options: [
          { value: 'dependencies', label: c.green('dependencies') },
          { value: 'devDependencies', label: c.yellow('devDependencies') },
          {
            value: 'peerDependencies',
            label: c.magenta('peerDependencies'),
            hint: provider.supportsPeerDependencies
              ? undefined
              : 'not supported',
            disabled: !provider.supportsPeerDependencies,
          },
        ],
      }),
    )
    dev = depTypeChoice === 'devDependencies'
    peer = depTypeChoice === 'peerDependencies'
  }

  if (peer && !peerOptional) {
    peerOptional = guardCancel(
      await p.confirm({
        message: 'Mark as optional in peerDependenciesMeta?',
        initialValue: false,
      }),
    )
  }

  const depType = getDepField(dev, peer)

  const targetNames = targetDirs.map((d) => {
    const pkg = repoPackages.find((rp) => rp.directory === d)
    return pkg?.name || d
  })

  // --- Build colored summary ---
  const summaryLines: string[] = []
  for (const dep of resolved) {
    if (dep.catalogName == null) {
      summaryLines.push(
        `${c.cyan(dep.name)}@${c.green(dep.version)} ${c.gray('(direct)')}`,
      )
    } else {
      const ref =
        dep.catalogName === '' ? 'catalog:' : `catalog:${dep.catalogName}`
      const status = dep.existsInCatalog ? 'existing' : 'new'
      summaryLines.push(
        `${c.cyan(dep.name)}@${c.green(dep.version)}  ${c.yellow(ref)}  ${c.gray(`(${status})`)}`,
      )
    }
  }

  const depTypeColor =
    depType === 'peerDependencies'
      ? c.magenta
      : depType === 'devDependencies'
        ? c.yellow
        : c.green

  const summaryContent = [
    `${c.dim('Package manager:')} ${c.bold(provider.name)}`,
    `${c.dim('Install as:')} ${depTypeColor(depType)}${peerOptional ? c.dim(' (optional)') : ''}`,
    `${c.dim('Packages:')} ${c.cyan(targetNames.join(', '))}`,
    '',
    ...summaryLines,
  ].join('\n')

  p.note(c.reset(summaryContent), 'Summary')

  const confirmed = guardCancel(
    await p.confirm({ message: c.green('Looks good?') }),
  )
  if (!confirmed) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  // --- Execute ---
  try {
    await provider.depInstallExecutor({
      deps: resolved,
      targetPackages: targetDirs,
      dev,
      peer,
      peerOptional,
      logger: (msg) => p.log.step(msg),
    })
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// --- CLI Setup ---
const cli = cac('nai')

cli
  .command('[...names]', 'Install packages with catalog support')
  .option('-D, --dev', 'Install as dev dependency')
  .option('--peer', 'Install as peer dependency')
  .option('--peer-optional', 'Mark peer dependencies as optional')
  .option('-C, --catalog <name>', 'Specify catalog name')
  .action(run)

cli
  .command('add [...names]', 'Install packages with catalog support')
  .option('-D, --dev', 'Install as dev dependency')
  .option('--peer', 'Install as peer dependency')
  .option('--peer-optional', 'Mark peer dependencies as optional')
  .option('-C, --catalog <name>', 'Specify catalog name')
  .action(run)

async function runRemove(names: string[], options: { cleanCatalog?: boolean }) {
  p.intro(`${c.yellow`@rizumu/nai`} ${c.dim`v${version}`} ${c.red`remove`}`)

  // --- Detect or select package manager ---
  let provider: Provider
  let pmVersion: string | undefined
  const detected = await detectProvider()
  if (detected) {
    provider = detected.provider
    pmVersion = detected.version
    const versionStr = pmVersion ? ` ${c.dim(`v${pmVersion}`)}` : ''
    p.log.info(`Detected: ${c.bold(provider.name)}${versionStr}`)
  } else if (providers.length > 0) {
    const selectedName = guardCancel(
      await p.select({
        message: 'No package manager detected. Select one:',
        options: providers.map((prov) => ({
          value: prov.name,
          label: prov.name,
        })),
      }),
    )
    provider = providers.find((prov) => prov.name === selectedName)!
  } else {
    p.log.error('No package manager providers available.')
    p.outro('Exiting')
    process.exit(1)
  }

  // --- Check catalog support ---
  const catalogCheck = checkCatalogSupport(provider, pmVersion)
  const catalogsEnabled = catalogCheck.supported

  // --- Get all installed packages across workspace ---
  const { packages: repoPackages } = await provider.listPackages()

  // Build a map of all dependencies across all packages
  const allDeps = new Map<
    string,
    { name: string; packages: string[]; types: string[] }
  >()

  for (const pkg of repoPackages) {
    for (const depField of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ] as const) {
      const deps = pkg[depField]
      if (!deps) continue
      for (const depName of Object.keys(deps)) {
        const existing = allDeps.get(depName) || {
          name: depName,
          packages: [],
          types: [],
        }
        if (!existing.packages.includes(pkg.name)) {
          existing.packages.push(pkg.name)
        }
        if (!existing.types.includes(depField)) {
          existing.types.push(depField)
        }
        allDeps.set(depName, existing)
      }
    }
  }

  if (allDeps.size === 0) {
    p.log.warn('No dependencies found in any package.')
    p.outro('Nothing to remove')
    return
  }

  // --- Select packages to remove ---
  let packagesToRemove: string[]

  if (names.length > 0) {
    // Validate provided names
    const notFound = names.filter((n) => !allDeps.has(n))
    if (notFound.length > 0) {
      p.log.warn(`Packages not found: ${notFound.join(', ')}`)
    }
    packagesToRemove = names.filter((n) => allDeps.has(n))
    if (packagesToRemove.length === 0) {
      p.log.error('No valid packages to remove.')
      p.outro('Exiting')
      return
    }
  } else {
    const sortedDeps = [...allDeps.values()].toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )

    packagesToRemove = guardCancel(
      await p.multiselect({
        message: 'Select packages to remove',
        options: sortedDeps.map((dep) => ({
          value: dep.name,
          label: c.cyan(dep.name),
          hint: c.dim(`${dep.packages.length} pkg(s), ${dep.types.join(', ')}`),
        })),
      }),
    )
  }

  // --- Show which packages will be affected ---
  const affectedPackages = new Set<string>()
  for (const depName of packagesToRemove) {
    const dep = allDeps.get(depName)
    if (dep) {
      for (const pkgName of dep.packages) {
        affectedPackages.add(pkgName)
      }
    }
  }

  // --- Select target packages to remove from ---
  let targetDirs: string[]

  if (affectedPackages.size <= 1) {
    const pkgName = [...affectedPackages][0]
    const pkg = repoPackages.find((p) => p.name === pkgName)
    targetDirs = pkg ? [pkg.directory] : ['.']
  } else {
    targetDirs = guardCancel(
      await p.multiselect({
        message: 'Select packages to remove from',
        options: repoPackages
          .filter((pkg) => affectedPackages.has(pkg.name))
          .map((pkg) => ({
            value: pkg.directory,
            label: pkg.name,
            hint: pkg.description || undefined,
          })),
        initialValues: repoPackages
          .filter((pkg) => affectedPackages.has(pkg.name))
          .map((pkg) => pkg.directory),
      }),
    )
  }

  // --- Ask about catalog cleanup ---
  let cleanCatalog = options.cleanCatalog ?? false

  if (catalogsEnabled && cleanCatalog === undefined) {
    cleanCatalog = guardCancel(
      await p.confirm({
        message: 'Also remove unused catalog entries?',
        initialValue: true,
      }),
    )
  }

  // --- Build summary ---
  const summaryLines = packagesToRemove.map((name) => {
    const dep = allDeps.get(name)
    const typeStr = dep ? c.gray(`(${dep.types.join(', ')})`) : ''
    return `  ${c.red('-')} ${c.cyan(name)} ${typeStr}`
  })

  const targetNames = targetDirs.map((d) => {
    const pkg = repoPackages.find((rp) => rp.directory === d)
    return pkg?.name || d
  })

  const summaryContent = [
    `${c.dim('Package manager:')} ${c.bold(provider.name)}`,
    `${c.dim('Remove from:')} ${c.cyan(targetNames.join(', '))}`,
    `${c.dim('Clean catalog:')} ${cleanCatalog ? c.green('yes') : c.gray('no')}`,
    '',
    ...summaryLines,
  ].join('\n')

  p.note(c.reset(summaryContent), 'Summary')

  const confirmed = guardCancel(
    await p.confirm({ message: c.red('Remove selected packages?') }),
  )
  if (!confirmed) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  // --- Execute ---
  try {
    await provider.depRemoveExecutor({
      packageNames: packagesToRemove,
      targetPackages: targetDirs,
      cleanCatalog,
      logger: (msg) => p.log.step(msg),
    })
    p.outro(c.green('Done!'))
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

cli
  .command('remove [...names]', 'Remove packages from dependencies')
  .alias('rm')
  .option('--clean-catalog', 'Remove unused catalog entries')
  .action(runRemove)

async function runUpdate(
  names: string[],
  options: { interactive?: boolean; catalog?: string },
) {
  p.intro(`${c.yellow`@rizumu/nai`} ${c.dim`v${version}`} ${c.green`update`}`)

  // --- Detect package manager ---
  const detected = await detectProvider()
  if (!detected) {
    p.log.error('No package manager detected.')
    p.outro('Exiting')
    process.exit(1)
  }
  const { provider, version: pmVersion } = detected
  const versionStr = pmVersion ? ` ${c.dim(`v${pmVersion}`)}` : ''
  p.log.info(`Detected: ${c.bold(provider.name)}${versionStr}`)

  // --- Check catalog support ---
  const catalogCheck = checkCatalogSupport(provider, pmVersion)
  const catalogsEnabled = catalogCheck.supported

  // --- Get all packages and their dependencies ---
  const { packages: repoPackages } = await provider.listPackages()
  const { catalogs } = catalogsEnabled
    ? await provider.listCatalogs()
    : { catalogs: {} }

  // Build a map of all deps with their locations
  interface DepInfo {
    name: string
    version: string
    packages: { name: string; directory: string; type: string }[]
    catalogName?: string
  }
  const allDeps = new Map<string, DepInfo>()

  for (const pkg of repoPackages) {
    for (const depField of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ] as const) {
      const deps = pkg[depField]
      if (!deps) continue
      for (const [depName, depVersion] of Object.entries(deps)) {
        const existing = allDeps.get(depName)
        if (existing) {
          existing.packages.push({
            name: pkg.name,
            directory: pkg.directory,
            type: depField,
          })
        } else {
          allDeps.set(depName, {
            name: depName,
            version: depVersion,
            packages: [
              { name: pkg.name, directory: pkg.directory, type: depField },
            ],
          })
        }
      }
    }
  }

  // Resolve catalog references
  for (const [depName, info] of allDeps) {
    if (info.version.startsWith('catalog:')) {
      const catalogRef = info.version.slice('catalog:'.length) || ''
      const catalog = catalogs[catalogRef]
      if (catalog && catalog[depName]) {
        info.version = catalog[depName]
        info.catalogName = catalogRef
      }
    }
  }

  if (allDeps.size === 0) {
    p.log.warn('No dependencies found.')
    p.outro('Nothing to update')
    return
  }

  // --- Check for outdated packages ---
  let outdatedDeps: DepInfo[] = []

  if (names.length > 0) {
    // Check specific packages
    for (const name of names) {
      const dep = allDeps.get(name)
      if (dep) {
        outdatedDeps.push(dep)
      } else {
        p.log.warn(`Package ${c.cyan(name)} not found in dependencies`)
      }
    }
  } else {
    // Check all packages for updates
    const s = p.spinner()
    s.start('Checking for outdated packages...')

    const depsToCheck: Record<string, string> = {}
    for (const [name, info] of allDeps) {
      if (!info.version.startsWith('workspace:')) {
        depsToCheck[name] = info.version
      }
    }

    const outdated = await checkOutdated(depsToCheck, {
      logger: (msg) => s.message(msg),
    })
    s.stop(`Found ${c.green(outdated.length)} outdated packages`)

    outdatedDeps = outdated
      .map((o) => allDeps.get(o.name)!)
      .filter(Boolean)
      .map((dep) => {
        const outdatedInfo = outdated.find((o) => o.name === dep.name)
        if (outdatedInfo) {
          return { ...dep, latestVersion: outdatedInfo.latest }
        }
        return dep
      })
  }

  if (outdatedDeps.length === 0) {
    p.log.success('All packages are up to date!')
    p.outro('Done')
    return
  }

  // --- Select packages to update ---
  let toUpdate: (DepInfo & { latestVersion?: string })[]

  if (options.interactive || names.length === 0) {
    toUpdate = guardCancel(
      await p.multiselect({
        message: 'Select packages to update',
        options: outdatedDeps.map((dep) => ({
          value: dep.name,
          label: dep.latestVersion
            ? `${c.cyan(dep.name)} ${c.gray(dep.version)} → ${c.green(dep.latestVersion)}`
            : c.cyan(dep.name),
          hint: dep.catalogName
            ? c.yellow(`catalog:${dep.catalogName}`)
            : undefined,
        })),
      }),
    ).map((name) => {
      const dep = outdatedDeps.find((d) => d.name === name)!
      return dep
    })
  } else {
    toUpdate = outdatedDeps
  }

  if (toUpdate.length === 0) {
    p.log.warn('No packages selected for update.')
    p.outro('Done')
    return
  }

  // --- Resolve new versions ---
  const resolved: ResolvedDep[] = []
  for (const dep of toUpdate) {
    const s2 = p.spinner()
    s2.start(`Resolving ${c.cyan(dep.name)}...`)

    try {
      const meta = await getLatestVersion(dep.name)
      if (meta.version) {
        s2.stop(`Resolved ${c.cyan(dep.name)}@${c.green(`^${meta.version}`)}`)
        resolved.push({
          name: dep.name,
          version: `^${meta.version}`,
          catalogName: dep.catalogName,
          existsInCatalog: !!dep.catalogName,
        })
      }
    } catch {
      s2.stop(`Failed to resolve ${c.cyan(dep.name)}`)
    }
  }

  if (resolved.length === 0) {
    p.log.error('Could not resolve any packages.')
    p.outro('Exiting')
    return
  }

  // --- Build summary ---
  const summaryLines = resolved.map((dep) => {
    const oldDep = toUpdate.find((d) => d.name === dep.name)
    const oldVersion = oldDep?.version || 'unknown'
    if (dep.catalogName != null) {
      const ref =
        dep.catalogName === '' ? 'catalog:' : `catalog:${dep.catalogName}`
      return `${c.cyan(dep.name)} ${c.gray(oldVersion)} → ${c.green(dep.version)} ${c.yellow(ref)}`
    }
    return `${c.cyan(dep.name)} ${c.gray(oldVersion)} → ${c.green(dep.version)} ${c.gray('(direct)')}`
  })

  const summaryContent = [
    `${c.dim('Package manager:')} ${c.bold(provider.name)}`,
    '',
    ...summaryLines,
  ].join('\n')

  p.note(c.reset(summaryContent), 'Summary')

  const confirmed = guardCancel(
    await p.confirm({ message: c.green('Update selected packages?') }),
  )
  if (!confirmed) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  // --- Execute update ---
  // Group packages by target directory
  const targetDirs = [...new Set(toUpdate.flatMap((d) => d.packages.map((p) => p.directory)))]

  try {
    // Update catalog entries if needed
    if (catalogsEnabled) {
      const catalogUpdates = resolved.filter(
        (d) => d.catalogName != null && d.existsInCatalog,
      )
      if (catalogUpdates.length > 0) {
        // Provider will handle catalog updates through depInstallExecutor
      }
    }

    // Update package.json files
    await provider.depInstallExecutor({
      deps: resolved,
      targetPackages: targetDirs,
      dev: false,
      peer: false,
      logger: (msg) => p.log.step(msg),
    })
    p.outro(c.green('Done!'))
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

cli
  .command('update [...names]', 'Update packages to latest versions')
  .alias('up')
  .option('-i, --interactive', 'Interactive mode (select packages to update)')
  .option('-C, --catalog <name>', 'Update packages in a specific catalog')
  .action(runUpdate)

async function runCatalog(options: { list?: boolean }) {
  p.intro(`${c.yellow`@rizumu/nai`} ${c.dim`v${version}`} ${c.yellow`catalog`}`)

  // --- Detect package manager ---
  const detected = await detectProvider()
  if (!detected) {
    p.log.error('No package manager detected.')
    p.outro('Exiting')
    process.exit(1)
  }
  const { provider, version: pmVersion } = detected
  const versionStr = pmVersion ? ` ${c.dim(`v${pmVersion}`)}` : ''
  p.log.info(`Detected: ${c.bold(provider.name)}${versionStr}`)

  // --- Check catalog support ---
  const catalogCheck = checkCatalogSupport(provider, pmVersion)
  if (!catalogCheck.supported) {
    if (catalogCheck.reason === 'unsupported') {
      p.log.error(`${c.bold(provider.name)} does not support catalogs.`)
    } else {
      p.log.error(
        `${c.bold(provider.name)} ${c.dim(`v${pmVersion}`)} does not support catalogs (requires ${c.green(`>= ${catalogCheck.minVersion}`)}).`,
      )
    }
    p.outro('Exiting')
    process.exit(1)
  }

  // --- List catalogs ---
  const { catalogs } = await provider.listCatalogs()
  const catalogNames = Object.keys(catalogs)

  if (catalogNames.length === 0) {
    p.log.warn('No catalogs defined.')
    p.outro('Done')
    return
  }

  if (options.list) {
    // Just list all catalogs
    for (const name of catalogNames) {
      const deps = catalogs[name]
      const displayName = name || '(default)'
      p.log.info(`${c.yellow(displayName)}: ${c.dim(`${Object.keys(deps).length} deps`)}`)
    }
    p.outro('Done')
    return
  }

  // --- Interactive catalog browser ---
  const selectedCatalog = guardCancel(
    await p.select({
      message: 'Select a catalog',
      options: catalogNames.map((name) => ({
        value: name,
        label: c.yellow(name || '(default)'),
        hint: c.dim(`${Object.keys(catalogs[name]).length} deps`),
      })),
    }),
  )

  const catalogDeps = catalogs[selectedCatalog]
  const depEntries = Object.entries(catalogDeps).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )

  if (depEntries.length === 0) {
    p.log.warn('This catalog is empty.')
    p.outro('Done')
    return
  }

  // Show packages in catalog with version selection option
  const action = guardCancel(
    await p.select({
      message: `Catalog ${c.yellow(selectedCatalog || '(default)')} - ${depEntries.length} packages`,
      options: [
        { value: 'view', label: c.cyan('View all packages') },
        { value: 'select', label: c.green('Select packages to change version') },
        { value: 'back', label: c.dim('Back') },
      ],
    }),
  )

  if (action === 'back') {
    p.outro('Done')
    return
  }

  if (action === 'view') {
    const content = depEntries
      .map(([name, version]) => `${c.cyan(name)}: ${c.green(version)}`)
      .join('\n')
    p.note(c.reset(content), `Packages in ${selectedCatalog || '(default)'}`)
    p.outro('Done')
    return
  }

  // Select packages to change version
  const toChange = guardCancel(
    await p.multiselect({
      message: 'Select packages to change version',
      options: depEntries.map(([name, version]) => ({
        value: name,
        label: `${c.cyan(name)} ${c.dim(`(${version})`)}`,
      })),
    }),
  )

  if (toChange.length === 0) {
    p.log.warn('No packages selected.')
    p.outro('Done')
    return
  }

  // For each selected package, get available versions and let user choose
  const updated: { name: string; version: string }[] = []

  for (const depName of toChange) {
    const s = p.spinner()
    s.start(`Fetching versions for ${c.cyan(depName)}...`)

    try {
      const versions = await getPackageVersions(depName)
      s.stop(`Found ${c.green(versions.length)} versions`)

      // Show recent versions (last 20)
      const recentVersions = versions.slice(0, 20)

      const newVersion = guardCancel(
        await p.select({
          message: `Select version for ${c.cyan(depName)}`,
          options: recentVersions.map((v) => ({
            value: v,
            label: c.green(v),
          })),
        }),
      )

      updated.push({ name: depName, version: `^${newVersion}` })
    } catch {
      s.stop(`Failed to fetch versions for ${c.cyan(depName)}`)
    }
  }

  if (updated.length === 0) {
    p.log.warn('No versions selected.')
    p.outro('Done')
    return
  }

  // Show summary
  const summaryLines = updated.map(
    ({ name, version }) => {
      const oldVersion = catalogDeps[name]
      return `${c.cyan(name)} ${c.gray(oldVersion)} → ${c.green(version)}`
    },
  )

  p.note(c.reset(summaryLines.join('\n')), 'Summary')

  const confirmed = guardCancel(
    await p.confirm({ message: c.green('Update catalog?') }),
  )
  if (!confirmed) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  // Build ResolvedDep array for the executor
  const resolved: ResolvedDep[] = updated.map((u) => ({
    name: u.name,
    version: u.version,
    catalogName: selectedCatalog,
    existsInCatalog: true,
  }))

  // Execute update - we need to update catalog entries only
  const { packages: repoPackages } = await provider.listPackages()

  // Find all packages that use these catalog references
  const affectedPackages: string[] = []
  for (const pkg of repoPackages) {
    for (const depField of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ] as const) {
      const deps = pkg[depField]
      if (!deps) continue
      for (const depName of Object.keys(deps)) {
        if (
          toChange.includes(depName) &&
          deps[depName].startsWith('catalog:')
        ) {
          affectedPackages.push(pkg.directory)
          break
        }
      }
    }
  }

  try {
    await provider.depInstallExecutor({
      deps: resolved,
      targetPackages: [...new Set(affectedPackages)],
      dev: false,
      peer: false,
      logger: (msg) => p.log.step(msg),
    })
    p.outro(c.green('Done!'))
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

cli
  .command('catalog', 'Manage catalogs')
  .option('-l, --list', 'List all catalogs')
  .action(runCatalog)

cli.help()
cli.version(version)
cli.parse()
