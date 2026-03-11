import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PackageManagerInfo {
  name: string
  version?: string
}

/** Parse the `packageManager` field from package.json (Corepack format: "name@version+hash") */
export function parsePackageManagerField(
  value: string,
): PackageManagerInfo | null {
  const match = value.match(/^([a-z]+)@(.+)$/)
  if (!match) return null

  const name = match[1]
  // Strip hash suffix (e.g. "10.31.0+sha512.abc..." → "10.31.0")
  const version = match[2].replace(/\+.*$/, '') || undefined

  return { name, version }
}

let cache: { cwd: string; result: PackageManagerInfo | null } | undefined

/**
 * Detect package manager from package.json fields.
 * Checks `packageManager` first, then `devEngines.packageManager`.
 * Result is cached per cwd to avoid redundant reads across providers.
 */
export function detectFromPackageJson(cwd: string): PackageManagerInfo | null {
  if (cache?.cwd === cwd) return cache.result

  const result = readPackageManagerInfo(cwd)
  cache = { cwd, result }
  return result
}

function readPackageManagerInfo(cwd: string): PackageManagerInfo | null {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return null

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

  // 1. Corepack `packageManager` field
  if (typeof pkg.packageManager === 'string') {
    const result = parsePackageManagerField(pkg.packageManager)
    if (result) return result
  }

  // 2. `devEngines.packageManager` field
  const devEnginesPM = pkg.devEngines?.packageManager
  if (devEnginesPM && typeof devEnginesPM === 'object') {
    const name = devEnginesPM.name as string | undefined
    if (name) {
      return {
        name,
        version: (devEnginesPM.version as string | undefined) || undefined,
      }
    }
  }

  return null
}

/** Reset the cache (for testing) */
export function resetDetectCache(): void {
  cache = undefined
}
