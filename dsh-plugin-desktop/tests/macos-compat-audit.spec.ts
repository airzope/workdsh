import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MACOS_OFFLINE_FILES,
  assertMacApplication,
  auditMacApplication,
  darwinPlatformPackage,
  findMacApplication,
  readMachO,
} from '../scripts/macos-compat-audit.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const CPU = { x64: 0x01000007, arm64: 0x0100000c } as const

function encode(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return (major << 16) | (minor << 8) | patch
}

/** A 64-bit Mach-O slice with one version load command. */
function thin(arch: keyof typeof CPU, minos: string, legacy = false): Buffer {
  const command = Buffer.alloc(legacy ? 16 : 24)
  command.writeUInt32LE(legacy ? 0x24 : 0x32, 0)
  command.writeUInt32LE(command.length, 4)
  if (legacy) command.writeUInt32LE(encode(minos), 8)
  else {
    command.writeUInt32LE(1, 8)
    command.writeUInt32LE(encode(minos), 12)
  }
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeUInt32LE(CPU[arch], 4)
  header.writeUInt32LE(1, 16)
  header.writeUInt32LE(command.length, 20)
  return Buffer.concat([header, command])
}

function universal(...slices: [keyof typeof CPU, string][]): Buffer {
  const images = slices.map(([arch, minos]) => thin(arch, minos))
  const header = Buffer.alloc(8 + slices.length * 20)
  header.writeUInt32BE(0xcafebabe, 0)
  header.writeUInt32BE(slices.length, 4)
  let offset = 4096
  const parts: Buffer[] = [header]
  images.forEach((image, index) => {
    header.writeUInt32BE(CPU[slices[index]![0]], 8 + index * 20)
    header.writeUInt32BE(offset, 16 + index * 20)
    header.writeUInt32BE(image.length, 20 + index * 20)
    offset += 4096
  })
  let position = header.length
  images.forEach((image, index) => {
    const at = 4096 * (index + 1)
    parts.push(Buffer.alloc(at - position), image)
    position = at + image.length
  })
  return Buffer.concat(parts)
}

function write(path: string, content: string | Buffer = ''): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function platformPackage(root: string, name: string, cpu: string[], binary?: Buffer): void {
  const directory = join(root, 'Contents', 'Resources', 'workdsh-runtime', 'profiles', 'workdsh', 'node_modules', name)
  write(join(directory, 'package.json'), JSON.stringify({ name, os: ['darwin'], cpu }))
  if (binary !== undefined) write(join(directory, 'addon.node'), binary)
}

function application(arch: keyof typeof CPU = 'x64', minimum = '12.0'): string {
  const temporary = mkdtempSync(join(tmpdir(), 'workdsh-mac-audit-'))
  roots.push(temporary)
  const root = join(temporary, 'mac', 'WorkDSH.app')
  const runtime = join(root, 'Contents', 'Resources', 'workdsh-runtime')
  for (const path of MACOS_OFFLINE_FILES) write(join(runtime, path), '{}')
  write(join(root, 'Contents', 'Info.plist'), `<?xml version="1.0"?><plist><dict>
<key>CFBundleExecutable</key><string>WorkDSH</string>
<key>LSMinimumSystemVersion</key><string>${minimum}</string></dict></plist>`)
  write(join(root, 'Contents', 'MacOS', 'WorkDSH'), thin(arch, '12.0'))
  write(join(runtime, 'primary-runtime', 'dependencies', 'node', 'bin', 'node'), thin(arch, '13.5'))
  write(join(runtime, 'primary-runtime', 'dependencies', 'python', 'bin', 'python3'), universal(['x64', '10.13'], ['arm64', '11.0']))
  write(join(runtime, 'profiles', 'workdsh', 'node_modules', '@firecrawl', `anydoc-darwin-${arch}`, `anydoc.darwin-${arch}.node`), thin(arch, '10.12'))
  write(join(runtime, 'media', 'bin', 'ffmpeg'), thin(arch, '11.0'))
  write(join(runtime, 'media', 'bin', 'ffprobe'), thin(arch, '11.0'))
  return root
}

