/** Host-side client of the OCR worker thread. */
import { Worker } from 'node:worker_threads';

/** Text recognized on one page, 1-based. */
export interface OcrPageResult {
  readonly index: number;
  readonly text: string;
  readonly lines: number;
  readonly score: number;
}

export type OcrJob =
  | { readonly id: number, readonly kind: 'image', readonly bytes: Uint8Array }
  | { readonly id: number, readonly kind: 'pdf', readonly bytes: Uint8Array, readonly pages: readonly number[] };
export type OcrReply = { readonly id: number, readonly ok: true, readonly pages: OcrPageResult[] } | { readonly id: number, readonly ok: false, readonly error: string };

/** Text recognition used by conversion and tools. */
export interface OcrApi {
  recognizeImage(bytes: Uint8Array, signal?: AbortSignal): Promise<OcrPageResult[]>;
  recognizePdfPages(bytes: Uint8Array, pages: readonly number[], signal?: AbortSignal): Promise<OcrPageResult[]>;
}

/** The worker exits after this long without work, releasing about 200 MB of model memory. */
const IDLE_MS = 120_000;

/**
 * Runs one OCR job at a time in a lazily started worker. Aborting a job ends
 * the worker; the next job starts a fresh one.
 */
export class OcrWorker implements OcrApi {
  private worker: Worker | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private idle: NodeJS.Timeout | undefined;
  private nextId = 0;

  constructor(private readonly entry: URL = new URL('./worker.js', import.meta.url)) {}

  recognizeImage(bytes: Uint8Array, signal?: AbortSignal): Promise<OcrPageResult[]> {
    return this.enqueue({ id: ++this.nextId, kind: 'image', bytes: Uint8Array.from(bytes) }, signal);
  }

  recognizePdfPages(bytes: Uint8Array, pages: readonly number[], signal?: AbortSignal): Promise<OcrPageResult[]> {
    return this.enqueue({ id: ++this.nextId, kind: 'pdf', bytes: Uint8Array.from(bytes), pages: [...pages] }, signal);
  }

  /** End the worker now. */
  async close(): Promise<void> {
    clearTimeout(this.idle);
    const worker = this.worker;
    this.worker = undefined;
    await worker?.terminate();
  }

  private enqueue(job: OcrJob, signal?: AbortSignal): Promise<OcrPageResult[]> {
    const next = this.queue.then(() => this.run(job, signal));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private run(job: OcrJob, signal?: AbortSignal): Promise<OcrPageResult[]> {
    signal?.throwIfAborted();
    clearTimeout(this.idle);
    // Workers inherit execArgv; --input-type (from `node --input-type=module -e`) is invalid for a file entry.
    const worker = this.worker ??= new Worker(this.entry, { execArgv: process.execArgv.filter(argument => !argument.startsWith('--input-type')) });
    // Keep the process alive while a job runs; an idle worker must not.
    worker.ref();
    return new Promise<OcrPageResult[]>((resolve, reject) => {
      const settle = (): void => {
        worker.off('message', onMessage); worker.off('error', onError); worker.off('exit', onExit); signal?.removeEventListener('abort', onAbort);
        worker.unref();
        if (this.worker === worker) this.idle = setTimeout(() => void this.close(), IDLE_MS).unref();
      };
      const onMessage = (reply: OcrReply): void => {
        if (reply.id !== job.id) return;
        settle();
        if (reply.ok) resolve(reply.pages);
        else reject(new Error(reply.error.startsWith('library/') ? reply.error : `library/ocr-failed: ${reply.error}`));
      };
      const onError = (cause: Error): void => { settle(); this.worker = undefined; reject(new Error(`library/ocr-failed: ${cause.message}`)); };
      const onExit = (): void => { settle(); if (this.worker === worker) this.worker = undefined; reject(new Error('library/ocr-failed: the recognition worker stopped')); };
      const onAbort = (): void => { settle(); if (this.worker === worker) this.worker = undefined; void worker.terminate(); reject(signal?.reason ?? new Error('aborted')); };
      worker.on('message', onMessage); worker.once('error', onError); worker.once('exit', onExit); signal?.addEventListener('abort', onAbort, { once: true });
      worker.postMessage(job, [job.bytes.buffer as ArrayBuffer]);
    });
  }
}

/** One worker for the Host process. */
export const sharedOcr = new OcrWorker();
