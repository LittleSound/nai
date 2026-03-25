import { execSync } from 'node:child_process'
import process from 'node:process'

/** Copy text to the system clipboard. Returns true on success. */
export function copyToClipboard(text: string): boolean {
  try {
    const cmd =
      process.platform === 'darwin'
        ? 'pbcopy'
        : process.platform === 'win32'
          ? 'clip'
          : 'xclip -selection clipboard'
    execSync(cmd, { input: text, stdio: ['pipe', 'ignore', 'ignore'] })
    return true
  } catch {
    return false
  }
}
