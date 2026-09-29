# Agent Note: Ubuntu x64 and arm64 packages for Ubuntu 20.04 and later

Status: implemented

English | [中文](2026-09-29-ubuntu-deb-packages.zh.md)

## Decision

WorkDSH ships Ubuntu `.deb` packages for x64 (`amd64`) and arm64 built from the same carrier source, Electron version, and pinned DSH Profile as the other platforms. Ubuntu 20.04 LTS is the oldest supported release: glibc 2.31, libstdc++ `GLIBCXX_3.4.28`, and C++ ABI `CXXABI_1.3.12`. Each package is built on a native runner of its architecture, because packaging executes the bundled Node.js and Python (the primary-runtime smoke, the Profile inventory, and the DSH CLI smoke).

The package installs to `/opt/WorkDSH` with the `workdsh` command, deb package name `workdsh`, and `WorkDSH-<version>-linux-<amd64|arm64>.deb`. It depends on the libraries Electron links (GTK 3, NSS, GBM, ALSA, CUPS, xkbcommon, DRM, and electron-builder's defaults). Libraries that Ubuntu 24.04 renamed for 64-bit `time_t` are declared as alternatives with the t64 name first, such as `libasound2t64 | libasound2`. A bare pre-t64 name is not enough: on 24.04 apt can satisfy the virtual `libasound2` with `liboss4-salsa-asound2`, which lacks the `ALSA_0.9` symbols Electron needs, so Electron fails to start. With the alternatives, one dependency list resolves on 20.04 through 24.04. The package recommends `fonts-noto-cjk` because Chinese documents need CJK fonts to render and convert. electron-builder's post-install script adds the AppArmor profile that Ubuntu 24.04 requires for Chromium's sandbox and sets a SUID `chrome-sandbox` only where user namespaces are unavailable.

## Runtime

`prepare-workdsh-primary-runtime.mjs` selects the upstream `linux-x64` or `linux-arm64` primary-runtime target from the host architecture. It provides Node.js 24.21.0, python-build-standalone 3.12.14, manylinux 2.28 wheels for numpy, pandas, Pillow, and lxml, and pnpm. On Linux, the LibreOffice Kit uses its WebAssembly engine, which npm installs for every Linux architecture, so Office rendering and PDF conversion need no native LibreOffice. The carrier runs unchanged; its Windows 7 policy does not apply.

## Gates

- `scripts/linux-glibc-audit.ts` parses the `.gnu.version_r` requirements of every ELF image of the target architecture in `linux-unpacked` or `linux-arm64-unpacked`. It fails on any `GLIBC`, `GLIBCXX`, or `CXXABI` version newer than Ubuntu 20.04 provides. It also requires the main executable, Node.js, and Python to match the architecture, and the offline content to be present: Node.js, pnpm, Python with the Office libraries, the three Office skills, the Office skill and LibreOffice Kit packages with the WebAssembly engine, the DSH Profile, and the package cache. ELF files for other architectures, such as unused prebuilds, are listed but not checked. Measured on the pinned Electron 43.3.0, Node.js 24.21.0, Python 3.12.14, and wheels for both architectures, the newest requirements were `GLIBC_2.28`, `GLIBCXX_3.4.21`, and `CXXABI_1.3.11`. The parser matched `readelf` on the Electron, Node.js, and shared-library binaries it was compared with.
- `scripts/package-linux.ts` also checks the package's `Package`, `Architecture`, and `Recommends` fields.
- CI installs each package into clean `ubuntu:20.04` and `ubuntu:24.04` containers with `scripts/smoke-ubuntu-deb.sh`, covering the oldest supported release and the t64 renames. Each container resolves the package's own dependencies from the Ubuntu archive, then runs Electron as Node, Node.js, Python with the Office libraries, and the DSH CLI. Finally it converts a python-docx document to PDF through the bundled LibreOffice Kit.

## Verification boundary

The container smoke is headless. Opening the window on a real Ubuntu 20.04, 22.04, or 24.04 desktop, including AppArmor behavior on 24.04 and Wayland sessions, remains a manual release check. Other Debian-based distributions with glibc 2.31 or newer are best effort. No AppImage, RPM, or Snap is produced.
