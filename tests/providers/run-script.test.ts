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

    it('executes and returns command string', async () => {
      const cmd = await provider.runScript({ scriptName: 'dev' })
      expect(cmd).toBe('pnpm run dev')
      expect(mockedExec).toHaveBeenCalledWith(
        'pnpm',
        ['run', 'dev'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('forwards extra args', async () => {
      const cmd = await provider.runScript({
        scriptName: 'dev',
        args: ['--port', '3000'],
      })
      expect(cmd).toBe('pnpm run dev --port 3000')
    })

    it('returns command without executing when execute is false', async () => {
      mockedExec.mockClear()
      const cmd = await provider.runScript({
        scriptName: 'dev',
        execute: false,
      })
      expect(cmd).toBe('pnpm run dev')
      expect(mockedExec).not.toHaveBeenCalled()
    })

    it('uses provided cwd', async () => {
      await provider.runScript({ scriptName: 'dev', cwd: '/other' })
      expect(mockedExec).toHaveBeenCalledWith(
        'pnpm',
        ['run', 'dev'],
        expect.objectContaining({ cwd: '/other' }),
      )
    })
  })

  describe('npm', () => {
    const provider = createNpmProvider('/workspace')

    it('returns command without -- when no extra args', async () => {
      const cmd = await provider.runScript({ scriptName: 'dev' })
      expect(cmd).toBe('npm run dev')
    })

    it('inserts -- separator before forwarded args', async () => {
      const cmd = await provider.runScript({
        scriptName: 'dev',
        args: ['--port', '3000'],
      })
      expect(cmd).toBe('npm run dev -- --port 3000')
    })

    it('returns command without executing when execute is false', async () => {
      mockedExec.mockClear()
      const cmd = await provider.runScript({
        scriptName: 'build',
        execute: false,
      })
      expect(cmd).toBe('npm run build')
      expect(mockedExec).not.toHaveBeenCalled()
    })
  })

  describe('yarn', () => {
    const provider = createYarnProvider('/workspace')

    it('executes and returns command string', async () => {
      const cmd = await provider.runScript({ scriptName: 'test' })
      expect(cmd).toBe('yarn run test')
    })

    it('forwards extra args directly', async () => {
      const cmd = await provider.runScript({
        scriptName: 'test',
        args: ['--coverage'],
      })
      expect(cmd).toBe('yarn run test --coverage')
    })

    it('returns command without executing when execute is false', async () => {
      mockedExec.mockClear()
      const cmd = await provider.runScript({
        scriptName: 'test',
        execute: false,
      })
      expect(cmd).toBe('yarn run test')
      expect(mockedExec).not.toHaveBeenCalled()
    })
  })

  describe('bun', () => {
    const provider = createBunProvider('/workspace')

    it('executes and returns command string', async () => {
      const cmd = await provider.runScript({ scriptName: 'dev' })
      expect(cmd).toBe('bun run dev')
    })

    it('returns command without executing when execute is false', async () => {
      mockedExec.mockClear()
      const cmd = await provider.runScript({
        scriptName: 'dev',
        execute: false,
      })
      expect(cmd).toBe('bun run dev')
      expect(mockedExec).not.toHaveBeenCalled()
    })
  })

  describe('vlt', () => {
    const provider = createVltProvider('/workspace')

    it('executes and returns command string', async () => {
      const cmd = await provider.runScript({ scriptName: 'build' })
      expect(cmd).toBe('vlt run build')
    })

    it('returns command without executing when execute is false', async () => {
      mockedExec.mockClear()
      const cmd = await provider.runScript({
        scriptName: 'build',
        execute: false,
      })
      expect(cmd).toBe('vlt run build')
      expect(mockedExec).not.toHaveBeenCalled()
    })
  })
})
