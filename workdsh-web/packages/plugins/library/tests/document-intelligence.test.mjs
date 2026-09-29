import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { LibraryManager, parsePages, sharedOcr } from '../dist/index.js';
import { characterTable, decodeCtc, linesToText, minAreaRect, sortReadingOrder } from '../dist/services/ocr/pipeline.js';

after(() => sharedOcr.close());

const actor = { principalId: 'owner-a', organizationId: 'organization-a', requestId: 'request-a', resolvedBy: 'test' };

async function withLibrary(options, run) {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-library-documents-'));
  const ctx = new Context();
  try {
    await ctx.plugin(Storage);
    await ctx.plugin(JsonStorage, { root: join(root, 'storage') });
    await ctx.plugin(StorageDomain, { backend: 'json' });
    await ctx.plugin(LibraryManager, { root: join(root, 'library'), ...options });
    await run(ctx.workdshLibrary, join(root, 'library'));
  } finally {
    await ctx.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

let operation = 0;
const importFile = (manager, name, bytes) => manager.importAsset(actor, { name, bytes, operationId: `operation-${++operation}` });

/** Black text on white, large enough for the mobile detector at any DPI. */
function textPng(lines) {
  const canvas = createCanvas(1100, 90 + lines.length * 110);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111111';
  context.font = 'bold 60px sans-serif';
  lines.forEach((line, index) => context.fillText(line, 60, 110 + index * 110));
  return new Uint8Array(canvas.toBuffer('image/png'));
}

async function scannedPdf(pages) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const page of pages) {
    const target = document.addPage([595, 842]);
    if (page.text) target.drawText(page.text, { x: 60, y: 760, size: 20, font });
    if (page.png) {
      const image = await document.embedPng(page.png);
      target.drawImage(image, { x: 40, y: 500, width: 515, height: 515 * image.height / image.width });
    }
  }
  return new Uint8Array(await document.save());
}

test('OCR geometry, decoding and page selection', () => {
  const angle = Math.PI / 6;
  const points = [];
  for (let u = -50; u <= 50; u += 5) for (let v = -10; v <= 10; v += 5) points.push([200 + u * Math.cos(angle) - v * Math.sin(angle), 100 + u * Math.sin(angle) + v * Math.cos(angle)]);
  const rect = minAreaRect(points);
  assert.deepEqual([Math.round(Math.max(rect.width, rect.height)), Math.round(Math.min(rect.width, rect.height))], [100, 20]);
  assert.deepEqual([Math.round(rect.cx), Math.round(rect.cy)], [200, 100]);

  const table = characterTable('甲\n乙\n');
  assert.deepEqual(table, ['', '甲', '乙', ' ']);
  // Steps: 甲 甲 blank 乙 space.
  const probabilities = new Float32Array([0, 0.9, 0.1, 0, 0, 0.8, 0.2, 0, 0.9, 0.1, 0, 0, 0, 0, 0.7, 0, 0, 0, 0.3, 0.6]);
  assert.deepEqual(decodeCtc(probabilities, 5, 4, table).text, '甲乙 ');

  const box = (x, y, height = 20) => [[x, y], [x + 50, y], [x + 50, y + height], [x, y + height]];
  assert.deepEqual(sortReadingOrder([box(100, 104), box(0, 100), box(0, 200)]).map(b => b[0][0]), [0, 100, 0]);
  assert.equal(linesToText([
    { text: 'A', score: 1, box: box(0, 100) }, { text: 'B', score: 1, box: box(100, 102) },
    { text: 'C', score: 1, box: box(0, 125) }, { text: 'D', score: 1, box: box(0, 200) },
  ]), 'A B\nC\n\nD');

  assert.deepEqual(parsePages('1-3, 5', 10), [1, 2, 3, 5]);
  assert.deepEqual(parsePages(undefined, 3), [1, 2, 3]);
  assert.equal(parsePages('', 50).length, 20);
  assert.throws(() => parsePages('4-2', 10), /document\/invalid-pages/);
  assert.throws(() => parsePages('11', 10), /文档共 10 页/);
  assert.throws(() => parsePages('1-25', 30), /最多识别 20 页/);
});

test('AnyDoc converts CSV and RTF into searchable Markdown', async () => {
  await withLibrary({}, async (manager) => {
    const csv = await importFile(manager, '季度报表.csv', new TextEncoder().encode('地区,收入\n华东,128500\n华南,97300\n'));
    const rtf = await importFile(manager, 'memo.rtf', new TextEncoder().encode('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Quarterly memo about AnyDoc conversion.\\par}'));
    assert.equal(csv.asset.kind, 'csv');
    assert.equal(csv.revision.conversionStatus, 'ready');
    assert.match(await manager.readText(actor, csv.asset.id), /华东.*128500/s);
    assert.equal(rtf.asset.kind, 'rtf');
    assert.match(await manager.readText(actor, rtf.asset.id), /Quarterly memo about AnyDoc conversion/);
    const hits = await manager.search(actor, '97300');
    assert.deepEqual(hits.map(hit => hit.name), ['季度报表.csv']);
    await assert.rejects(importFile(manager, 'broken.doc', new TextEncoder().encode('not a word file')), /library\/invalid-document/);
  });
});

