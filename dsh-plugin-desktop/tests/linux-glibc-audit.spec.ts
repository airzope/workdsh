import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LINUX_OFFLINE_FILES,
  assertLinuxPayload,
  auditLinuxPayload,
  compareDotted,
  exceedsUbuntu2004,
  readElfVersionNeeds,
} from '../scripts/linux-glibc-audit.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A minimal 64-bit little-endian ELF with a `.gnu.version_r` section that
 * requires the given versions from libc.so.6.
 */
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

function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-linux-audit-'))
  roots.push(root)
  return root
}

function write(path: string, content: string | Buffer = ''): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function application(): string {
  const root = join(temporary(), 'linux-unpacked')
  for (const path of LINUX_OFFLINE_FILES) write(join(root, 'resources', 'workdsh-runtime', path), '{}')
  const runtime = join(root, 'resources', 'workdsh-runtime')
  write(join(runtime, 'profiles', 'workdsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit-wasm', 'package.json'), '{}')
  write(join(root, 'workdsh'), elf(['GLIBC_2.2.5', 'GLIBC_2.25']))
  write(join(runtime, 'primary-runtime', 'dependencies', 'node', 'bin', 'node'), elf(['GLIBC_2.28', 'GLIBCXX_3.4.21', 'CXXABI_1.3.11']))
  write(join(runtime, 'primary-runtime', 'dependencies', 'python', 'bin', 'python3'), elf(['GLIBC_2.17']))
  write(join(runtime, 'profiles', 'workdsh', 'node_modules', '@firecrawl', 'anydoc-linux-x64-gnu', 'anydoc.linux-x64-gnu.node'), elf(['GLIBC_2.17']))
  // Static FFmpeg builds need no versioned glibc symbols.
  write(join(runtime, 'media', 'bin', 'ffmpeg'), elf([]))
  write(join(runtime, 'media', 'bin', 'ffprobe'), elf([]))
  return root
}

describe('Ubuntu 20.04 symbol versions', () => {
  it('compares dotted versions numerically', () => {
    expect(compareDotted('2.31', '2.4')).toBeGreaterThan(0)
    expect(compareDotted('3.4.28', '3.4.28')).toBe(0)
    expect(compareDotted('1.3.11', '1.3.12')).toBeLessThan(0)
  })

  it('flags only requirements newer than glibc 2.31, GLIBCXX 3.4.28 and CXXABI 1.3.12', () => {
    expect(exceedsUbuntu2004('GLIBC_2.31')).toBe(false)
    expect(exceedsUbuntu2004('GLIBC_2.34')).toBe(true)
    expect(exceedsUbuntu2004('GLIBCXX_3.4.29')).toBe(true)
    expect(exceedsUbuntu2004('CXXABI_1.3.13')).toBe(true)
    expect(exceedsUbuntu2004('GCC_12.0.0')).toBe(false)
    expect(exceedsUbuntu2004('GLIBC_PRIVATE')).toBe(false)
  })

  it('reads the machine and version requirements of an ELF image', () => {
    const path = join(temporary(), 'library.so')
    write(path, elf(['GLIBC_2.17', 'GLIBC_2.34'], 183))
    expect(readElfVersionNeeds(path)).toEqual({ machine: 183, needs: ['GLIBC_2.17', 'GLIBC_2.34'] })
    write(path, 'not an ELF image')
    expect(readElfVersionNeeds(path)).toBeUndefined()
  })
})

describe('Linux package audit', () => {
  it('passes a complete offline payload built for Ubuntu 20.04', () => {
    const root = application()
    write(join(root, 'resources', 'prebuilds', 'linux-arm64', 'addon.node'), elf(['GLIBC_2.39'], 183))

    const report = auditLinuxPayload(root, 'x64')

    expect(report.missingOfflineFiles).toEqual([])
    expect(report.wrongArchitecture).toEqual([])
    expect(report.tooNew).toEqual({})
    expect(report.images).toBe(6)
    expect(report.newest).toEqual({ GLIBC: '2.28', GLIBCXX: '3.4.21', CXXABI: '1.3.11' })
    expect(report.otherArchitectures).toEqual([join('resources', 'prebuilds', 'linux-arm64', 'addon.node')])
    expect(() => assertLinuxPayload(report)).not.toThrow()
  })

  it('reports newer symbol versions, wrong main executables and missing offline content', () => {
    const root = application()
    write(join(root, 'resources', 'native.node'), elf(['GLIBC_2.34', 'GLIBCXX_3.4.30']))
    write(join(root, 'workdsh'), elf(['GLIBC_2.17'], 183))
    write(join(root, 'resources', 'workdsh-runtime', 'media', 'bin', 'ffprobe'), elf([], 183))
    rmSync(join(root, 'resources', 'workdsh-runtime', 'office-skills', 'office-xlsx', 'SKILL.md'))
    rmSync(join(root, 'resources', 'workdsh-runtime', 'profiles', 'workdsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit-wasm'), { recursive: true })

    const report = auditLinuxPayload(root, 'x64')

    expect(report.tooNew).toEqual({
      'GLIBC_2.34': [join('resources', 'native.node')],
      'GLIBCXX_3.4.30': [join('resources', 'native.node')],
    })
    expect(report.wrongArchitecture).toEqual(['workdsh', 'resources/workdsh-runtime/media/bin/ffprobe'])
    expect(report.missingOfflineFiles).toEqual([
      'office-skills/office-xlsx/SKILL.md',
      'LibreOffice Kit WebAssembly engine (@deepseek-ai/libreoffice-kit-wasm)',
    ])
    expect(() => assertLinuxPayload(report)).toThrow(/GLIBC_2\.34 is newer than Ubuntu 20\.04 provides/u)
  })
})
