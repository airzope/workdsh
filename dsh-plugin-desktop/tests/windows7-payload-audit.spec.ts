import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WINDOWS7_OFFLINE_FILES,
  assertWindows7Payload,
  auditWindows7Payload,
  readPeImports,
  resolveWindows7Import,
  vxkexDllKey,
} from '../scripts/windows7-payload-audit.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A minimal PE32+ image with one section holding the import directory. */
function peImage(imports: readonly string[], machine = 0x8664): Buffer {
  const image = Buffer.alloc(0x400)
  image.write('MZ', 0, 'latin1')
  image.writeUInt32LE(0x40, 0x3c)
  image.write('PE\0\0', 0x40, 'latin1')
  image.writeUInt16LE(machine, 0x44)
  image.writeUInt16LE(1, 0x46)
  image.writeUInt16LE(240, 0x54)
  const optional = 0x58
  image.writeUInt16LE(0x20b, optional)
  image.writeUInt32LE(0x1000, optional + 112 + 8)
  image.writeUInt32LE((imports.length + 1) * 20, optional + 112 + 12)
  const section = optional + 240
  image.write('.idata', section, 'latin1')
  image.writeUInt32LE(0x200, section + 8)
  image.writeUInt32LE(0x1000, section + 12)
  image.writeUInt32LE(0x200, section + 16)
  image.writeUInt32LE(0x200, section + 20)
  let name = 0x100
  imports.forEach((dll, index) => {
    image.writeUInt32LE(0x1000 + name, 0x200 + index * 20 + 12)
    image.write(`${dll}\0`, 0x200 + name, 'latin1')
    name += dll.length + 1
  })
  return image
}

function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-win7-audit-'))
  roots.push(root)
  return root
}

function write(path: string, content: string | Buffer = ''): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function application(): string {
  const root = join(temporary(), 'win-unpacked')
  for (const path of WINDOWS7_OFFLINE_FILES) write(join(root, 'resources', 'workdsh-runtime', path), '{}')
  write(join(root, 'resources', 'workdsh-runtime', 'profiles', 'workdsh', 'node_modules', '.pnpm', 'kit', 'bin', 'libreoffice-kit.exe'),
    peImage(['KERNEL32.dll', 'MSVCP140_2.dll', 'api-ms-win-crt-runtime-l1-1-0.dll']))
  write(join(root, 'resources', 'workdsh-runtime', 'profiles', 'workdsh', 'node_modules', '@firecrawl', 'anydoc-win32-x64-msvc', 'anydoc.win32-x64-msvc.node'))
  write(join(root, 'WorkDSH.exe'), peImage(['KERNEL32.dll', 'dwrite.dll', 'ffmpeg.dll']))
  write(join(root, 'ffmpeg.dll'), peImage(['KERNEL32.dll']))
  return root
}

describe('Windows 7 import resolution', () => {
  it('matches the VxKex NEXT rewrite keys', () => {
    expect(vxkexDllKey('API-MS-WIN-CORE-PATH-L1-1-0.dll')).toBe('api-ms-win-core-path')
    expect(vxkexDllKey('dcomp.dll')).toBe('dcomp')
  })

  it('names the party that provides each import', () => {
    const shipped = new Set(['ffmpeg.dll'])
    expect(resolveWindows7Import('ffmpeg.dll', shipped)).toBe('payload')
    expect(resolveWindows7Import('MSVCP140_2.dll', shipped)).toBe('vc-runtime')
    expect(resolveWindows7Import('api-ms-win-crt-heap-l1-1-0.dll', shipped)).toBe('vxkex')
    expect(resolveWindows7Import('ucrtbase.dll', shipped)).toBe('vxkex')
    expect(resolveWindows7Import('dcomp.dll', shipped)).toBe('vxkex')
    expect(resolveWindows7Import('gdiplus.dll', shipped)).toBe('windows7')
    expect(resolveWindows7Import('dxcore.dll', shipped)).toBeUndefined()
  })

  it('reads static imports from a PE32+ image', () => {
    const path = join(temporary(), 'image.dll')
    write(path, peImage(['KERNEL32.dll', 'USER32.dll']))
    expect(readPeImports(path)).toEqual({ machine: 0x8664, imports: ['KERNEL32.dll', 'USER32.dll'] })
    write(path, 'not a PE image')
    expect(readPeImports(path)).toBeUndefined()
  })
})

describe('Windows 7 package audit', () => {
  it('passes a complete offline payload whose imports all resolve', () => {
    const root = application()
    write(join(root, 'resources', 'pip', 'w32.exe'), peImage(['KERNEL32.dll', 'dxcore.dll'], 0x14c))

    const report = auditWindows7Payload(root)

    expect(report.missingOfflineFiles).toEqual([])
    expect(report.unresolvedImports).toEqual({})
    expect(report.images).toBe(3)
    expect(report.skippedNonX64).toEqual(['resources/pip/w32.exe'])
    expect(report.resolvedBy['vc-runtime']).toEqual(['msvcp140_2.dll'])
    expect(() => assertWindows7Payload(report)).not.toThrow()
  })

  it('reports missing offline content and imports nothing provides', () => {
    const root = application()
    rmSync(join(root, 'resources', 'workdsh-runtime', 'office-skills', 'office-docx', 'SKILL.md'))
    write(join(root, 'resources', 'native.node'), peImage(['KERNEL32.dll', 'dxcore.dll']))

    const report = auditWindows7Payload(root)

    expect(report.missingOfflineFiles).toEqual(['office-skills/office-docx/SKILL.md'])
    expect(report.unresolvedImports).toEqual({ 'dxcore.dll': ['resources/native.node'] })
    expect(() => assertWindows7Payload(report)).toThrow(
      /missing offline content: office-skills\/office-docx\/SKILL\.md[\s\S]*dxcore\.dll is neither shipped/u,
    )
  })
})
