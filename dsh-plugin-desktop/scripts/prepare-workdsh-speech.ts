/**
 * Stage SenseVoiceSmall INT4 weights, its tokens and the Silero VAD in
 * build/workdsh-runtime/speech/sensevoice, so DSH's local speech-to-text
 * works without downloading a model.
 *
 * The INT4 file is made here from the FP32 export that DSH 0.2.0-rc.1 pins,
 * by scripts/sensevoice/quantize.py with the hash-pinned wheels of
 * scripts/sensevoice/requirements.txt, and must match its pinned SHA-256.
 * The verified files are kept in build/.workdsh-speech-cache, which CI builds
 * once and hands to every packaging job.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { fetchWithRetry, type FetchBytes } from './pinned-asset.ts'

/** A file with every place it can be fetched from and its digest. */
export interface SpeechAsset {
  readonly urls: readonly string[]
  readonly sha256: string
}

/** The pinned speech assets. */
export interface SpeechRelease {
  /** Model name kept as the FunASR model license requires. */
  readonly model: string
  /** The FP32 export DSH pins, and the sherpa-onnx archive that carries the same bytes. */
  readonly source: SpeechAsset & { readonly bytes: number, readonly archive: { readonly url: string, readonly member: string } }
  readonly tokens: SpeechAsset & { readonly archiveMember: string }
  readonly vad: SpeechAsset
  /** The quantized weights the recipe must reproduce. */
  readonly int4: { readonly sha256: string, readonly bytes: number }
  readonly licenses: Readonly<Record<string, SpeechAsset>>
}

const HF = 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/'
const ARCHIVE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2'
const ARCHIVE_ROOT = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/'

/** SenseVoiceSmall 2024-07-17 as DSH 0.2.0-rc.1 pins it, quantized to INT4. */
export const SENSEVOICE_RELEASE: SpeechRelease = {
  model: 'iic/SenseVoiceSmall (sherpa-onnx export 2024-07-17)',
  source: {
    urls: [`${HF}model.onnx`],
    sha256: '977016bd9c79f9eb343430b5cc305e07ab64d5212dff41b0dcfa1694bee9a8cb',
    bytes: 937_617_178,
    archive: { url: ARCHIVE, member: `${ARCHIVE_ROOT}model.onnx` },
  },
  tokens: {
    urls: [`${HF}tokens.txt`],
    sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
    archiveMember: `${ARCHIVE_ROOT}tokens.txt`,
  },
  vad: {
    urls: [
      'https://huggingface.co/csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc/silero_vad.onnx',
      // The same file under its versioned name in sherpa-onnx's releases.
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v4.onnx',
    ],
    sha256: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28',
  },
  int4: { sha256: 'bd13a01e4ed3099920931a9f3874c71544f7d48f5fdb277406b2e756cb2cd1a4', bytes: 154_616_782 },
  licenses: {
    'LICENSE-FunASR-MODEL': {
      urls: ['https://raw.githubusercontent.com/modelscope/FunASR/800f7565e8e850b079b9e111d12107c19fc6121f/MODEL_LICENSE'],
      sha256: '7dba975a2069691db4992b0592d70828b330d2f8a30a71450f4e152a554e84f8',
    },
    'LICENSE-silero-vad': {
      urls: ['https://raw.githubusercontent.com/snakers4/silero-vad/1e261b036686cd0017d500ee96acd1c4ba572a9d/LICENSE'],
      sha256: '2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b',
    },
  },
}

/**
 * The file DSH loads from an explicit model folder. DSH 0.2.0-rc.1 names
 * weights only by its `int8` and `fp32` choices, and `int8` is its default,
 * so the INT4 weights take that name; manifest.json records what they are.
 */
export const MODEL_FILE = 'model.int8.onnx'

/** Files of the cache, and of the staged folder under their staged names. */
const CACHE_FILES = ['model.int4.onnx', 'tokens.txt', 'silero_vad.onnx'] as const

/** Make the INT4 file from the verified FP32 source. */
export type Quantize = (source: string, output: string, work: string) => void

/** Fetch one archive member into a file. */
export type ExtractMember = (archiveUrl: string, members: readonly string[], destination: string) => Promise<void>

export interface SpeechPrepareOptions {
  readonly desktopRoot: string
  readonly release?: SpeechRelease
  /** Download a small file. */
  readonly fetchBytes?: FetchBytes
  /** Stream a large file to disk. */
  readonly download?: (url: string, target: string) => Promise<void>
  readonly extract?: ExtractMember
  readonly quantize?: Quantize
  /** Only fill the cache. */
  readonly cacheOnly?: boolean
  readonly log?: (message: string) => void
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('error', reject).on('data', chunk => hash.update(chunk)).on('end', () => resolveDigest(hash.digest('hex')))
  })
}

