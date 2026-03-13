import { getLatestVersion } from 'fast-npm-meta'

export interface OutdatedInfo {
  name: string
  current: string
  latest: string
  wanted: string
  dependent: string
}

/**
 * Fetch all available versions for a package.
 */
export async function getPackageVersions(
  packageName: string,
): Promise<string[]> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch versions: ${response.statusText}`)
  }

  const data = (await response.json()) as {
    versions?: Record<string, unknown>
    error?: string
  }

  if (data.error) {
    throw new Error(`Package not found: ${packageName}`)
  }

  return Object.keys(data.versions ?? {}).sort().reverse()
}

/**
 * Check for outdated packages by comparing current versions with latest.
 */
export async function checkOutdated(
  deps: Record<string, string>,
  options?: { logger?: (msg: string) => void },
): Promise<OutdatedInfo[]> {
  const log = options?.logger ?? (() => {})
  const outdated: OutdatedInfo[] = []

  for (const [name, currentSpec] of Object.entries(deps)) {
    // Skip catalog: references and workspace: references
    if (currentSpec.startsWith('catalog:') || currentSpec.startsWith('workspace:')) {
      continue
    }

    // Extract version from spec (remove ^, ~, etc.)
    const currentVersion = currentSpec.replace(/^[\^~>=<]+/, '')

    try {
      const meta = await getLatestVersion(name)
      if (!meta.version) continue

      const latestVersion = meta.version
      // For simple version comparison, check if current is different from latest
      if (currentVersion !== latestVersion && !currentVersion.includes('*')) {
        outdated.push({
          name,
          current: currentSpec,
          latest: `^${latestVersion}`,
          wanted: `^${latestVersion}`,
          dependent: 'root',
        })
        log(`Checking ${name}: ${currentSpec} -> ^${latestVersion}`)
      }
    } catch {
      // Skip packages that can't be fetched
    }
  }

  return outdated
}
