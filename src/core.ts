import { compareVersions, type ParsedPackage } from './utils.ts'
import type { Provider, ResolvedDep } from './type.ts'

export interface ExistingEntry {
  catalogName: string
  version: string
}

/** Find which catalogs already contain a specific dependency */
export function findExistingEntries(
  depName: string,
  catalogs: Record<string, Record<string, string>>,
): ExistingEntry[] {
  const entries: ExistingEntry[] = []
  for (const [catalogName, deps] of Object.entries(catalogs)) {
    if (depName in deps) {
      entries.push({ catalogName, version: deps[depName] })
    }
  }
  return entries
}

/** Resolve dependency field name from flags */
export function getDepField(
  dev: boolean,
  peer: boolean,
): 'dependencies' | 'devDependencies' | 'peerDependencies' {
  if (peer) return 'peerDependencies'
  if (dev) return 'devDependencies'
  return 'dependencies'
}

/** Build a human-readable summary of the install plan */
export function buildSummary(options: {
  providerName: string
  depType: string
  deps: ResolvedDep[]
  targetNames: string[]
}): string {
  const lines = [
    `Package manager: ${options.providerName}`,
    `Install as: ${options.depType}`,
    '',
  ]

  for (const dep of options.deps) {
    if (dep.catalogName == null) {
      lines.push(`  ${dep.name} ${dep.version} (direct)`)
    } else {
      const ref =
        dep.catalogName === '' ? 'catalog:' : `catalog:${dep.catalogName}`
      const status = dep.existsInCatalog ? 'existing' : 'new'
      lines.push(`  ${dep.name} ${dep.version} → ${ref} (${status})`)
    }
  }

  lines.push('', `Packages: ${options.targetNames.join(', ')}`)
  return lines.join('\n')
}

/**
 * Check if a provider's catalog feature is supported at the detected version.
 * Returns 'supported', 'unsupported' (PM never supports it), or 'version-too-low'.
 */
export function checkCatalogSupport(
  provider: Provider,
  version?: string,
): {
  supported: boolean
  reason?: 'unsupported' | 'version-too-low'
  minVersion?: string
} {
  if (provider.catalogSupport === false) {
    return { supported: false, reason: 'unsupported' }
  }
  if (
    version &&
    compareVersions(version, provider.catalogSupport.minVersion) < 0
  ) {
    return {
      supported: false,
      reason: 'version-too-low',
      minVersion: provider.catalogSupport.minVersion,
    }
  }
  return { supported: true }
}

/**
 * Resolve versions for a list of packages.
 * Checks existing catalogs first, then fetches from npm for new packages.
 * Catalog assignment for new packages happens later in the CLI flow.
 */
export async function resolvePackageVersions(
  packages: ParsedPackage[],
  options: {
    catalogs: Record<string, Record<string, string>>
    /** Called when existing catalog entries are found. Return chosen entry, or null to fetch latest. */
    onExistingFound: (
      depName: string,
      entries: ExistingEntry[],
    ) => Promise<ExistingEntry | null>
    /** Called to fetch latest version. Return version string (e.g. "^1.0.0"), or null on failure. */
    onFetchVersion: (depName: string) => Promise<string | null>
  },
): Promise<ResolvedDep[]> {
  const resolved: ResolvedDep[] = []

  for (const pkg of packages) {
    // 1) Version specified in command — still needs catalog assignment later
    if (pkg.version) {
      resolved.push({
        name: pkg.name,
        version: pkg.version,
        existsInCatalog: false,
      })
      continue
    }

    // 2) Check existing catalog entries across all catalogs
    const existing = findExistingEntries(pkg.name, options.catalogs)
    if (existing.length > 0) {
      const chosen = await options.onExistingFound(pkg.name, existing)
      if (chosen) {
        resolved.push({
          name: pkg.name,
          version: chosen.version,
          catalogName: chosen.catalogName,
          existsInCatalog: true,
        })
        continue
      }
    }

    // 3) Fetch latest version — still needs catalog assignment later
    const version = await options.onFetchVersion(pkg.name)
    if (version) {
      resolved.push({
        name: pkg.name,
        version,
        existsInCatalog: false,
      })
    }
  }

  return resolved
}
