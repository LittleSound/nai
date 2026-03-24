import c from 'ansis'

/** Apply highlight styling to characters at the given positions */
export function highlightPositions(
  text: string,
  positions: Set<number>,
  offset = 0,
): string {
  let result = ''
  for (const [i, ch] of [...text].entries()) {
    result += positions.has(offset + i) ? c.underline.cyan(ch) : ch
  }
  return result
}

/**
 * Highlight all occurrences of search keywords within text.
 * Splits the query by whitespace into keywords and highlights
 * each case-insensitive match in the text.
 */
export function highlightKeywords(text: string, query: string): string {
  if (!query) return text

  const positions = matchKeywordPositions(text, query)
  if (positions.size === 0) return text

  return highlightPositions(text, positions)
}

/** Find character positions in text that match any keyword from the query */
export function matchKeywordPositions(
  text: string,
  query: string,
): Set<number> {
  const positions = new Set<number>()
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 0)
  const lower = text.toLowerCase()

  for (const kw of keywords) {
    let start = 0
    while (start < lower.length) {
      const idx = lower.indexOf(kw, start)
      if (idx === -1) break
      for (let i = idx; i < idx + kw.length; i++) {
        positions.add(i)
      }
      start = idx + 1
    }
  }

  return positions
}
