#!/bin/bash
# Mount a WorkDSH DMG read-only on a macOS host (macOS 15 in CI) and run its
# bundled runtimes headlessly with smoke-bundled-runtime.sh.
# Usage: smoke-macos-dmg.sh /path/to/<Product>-<version>-<arch>.dmg <x64|arm64>
set -euo pipefail

dmg="$1"
arch="$2"
mount="$(mktemp -d)"
hdiutil attach "$dmg" -mountpoint "$mount" -nobrowse -readonly -quiet
trap 'hdiutil detach "$mount" -quiet || true' EXIT
app="$(find "$mount" -maxdepth 1 -name '*.app' -print -quit)"
test -n "$app"
plist="$app/Contents/Info.plist"
echo "Mounted $(basename "$app") $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist") on macOS $(sw_vers -productVersion) ($(uname -m)); LSMinimumSystemVersion $(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$plist")"

bash "$(dirname "$0")/smoke-bundled-runtime.sh" \
  "$app/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")" \
  "$app/Contents/Resources/workdsh-runtime" "$arch"
