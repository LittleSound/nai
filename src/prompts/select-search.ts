import process from 'node:process'
import { styleText } from 'node:util'
import { AutocompletePrompt, isCancel } from '@clack/core'
import {
  limitOptions,
  S_BAR,
  S_BAR_END,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  symbol,
} from '@clack/prompts'
import type { SearchOption } from './search.ts'

export type SelectSearchResult<T> =
  | { action: 'submit'; value: T }
  | { action: 'edit'; value: T }

export interface SelectSearchPromptOptions<T = string> {
  message: string
  options:
    | SearchOption<T>[]
    | ((this: AutocompletePrompt<SearchOption<T>>) => SearchOption<T>[])
  filter?: (search: string, option: SearchOption<T>) => boolean
  maxItems?: number
  /** Called when user presses Ctrl+Y to copy the focused item */
  onCopy?: (value: T) => void
}

/**
 * A single-select search prompt — the user picks exactly one option.
 * Enter confirms the focused item. Tab confirms with "edit" action.
 */
export async function selectSearchPrompt<T = string>(
  opts: SelectSearchPromptOptions<T>,
): Promise<SelectSearchResult<T> | symbol> {
  let editRequested = false

  const prompt = new AutocompletePrompt<SearchOption<T>>({
    options: opts.options,
    multiple: false,
    filter: opts.filter,
    render(this: AutocompletePrompt<SearchOption<T>>) {
      const input = this.userInput
      const allOptions = this.options
      const color = this.state === 'error' ? 'yellow' : 'cyan'
      const bar = styleText(color, S_BAR)

      const cursor = styleText(['inverse', 'hidden'], '_')
      const searchInput = this.isNavigating
        ? input
          ? styleText('dim', input)
          : ''
        : input
          ? this.userInputWithCursor
          : cursor

      const matchInfo =
        this.filteredOptions.length === allOptions.length
          ? ''
          : styleText(
              'dim',
              ` (${this.filteredOptions.length} match${this.filteredOptions.length === 1 ? '' : 'es'})`,
            )

      switch (this.state) {
        case 'submit': {
          const header = `${styleText('gray', S_BAR)}\n${symbol(this.state)}  ${opts.message}`
          const label =
            this.filteredOptions.find((o) => o.value === this.focusedValue)
              ?.label ?? String(this.focusedValue)
          return `${header}\n${styleText('gray', S_BAR)}  ${styleText('dim', label)}`
        }
        case 'cancel': {
          const header = `${styleText('gray', S_BAR)}\n${symbol(this.state)}  ${opts.message}`
          return `${header}\n${styleText('gray', S_BAR)}  ${styleText(['strikethrough', 'dim'], input)}`
        }
        default: {
          const header = `${styleText('gray', S_BAR)}\n${symbol(this.state)}  ${opts.message}`

          const styleOption = (option: SearchOption<T>, active: boolean) => {
            const label = option.label ?? String(option.value ?? '')
            const hint =
              option.hint && active ? styleText('dim', ` (${option.hint})`) : ''
            const radio = active
              ? styleText('green', S_RADIO_ACTIVE)
              : styleText('dim', S_RADIO_INACTIVE)
            return active
              ? `${radio} ${label}${hint}`
              : `${radio} ${styleText('dim', label)}`
          }

          const noMatches =
            this.filteredOptions.length === 0 && input
              ? [`${bar}  ${styleText('yellow', 'No matches found')}`]
              : []

          const top = [
            ...header.split('\n'),
            `${bar}  ${searchInput}${matchInfo}`,
            ...noMatches,
          ]

          const hasOptions = this.filteredOptions.length > 0
          const hints = [
            `${styleText('dim', '↑/↓')} navigate`,
            `${styleText('dim', 'Enter:')} run`,
            `${styleText('dim', 'Tab:')} edit args`,
            ...(opts.onCopy ? [`${styleText('dim', 'Ctrl+Y:')} copy`] : []),
          ]
          const bottom = [
            ...(hasOptions
              ? [`${bar}  ${hints.join(styleText('dim', ' · '))}`]
              : []),
            styleText(color, S_BAR_END),
          ]

          const list = hasOptions
            ? limitOptions({
                cursor: this.cursor,
                options: this.filteredOptions,
                style: styleOption,
                maxItems: opts.maxItems,
                output: process.stdout,
                rowPadding: top.length + bottom.length,
              })
            : []

          return [
            ...top,
            ...list.map((line: string) => `${bar}  ${line}`),
            ...bottom,
          ].join('\n')
        }
      }
    },
  })

  // Tab confirms the focused item with "edit" action
  const tabHandler = (_ch: unknown, key: { name?: string }) => {
    if (key?.name === 'tab' && prompt.focusedValue != null) {
      editRequested = true
      process.stdin.emit('keypress', '', { name: 'return' })
    }
  }
  process.stdin.prependListener('keypress', tabHandler)

  // Ctrl+Y copies the focused item's command
  const copyHandler = opts.onCopy
    ? (_ch: unknown, key: { name?: string; ctrl?: boolean }) => {
        if (key?.name === 'y' && key.ctrl && prompt.focusedValue != null) {
          opts.onCopy!(prompt.focusedValue as T)
        }
      }
    : null
  if (copyHandler) {
    process.stdin.prependListener('keypress', copyHandler)
  }

  prompt.once('finalize', () => {
    process.stdin.removeListener('keypress', tabHandler)
    if (copyHandler) {
      process.stdin.removeListener('keypress', copyHandler)
    }
  })

  const result = await prompt.prompt()
  if (isCancel(result)) return result as symbol
  const values = result as T | T[]
  const value = Array.isArray(values) ? values[0] : values
  return { action: editRequested ? 'edit' : 'submit', value }
}
