import JSZip from 'jszip';
import type { LibraryAssetKind } from 'workdsh-contracts/library';
import { sharedOcr, type OcrApi, type OcrPageResult } from './ocr/service.js';

export interface ConversionResult {
  readonly markdown: string;
  readonly warnings: readonly string[];
  readonly locations: readonly { readonly kind: 'page' | 'paragraph' | 'slide'; readonly index: number; readonly label: string }[];
}

/** The parts of @firecrawl/anydoc that conversion uses. */
export interface AnyDocApi {
  toMarkdownBytes(bytes: Uint8Array, format?: string | null): Promise<string>;
  formatFromBytes(bytes: Uint8Array): string | null;
}

/** Engines behind conversion, replaceable in tests. */
export interface ConverterServices {
  readonly ocr: OcrApi;
  readonly anydoc: () => Promise<AnyDocApi>;
}

export const defaultConverterServices: ConverterServices = {
  ocr: sharedOcr,
  anydoc: async () => await import('@firecrawl/anydoc') as unknown as AnyDocApi,
};

/** Kinds converted by AnyDoc, which runs locally and never uses its hosted OCR option. */
export const ANYDOC_KINDS = ['doc', 'xls', 'xlsx', 'ppt', 'odt', 'ods', 'odp', 'rtf', 'epub', 'csv'] as const satisfies readonly LibraryAssetKind[];
/** PDF pages without a text layer that are recognized per document. */
export const MAX_OCR_PAGES = 100;

const MAX_ZIP_ENTRIES = 5_000;
const MAX_ZIP_UNCOMPRESSED = 100 * 1024 * 1024;
const MAX_ZIP_RATIO = 200;
type ZipEntryDetails = { readonly compressedSize?: number; readonly uncompressedSize?: number };
type CheckedZipEntry = JSZip.JSZipObject & { readonly unsafeOriginalName?: string; readonly _data?: ZipEntryDetails };

const checkSignal = (signal?: AbortSignal): void => signal?.throwIfAborted();
async function safeZip(bytes: Uint8Array, signal?: AbortSignal): Promise<JSZip> {
  checkSignal(signal);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('library/invalid-office-file');
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true }); }
  catch { throw new Error('library/invalid-office-file'); }
  checkSignal(signal);
  const entries = Object.values(zip.files) as CheckedZipEntry[];
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error('library/archive-limit');
  let expanded = 0;
  for (const entry of entries) {
    const original = entry.unsafeOriginalName ?? entry.name;
    if (original.split(/[\\/]+/).some(part => part === '..') || original.startsWith('/') || /^[a-z]:/i.test(original)) throw new Error('library/archive-path');
    const uncompressed = entry._data?.uncompressedSize ?? 0; const compressed = entry._data?.compressedSize ?? 0;
    expanded += uncompressed;
    if (expanded > MAX_ZIP_UNCOMPRESSED || (uncompressed > 1024 * 1024 && uncompressed / Math.max(1, compressed) > MAX_ZIP_RATIO)) throw new Error('library/archive-limit');
  }
  return zip;
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (value: string): string => value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
  if (code[0] !== '#') return entities[code] ?? whole;
  const point = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
  return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
});

function html(bytes: Uint8Array): ConversionResult {
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('library/invalid-text'); }
  if (!/<(?:html|head|body|main|article|section|div|p|h[1-6])(?:\s|>)/i.test(source)) throw new Error('library/invalid-html');
  const locations: ConversionResult['locations'][number][] = [];
  let headingIndex = 0;
  for (const match of source.matchAll(/<h([1-6])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/gi)) {
    const title = decodeXml((match[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (title) { headingIndex += 1; locations.push({ kind: 'paragraph', index: headingIndex, label: `标题 ${headingIndex}：${title}` }); }
  }
  const safe = source.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|header|footer|li|tr|h[1-6])>/gi, '\n');
  const blocks = safe.replace(/<[^>]+>/g, ' ').split(/\n+/)
    .map(raw => decodeXml(raw).replace(/[\t ]+/g, ' ').trim()).filter(Boolean);
  return { markdown: `${blocks.join('\n\n')}\n`, locations, warnings: ['脚本、样式、SVG 和画布内容不进入检索文本；原始 HTML 仍保留并在隔离预览中打开。'] };
}
const textNodes = (xml: string): string[] => [...xml.matchAll(/<(?:w:t|a:t)(?:\s[^>]*)?>([\s\S]*?)<\/(?:w:t|a:t)>/g)]
  .map((match) => decodeXml(match[1] ?? '').trim()).filter(Boolean);

