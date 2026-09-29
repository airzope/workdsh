#!/bin/bash
# Install a WorkDSH .deb into a clean Ubuntu container (20.04 and 24.04 in CI) and run
# every bundled runtime headlessly: Electron (as Node), Node.js, Python with
# the Office libraries, the DSH CLI, the SenseVoice speech-to-text binding, and
# an offline DOCX-to-PDF conversion through the bundled LibreOffice Kit engine.
# Usage: smoke-ubuntu-deb.sh /path/to/WorkDSH-<version>-linux-<arch>.deb
set -euo pipefail

deb="$1"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# The package's own Depends must resolve from the distribution archive. A
# font package stands in for the fonts a desktop installation already has.
if ! apt-get install -y -qq --no-install-recommends "$deb" fonts-dejavu-core > /tmp/apt.log 2>&1; then
  cat /tmp/apt.log
  exit 1
fi
. /etc/os-release
echo "Installed $(dpkg-query -W -f '${Package} ${Version} ${Architecture}' workdsh) on ${PRETTY_NAME}, $(getconf GNU_LIBC_VERSION)"

app=/opt/WorkDSH
runtime="$app/resources/workdsh-runtime"
dependencies="$runtime/primary-runtime/dependencies"
node="$dependencies/node/bin/node"
python="$dependencies/python/bin/python3"
test -x /usr/bin/workdsh

ELECTRON_RUN_AS_NODE=1 "$app/workdsh" -e \
  'if (!process.versions.electron) process.exit(1); console.log(`Electron ${process.versions.electron} loads on ${process.platform}-${process.arch}`)'
"$node" -e 'console.log(`Node.js ${process.versions.node}`)'
"$python" -I -B -c 'import docx, lxml, numpy, openpyxl, pandas, PIL, pptx, xlsxwriter; print("Python office libraries import")'
"$node" "$runtime/profiles/workdsh/node_modules/@deepseek-ai/dsh/lib/bin.js" --version

work="$(mktemp -d)"

# DSH's local SenseVoice speech-to-text loads this binding in its recognition
# process. The x64 build is rebuilt for Ubuntu 20.04 during packaging, so it
# must load on every supported release and run native code through the C API.
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

"$python" -I -B -c 'import docx, sys; d = docx.Document(); d.add_heading("WorkDSH", 0); d.add_paragraph("Ubuntu offline conversion"); d.save(sys.argv[1])' "$work/sample.docx"
HOME="$work" "$node" "$runtime/profiles/workdsh/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js" \
  convert --input "$work/sample.docx" --output "$work/sample.pdf"
head -c 5 "$work/sample.pdf" | grep -q '%PDF-'
echo "LibreOffice Kit converted DOCX to PDF ($(stat -c %s "$work/sample.pdf") bytes)"
