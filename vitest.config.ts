import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Vitest does not read .gitignore; skip Claude Code worktree copies.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
