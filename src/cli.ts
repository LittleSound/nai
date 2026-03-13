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
import { searchPrompt, type SearchOption } from './prompts/search.ts'
import { providers } from './providers/index.ts'
import { searchNpmPackages } from './search.ts'
import { parsePackageSpec, type ParsedPackage } from './utils.ts'
import type { Provider } from './type.ts'

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

/** Interactive package search with dynamic results */
async function promptPackages(): Promise<ParsedPackage[]> {
  let searchResults: SearchOption[] = []
  let lastSearchTerm = ''
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const searchLoading = { value: false }

  const selected = guardCancel(
    await searchPrompt({
      message: 'Package names to install',
      required: true,
      options() {
        const input = (this.userInput ?? '').trim()

        if (!input) {
          lastSearchTerm = ''
          searchResults = []
          searchLoading.value = false
          if (debounceTimer) clearTimeout(debounceTimer)
          return []
        }

        const isPackageName = !input.includes(' ')
        const opts: SearchOption[] = []

        if (isPackageName) {
          opts.push({
            value: input,
            label: c.cyan(input),
            hint: 'add directly',
          })
        }

        if (input !== lastSearchTerm) {
          lastSearchTerm = input
          searchResults = []
          if (debounceTimer) clearTimeout(debounceTimer)

          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const self = this
          debounceTimer = setTimeout(async () => {
            searchLoading.value = true
            process.stdin.emit('keypress', '', { name: '' })
            try {
              const results = await searchNpmPackages(input)
              if (lastSearchTerm !== input) return

              const exactMatch = results.find((pkg) => pkg.name === input)
              searchResults = results
                .filter((pkg) => pkg.name !== input)
                .map((pkg) => ({
                  value: pkg.name,
                  label: `${pkg.name} ${c.blue(`v${pkg.version}`)}`,
                  hint: pkg.description
                    ? pkg.description.length > 60
                      ? `${pkg.description.slice(0, 57)}...`
                      : pkg.description
                    : undefined,
                }))

              const updatedOpts: SearchOption[] = []
              if (isPackageName) {
                updatedOpts.push({
                  value: input,
                  label: exactMatch
                    ? `${c.cyan(input)} ${c.blue(`v${exactMatch.version}`)}`
                    : c.cyan(input),
                  hint: 'add directly',
                })
              }
              updatedOpts.push(...searchResults)
              self.filteredOptions = updatedOpts
              process.stdin.emit('keypress', '', { name: '' })
            } catch {
              // Search failed silently — direct option still works
            } finally {
              searchLoading.value = false
            }
          }, 300)
        }

        opts.push(...searchResults)
        return opts
      },
      filter: () => true,
      loading: searchLoading,
    }),
  )

  if (debounceTimer) clearTimeout(debounceTimer)
  return (selected as string[]).map(parsePackageSpec)
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
    packages = await promptPackages()
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
        s.stop(`Resolved ${c.cyan(depName)}@${c.green(`^${meta.version}`)}`)
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

cli.help()
cli.version(version)
cli.parse()
