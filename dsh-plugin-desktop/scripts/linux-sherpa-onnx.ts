/** Rebuild sherpa-onnx's Node-API binding for Ubuntu 20.04 when the published one needs a newer glibc. */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { ELF_MACHINES, exceedsUbuntu2004, readElfVersionNeeds } from './linux-glibc-audit.ts'

/**
 * Source of the sherpa-onnx-node release that the pinned DSH installs for its
 * experimental local SenseVoice speech-to-text. Upstream compiles the x64
 * binding on its CI host, so it needs GLIBC_2.32 and GLIBCXX_3.4.29, while the
 * C API and ONNX Runtime libraries next to it are built for glibc 2.17. The
 * binding's sources live under harmony-os; node-addon-api/src links to them.
 */
export const SHERPA_ONNX_SOURCE = {
  version: '1.13.8',
  repository: 'https://github.com/k2-fsa/sherpa-onnx.git',
  commit: '11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf',
  paths: [
    '/scripts/node-addon-api/src/*',
    '/harmony-os/SherpaOnnxHar/sherpa_onnx/src/main/cpp/*.cc',
    '/harmony-os/SherpaOnnxHar/sherpa_onnx/src/main/cpp/*.h',
    '/sherpa-onnx/c-api/c-api.h',
  ],
} as const

/** Ubuntu 20.04 (GCC 9, glibc 2.31) by digest, so the toolchain matches the oldest supported release. */
export const UBUNTU_2004_BUILD_IMAGE = 'ubuntu:20.04@sha256:8feb4d8ca5354def3d8fce243717141ce31e2c428701f6682bd2fafe15388214'

/** Command boundary; `capture` returns standard output. */
export interface SherpaOnnxBuildHost {
  readonly env: NodeJS.ProcessEnv
  readonly run: (command: string, args: readonly string[], cwd?: string) => void
  readonly capture: (command: string, args: readonly string[], cwd?: string) => string
  /** node-addon-api and Node-API header directories. */
  readonly headers: { readonly nodeAddonApi: string, readonly nodeApi: string }
  readonly log: (message: string) => void
}

function run(command: string, args: readonly string[], cwd?: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

function capture(command: string, args: readonly string[], cwd?: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

/** Native host for the command-line packaging flow. */
export function createSherpaOnnxBuildHost(log: (message: string) => void = message => console.log(message)): SherpaOnnxBuildHost {
  const require = createRequire(import.meta.url)
  return {
    env: process.env,
    run,
    capture,
    headers: {
      nodeAddonApi: dirname(require.resolve('node-addon-api/package.json')),
      nodeApi: join(dirname(require.resolve('node-api-headers/package.json')), 'include'),
    },
    log,
  }
}

/**
 * Find the physical sherpa-onnx bindings for one architecture below a Profile.
 * @param profile - Profile directory with node_modules.
 * @param arch - Target architecture.
 * @returns Regular binding files; symbolic links are not followed.
 */
export function findSherpaOnnxBindings(profile: string, arch: 'x64' | 'arm64'): string[] {
  const found: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name === 'sherpa-onnx.node' && basename(directory) === `sherpa-onnx-linux-${arch}`) found.push(path)
    }
  }
  const modules = join(profile, 'node_modules')
  if (existsSync(modules)) walk(modules)
  return found.sort()
}

/** Whether a binding needs a newer glibc, libstdc++, or C++ ABI than Ubuntu 20.04 provides. */
export function bindingExceedsUbuntu2004(binding: string): boolean {
  return readElfVersionNeeds(binding)?.needs.some(exceedsUbuntu2004) ?? false
}

/**
 * Compile sherpa-onnx.node from the pinned source inside Ubuntu 20.04 against
 * the C API library that ships next to the binding, verify it, and swap it in.
 * The swap renames a new file over the old one, so a package-store hard link
 * to the published binding keeps its content.
 * @param binding - Published binding to replace.
 * @param arch - Target architecture, which must be the host's.
 * @param host - Command boundary.
 */
