#!/usr/bin/env node
import process from 'node:process'
import * as p from '@clack/prompts'
import cac from 'cac'
import { getLatestVersion } from 'fast-npm-meta'
import { providers } from './providers/index.ts'
import { parsePackageSpec, type ParsedPackage } from './utils.ts'
import type { Provider, ResolvedDep } from './type.ts'

/** Auto-detect the first available provider */
async function detectProvider(): Promise<Provider | undefined> {
  for (const provider of providers) {
    const { exists } = await provider.checkExistence()
    if (exists) return provider
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
  options: { dev?: boolean; peer?: boolean; catalog?: string },
) {
  p.intro('nip')

  // --- Detect or select package manager ---
  let provider: Provider
  const detected = await detectProvider()
  if (detected) {
    provider = detected
    p.log.info(`Detected: ${provider.name}`)
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
    const input = guardCancel(
      await p.text({
        message: 'Package names to install (space-separated)',
        placeholder: 'e.g. react vue@^3.5 lodash',
        validate: (v) => {
          if (!v?.trim()) return 'Please enter at least one package name.'
        },
      }),
    )
    packages = input.trim().split(/\s+/).map(parsePackageSpec)
  }

  // --- Get existing catalogs & select target ---
  const { catalogs } = await provider.listCatalogs()
  const catalogNames = Object.keys(catalogs)

  let targetCatalog: string | null
  if (options.catalog == null) {
    const catalogOptions = [
      ...catalogNames.map((name) => ({
        value: name,
        label: name || '(default)',
        hint: `${Object.keys(catalogs[name]).length} deps`,
      })),
      { value: '__new__', label: '+ Create new catalog' },
      { value: '__skip__', label: 'Skip (no catalog)' },
    ]

    const selected = guardCancel(
      await p.select({
        message: 'Select a catalog',
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

  // --- Resolve version for each package ---
  const resolved: ResolvedDep[] = []

  for (const pkg of packages) {
    // 1) Version specified in command
    if (pkg.version) {
      resolved.push({
        name: pkg.name,
        version: pkg.version,
        catalogName: targetCatalog ?? undefined,
        existsInCatalog: false,
      })
      continue
    }

    // 2) Check existing catalog entries (only in catalog mode)
    if (targetCatalog != null) {
      const existingEntries: { catalogName: string; version: string }[] = []
      for (const [catName, deps] of Object.entries(catalogs)) {
        if (pkg.name in deps) {
          existingEntries.push({
            catalogName: catName,
            version: deps[pkg.name],
          })
        }
      }

      if (existingEntries.length > 0) {
        const existingOptions = [
          ...existingEntries.map((e) => ({
            value: `${e.catalogName}\0${e.version}`,
            label: `Use: ${e.catalogName || '(default)'} → ${e.version}`,
          })),
          { value: '', label: 'Fetch latest from npm' },
        ]
        const selected = guardCancel(
          await p.select({
            message: `"${pkg.name}" found in existing catalog(s)`,
            options: existingOptions,
          }),
        )

        if (selected) {
          const [catalogName, version] = selected.split('\0')
          resolved.push({
            name: pkg.name,
            version,
            catalogName,
            existsInCatalog: true,
          })
          continue
        }
      }
    }

    // 3) Fetch latest version from npm
    const s = p.spinner()
    s.start(`Fetching latest version of ${pkg.name}`)
    try {
      const meta = await getLatestVersion(pkg.name)
      if (!meta.version) {
        s.stop(`Package "${pkg.name}" not found`)
        p.log.error(`Could not resolve version for "${pkg.name}". Skipping.`)
        continue
      }
      s.stop(`${pkg.name} → ^${meta.version}`)
      resolved.push({
        name: pkg.name,
        version: `^${meta.version}`,
        catalogName: targetCatalog ?? undefined,
        existsInCatalog: false,
      })
    } catch (error) {
      s.stop(`Failed to fetch ${pkg.name}`)
      p.log.error(
        `Could not fetch "${pkg.name}": ${error instanceof Error ? error.message : error}`,
      )
    }
  }

  if (resolved.length === 0) {
    p.log.error('No packages to install.')
    p.outro('Exiting')
    return
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

  if (!dev && !peer) {
    const depTypeChoice = guardCancel(
      await p.select({
        message: 'Install as',
        options: [
          { value: 'dependencies', label: 'dependencies' },
          { value: 'devDependencies', label: 'devDependencies' },
          {
            value: 'peerDependencies',
            label: 'peerDependencies',
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

  const depType = peer
    ? 'peerDependencies'
    : dev
      ? 'devDependencies'
      : 'dependencies'

  const summaryLines: string[] = []
  for (const dep of resolved) {
    if (dep.catalogName == null) {
      summaryLines.push(`  ${dep.name} ${dep.version} (direct)`)
    } else {
      const ref =
        dep.catalogName === '' ? 'catalog:' : `catalog:${dep.catalogName}`
      const status = dep.existsInCatalog ? 'existing' : 'new'
      summaryLines.push(`  ${dep.name} ${dep.version} → ${ref} (${status})`)
    }
  }

  const targetNames = targetDirs.map((d) => {
    const pkg = repoPackages.find((rp) => rp.directory === d)
    return pkg?.name || d
  })

  const summary = [
    `Package manager: ${provider.name}`,
    `Install as: ${depType}`,
    '',
    ...summaryLines,
    '',
    `Packages: ${targetNames.join(', ')}`,
  ].join('\n')

  p.note(summary, 'Summary')

  const confirmed = guardCancel(await p.confirm({ message: 'Looks good?' }))
  if (!confirmed) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  // --- Execute ---
  const s = p.spinner()
  s.start('Installing dependencies...')
  try {
    await provider.depInstallExecutor({
      deps: resolved,
      targetPackages: targetDirs,
      dev,
      peer,
    })
    s.stop('Dependencies installed')
  } catch (error) {
    s.stop('Installation failed')
    p.log.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  p.outro('Done!')
}

// --- CLI Setup ---
const cli = cac('nip')

cli
  .command('[...names]', 'Install packages with catalog support')
  .option('-D, --dev', 'Install as dev dependency')
  .option('--peer', 'Install as peer dependency')
  .option('-C, --catalog <name>', 'Specify catalog name')
  .action(run)

cli.help()
cli.version('0.0.0')
cli.parse()
