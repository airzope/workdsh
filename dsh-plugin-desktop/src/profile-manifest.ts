/**
 * Keep the user's bundle choices in the runtime Profile's package.json.
 *
 * DSH's Plugins page turns a bundle on or off by editing
 * `dsh.profile.bundles` there; Voice Input is such an optional bundle. The
 * carrier replaces the file only when the bundled one changes, and then
 * keeps the bundles the user added and drops the ones the user removed.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The bundled package.json the Profile was last updated from. */
export const BUNDLED_MANIFEST_COPY = '.workdsh-bundled-package.json'

type Manifest = { dsh?: { profile?: { bundles?: unknown } } } & Record<string, unknown>

function parse(text: string | undefined): Manifest | undefined {
  if (text === undefined) return undefined
  try {
    const value = JSON.parse(text) as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Manifest : undefined
  } catch {
    return undefined
  }
}

/** The bundle list of a manifest, when it has a valid one. */
export function bundlesOf(manifest: Manifest | undefined): string[] | undefined {
  const bundles = manifest?.dsh?.profile?.bundles
  return Array.isArray(bundles) && bundles.every(item => typeof item === 'string') ? bundles as string[] : undefined
}

/**
 * The new bundled list with the user's changes applied.
 * @param bundled - New bundled list.
 * @param current - The Profile's list now.
 * @param previous - The bundled list it was last updated from; unknown for earlier releases.
 */
export function mergeBundles(bundled: readonly string[], current: readonly string[], previous: readonly string[] | undefined): string[] {
  const base = previous ?? bundled
  const added = current.filter(name => !base.includes(name) && !bundled.includes(name))
  // Without a record, nothing can be told apart from a bundle the user removed.
  const removed = previous === undefined ? [] : previous.filter(name => !current.includes(name))
  return [...new Set([...bundled.filter(name => !removed.includes(name)), ...added])]
}

/**
 * Bring the Profile's package.json up to the bundled one without losing the user's bundle choices.
 * @param sourceManifest - Bundled package.json.
 * @param targetProfile - The runtime Profile directory.
 * @returns What happened.
 */
export function syncProfileManifest(sourceManifest: string, targetProfile: string): 'installed' | 'unchanged' | 'updated' {
  const bundledText = readFileSync(sourceManifest, 'utf8')
  const target = join(targetProfile, 'package.json')
  const copy = join(targetProfile, BUNDLED_MANIFEST_COPY)
  const previousText = existsSync(copy) ? readFileSync(copy, 'utf8') : undefined
  if (!existsSync(target)) {
    writeFileSync(target, bundledText, 'utf8')
    writeFileSync(copy, bundledText, 'utf8')
    return 'installed'
  }
  if (previousText === bundledText) return 'unchanged'
  const bundled = parse(bundledText)
  const bundledList = bundlesOf(bundled)
  const currentList = bundlesOf(parse(readFileSync(target, 'utf8')))
  let next = bundledText
  if (bundled !== undefined && bundledList !== undefined && currentList !== undefined) {
    const bundles = mergeBundles(bundledList, currentList, bundlesOf(parse(previousText)))
    if (bundles.join('\n') !== bundledList.join('\n')) {
      next = `${JSON.stringify({ ...bundled, dsh: { ...bundled.dsh, profile: { ...bundled.dsh?.profile, bundles } } }, undefined, 2)}\n`
    }
  }
  writeFileSync(target, next, 'utf8')
  writeFileSync(copy, bundledText, 'utf8')
  return 'updated'
}
