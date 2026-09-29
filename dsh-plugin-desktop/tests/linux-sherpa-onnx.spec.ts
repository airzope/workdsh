import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SHERPA_ONNX_SOURCE,
  UBUNTU_2004_BUILD_IMAGE,
  findSherpaOnnxBindings,
  prepareSherpaOnnxForUbuntu2004,
  type SherpaOnnxBuildHost,
} from '../scripts/linux-sherpa-onnx.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A minimal 64-bit little-endian ELF that requires the given versions from libc.so.6. */
function elf(needs: readonly string[], machine = 62): Buffer {
  const strings = ['', 'libc.so.6', ...needs]
  const table = Buffer.from(`${strings.join('\0')}\0`, 'latin1')
  const offsetOf = (name: string): number => strings.slice(0, strings.indexOf(name)).reduce((sum, item) => sum + item.length + 1, 0)
  const verneed = Buffer.alloc(16 + needs.length * 16)
  verneed.writeUInt16LE(1, 0)
  verneed.writeUInt16LE(needs.length, 2)
  verneed.writeUInt32LE(offsetOf('libc.so.6'), 4)
  verneed.writeUInt32LE(16, 8)
  needs.forEach((name, index) => {
    const aux = 16 + index * 16
    verneed.writeUInt32LE(offsetOf(name), aux + 8)
    verneed.writeUInt32LE(index + 1 < needs.length ? 16 : 0, aux + 12)
  })
  const stringOffset = 0x100
  const verneedOffset = stringOffset + table.length
  const sectionOffset = verneedOffset + verneed.length
  const image = Buffer.alloc(sectionOffset + 3 * 64)
  image.writeUInt32BE(0x7f454c46, 0)
  image[4] = 2
  image[5] = 1
  image.writeUInt16LE(machine, 18)
  image.writeBigUInt64LE(BigInt(sectionOffset), 0x28)
  image.writeUInt16LE(64, 0x3a)
  image.writeUInt16LE(3, 0x3c)
  table.copy(image, stringOffset)
  verneed.copy(image, verneedOffset)
  const section = (index: number, type: number, offset: number, size: number, link: number, info: number): void => {
    const base = sectionOffset + index * 64
    image.writeUInt32LE(type, base + 4)
    image.writeBigUInt64LE(BigInt(offset), base + 24)
    image.writeBigUInt64LE(BigInt(size), base + 32)
    image.writeUInt32LE(link, base + 40)
    image.writeUInt32LE(info, base + 44)
  }
  section(1, 3, stringOffset, table.length, 0, 0)
  section(2, 0x6ffffffe, verneedOffset, verneed.length, 1, 1)
  return image
}

const PUBLISHED = elf(['GLIBC_2.14', 'GLIBC_2.32', 'GLIBCXX_3.4.29'])
const REBUILT = elf(['GLIBC_2.14', 'GLIBCXX_3.4.26', 'CXXABI_1.3.9'])

function write(path: string, content: string | Buffer = ''): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** A hoisted Profile with sherpa-onnx-linux-x64, returning the binding path. */
function profile(version: string = SHERPA_ONNX_SOURCE.version, binding: Buffer = PUBLISHED): { root: string, binding: string } {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-sherpa-'))
  roots.push(root)
  const packageDir = join(root, 'node_modules', 'sherpa-onnx-linux-x64')
  write(join(packageDir, 'package.json'), JSON.stringify({ name: 'sherpa-onnx-linux-x64', version }))
  write(join(packageDir, 'libsherpa-onnx-c-api.so'), elf(['GLIBC_2.16']))
  write(join(packageDir, 'sherpa-onnx.node'), binding)
  return { root, binding: join(packageDir, 'sherpa-onnx.node') }
}

function host(commands: string[], overrides: { head?: string, output?: Buffer } = {}): SherpaOnnxBuildHost {
  return {
    env: { HTTPS_PROXY: 'http://proxy:3128' },
    run: (command, args) => {
      commands.push(`${command} ${args.join(' ')}`)
      if (command === 'docker') {
        const mount = args.find(arg => arg.endsWith(':/out'))!
        write(join(mount.slice(0, -':/out'.length), 'sherpa-onnx.node'), overrides.output ?? REBUILT)
      }
    },
    capture: (command, args) => {
      commands.push(`${command} ${args.join(' ')}`)
      return overrides.head ?? SHERPA_ONNX_SOURCE.commit
    },
    headers: { nodeAddonApi: '/headers/node-addon-api', nodeApi: '/headers/node-api/include' },
    log: () => undefined,
  }
}

