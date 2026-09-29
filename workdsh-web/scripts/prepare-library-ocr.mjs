// Stage the PP-OCRv5 mobile models and the ONNX Runtime WebAssembly files that
// the Library's OCR loads into packages/plugins/library/resources/ocr.
// Every file is checked against a pinned SHA-256; set WORKDSH_OCR_MODEL_ARCHIVE
// to a local copy of the model archive to build without downloading it.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const library = fileURLToPath(new URL('../packages/plugins/library/', import.meta.url));
const target = join(library, 'resources', 'ocr');
const require = createRequire(join(library, 'package.json'));
const JSZip = require('jszip');

/** PaddleOCR PP-OCRv5 mobile detection and recognition, converted to ONNX by eSearch-OCR. */
export const MODEL_ARCHIVE = {
  url: 'https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/ppocr_v5_mobile.zip',
  sha256: 'd0f37e8f301c873bd568c310df8b157049575f92201662a4c6cc4d2293fcda44',
  files: {
    'ppocr_v5_mobile_det.onnx': 'd7fe3ea74652890722c0f4d02458b7261d9f5ae6c92904d05707c9eb155c7924',
    'ppocr_v5_mobile_rec.onnx': 'bf66820f48fa99f779974c4df78e5274a9d8e0458c4137e8c5357e40e2c3faf2',
    'ppocrv5_dict.txt': 'd1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b',
  },
};
/** The Node entry of onnxruntime-web and the one WebAssembly build it loads. */
export const RUNTIME = {
  package: 'onnxruntime-web',
  version: '1.30.0',
  files: {
    'ort.node.min.mjs': 'f41b1e1ccf89e7b630c2a822192d6cf48d642b1abe3c321f1ad6b4130a78327e',
    'ort-wasm-simd-threaded.mjs': 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b',
    'ort-wasm-simd-threaded.wasm': '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
  },
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function matches(path, expected) {
  try { return sha256(await readFile(path)) === expected; } catch { return false; }
}
function verify(label, bytes, expected) {
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`${label} has SHA-256 ${actual}, expected ${expected}`);
}

async function archive() {
  const local = process.env.WORKDSH_OCR_MODEL_ARCHIVE;
  if (local) return readFile(local);
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(MODEL_ARCHIVE.url, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (cause) {
      if (attempt === 4) throw new Error(`Failed to download ${MODEL_ARCHIVE.url}: ${cause instanceof Error ? cause.message : String(cause)}`);
      await new Promise(done => setTimeout(done, 2000 * 2 ** attempt));
    }
  }
}

await mkdir(join(target, 'ort'), { recursive: true });
const models = Object.entries(MODEL_ARCHIVE.files);
const present = await Promise.all(models.map(([name, hash]) => matches(join(target, name), hash)));
if (!present.every(Boolean)) {
  const bytes = await archive();
  verify('The OCR model archive', bytes, MODEL_ARCHIVE.sha256);
  const zip = await JSZip.loadAsync(bytes);
  for (const [name, hash] of models) {
    const entry = zip.file(name);
    if (!entry) throw new Error(`The OCR model archive has no ${name}`);
    const content = await entry.async('nodebuffer');
    verify(name, content, hash);
    await writeFile(join(target, name), content);
  }
}
/** The manifest of an installed package whose exports hide package.json. */
async function manifestOf(name) {
  for (let directory = dirname(require.resolve(name)); directory !== dirname(directory); directory = dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) return { directory, manifest };
    } catch {}
  }
  throw new Error(`Cannot find the package.json of ${name}`);
}
const { directory: runtimeRoot, manifest: runtimeManifest } = await manifestOf(RUNTIME.package);
const dist = join(runtimeRoot, 'dist');
if (runtimeManifest.version !== RUNTIME.version) throw new Error(`${RUNTIME.package} ${runtimeManifest.version} is installed; the OCR pins ${RUNTIME.version}`);
// ort.node.min.mjs imports onnxruntime-common, which the Library ships as a dependency.
const { manifest: commonManifest } = await manifestOf('onnxruntime-common');
if (commonManifest.version !== RUNTIME.version) throw new Error(`onnxruntime-common ${commonManifest.version} is installed; the OCR pins ${RUNTIME.version}`);
for (const [name, hash] of Object.entries(RUNTIME.files)) {
  const destination = join(target, 'ort', name);
  if (await matches(destination, hash)) continue;
  verify(`${RUNTIME.package}/dist/${name}`, await readFile(join(dist, name)), hash);
  await rm(destination, { force: true });
  await copyFile(join(dist, name), destination);
}
await writeFile(join(target, 'manifest.json'), `${JSON.stringify({ models: { source: MODEL_ARCHIVE.url, archiveSha256: MODEL_ARCHIVE.sha256, files: MODEL_ARCHIVE.files }, runtime: RUNTIME }, null, 2)}\n`);
await writeFile(join(target, 'NOTICE.md'), `# OCR resources

- PP-OCRv5 mobile text detection and recognition models and dictionary from
  [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), Copyright PaddlePaddle
  Authors, Apache License 2.0. Converted to ONNX by
  [eSearch-OCR](https://github.com/xushengfeng/eSearch-OCR) (Apache License 2.0),
  archive \`${MODEL_ARCHIVE.url}\`.
- ONNX Runtime Web ${RUNTIME.version} (\`${Object.keys(RUNTIME.files).join('`, `')}\`),
  Copyright Microsoft Corporation, MIT License.
`);
console.log(`OCR resources ready in ${target}`);
