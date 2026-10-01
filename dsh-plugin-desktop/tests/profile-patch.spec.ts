import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_PATCH_COPY, PATCH_BACKUP, mergeProfilePatch, patchRows, syncProfilePatch } from '../src/profile-patch.ts'

const bundledV1 = `- insert:
    - id: workdsh-installation-probe
      name: workdsh-bundle
    # A comment inside the insert list.
    - id: workdsh-local-models
      name: workdsh-bundle/local-models
      disabled: !!js "!process.env.WORKDSH_LLAMA_BASE_URL"
# Native Conversation owns work-process presentation.
- insert:
    - id: workdsh-activity
      name: workdsh-plugin-activity
      disabled: true
- id: ui-sidebar-browser
  disabled: false
`

const bundledV2 = bundledV1.replace('WORKDSH_LLAMA_BASE_URL"', 'WORKDSH_LLAMA_BASE_URL && !process.env.WORKDSH_LLAMA_SERVER"')

// What DSH's Settings write after the welcome notice and a default model change.
const settings = `- id: ui-settings-general
  name: "@deepseek-ai/dsh-client-ui-settings-general"
  config:
    welcomeNoticeVersion: 2026-09-28.1
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: llama-local
    model: qwen3-8b
`

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function profile(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-profile-patch-'))
  roots.push(root)
  return root
}

describe('runtime Profile patch', () => {
  it('splits a patch into top-level rows with the comments above them', () => {
    const rows = patchRows(`${bundledV1}${settings}`)
    expect(rows?.map(row => [row.id, row.insert])).toEqual([
      [undefined, true], [undefined, true], ['ui-sidebar-browser', false], ['ui-settings-general', false], ['agent-default-model', false],
    ])
    expect(rows?.[1]?.text.startsWith('# Native Conversation')).toBe(true)
    expect(rows?.map(row => row.text).join('')).toBe(`${bundledV1}${settings}`)
    expect(patchRows('[]\n')).toEqual([])
    expect(patchRows('# nothing yet\n[]\n')).toEqual([])
    expect(patchRows('{ broken: true }\n')).toBeUndefined()
  })

  it('keeps the rows Settings added and drops rows the bundle owns', () => {
    const userEdited = `${bundledV1.replace('disabled: false', 'disabled: true')}${settings}`
    const merged = mergeProfilePatch(bundledV2, userEdited, bundledV1)
    expect(merged).toBe(`${bundledV2}${settings}`)
    // Without the previous bundled file, rows of the bundle are still recognised by id.
    expect(mergeProfilePatch(bundledV2, userEdited, undefined)).toBe(`${bundledV2}${settings}`)
    expect(mergeProfilePatch(bundledV2, bundledV1, bundledV1)).toBe(bundledV2)
    expect(mergeProfilePatch(bundledV2, '{ broken: true }\n', bundledV1)).toBeUndefined()
  })

  it('installs, keeps the user file between launches and updates it with the bundle', () => {
    const target = profile()
    const source = join(target, 'bundled.yml')
    const patch = join(target, 'cordis.patch.yml')
    writeFileSync(source, bundledV1)
    expect(syncProfilePatch(source, target)).toBe('installed')
    expect(readFileSync(patch, 'utf8')).toBe(bundledV1)
    expect(readFileSync(join(target, BUNDLED_PATCH_COPY), 'utf8')).toBe(bundledV1)

    // Settings write to the file; the next launch of the same build leaves it alone.
    writeFileSync(patch, `${bundledV1}${settings}`)
    expect(syncProfilePatch(source, target)).toBe('unchanged')
    expect(readFileSync(patch, 'utf8')).toBe(`${bundledV1}${settings}`)

    // A new build brings its composition and keeps those Settings, with a backup.
    writeFileSync(source, bundledV2)
    expect(syncProfilePatch(source, target)).toBe('merged')
    expect(readFileSync(patch, 'utf8')).toBe(`${bundledV2}${settings}`)
    expect(readFileSync(join(target, PATCH_BACKUP), 'utf8')).toBe(`${bundledV1}${settings}`)
    expect(readFileSync(join(target, BUNDLED_PATCH_COPY), 'utf8')).toBe(bundledV2)
  })

  it('updates an untouched file in place and replaces one it cannot read', () => {
    const target = profile()
    const source = join(target, 'bundled.yml')
    const patch = join(target, 'cordis.patch.yml')
    writeFileSync(source, bundledV1)
    syncProfilePatch(source, target)
    writeFileSync(source, bundledV2)
    expect(syncProfilePatch(source, target)).toBe('updated')
    expect(readFileSync(patch, 'utf8')).toBe(bundledV2)
    expect(existsSync(join(target, PATCH_BACKUP))).toBe(false)

    writeFileSync(patch, '{ hand: edited }\n')
    writeFileSync(source, bundledV1)
    expect(syncProfilePatch(source, target)).toBe('replaced')
    expect(readFileSync(patch, 'utf8')).toBe(bundledV1)
    expect(readFileSync(join(target, PATCH_BACKUP), 'utf8')).toBe('{ hand: edited }\n')
  })

  it('carries Settings over from a release that rewrote the file at every launch', () => {
    const target = profile()
    const source = join(target, 'bundled.yml')
    writeFileSync(source, bundledV2)
    // Earlier releases left no copy of the bundled file.
    writeFileSync(join(target, 'cordis.patch.yml'), `${bundledV1}${settings}`)
    expect(syncProfilePatch(source, target)).toBe('merged')
    expect(readFileSync(join(target, 'cordis.patch.yml'), 'utf8')).toBe(`${bundledV2}${settings}`)
  })
})
