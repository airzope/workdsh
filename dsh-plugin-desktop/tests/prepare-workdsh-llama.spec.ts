import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LLAMA_RELEASE,
  isDynamicBackend,
  llamaServerName,
  prepareWorkdshLlama,
  serverClosure,
  type LlamaRelease,
} from '../scripts/prepare-workdsh-llama.ts'
import { tinyGguf } from '../scripts/tiny-gguf.mjs'
import { elfNeeding } from './native-images.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-llama-'))
  roots.push(root)
  return root
}

const sha256 = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex')
const file = (name: string) => ({ url: `https://example.test/${name}`, sha256: sha256(name) })
const fetchBytes = async (url: string): Promise<Buffer> => Buffer.from(url.slice('https://example.test/'.length))

const release: LlamaRelease = {
  ...LLAMA_RELEASE,
  targets: {
    'win32-x64': { kind: 'release', archive: file('llama-win.zip'), root: '', accelerator: 'cpu+vulkan' },
    'darwin-arm64': { kind: 'release', archive: file('llama-mac.tar.gz'), root: 'llama-b11247', accelerator: 'cpu+metal' },
    'linux-x64': { kind: 'build', cmake: file('cmake.tar.gz'), accelerator: 'cpu' },
  },
  licenses: { 'LICENSE': file('LICENSE') },
  vcRuntime: {
    ...LLAMA_RELEASE.vcRuntime,
    wheel: file('msvc_runtime.whl'),
    dlls: { 'msvcp140.dll': sha256('msvcp140'), 'vcruntime140.dll': sha256('vcruntime140') },
  },
}

function linuxBuild(output: string): void {
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, 'llama-server'), elfNeeding(['libllama-server-impl.so', 'libc.so.6']))
  writeFileSync(join(output, 'libllama-server-impl.so'), elfNeeding(['libllama.so.0', 'libstdc++.so.6']))
  writeFileSync(join(output, 'libllama.so.0'), elfNeeding(['libggml-base.so.0']))
  writeFileSync(join(output, 'libggml-base.so.0'), elfNeeding([]))
  writeFileSync(join(output, 'libggml-cpu-haswell.so'), elfNeeding(['libggml-base.so.0']))
  writeFileSync(join(output, 'libggml-cpu-armv8.2_1.so'), elfNeeding([]))
  writeFileSync(join(output, 'llama-quantize'), elfNeeding(['libllama.so.0']))
  writeFileSync(join(output, 'libunused.so.0'), elfNeeding([]))
}

