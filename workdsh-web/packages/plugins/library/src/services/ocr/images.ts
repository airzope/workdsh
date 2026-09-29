/** Decode pictures and render PDF pages to RGBA for OCR, using the Profile's native canvas. */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { RgbaImage } from './pipeline.js';

const require = createRequire(import.meta.url);
/** Longest side kept for a picture; detection resizes further. */
export const MAX_IMAGE_SIDE = 4096;
/** Pages of one TIFF that are recognized. */
export const MAX_TIFF_PAGES = 100;
/** Longest side of a rendered PDF page, about 180 DPI for A4. */
export const PDF_RENDER_SIDE = 2000;

type Canvas = typeof import('@napi-rs/canvas');
const canvas = (): Canvas => require('@napi-rs/canvas') as Canvas;

const isTiff = (bytes: Uint8Array): boolean => (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a);

function fit(width: number, height: number, side: number): { width: number, height: number } {
  const scale = Math.min(1, side / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function shrink(image: RgbaImage, side: number): RgbaImage {
  const size = fit(image.width, image.height, side);
  if (size.width === image.width && size.height === image.height) return image;
  const { createCanvas, ImageData } = canvas();
  const source = createCanvas(image.width, image.height);
  source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  const target = createCanvas(size.width, size.height);
  const context = target.getContext('2d');
  context.drawImage(source, 0, 0, size.width, size.height);
  return { width: size.width, height: size.height, data: context.getImageData(0, 0, size.width, size.height).data };
}

/**
 * Decode a picture into pages: one for PNG, JPEG, WebP, GIF or BMP, and one per frame for TIFF.
 * @param bytes - File content.
 * @returns Pixels, each at most MAX_IMAGE_SIDE on its longest side.
 */
export async function decodeImage(bytes: Uint8Array): Promise<RgbaImage[]> {
  if (isTiff(bytes)) {
    const UTIF = require('utif2') as typeof import('utif2');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const frames = UTIF.decode(buffer).filter(frame => (frame as { t256?: number[] }).t256 !== undefined).slice(0, MAX_TIFF_PAGES);
    if (frames.length === 0) throw new Error('library/invalid-image');
    return frames.map((frame) => {
      UTIF.decodeImage(buffer, frame);
      return shrink({ width: frame.width, height: frame.height, data: UTIF.toRGBA8(frame) }, MAX_IMAGE_SIDE);
    });
  }
  const { createCanvas, loadImage } = canvas();
  let picture: Awaited<ReturnType<Canvas['loadImage']>>;
  try { picture = await loadImage(Buffer.from(bytes)); }
  catch { throw new Error('library/invalid-image'); }
  const size = fit(picture.width, picture.height, MAX_IMAGE_SIDE);
  const target = createCanvas(size.width, size.height);
  const context = target.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(picture, 0, 0, size.width, size.height);
  return [{ width: size.width, height: size.height, data: context.getImageData(0, 0, size.width, size.height).data }];
}

/**
 * Render PDF pages on white, one at a time.
 * @param bytes - PDF content.
 * @param pages - 1-based page numbers.
 * @yields Each page number with its pixels.
 */
export async function* renderPdfPages(bytes: Uint8Array, pages: readonly number[]): AsyncGenerator<{ page: number, image: RgbaImage }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Non-embedded standard fonts render from PDF.js's own font data.
  const standardFontDataUrl = `${join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;
  const document = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, standardFontDataUrl }).promise;
  try {
    const factory = (document as unknown as { canvasFactory: { create(width: number, height: number): { canvas: { width: number, height: number }, context: CanvasRenderingContext2D } } }).canvasFactory;
    for (const number of pages) {
      const page = await document.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, PDF_RENDER_SIDE / Math.max(base.width, base.height)) });
      const { canvas: target, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, target.width, target.height);
      await page.render({ canvasContext: context, viewport, canvas: target as unknown as HTMLCanvasElement }).promise;
      const pixels = context.getImageData(0, 0, target.width, target.height);
      page.cleanup();
      yield { page: number, image: { width: pixels.width, height: pixels.height, data: pixels.data } };
    }
  } finally {
    await document.destroy();
  }
}
