/**
 * Stage the pinned llama.cpp `llama-server` for this host in
 * build/workdsh-runtime/llama: bin/, manifest.json and the license texts.
 *
 * Windows and macOS use the official release archives. The official Ubuntu
 * builds need glibc 2.34+ and OpenSSL 3, so Linux builds the same release
 * inside ubuntu:20.04 (scripts/build-llama-linux.sh).
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readElfNeeded, readMachODylibs } from './binary-deps.ts'
import { fetchWithRetry, preparePinnedAsset, type FetchBytes, type PinnedAsset } from './pinned-asset.ts'
import { readPeImports } from './windows7-payload-audit.ts'

/** A file identified by its source URL and digest. */
export interface LlamaAsset {
  readonly url: string
  readonly sha256: string
}

/** How one target obtains llama-server. */
export type LlamaTarget =
  | { readonly kind: 'release', readonly archive: LlamaAsset, readonly root: string, readonly accelerator: string }
  | { readonly kind: 'build', readonly cmake: LlamaAsset, readonly accelerator: string }

/** A pinned llama.cpp release for every Desktop target. */
export interface LlamaRelease {
  readonly version: string
  readonly commit: string
  readonly repository: string
  readonly license: string
  readonly targets: Readonly<Record<string, LlamaTarget>>
  /** Upstream license texts shipped next to the executables. */
  readonly licenses: Readonly<Record<string, LlamaAsset>>
  /** Microsoft VC++ runtime DLLs for Windows, copied app-local from a pinned wheel. */
  readonly vcRuntime: {
    readonly version: string
    readonly wheel: LlamaAsset
    readonly directory: string
    readonly dlls: Readonly<Record<string, string>>
  }
  /** Base image of the Linux build. */
  readonly linuxImage: string
}

const RELEASES = 'https://github.com/ggml-org/llama.cpp/releases/download/b11247/'
const RAW = 'https://raw.githubusercontent.com/ggml-org/llama.cpp/0bc845d356f437d5ce4fe975c36428f7522829cb/'
const CMAKE = 'https://github.com/Kitware/CMake/releases/download/v3.31.8/'

/**
 * llama.cpp b11247. The Windows build is the Vulkan one: it is the CPU build
 * plus ggml-vulkan.dll, which loads only where a Vulkan driver exists.
 */
export const LLAMA_RELEASE: LlamaRelease = {
  version: 'b11247',
  commit: '0bc845d356f437d5ce4fe975c36428f7522829cb',
  repository: 'https://github.com/ggml-org/llama.cpp',
  license: 'MIT',
  targets: {
    'win32-x64': {
      kind: 'release',
      archive: { url: `${RELEASES}llama-b11247-bin-win-vulkan-x64.zip`, sha256: '2b5f479629fea7d33fdec232a67284fa0265ebcb5e4e42e5519cf13d001c8552' },
      root: '',
      accelerator: 'cpu+vulkan',
    },
    'darwin-arm64': {
      kind: 'release',
      archive: { url: `${RELEASES}llama-b11247-bin-macos-arm64.tar.gz`, sha256: 'ebf1ccab751a0a972dfb06225bc716174dffb0cf780206c03802e620b21f96e0' },
      root: 'llama-b11247',
      accelerator: 'cpu+metal',
    },
    'darwin-x64': {
      kind: 'release',
      archive: { url: `${RELEASES}llama-b11247-bin-macos-x64.tar.gz`, sha256: '19b2741ea76dec9e3f83a9a82b358a787b0b82eec286f296c19b5afceb277e11' },
      root: 'llama-b11247',
      accelerator: 'cpu',
    },
    'linux-x64': {
      kind: 'build',
      cmake: { url: `${CMAKE}cmake-3.31.8-linux-x86_64.tar.gz`, sha256: '630615d8e98ac33eba7fbe472626dff5c899c85af3c024585ae109166a6909d0' },
      accelerator: 'cpu',
    },
    'linux-arm64': {
      kind: 'build',
      cmake: { url: `${CMAKE}cmake-3.31.8-linux-aarch64.tar.gz`, sha256: '609735983e3bdf24b6ab379d918458d64196fe72b98226f62dd5e9fe7b2997cc' },
      accelerator: 'cpu',
    },
  },
  licenses: {
    'LICENSE': { url: `${RAW}LICENSE`, sha256: '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d' },
    'LICENSE-jsonhpp': { url: `${RAW}licenses/LICENSE-jsonhpp`, sha256: 'c0d068392ea65358b798b8c165103560f06e9e3b38c4ab4e2d8810a7b931af86' },
  },
  vcRuntime: {
    version: '14.44.35112',
    wheel: {
      url: 'https://files.pythonhosted.org/packages/21/3b/134d04268ab8e35853cd007582076429b45d60d6abb1036d159be9c50342/msvc_runtime-14.44.35112-cp312-cp312-win_amd64.whl',
      sha256: '32f9c706009e16ccc319d6947ce3bffe20e5192bee52b18cf48313f9e7bedfbe',
    },
    directory: 'msvc_runtime-14.44.35112.data/data/Scripts',
    dlls: {
      'msvcp140.dll': '0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9',
      'vcruntime140.dll': 'd5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066',
      'vcruntime140_1.dll': '1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f',
    },
  },
  linuxImage: 'ubuntu:20.04@sha256:8feb4d8ca5354def3d8fce243717141ce31e2c428701f6682bd2fafe15388214',
}

