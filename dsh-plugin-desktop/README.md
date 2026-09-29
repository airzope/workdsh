# WorkDSH Desktop carrier

[中文](README.zh.md)

This package builds the Electron application. The installer contains `lib/workdsh-main.js` and one bundled runtime Profile. DeepSeek Harness Host, Web Client, and core capabilities come from the pinned upstream release in that Profile. WorkDSH projects, library, experts, skills, connectors, and their supporting services are composed by `workdsh-bundle`; they are not separate desktop editions.

## Development

Use Node.js `^22.19.0` or `>=24` and Corepack Yarn 4.18.0. At the repository root:

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn dev
```

`dev` builds the carrier, prepares the pinned Profile and primary runtime, then launches Electron. It is the only command here that starts a graphical application. For headless verification use `corepack yarn check` and `corepack yarn check:desktop-dsh-alignment`. `corepack yarn workspace dsh-plugin-desktop package:dir` creates an unpacked application and checks that it contains no duplicate DSH dependency tree.

Windows 7 SP1 x64 runs through [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT). `build/installer.nsh` enables VxKex NEXT for `WorkDSH.exe` through its `KexCfg.exe`, and `src/windows7-compatibility.ts` applies the carrier's runtime policy there. After the standard Windows package, `corepack yarn dist:win7` audits `dist/win-unpacked` for Windows 7, stages the pinned VxKex NEXT setup and a Windows 7-capable Microsoft VC++ redistributable, and wraps the same application in `dist/win7/WorkDSH-<version>-win7-x64-Offline-Setup.exe`; the release script runs it on Windows. Launching on a real Windows 7 machine remains a native verification step; see the [Agent Note](../.agents/notes/implemented/architecture/2026-09-28-windows7-vxkex-compatibility.md).

Ubuntu packages are built natively on each architecture with `corepack yarn dist:linux`, producing `dist/WorkDSH-<version>-linux-<amd64|arm64>.deb`. `scripts/linux-glibc-audit.ts` rejects any bundled ELF image that needs a newer glibc, libstdc++, or C++ ABI than Ubuntu 20.04 ships. Its one recorded exception is the x64 SenseVoice speech-to-text binding, which needs Ubuntu 22.04. CI installs each package into `ubuntu:20.04` and `ubuntu:24.04` containers with `scripts/smoke-ubuntu-deb.sh`; see the [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-ubuntu-deb-packages.md).

The upstream checkout is read-only from this package. When upgrading DSH, update the submodule pin and runtime preparation version together, then validate the WorkDSH Profile, both platform package checks, and the resulting installers before publishing. Prefer the latest official stable DSH release; pre-releases require an explicit product decision.

The carrier sources and package scripts live in this directory. The Profile package source and its release are owned by the WorkDSH repository; see [Desktop ownership](../docs/desktop-boundaries.md).
