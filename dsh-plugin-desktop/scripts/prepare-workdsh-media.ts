/**
 * Stage the pinned FFmpeg and FFprobe builds for this host in
 * build/workdsh-runtime/media: bin/, manifest.json, the GPLv3 text and the
 * directions to the corresponding source.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchWithRetry, preparePinnedAsset, type FetchBytes } from './pinned-asset.ts'

/** One file of a pinned FFmpeg release. */
export interface MediaAsset {
  readonly url: string
  readonly sha256: string
}

/** A pinned static FFmpeg release for every Desktop target. */
export interface MediaRelease {
  readonly version: string
  readonly build: string
  readonly license: string
  readonly targets: Readonly<Record<string, { readonly ffmpeg: MediaAsset, readonly ffprobe: MediaAsset }>>
  readonly licenseText: MediaAsset
  /** Encoders every target's build must provide. */
  readonly encoders: readonly string[]
  /** Encoders only some targets provide, recorded when present. */
  readonly optionalEncoders: readonly string[]
  /** Upstream sources of the build, for the GPL source directions. */
  readonly sources: readonly { readonly name: string, readonly version: string, readonly url: string, readonly sha256?: string }[]
}

const SHAKA = 'https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.1.2-1/'
const asset = (file: string, sha256: string): MediaAsset => ({ url: `${SHAKA}${file}`, sha256 })

/**
 * Shaka Project's static FFmpeg 8.1.2 builds: one public pipeline and one
 * configuration for every target. Windows links msvcrt and imports nothing
 * newer than Windows 7; Linux is static (musl); macOS needs 15.0.
 */
export const FFMPEG_RELEASE: MediaRelease = {
  version: '8.1.2',
  build: 'shaka-project/static-ffmpeg-binaries n8.1.2-1 (88caac417541f3bb678fa6670cb73f2d74c7aaf9)',
  license: 'GPL-3.0-or-later',
  targets: {
    'win32-x64': {
      ffmpeg: asset('ffmpeg-win-x64.exe', '4044b3924c977ad31229d504c5d5b8685f9553124fbaff6e9c99048b42830341'),
      ffprobe: asset('ffprobe-win-x64.exe', 'fc37ca23d31ee08bb8f7e108edf3822f6ef3efc1a8d306bbe0b779190230710b'),
    },
    'linux-x64': {
      ffmpeg: asset('ffmpeg-linux-x64', '9eac5b2b5076db5ff853a6fa0dcd6b8de7d0cac8481eadda6c47cd935825f1ee'),
      ffprobe: asset('ffprobe-linux-x64', '065d3c56926052a76e884c4e4b51b7d95248da9391ab7effdcca6b94ceab98cf'),
    },
    'linux-arm64': {
      ffmpeg: asset('ffmpeg-linux-arm64', '6e7b1d7d1aa8c35e3fedd78a140aa0968717aeb7386ecfb0ee00773d9f0a4503'),
      ffprobe: asset('ffprobe-linux-arm64', 'fd2aca1456f0261cabef4514b6d97a70fa342003347f51b39c473dd364328089'),
    },
    'darwin-x64': {
      ffmpeg: asset('ffmpeg-osx-x64', '62c87854d851f202fc4a29bdda0fe7b6ebcddd37b863482ce1bdc81151b03fe4'),
      ffprobe: asset('ffprobe-osx-x64', 'd530823f480a3c7eb6334f18a00197d1e9f1070e86172b9aa89c4bf4022bd879'),
    },
    'darwin-arm64': {
      ffmpeg: asset('ffmpeg-osx-arm64', 'e7b9fcd97f95f333512d6e8b8ac24d9dbc08f189f36047695499bd7b57214b22'),
      ffprobe: asset('ffprobe-osx-arm64', 'ded4c698b8ff38d0bc1fd30fcc5e768dc46f58bc15a8dfd61f98615ba49cde5c'),
    },
  },
  licenseText: {
    url: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.1.2/COPYING.GPLv3',
    sha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
  },
  encoders: ['libx264', 'libx265', 'libvpx', 'libvpx-vp9', 'libsvtav1', 'libopus', 'libmp3lame', 'aac', 'flac', 'pcm_s16le', 'gif', 'mjpeg'],
  optionalEncoders: ['h264_videotoolbox', 'hevc_videotoolbox'],
  sources: [
    { name: 'FFmpeg', version: 'n8.1.2', url: 'https://git.ffmpeg.org/ffmpeg.git' },
    { name: 'x264', version: '0480cb0', url: 'https://code.videolan.org/videolan/x264.git' },
    { name: 'x265', version: '4.2', url: 'https://bitbucket.org/multicoreware/x265_git.git' },
    { name: 'libvpx', version: 'v1.16.0', url: 'https://chromium.googlesource.com/webm/libvpx' },
    { name: 'SVT-AV1', version: 'v4.1.0', url: 'https://gitlab.com/AOMediaCodec/SVT-AV1' },
    { name: 'Opus', version: 'v1.6.1', url: 'https://github.com/xiph/opus' },
    { name: 'LAME', version: '3.100', url: 'https://sourceforge.net/projects/lame/files/lame/3.100/lame-3.100.tar.gz/download', sha256: 'ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e' },
    { name: 'Mbed TLS', version: 'v3.4.1', url: 'https://github.com/Mbed-TLS/mbedtls' },
    { name: 'Build scripts', version: '88caac417541f3bb678fa6670cb73f2d74c7aaf9', url: 'https://github.com/shaka-project/static-ffmpeg-binaries' },
  ],
}

