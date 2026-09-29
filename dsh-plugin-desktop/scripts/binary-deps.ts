/**
 * Shared-library dependencies of native images, for staging only the files a
 * bundled executable loads. PE imports come from the Windows 7 audit.
 */

import { closeSync, openSync, readSync } from 'node:fs'

const DT_NEEDED = 1
const SHT_DYNAMIC = 6
const LC_LOAD_DYLIB = 0xc
const LC_LOAD_WEAK_DYLIB = 0x80000018
const LC_REEXPORT_DYLIB = 0x8000001f
const LC_LOAD_UPWARD_DYLIB = 0x80000023

function read(descriptor: number, length: number, position: number): Buffer {
  const buffer = Buffer.alloc(length)
  return buffer.subarray(0, readSync(descriptor, buffer, 0, length, position))
}

function cString(buffer: Buffer, offset: number): string {
  const end = buffer.indexOf(0, offset)
  return buffer.toString('utf8', offset, end < 0 ? buffer.length : end)
}

/**
 * Read the `DT_NEEDED` entries of a 64-bit little-endian ELF file.
 * @param path - File to inspect.
 * @returns Needed sonames, or undefined for files that are not such ELF images.
 */
export function readElfNeeded(path: string): string[] | undefined {
  const descriptor = openSync(path, 'r')
  try {
    const header = read(descriptor, 64, 0)
    if (header.length < 64 || header.readUInt32BE(0) !== 0x7f454c46 || header[4] !== 2 || header[5] !== 1) return undefined
    const sectionOffset = Number(header.readBigUInt64LE(0x28))
    const sectionSize = header.readUInt16LE(0x3a)
    const sectionCount = header.readUInt16LE(0x3c)
    if (sectionOffset === 0 || sectionSize < 64) return []
    const sections = read(descriptor, sectionSize * sectionCount, sectionOffset)
    const field = (index: number, at: number): number => Number(sections.readBigUInt64LE(index * sectionSize + at))
    const needed: string[] = []
    for (let index = 0; (index + 1) * sectionSize <= sections.length; index++) {
      if (sections.readUInt32LE(index * sectionSize + 4) !== SHT_DYNAMIC) continue
      const link = sections.readUInt32LE(index * sectionSize + 40)
      if (link >= sectionCount) continue
      const strings = read(descriptor, field(link, 32), field(link, 24))
      const entries = read(descriptor, field(index, 32), field(index, 24))
      for (let at = 0; at + 16 <= entries.length; at += 16) {
        const tag = entries.readBigInt64LE(at)
        if (tag === 0n) break
        if (tag === BigInt(DT_NEEDED)) needed.push(cString(strings, Number(entries.readBigUInt64LE(at + 8))))
      }
    }
    return needed
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Read the dylibs a thin 64-bit Mach-O image loads.
 * @param path - File to inspect.
 * @returns Install names such as `@rpath/libllama.0.dylib`, or undefined for other files.
 */
export function readMachODylibs(path: string): string[] | undefined {
  const descriptor = openSync(path, 'r')
  try {
    const header = read(descriptor, 32, 0)
    if (header.length < 32 || header.readUInt32LE(0) !== 0xfeedfacf) return undefined
    const commands = header.readUInt32LE(16)
    const data = read(descriptor, header.readUInt32LE(20), 32)
    const dylibs: string[] = []
    for (let index = 0, at = 0; index < commands && at + 8 <= data.length; index++) {
      const command = data.readUInt32LE(at)
      const length = data.readUInt32LE(at + 4)
      if ([LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB, LC_LOAD_UPWARD_DYLIB].includes(command) && at + 12 <= data.length) {
        dylibs.push(cString(data.subarray(0, at + length), at + data.readUInt32LE(at + 8)))
      }
      if (length < 8) break
      at += length
    }
    return dylibs
  } finally {
    closeSync(descriptor)
  }
}
