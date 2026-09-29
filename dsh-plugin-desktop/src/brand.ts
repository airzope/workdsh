/** The white-label brand a build packaged in build/brand, read by the carrier at startup. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The packaged brand file inside build/brand. */
export const PACKAGED_BRAND_FILE = 'brand.json'

/** Brand fields the carrier needs at run time. */
export interface PackagedBrand {
  /** Display name for windows, menus and the in-app brand. */
  readonly name: string
  /** ASCII product file name of the app bundle and executables. */
  readonly fileName: string
  /** Folder name for user data under the platform's application-data directory. */
  readonly dataDirectory: string
  /** Mark file inside build/brand: mark.svg or mark.png. */
  readonly mark: string
}

/**
 * Read and check the packaged brand.
 * @param directory - The build/brand directory.
 * @returns The brand.
 */
export function readPackagedBrand(directory: string): PackagedBrand {
  const where = join(directory, PACKAGED_BRAND_FILE)
  const value = JSON.parse(readFileSync(where, 'utf8')) as Partial<Record<keyof PackagedBrand, unknown>>
  for (const key of ['name', 'fileName', 'dataDirectory', 'mark'] as const) {
    if (typeof value[key] !== 'string' || value[key].length === 0) throw new Error(`${where} has no ${key}`)
  }
  if (!/^mark\.(?:svg|png)$/u.test(value.mark as string)) throw new Error(`${where} names an unexpected mark file`)
  return value as PackagedBrand
}

/**
 * The path another process reads for a file packaged in app.asar: the
 * unpacked copy next to the archive. Other paths are returned unchanged.
 * @param path - Path as seen by Electron's asar-aware file system.
 * @returns A path plain Node.js can open.
 */
export function unpackedPath(path: string): string {
  return path.replace(/([\\/])app\.asar(?=[\\/])/u, '$1app.asar.unpacked')
}

/**
 * Variables that tell the WorkDSH Profile which brand to show.
 * @param brand - Packaged brand.
 * @param directory - The build/brand directory.
 * @returns Environment entries for the runtime process.
 */
export function brandEnvironment(brand: PackagedBrand, directory: string): Record<string, string> {
  return {
    WORKDSH_BRAND_NAME: brand.name,
    WORKDSH_BRAND_MARK: unpackedPath(join(directory, brand.mark)),
  }
}
