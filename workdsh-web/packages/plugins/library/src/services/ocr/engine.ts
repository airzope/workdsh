/** PP-OCRv5 mobile text detection and recognition on ONNX Runtime's WebAssembly backend. */
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import type * as OrtModule from 'onnxruntime-web';
import { characterTable, decodeCtc, detectionBoxes, detectionInput, recognitionInput, type OcrLine, type RgbaImage } from './pipeline.js';

/** Resources prepared by scripts/prepare-library-ocr.mjs and shipped in the package. */
export const OCR_RESOURCES = new URL('../../../resources/ocr/', import.meta.url);
export const OCR_FILES = {
  detection: 'ppocr_v5_mobile_det.onnx',
  recognition: 'ppocr_v5_mobile_rec.onnx',
  dictionary: 'ppocrv5_dict.txt',
  runtime: 'ort/ort.node.min.mjs',
} as const;
/** Lines below this mean confidence are dropped as noise. */
const MIN_SCORE = 0.5;

export class OcrEngine {
  private constructor(
    private readonly ort: typeof OrtModule,
    private readonly detector: OrtModule.InferenceSession,
    private readonly recognizer: OrtModule.InferenceSession,
    private readonly table: readonly string[],
  ) {}

  /**
   * Load the vendored runtime and models. WebAssembly keeps OCR free of
   * per-platform binaries, so it runs wherever the bundled Node does.
   * @param resources - Directory with the models and the runtime.
   * @param threads - WebAssembly threads.
   * @returns A ready engine.
   */
  static async load(resources: URL = OCR_RESOURCES, threads = Math.max(1, Math.min(4, availableParallelism() - 1))): Promise<OcrEngine> {
    const ort = await import(new URL(OCR_FILES.runtime, resources).href) as typeof OrtModule;
    ort.env.wasm.numThreads = threads;
    ort.env.logLevel = 'error';
    const [detection, recognition, dictionary] = await Promise.all([
      readFile(new URL(OCR_FILES.detection, resources)),
      readFile(new URL(OCR_FILES.recognition, resources)),
      readFile(new URL(OCR_FILES.dictionary, resources), 'utf8'),
    ]);
    const options: OrtModule.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const [detector, recognizer] = await Promise.all([
      ort.InferenceSession.create(new Uint8Array(detection), options),
      ort.InferenceSession.create(new Uint8Array(recognition), options),
    ]);
    return new OcrEngine(ort, detector, recognizer, characterTable(dictionary));
  }

  /**
   * Recognize the text lines of one page or picture.
   * @param image - Decoded pixels.
   * @param signal - Stops between lines.
   * @returns Lines in reading order.
   */
  async recognize(image: RgbaImage, signal?: AbortSignal): Promise<OcrLine[]> {
    const input = detectionInput(image);
    const detected = await this.detector.run({ [this.detector.inputNames[0]!]: new this.ort.Tensor('float32', input.data, [1, 3, input.height, input.width]) });
    const map = detected[this.detector.outputNames[0]!]!;
    const boxes = detectionBoxes(map.data as Float32Array, input.width, input.height, image.width / input.width, image.height / input.height);
    const lines: OcrLine[] = [];
    for (const box of boxes) {
      signal?.throwIfAborted();
      const crop = recognitionInput(image, box);
      const output = (await this.recognizer.run({ [this.recognizer.inputNames[0]!]: new this.ort.Tensor('float32', crop.data, [1, 3, crop.height, crop.width]) }))[this.recognizer.outputNames[0]!]!;
      const [, steps, classes] = output.dims as [number, number, number];
      const { text, score } = decodeCtc(output.data as Float32Array, steps, classes, this.table);
      if (score >= MIN_SCORE && text.trim()) lines.push({ text: text.trim(), score, box });
    }
    return lines;
  }

  async release(): Promise<void> {
    await Promise.all([this.detector.release(), this.recognizer.release()]);
  }
}
