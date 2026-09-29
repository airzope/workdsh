/**
 * Generate the packaged brand in build/brand from the brand selected by
 * WORKDSH_BRAND: application icons for Windows, macOS and Linux, tray bitmaps,
 * the in-app mark and the brand fields the carrier reads at startup.
 */

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { PackagedBrand } from '../src/brand.ts'
import { GENERATED_BRAND_DIRECTORY, brandDirectory, readBrand, type Brand, type BrandIdentity } from './brand.ts'

/** Native pixel sizes used by Windows chrome, taskbars, Explorer, and high-DPI variants. */
export const WINDOWS_APP_ICON_SIZES = Object.freeze([16, 20, 24, 28, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256])
/** Pixel width and height of the canonical logo and the macOS icon canvas. */
export const APP_ICON_CANVAS_SIZE = 1024
/** Pixel width and height of the centered artwork in the macOS icon. */
export const MAC_APP_ICON_ARTWORK_SIZE = 824
/** Transparent inset on each edge of the generated macOS icon. */
export const MAC_APP_ICON_INSET = (APP_ICON_CANVAS_SIZE - MAC_APP_ICON_ARTWORK_SIZE) / 2
/** Smallest logo that still gives sharp 256px frames. */
export const MINIMUM_LOGO_SIZE = 512

const SMALL_FRAME_MAX_SIZE = 40
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const TRAY_ICONS = [
  ['tray-iconTemplate.png', 'template', 16],
  ['tray-iconTemplate@2x.png', 'template', 32],
  ['tray-icon-blue.png', 'color', 16],
  ['tray-icon-blue@1.25x.png', 'color', 20],
  ['tray-icon-blue@1.5x.png', 'color', 24],
  ['tray-icon-blue@2x.png', 'color', 32],
] as const

/**
 * The 1024px logo every icon starts from. A 1024px source is used byte for
 * byte; other sizes are resampled once, keeping bit depth and ICC profile.
 * @param path - Brand logo PNG.
 * @returns PNG bytes.
 */
