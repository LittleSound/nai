export interface ParsedPackage {
  name: string
  version?: string
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