async function verified(path: string, sha256: string): Promise<boolean> {
  return existsSync(path) && await sha256File(path) === sha256
}

async function streamDownload(url: string, target: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(1_800_000) })
  if (!response.ok || response.body === null) throw new Error(`${url} returned ${String(response.status)}`)
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(target))
}

/** Stream a .tar.bz2 through tar and keep the named members. */
async function extractFromArchive(archiveUrl: string, members: readonly string[], destination: string): Promise<void> {
  mkdirSync(destination, { recursive: true })
  const response = await fetch(archiveUrl, { redirect: 'follow', signal: AbortSignal.timeout(3_600_000) })
  if (!response.ok || response.body === null) throw new Error(`${archiveUrl} returned ${String(response.status)}`)
  const tar = spawn('tar', ['-xjf', '-', '-C', destination, ...members], { stdio: ['pipe', 'inherit', 'inherit'] })
  const exited = new Promise<number | null>((resolveExit, reject) => { tar.once('error', reject); tar.once('exit', resolveExit) })
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), tar.stdin)
  const code = await exited
  if (code !== 0) throw new Error(`tar could not extract ${members.join(', ')} from ${archiveUrl}`)
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
}

/** Run the recipe in a virtual environment with the pinned wheels. */
function quantizeWithPython(source: string, output: string, work: string): void {
  const recipe = fileURLToPath(new URL('./sensevoice/', import.meta.url))
  const python = process.env.WORKDSH_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
  const venv = join(work, 'venv')
  if (!existsSync(venv)) run(python, ['-m', 'venv', venv])
  const venvPython = process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')
  run(venvPython, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--require-hashes', '--only-binary=:all:', '-r', join(recipe, 'requirements.txt')])
  run(venvPython, [join(recipe, 'quantize.py'), source, output])
}

/** The verified cache folder for this release. */
export function speechCacheDirectory(desktopRoot: string, release: SpeechRelease = SENSEVOICE_RELEASE): string {
  return join(desktopRoot, 'build', '.workdsh-speech-cache', release.int4.sha256.slice(0, 16))
}

/**
 * Fill the cache with every verified file, making the INT4 weights when they are missing.
 * @returns The cache folder.
 */
export async function prepareSpeechCache(options: SpeechPrepareOptions): Promise<string> {
  const release = options.release ?? SENSEVOICE_RELEASE
  const fetchBytes = options.fetchBytes ?? fetchWithRetry
  const download = options.download ?? streamDownload
  const extract = options.extract ?? extractFromArchive
  const cache = speechCacheDirectory(options.desktopRoot, release)
  const work = join(options.desktopRoot, 'build', '.workdsh-speech-work')
  mkdirSync(cache, { recursive: true })

  const fetchSmall = async (label: string, asset: SpeechAsset, target: string): Promise<boolean> => {
    if (await verified(target, asset.sha256)) return true
    for (const url of asset.urls) {
      try {
        const bytes = await fetchBytes(url)
        if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`${label} from ${url} has another SHA-256`)
        writeFileSync(`${target}.tmp`, bytes)
        renameSync(`${target}.tmp`, target)
        return true
      } catch (error) {
        options.log?.(`${label}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return false
  }

  for (const [name, asset] of Object.entries(release.licenses)) {
    if (!await fetchSmall(name, asset, join(cache, name))) throw new Error(`Cannot fetch ${name}`)
  }
  if (!await fetchSmall('Silero VAD', release.vad, join(cache, 'silero_vad.onnx'))) throw new Error('Cannot fetch the Silero VAD model')
  const tokensReady = await fetchSmall('SenseVoice tokens', release.tokens, join(cache, 'tokens.txt'))
  const int4 = join(cache, 'model.int4.onnx')
  const int4Ready = await verified(int4, release.int4.sha256)
  if (tokensReady && int4Ready) return cache

  // The FP32 source: DSH's pinned file, or the sherpa-onnx archive that holds the same bytes.
  mkdirSync(work, { recursive: true })
  const source = join(work, 'model.onnx')
  const fromArchive = join(work, 'archive')
  if (!await verified(source, release.source.sha256)) {
    let fetched = false
    for (const url of release.source.urls) {
      try {
        options.log?.(`Downloading the SenseVoice FP32 export (${String(Math.round(release.source.bytes / 1e6))} MB)`)
        await download(url, `${source}.tmp`)
        renameSync(`${source}.tmp`, source)
        fetched = await verified(source, release.source.sha256)
        if (fetched) break
      } catch (error) {
        options.log?.(`SenseVoice FP32 export: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (!fetched) {
      options.log?.(`Extracting the SenseVoice FP32 export from ${release.source.archive.url}`)
      await extract(release.source.archive.url, [release.source.archive.member, release.tokens.archiveMember], fromArchive)
      renameSync(join(fromArchive, release.source.archive.member), source)
      if (!await verified(source, release.source.sha256)) throw new Error('The SenseVoice FP32 export does not match the SHA-256 DSH pins')
    }
  }
  if (!tokensReady) {
    const extracted = join(fromArchive, release.tokens.archiveMember)
    if (!existsSync(extracted)) await extract(release.source.archive.url, [release.tokens.archiveMember], fromArchive)
    if (!await verified(extracted, release.tokens.sha256)) throw new Error('The SenseVoice tokens do not match the SHA-256 DSH pins')
    copyFileSync(extracted, join(cache, 'tokens.txt'))
  }
  if (!int4Ready) {
    options.log?.('Quantizing SenseVoiceSmall to INT4')
    ;(options.quantize ?? quantizeWithPython)(source, `${int4}.tmp`, work)
    const digest = await sha256File(`${int4}.tmp`)
    if (digest !== release.int4.sha256) {
      rmSync(`${int4}.tmp`, { force: true })
      throw new Error(`The INT4 weights have SHA-256 ${digest}, not the pinned ${release.int4.sha256}`)
    }
    renameSync(`${int4}.tmp`, int4)
  }
  rmSync(work, { recursive: true, force: true })
  return cache
}

/** The note staged beside the weights. */
export function speechReadme(release: SpeechRelease = SENSEVOICE_RELEASE): string {
  return [
    '# SenseVoiceSmall INT4 for offline voice input',
    '',
    `Model: ${release.model}, by Alibaba Group's FunAudioLLM team (FunASR),`,
    'https://github.com/FunAudioLLM/SenseVoice, as exported to ONNX by k2-fsa/sherpa-onnx.',
    `\`${MODEL_FILE}\` holds that model with its MatMul weights quantized to 4 bits`,
    '(ONNX Runtime MatMulNBits, blocks of 32, asymmetric, round-to-nearest). It keeps',
    'the name of DSH\'s default INT8 weights so DSH loads it from this folder; see manifest.json.',
    'The model is used under the FunASR Model Open Source License (LICENSE-FunASR-MODEL).',
    '',
    '`silero_vad.onnx` is the Silero VAD (https://github.com/snakers4/silero-vad, MIT, LICENSE-silero-vad).',
    '',
  ].join('\n')
}

/**
 * Fill the cache and stage the folder the installers carry.
 * @returns The staged folder, or the cache folder with `cacheOnly`.
 */
export async function prepareWorkdshSpeech(options: SpeechPrepareOptions): Promise<string> {
  const release = options.release ?? SENSEVOICE_RELEASE
  const cache = await prepareSpeechCache(options)
  if (options.cacheOnly) {
    options.log?.(`SenseVoice INT4 cache ready in ${cache}`)
    return cache
  }
  const speech = join(options.desktopRoot, 'build', 'workdsh-runtime', 'speech', 'sensevoice')
  rmSync(speech, { recursive: true, force: true })
  mkdirSync(speech, { recursive: true })
  copyFileSync(join(cache, 'model.int4.onnx'), join(speech, MODEL_FILE))
  for (const name of [...CACHE_FILES.slice(1), ...Object.keys(release.licenses)]) copyFileSync(join(cache, name), join(speech, name))
  writeFileSync(join(speech, 'README.md'), speechReadme(release))
  writeFileSync(join(speech, 'manifest.json'), `${JSON.stringify({
    model: release.model,
    precision: 'int4',
    quantization: { method: 'onnxruntime MatMulNBits', bits: 4, blockSize: 32, symmetric: false, recipe: 'scripts/sensevoice/quantize.py' },
    source: { sha256: release.source.sha256, bytes: release.source.bytes },
    files: {
      [MODEL_FILE]: { sha256: release.int4.sha256, bytes: release.int4.bytes },
      'tokens.txt': { sha256: release.tokens.sha256 },
      'silero_vad.onnx': { sha256: release.vad.sha256 },
    },
    license: 'FunASR Model Open Source License 1.1; Silero VAD: MIT',
  }, undefined, 2)}\n`)
  if (statSync(join(speech, MODEL_FILE)).size !== release.int4.bytes) throw new Error('The staged INT4 weights have the wrong size')
  options.log?.(`Staged SenseVoiceSmall INT4 and the Silero VAD in ${speech}`)
  return speech
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    await prepareWorkdshSpeech({
      desktopRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      cacheOnly: process.argv.includes('--cache-only'),
      log: message => console.log(message),
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
