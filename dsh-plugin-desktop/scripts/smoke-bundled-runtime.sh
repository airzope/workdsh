#!/bin/bash
# Run every bundled runtime of an installed WorkDSH application headlessly:
# Electron (as Node), Node.js, Python with the Office libraries, the DSH CLI,
# the SenseVoice speech-to-text binding and its bundled INT4 weights, an offline DOCX-to-PDF conversion
# through the bundled LibreOffice Kit engine, and FFmpeg audio and video work. Electron and Node must run as
# the expected CPU, which catches packages assembled for another architecture.
# Usage: smoke-bundled-runtime.sh <electron-executable> <workdsh-runtime-directory> <x64|arm64>
set -euo pipefail

executable="$1"
runtime="$2"
arch="$3"
dependencies="$runtime/primary-runtime/dependencies"
node="$dependencies/node/bin/node"
python="$dependencies/python/bin/python3"

ELECTRON_RUN_AS_NODE=1 "$executable" -e '
if (!process.versions.electron || process.arch !== process.argv[1]) process.exit(1)
console.log(`Electron ${process.versions.electron} loads on ${process.platform}-${process.arch}`)
' "$arch"
"$node" -e 'if (process.arch !== process.argv[1]) process.exit(1); console.log(`Node.js ${process.versions.node} (${process.arch})`)' "$arch"
"$python" -I -B -c 'import docx, lxml, numpy, openpyxl, pandas, PIL, pptx, xlsxwriter; print("Python office libraries import")'
"$node" "$runtime/profiles/workdsh/node_modules/@deepseek-ai/dsh/lib/bin.js" --version

work="$(mktemp -d)"

# DSH's local SenseVoice speech-to-text loads this binding in its recognition
# process. The Linux x64 build is rebuilt for Ubuntu 20.04 during packaging, so
# it must load on every supported release and run native code through the C API.
sherpa="$(find "$runtime/profiles/workdsh/node_modules" -path '*/sherpa-onnx-node/package.json' -print -quit)"
test -n "$sherpa"
"$node" -e '
const sherpa = require(process.argv[1])
const samples = Float32Array.from({ length: 16000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 16000))
if (!sherpa.writeWave(process.argv[2], { samples, sampleRate: 16000 })) process.exit(1)
const wave = sherpa.readWave(process.argv[2])
const resampled = new sherpa.LinearResampler(16000, 8000).flush(wave.samples)
if (wave.sampleRate !== 16000 || wave.samples.length !== 16000 || Math.abs(resampled.length - 8000) > 8) process.exit(1)
console.log(`SenseVoice speech-to-text binding (sherpa-onnx ${sherpa.version}) runs`)
' "$(dirname "$sherpa")" "$work/tone.wav"
# The bundled SenseVoiceSmall INT4 weights and Silero VAD through the same binding.
"$node" "$(dirname "$0")/smoke-speech.mjs" "$runtime/speech/sensevoice" "$(dirname "$sherpa")"

"$python" -I -B -c 'import docx, sys; d = docx.Document(); d.add_heading("WorkDSH", 0); d.add_paragraph("Offline conversion"); d.save(sys.argv[1])' "$work/sample.docx"
HOME="$work" "$node" "$runtime/profiles/workdsh/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js" \
  convert --input "$work/sample.docx" --output "$work/sample.pdf"
head -c 5 "$work/sample.pdf" | grep -q '%PDF-'
echo "LibreOffice Kit converted DOCX to PDF ($(wc -c < "$work/sample.pdf" | tr -d ' ') bytes)"

# The Library's AnyDoc conversion and PaddleOCR recognition through its own
# packaged modules.
HOME="$work" "$node" "$(dirname "$0")/smoke-document-engines.mjs" "$runtime/profiles/workdsh/node_modules/workdsh-plugin-library"
HOME="$work" "$node" "$(dirname "$0")/smoke-media.mjs" "$runtime/media" "$runtime/profiles/workdsh/node_modules/workdsh-plugin-office"
# llama.cpp in router mode over a models folder, as the carrier runs it.
HOME="$work" "$node" "$(dirname "$0")/smoke-llama.mjs" "$runtime/llama"
