import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { RepoPackageItem } from '../type.ts'

/** Extract package metadata from a parsed package.json */
export function readPackageItem(
  pkg: Record<string, unknown>,
  directory: string,
): RepoPackageItem {
  return {
    name: (pkg.name as string) || directory,
    directory,
    description: (pkg.description as string) || '',
    dependencies: (pkg.dependencies as Record<string, string>) || {},
    devDependencies: (pkg.devDependencies as Record<string, string>) || {},
  }
}

/** Sort object keys alphabetically */
export function sortObject(
  obj: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj).toSorted(([a], [b]) => a.localeCompare(b)),
  )
}

/** Resolve workspace packages from glob patterns */
export function resolveWorkspacePackages(
  cwd: string,
  patterns: string[],
): RepoPackageItem[] {
  const packages: RepoPackageItem[] = []

  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue

    if (pattern.includes('*')) {
      const baseDir = pattern.replace(/\/?\*.*$/, '')
      const basePath = join(cwd, baseDir)
      if (!existsSync(basePath)) continue

      for (const entry of readdirSync(basePath, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const pkgPath = join(basePath, entry.name, 'package.json')
        if (!existsSync(pkgPath)) continue
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        packages.push(readPackageItem(pkg, resolve(basePath, entry.name)))
      }
    } else {
      const pkgPath = join(cwd, pattern, 'package.json')
      if (!existsSync(pkgPath)) continue
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      packages.push(readPackageItem(pkg, resolve(cwd, pattern)))
    }
  }

  return packages
}
