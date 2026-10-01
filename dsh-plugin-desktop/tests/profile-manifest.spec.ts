import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_MANIFEST_COPY, mergeBundles, syncProfileManifest } from '../src/profile-manifest.ts'

const VOICE = '@deepseek-ai/dsh-experimental-voice-input-bundle'

function manifest(bundles: string[], version = '0.2.0-rc.1'): string {
  return `${JSON.stringify({ name: 'dsh-profile-workdsh', dependencies: { '@deepseek-ai/dsh': version }, dsh: { profile: { bundles } } }, undefined, 2)}\n`
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function profile(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-profile-manifest-'))
  roots.push(root)
  return root
}

describe('runtime Profile package.json', () => {
  it('applies the bundles the user added and removed to the new bundled list', () => {
    expect(mergeBundles(['base', 'web', 'skills'], ['base', 'web', 'skills', VOICE], ['base', 'web', 'skills'])).toEqual(['base', 'web', 'skills', VOICE])
    expect(mergeBundles(['base', 'web', 'skills', 'library'], ['base', 'web', VOICE], ['base', 'web', 'skills'])).toEqual(['base', 'web', 'library', VOICE])
    // Earlier releases left no record: additions are kept, nothing is removed.
    expect(mergeBundles(['base', 'web', 'library'], ['base', 'web', VOICE], undefined)).toEqual(['base', 'web', 'library', VOICE])
  })

  it('keeps Voice Input on across launches and updates', () => {
    const target = profile()
    const source = join(target, 'bundled.json')
    const file = join(target, 'package.json')
    writeFileSync(source, manifest(['base', 'web']))
    expect(syncProfileManifest(source, target)).toBe('installed')
    expect(readFileSync(join(target, BUNDLED_MANIFEST_COPY), 'utf8')).toBe(manifest(['base', 'web']))

    // The Plugins page turns Voice Input on.
    writeFileSync(file, manifest(['base', 'web', VOICE]))
    expect(syncProfileManifest(source, target)).toBe('unchanged')
    expect(readFileSync(file, 'utf8')).toBe(manifest(['base', 'web', VOICE]))

    // A new build changes its dependencies and bundles; the choice stays.
    writeFileSync(source, manifest(['base', 'web', 'library'], '0.2.0'))
    expect(syncProfileManifest(source, target)).toBe('updated')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(manifest(['base', 'web', 'library', VOICE], '0.2.0')))
  })

  it('installs the bundled file over one it cannot read', () => {
    const target = profile()
    const source = join(target, 'bundled.json')
    writeFileSync(source, manifest(['base']))
    writeFileSync(join(target, 'package.json'), '{ broken')
    expect(syncProfileManifest(source, target)).toBe('updated')
    expect(readFileSync(join(target, 'package.json'), 'utf8')).toBe(manifest(['base']))
  })
})
