import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { parseDocument } from 'yaml'
import type { DepInstallOptions, Provider, RepoPackageItem } from '../type.ts'

const LOCK_FILE = 'pnpm-lock.yaml'
const WORKSPACE_FILE = 'pnpm-workspace.yaml'

export function createPnpmProvider(cwd = process.cwd()): Provider {
  return {
    name: 'pnpm',
    supportsPeerDependencies: true,

    checkExistence() {
      return Promise.resolve({
        exists: existsSync(join(cwd, LOCK_FILE)),
      })
    },

    listCatalogs() {
      const catalogs: Record<string, Record<string, string>> = {}
      const workspacePath = join(cwd, WORKSPACE_FILE)
      if (!existsSync(workspacePath)) return Promise.resolve({ catalogs })

      const raw = parseDocument(readFileSync(workspacePath, 'utf8')).toJSON()
      if (!raw || typeof raw !== 'object') return Promise.resolve({ catalogs })

      // Default catalog (singular `catalog` key)
      if (raw.catalog && typeof raw.catalog === 'object') {
        catalogs[''] = raw.catalog as Record<string, string>
      }

      // Named catalogs (plural `catalogs` key)
      if (raw.catalogs && typeof raw.catalogs === 'object') {
        for (const [name, deps] of Object.entries(raw.catalogs)) {
          if (deps && typeof deps === 'object') {
            catalogs[name] = deps as Record<string, string>
          }
        }
      }

      return Promise.resolve({ catalogs })
    },

    listPackages() {
      const packages: RepoPackageItem[] = []

      // Root package
      const rootPkgPath = join(cwd, 'package.json')
      if (existsSync(rootPkgPath)) {
        const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
        packages.push(readPackageItem(pkg, cwd))
      }

      // Workspace packages from pnpm-workspace.yaml
      const workspacePath = join(cwd, WORKSPACE_FILE)
      if (!existsSync(workspacePath)) return Promise.resolve({ packages })

      const raw = parseDocument(readFileSync(workspacePath, 'utf8')).toJSON()
      const patterns = raw?.packages as string[] | undefined
      if (!patterns || patterns.length === 0)
        return Promise.resolve({ packages })

      for (const pattern of patterns) {
        if (pattern.startsWith('!')) continue

        if (pattern.includes('*')) {
          // Glob pattern: resolve "dir/*" by listing directories
          const baseDir = pattern.replace(/\/?\*.*$/, '')
          const basePath = join(cwd, baseDir)
          if (!existsSync(basePath)) continue

          for (const entry of readdirSync(basePath, {
            withFileTypes: true,
          })) {
            if (!entry.isDirectory()) continue
            const pkgPath = join(basePath, entry.name, 'package.json')
            if (!existsSync(pkgPath)) continue
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
            packages.push(readPackageItem(pkg, resolve(basePath, entry.name)))
          }
        } else {
          // Direct directory reference
          const pkgPath = join(cwd, pattern, 'package.json')
          if (!existsSync(pkgPath)) continue
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
          packages.push(readPackageItem(pkg, resolve(cwd, pattern)))
        }
      }

      return Promise.resolve({ packages })
    },

    depInstallExecutor(options: DepInstallOptions) {
      const log = options.logger ?? (() => {})
      const workspacePath = join(cwd, WORKSPACE_FILE)

      // 1. Write new catalog entries to pnpm-workspace.yaml
      const newCatalogDeps = options.deps.filter(
        (d) => d.catalogName != null && !d.existsInCatalog,
      )

      if (newCatalogDeps.length > 0) {
        const content = existsSync(workspacePath)
          ? readFileSync(workspacePath, 'utf8')
          : ''
        const doc = parseDocument(content)

        for (const dep of newCatalogDeps) {
          if (dep.catalogName === '') {
            doc.setIn(['catalog', dep.name], dep.version)
          } else {
            doc.setIn(['catalogs', dep.catalogName!, dep.name], dep.version)
          }
        }

        writeFileSync(workspacePath, doc.toString(), 'utf8')
        log(`Writing ${WORKSPACE_FILE}`)
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

        // Sort deps alphabetically
        pkg[depField] = sortObject(pkg[depField])

        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
        log(`Writing ${pkgPath}`)
      }

      // 3. Run pnpm install
      log('Running pnpm install')
      execFileSync('pnpm', ['install'], { cwd, stdio: 'inherit' })

      return Promise.resolve()
    },
  }
}

function readPackageItem(
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

function sortObject(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj).toSorted(([a], [b]) => a.localeCompare(b)),
  )
}
