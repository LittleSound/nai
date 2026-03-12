import { createBunProvider } from './bun.ts'
import { createNpmProvider } from './npm.ts'
import { createPnpmProvider } from './pnpm.ts'
import { createYarnProvider } from './yarn.ts'
import type { Provider } from '../type.ts'

export const providers: Provider[] = [
  createPnpmProvider(),
  createYarnProvider(),
  createBunProvider(),
  createNpmProvider(),
]
