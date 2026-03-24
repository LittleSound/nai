import c from 'ansis'

/** Formatted text block listing all available CLI commands */
export function commandOverviewText(): string {
  return [
    '',
    String(c.bold('Available commands')),
    '',
    `  ${c.green('nai')}   ${c.dim('-')}  install packages (interactive)`,
    `  ${c.green('nar')}   ${c.dim('-')}  run scripts (interactive)`,
  ].join('\n')
}
