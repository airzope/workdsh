// Convert a CSV with the Library's AnyDoc engine and recognize a rendered
// picture with its PaddleOCR worker, loading only the packaged Library and
// its Profile dependencies. Run it with the bundled Node.
// Usage: node smoke-document-engines.mjs <workdsh-plugin-library directory>
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const library = process.argv[2]
if (!library) throw new Error('Usage: node smoke-document-engines.mjs <workdsh-plugin-library directory>')
const load = path => import(pathToFileURL(`${library}/${path}`).href)
const { convertToMarkdown, defaultConverterServices } = await load('dist/services/converters.js')
const { sharedOcr } = await load('dist/services/ocr/service.js')

const table = await convertToMarkdown('csv', new TextEncoder().encode('region,revenue\nEast,128500\n'), undefined, defaultConverterServices)
if (!/East.*128500/su.test(table.markdown)) throw new Error(`AnyDoc returned ${JSON.stringify(table.markdown)}`)

const { createCanvas } = createRequire(`${library}/package.json`)('@napi-rs/canvas')
const canvas = createCanvas(1100, 200)
const context = canvas.getContext('2d')
context.fillStyle = '#ffffff'
context.fillRect(0, 0, 1100, 200)
context.fillStyle = '#111111'
context.font = 'bold 60px sans-serif'
const expected = 'INVOICE 2026-0929'
context.fillText(expected, 60, 120)
// The host's sans-serif font decides the glyph shapes; with some fonts O and 0
// (or I and 1) are indistinguishable, which says nothing about the engine.
const glyphs = text => text.toUpperCase().replace(/O/gu, '0').replace(/[IL|]/gu, '1').replace(/\s+/gu, ' ').trim()
const started = performance.now()
let recognized
try {
  recognized = await convertToMarkdown('image', new Uint8Array(canvas.toBuffer('image/png')), undefined, defaultConverterServices)
  if (!glyphs(recognized.markdown).includes(glyphs(expected))) throw new Error(`OCR returned ${JSON.stringify(recognized.markdown)}`)
} finally {
  await sharedOcr.close()
}
console.log(`AnyDoc converted CSV; PaddleOCR read ${JSON.stringify(recognized.markdown.trim())} in ${String(Math.round(performance.now() - started))} ms`)
