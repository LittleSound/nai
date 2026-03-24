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
import type { DepInstallOptions, Provider, RunScriptOptions } from '../type.ts'

const LOCK_FILE = 'vlt-lock.json'
const CONFIG_FILE = 'vlt.json'

/**
 * Normalize the flexible vlt workspaces format into a flat pattern list.
 * vlt.json `workspaces` accepts: string | string[] | Record<string, string[]>
 */
function getWorkspacePatterns(workspaces: unknown): string[] {
  if (typeof workspaces === 'string') return [workspaces]
  if (Array.isArray(workspaces)) return workspaces as string[]
  if (workspaces && typeof workspaces === 'object') {
    return Object.values(workspaces as Record<string, string[]>).flat()
  }
  return []
}

export function createVltProvider(cwd = process.cwd()): Provider {
  function readConfig(): Record<string, unknown> | null {
    const configPath = join(cwd, CONFIG_FILE)
    if (!existsSync(configPath)) return null
    return JSON.parse(readFileSync(configPath, 'utf8'))
  }

  return {
    name: 'vlt',
    catalogSupport: { minVersion: '1.0.0' },
    supportsPeerDependencies: true,

    checkExistence() {
      const pmInfo = detectFromPackageJson(cwd)
      if (pmInfo?.name === 'vlt') {
        return Promise.resolve({ exists: true, version: pmInfo.version })
      }
      return Promise.resolve({
        exists: existsSync(join(cwd, LOCK_FILE)),
      })
    },

    listCatalogs() {
      const catalogs: Record<string, Record<string, string>> = {}
      const config = readConfig()
      if (!config) return Promise.resolve({ catalogs })

      if (config.catalog && typeof config.catalog === 'object') {
        catalogs[''] = config.catalog as Record<string, string>
      }

      if (config.catalogs && typeof config.catalogs === 'object') {
        for (const [name, deps] of Object.entries(config.catalogs)) {
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
      }

      const config = readConfig()
      if (config?.workspaces) {
        const patterns = getWorkspacePatterns(config.workspaces)
        if (patterns.length > 0) {
          packages.push(...resolveWorkspacePackages(cwd, patterns))
        }
      }

      return Promise.resolve({ packages })
    },

    depInstallExecutor(options: DepInstallOptions) {
      const log = options.logger ?? (() => {})
      const configPath = join(cwd, CONFIG_FILE)

      // 1. Write new catalog entries to vlt.json
      const newCatalogDeps = options.deps.filter(
        (d) => d.catalogName != null && !d.existsInCatalog,
      )

      if (newCatalogDeps.length > 0) {
        const config = existsSync(configPath)
          ? JSON.parse(readFileSync(configPath, 'utf8'))
          : {}

        for (const dep of newCatalogDeps) {
          if (dep.catalogName === '') {
            if (!config.catalog) config.catalog = {}
            config.catalog[dep.name] = dep.version
          } else {
            if (!config.catalogs) config.catalogs = {}
            if (!config.catalogs[dep.catalogName!])
              config.catalogs[dep.catalogName!] = {}
            config.catalogs[dep.catalogName!][dep.name] = dep.version
          }
        }

        // Sort catalog entries
        if (config.catalog) {
          config.catalog = sortObject(config.catalog)
        }
        if (config.catalogs) {
          for (const name of Object.keys(config.catalogs)) {
            config.catalogs[name] = sortObject(config.catalogs[name])
          }
        }

        writeFileSync(
          configPath,
          `${JSON.stringify(config, null, 2)}\n`,
          'utf8',
        )
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
        writePeerDependenciesMeta(pkg, options)

        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
        log(`Writing ${pkgPath}`)
      }

      // 3. Run vlt install
      log('Running vlt install')
      execFileSync('vlt', ['install'], { cwd, stdio: 'inherit' })

      return Promise.resolve()
    },

    install() {
      execFileSync('vlt', ['install'], { cwd, stdio: 'inherit' })
      return Promise.resolve()
    },

    runScript(options: RunScriptOptions) {
      const args = ['run', options.scriptName, ...(options.args ?? [])]
      options.logger?.(`vlt ${args.join(' ')}`)
      execFileSync('vlt', args, {
        cwd: options.cwd ?? cwd,
        stdio: 'inherit',
      })
      return Promise.resolve()
    },
  }
}
