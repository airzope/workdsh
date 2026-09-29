import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FFMPEG_RELEASE, parseEncoders, prepareWorkdshMedia, type MediaRelease } from '../scripts/prepare-workdsh-media.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')
const file = (name: string) => ({ url: `https://example.test/${name}`, sha256: sha256(name) })
const release: MediaRelease = {
  ...FFMPEG_RELEASE,
  targets: {
    'linux-x64': { ffmpeg: file('ffmpeg-linux-x64'), ffprobe: file('ffprobe-linux-x64') },
    'win32-x64': { ffmpeg: file('ffmpeg-win-x64.exe'), ffprobe: file('ffprobe-win-x64.exe') },
  },
  licenseText: file('COPYING.GPLv3'),
  encoders: ['libx264', 'aac'],
  optionalEncoders: ['h264_videotoolbox'],
}
const fetchBytes = async (url: string): Promise<Buffer> => Buffer.from(url.slice('https://example.test/'.length))

function desktop(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-media-'))
  roots.push(root)
  return root
}

describe('pinned FFmpeg', () => {
  it('pins ffmpeg and ffprobe for every Desktop target', () => {
    expect(Object.keys(FFMPEG_RELEASE.targets).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'])
    for (const files of Object.values(FFMPEG_RELEASE.targets)) {
      for (const pinned of [files.ffmpeg, files.ffprobe]) {
        expect(pinned.url).toMatch(/^https:\/\/github\.com\/shaka-project\/static-ffmpeg-binaries\/releases\/download\/n8\.1\.2-1\//u)
        expect(pinned.sha256).toMatch(/^[0-9a-f]{64}$/u)
      }
    }
  })

  it('parses encoder names from ffmpeg -encoders', () => {
    expect(parseEncoders(' V....D libx264              libx264 H.264\n A....D aac                  AAC\n ------\n')).toEqual(['libx264', 'aac'])
  })

  it('stages verified executables, the license, source directions and a manifest', async () => {
    const root = desktop()
    const media = await prepareWorkdshMedia({
      desktopRoot: root, platform: 'linux', arch: 'x64', release, fetchBytes,
      listEncoders: () => ['libx264', 'aac', 'h264_videotoolbox', 'mpeg4'],
    })

    expect(media).toBe(join(root, 'build', 'workdsh-runtime', 'media'))
    expect(readFileSync(join(media, 'bin', 'ffmpeg'), 'utf8')).toBe('ffmpeg-linux-x64')
    expect(readFileSync(join(media, 'bin', 'ffprobe'), 'utf8')).toBe('ffprobe-linux-x64')
    if (process.platform !== 'win32') expect(statSync(join(media, 'bin', 'ffmpeg')).mode & 0o111).toBe(0o111)
    expect(readFileSync(join(media, 'COPYING.GPLv3'), 'utf8')).toBe('COPYING.GPLv3')
    expect(readFileSync(join(media, 'SOURCES.md'), 'utf8')).toMatch(/\| x264 \| 0480cb0 \| https:\/\/code\.videolan\.org/u)
    expect(JSON.parse(readFileSync(join(media, 'manifest.json'), 'utf8'))).toMatchObject({
      version: '8.1.2', license: 'GPL-3.0-or-later', target: 'linux-x64', encoders: ['libx264', 'aac', 'h264_videotoolbox'],
    })
  })

  it('names Windows executables with .exe and rejects builds without the required encoders', async () => {
    const root = desktop()
    await prepareWorkdshMedia({ desktopRoot: root, platform: 'win32', arch: 'x64', release, fetchBytes, listEncoders: () => undefined })
    expect(existsSync(join(root, 'build', 'workdsh-runtime', 'media', 'bin', 'ffprobe.exe'))).toBe(true)

    await expect(prepareWorkdshMedia({ desktopRoot: root, platform: 'linux', arch: 'x64', release, fetchBytes, listEncoders: () => ['aac'] }))
      .rejects.toThrow(/lacks encoders: libx264/u)
    await expect(prepareWorkdshMedia({ desktopRoot: root, platform: 'linux', arch: 'ia32', release, fetchBytes }))
      .rejects.toThrow(/No pinned FFmpeg build for linux-ia32/u)
    await expect(prepareWorkdshMedia({ desktopRoot: desktop(), platform: 'linux', arch: 'x64', release, fetchBytes: async () => Buffer.from('tampered') }))
      .rejects.toThrow(/checksum mismatch/u)
  })
})
