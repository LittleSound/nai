import process from 'node:process'
import { styleText } from 'node:util'
import { AutocompletePrompt, isCancel } from '@clack/core'
import {
  limitOptions,
  S_BAR,
  S_BAR_END,
  S_CHECKBOX_INACTIVE,
  S_CHECKBOX_SELECTED,
  symbol,
} from '@clack/prompts'

export interface SearchOption<T = string> {
  value: T
  label: string
  hint?: string
  disabled?: boolean
}

export interface SearchPromptOptions<T = string> {
  message: string
  options:
    | SearchOption<T>[]
    | ((this: AutocompletePrompt<SearchOption<T>>) => SearchOption<T>[])
  filter?: (search: string, option: SearchOption<T>) => boolean
  required?: boolean
  maxItems?: number
  /**
   * Auto-select the focused item when Enter is pressed with nothing selected.
   * @default true
   */
  autoSelectOnEnter?: boolean
  /** Mutable ref for showing a loading spinner next to the search input. */
  loading?: { value: boolean }
}

/**
 * A search-capable multiselect prompt built on @clack/core.
 * Provides dynamic search-as-you-type with full render control.
 */
export async function searchPrompt<T = string>(
  opts: SearchPromptOptions<T>,
): Promise<T[] | symbol> {
  const SPINNER = ['◒', '◐', '◓', '◑']
  let spinnerFrame = 0
  let spinnerTimer: ReturnType<typeof setInterval> | null = null

  const prompt = new AutocompletePrompt<SearchOption<T>>({
    options: opts.options,
    multiple: true,
    filter: opts.filter,
    validate: () => {
      if (opts.required && prompt.selectedValues.length === 0)
        return 'Please select at least one item'
    },
    render(this: AutocompletePrompt<SearchOption<T>>) {
      const input = this.userInput
      const allOptions = this.options
      const color = this.state === 'error' ? 'yellow' : 'cyan'
      const bar = styleText(color, S_BAR)

      // --- Input display ---
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

      const selectedCount = this.selectedValues.length

      // --- Header ---
      const isLoading = opts.loading?.value === true

      switch (this.state) {
        case 'submit': {
          const header = `${styleText('gray', S_BAR)}\n${symbol(this.state)}  ${opts.message}`
          return `${header}\n${styleText('gray', S_BAR)}  ${styleText('dim', `${selectedCount} selected`)}`
        }
        case 'cancel': {
          const header = `${styleText('gray', S_BAR)}\n${symbol(this.state)}  ${opts.message}`
          return `${header}\n${styleText('gray', S_BAR)}  ${styleText(['strikethrough', 'dim'], input)}`
        }
        default: {
          // --- Spinner ---
          if (isLoading && !spinnerTimer) {
            spinnerTimer = setInterval(() => {
              spinnerFrame++
              process.stdin.emit('keypress', '', { name: '' })
            }, 80)
          } else if (!isLoading && spinnerTimer) {
            clearInterval(spinnerTimer)
            spinnerTimer = null
          }

          const headerSymbol = isLoading
            ? styleText('magenta', SPINNER[spinnerFrame % SPINNER.length])
            : symbol(this.state)
          const header = `${styleText('gray', S_BAR)}\n${headerSymbol}  ${opts.message}`

          // --- Option styling ---
          const styleOption = (option: SearchOption<T>, active: boolean) => {
            const label = option.label ?? String(option.value ?? '')
            const hint =
              option.hint && option.value === this.focusedValue
                ? styleText('dim', ` (${option.hint})`)
                : ''
            const isSelected = (this.selectedValues as T[]).includes(
              option.value,
            )
            const checkbox = isSelected
              ? styleText('green', S_CHECKBOX_SELECTED)
              : styleText('dim', S_CHECKBOX_INACTIVE)

            if (option.disabled)
              return `${styleText('gray', S_CHECKBOX_INACTIVE)} ${styleText(['strikethrough', 'gray'] as const, label)}`

            return active
              ? `${checkbox} ${label}${hint}`
              : `${checkbox} ${styleText('dim', label)}`
          }

          const noMatches =
            this.filteredOptions.length === 0 && input
              ? [`${bar}  ${styleText('yellow', 'No matches found')}`]
              : []
          const errorLines =
            this.state === 'error'
              ? [`${bar}  ${styleText('yellow', this.error)}`]
              : []

          const top = [
            ...header.split('\n'),
            `${bar}  ${searchInput}${matchInfo}`,
            ...noMatches,
            ...errorLines,
          ]

          const hasOptions = this.filteredOptions.length > 0
          const isDirectOnly =
            this.filteredOptions.length === 1 &&
            String(this.filteredOptions[0].value) === input.trim()

          const selectedLines =
            selectedCount > 0
              ? [
                  `${bar}  ${styleText('green', `${selectedCount} selected:`)} ${styleText('dim', (this.selectedValues as T[]).map(String).join(', '))}`,
                ]
              : []

          const hints = isDirectOnly
            ? [
                `${styleText('dim', 'Tab:')} select`,
                `${styleText('dim', 'Enter:')} confirm`,
              ]
            : [
                `${styleText('dim', '↑/↓')} navigate`,
                `${styleText('dim', 'Tab:')} select`,
                `${styleText('dim', 'Enter:')} confirm`,
              ]

          const bottom = [
            ...(hasOptions
              ? [`${bar}  ${hints.join(styleText('dim', ' · '))}`]
              : []),
            ...selectedLines,
            styleText(color, S_BAR_END),
          ]

          const list =
            hasOptions && !isDirectOnly
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

  prompt.once('finalize', () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer)
      spinnerTimer = null
    }
  })

  /** Disable Space for selection — only Tab should toggle, since Space is used for typing in the search input. */
  const spaceHandler = (_ch: unknown, key: { name?: string }) => {
    if (key?.name === 'space' && prompt.isNavigating) {
      prompt.isNavigating = false
    }
  }
  process.stdin.prependListener('keypress', spaceHandler)

  // Auto-select focused item on Enter when nothing is selected
  if (opts.autoSelectOnEnter === false) {
    prompt.once('finalize', () => {
      process.stdin.removeListener('keypress', spaceHandler)
    })
  } else {
    const enterHandler = (_ch: unknown, key: { name?: string }) => {
      if (
        key?.name === 'return' &&
        prompt.selectedValues.length === 0 &&
        prompt.focusedValue != null
      ) {
        prompt.selectedValues = [prompt.focusedValue]
      }
    }
    process.stdin.prependListener('keypress', enterHandler)
    prompt.once('finalize', () => {
      process.stdin.removeListener('keypress', enterHandler)
      process.stdin.removeListener('keypress', spaceHandler)
    })
  }

  const result = await prompt.prompt()
  if (isCancel(result)) return result as symbol
  return result as T[]
}