/** Name of the server executable on a platform. */
export function llamaServerName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'llama-server.exe' : 'llama-server'
}

/**
 * Whether a file is a ggml backend that llama-server loads at run time rather
 * than links. The RPC backend is left out: it only serves `--rpc`.
 * @param platform - Target platform.
 * @param name - File name.
 */
export function isDynamicBackend(platform: NodeJS.Platform, name: string): boolean {
  if (platform === 'win32') return /^ggml-(?!base\.dll$|rpc\.dll$)[\w.-]+\.dll$/iu.test(name)
  if (platform === 'linux') return /^libggml-(cpu-[\w.]+|vulkan)\.so$/u.test(name)
  return false
}

/** Libraries an image loads from its own directory. */
function localDependencies(platform: NodeJS.Platform, path: string): string[] {
  if (platform === 'win32') return readPeImports(path)?.imports ?? []
  if (platform === 'darwin') {
    return (readMachODylibs(path) ?? [])
      .filter(name => name.startsWith('@rpath/') || name.startsWith('@loader_path/') || name.startsWith('@executable_path/'))
      .map(name => basename(name))
  }
  return readElfNeeded(path) ?? []
}

/**
 * The files llama-server needs from an unpacked build: the server, its link
 * closure among the build's own libraries, and the run-time backends.
 * @param platform - Target platform.
 * @param directory - Unpacked build.
 * @returns File names in `directory`, sorted.
 */
export function serverClosure(platform: NodeJS.Platform, directory: string): string[] {
  const available = new Map(readdirSync(directory).map(name => [platform === 'win32' ? name.toLowerCase() : name, name]))
  const server = llamaServerName(platform)
  if (!available.has(platform === 'win32' ? server.toLowerCase() : server)) throw new Error(`${server} is missing from ${directory}`)
  const selected = new Set<string>()
  const pending = [server, ...[...available.values()].filter(name => isDynamicBackend(platform, name))]
  while (pending.length > 0) {
    const name = pending.pop()!
    if (selected.has(name)) continue
    selected.add(name)
    for (const dependency of localDependencies(platform, join(directory, name))) {
      const local = available.get(platform === 'win32' ? dependency.toLowerCase() : dependency)
      if (local !== undefined && !selected.has(local)) pending.push(local)
    }
  }
  return [...selected].sort()
}

