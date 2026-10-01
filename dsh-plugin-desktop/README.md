# WorkDSH Desktop carrier

[中文](README.zh.md)

This package builds the Electron application. The installer contains `lib/workdsh-main.js` and one bundled runtime Profile. DeepSeek Harness Host, Web Client, and core capabilities come from the pinned upstream release in that Profile. WorkDSH projects, library, experts, skills, connectors, and their supporting services are composed by `workdsh-bundle`; they are not separate desktop editions. At each launch the carrier links that Profile into `<userData>/dsh-home`; it replaces the Profile's `cordis.patch.yml` only when the bundled composition changes, and keeps the rows DSH's Settings added, so Settings survive launches and updates ([Agent Note](../.agents/notes/implemented/architecture/2026-10-01-runtime-profile-patch-settings.md)).

## Development

Use Node.js `^22.19.0` or `>=24` and Corepack Yarn 4.18.0. At the repository root:

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn dev
```

`dev` builds the carrier, prepares the pinned Profile and primary runtime, then launches Electron. It is the only command here that starts a graphical application. For headless verification use `corepack yarn check` and `corepack yarn check:desktop-dsh-alignment`. `corepack yarn workspace dsh-plugin-desktop package:dir` creates an unpacked application and checks that it contains no duplicate DSH dependency tree.

macOS DMGs are built natively on each CPU (`WORKDSH_MAC_ARCH` must match the Node architecture, because the Profile's per-CPU packages follow it). `scripts/macos-compat-audit.ts` then rejects a `.app` whose executables lack the target slice, whose Profile has another CPU's platform packages, or whose target images need a macOS newer than 15.0. CI builds on `macos-15-intel` and `macos-15` and runs `scripts/smoke-macos-dmg.sh` there; see the [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-macos-15-native-packages.md).

Windows 7 SP1 x64 runs through [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT). `build/installer.nsh` enables VxKex NEXT for `WorkDSH.exe` through its `KexCfg.exe`, and `src/windows7-compatibility.ts` applies the carrier's runtime policy there. After the standard Windows package, `corepack yarn dist:win7` audits `dist/win-unpacked` for Windows 7, stages the pinned VxKex NEXT setup and a Windows 7-capable Microsoft VC++ redistributable, and wraps the same application in `dist/win7/WorkDSH-<version>-win7-x64-Offline-Setup.exe`; the release script runs it on Windows. Launching on a real Windows 7 machine remains a native verification step; see the [Agent Note](../.agents/notes/implemented/architecture/2026-09-28-windows7-vxkex-compatibility.md).

Ubuntu packages are built natively on each architecture with `corepack yarn dist:linux`, producing `dist/WorkDSH-<version>-linux-<amd64|arm64>.deb`. `scripts/linux-glibc-audit.ts` rejects any bundled ELF image that needs a newer glibc, libstdc++, or C++ ABI than Ubuntu 20.04 ships. Before that audit, `scripts/linux-sherpa-onnx.ts` recompiles the x64 SenseVoice speech-to-text binding from its pinned sherpa-onnx source in an `ubuntu:20.04` container, so building the x64 package needs Docker and Git. CI installs each package into `ubuntu:20.04` and `ubuntu:24.04` containers with `scripts/smoke-ubuntu-deb.sh`; see the [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-ubuntu-deb-packages.md).

`scripts/prepare-workdsh-media.ts` stages the pinned static FFmpeg 8.1.2 and FFprobe builds (Shaka Project `n8.1.2-1`, GPLv3, SHA-256 per target) in `build/workdsh-runtime/media/`, with the license text and `SOURCES.md`. The carrier passes that directory to the runtime as `WORKDSH_MEDIA_TOOLS`, the Office plugin's `media-ffmpeg` skill names the executables, and every platform audit and packaged-runtime smoke requires them. A release that ships them must also publish the corresponding source archives; see the [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-bundled-ffmpeg.md).

Names, identifiers and artwork come from a build-time brand directory, `branding/workdsh/` by default. `scripts/generate-brand.ts` turns the brand selected by `WORKDSH_BRAND` into `build/brand/` (icons for every platform, tray bitmaps, the mark and the brand fields); packaging scripts add the matching electron-builder overrides and verify artifacts under the brand's file name, and the carrier passes the display name and mark to the Profile. See [White-label builds](../docs/white-label.en.md) and the [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-build-time-white-label.md).

`scripts/prepare-workdsh-llama.ts` stages the `llama-server` of llama.cpp `b11247` in `build/workdsh-runtime/llama/`: the official archives on Windows (Vulkan build, with the VC++ runtime DLLs next to it) and macOS, and on Ubuntu a build of the same commit made in `ubuntu:20.04` by `scripts/build-llama-linux.sh`, so building a Linux package needs Docker. `src/llama.ts` creates `<userData>/models` and passes the server, that folder and a per-launch key to the runtime. The Profile's `workdsh-bundle/local-models` starts the server in router mode on a loopback port when the user chooses local models at first launch or in Settings > Models, or once the folder holds a model, and turns each GGUF file there into a local model; see the [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-bundled-llama-cpp.md).

Releases come only from the default branch: the manually run `Release` workflow creates `v<Web version>` on the branch head, runs the Web release on it, then creates `desktop-v<Desktop version>` and runs CI's tag build, which publishes the installers, `SHA256SUMS` and the FFmpeg source archive.

The upstream checkout is read-only from this package. When upgrading DSH, update the submodule pin and runtime preparation version together, then validate the WorkDSH Profile, both platform package checks, and the resulting installers before publishing. Prefer the latest official stable DSH release; pre-releases require an explicit product decision.

The carrier sources and package scripts live in this directory. The Profile package source and its release are owned by the WorkDSH repository; see [Desktop ownership](../docs/desktop-boundaries.md).
