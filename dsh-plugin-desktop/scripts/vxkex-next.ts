/** Pinned VxKex NEXT setup bundled only into the Windows 7 x64 offline installer. */

import { join } from 'node:path'
import { preparePinnedAsset, type FetchBytes } from './pinned-asset.ts'

export type { FetchBytes } from './pinned-asset.ts'

export const VXKEX_NEXT_VERSION = '1.2.3.2463'
/** KexSetup records 0x80000000 plus the build number as `InstalledVersion`. */
export const VXKEX_NEXT_INSTALLED_VERSION = 0x8000_0000 + 2463
export const VXKEX_NEXT_SETUP = 'KexSetup_Release_1_2_3_2463.exe'
export const VXKEX_NEXT_URL
  = `https://github.com/YuZhouRen86/VxKex-NEXT/releases/download/${VXKEX_NEXT_VERSION}/${VXKEX_NEXT_SETUP}`
export const VXKEX_NEXT_SHA256 = '757fb01cf38daa38c6e2db542169554117c533921e5edc119a567bfbe18566af'

/**
 * Location that `build/installer-win7.nsh` compiles into the offline installer.
 * @param desktopRoot - Desktop package root.
 * @returns The ignored build-resource path of the pinned setup.
 */
export function bundledVxKexPath(desktopRoot: string): string {
  return join(desktopRoot, 'build', '.win7', VXKEX_NEXT_SETUP)
}

/**
 * Reuse or download the pinned VxKex NEXT setup, accepting only the pinned bytes.
 * @param desktopRoot - Desktop package root.
 * @param fetchBytes - Download boundary, injectable for tests.
 * @returns Absolute path of the verified setup.
 */
export async function prepareBundledVxKex(desktopRoot: string, fetchBytes?: FetchBytes): Promise<string> {
  return preparePinnedAsset(
    { label: `VxKex NEXT ${VXKEX_NEXT_VERSION}`, url: VXKEX_NEXT_URL, sha256: VXKEX_NEXT_SHA256 },
    bundledVxKexPath(desktopRoot),
    fetchBytes,
  )
}