/** Injectable host boundary. */
export interface LlamaPrepareOptions {
  readonly desktopRoot: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly release?: LlamaRelease
  readonly fetchBytes?: FetchBytes
  /** Unpack a zip or tar archive into a directory. */
  readonly extract?: (archive: string, destination: string) => void
  /** Produce the Linux build in a directory. */
  readonly buildLinux?: (release: LlamaRelease, target: Extract<LlamaTarget, { kind: 'build' }>, output: string) => void
  /** Report the version of a staged server; undefined skips the check (cross-target staging). */
  readonly serverVersion?: (server: string) => string | undefined
  readonly log?: (message: string) => void
}

function run(command: string, args: readonly string[], options: { cwd?: string } = {}): void {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

/** Unpack with the system tar, which reads zip archives on Windows and macOS. */
function extractWithTar(archive: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  run('tar', ['-xf', archive, '-C', destination])
}

/** Clone the pinned source and build it inside ubuntu:20.04 with Docker. */
function buildLinuxInDocker(release: LlamaRelease, target: Extract<LlamaTarget, { kind: 'build' }>, output: string): void {
  const work = `${output}.work`
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const source = join(work, 'source')
  run('git', ['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', release.version, release.repository, source])
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).stdout.trim()
  if (head !== release.commit) throw new Error(`llama.cpp ${release.version} resolved to ${head}, expected ${release.commit}`)
  const built = join(work, 'bin')
  mkdirSync(built)
  const script = fileURLToPath(new URL('./build-llama-linux.sh', import.meta.url))
  const owner = process.getuid !== undefined && process.getgid !== undefined ? `${String(process.getuid())}:${String(process.getgid())}` : ''
  run('docker', [
    'run', '--rm',
    '-v', `${source}:/src:ro`,
    '-v', `${built}:/out`,
    '-v', `${script}:/build.sh:ro`,
    '-e', `WORKDSH_OWNER=${owner}`,
    release.linuxImage,
    'bash', '/build.sh', '/src', '/out', target.cmake.url, target.cmake.sha256, release.version.replace(/^b/u, ''),
  ])
  rmSync(output, { recursive: true, force: true })
  renameSync(built, output)
  rmSync(work, { recursive: true, force: true })
}

function nativeServerVersion(server: string): string | undefined {
  const result = spawnSync(server, ['--version'], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`${server} --version failed: ${String(result.error ?? `${result.stdout}${result.stderr}`)}`)
  }
  return `${result.stdout}${result.stderr}`
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Cache key of the Linux build: the release pin and the build script.
 * @param release - Pinned release.
 */
export function linuxBuildKey(release: LlamaRelease): string {
  const script = readFileSync(fileURLToPath(new URL('./build-llama-linux.sh', import.meta.url)))
  return createHash('sha256').update(`${release.commit}\n${release.linuxImage}\n`).update(script).digest('hex').slice(0, 16)
}

/**
 * Download or build, verify, and stage llama-server for one host.
 * @param options - Host boundary.
 * @returns The llama directory.
 */
