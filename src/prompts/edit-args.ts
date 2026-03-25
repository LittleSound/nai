import process from 'node:process'
import { styleText } from 'node:util'
import { isCancel, TextPrompt } from '@clack/core'
import { S_BAR, S_BAR_END, symbol } from '@clack/prompts'

/**
 * A text input prompt with a non-editable command prefix.
 * The user can only append extra arguments after the prefix.
 */
export async function editArgsPrompt(opts: {
  message: string
  prefix: string
  /** Called when user presses Ctrl+Y to copy the full command */
  onCopy?: (fullCommand: string) => void
}): Promise<string | symbol> {
  const prompt = new TextPrompt({
    render(this: TextPrompt) {
      const color = this.state === 'error' ? 'yellow' : 'cyan'
      const bar = styleText(color, S_BAR)

      const cursor = styleText(['inverse', 'hidden'], '_')
      const input = this.userInput
      const display = input ? this.userInputWithCursor : cursor

      switch (this.state) {
        case 'submit': {
          const header = `${styleText('gray', S_BAR)}\n${symbol(this.state)}  ${opts.message}`
          const full = `${opts.prefix}${this.value ?? ''}`
          return `${header}\n${styleText('gray', S_BAR)}  ${styleText('dim', full)}`
        }
        case 'cancel': {
          const header = `${styleText('gray', S_BAR)}\n${symbol(this.state)}  ${opts.message}`
          return `${header}\n${styleText('gray', S_BAR)}  ${styleText(['strikethrough', 'dim'], opts.prefix + input)}`
        }
        default: {
          const header = `${styleText('gray', S_BAR)}\n${symbol(this.state)}  ${opts.message}`
          const hintParts = [
            `${styleText('dim', 'Enter:')} run`,
            `${styleText('dim', 'Esc:')} cancel`,
            ...(opts.onCopy ? [`${styleText('dim', 'Ctrl+Y:')} copy`] : []),
          ]
          return [
            ...header.split('\n'),
            `${bar}  ${styleText('dim', opts.prefix)}${display}`,
            `${bar}  ${hintParts.join(styleText('dim', ' · '))}`,
            styleText(color, S_BAR_END),
          ].join('\n')
        }
      }
    },
  })

  // Ctrl+Y copies the full command (prefix + current input)
  const copyHandler = opts.onCopy
    ? (_ch: unknown, key: { name?: string; ctrl?: boolean }) => {
        if (key?.name === 'y' && key.ctrl) {
          const input = (prompt.userInput ?? '').trim()
          const full =
            input.length > 0 ? `${opts.prefix}${input}` : opts.prefix.trimEnd()
          opts.onCopy!(full)
        }
      }
    : null
  if (copyHandler) {
    process.stdin.prependListener('keypress', copyHandler)
  }
  prompt.once('finalize', () => {
    if (copyHandler) {
      process.stdin.removeListener('keypress', copyHandler)
    }
  })

  const result = await prompt.prompt()
  if (isCancel(result)) return result as symbol
  return (result as string) ?? ''
}
