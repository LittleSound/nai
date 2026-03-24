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

export interface SelectSearchPromptOptions<T = string> {
  message: string
  options:
    | SearchOption<T>[]
    | ((this: AutocompletePrompt<SearchOption<T>>) => SearchOption<T>[])
  filter?: (search: string, option: SearchOption<T>) => boolean
  maxItems?: number
}

/**
 * A single-select search prompt — the user picks exactly one option.
 * Enter immediately confirms the focused item.
 */
export async function selectSearchPrompt<T = string>(
  opts: SelectSearchPromptOptions<T>,
): Promise<T | symbol> {
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

  const result = await prompt.prompt()
  if (isCancel(result)) return result as symbol
  const values = result as T | T[]
  return Array.isArray(values) ? values[0] : values
}
