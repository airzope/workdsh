/** Synthetic native images for dependency tests. */

/** A minimal 64-bit little-endian ELF whose `.dynamic` section needs the given sonames. */
export function elfNeeding(needed: readonly string[]): Buffer {
  const strings = ['', ...needed]
  const table = Buffer.from(`${strings.join('\0')}\0`, 'latin1')
  const offsetOf = (index: number): number => strings.slice(0, index).reduce((sum, item) => sum + item.length + 1, 0)
  const dynamic = Buffer.alloc((needed.length + 1) * 16)
  needed.forEach((_, index) => {
    dynamic.writeBigInt64LE(1n, index * 16)
    dynamic.writeBigUInt64LE(BigInt(offsetOf(index + 1)), index * 16 + 8)
  })
  const stringOffset = 0x100
  const dynamicOffset = stringOffset + table.length
  const sectionOffset = dynamicOffset + dynamic.length
  const image = Buffer.alloc(sectionOffset + 3 * 64)
  image.writeUInt32BE(0x7f454c46, 0)
  image[4] = 2
  image[5] = 1
  image.writeUInt16LE(62, 18)
  image.writeBigUInt64LE(BigInt(sectionOffset), 0x28)
  image.writeUInt16LE(64, 0x3a)
  image.writeUInt16LE(3, 0x3c)
  table.copy(image, stringOffset)
  dynamic.copy(image, dynamicOffset)
  const section = (index: number, type: number, offset: number, size: number, link: number): void => {
    const base = sectionOffset + index * 64
    image.writeUInt32LE(type, base + 4)
    image.writeBigUInt64LE(BigInt(offset), base + 24)
    image.writeBigUInt64LE(BigInt(size), base + 32)
    image.writeUInt32LE(link, base + 40)
  }
  section(1, 3, stringOffset, table.length, 0)
  section(2, 6, dynamicOffset, dynamic.length, 1)
  return image
}