describe('sherpa-onnx binding for Ubuntu 20.04', () => {
  it('finds physical bindings of the target architecture only', () => {
    const { root, binding } = profile()
    write(join(root, 'node_modules', 'sherpa-onnx-linux-arm64', 'sherpa-onnx.node'), elf(['GLIBC_2.17'], 183))
    write(join(root, 'node_modules', 'other-sherpa-onnx-linux-x64', 'sherpa-onnx.node'), PUBLISHED)
    mkdirSync(join(root, 'node_modules', 'linked'))
    symlinkSync(binding, join(root, 'node_modules', 'linked', 'sherpa-onnx.node'))

    expect(findSherpaOnnxBindings(root, 'x64')).toEqual([binding])
    expect(findSherpaOnnxBindings(join(root, 'missing'), 'x64')).toEqual([])
  })

  it('leaves a binding that Ubuntu 20.04 can already load', () => {
    const { root } = profile(SHERPA_ONNX_SOURCE.version, REBUILT)
    const commands: string[] = []

    expect(prepareSherpaOnnxForUbuntu2004(root, 'x64', host(commands))).toEqual([])
    expect(commands).toEqual([])
  })

  it('rebuilds from the pinned commit in Ubuntu 20.04 and keeps a hard-linked store copy intact', () => {
    const { root, binding } = profile()
    const store = join(root, 'store-copy.node')
    linkSync(binding, store)
    const commands: string[] = []

    const rebuilt = prepareSherpaOnnxForUbuntu2004(root, 'x64', host(commands))

    expect(rebuilt).toEqual([join('node_modules', 'sherpa-onnx-linux-x64', 'sherpa-onnx.node')])
    expect(readFileSync(binding)).toEqual(REBUILT)
    expect(readFileSync(store)).toEqual(PUBLISHED)
    expect(commands).toContain(`git fetch --quiet --depth 1 --filter=blob:none origin ${SHERPA_ONNX_SOURCE.commit}`)
    expect(commands).toContain(`git sparse-checkout set --no-cone ${SHERPA_ONNX_SOURCE.paths.join(' ')}`)
    const docker = commands.find(command => command.startsWith('docker '))!
    expect(docker).toContain(`${UBUNTU_2004_BUILD_IMAGE} bash -c`)
    expect(docker).toContain('-e HTTPS_PROXY')
    expect(docker).toContain(`-v ${join(root, 'node_modules', 'sherpa-onnx-linux-x64')}:/package:ro`)
    expect(docker).toContain('-v /headers/node-addon-api:/node-addon-api:ro')
    expect(docker).toContain('-l:libsherpa-onnx-c-api.so')
  })

  it('refuses a different upstream release or source commit', () => {
    const other = profile('1.14.0')
    expect(() => prepareSherpaOnnxForUbuntu2004(other.root, 'x64', host([]))).toThrow(/sherpa-onnx-linux-x64 1\.14\.0 .*pin its source/u)

    const moved = profile()
    expect(() => prepareSherpaOnnxForUbuntu2004(moved.root, 'x64', host([], { head: 'f'.repeat(40) }))).toThrow(/expected 11afbd00/u)
    expect(readFileSync(moved.binding)).toEqual(PUBLISHED)
  })

  it('keeps the published binding when the rebuild is still too new or has the wrong architecture', () => {
    const tooNew = profile()
    expect(() => prepareSherpaOnnxForUbuntu2004(tooNew.root, 'x64', host([], { output: elf(['GLIBC_2.34']) })))
      .toThrow(/still needs GLIBC_2\.34/u)
    expect(readFileSync(tooNew.binding)).toEqual(PUBLISHED)

    const foreign = profile()
    expect(() => prepareSherpaOnnxForUbuntu2004(foreign.root, 'x64', host([], { output: elf(['GLIBC_2.17'], 183) })))
      .toThrow(/not a x64 binary/u)
  })
})
