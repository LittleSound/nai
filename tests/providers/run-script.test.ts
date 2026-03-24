import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { createBunProvider } from '../../src/providers/bun.ts'
import { createNpmProvider } from '../../src/providers/npm.ts'
import { createPnpmProvider } from '../../src/providers/pnpm.ts'
import { createVltProvider } from '../../src/providers/vlt.ts'
import { createYarnProvider } from '../../src/providers/yarn.ts'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

const mockedExec = vi.mocked(execFileSync)

describe('runScript', () => {
  describe('pnpm', () => {
    const provider = createPnpmProvider('/workspace')

    it('runs script with pnpm', async () => {
      await provider.runScript({ scriptName: 'dev' })
      expect(mockedExec).toHaveBeenCalledWith(
        'pnpm',
        ['run', 'dev'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('forwards extra args', async () => {
      await provider.runScript({ scriptName: 'dev', args: ['--port', '3000'] })
      expect(mockedExec).toHaveBeenCalledWith(
        'pnpm',
        ['run', 'dev', '--port', '3000'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('uses provided cwd', async () => {
      await provider.runScript({ scriptName: 'dev', cwd: '/other' })
      expect(mockedExec).toHaveBeenCalledWith(
        'pnpm',
        ['run', 'dev'],
        expect.objectContaining({ cwd: '/other' }),
      )
    })

    it('falls back to provider cwd', async () => {
      await provider.runScript({ scriptName: 'dev' })
      expect(mockedExec).toHaveBeenCalledWith(
        'pnpm',
        ['run', 'dev'],
        expect.objectContaining({ cwd: '/workspace' }),
      )
    })
  })

  describe('npm', () => {
    const provider = createNpmProvider('/workspace')

    it('runs script without -- when no extra args', async () => {
      await provider.runScript({ scriptName: 'dev' })
      expect(mockedExec).toHaveBeenCalledWith(
        'npm',
        ['run', 'dev'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('inserts -- separator before forwarded args', async () => {
      await provider.runScript({
        scriptName: 'dev',
        args: ['--port', '3000'],
      })
      expect(mockedExec).toHaveBeenCalledWith(
        'npm',
        ['run', 'dev', '--', '--port', '3000'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('inserts -- even for single arg', async () => {
      await provider.runScript({ scriptName: 'build', args: ['--watch'] })
      expect(mockedExec).toHaveBeenCalledWith(
        'npm',
        ['run', 'build', '--', '--watch'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })
  })

  describe('yarn', () => {
    const provider = createYarnProvider('/workspace')

    it('runs script with yarn', async () => {
      await provider.runScript({ scriptName: 'test' })
      expect(mockedExec).toHaveBeenCalledWith(
        'yarn',
        ['run', 'test'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('forwards extra args directly', async () => {
      await provider.runScript({ scriptName: 'test', args: ['--coverage'] })
      expect(mockedExec).toHaveBeenCalledWith(
        'yarn',
        ['run', 'test', '--coverage'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })
  })

  describe('bun', () => {
    const provider = createBunProvider('/workspace')

    it('runs script with bun', async () => {
      await provider.runScript({ scriptName: 'dev' })
      expect(mockedExec).toHaveBeenCalledWith(
        'bun',
        ['run', 'dev'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('forwards extra args directly', async () => {
      await provider.runScript({ scriptName: 'dev', args: ['--hot'] })
      expect(mockedExec).toHaveBeenCalledWith(
        'bun',
        ['run', 'dev', '--hot'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })
  })

  describe('vlt', () => {
    const provider = createVltProvider('/workspace')

    it('runs script with vlt', async () => {
      await provider.runScript({ scriptName: 'build' })
      expect(mockedExec).toHaveBeenCalledWith(
        'vlt',
        ['run', 'build'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('forwards extra args directly', async () => {
      await provider.runScript({ scriptName: 'build', args: ['--minify'] })
      expect(mockedExec).toHaveBeenCalledWith(
        'vlt',
        ['run', 'build', '--minify'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })
  })
})
