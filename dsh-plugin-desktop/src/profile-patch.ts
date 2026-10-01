/**
 * Keep the user's Settings in the runtime Profile's `cordis.patch.yml`.
 *
 * DSH saves every Settings change (the default model, provider routes,
 * acknowledged notices) in that file, and the same file carries the WorkDSH
 * composition. The carrier therefore replaces it only when the bundled
 * composition changes. On that update it keeps the rows DSH added for the
 * user: top-level rows that name an entry by id, insert nothing, and are not
 * rows of the bundled file. The previous file stays beside it as
 * `cordis.patch.yml.before-update`.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The bundled patch the Profile was last updated from. */
export const BUNDLED_PATCH_COPY = '.workdsh-bundled-cordis.patch.yml'
/** The user's file before the last update. */
export const PATCH_BACKUP = 'cordis.patch.yml.before-update'

/** One top-level row of a patch list, with the comments above it. */
export interface PatchRow {
  readonly text: string
  readonly id?: string
  readonly insert: boolean
}

/**
 * Split a block-style patch list into its top-level rows.
 * @param text - Patch file.
 * @returns Its rows, or undefined when the file is not a block list this can split safely.
 */
export function patchRows(text: string): PatchRow[] | undefined {
  if (/^\s*\[\s*\]\s*$/u.test(text.replace(/^#.*$/gmu, ''))) return []
  const rows: PatchRow[] = []
  let pending: string[] = []
  let current: string[] | undefined
  const finish = (): void => {
    if (current === undefined) return
    const body = current.join('\n')
    const first = current[0] ?? ''
    const id = /^- id:\s*(.+?)\s*$/u.exec(first)?.[1] ?? /^ {2}id:\s*(.+?)\s*$/mu.exec(body)?.[1]
    rows.push({
      text: `${[...pending, ...current].join('\n')}\n`,
      ...(id === undefined ? {} : { id: id.replace(/^(['"])(.*)\1$/u, '$2') }),
      insert: /^- insert:/u.test(first),
    })
    pending = []
    current = undefined
  }
  const lines = text.replace(/\r\n/gu, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  for (const line of lines) {
    if (line.startsWith('- ') || line === '-') {
      finish()
      current = [line]
    } else if (line.startsWith(' ') || (current !== undefined && line.trim() === '')) {
      if (current === undefined) return undefined
      current.push(line)
    } else if (line.startsWith('#') || line.trim() === '') {
      // Comments between rows belong to the row below them.
      if (current !== undefined && line.startsWith('#')) finish()
      pending.push(line)
    } else {
      return undefined
    }
  }
  finish()
  return rows
}

/** A row's content without comments or trailing blank lines, for comparison. */
function content(row: PatchRow): string {
  return row.text.split('\n').filter(line => !line.startsWith('#')).join('\n').trim()
}

/**
 * The new bundled patch followed by the user's own rows from the current file.
 * @param bundled - New bundled patch.
 * @param current - The Profile's patch now.
 * @param previous - The bundled patch it was last updated from, when known.
 * @returns The merged patch, or undefined when a file cannot be split.
 */
export function mergeProfilePatch(bundled: string, current: string, previous: string | undefined): string | undefined {
  const bundledRows = patchRows(bundled)
  const currentRows = patchRows(current)
  if (bundledRows === undefined || currentRows === undefined) return undefined
  const bundledIds = new Set(bundledRows.flatMap(row => row.insert || row.id === undefined ? [] : [row.id]))
  const previousRows = new Set((previous === undefined ? [] : patchRows(previous) ?? []).map(content))
  const own = currentRows.filter(row => !row.insert && row.id !== undefined && !bundledIds.has(row.id) && !previousRows.has(content(row)))
  if (own.length === 0) return bundled
  return `${bundled.replace(/\s*$/u, '\n')}${own.map(row => row.text.replace(/\s*$/u, '\n')).join('')}`
}

/**
 * Bring the Profile's patch up to the bundled composition without losing the user's Settings.
 * @param sourcePatch - Bundled `cordis.patch.yml`.
 * @param targetProfile - The runtime Profile directory.
 * @returns What happened.
 */
export function syncProfilePatch(sourcePatch: string, targetProfile: string): 'installed' | 'unchanged' | 'updated' | 'merged' | 'replaced' {
  const bundled = readFileSync(sourcePatch, 'utf8')
  const target = join(targetProfile, 'cordis.patch.yml')
  const copy = join(targetProfile, BUNDLED_PATCH_COPY)
  const previous = existsSync(copy) ? readFileSync(copy, 'utf8') : undefined
  if (!existsSync(target)) {
    writeFileSync(target, bundled, 'utf8')
    writeFileSync(copy, bundled, 'utf8')
    return 'installed'
  }
  if (previous === bundled) return 'unchanged'
  const current = readFileSync(target, 'utf8')
  if (current === bundled || current === previous) {
    writeFileSync(target, bundled, 'utf8')
    writeFileSync(copy, bundled, 'utf8')
    return 'updated'
  }
  const merged = mergeProfilePatch(bundled, current, previous)
  writeFileSync(join(targetProfile, PATCH_BACKUP), current, 'utf8')
  writeFileSync(target, merged ?? bundled, 'utf8')
  writeFileSync(copy, bundled, 'utf8')
  return merged === undefined ? 'replaced' : 'merged'
}