describe('llama.cpp staging', () => {
  it('pins every Desktop target and the Windows VC++ runtime', () => {
    expect(Object.keys(LLAMA_RELEASE.targets).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'])
    for (const target of Object.values(LLAMA_RELEASE.targets)) {
      const asset = target.kind === 'release' ? target.archive : target.cmake
      expect(asset.url).toMatch(/^https:\/\//u)
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/u)
    }
    expect(Object.keys(LLAMA_RELEASE.vcRuntime.dlls).sort()).toEqual(['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'])
    expect(LLAMA_RELEASE.linuxImage).toMatch(/^ubuntu:20\.04@sha256:[0-9a-f]{64}$/u)
  })

  it('treats run-time ggml backends as roots but not RPC or the base library', () => {
    expect(isDynamicBackend('win32', 'ggml-cpu-haswell.dll')).toBe(true)
    expect(isDynamicBackend('win32', 'ggml-vulkan.dll')).toBe(true)
    expect(isDynamicBackend('win32', 'ggml-rpc.dll')).toBe(false)
    expect(isDynamicBackend('win32', 'ggml-base.dll')).toBe(false)
    expect(isDynamicBackend('win32', 'ggml.dll')).toBe(false)
    expect(isDynamicBackend('linux', 'libggml-cpu-armv8.2_1.so')).toBe(true)
    expect(isDynamicBackend('linux', 'libggml-base.so.0')).toBe(false)
    expect(isDynamicBackend('darwin', 'libggml-metal.0.dylib')).toBe(false)
  })

  it('selects the server, its link closure and the backends', () => {
    const root = temporary()
    linuxBuild(root)
    expect(serverClosure('linux', root)).toEqual([
      'libggml-base.so.0',
      'libggml-cpu-armv8.2_1.so',
      'libggml-cpu-haswell.so',
      'libllama-server-impl.so',
      'libllama.so.0',
      'llama-server',
    ])
    rmSync(join(root, 'llama-server'))
    expect(() => serverClosure('linux', root)).toThrow(/llama-server is missing/u)
  })

  it('stages the Linux build with its license and manifest', async () => {
    const desktopRoot = temporary()
    let builds = 0
    const options = {
      desktopRoot,
      platform: 'linux' as const,
      arch: 'x64',
      release,
      fetchBytes,
      buildLinux: (_release: LlamaRelease, _target: unknown, output: string) => { builds++; linuxBuild(output) },
      serverVersion: () => 'version: 0.5.0-dev (build 11247, commit 0bc845d3)',
    }
    const llama = await prepareWorkdshLlama(options)
    expect(readdirSync(join(llama, 'bin')).sort()).toEqual([
      'libggml-base.so.0', 'libggml-cpu-armv8.2_1.so', 'libggml-cpu-haswell.so', 'libllama-server-impl.so', 'libllama.so.0', 'llama-server',
    ])
    expect(readFileSync(join(llama, 'LICENSE'), 'utf8')).toBe('LICENSE')
    const manifest = JSON.parse(readFileSync(join(llama, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({ version: 'b11247', target: 'linux-x64', server: 'bin/llama-server', accelerator: 'cpu', licenses: ['LICENSE'] })
    expect(manifest.files).toContain('bin/libggml-cpu-haswell.so')
    expect(manifest.vcRuntime).toBeUndefined()
    // A cached build is reused.
    await prepareWorkdshLlama(options)
    expect(builds).toBe(1)
  })

  it('stages the Windows release with the app-local VC++ runtime', async () => {
    const desktopRoot = temporary()
    const extract = (archive: string, destination: string): void => {
      mkdirSync(destination, { recursive: true })
      if (archive.endsWith('llama-win.zip')) {
        for (const name of ['llama-server.exe', 'ggml-cpu-x64.dll', 'ggml-rpc.dll', 'llama-cli.exe']) writeFileSync(join(destination, name), name)
      } else {
        const scripts = join(destination, release.vcRuntime.directory)
        mkdirSync(scripts, { recursive: true })
        writeFileSync(join(scripts, 'msvcp140.dll'), 'msvcp140')
        writeFileSync(join(scripts, 'vcruntime140.dll'), 'vcruntime140')
      }
    }
    const llama = await prepareWorkdshLlama({
      desktopRoot, platform: 'win32', arch: 'x64', release, fetchBytes, extract, serverVersion: () => undefined,
    })
    expect(readdirSync(join(llama, 'bin')).sort()).toEqual(['ggml-cpu-x64.dll', 'llama-server.exe', 'msvcp140.dll', 'vcruntime140.dll'])
    const manifest = JSON.parse(readFileSync(join(llama, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({ target: 'win32-x64', server: 'bin/llama-server.exe', vcRuntime: '14.44.35112' })
  })

  it('rejects a VC++ runtime DLL that does not match its pin', async () => {
    const extract = (archive: string, destination: string): void => {
      mkdirSync(destination, { recursive: true })
      if (archive.endsWith('llama-win.zip')) writeFileSync(join(destination, 'llama-server.exe'), 'server')
      else {
        const scripts = join(destination, release.vcRuntime.directory)
        mkdirSync(scripts, { recursive: true })
        writeFileSync(join(scripts, 'msvcp140.dll'), 'tampered')
      }
    }
    await expect(prepareWorkdshLlama({
      desktopRoot: temporary(), platform: 'win32', arch: 'x64', release, fetchBytes, extract, serverVersion: () => undefined,
    })).rejects.toThrow(/msvcp140\.dll checksum mismatch/u)
  })

  it('rejects unknown targets and a server of another version', async () => {
    await expect(prepareWorkdshLlama({ desktopRoot: temporary(), platform: 'freebsd', arch: 'x64', release })).rejects.toThrow(/No pinned llama\.cpp build/u)
    await expect(prepareWorkdshLlama({
      desktopRoot: temporary(), platform: 'linux', arch: 'x64', release, fetchBytes,
      buildLinux: (_release, _target, output) => { linuxBuild(output) },
      serverVersion: () => 'version: 1 (build 9999)',
    })).rejects.toThrow(/unexpected version/u)
  })

  it('names the server executable per platform', () => {
    expect(llamaServerName('win32')).toBe('llama-server.exe')
    expect(llamaServerName('darwin')).toBe('llama-server')
  })
})

describe('tiny smoke model', () => {
  it('writes a small GGUF v3 file', () => {
    const model = tinyGguf('probe')
    expect(model.toString('latin1', 0, 4)).toBe('GGUF')
    expect(model.readUInt32LE(4)).toBe(3)
    expect(Number(model.readBigUInt64LE(8))).toBe(11)
    expect(model.length).toBeLessThan(64 * 1024)
    expect(model.includes(Buffer.from('probe'))).toBe(true)
  })
})
