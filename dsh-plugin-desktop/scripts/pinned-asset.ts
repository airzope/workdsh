/** Download a pinned build input once and accept only its recorded SHA-256. */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Download one release asset. */
export type FetchBytes = (url: string) => Promise<Buffer>

/** A build input identified by its source URL and digest. */
export interface PinnedAsset {
  readonly label: string
  readonly url: string
  readonly sha256: string
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Fetch with bounded retries for transient HTTP and network failures. */
export async function fetchWithRetry(url: string): Promise<Buffer> {
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
  throw new Error(`Failed to download ${url}`, { cause: failure })
}

/**
 * Reuse or download a pinned asset, accepting only the pinned bytes.
 * @param asset - Source URL, digest, and label for errors.
 * @param target - Destination path.
 * @param fetchBytes - Download boundary, injectable for tests.
 * @returns The verified destination path.
 */
export async function preparePinnedAsset(
  asset: PinnedAsset,
  target: string,
  fetchBytes: FetchBytes = fetchWithRetry,
): Promise<string> {
  if (existsSync(target) && sha256(readFileSync(target)) === asset.sha256) return target
  const bytes = await fetchBytes(asset.url)
  const digest = sha256(bytes)
  if (digest !== asset.sha256) {
    throw new Error(`${asset.label} checksum mismatch: expected ${asset.sha256}, received ${digest}`)
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
