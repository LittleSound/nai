import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { parseDocument } from 'yaml'
import { detectFromPackageJson } from '../detect.ts'
import {
  readPackageItem,
  resolveWorkspacePackages,
  sortObject,
} from './shared.ts'
import type { DepInstallOptions, DepRemoveOptions, Provider } from '../type.ts'

const LOCK_FILE = 'yarn.lock'
const CONFIG_FILE = '.yarnrc.yml'

export function createYarnProvider(cwd = process.cwd()): Provider {
  return {
    name: 'yarn',
    catalogSupport: { minVersion: '4.10.0' },
    supportsPeerDependencies: true,

    checkExistence() {
      const pmInfo = detectFromPackageJson(cwd)
      if (pmInfo?.name === 'yarn') {
        return Promise.resolve({ exists: true, version: pmInfo.version })
      }
      return Promise.resolve({
        exists: existsSync(join(cwd, LOCK_FILE)),
      })
    },

    listCatalogs() {
      const catalogs: Record<string, Record<string, string>> = {}
      const configPath = join(cwd, CONFIG_FILE)
      if (!existsSync(configPath)) return Promise.resolve({ catalogs })

      const raw = parseDocument(readFileSync(configPath, 'utf8')).toJSON()
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
      const packages = []

      // Root package
      const rootPkgPath = join(cwd, 'package.json')
      if (existsSync(rootPkgPath)) {
        const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
        packages.push(readPackageItem(pkg, cwd))

        // Workspace packages from package.json "workspaces" field
        const patterns = pkg.workspaces as string[] | undefined
        if (patterns && patterns.length > 0) {
          packages.push(...resolveWorkspacePackages(cwd, patterns))
        }
      }

      return Promise.resolve({ packages })
    },

    depInstallExecutor(options: DepInstallOptions) {
      const log = options.logger ?? (() => {})
      const configPath = join(cwd, CONFIG_FILE)

      // 1. Write new catalog entries to .yarnrc.yml
      const newCatalogDeps = options.deps.filter(
        (d) => d.catalogName != null && !d.existsInCatalog,
      )

      if (newCatalogDeps.length > 0) {
        const content = existsSync(configPath)
          ? readFileSync(configPath, 'utf8')
          : ''
        const doc = parseDocument(content)

        for (const dep of newCatalogDeps) {
          if (dep.catalogName === '') {
            doc.setIn(['catalog', dep.name], dep.version)
          } else {
            doc.setIn(['catalogs', dep.catalogName!, dep.name], dep.version)
          }
        }

        writeFileSync(configPath, doc.toString(), 'utf8')
        log(`Writing ${CONFIG_FILE}`)
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

        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
        log(`Writing ${pkgPath}`)
      }

      // 3. Run yarn install
      log('Running yarn install')
      execFileSync('yarn', ['install'], { cwd, stdio: 'inherit' })

      return Promise.resolve()
    },

    depRemoveExecutor(options: DepRemoveOptions) {
      const log = options.logger ?? (() => {})
      const configPath = join(cwd, CONFIG_FILE)

      // 1. Remove dependencies from each target package.json
      for (const dir of options.targetPackages) {
        const pkgPath = join(dir, 'package.json')
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        let modified = false

        for (const depName of options.packageNames) {
          for (const depField of [
            'dependencies',
            'devDependencies',
            'peerDependencies',
          ] as const) {
            if (pkg[depField] && depName in pkg[depField]) {
              delete pkg[depField][depName]
              modified = true
            }
          }
        }

        if (modified) {
          writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
          log(`Updating ${pkgPath}`)
        }
      }

      // 2. Clean up unused catalog entries if requested
      if (options.cleanCatalog && existsSync(configPath)) {
        const content = readFileSync(configPath, 'utf8')
        const doc = parseDocument(content)
        let modified = false

        for (const depName of options.packageNames) {
          // Remove from default catalog
          if (doc.hasIn(['catalog', depName])) {
            doc.deleteIn(['catalog', depName])
            modified = true
          }
          // Remove from named catalogs
          const raw = doc.toJSON()
          if (raw?.catalogs && typeof raw.catalogs === 'object') {
            for (const catalogName of Object.keys(raw.catalogs)) {
              if (doc.hasIn(['catalogs', catalogName, depName])) {
                doc.deleteIn(['catalogs', catalogName, depName])
                modified = true
              }
            }
          }
        }

        if (modified) {
          writeFileSync(configPath, doc.toString(), 'utf8')
          log(`Cleaning catalog entries in ${CONFIG_FILE}`)
        }
      }

      // 3. Run yarn install to update lockfile
      log('Running yarn install')
      execFileSync('yarn', ['install'], { cwd, stdio: 'inherit' })

      return Promise.resolve()
    },
  }
}
