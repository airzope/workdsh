#!/bin/bash
# Install a WorkDSH .deb into a clean Ubuntu container (20.04 and 24.04 in CI) and run
# every bundled runtime headlessly: Electron (as Node), Node.js, Python with
# the Office libraries, the DSH CLI, and an offline DOCX-to-PDF conversion
# through the bundled LibreOffice Kit engine.
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
echo "Installed $(dpkg-query -W -f '${Package} ${Version} ${Architecture}' workdsh) on ${PRETTY_NAME}, $(ldd --version | head -n 1)"

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

# DSH loads the SenseVoice speech-to-text binding only in its recognition
# process. Its x64 build needs glibc 2.32, so it must load from Ubuntu 22.04
# (glibc 2.35) on and is only reported on older releases.
glibc="$(ldd --version | head -n 1 | grep -oE '[0-9]+\.[0-9]+$')"
binding="$(find "$runtime/profiles/workdsh/node_modules" -path "*/sherpa-onnx-linux-$(dpkg --print-architecture | sed 's/amd64/x64/')/sherpa-onnx.node" -print -quit)"
if [ -z "$binding" ]; then
  echo "SenseVoice speech-to-text binding is not packaged"
elif "$node" -e 'require(process.argv[1])' "$binding" 2> "$work/binding.log"; then
  echo "SenseVoice speech-to-text binding loads on glibc $glibc"
elif [ "$(printf '%s\n' 2.35 "$glibc" | sort -V | head -n 1)" = 2.35 ]; then
  cat "$work/binding.log"
  exit 1
else
  echo "SenseVoice speech-to-text binding is unavailable on glibc $glibc (needs Ubuntu 22.04 or later): $(grep -m 1 -oE "version \`[^']+' not found" "$work/binding.log" || head -n 1 "$work/binding.log")"
fi

"$python" -I -B -c 'import docx, sys; d = docx.Document(); d.add_heading("WorkDSH", 0); d.add_paragraph("Ubuntu offline conversion"); d.save(sys.argv[1])' "$work/sample.docx"
HOME="$work" "$node" "$runtime/profiles/workdsh/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js" \
  convert --input "$work/sample.docx" --output "$work/sample.pdf"
head -c 5 "$work/sample.pdf" | grep -q '%PDF-'
echo "LibreOffice Kit converted DOCX to PDF ($(stat -c %s "$work/sample.pdf") bytes)"
