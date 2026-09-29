import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-fs';
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { convertToMarkdown, defaultConverterServices, pdfPageCount, type ConversionResult } from '../services/converters.js';
import { LIBRARY_EXTENSION_KINDS, LIBRARY_MAX_BYTES } from '../services/library-manager.js';

/** Characters returned per call unless `limit` says otherwise. */
const PAGE = 12_000;
const MAX_PAGE = 20_000;
/** PDF pages one `document_ocr` call recognizes. */
const MAX_OCR_PAGES = 20;
/** Recent conversions kept so paging through a result does not convert again. */
const CACHE_ENTRIES = 8;
const cache = new Map<string, ConversionResult>();

const FORMATS = 'Word（DOC/DOCX）、Excel（XLS/XLSX）、PowerPoint（PPT/PPTX）、OpenDocument（ODT/ODS/ODP）、RTF、EPUB、CSV、HTML、Markdown、TXT、PDF 和图片（PNG/JPEG/BMP/GIF/WebP/TIFF）';

async function readWorkspaceFile(ctx: Context, path: string, exec: ToolRunContext): Promise<Uint8Array> {
  if (!ctx.fs) throw new Error('document/fs-unavailable: 此会话没有 Harness 文件服务，不能读取工作区文件。');
  const target = await ctx.fs.resolve(path, { cwd: exec.agent?.session.header.cwd, signal: exec.signal });
  return ctx.fs.readBytes(target, exec.signal, LIBRARY_MAX_BYTES);
}

function kindOf(path: string): NonNullable<(typeof LIBRARY_EXTENSION_KINDS)[string]> {
  const kind = LIBRARY_EXTENSION_KINDS[extname(path).toLowerCase()];
  if (!kind) throw new Error(`document/unsupported-format: 支持 ${FORMATS}。`);
  return kind;
}

/**
 * Parse page selections such as `1-3,5`.
 * @param value - Selection text.
 * @param count - Pages in the document.
 * @returns Sorted unique pages, at most MAX_OCR_PAGES.
 */
export function parsePages(value: string | undefined, count: number): number[] {
  if (value === undefined || !value.trim()) return Array.from({ length: Math.min(count, MAX_OCR_PAGES) }, (_, index) => index + 1);
  const pages = new Set<number>();
  for (const part of value.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw new Error('document/invalid-pages: 页码格式如 1-3,5。');
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    if (from < 1 || to < from || to > count) throw new Error(`document/invalid-pages: 文档共 ${String(count)} 页。`);
    for (let page = from; page <= to; page++) pages.add(page);
  }
  if (pages.size > MAX_OCR_PAGES) throw new Error(`document/invalid-pages: 每次最多识别 ${String(MAX_OCR_PAGES)} 页。`);
  return [...pages].sort((a, b) => a - b);
}

export function registerDocumentTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'document_to_markdown',
    description: `读取工作区中的文档，本地离线转换为 Markdown 后返回：${FORMATS}。Office、OpenDocument、RTF、EPUB 与 CSV 由 AnyDoc 转换；PDF 中没有文字层的扫描页和图片由 PaddleOCR（PP-OCRv5）识别。文件不会离开本机。长结果用 offset 继续读取。只需图片或扫描页的逐页文字与置信度时，用 document_ocr。`,
    parameters: {
      path: { type: 'string', required: true, description: '工作区文件路径，相对路径按当前会话目录解析。' },
      offset: { type: 'integer', description: '从 0 开始的字符偏移量。' },
      limit: { type: 'integer', description: '本次最多返回的字符数，范围 1–20000，默认 12000。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, kind: { type: 'string', required: true }, content: { type: 'string', required: true },
        offset: { type: 'integer', required: true }, next_offset: { type: 'integer' }, total_length: { type: 'integer', required: true },
        truncated: { type: 'boolean', required: true }, warnings: { type: 'array', required: true, items: { type: 'string' } },
      } },
      render: (_args, value) => [{ type: 'text', text: `${value.content}${value.truncated ? `\n\n…（共 ${String(value.total_length)} 字符，用 offset=${String(value.next_offset)} 继续读取）` : ''}${value.warnings.length ? `\n\n注意：${value.warnings.join(' ')}` : ''}` }],
    },
    async execute(args, exec) {
      const kind = kindOf(args.path);
      const offset = args.offset ?? 0;
      const limit = args.limit ?? PAGE;
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new Error('document/invalid-page: offset 不能为负，limit 为 1–20000。');
      const bytes = await readWorkspaceFile(ctx, args.path, exec);
      const key = createHash('sha256').update(kind).update(bytes).digest('hex');
      let result = cache.get(key);
      if (result === undefined) {
        result = await convertToMarkdown(kind, Uint8Array.from(bytes), exec.signal, defaultConverterServices);
        cache.set(key, result);
        if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      }
      const content = result.markdown.slice(offset, offset + limit);
      const next = offset + content.length;
      const truncated = next < result.markdown.length;
      return { path: args.path, kind, content, offset, ...(truncated ? { next_offset: next } : {}), total_length: result.markdown.length, truncated, warnings: [...result.warnings] };
    },
  }));
  ctx.tools.register(defineTool({
    name: 'document_ocr',
    description: '用 PaddleOCR（PP-OCRv5 移动版）在本机识别工作区图片（PNG/JPEG/BMP/GIF/WebP/TIFF）或 PDF 页面中的文字，返回每页按阅读顺序排列的文本、行数和平均置信度。PDF 会整页渲染后识别，也适用于已有文字层但需要核对版面的页面；pages 形如 1-3,5，默认前 20 页，每次最多 20 页。识别结果请核对关键数字与专有名词。',
    parameters: {
      path: { type: 'string', required: true, description: '工作区文件路径，相对路径按当前会话目录解析。' },
      pages: { type: 'string', description: 'PDF 页码，形如 1-3,5；图片忽略此参数。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true },
        pages: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          page: { type: 'integer', required: true }, text: { type: 'string', required: true }, lines: { type: 'integer', required: true }, confidence: { type: 'number', required: true },
        } } },
      } },
      render: (_args, value) => [{ type: 'text', text: value.pages.map(page => `## ${basename(value.path)} · 第 ${String(page.page)} 页（${String(page.lines)} 行，置信度 ${page.confidence.toFixed(2)}）\n\n${page.text || '（未识别到文字）'}`).join('\n\n') }],
    },
    async execute(args, exec) {
      const kind = kindOf(args.path);
      if (kind !== 'image' && kind !== 'pdf') throw new Error('document/unsupported-format: document_ocr 只识别图片和 PDF；其他文档请用 document_to_markdown。');
      const bytes = await readWorkspaceFile(ctx, args.path, exec);
      const results = kind === 'image'
        ? await defaultConverterServices.ocr.recognizeImage(bytes, exec.signal)
        : await defaultConverterServices.ocr.recognizePdfPages(bytes, parsePages(args.pages, await pdfPageCount(bytes)), exec.signal);
      return { path: args.path, pages: results.map(page => ({ page: page.index, text: page.text, lines: page.lines, confidence: Number(page.score.toFixed(3)) })) };
    },
  }));
}