test('PaddleOCR recognizes pictures and only the scanned pages of a PDF', async () => {
  await withLibrary({}, async (manager) => {
    const png = textPng(['INVOICE 2026-0929', 'TOTAL 17980']);
    const picture = await importFile(manager, 'invoice.png', png);
    assert.equal(picture.asset.kind, 'image');
    assert.equal(picture.asset.mediaType, 'image/png');
    assert.equal(picture.revision.conversionStatus, 'ready');
    const pictureText = await manager.readText(actor, picture.asset.id);
    assert.match(pictureText, /INVOICE 2026-0929/);
    assert.match(pictureText, /TOTAL 17980/);
    assert.match(picture.revision.conversionWarnings.join(' '), /PaddleOCR/);

    const mixed = await importFile(manager, 'mixed.pdf', await scannedPdf([{ text: 'Typed page with a text layer' }, { png }]));
    const mixedText = await manager.readText(actor, mixed.asset.id);
    assert.match(mixedText, /## 第 1 页\n\nTyped page with a text layer/);
    assert.match(mixedText, /## 第 2 页\n\n[^#]*INVOICE 2026-0929/);
    assert.match(mixed.revision.conversionWarnings.join(' '), /第 2 页没有文字层，已用 PaddleOCR/);

    await assert.rejects(importFile(manager, 'blank.png', textPng([])), /library\/no-text/);
  });
});

test('a slow conversion does not hold other Library calls, and an OCR failure keeps the original', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const converter = async (kind) => {
    if (kind === 'image') throw new Error('library/ocr-failed: the recognition worker stopped');
    await gate;
    return { markdown: '# slow\n', warnings: [], locations: [] };
  };
  await withLibrary({ converter }, async (manager, libraryRoot) => {
    const slow = importFile(manager, 'slow.md', new TextEncoder().encode('# slow'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(await manager.list(actor), []);
    release();
    assert.equal((await slow).revision.conversionStatus, 'ready');

    const failed = await importFile(manager, 'scan.png', new Uint8Array([1, 2, 3]));
    assert.equal(failed.revision.conversionStatus, 'failed');
    assert.match(failed.revision.conversionWarnings[0], /转换失败：library\/ocr-failed/);
    assert.deepEqual([...await readFile(join(libraryRoot, failed.revision.originalRelativePath))], [1, 2, 3]);
  });
});

test('document tools convert and recognize workspace files by path', async () => {
  const { registerDocumentTools } = await import('../dist/tools/document-tools.js');
  const root = await mkdtemp(join(tmpdir(), 'workdsh-document-tools-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, 'sales.csv'), '地区,收入\n华东,128500\n');
    await writeFile(join(root, 'receipt.png'), textPng(['RECEIPT 4521']));
    await writeFile(join(root, 'scan.pdf'), await scannedPdf([{ png: textPng(['PAGE ONE 111']) }, { png: textPng(['PAGE TWO 222']) }]));
    const tools = new Map();
    const reads = [];
    const ctx = {
      tools: { register: (tool) => { tools.set(tool.name, tool); return () => {}; } },
      fs: {
        resolve: async (path, options) => join(options.cwd, path),
        readBytes: async (target, _signal, maxBytes) => { reads.push([target, maxBytes]); return new Uint8Array(await readFile(target)); },
      },
    };
    registerDocumentTools(ctx);
    const exec = { signal: undefined, agent: { session: { header: { cwd: root } } } };

    const converted = await tools.get('document_to_markdown').execute({ path: 'sales.csv' }, exec);
    assert.equal(converted.kind, 'csv');
    assert.match(converted.content, /华东.*128500/s);
    assert.equal(converted.truncated, false);
    const paged = await tools.get('document_to_markdown').execute({ path: 'sales.csv', offset: 2, limit: 3 }, exec);
    assert.equal(paged.content, converted.content.slice(2, 5));
    assert.equal(paged.next_offset, 5);
    assert.deepEqual(reads[0], [join(root, 'sales.csv'), 50 * 1024 * 1024]);

    const picture = await tools.get('document_ocr').execute({ path: 'receipt.png' }, exec);
    assert.equal(picture.pages.length, 1);
    assert.match(picture.pages[0].text, /RECEIPT 4521/);
    assert.ok(picture.pages[0].confidence > 0.8);
    const second = await tools.get('document_ocr').execute({ path: 'scan.pdf', pages: '2' }, exec);
    assert.deepEqual(second.pages.map(page => page.page), [2]);
    assert.match(second.pages[0].text, /PAGE TWO 222/);
    await assert.rejects(tools.get('document_ocr').execute({ path: 'sales.csv' }, exec), /只识别图片和 PDF/);
    await assert.rejects(tools.get('document_to_markdown').execute({ path: 'archive.zip' }, exec), /document\/unsupported-format/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
