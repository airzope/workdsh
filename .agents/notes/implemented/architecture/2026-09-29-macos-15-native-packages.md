# Agent Note: Native macOS 15 packages for Intel and Apple silicon

Status: implemented

English | [中文](2026-09-29-macos-15-native-packages.zh.md)

## Decision

WorkDSH ships separate unsigned macOS DMGs for x64 (Intel) and arm64 (Apple silicon), and macOS 15 is the oldest supported release. Each DMG is built by Node of its own architecture: CI uses `macos-15-intel` for x64 and `macos-15` for arm64. Signing and notarization remain the manual `release-mac.ts` step on a credentialed machine.

## Why native builds

The DSH Profile is installed with pnpm, which picks per-CPU optional packages for the Node that runs it: the LibreOffice Kit native engine (`@deepseek-ai/libreoffice-kit-darwin-*`), `sherpa-onnx-darwin-*` for SenseVoice speech-to-text, and `@napi-rs/canvas-darwin-*`. An x64 DMG packaged by arm64 Node therefore carried only arm64 builds of these packages. The primary runtime and the Electron slice were x64, so the earlier `lipo` checks passed, but Office conversion and speech recognition would fail on an Intel Mac. `package-mac.ts` and `release-mac.ts` now refuse a target architecture that differs from the Node architecture. On Apple silicon, an x64 package needs an x64 Node under Rosetta.

## Gates

- `scripts/macos-compat-audit.ts` parses thin and universal Mach-O files in the `.app`, reading `LC_BUILD_VERSION` and `LC_VERSION_MIN_MACOSX`. It fails when:
  - the main executable, Node, or Python lacks the target slice;
  - a platform package such as `@scope/name-darwin-arm64` is present without its target-CPU or universal counterpart, matched by package name so pnpm's isolated layout is covered;
  - a target-architecture image, or `LSMinimumSystemVersion`, needs a macOS newer than 15.0;
  - the offline runtime content is incomplete.
- Mach-O files that lack the target slice are listed but not checked, because loaders such as koffi choose a per-CPU file at run time.
- The report is written to `macos-audit.json` next to the DMG before the assertion, and CI uploads it as `desktop-macos-<arch>-audit`.
- `scripts/smoke-macos-dmg.sh` mounts the DMG read-only on the macOS 15 runner and runs `scripts/smoke-bundled-runtime.sh`, which the Ubuntu smoke shares. It runs:
  - Electron as Node and the bundled Node, both of which must report the target CPU;
  - Python with the Office libraries;
  - the DSH CLI;
  - the SenseVoice binding;
  - a DOCX-to-PDF conversion through the native LibreOffice Kit engine.

## Verification boundary

The smoke is headless. Opening the window, Gatekeeper behavior for the unsigned DMG, and the signed release remain manual checks on real Macs.
