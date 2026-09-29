# Agent Note: Build-time white-label brand

Status: implemented

English | [中文](2026-09-29-build-time-white-label.zh.md)

## Decision

A brand directory (`brand.json`, a square `logo.png`, an optional `mark.svg`) decides the Desktop product's names, identifiers and artwork when the carrier is built. `dsh-plugin-desktop/branding/workdsh/` is the default and the values in `package.json`; `WORKDSH_BRAND` selects another directory. Installed applications read no external brand file, so a package cannot be relabeled after it is built, and the pinned DSH runtime stays unmodified.

## Flow

1. `scripts/generate-brand.ts` runs first in `yarn build`. It validates the brand (`scripts/brand.ts`) and writes `build/brand/`: `app-icon.png`, the Windows ICO with exact-DPI frames, the inset macOS icon, the tray bitmaps, the mark, and `brand.json` with the brand's names and identifiers. For WorkDSH every generated file is byte-identical to the icons previously committed under `build/`.
2. Packaging scripts (`package-linux`, `package-mac`, `release-mac`, `package-win`, `package-win7`, `package-dir`) read the generated `build/brand/brand.json`, not the environment, and append electron-builder overrides only where the brand differs from WorkDSH: `productName`, artifact names, NSIS shortcut and uninstall names, `CFBundleDisplayName`, the Linux desktop entry name, `appId`, the Linux executable and Debian package, maintainer, copyright and description. Verifiers look for artifacts under the brand's `fileName`. One build is therefore packaged under one brand.
3. The carrier reads `build/brand/brand.json` from its archive. It sets the window title and icon, `app.setName(name)`, and pins `userData` to `<appData>/<dataDirectory>`. It passes `WORKDSH_BRAND_NAME` and `WORKDSH_BRAND_MARK` to the runtime; the mark path points into `app.asar.unpacked`, because the bundled Node.js cannot read inside the archive. `afterPack` fails when the brand file, the window icon, or the unpacked mark is missing.
4. In the Profile, `workdsh-bundle` serves `{ name, mark }` at `/api/workdsh-brand` (mark as an SVG or PNG data URL, at most 256 KiB) and names the product in its browser prompt. The client fills DSH's `sidebar.brand.name` and `sidebar.brand.mark` slots and the page title from it, remembering the last brand per origin so a white-label window does not flash WorkDSH. The Office plugin writes the brand as the creator of exported XLSX and PDF files. Without these variables, as in a plain Web deployment, everything stays WorkDSH.

## Constraints

- `fileName` is ASCII without spaces because it becomes the install directory, bundle, executable and artifact names; the display `name` may use any language.
- A different `appId` installs side by side. Changing `appId` or `dataDirectory` does not migrate existing user data.
- A custom logo may be any square PNG of at least 512 pixels. The mark must carry inline `fill`/`stroke` colors, which the tray variants replace with black (template) or the brand `color`.
- Built-in skill, expert and prompt texts, the diagnostics page, and the upstream DSH interface keep their wording. Neutral wording replaced the product name in the Projects, Skills and workbench panels and the access-denial reason.
- The CI workflow accepts a `brand` input on manual runs; pushes and `desktop-v*` tags build WorkDSH only. Official releases remain WorkDSH artifacts from `main`.

## Verification

`tests/brand.spec.ts` covers validation, directory selection, the override list, generated files for a brand without a mark, and the runtime helpers. The Linux packaging test builds under a generated custom brand, and the carrier test covers the packaged-brand check. `packages/bundle/tests/brand.test.mjs` covers the Host route and its input limits. A local `electron-builder --linux dir` run with a sample brand produced `acmedesk`, the unpacked mark, and a passing packaged-brand check.
