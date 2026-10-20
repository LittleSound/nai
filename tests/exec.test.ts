import spawn from 'cross-spawn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../src/exec.ts'
import { createBunProvider } from '../src/providers/bun.ts'
import { createNpmProvider } from '../src/providers/npm.ts'
import { createPnpmProvider } from '../src/providers/pnpm.ts'
import { createVltProvider } from '../src/providers/vlt.ts'
import { createYarnProvider } from '../src/providers/yarn.ts'

vi.mock('cross-spawn', () => ({
  default: { sync: vi.fn() },
}))

const mockedSync = vi.mocked(spawn.sync)

type SyncResult = ReturnType<typeof spawn.sync>

function result(
  partial: Partial<Pick<SyncResult, 'status' | 'signal' | 'error'>>,
): SyncResult {
  const value: Partial<SyncResult> = {
    pid: 1,
    status: 0,
    signal: null,
    ...partial,
  }
  return value as SyncResult
}

beforeEach(() => {
  mockedSync.mockReset()
  mockedSync.mockReturnValue(result({}))
})

describe('runCommand', () => {
  it('spawns through cross-spawn so Windows .cmd shims resolve', () => {
    runCommand({ command: 'pnpm', args: ['install'], cwd: '/repo' })
    expect(mockedSync).toHaveBeenCalledWith('pnpm', ['install'], {
      cwd: '/repo',
      stdio: 'inherit',
    })
  })

  it('throws with the exit status when the command fails', () => {
    mockedSync.mockReturnValue(result({ status: 2 }))
    expect(() =>
      runCommand({ command: 'pnpm', args: ['install'], cwd: '/repo' }),
    ).toThrow(expect.objectContaining({ status: 2 }))
  })

  it('rethrows spawn errors such as ENOENT', () => {
    const error = Object.assign(new Error('spawnSync pnpm ENOENT'), {
      code: 'ENOENT',
    })
    mockedSync.mockReturnValue(result({ status: null, error }))
    expect(() =>
      runCommand({ command: 'pnpm', args: ['install'], cwd: '/repo' }),
    ).toThrow('spawnSync pnpm ENOENT')
  })
})

describe('provider install', () => {
  it.each([
    ['pnpm', createPnpmProvider],
    ['npm', createNpmProvider],
    ['yarn', createYarnProvider],
    ['bun', createBunProvider],
    ['vlt', createVltProvider],
  ] as const)(
    '%s install uses the cross-platform spawner',
    async (bin, create) => {
      await create('/workspace').install()
      expect(mockedSync).toHaveBeenCalledWith(
        bin,
        ['install'],
        expect.objectContaining({ cwd: '/workspace', stdio: 'inherit' }),
      )
    },
  )
})
