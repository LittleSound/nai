import { exec } from 'node:child_process'
import process from 'node:process'
import c from 'ansis'
import { version } from '../package.json'

export function openInBrowser(url: string) {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open'
  exec(`${cmd} ${url}`)
}

export interface ParsedPackage {
  name: string
  version?: string
}

/**
 * Compare two semver version strings.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Only compares major.minor.patch, ignores pre-release/build metadata.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => v.replace(/^\D*/, '').split('.').map(Number)
  const pa = parse(a)
  const pb = parse(b)

  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return 0
}

/** Parse a package specifier like "react@^18.3.1" or "@types/node@^20" */
export function parsePackageSpec(spec: string): ParsedPackage {
  const atIndex = spec.indexOf('@', spec.startsWith('@') ? 1 : 0)
  if (atIndex <= 0) return { name: spec }
  return {
    name: spec.slice(0, atIndex),
    version: spec.slice(atIndex + 1) || undefined,
  }
}

export function getAppStartIntro(): string {
  return `${c.yellow`@rizumu/nai`} ${c.dim`v${version}`}`
}