async function docx(bytes: Uint8Array, signal?: AbortSignal): Promise<ConversionResult> {
  const zip = await safeZip(bytes, signal);
  const xml = await zip.file('word/document.xml')?.async('text');
  if (!xml) throw new Error('library/invalid-docx');
  checkSignal(signal);
  const blocks: string[] = []; const locations: ConversionResult['locations'][number][] = []; let paragraph = 0;
  for (const match of xml.matchAll(/<(w:p|w:tbl)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const tag = match[1], body = match[2] ?? '';
    if (tag === 'w:tbl') {
      const rows = [...body.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)].map(row => [...((row[1] ?? '').matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g))].map(cell => textNodes(cell[1] ?? '').join('').replace(/\|/g, '\\|'))).filter(row => row.length);
      if (rows.length) { const width = Math.max(...rows.map(row => row.length)); const normalized = rows.map(row => [...row, ...Array(Math.max(0, width - row.length)).fill('')]); blocks.push([`| ${normalized[0]!.join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`, ...normalized.slice(1).map(row => `| ${row.join(' | ')} |`)].join('\n')); }
      continue;
    }
    const text = textNodes(body).join(''); if (!text) continue; paragraph += 1;
    const heading = /<w:pStyle[^>]*w:val="(?:Heading|标题)([1-6])"/i.exec(body)?.[1];
    const list = /<w:numPr(?:\s[^>]*)?>/.test(body);
    blocks.push(heading ? `${'#'.repeat(Number(heading))} ${text}` : list ? `- ${text}` : text);
    locations.push({ kind: 'paragraph', index: paragraph, label: heading ? `标题 ${heading} · 段落 ${paragraph}` : `段落 ${paragraph}` });
  }
  return { markdown: `${blocks.join('\n\n')}\n`, locations, warnings: ['图片和复杂嵌入对象未写入检索文本。'] };
}

async function pptx(bytes: Uint8Array, signal?: AbortSignal): Promise<ConversionResult> {
  const zip = await safeZip(bytes, signal);
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  if (!slides.length) throw new Error('library/invalid-pptx');
  const sections: string[] = []; const locations: ConversionResult['locations'][number][] = [];
  for (let index = 0; index < slides.length; index += 1) {
    checkSignal(signal);
    const xml = await zip.file(slides[index]!)!.async('text');
    const values = textNodes(xml);
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${index + 1}.xml`)?.async('text');
    const notes = notesXml ? textNodes(notesXml).filter(value => !/^\d+$/.test(value)) : [];
    const title = values[0] ?? '';
    sections.push(`## 第 ${index + 1} 页${title ? `：${title}` : ''}\n\n${values.slice(title ? 1 : 0).join('\n\n')}${notes.length ? `\n\n### 备注\n\n${notes.join('\n\n')}` : ''}`);
    locations.push({ kind: 'slide', index: index + 1, label: `第 ${index + 1} 页${title ? `：${title}` : ''}` });
  }
  return { markdown: `${sections.join('\n\n')}\n`, locations, warnings: ['图片、图表、动画和空间布局未写入检索文本。'] };
}

const headingLocations = (markdown: string): ConversionResult['locations'][number][] =>
  [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].slice(0, 500).map((match, index) => ({ kind: 'paragraph', index: index + 1, label: `标题 ${match[1]!.length}：${match[2]!.trim().slice(0, 80)}` }));

async function anydoc(kind: LibraryAssetKind, bytes: Uint8Array, services: ConverterServices, signal?: AbortSignal): Promise<ConversionResult> {
  checkSignal(signal);
  const engine = await services.anydoc();
  // Content wins over the extension: a .doc saved as RTF still converts.
  const format = kind === 'csv' ? 'csv' : engine.formatFromBytes(bytes) ?? (kind === 'xls' ? 'xlsx' : kind);
  let markdown: string;
  try { markdown = await engine.toMarkdownBytes(bytes, format); }
  catch (cause) {
    const code = (cause as { code?: unknown }).code;
    if (code === 'encrypted') throw new Error('library/encrypted');
    if (code === 'resourceLimit') throw new Error('library/archive-limit');
    if (code === 'unsupported' || code === 'malformed' || code === 'missingPart') throw new Error('library/invalid-document');
    throw cause;
  }
  checkSignal(signal);
  if (!markdown.trim()) throw new Error('library/invalid-document');
  const warnings = kind === 'csv' || kind === 'xls' || kind === 'xlsx' || kind === 'ods'
    ? ['表格按工作表写入检索文本；公式只保留计算结果。']
    : ['图片按替代文字写入检索文本；图片中的文字未识别。'];
  return { markdown: markdown.endsWith('\n') ? markdown : `${markdown}\n`, locations: headingLocations(markdown), warnings };
}

const pageList = (pages: readonly number[]): string => `第 ${pages.slice(0, 10).join('、')} 页${pages.length > 10 ? `等 ${String(pages.length)} 页` : ''}`;

