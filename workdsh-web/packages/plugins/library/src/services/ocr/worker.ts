/** Worker thread that owns the OCR engine, so recognition never blocks the Host event loop. */
import { parentPort } from 'node:worker_threads';
import { OcrEngine } from './engine.js';
import { decodeImage, renderPdfPages } from './images.js';
import { linesToText } from './pipeline.js';
import type { OcrJob, OcrReply, OcrPageResult } from './service.js';

if (!parentPort) throw new Error('library/ocr-worker');
const port = parentPort;
let engine: Promise<OcrEngine> | undefined;

async function run(job: OcrJob): Promise<OcrPageResult[]> {
  engine ??= OcrEngine.load();
  const ocr = await engine;
  const results: OcrPageResult[] = [];
  const page = async (index: number, image: Parameters<OcrEngine['recognize']>[0]): Promise<void> => {
    const lines = await ocr.recognize(image);
    results.push({ index, text: linesToText(lines), lines: lines.length, score: lines.length ? lines.reduce((sum, line) => sum + line.score, 0) / lines.length : 0 });
  };
  if (job.kind === 'image') {
    const images = await decodeImage(job.bytes);
    for (const [index, image] of images.entries()) await page(index + 1, image);
  } else {
    for await (const rendered of renderPdfPages(job.bytes, job.pages)) await page(rendered.page, rendered.image);
  }
  return results;
}

port.on('message', (job: OcrJob) => {
  run(job).then(
    pages => port.postMessage({ id: job.id, ok: true, pages } satisfies OcrReply),
    (cause: unknown) => port.postMessage({ id: job.id, ok: false, error: cause instanceof Error ? cause.message : String(cause) } satisfies OcrReply),
  );
});