describe('Mach-O slices', () => {
  it('reads thin, universal and legacy version commands', () => {
    const root = mkdtempSync(join(tmpdir(), 'workdsh-macho-'))
    roots.push(root)
    write(join(root, 'thin'), thin('arm64', '11.0'))
    write(join(root, 'fat'), universal(['x64', '10.15'], ['arm64', '15.1']))
    write(join(root, 'legacy'), thin('x64', '10.12', true))
    write(join(root, 'Main.class'), Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x41]))
    write(join(root, 'text'), 'plain text file')

    expect(readMachO(join(root, 'thin'))).toEqual([{ arch: 'arm64', minos: '11.0.0' }])
    expect(readMachO(join(root, 'fat'))).toEqual([{ arch: 'x64', minos: '10.15.0' }, { arch: 'arm64', minos: '15.1.0' }])
    expect(readMachO(join(root, 'legacy'))).toEqual([{ arch: 'x64', minos: '10.12.0' }])
    expect(readMachO(join(root, 'Main.class'))).toBeUndefined()
    expect(readMachO(join(root, 'text'))).toBeUndefined()
  })

  it('pairs per-CPU packages by name and treats a two-CPU package as universal', () => {
    const root = mkdtempSync(join(tmpdir(), 'workdsh-platform-'))
    roots.push(root)
    write(join(root, 'a', 'package.json'), JSON.stringify({ name: '@firecrawl/anydoc-darwin-arm64', cpu: ['arm64'] }))
    write(join(root, 'b', 'package.json'), JSON.stringify({ name: '@esbuild/darwin-x64', cpu: ['x64'] }))
    write(join(root, 'c', 'package.json'), JSON.stringify({ name: 'fsevents-darwin-x64', cpu: ['x64', 'arm64'] }))
    write(join(root, 'd', 'package.json'), JSON.stringify({ name: 'jszip' }))

    expect(darwinPlatformPackage(join(root, 'a', 'package.json'))).toEqual({ key: '@firecrawl/anydoc-darwin-*', arch: 'arm64' })
    expect(darwinPlatformPackage(join(root, 'b', 'package.json'))).toEqual({ key: '@esbuild/darwin-*', arch: 'x64' })
    expect(darwinPlatformPackage(join(root, 'c', 'package.json'))).toEqual({ key: 'fsevents-darwin-*', arch: 'universal' })
    expect(darwinPlatformPackage(join(root, 'd', 'package.json'))).toBeUndefined()
  })
})

describe('macOS application audit', () => {
  it('passes a complete x64 application for macOS 15', () => {
    const root = application()
    platformPackage(root, '@firecrawl/anydoc-darwin-x64', ['x64'], thin('x64', '10.12'))
    platformPackage(root, '@firecrawl/anydoc-darwin-arm64', ['arm64'], thin('arm64', '11.0'))
    platformPackage(root, 'koffi-darwin-universal', ['x64', 'arm64'])

    const report = auditMacApplication(root, 'x64')

    expect(report).toMatchObject({
      images: 7,
      minimumSystemVersion: '12.0',
      newest: '13.5.0',
      wrongArchitecture: [],
      missingPlatformPackages: [],
      missingOfflineFiles: [],
      tooNew: {},
    })
    expect(report.otherArchitectures).toEqual([
      join('Contents', 'Resources', 'workdsh-runtime', 'profiles', 'workdsh', 'node_modules', '@firecrawl', 'anydoc-darwin-arm64', 'addon.node'),
    ])
    expect(() => assertMacApplication(report)).not.toThrow()
    expect(findMacApplication(join(root, '..', '..'))).toBe(root)
  })

  it('reports another CPU\'s platform packages, wrong executables, newer macOS and missing content', () => {
    const root = application('x64', '26.0')
    platformPackage(root, '@deepseek-ai/libreoffice-kit-darwin-arm64', ['arm64'], thin('arm64', '13.0'))
    write(join(root, 'Contents', 'MacOS', 'WorkDSH'), thin('arm64', '12.0'))
    write(join(root, 'Contents', 'Resources', 'workdsh-runtime', 'media', 'bin', 'ffprobe'), thin('arm64', '11.0'))
    write(join(root, 'Contents', 'Frameworks', 'Helper'), thin('x64', '26.0'))
    rmSync(join(root, 'Contents', 'Resources', 'workdsh-runtime', 'office-skills', 'office-xlsx', 'SKILL.md'))

    const report = auditMacApplication(root, 'x64')

    expect(report.missingPlatformPackages).toEqual(['@deepseek-ai/libreoffice-kit-darwin-x64 (found arm64)'])
    expect(report.wrongArchitecture).toEqual([
      join('Contents', 'MacOS', 'WorkDSH'),
      join('Contents', 'Resources', 'workdsh-runtime', 'media', 'bin', 'ffprobe'),
    ])
    expect(report.tooNew).toEqual({
      '26.0.0': [join('Contents', 'Frameworks', 'Helper')],
      '26.0': ['Contents/Info.plist (LSMinimumSystemVersion)'],
    })
    expect(report.missingOfflineFiles).toEqual(['office-skills/office-xlsx/SKILL.md'])
    expect(() => assertMacApplication(report)).toThrow(/missing platform package @deepseek-ai\/libreoffice-kit-darwin-x64/u)
  })
})
