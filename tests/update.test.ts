import { describe, expect, it, vi } from 'vitest'
import {
  fetchLatestCliVersion,
  getSelfUpdateCommand,
  maybePromptForCliUpdate,
  shouldSkipUpdateCheck,
} from '../src/update.ts'

const logger = {
  success: vi.fn(),
  error: vi.fn(),
}

describe('shouldSkipUpdateCheck', () => {
  it('skips update checks in non-interactive terminals', () => {
    expect(shouldSkipUpdateCheck({ isTTY: false, env: {} })).toBe(true)
  })

  it('skips update checks when disabled by env', () => {
    expect(
      shouldSkipUpdateCheck({
        isTTY: true,
        env: { NAI_DISABLE_UPDATE_CHECK: '1' },
      }),
    ).toBe(true)
  })

  it('allows update checks in interactive terminals by default', () => {
    expect(shouldSkipUpdateCheck({ isTTY: true, env: {} })).toBe(false)
  })
})

describe('getSelfUpdateCommand', () => {
  it('uses pnpm for pnpm projects', () => {
    expect(getSelfUpdateCommand('pnpm')).toEqual({
      command: 'pnpm',
      args: ['add', '-g', '@rizumu/nai@latest'],
    })
  })

  it('falls back to npm for unsupported providers', () => {
    expect(getSelfUpdateCommand('yarn')).toEqual({
      command: 'npm',
      args: ['install', '-g', '@rizumu/nai@latest'],
    })
  })
})

describe('fetchLatestCliVersion', () => {
  it('returns the fetched version', async () => {
    const version = await fetchLatestCliVersion('@rizumu/nai', {
      fetchLatestVersion: vi.fn().mockResolvedValue({ version: '26.22.0' }),
    })

    expect(version).toBe('26.22.0')
  })

  it('returns null when the fetcher fails', async () => {
    const version = await fetchLatestCliVersion('@rizumu/nai', {
      fetchLatestVersion: vi.fn().mockRejectedValue(new Error('boom')),
    })

    expect(version).toBeNull()
  })
})

describe('maybePromptForCliUpdate', () => {
  it('returns up-to-date when local version matches latest', async () => {
    const result = await maybePromptForCliUpdate({
      toolName: 'nai',
      isTTY: true,
      env: {},
      localVersion: '26.21.0',
      fetchLatestVersion: vi.fn().mockResolvedValue('26.21.0'),
      logger,
    })

    expect(result).toBe('up-to-date')
  })

  it('returns outdated when the user declines the update', async () => {
    const confirmUpdate = vi.fn().mockResolvedValue(false)

    const result = await maybePromptForCliUpdate({
      toolName: 'nar',
      providerName: 'pnpm',
      isTTY: true,
      env: {},
      localVersion: '26.21.0',
      fetchLatestVersion: vi.fn().mockResolvedValue('26.22.0'),
      confirmUpdate,
      logger,
    })

    expect(result).toBe('outdated')
    expect(confirmUpdate).toHaveBeenCalledWith('26.21.0', '26.22.0')
  })

  it('runs the update command when the user confirms', async () => {
    const runUpdate = vi.fn()

    const result = await maybePromptForCliUpdate({
      toolName: 'nai',
      providerName: 'pnpm',
      isTTY: true,
      env: {},
      localVersion: '26.21.0',
      fetchLatestVersion: vi.fn().mockResolvedValue('26.22.0'),
      confirmUpdate: vi.fn().mockResolvedValue(true),
      runUpdate,
      logger,
    })

    expect(result).toBe('updated')
    expect(runUpdate).toHaveBeenCalledWith({
      command: 'pnpm',
      args: ['add', '-g', '@rizumu/nai@latest'],
    })
  })

  it('returns update-failed when the update command throws', async () => {
    const result = await maybePromptForCliUpdate({
      toolName: 'nai',
      providerName: 'npm',
      isTTY: true,
      env: {},
      localVersion: '26.21.0',
      fetchLatestVersion: vi.fn().mockResolvedValue('26.22.0'),
      confirmUpdate: vi.fn().mockResolvedValue(true),
      runUpdate: vi.fn(() => {
        throw new Error('permission denied')
      }),
      logger,
    })

    expect(result).toBe('update-failed')
  })
})
