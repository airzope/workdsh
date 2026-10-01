// Load the bundled SenseVoiceSmall INT4 weights and the Silero VAD with the
// packaged sherpa-onnx, as DSH's speech worker does, and decode a short
// synthetic signal. This proves the platform's ONNX Runtime runs the 4-bit
// MatMulNBits kernels; recognition accuracy is measured when the weights are
// made (see the Agent Note).
// Usage: node smoke-speech.mjs <speech/sensevoice directory> <sherpa-onnx-node package directory>
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const [speech, sherpaPackage] = process.argv.slice(2).map(path => resolve(path))
if (!speech || !sherpaPackage) throw new Error('Usage: node smoke-speech.mjs <speech/sensevoice directory> <sherpa-onnx-node package directory>')
const manifest = JSON.parse(readFileSync(join(speech, 'manifest.json'), 'utf8'))
for (const [name, expected] of Object.entries(manifest.files)) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(join(speech, name))) hash.update(chunk)
  if (hash.digest('hex') !== expected.sha256) throw new Error(`${name} does not match manifest.json`)
}

const sherpa = createRequire(join(sherpaPackage, 'package.json'))(sherpaPackage)
const started = Date.now()
const recognizer = new sherpa.OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    senseVoice: { model: join(speech, 'model.int8.onnx'), language: 'auto', useInverseTextNormalization: 1 },
    tokens: join(speech, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0,
  },
})
const vad = new sherpa.Vad({
  sileroVad: { model: join(speech, 'silero_vad.onnx'), threshold: 0.5, minSilenceDuration: 0.25, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 512 },
  sampleRate: 16000, numThreads: 1, provider: 'cpu', debug: 0,
}, 30)
const samples = Float32Array.from({ length: 32000 }, (_, i) => (i > 8000 && i < 24000 ? 0.3 * Math.sin(2 * Math.PI * 220 * i / 16000) : 0))
for (let offset = 0; offset < samples.length; offset += 512) vad.acceptWaveform(samples.subarray(offset, offset + 512))
vad.flush()
const stream = recognizer.createStream()
stream.acceptWaveform({ sampleRate: 16000, samples })
recognizer.decode(stream)
const result = recognizer.getResult(stream)
if (typeof result.text !== 'string') throw new Error('SenseVoice returned no result')
console.log(`SenseVoiceSmall ${manifest.precision.toUpperCase()} and Silero VAD run with sherpa-onnx ${sherpa.version} (${String(Date.now() - started)} ms)`)
