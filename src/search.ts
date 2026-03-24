import process from 'node:process'
import c from 'ansis'
import { highlightKeywords } from './highlight.ts'
import { searchPrompt, type SearchOption } from './prompts/search.ts'
import { openInBrowser, parsePackageSpec, type ParsedPackage } from './utils.ts'

export interface NpmSearchResult {
  name: string
  description: string
  version: string
}

interface NpmRegistryResponse {
  objects: { package: NpmSearchResult }[]
}

/**
 * Search the npm registry for packages matching a query.
 * Returns up to `size` results (default 20).
 */
export async function searchNpmPackages(
  query: string,
  size = 20,
): Promise<NpmSearchResult[]> {
  const url = `https://registry.npmjs.com/-/v1/search?text=${encodeURIComponent(query)}&size=${size}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as NpmRegistryResponse
  return data.objects.map((o) => o.package)
}

/** Cache of package versions collected during search, keyed by package name. */
const versionCache = new Map<string, string>()

/** Look up a cached version from a previous search. */
export function getCachedVersion(name: string): string | undefined {
  return versionCache.get(name)
}

/** Interactive package search with dynamic npm results. Returns 'install' for bare install, null on cancel. */
export async function promptPackages(): Promise<
  ParsedPackage[] | 'install' | null
> {
  let searchResults: SearchOption[] = []
  let lastSearchTerm = ''
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const searchLoading = { value: false }

  const selected = await searchPrompt({
    message: 'Package names to install',
    required: true,
    placeholder: 'or Enter to install all dependencies',
    onOpen(name) {
      openInBrowser(`https://www.npmjs.com/package/${encodeURIComponent(name)}`)
    },
    options() {
      const input = (this.userInput ?? '').trim()

      if (!input) {
        lastSearchTerm = ''
        searchResults = []
        searchLoading.value = false
        if (debounceTimer) clearTimeout(debounceTimer)
        return []
      }

      const isPackageName = !input.includes(' ')
      const opts: SearchOption[] = []

      if (isPackageName) {
        opts.push({
          value: input,
          label: c.cyan(input),
          hint: 'add directly',
        })
      }

      if (input !== lastSearchTerm) {
        lastSearchTerm = input
        searchResults = []
        if (debounceTimer) clearTimeout(debounceTimer)

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this
        debounceTimer = setTimeout(async () => {
          searchLoading.value = true
          process.stdin.emit('keypress', '', { name: '' })
          try {
            const results = await searchNpmPackages(input)
            if (lastSearchTerm !== input) return

            for (const pkg of results) versionCache.set(pkg.name, pkg.version)
            const exactMatch = results.find((pkg) => pkg.name === input)
            searchResults = results
              .filter((pkg) => pkg.name !== input)
              .map((pkg) => {
                const desc = pkg.description
                  ? pkg.description.length > 60
                    ? `${pkg.description.slice(0, 57)}...`
                    : pkg.description
                  : undefined
                return {
                  value: pkg.name,
                  label: `${highlightKeywords(pkg.name, input)} ${c.blue(`v${pkg.version}`)}`,
                  hint: desc ? highlightKeywords(desc, input) : undefined,
                }
              })

            const updatedOpts: SearchOption[] = []
            if (isPackageName) {
              updatedOpts.push({
                value: input,
                label: exactMatch
                  ? `${c.cyan(input)} ${c.blue(`v${exactMatch.version}`)}`
                  : c.cyan(input),
                hint: 'add directly',
              })
            }
            updatedOpts.push(...searchResults)
            self.filteredOptions = updatedOpts
            self.focusedValue = updatedOpts[0]?.value
            process.stdin.emit('keypress', '', { name: '' })
          } catch {
            // Search failed silently — direct option still works
          } finally {
            searchLoading.value = false
          }
        }, 300)
      }

      opts.push(...searchResults)
      return opts
    },
    filter: () => true,
    loading: searchLoading,
  })

  if (debounceTimer) clearTimeout(debounceTimer)
  if (typeof selected === 'symbol') return null
  const names = selected as string[]
  if (names.length === 0) return 'install'
  return names.map(parsePackageSpec)
}