/** Injectable host boundary. */
export interface MediaPrepareOptions {
  readonly desktopRoot: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly release?: MediaRelease
  readonly fetchBytes?: FetchBytes
  /** List the encoders of a staged ffmpeg; undefined skips the check (cross-target staging). */
  readonly listEncoders?: (ffmpeg: string) => readonly string[] | undefined
  readonly log?: (message: string) => void
}

/**
 * Encoder names from `ffmpeg -encoders` output.
 * @param output - Command output.
 * @returns Encoder names.
 */
export function parseEncoders(output: string): string[] {
  return [...output.matchAll(/^ [VAS][F.][S.][X.][B.][D.] (\S+)/gmu)].map(match => match[1]!)
}

function listNativeEncoders(ffmpeg: string): readonly string[] {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`${ffmpeg} -encoders failed: ${String(result.error ?? result.stderr)}`)
  }
  return parseEncoders(result.stdout)
}

function sourceDirections(release: MediaRelease): string {
  return `# FFmpeg ${release.version} — corresponding source

The \`bin/\` executables are ${release.build}, licensed under the GNU General
Public License version 3 or later (see \`COPYING.GPLv3\`). WorkDSH runs them as
separate programs and does not link to them.

They were built from these upstream sources by the public build scripts listed
last; each WorkDSH release that ships them also provides these sources.

| Component | Version | Source |
| --- | --- | --- |
${release.sources.map(source => `| ${source.name} | ${source.version} | ${source.url} |`).join('\n')}
`
}

/**
 * Download, verify and stage the FFmpeg build for one host.
 * @param options - Host boundary.
 * @returns The media directory.
 */
export async function prepareWorkdshMedia(options: MediaPrepareOptions): Promise<string> {
  const release = options.release ?? FFMPEG_RELEASE
  const target = `${options.platform}-${options.arch}`
  const files = release.targets[target]
  if (files === undefined) throw new Error(`No pinned FFmpeg build for ${target}`)
  const cache = join(options.desktopRoot, 'build', '.workdsh-media-cache', release.version, target)
  const fetchBytes = options.fetchBytes ?? fetchWithRetry
  const suffix = options.platform === 'win32' ? '.exe' : ''
  const [ffmpegSource, ffprobeSource, licenseSource] = await Promise.all([
    preparePinnedAsset({ label: `FFmpeg ${release.version} ffmpeg (${target})`, ...files.ffmpeg }, join(cache, `ffmpeg${suffix}`), fetchBytes),
    preparePinnedAsset({ label: `FFmpeg ${release.version} ffprobe (${target})`, ...files.ffprobe }, join(cache, `ffprobe${suffix}`), fetchBytes),
    preparePinnedAsset({ label: 'FFmpeg COPYING.GPLv3', ...release.licenseText }, join(cache, 'COPYING.GPLv3'), fetchBytes),
  ])
  const media = join(options.desktopRoot, 'build', 'workdsh-runtime', 'media')
  rmSync(media, { recursive: true, force: true })
  mkdirSync(join(media, 'bin'), { recursive: true })
  const ffmpeg = join(media, 'bin', `ffmpeg${suffix}`)
  const ffprobe = join(media, 'bin', `ffprobe${suffix}`)
  copyFileSync(ffmpegSource, ffmpeg)
  copyFileSync(ffprobeSource, ffprobe)
  chmodSync(ffmpeg, 0o755)
  chmodSync(ffprobe, 0o755)
  copyFileSync(licenseSource, join(media, 'COPYING.GPLv3'))
  writeFileSync(join(media, 'SOURCES.md'), sourceDirections(release))

  const listed = (options.listEncoders ?? listNativeEncoders)(ffmpeg)
  let encoders = [...release.encoders]
  if (listed !== undefined) {
    const missing = release.encoders.filter(name => !listed.includes(name))
    if (missing.length > 0) throw new Error(`The pinned FFmpeg build for ${target} lacks encoders: ${missing.join(', ')}`)
    encoders = [...encoders, ...release.optionalEncoders.filter(name => listed.includes(name))]
  }
  writeFileSync(join(media, 'manifest.json'), `${JSON.stringify({
    version: release.version,
    build: release.build,
    license: release.license,
    target,
    encoders,
    files: { ffmpeg: files.ffmpeg, ffprobe: files.ffprobe },
  }, undefined, 2)}\n`)
  options.log?.(`Staged FFmpeg ${release.version} for ${target} in ${media}`)
  return media
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    await prepareWorkdshMedia({
      desktopRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      platform: process.platform,
      // Packages are built natively for their architecture, so the staged build can run here.
      arch: process.arch,
      log: message => console.log(message),
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
