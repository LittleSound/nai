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
  writePeerDependenciesMeta,
} from './shared.ts'
import type { DepInstallOptions, Provider } from '../type.ts'

const LOCK_FILE = 'pnpm-lock.yaml'
const WORKSPACE_FILE = 'pnpm-workspace.yaml'

export function createPnpmProvider(cwd = process.cwd()): Provider {
  return {
    name: 'pnpm',
    catalogSupport: { minVersion: '9.5.0' },
    supportsPeerDependencies: true,

    checkExistence() {
      const pmInfo = detectFromPackageJson(cwd)
      if (pmInfo?.name === 'pnpm') {
        return Promise.resolve({ exists: true, version: pmInfo.version })
      }
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
      const packages = []

      // Root package
      const rootPkgPath = join(cwd, 'package.json')
      if (existsSync(rootPkgPath)) {
        const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
        packages.push(readPackageItem(pkg, cwd))
      }

      // Workspace packages from pnpm-workspace.yaml
      const workspacePath = join(cwd, WORKSPACE_FILE)
      if (existsSync(workspacePath)) {
        const raw = parseDocument(readFileSync(workspacePath, 'utf8')).toJSON()
        const patterns = raw?.packages as string[] | undefined
        if (patterns && patterns.length > 0) {
          packages.push(...resolveWorkspacePackages(cwd, patterns))
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
        writePeerDependenciesMeta(pkg, options)

        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
        log(`Writing ${pkgPath}`)
      }

      // 3. Run pnpm install
      log('Running pnpm install')
      execFileSync('pnpm', ['install'], { cwd, stdio: 'inherit' })

      return Promise.resolve()
    },

    install() {
      execFileSync('pnpm', ['install'], { cwd, stdio: 'inherit' })
      return Promise.resolve()
    },
  }
}
