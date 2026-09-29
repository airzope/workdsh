# Agent Note: macOS application icon inset

Status: implemented

English | [中文](2026-08-15-macos-app-icon-inset.zh.md)

## Problem

The repository-owned iOS Default icon fills its complete 1024 by 1024 canvas. Electron Builder preserves that geometry when it creates the macOS ICNS resource, so the icon appears about one quarter larger than neighboring Dock icons. The runtime also calls `app.dock.setIcon()` with the Host-selected application icon, so changing only the packaging configuration would leave development and runtime Dock presentation inconsistent.

## Decision

The brand logo remains the source of record and the Windows and Linux application icon; for WorkDSH it is `branding/workdsh/logo.png`, copied unchanged to `build/brand/app-icon.png`. The headless build runs `scripts/generate-brand.ts`, which resizes the complete artwork to 824 by 824 pixels, centers it on a transparent 1024 by 1024 canvas, and writes `build/brand/app-icon-mac.png` as RGBA16 with the logo's ICC profile, so WorkDSH keeps its 16-bit Display P3 color data. A white-label logo may be any square PNG of at least 512 pixels; see the [white-label note](2026-09-29-build-time-white-label.md).

The macOS Electron Builder configuration uses the generated asset. The Host shell selects the same generated path on Darwin before passing its specification to the native runtime, so the installed icon, development Dock icon, and window icon use one platform decision. Windows and Linux continue to use the unchanged source asset. Both files are published and required in the physical packaged runtime so a missing generated asset fails before release.

## Verification

Package tests preserve the source icon hash, require the generator in the build command, and verify that the generated PNG remains a 1024 by 1024 RGBA16 image with the source ICC profile. Decoded geometry must contain exactly 824 by 824 pixels of artwork at a 100-pixel inset. Host tests require Darwin to select the generated asset and Windows and Linux to select the source. Packaged-runtime tests reject either missing physical asset.

## Alternatives considered

**Replace the shared source icon.** Adding transparent space to the original would also shrink the Windows and Linux icon, even though the reported mismatch is specific to the macOS Dock.

**Change only `build.mac.icon`.** The runtime explicitly updates the Dock icon, so packaging-only selection would produce different results between installed and development runs.

**Maintain a hand-edited macOS bitmap.** A deterministic generator keeps the derivative reproducible, validates the source assumptions, and prevents the platform variants from drifting independently.
