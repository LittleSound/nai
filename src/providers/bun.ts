import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { detectFromPackageJson } from '../detect.ts'
import {
  readPackageItem,
  resolveWorkspacePackages,
  sortObject,
  writePeerDependenciesMeta,
} from './shared.ts'
import type { DepInstallOptions, Provider } from '../type.ts'

const LOCK_FILES = ['bun.lock', 'bun.lockb']

/**
 * Read the root package.json and determine where catalogs live.
 * Bun supports catalogs in two locations:
 * 1. Inside workspaces object: { workspaces: { catalog, catalogs } }
 * 2. At top level: { catalog, catalogs }
 * Returns null when no workspaces is defined (no existing catalogs to read).
 */
function readCatalogSource(
  pkg: Record<string, unknown>,
): Record<string, unknown> | null {
  const ws = pkg.workspaces
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws)) return ws as Record<string, unknown>
  return pkg
}

/**
 * Get or create the catalog target for writing new catalog entries.
 * When no workspaces exists, creates a minimal workspaces object
 * so bun can resolve catalog: references.
 */
function getOrCreateCatalogTarget(
  pkg: Record<string, unknown>,
): Record<string, unknown> {
  const ws = pkg.workspaces
  if (ws && typeof ws === 'object') {
    return Array.isArray(ws) ? pkg : (ws as Record<string, unknown>)
  }
  // Create minimal workspaces object for catalog support
  pkg.workspaces = {}
  return pkg.workspaces as Record<string, unknown>
}

/** Extract workspace patterns from either array or object format */
function getWorkspacePatterns(
  pkg: Record<string, unknown>,
): string[] | undefined {
  const ws = pkg.workspaces
  if (Array.isArray(ws)) return ws as string[]
  if (ws && typeof ws === 'object') {
    const patterns = (ws as Record<string, unknown>).packages
    if (Array.isArray(patterns)) return patterns as string[]
  }
}

export function createBunProvider(cwd = process.cwd()): Provider {
  return {
    name: 'bun',
    catalogSupport: { minVersion: '1.3.0' },
    supportsPeerDependencies: true,

    checkExistence() {
      const pmInfo = detectFromPackageJson(cwd)
      if (pmInfo?.name === 'bun') {
        return Promise.resolve({ exists: true, version: pmInfo.version })
      }
      return Promise.resolve({
        exists: LOCK_FILES.some((f) => existsSync(join(cwd, f))),
      })
    },

    listCatalogs() {
      const catalogs: Record<string, Record<string, string>> = {}
      const rootPkgPath = join(cwd, 'package.json')
      if (!existsSync(rootPkgPath)) return Promise.resolve({ catalogs })

      const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
      const source = readCatalogSource(pkg)

      // Bun catalogs only work within workspaces
      if (!source) return Promise.resolve({ catalogs })

      // Default catalog (singular `catalog` key)
      if (source.catalog && typeof source.catalog === 'object') {
        catalogs[''] = source.catalog as Record<string, string>
      }

      // Named catalogs (plural `catalogs` key)
      if (source.catalogs && typeof source.catalogs === 'object') {
        for (const [name, deps] of Object.entries(source.catalogs)) {
          if (deps && typeof deps === 'object') {
            catalogs[name] = deps as Record<string, string>
          }
        }
      }

      return Promise.resolve({ catalogs })
    },

    listPackages() {
      const packages = []

      const rootPkgPath = join(cwd, 'package.json')
      if (existsSync(rootPkgPath)) {
        const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
        packages.push(readPackageItem(pkg, cwd))

        const patterns = getWorkspacePatterns(pkg)
        if (patterns && patterns.length > 0) {
          packages.push(...resolveWorkspacePackages(cwd, patterns))
        }
      }

      return Promise.resolve({ packages })
    },

    depInstallExecutor(options: DepInstallOptions) {
      const log = options.logger ?? (() => {})
      const rootPkgPath = join(cwd, 'package.json')

      // 1. Write new catalog entries to root package.json
      const newCatalogDeps = options.deps.filter(
        (d) => d.catalogName != null && !d.existsInCatalog,
      )

      if (newCatalogDeps.length > 0) {
        const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
        const target = getOrCreateCatalogTarget(rootPkg)

        for (const dep of newCatalogDeps) {
          if (dep.catalogName === '') {
            if (!target.catalog) target.catalog = {}
            ;(target.catalog as Record<string, string>)[dep.name] = dep.version
          } else {
            if (!target.catalogs) target.catalogs = {}
            const catalogs = target.catalogs as Record<
              string,
              Record<string, string>
            >
            if (!catalogs[dep.catalogName!]) catalogs[dep.catalogName!] = {}
            catalogs[dep.catalogName!][dep.name] = dep.version
          }
        }

        // Sort catalog entries
        if (target.catalog) {
          target.catalog = sortObject(target.catalog as Record<string, string>)
        }
        if (target.catalogs) {
          const catalogs = target.catalogs as Record<
            string,
            Record<string, string>
          >
          for (const name of Object.keys(catalogs)) {
            catalogs[name] = sortObject(catalogs[name])
          }
        }

        writeFileSync(
          rootPkgPath,
          `${JSON.stringify(rootPkg, null, 2)}\n`,
          'utf8',
        )
        log('Writing catalogs to package.json')
      }

      // 2. Update package.json for each target package
      const depField = options.peer
        ? 'peerDependencies'
        : options.dev
          ? 'devDependencies'
          : 'dependencies'

      for (const dir of options.targetPackages) {
        const pkgPath = join(dir, 'package.json')
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

        if (!pkg[depField]) pkg[depField] = {}

        for (const dep of options.deps) {
          pkg[depField][dep.name] =
            dep.catalogName == null
              ? dep.version
              : dep.catalogName === ''
                ? 'catalog:'
                : `catalog:${dep.catalogName}`
        }

        pkg[depField] = sortObject(pkg[depField])
        writePeerDependenciesMeta(pkg, options)

        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
        log(`Writing ${pkgPath}`)
      }

      // 3. Run bun install
      log('Running bun install')
      execFileSync('bun', ['install'], { cwd, stdio: 'inherit' })

      return Promise.resolve()
    },

    install() {
      execFileSync('bun', ['install'], { cwd, stdio: 'inherit' })
      return Promise.resolve()
    },
  }
}
