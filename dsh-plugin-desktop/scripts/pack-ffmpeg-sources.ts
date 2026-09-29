/**
 * Assemble the corresponding source of the bundled FFmpeg build (GPLv3 §6):
 * one archive per upstream component at the exact version the build used,
 * with the license text and the directions that ship next to the executables.
 * Usage: node scripts/pack-ffmpeg-sources.ts <output.tar.gz>
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preparePinnedAsset } from './pinned-asset.ts'
import { FFMPEG_RELEASE, type MediaRelease } from './prepare-workdsh-media.ts'

/** How one upstream source is fetched. */
export type SourceFetch =
  | { readonly kind: 'download', readonly url: string, readonly file: string, readonly sha256: string }
  | { readonly kind: 'tag', readonly url: string, readonly tag: string }
  | { readonly kind: 'commit', readonly url: string, readonly commit: string }

/**
 * Classify a pinned source: tarball URLs are downloaded, hexadecimal versions
 * are commits, and anything else is a tag.
 * @param source - Entry of the release's source list.
 * @returns How to fetch it.
 */
export function sourceFetch(source: MediaRelease['sources'][number]): SourceFetch {
  const tarball = /\/([^/]+\.tar\.(?:gz|xz|bz2))(?:\/download)?$/u.exec(source.url)
  if (tarball !== null) {
    if (source.sha256 === undefined) throw new Error(`${source.name}: a downloaded source archive needs a pinned sha256`)
    return { kind: 'download', url: source.url, file: tarball[1]!, sha256: source.sha256 }
  }
  if (/^[0-9a-f]{7,40}$/u.test(source.version)) return { kind: 'commit', url: source.url, commit: source.version }
  return { kind: 'tag', url: source.url, tag: source.version }
}

/** Archive-safe component name. */
export function componentName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
}

function git(args: readonly string[], cwd?: string): void {
  const result = spawnSync('git', ['-c', 'advice.detachedHead=false', ...args], { cwd, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} exited with ${String(result.status)}`)
}

function tar(args: readonly string[]): void {
  const result = spawnSync('tar', args, { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`tar ${args.join(' ')} exited with ${String(result.status)}`)
}

/**
 * Fetch every source and write one gzip tarball.
 * @param output - Destination archive.
 * @param release - Pinned FFmpeg release.
 */
export async function packFfmpegSources(output: string, release: MediaRelease = FFMPEG_RELEASE): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'workdsh-ffmpeg-sources-'))
  try {
    const bundleName = `ffmpeg-${release.version}-corresponding-source`
    const bundle = join(work, bundleName)
    mkdirSync(bundle)
    for (const source of release.sources) {
      const name = componentName(source.name)
      const fetch = sourceFetch(source)
      console.log(`Fetching ${source.name} ${source.version} from ${source.url}`)
      if (fetch.kind === 'download') {
        await preparePinnedAsset({ label: `${source.name} ${source.version} source`, url: fetch.url, sha256: fetch.sha256 }, join(bundle, fetch.file))
        continue
      }
      const checkout = join(work, name)
      if (fetch.kind === 'tag') git(['clone', '--quiet', '--depth', '1', '--branch', fetch.tag, fetch.url, checkout])
      else git(['clone', '--quiet', fetch.url, checkout])
      const ref = fetch.kind === 'tag' ? 'HEAD' : fetch.commit
      git(['archive', '--format=tar.gz', `--prefix=${name}-${source.version}/`, '-o', join(bundle, `${name}-${source.version}.tar.gz`), ref], checkout)
    }
    await preparePinnedAsset({ label: 'FFmpeg COPYING.GPLv3', ...release.licenseText }, join(bundle, 'COPYING.GPLv3'))
    writeFileSync(join(bundle, 'README.md'), `# FFmpeg ${release.version} — corresponding source

Source of the FFmpeg and FFprobe executables that WorkDSH Desktop installers
bundle: ${release.build}, licensed under the GNU General Public License
version 3 or later (see COPYING.GPLv3). Each archive holds one component at
the version the build used:

${release.sources.map(source => `- ${source.name} ${source.version}: ${source.url}`).join('\n')}
`)
    mkdirSync(dirname(resolve(output)), { recursive: true })
    tar(['-C', work, '-czf', resolve(output), bundleName])
    console.log(`Wrote ${resolve(output)}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2]
  if (output === undefined) {
    console.error('Usage: node scripts/pack-ffmpeg-sources.ts <output.tar.gz>')
    process.exitCode = 1
  } else {
    try {
      await packFfmpegSources(output)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
