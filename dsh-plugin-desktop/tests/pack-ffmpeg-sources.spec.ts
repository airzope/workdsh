import { describe, expect, it } from 'vitest'
import { componentName, sourceFetch } from '../scripts/pack-ffmpeg-sources.ts'
import { FFMPEG_RELEASE } from '../scripts/prepare-workdsh-media.ts'

describe('FFmpeg corresponding source', () => {
  it('fetches tags, commits and pinned tarballs', () => {
    expect(sourceFetch({ name: 'Opus', version: 'v1.6.1', url: 'https://github.com/xiph/opus' }))
      .toEqual({ kind: 'tag', url: 'https://github.com/xiph/opus', tag: 'v1.6.1' })
    expect(sourceFetch({ name: 'x264', version: '0480cb0', url: 'https://code.videolan.org/videolan/x264.git' }))
      .toEqual({ kind: 'commit', url: 'https://code.videolan.org/videolan/x264.git', commit: '0480cb0' })
    expect(sourceFetch({ name: 'LAME', version: '3.100', url: 'https://example.test/lame-3.100.tar.gz/download', sha256: 'a'.repeat(64) }))
      .toEqual({ kind: 'download', url: 'https://example.test/lame-3.100.tar.gz/download', file: 'lame-3.100.tar.gz', sha256: 'a'.repeat(64) })
    expect(() => sourceFetch({ name: 'LAME', version: '3.100', url: 'https://example.test/lame-3.100.tar.gz' }))
      .toThrow(/needs a pinned sha256/u)
  })

  it('covers every component of the pinned build with a fetchable source', () => {
    const names = FFMPEG_RELEASE.sources.map(source => componentName(source.name))
    expect(names).toEqual(['ffmpeg', 'x264', 'x265', 'libvpx', 'svt-av1', 'opus', 'lame', 'mbed-tls', 'build-scripts'])
    for (const source of FFMPEG_RELEASE.sources) expect(() => sourceFetch(source)).not.toThrow()
  })
})
