/** Pinned VxKex NEXT setup bundled only into the Windows 7 x64 offline installer. */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const VXKEX_NEXT_VERSION = '1.2.3.2463'
/** KexSetup records 0x80000000 plus the build number as `InstalledVersion`. */
export const VXKEX_NEXT_INSTALLED_VERSION = 0x8000_0000 + 2463
export const VXKEX_NEXT_SETUP = 'KexSetup_Release_1_2_3_2463.exe'
export const VXKEX_NEXT_URL
  = `https://github.com/YuZhouRen86/VxKex-NEXT/releases/download/${VXKEX_NEXT_VERSION}/${VXKEX_NEXT_SETUP}`
export const VXKEX_NEXT_SHA256 = '757fb01cf38daa38c6e2db542169554117c533921e5edc119a567bfbe18566af'

/** Download one release asset. */
export type FetchBytes = (url: string) => Promise<Buffer>

/**
 * Location that `build/installer-win7.nsh` compiles into the offline installer.
 * @param desktopRoot - Desktop package root.
 * @returns The ignored build-resource path of the pinned setup.
 */
export function bundledVxKexPath(desktopRoot: string): string {
  return join(desktopRoot, 'build', '.win7', VXKEX_NEXT_SETUP)
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fetchWithRetry(url: string): Promise<Buffer> {
  let failure: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
      if (response.ok) return Buffer.from(await response.arrayBuffer())
      failure = new Error(`${url} returned ${String(response.status)}`)
      if (response.status !== 429 && response.status < 500) break
    } catch (error) {
      failure = error
    }
    await new Promise(resolve => setTimeout(resolve, 1_000 * 2 ** attempt))
  }
  throw new Error(`Failed to download VxKex NEXT ${VXKEX_NEXT_VERSION}`, { cause: failure })
}

/**
 * Reuse or download the pinned VxKex NEXT setup, accepting only the pinned bytes.
 * @param desktopRoot - Desktop package root.
 * @param fetchBytes - Download boundary, injectable for tests.
 * @returns Absolute path of the verified setup.
 */
export async function prepareBundledVxKex(
  desktopRoot: string,
  fetchBytes: FetchBytes = fetchWithRetry,
): Promise<string> {
  const target = bundledVxKexPath(desktopRoot)
  if (existsSync(target) && sha256(readFileSync(target)) === VXKEX_NEXT_SHA256) return target
  const bytes = await fetchBytes(VXKEX_NEXT_URL)
  const digest = sha256(bytes)
  if (digest !== VXKEX_NEXT_SHA256) {
    throw new Error(`VxKex NEXT ${VXKEX_NEXT_VERSION} checksum mismatch: expected ${VXKEX_NEXT_SHA256}, received ${digest}`)
  }
  mkdirSync(dirname(target), { recursive: true })
  const temporary = `${target}.${String(process.pid)}.tmp`
  try {
    writeFileSync(temporary, bytes)
    renameSync(temporary, target)
  } finally {
    rmSync(temporary, { force: true })
  }
  return target
}