export async function prepareWorkdshLlama(options: LlamaPrepareOptions): Promise<string> {
  const release = options.release ?? LLAMA_RELEASE
  const target = `${options.platform}-${options.arch}`
  const pinned = release.targets[target]
  if (pinned === undefined) throw new Error(`No pinned llama.cpp build for ${target}`)
  const fetchBytes = options.fetchBytes ?? fetchWithRetry
  const extract = options.extract ?? extractWithTar
  const cache = join(options.desktopRoot, 'build', '.workdsh-llama-cache', release.version, target)

  let unpacked: string
  if (pinned.kind === 'release') {
    const archive = await preparePinnedAsset(
      { label: `llama.cpp ${release.version} (${target})`, ...pinned.archive },
      join(cache, basename(new URL(pinned.archive.url).pathname)),
      fetchBytes,
    )
    const destination = join(cache, `unpacked-${pinned.archive.sha256.slice(0, 16)}`)
    if (!existsSync(join(destination, '.complete'))) {
      rmSync(destination, { recursive: true, force: true })
      extract(archive, destination)
      writeFileSync(join(destination, '.complete'), '')
    }
    unpacked = join(destination, pinned.root)
  } else {
    const destination = join(cache, `build-${linuxBuildKey(release)}`)
    if (!existsSync(join(destination, llamaServerName(options.platform)))) {
      options.log?.(`Building llama.cpp ${release.version} for ${target} in ubuntu:20.04`)
      mkdirSync(cache, { recursive: true })
      ;(options.buildLinux ?? buildLinuxInDocker)(release, pinned, destination)
    }
    unpacked = destination
  }

  const llama = join(options.desktopRoot, 'build', 'workdsh-runtime', 'llama')
  rmSync(llama, { recursive: true, force: true })
  const bin = join(llama, 'bin')
  mkdirSync(bin, { recursive: true })
  const files = serverClosure(options.platform, unpacked)
  for (const name of files) {
    // Symlinks become regular files under the name the loader asks for.
    const source = join(unpacked, name)
    if (!statSync(source).isFile()) throw new Error(`${source} is not a file`)
    copyFileSync(source, join(bin, name))
    if (options.platform !== 'win32') chmodSync(join(bin, name), 0o755)
  }

  const staged = [...files]
  if (options.platform === 'win32') {
    const runtime = release.vcRuntime
    const wheel = await preparePinnedAsset(
      { label: `Microsoft VC++ runtime ${runtime.version}`, ...runtime.wheel },
      join(options.desktopRoot, 'build', '.workdsh-llama-cache', 'vc-runtime', basename(new URL(runtime.wheel.url).pathname)),
      fetchBytes,
    )
    const unpackedWheel = join(options.desktopRoot, 'build', '.workdsh-llama-cache', 'vc-runtime', runtime.version)
    rmSync(unpackedWheel, { recursive: true, force: true })
    extract(wheel, unpackedWheel)
    for (const [dll, sha256] of Object.entries(runtime.dlls)) {
      const source = join(unpackedWheel, runtime.directory, dll)
      const digest = existsSync(source) ? sha256File(source) : 'missing'
      if (digest !== sha256) throw new Error(`VC++ runtime ${dll} checksum mismatch: expected ${sha256}, received ${digest}`)
      copyFileSync(source, join(bin, dll))
      staged.push(dll)
    }
  }

  const licenses: string[] = []
  for (const [name, asset] of Object.entries(release.licenses)) {
    const pinnedLicense: PinnedAsset = { label: `llama.cpp ${name}`, ...asset }
    const source = await preparePinnedAsset(pinnedLicense, join(options.desktopRoot, 'build', '.workdsh-llama-cache', release.version, 'licenses', name), fetchBytes)
    copyFileSync(source, join(llama, name))
    licenses.push(name)
  }

  const reported = (options.serverVersion ?? nativeServerVersion)(join(bin, llamaServerName(options.platform)))
  if (reported !== undefined && !reported.includes(release.version.replace(/^b/u, ''))) {
    throw new Error(`Staged llama-server reports an unexpected version: ${reported.trim()}`)
  }
  writeFileSync(join(llama, 'manifest.json'), `${JSON.stringify({
    name: 'llama.cpp',
    version: release.version,
    commit: release.commit,
    license: release.license,
    target,
    source: pinned.kind === 'release' ? pinned.archive.url : `${release.repository} (built in ${release.linuxImage})`,
    accelerator: pinned.accelerator,
    server: `bin/${llamaServerName(options.platform)}`,
    files: staged.sort().map(name => `bin/${name}`),
    licenses,
    ...(options.platform === 'win32' ? { vcRuntime: release.vcRuntime.version } : {}),
  }, undefined, 2)}\n`)
  options.log?.(`Staged llama.cpp ${release.version} for ${target} (${String(staged.length)} files) in ${llama}`)
  return llama
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    await prepareWorkdshLlama({
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