const ocrWarning = (pages: readonly OcrPageResult[], label: (index: number) => string): string[] => {
  const empty = pages.filter(page => !page.text.trim()).map(page => label(page.index));
  return empty.length ? [`${empty.slice(0, 10).join('、')}${empty.length > 10 ? ` 等 ${String(empty.length)} 处` : ''}未识别到文字。`] : [];
};

async function image(bytes: Uint8Array, services: ConverterServices, signal?: AbortSignal): Promise<ConversionResult> {
  checkSignal(signal);
  const pages = await services.ocr.recognizeImage(bytes, signal);
  const single = pages.length === 1;
  const sections = pages.map(page => single ? page.text : `## 第 ${page.index} 页\n\n${page.text}`);
  if (!pages.some(page => page.text.trim())) throw new Error('library/no-text');
  return {
    markdown: `${sections.join('\n\n')}\n`,
    locations: pages.map(page => ({ kind: 'page', index: page.index, label: single ? '图片' : `第 ${page.index} 页` })),
    warnings: ['文字由 PaddleOCR（PP-OCRv5 移动版）识别，请核对关键数字与专有名词。', ...ocrWarning(pages, index => single ? '图片' : `第 ${index} 页`)],
  };
}

async function pdf(bytes: Uint8Array, services: ConverterServices, signal?: AbortSignal): Promise<ConversionResult> {
  checkSignal(signal);
  // PDF.js detaches the buffer it parses; OCR renders the pages from this copy.
  const pages = Uint8Array.from(bytes);
  if (new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('library/invalid-pdf');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let document: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try { document = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false }).promise; }
  catch { throw new Error('library/invalid-pdf'); }
  const texts: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      checkSignal(signal); const page = await document.getPage(pageNumber); const content = await page.getTextContent();
      texts.push(content.items.map((item) => 'str' in item ? item.str : '').filter(Boolean).join(' '));
    }
  } finally { await document.destroy(); }
  // Pages without a text layer are scans or pictures of text.
  const scanned = texts.flatMap((text, index) => text.trim() ? [] : [index + 1]);
  const warnings: string[] = [];
  if (scanned.length) {
    const recognized = scanned.slice(0, MAX_OCR_PAGES);
    try {
      for (const page of await services.ocr.recognizePdfPages(pages, recognized, signal)) texts[page.index - 1] = page.text;
      warnings.push(`${scanned.length === texts.length ? `全部 ${String(texts.length)} 页` : pageList(scanned)}没有文字层，已用 PaddleOCR（PP-OCRv5 移动版）识别，请核对关键数字与专有名词。`);
      if (scanned.length > recognized.length) warnings.push(`另有 ${String(scanned.length - recognized.length)} 页超过单个文件 ${String(MAX_OCR_PAGES)} 页的识别上限，未写入检索文本。`);
      const empty = recognized.filter(index => !texts[index - 1]?.trim());
      if (empty.length) warnings.push(`${pageList(empty)}未识别到文字。`);
    } catch (cause) {
      if (signal?.aborted) throw cause;
      warnings.push(`文字识别不可用：${cause instanceof Error ? cause.message : String(cause)}；没有文字层的页面未写入检索文本。`);
    }
  }
  const sections = texts.map((text, index) => `## 第 ${index + 1} 页\n\n${text}`);
  return { markdown: `${sections.join('\n\n')}\n`, locations: sections.map((_, index) => ({ kind: 'page', index: index + 1, label: `第 ${index + 1} 页` })), warnings };
}

/**
 * Count the pages of a PDF.
 * @param bytes - PDF content; a copy is parsed.
 * @returns The page count.
 */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  if (new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('library/invalid-pdf');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let document: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try { document = await pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, isEvalSupported: false }).promise; }
  catch { throw new Error('library/invalid-pdf'); }
  try { return document.numPages; } finally { await document.destroy(); }
}

export async function convertToMarkdown(kind: LibraryAssetKind, bytes: Uint8Array, signal?: AbortSignal, services: ConverterServices = defaultConverterServices): Promise<ConversionResult> {
  checkSignal(signal);
  if (kind === 'markdown' || kind === 'text') {
    try { return { markdown: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n'), warnings: [], locations: [] }; }
    catch { throw new Error('library/invalid-text'); }
  }
  if (kind === 'docx') return docx(bytes, signal);
  if (kind === 'pptx') return pptx(bytes, signal);
  if (kind === 'html') return html(bytes);
  if (kind === 'image') return image(bytes, services, signal);
  if ((ANYDOC_KINDS as readonly LibraryAssetKind[]).includes(kind)) return anydoc(kind, bytes, services, signal);
  if (kind === 'pdf') return pdf(bytes, services, signal);
  throw new Error('library/unsupported-format');
}
