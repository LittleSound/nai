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

const LOCK_FILE = 'package-lock.json'

export function createNpmProvider(cwd = process.cwd()): Provider {
  return {
    name: 'npm',
    catalogSupport: false,
    supportsPeerDependencies: true,

    checkExistence() {
      const pmInfo = detectFromPackageJson(cwd)
      if (pmInfo?.name === 'npm') {
        return Promise.resolve({ exists: true, version: pmInfo.version })
      }
      return Promise.resolve({
        exists: existsSync(join(cwd, LOCK_FILE)),
      })
    },

    listCatalogs() {
      return Promise.resolve({ catalogs: {} })
    },

    listPackages() {
      const packages = []

      const rootPkgPath = join(cwd, 'package.json')
      if (existsSync(rootPkgPath)) {
        const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
        packages.push(readPackageItem(pkg, cwd))

        const workspaces = pkg.workspaces as string[] | undefined
        if (Array.isArray(workspaces) && workspaces.length > 0) {
          packages.push(...resolveWorkspacePackages(cwd, workspaces))
        }
      }

      return Promise.resolve({ packages })
    },

    depInstallExecutor(options: DepInstallOptions) {
      const log = options.logger ?? (() => {})

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
          pkg[depField][dep.name] = dep.version
        }

        pkg[depField] = sortObject(pkg[depField])
        writePeerDependenciesMeta(pkg, options)

        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
        log(`Writing ${pkgPath}`)
      }

      log('Running npm install')
      execFileSync('npm', ['install'], { cwd, stdio: 'inherit' })

      return Promise.resolve()
    },

    install() {
      execFileSync('npm', ['install'], { cwd, stdio: 'inherit' })
      return Promise.resolve()
    },

    runScript(options: RunScriptOptions) {
      const extra = options.args ?? []
      const args = [
        'run',
        options.scriptName,
        ...(extra.length > 0 ? ['--', ...extra] : []),
      ]
      options.logger?.(`npm ${args.join(' ')}`)
      execFileSync('npm', args, {
        cwd: options.cwd ?? cwd,
        stdio: 'inherit',
      })
      return Promise.resolve()
    },
  }
}