export function rebuildSherpaOnnxBinding(binding: string, arch: 'x64' | 'arm64', host: SherpaOnnxBuildHost): void {
  const packageDir = dirname(binding)
  const { version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version: string }
  if (version !== SHERPA_ONNX_SOURCE.version) {
    throw new Error(`sherpa-onnx-linux-${arch} ${version} needs a newer glibc than Ubuntu 20.04; pin its source in SHERPA_ONNX_SOURCE (currently ${SHERPA_ONNX_SOURCE.version})`)
  }
  if (!existsSync(join(packageDir, 'libsherpa-onnx-c-api.so'))) throw new Error(`${packageDir} has no libsherpa-onnx-c-api.so to link against`)
  const work = mkdtempSync(join(tmpdir(), 'workdsh-sherpa-onnx-'))
  try {
    const source = join(work, 'source')
    const out = join(work, 'out')
    mkdirSync(source)
    mkdirSync(out)
    host.run('git', ['init', '--quiet'], source)
    host.run('git', ['remote', 'add', 'origin', SHERPA_ONNX_SOURCE.repository], source)
    host.run('git', ['fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', SHERPA_ONNX_SOURCE.commit], source)
    host.run('git', ['sparse-checkout', 'set', '--no-cone', ...SHERPA_ONNX_SOURCE.paths], source)
    host.run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD'], source)
    const head = host.capture('git', ['rev-parse', 'HEAD'], source)
    if (head !== SHERPA_ONNX_SOURCE.commit) throw new Error(`sherpa-onnx source is ${head}, expected ${SHERPA_ONNX_SOURCE.commit}`)
    host.log(`Building sherpa-onnx ${version} sherpa-onnx.node for Ubuntu 20.04 from ${SHERPA_ONNX_SOURCE.commit.slice(0, 12)}`)
    // The flags of upstream's cmake-js Release build. As in the published
    // binding, libonnxruntime.so is loaded through the C API library.
    const compile = [
      'set -eu',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update -qq',
      'apt-get install -y -qq --no-install-recommends g++ > /tmp/apt.log 2>&1 || { cat /tmp/apt.log; exit 1; }',
      'g++ --version | sed -n 1p',
      'g++ -std=c++17 -O3 -DNDEBUG -fPIC -shared -I/source -I/node-addon-api -I/node-api \\',
      '  /source/scripts/node-addon-api/src/*.cc -o /out/sherpa-onnx.node \\',
      '  -L/package -l:libsherpa-onnx-c-api.so -Wl,-rpath,\'$ORIGIN\'',
    ].join('\n')
    const proxies = ['http_proxy', 'https_proxy', 'no_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'].filter(name => host.env[name] !== undefined)
    host.run('docker', [
      'run', '--rm', '--network', 'host',
      ...proxies.flatMap(name => ['-e', name]),
      '-v', `${source}:/source:ro`,
      '-v', `${host.headers.nodeAddonApi}:/node-addon-api:ro`,
      '-v', `${host.headers.nodeApi}:/node-api:ro`,
      '-v', `${packageDir}:/package:ro`,
      '-v', `${out}:/out`,
      UBUNTU_2004_BUILD_IMAGE, 'bash', '-c', compile,
    ])
    const built = join(out, 'sherpa-onnx.node')
    const elf = existsSync(built) ? readElfVersionNeeds(built) : undefined
    if (elf === undefined) throw new Error('The sherpa-onnx.node build produced no ELF file')
    if (elf.machine !== ELF_MACHINES[arch]) throw new Error(`The rebuilt sherpa-onnx.node is not a ${arch} binary`)
    const tooNew = elf.needs.filter(exceedsUbuntu2004)
    if (tooNew.length > 0) throw new Error(`The rebuilt sherpa-onnx.node still needs ${tooNew.join(', ')}`)
    const staged = `${binding}.workdsh-rebuild`
    copyFileSync(built, staged)
    renameSync(staged, binding)
    host.log(`Replaced ${binding} (needs ${elf.needs.filter(name => /^(GLIBC|GLIBCXX|CXXABI)_/u.test(name)).join(', ')})`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Rebuild every binding of this architecture below the Profile that Ubuntu 20.04 cannot load.
 * @param profile - Staged Profile directory.
 * @param arch - Host and target architecture.
 * @param host - Command boundary.
 * @returns Rebuilt binding paths relative to the Profile.
 */
export function prepareSherpaOnnxForUbuntu2004(profile: string, arch: 'x64' | 'arm64', host: SherpaOnnxBuildHost = createSherpaOnnxBuildHost()): string[] {
  const rebuilt: string[] = []
  for (const binding of findSherpaOnnxBindings(profile, arch)) {
    if (!bindingExceedsUbuntu2004(binding)) continue
    rebuildSherpaOnnxBinding(binding, arch, host)
    rebuilt.push(relative(profile, binding))
  }
  return rebuilt
}