export async function canonicalLogo(path: string): Promise<Buffer> {
  const metadata = await sharp(path).metadata()
  if (metadata.format !== 'png' || metadata.width !== metadata.height || metadata.width < MINIMUM_LOGO_SIZE) {
    throw new Error(`generate-brand: ${path} must be a square PNG of at least ${MINIMUM_LOGO_SIZE}px`)
  }
  if (metadata.width === APP_ICON_CANVAS_SIZE) return readFile(path)
  return sharp(path, { failOn: 'warning' })
    .resize({ width: APP_ICON_CANVAS_SIZE, height: APP_ICON_CANVAS_SIZE, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .keepIccProfile()
    .png({ compressionLevel: 9, progressive: false, adaptiveFiltering: false, palette: false })
    .toBuffer()
}

/**
 * The brand mark with every inline color replaced.
 * @param source - Mark SVG text.
 * @param color - Replacement color, or undefined to keep the mark's colors.
 * @returns SVG text.
 */
export function recolorMark(source: string, color: string | undefined): string {
  if (/<style\b/iu.test(source) || /\bstyle\s*=/iu.test(source)) {
    throw new Error('generate-brand: the mark SVG must set colors with fill and stroke attributes, not styles')
  }
  if (color === undefined) return source
  return source.replace(/\b(fill|stroke)="(?!none")[^"]*"/gu, `$1="${color}"`)
}

/** The mark on a white rounded square, for Windows frames where the full logo loses detail. */
function smallFrameArtwork(mark: string): Buffer {
  const body = mark.replace(/^[\s\S]*?<svg[^>]*>\s*/u, '').replace(/<\/svg>\s*$/u, '')
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">'
    + '<rect width="256" height="256" rx="52" fill="#FFFFFF"/>'
    + `<g transform="translate(18 18) scale(0.86)">${body}</g>`
    + '</svg>',
  )
}

/**
 * Render one icon frame; small frames use the simplified artwork and receive a
 * restrained unsharp pass after Lanczos downsampling.
 */
async function renderFrame(logo: Buffer, small: Buffer, size: number): Promise<{ png: Buffer, rgba: Buffer }> {
  const input = size <= SMALL_FRAME_MAX_SIZE ? small : logo
  let pipeline = sharp(input, { failOn: 'warning' })
    .resize({ width: size, height: size, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .toColourspace('srgb')
    .ensureAlpha()
  if (size <= 96) pipeline = pipeline.sharpen({ sigma: size <= 32 ? 0.5 : 0.35 })
  const png = await pipeline.clone()
    .png({ compressionLevel: 9, progressive: false, adaptiveFiltering: false, palette: false })
    .toBuffer()
  const { data: rgba, info } = await pipeline.clone().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true })
  if (info.width !== size || info.height !== size || info.channels !== 4) {
    throw new Error(`generate-brand: failed to render ${size}x${size} RGBA frame`)
  }
  return { png, rgba }
}

/**
 * Encode an uncompressed 32-bit Windows DIB frame with an AND transparency mask.
 * Keeping sub-256px frames as DIBs avoids depending on small-PNG icon support in
 * older Win32 and installer image-loading paths.
 */
function encodeDibFrame(rgba: Buffer, size: number): Buffer {
  const xorBytes = size * size * 4
  const maskRowBytes = Math.ceil(size / 32) * 4
  const dib = Buffer.alloc(40 + xorBytes + maskRowBytes * size)
  dib.writeUInt32LE(40, 0)
  dib.writeInt32LE(size, 4)
  dib.writeInt32LE(size * 2, 8)
  dib.writeUInt16LE(1, 12)
  dib.writeUInt16LE(32, 14)
  dib.writeUInt32LE(0, 16)
  dib.writeUInt32LE(xorBytes, 20)
  const maskOffset = 40 + xorBytes
  for (let y = 0; y < size; y += 1) {
    const sourceRow = y * size * 4
    const destinationRow = 40 + (size - y - 1) * size * 4
    const destinationMaskRow = maskOffset + (size - y - 1) * maskRowBytes
    for (let x = 0; x < size; x += 1) {
      const source = sourceRow + x * 4
      const destination = destinationRow + x * 4
      dib[destination] = rgba[source + 2]!
      dib[destination + 1] = rgba[source + 1]!
      dib[destination + 2] = rgba[source]!
      dib[destination + 3] = rgba[source + 3]!
      if (rgba[source + 3] === 0) dib[destinationMaskRow + Math.floor(x / 8)]! |= 0x80 >> (x % 8)
    }
  }
  return dib
}

/** Wrap ordered image payloads in one Windows ICO directory. */
function encodeIco(frames: readonly { size: number, data: Buffer }[]): Buffer {
  const headerSize = 6 + frames.length * 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let dataOffset = headerSize
  for (const [index, frame] of frames.entries()) {
    const entry = 6 + index * 16
    header[entry] = frame.size === 256 ? 0 : frame.size
    header[entry + 1] = frame.size === 256 ? 0 : frame.size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(frame.data.length, entry + 8)
    header.writeUInt32LE(dataOffset, entry + 12)
    dataOffset += frame.data.length
  }
  return Buffer.concat([header, ...frames.map(frame => frame.data)])
}

/**
 * A Windows ICO with exact-DPI frames for the application, shortcuts and NSIS.
 * @param logo - Canonical logo PNG.
 * @param small - Artwork for frames up to 40px.
 * @returns ICO bytes.
 */
export async function windowsAppIcon(logo: Buffer, small: Buffer): Promise<Buffer> {
  const frames = await Promise.all(WINDOWS_APP_ICON_SIZES.map(async size => {
    const frame = await renderFrame(logo, small, size)
    return { size, data: size === 256 ? frame.png : encodeDibFrame(frame.rgba, size) }
  }))
  if (!frames.at(-1)?.data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('generate-brand: the 256px frame must use PNG encoding')
  }
  return encodeIco(frames)
}

/**
 * The macOS Dock icon: the logo inside the platform's visual safe area, with
 * the source color profile preserved.
 * @param logo - Canonical logo PNG.
 * @returns 1024px RGBA16 PNG bytes.
 */
export async function macAppIcon(logo: Buffer): Promise<Buffer> {
  const source = await sharp(logo).metadata()
  const rendered = await sharp(logo, { failOn: 'warning' })
    .resize({ width: MAC_APP_ICON_ARTWORK_SIZE, height: MAC_APP_ICON_ARTWORK_SIZE, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .extend({
      top: MAC_APP_ICON_INSET,
      bottom: MAC_APP_ICON_INSET,
      left: MAC_APP_ICON_INSET,
      right: MAC_APP_ICON_INSET,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toColourspace('rgb16')
    .keepIccProfile()
    .png({ compressionLevel: 9, progressive: false, adaptiveFiltering: false, palette: false })
    .toBuffer()
  const generated = await sharp(rendered).metadata()
  if (
    generated.width !== APP_ICON_CANVAS_SIZE
    || generated.height !== APP_ICON_CANVAS_SIZE
    || generated.channels !== 4
    || (source.icc !== undefined && generated.icc?.equals(source.icc) !== true)
  ) {
    throw new Error('generate-brand: the macOS icon did not preserve the source color data')
  }
  return rendered
}

/** A tray bitmap from the mark, or from the logo's silhouette when the brand has no mark. */
async function trayIcon(brand: Brand, logo: Buffer, mark: string | undefined, variant: 'template' | 'color', size: number): Promise<Buffer> {
  if (mark !== undefined) {
    const svg = recolorMark(mark, variant === 'template' ? '#000000' : brand.color)
    return sharp(Buffer.from(svg)).resize({ width: size, height: size, fit: 'contain' }).png({ compressionLevel: 9 }).toBuffer()
  }
  const resized = sharp(logo).resize({ width: size, height: size, fit: 'contain' }).ensureAlpha()
  if (variant === 'color') return resized.png({ compressionLevel: 9 }).toBuffer()
  const alpha = await resized.extractChannel('alpha').raw().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 3, background: '#000000' } })
    .joinChannel(alpha, { raw: { width: size, height: size, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/**
 * Write every packaged brand file.
 * @param brand - Validated brand.
 * @param output - Destination, normally build/brand.
 * @returns The packaged brand: identity for packaging, plus the mark file.
 */
export async function writeBrandAssets(brand: Brand, output: string = GENERATED_BRAND_DIRECTORY): Promise<BrandIdentity & PackagedBrand> {
  const logo = await canonicalLogo(brand.logo)
  const mark = brand.mark === undefined ? undefined : recolorMark(await readFile(brand.mark, 'utf8'), undefined)
  const markFile = mark === undefined ? 'mark.png' : 'mark.svg'
  const [ico, mac, trays, markBytes] = await Promise.all([
    windowsAppIcon(logo, mark === undefined ? logo : smallFrameArtwork(mark)),
    macAppIcon(logo),
    Promise.all(TRAY_ICONS.map(async ([name, variant, size]) => [name, await trayIcon(brand, logo, mark, variant, size)] as const)),
    mark === undefined
      ? sharp(logo).resize({ width: 256, height: 256, kernel: sharp.kernel.lanczos3 }).png({ compressionLevel: 9 }).toBuffer()
      : undefined,
  ])
  const { logo: _logo, mark: _mark, color: _color, ...names } = brand
  const packaged = { ...names, mark: markFile }
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'app-icon.png'), logo)
  await writeFile(join(output, 'app-icon.ico'), ico)
  await writeFile(join(output, 'app-icon-mac.png'), mac)
  for (const [name, bytes] of trays) await writeFile(join(output, name), bytes)
  if (markBytes === undefined) await copyFile(brand.mark!, join(output, markFile))
  else await writeFile(join(output, markFile), markBytes)
  await writeFile(join(output, 'brand.json'), `${JSON.stringify(packaged, null, 2)}\n`)
  return packaged
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const directory = brandDirectory()
  const brand = await writeBrandAssets(readBrand(directory))
  console.log(`Generated the ${brand.name} brand from ${directory}`)
}
