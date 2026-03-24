import { nodeLib } from 'tsdown-preset-sxzz'

export default nodeLib(
  { entry: ['src/index.ts', 'src/cli.ts', 'src/nar/cli.ts'] },
  { exports: true },
)
