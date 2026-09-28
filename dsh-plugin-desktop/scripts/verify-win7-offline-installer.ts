/** Guarded afterAll hook for the Windows 7 offline installer, which reuses dist/win-unpacked. */

import { realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyElectronExecutableFuses } from './verify-electron-fuses.ts'

/** Same name as `WINDOWS7_PREPACKAGED_ENV` in package-win7.ts, kept import-free for electron-builder. */
const PREPACKAGED_ENV = 'WORKDSH_WIN7_PREPACKAGED'

export interface Windows7OfflineBuildResult {
  readonly outDir: string
}

export interface Windows7OfflineHookOptions {
  readonly desktopRoot?: string
  readonly env?: NodeJS.ProcessEnv
  readonly verifyFuses?: (executable: string) => Promise<void>
}

/**
 * The standard `--win nsis` build already ran the post-fuse runtime smoke on
 * dist/win-unpacked. This `--prepackaged` build only wraps that directory, so
 * the hook is bound to dist/win7 and re-checks the executable's fuses.
 * @param result - electron-builder build result.
 * @param options - Test seams.
 * @returns No extra artifacts.
 */
export default async function verifyWindows7OfflineBuild(
  result: Windows7OfflineBuildResult,
  options: Windows7OfflineHookOptions = {},
): Promise<string[]> {
  const desktopRoot = realpathSync(options.desktopRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'))
  const output = realpathSync(resolve(result.outDir))
  if (output !== join(desktopRoot, 'dist', 'win7')) {
    throw new Error(`refusing to skip the packaged-runtime gate outside the Windows 7 offline build: ${output}`)
  }
  const application = (options.env ?? process.env)[PREPACKAGED_ENV]
  const expected = join(desktopRoot, 'dist', 'win-unpacked')
  if (application === undefined || realpathSync(application) !== realpathSync(expected)) {
    throw new Error(`the Windows 7 offline installer must wrap ${expected}`)
  }
  await (options.verifyFuses ?? verifyElectronExecutableFuses)(join(expected, 'WorkDSH.exe'))
  return []
}
