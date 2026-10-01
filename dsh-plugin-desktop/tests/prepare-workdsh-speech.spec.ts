import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MODEL_FILE, SENSEVOICE_RELEASE, prepareWorkdshSpeech, speechCacheDirectory, type SpeechRelease,
} from '../scripts/prepare-workdsh-speech.ts'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

const files: Record<string, string> = {
  'https://hf.test/model.onnx': 'fp32 weights',
  'https://hf.test/tokens.txt': 'tokens',
  'https://hf.test/vad.onnx': 'vad',
  'https://raw.test/funasr': 'funasr license',
  'https://raw.test/silero': 'silero license',
}

const release: SpeechRelease = {
  model: 'test model',
  source: { urls: ['https://hf.test/model.onnx'], sha256: sha('fp32 weights'), bytes: 12, archive: { url: 'https://github.test/model.tar.bz2', member: 'm/model.onnx' } },
  tokens: { urls: ['https://hf.test/tokens.txt'], sha256: sha('tokens'), archiveMember: 'm/tokens.txt' },
  vad: { urls: ['https://down.test/vad.onnx', 'https://hf.test/vad.onnx'], sha256: sha('vad') },
  int4: { sha256: sha('int4 of fp32 weights'), bytes: 'int4 of fp32 weights'.length },
  licenses: {
    'LICENSE-FunASR-MODEL': { urls: ['https://raw.test/funasr'], sha256: sha('funasr license') },
    'LICENSE-silero-vad': { urls: ['https://raw.test/silero'], sha256: sha('silero license') },
  },
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function desktop(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-speech-prepare-'))
  roots.push(root)
  return root
}

const fetchBytes = async (url: string) => {
  const body = files[url]
  if (body === undefined) throw new Error(`${url} returned 404`)
  return Buffer.from(body)
}
const download = async (url: string, target: string) => { writeFileSync(target, await fetchBytes(url)) }
const quantize = (source: string, output: string, _work: string) => { writeFileSync(output, `int4 of ${readFileSync(source, 'utf8')}`) }

describe('bundled SenseVoice INT4 weights', () => {
  it('quantizes the verified source once and stages the folder DSH loads', async () => {
    const root = desktop()
    let quantized = 0
    const staged = await prepareWorkdshSpeech({ desktopRoot: root, release, fetchBytes, download, quantize: (...args) => { quantized++; quantize(...args) } })
    expect(staged).toBe(join(root, 'build', 'workdsh-runtime', 'speech', 'sensevoice'))
    expect(readFileSync(join(staged, MODEL_FILE), 'utf8')).toBe('int4 of fp32 weights')
    expect(readFileSync(join(staged, 'tokens.txt'), 'utf8')).toBe('tokens')
    expect(readFileSync(join(staged, 'silero_vad.onnx'), 'utf8')).toBe('vad')
    expect(readFileSync(join(staged, 'LICENSE-FunASR-MODEL'), 'utf8')).toBe('funasr license')
    const manifest = JSON.parse(readFileSync(join(staged, 'manifest.json'), 'utf8'))
    expect(manifest.precision).toBe('int4')
    expect(manifest.files[MODEL_FILE].sha256).toBe(release.int4.sha256)
    expect(readFileSync(join(staged, 'README.md'), 'utf8')).toContain('FunASR Model Open Source License')
    // The work folder with the FP32 source is gone; the cache is reused.
    expect(existsSync(join(root, 'build', '.workdsh-speech-work'))).toBe(false)
    await prepareWorkdshSpeech({ desktopRoot: root, release, fetchBytes: async () => { throw new Error('offline') }, quantize: () => { throw new Error('no') } })
    expect(quantized).toBe(1)
  })

  it('falls back to the sherpa-onnx archive and refuses weights that differ from the pin', async () => {
    const root = desktop()
    const extracted: string[][] = []
    const extract = async (_url: string, members: readonly string[], destination: string) => {
      extracted.push([...members])
      for (const member of members) {
        mkdirSync(join(destination, 'm'), { recursive: true })
        writeFileSync(join(destination, member), member.endsWith('model.onnx') ? 'fp32 weights' : 'tokens')
      }
    }
    const offlineHub = async (url: string) => {
      if (url.startsWith('https://hf.test/') && !url.endsWith('vad.onnx')) throw new Error('blocked')
      return fetchBytes(url)
    }
    await expect(prepareWorkdshSpeech({
      desktopRoot: root, release, fetchBytes: offlineHub, download: async () => { throw new Error('blocked') }, extract,
      quantize: (_source, output) => { writeFileSync(output, 'something else') },
    })).rejects.toThrow(/not the pinned/u)
    expect(extracted[0]).toEqual(['m/model.onnx', 'm/tokens.txt'])
    expect(existsSync(join(speechCacheDirectory(root, release), 'model.int4.onnx'))).toBe(false)
    const cache = await prepareWorkdshSpeech({ desktopRoot: root, release, fetchBytes: offlineHub, download: async () => { throw new Error('blocked') }, extract, quantize, cacheOnly: true })
    expect(statSync(join(cache, 'model.int4.onnx')).size).toBe(release.int4.bytes)
    expect(readFileSync(join(cache, 'tokens.txt'), 'utf8')).toBe('tokens')
  })

  it('pins the same SenseVoice export, tokens and VAD as the pinned DSH', () => {
    const assets = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'deepseek-harness', 'packages', 'experimental',
      'speech-to-text-sensevoice', 'runtime', 'assets.json'), 'utf8'))
    expect(SENSEVOICE_RELEASE.source.urls[0]).toBe(assets.models.fp32.url)
    expect(SENSEVOICE_RELEASE.source.sha256).toBe(assets.models.fp32.sha256)
    expect(SENSEVOICE_RELEASE.source.bytes).toBe(assets.models.fp32.bytes)
    expect(SENSEVOICE_RELEASE.tokens.urls[0]).toBe(assets.tokens.url)
    expect(SENSEVOICE_RELEASE.tokens.sha256).toBe(assets.tokens.sha256)
    expect(SENSEVOICE_RELEASE.vad.urls[0]).toBe(assets.vad.url)
    expect(SENSEVOICE_RELEASE.vad.sha256).toBe(assets.vad.sha256)
    expect(MODEL_FILE).toBe(assets.models.int8.name)
    expect(SENSEVOICE_RELEASE.int4.bytes).toBeLessThan(assets.models.int8.bytes * 0.7)
  })
})
