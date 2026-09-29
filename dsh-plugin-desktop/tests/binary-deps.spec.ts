import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readElfNeeded, readMachODylibs } from '../scripts/binary-deps.ts'
import { elfNeeding } from './native-images.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(content: Buffer): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-binary-deps-'))
  roots.push(root)
  const path = join(root, 'image')
  writeFileSync(path, content)
  return path
}

/** A thin arm64 Mach-O that loads the given dylibs, one weakly. */
function machOLoading(dylibs: readonly string[]): Buffer {
  const commands = dylibs.map((name, index) => {
    const size = Math.ceil((24 + name.length + 1) / 8) * 8
    const command = Buffer.alloc(size)
    command.writeUInt32LE(index === 0 ? 0x80000018 : 0xc, 0)
    command.writeUInt32LE(size, 4)
    command.writeUInt32LE(24, 8)
    command.write(name, 24, 'utf8')
    return command
  })
  const body = Buffer.concat(commands)
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeUInt32LE(0x0100000c, 4)
  header.writeUInt32LE(dylibs.length, 16)
  header.writeUInt32LE(body.length, 20)
  return Buffer.concat([header, body])
}

describe('native image dependencies', () => {
  it('reads DT_NEEDED sonames from ELF images', () => {
    expect(readElfNeeded(write(elfNeeding(['libllama.so.0', 'libstdc++.so.6'])))).toEqual(['libllama.so.0', 'libstdc++.so.6'])
    expect(readElfNeeded(write(elfNeeding([])))).toEqual([])
  })

  it('reads the dylibs a Mach-O image loads, weak ones included', () => {
    expect(readMachODylibs(write(machOLoading(['/usr/lib/librdma.dylib', '@rpath/libllama.0.dylib'])))).toEqual([
      '/usr/lib/librdma.dylib',
      '@rpath/libllama.0.dylib',
    ])
  })

  it('ignores files of other formats', () => {
    const text = write(Buffer.from('#!/bin/sh\n'))
    expect(readElfNeeded(text)).toBeUndefined()
    expect(readMachODylibs(text)).toBeUndefined()
    expect(readMachODylibs(write(elfNeeding(['libc.so.6'])))).toBeUndefined()
  })
})
