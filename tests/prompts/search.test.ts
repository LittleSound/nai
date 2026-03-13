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
      toggleSelected(value: any) {
        if (this.selectedValues.includes(value))
          this.selectedValues = this.selectedValues.filter(
            (v: any) => v !== value,
          )
        else this.selectedValues = [...this.selectedValues, value]
      }
    },
  }
})

const { searchPrompt } = await import('../../src/prompts/search.ts')

let stdinSpies: { prepend: any; remove: any; emit: any }

function setup(overrides: Partial<Parameters<typeof searchPrompt>[0]> = {}) {
  renderFn = null
  mockPrompt = null
  searchPrompt({ message: 'Test prompt', options: [], ...overrides }).catch(
    () => {},
  )
  return { render: renderFn!, prompt: mockPrompt! }
}

describe('searchPrompt', () => {
  beforeEach(() => {
    stdinSpies = {
      prepend: vi
        .spyOn(process.stdin, 'prependListener')
        .mockReturnValue(process.stdin),
      remove: vi
        .spyOn(process.stdin, 'removeListener')
        .mockReturnValue(process.stdin),
      emit: vi.spyOn(process.stdin, 'emit').mockReturnValue(true),
    }
  })

  afterEach(() => {
    if (mockPrompt?._eventHandlers?.finalize) {
      mockPrompt.emit('finalize')
    }
    vi.restoreAllMocks()
    renderFn = null
    mockPrompt = null
  })

  // -----------------------------------------------------------------------
  // Render — empty state
  // -----------------------------------------------------------------------
  describe('render - empty state', () => {
    it('shows message and cursor block when input is empty', () => {
      const { render } = setup()
      const output = strip(render())
      expect(output).toContain('Test prompt')
      expect(output).toContain('_')
    })

    it('does not show hints bar when no options', () => {
      const { render } = setup()
      const output = strip(render())
      expect(output).not.toContain('navigate')
      expect(output).not.toContain('Tab:')
      expect(output).not.toContain('Enter:')
    })
  })

  // -----------------------------------------------------------------------
  // Render — direct-only mode
  // -----------------------------------------------------------------------
  describe('render - direct-only mode', () => {
    it('hides option list and navigate hint when only option is exact input', () => {
      const { render, prompt } = setup()
      const opt = { value: 'vue', label: 'vue', hint: 'add directly' }
      prompt.userInput = 'vue'
      prompt._allOptions = [opt]
      prompt.filteredOptions = [opt]
      prompt.focusedValue = 'vue'

      const output = strip(render())
      // Should still show Tab/Enter hints
      expect(output).toContain('Tab:')
      expect(output).toContain('Enter:')
      // But NOT the navigate hint or checkbox list
      expect(output).not.toContain('navigate')
      expect(output).not.toContain('◻')
    })
  })

  // -----------------------------------------------------------------------
  // Render — multiple options
  // -----------------------------------------------------------------------
  describe('render - multiple options', () => {
    it('shows option list and full hints with navigate', () => {
      const { render, prompt } = setup()
      const opts = [
        { value: 'vue', label: 'vue' },
        { value: 'vue-router', label: 'vue-router' },
      ]
      prompt.userInput = 'vue'
      prompt._allOptions = opts
      prompt.filteredOptions = opts
      prompt.focusedValue = 'vue'

      const output = strip(render())
      expect(output).toContain('navigate')
      expect(output).toContain('Tab:')
      expect(output).toContain('Enter:')
      expect(output).toContain('vue-router')
    })
  })

  // -----------------------------------------------------------------------
  // Render — selected count
  // -----------------------------------------------------------------------
  describe('render - selected count', () => {
    it('shows selected names at bottom when items are selected', () => {
      const { render, prompt } = setup()
      prompt.selectedValues = ['vue', 'lodash']
      prompt.userInput = 'react'
      prompt._allOptions = [{ value: 'react', label: 'react' }]
      prompt.filteredOptions = [{ value: 'react', label: 'react' }]

      const output = strip(render())
      expect(output).toContain('2 selected:')
      expect(output).toContain('vue, lodash')
    })

    it('does not show selected line when nothing selected', () => {
      const { render, prompt } = setup()
      prompt.userInput = 'vue'
      prompt._allOptions = [{ value: 'vue', label: 'vue' }]
      prompt.filteredOptions = [{ value: 'vue', label: 'vue' }]

      const output = strip(render())
      expect(output).not.toContain('selected')
    })
  })

  // -----------------------------------------------------------------------
  // Render — match info
  // -----------------------------------------------------------------------
  describe('render - match info', () => {
    it('shows singular "match" for one filtered result', () => {
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

    it('shows plural "matches" for multiple filtered results', () => {
      const { render, prompt } = setup()
      prompt._allOptions = [
        { value: 'a', label: 'a' },
        { value: 'ab', label: 'ab' },
        { value: 'c', label: 'c' },
      ]
      prompt.filteredOptions = [
        { value: 'a', label: 'a' },
        { value: 'ab', label: 'ab' },
      ]
      prompt.userInput = 'a'

      const output = strip(render())
      expect(output).toContain('(2 matches)')
    })

    it('omits match info when all options are shown', () => {
      const { render, prompt } = setup()
      const opts = [{ value: 'a', label: 'a' }]
      prompt._allOptions = opts
      prompt.filteredOptions = opts
      prompt.userInput = 'a'

      const output = strip(render())
      expect(output).not.toMatch(/\d+ match/)
    })
  })

  // -----------------------------------------------------------------------
  // Render — no matches
  // -----------------------------------------------------------------------
  describe('render - no matches', () => {
    it('shows "No matches found" when filtered is empty with input', () => {
      const { render, prompt } = setup()
      prompt._allOptions = [{ value: 'vue', label: 'vue' }]
      prompt.filteredOptions = []
      prompt.userInput = 'zzz'

      const output = strip(render())
      expect(output).toContain('No matches found')
    })

    it('does not show "No matches found" when input is empty', () => {
      const { render, prompt } = setup()
      prompt._allOptions = [{ value: 'vue', label: 'vue' }]
      prompt.filteredOptions = []
      prompt.userInput = ''

      const output = strip(render())
      expect(output).not.toContain('No matches found')
    })
  })

  // -----------------------------------------------------------------------
  // Render — loading spinner
  // -----------------------------------------------------------------------
  describe('render - loading spinner', () => {
    it('replaces ◆ with spinner frame when loading', () => {
      const loading = { value: true }
      const { render } = setup({ loading })

      const output = strip(render())
      expect(output).toMatch(/[◒◐◓◑]/)
      expect(output).not.toContain('◆')

      loading.value = false
      render() // trigger timer cleanup
    })

    it('shows ◆ when not loading', () => {
      const { render } = setup()
      const output = strip(render())
      expect(output).toContain('◆')
    })
  })

  // -----------------------------------------------------------------------
  // Render — terminal states
  // -----------------------------------------------------------------------
  describe('render - terminal states', () => {
    it('submit state shows selected count', () => {
      const { render, prompt } = setup()
      prompt.state = 'submit'
      prompt.selectedValues = ['vue', 'react']

      const output = strip(render())
      expect(output).toContain('2 selected')
    })

    it('cancel state renders without error', () => {
      const { render, prompt } = setup()
      prompt.state = 'cancel'
      prompt.userInput = 'vue'

      expect(() => render()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Render — error state
  // -----------------------------------------------------------------------
  describe('render - error state', () => {
    it('shows validation error message', () => {
      const { render, prompt } = setup()
      prompt.state = 'error'
      prompt.error = 'Please select at least one item'
      prompt.userInput = 'vue'
      prompt._allOptions = [{ value: 'vue', label: 'vue' }]
      prompt.filteredOptions = [{ value: 'vue', label: 'vue' }]

      const output = strip(render())
      expect(output).toContain('Please select at least one item')
    })
  })

  // -----------------------------------------------------------------------
  // Interaction — space handler
  // -----------------------------------------------------------------------
  describe('interaction - space handler', () => {
    it('resets isNavigating to false on space key', () => {
      setup()
      const spaceHandler = stdinSpies.prepend.mock.calls[0][1]

      mockPrompt.isNavigating = true
      spaceHandler(undefined, { name: 'space' })

      expect(mockPrompt.isNavigating).toBe(false)
    })

    it('does nothing when not navigating', () => {
      setup()
      const spaceHandler = stdinSpies.prepend.mock.calls[0][1]

      mockPrompt.isNavigating = false
      spaceHandler(undefined, { name: 'space' })

      expect(mockPrompt.isNavigating).toBe(false)
    })

    it('ignores non-space keys', () => {
      setup()
      const spaceHandler = stdinSpies.prepend.mock.calls[0][1]

      mockPrompt.isNavigating = true
      spaceHandler(undefined, { name: 'a' })

      expect(mockPrompt.isNavigating).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Interaction — enter auto-select
  // -----------------------------------------------------------------------
  describe('interaction - enter auto-select', () => {
    it('selects focused value when nothing is selected', () => {
      setup()
      const enterHandler = stdinSpies.prepend.mock.calls[1][1]

      mockPrompt.selectedValues = []
      mockPrompt.focusedValue = 'vue'
      enterHandler(undefined, { name: 'return' })

      expect(mockPrompt.selectedValues).toEqual(['vue'])
    })

    it('does not override existing selection', () => {
      setup()
      const enterHandler = stdinSpies.prepend.mock.calls[1][1]

      mockPrompt.selectedValues = ['react']
      mockPrompt.focusedValue = 'vue'
      enterHandler(undefined, { name: 'return' })

      expect(mockPrompt.selectedValues).toEqual(['react'])
    })

    it('does nothing when focusedValue is undefined', () => {
      setup()
      const enterHandler = stdinSpies.prepend.mock.calls[1][1]

      mockPrompt.selectedValues = []
      mockPrompt.focusedValue = undefined
      enterHandler(undefined, { name: 'return' })

      expect(mockPrompt.selectedValues).toEqual([])
    })

    it('is not registered when autoSelectOnEnter is false', () => {
      setup({ autoSelectOnEnter: false })

      // Only space handler registered, no enter handler
      expect(stdinSpies.prepend.mock.calls).toHaveLength(1)
    })
  })

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------
  describe('cleanup', () => {
    it('removes stdin listeners on finalize', () => {
      setup()
      mockPrompt.emit('finalize')

      expect(stdinSpies.remove).toHaveBeenCalledWith(
        'keypress',
        expect.any(Function),
      )
    })

    it('clears spinner timer on finalize', () => {
      const loading = { value: true }
      const { render } = setup({ loading })

      // Trigger render to start the spinner interval
      render()

      const clearSpy = vi.spyOn(globalThis, 'clearInterval')
      mockPrompt.emit('finalize')

      expect(clearSpy).toHaveBeenCalled()
      clearSpy.mockRestore()
    })
  })
})
