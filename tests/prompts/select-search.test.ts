import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[\d;]*m/g
function strip(str: string): string {
  return str.replaceAll(ANSI_RE, '')
}

// --- Mock AutocompletePrompt to capture render function and prompt state ---
let renderFn: (() => string) | null = null
let mockPrompt: any = null

vi.mock('@clack/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@clack/core')>()
  return {
    ...mod,
    AutocompletePrompt: class {
      _allOptions: any[] = []
      filteredOptions: any[] = []
      selectedValues: any[] = []
      focusedValue: any = undefined
      isNavigating = false
      cursor = 0
      state = 'active'
      error = ''
      userInput = ''
      _eventHandlers: Record<string, Function[]> = {}

      get options() {
        return this._allOptions
      }
      get userInputWithCursor() {
        return this.userInput ? `${this.userInput}█` : '█'
      }

      constructor(opts: any) {
        renderFn = opts.render.bind(this)
        mockPrompt = this // eslint-disable-line @typescript-eslint/no-this-alias
      }

      prompt() {
        return new Promise(() => {})
      }
      once(event: string, cb: Function) {
        ;(this._eventHandlers[event] ??= []).push(cb)
      }
      on() {}
      emit(event: string) {
        for (const cb of this._eventHandlers[event] ?? []) cb()
      }
    },
  }
})

const { selectSearchPrompt } =
  await import('../../src/prompts/select-search.ts')

function setup(
  overrides: Partial<Parameters<typeof selectSearchPrompt>[0]> = {},
) {
  renderFn = null
  mockPrompt = null
  selectSearchPrompt({
    message: 'Select item',
    options: [],
    ...overrides,
  }).catch(() => {})
  return { render: renderFn!, prompt: mockPrompt! }
}

describe('selectSearchPrompt', () => {
  beforeEach(() => {
    vi.spyOn(process.stdin, 'prependListener').mockReturnValue(process.stdin)
    vi.spyOn(process.stdin, 'removeListener').mockReturnValue(process.stdin)
    vi.spyOn(process.stdin, 'emit').mockReturnValue(true)
  })

  afterEach(() => {
    if (mockPrompt?._eventHandlers?.finalize) {
      mockPrompt.emit('finalize')
    }
    vi.restoreAllMocks()
    renderFn = null
    mockPrompt = null
  })

  describe('render - empty state', () => {
    it('shows message and cursor when input is empty', () => {
      const { render } = setup()
      const output = strip(render())
      expect(output).toContain('Select item')
      expect(output).toContain('_')
    })

    it('does not show hints when no options', () => {
      const { render } = setup()
      const output = strip(render())
      expect(output).not.toContain('navigate')
    })
  })

  describe('render - with options', () => {
    it('shows option list with radio indicators', () => {
      const { render, prompt } = setup()
      const opts = [
        { value: 'dev', label: 'dev', hint: 'vite' },
        { value: 'build', label: 'build', hint: 'tsdown' },
      ]
      prompt.userInput = ''
      prompt._allOptions = opts
      prompt.filteredOptions = opts
      prompt.focusedValue = 'dev'

      const output = strip(render())
      expect(output).toContain('dev')
      expect(output).toContain('build')
      expect(output).toContain('navigate')
      expect(output).toContain('Enter:')
      expect(output).toContain('run')
    })

    it('shows hint only on active/focused item', () => {
      const { render, prompt } = setup()
      const opts = [
        { value: 'dev', label: 'dev', hint: 'vite' },
        { value: 'build', label: 'build', hint: 'tsdown' },
      ]
      prompt.userInput = ''
      prompt._allOptions = opts
      prompt.filteredOptions = opts
      prompt.focusedValue = 'dev'
      prompt.cursor = 0

      const output = strip(render())
      expect(output).toContain('(vite)')
    })

    it('does not show checkboxes (uses radio style)', () => {
      const { render, prompt } = setup()
      const opts = [{ value: 'dev', label: 'dev' }]
      prompt.userInput = ''
      prompt._allOptions = opts
      prompt.filteredOptions = opts
      prompt.focusedValue = 'dev'

      const output = render()
      expect(output).not.toContain('◻')
      expect(output).not.toContain('◼')
    })
  })

  describe('render - match info', () => {
    it('shows match count when filtered', () => {
      const { render, prompt } = setup()
      prompt._allOptions = [
        { value: 'a', label: 'a' },
        { value: 'b', label: 'b' },
      ]
      prompt.filteredOptions = [{ value: 'a', label: 'a' }]
      prompt.userInput = 'a'

      const output = strip(render())
      expect(output).toContain('(1 match)')
    })

    it('omits match info when all options shown', () => {
      const { render, prompt } = setup()
      const opts = [{ value: 'a', label: 'a' }]
      prompt._allOptions = opts
      prompt.filteredOptions = opts
      prompt.userInput = 'a'

      const output = strip(render())
      expect(output).not.toMatch(/\d+ match/)
    })
  })

  describe('render - no matches', () => {
    it('shows "No matches found" when filtered is empty with input', () => {
      const { render, prompt } = setup()
      prompt._allOptions = [{ value: 'dev', label: 'dev' }]
      prompt.filteredOptions = []
      prompt.userInput = 'zzz'

      const output = strip(render())
      expect(output).toContain('No matches found')
    })
  })

  describe('render - terminal states', () => {
    it('submit state shows selected label', () => {
      const { render, prompt } = setup()
      prompt.state = 'submit'
      prompt.focusedValue = 'dev'
      prompt.filteredOptions = [{ value: 'dev', label: 'dev' }]

      const output = strip(render())
      expect(output).toContain('dev')
    })

    it('cancel state renders without error', () => {
      const { render, prompt } = setup()
      prompt.state = 'cancel'
      prompt.userInput = 'dev'

      expect(() => render()).not.toThrow()
    })
  })
})
