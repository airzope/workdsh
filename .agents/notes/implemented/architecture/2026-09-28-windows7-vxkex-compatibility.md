# Agent Note: Windows 7 x64 through VxKex NEXT

Status: implemented

English | [中文](2026-09-28-windows7-vxkex-compatibility.zh.md)

## Decision

WorkDSH supports Windows 7 SP1 x64 on a best-effort basis through the third-party [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT) compatibility layer. Windows 7 uses the same carrier source, Electron version, and runtime Profile as every other Windows host. Electron 43, the bundled Node.js 24, Python 3.12, and the LibreOffice Kit engine import APIs that Windows 7 lacks. VxKex NEXT supplies them per executable through Image File Execution Options (IFEO) and propagates itself into child processes.

Two installers wrap one `dist/win-unpacked` directory. The standard x64 Setup requires VxKex NEXT to be installed already. The Windows 7 x64 offline installer (`WorkDSH-<version>-win7-x64-Offline-Setup.exe`) also carries the pinned VxKex NEXT setup and a Microsoft VC++ redistributable, so installation needs no network. It is built from the same source and DSH version, not as a separate edition.

## Offline installer

`scripts/package-win7.ts` runs after the standard Windows package. It audits `dist/win-unpacked` (below), downloads `KexSetup_Release_1_2_3_2463.exe` from the VxKex NEXT release and accepts only its pinned SHA-256, and downloads Microsoft's `VC_redist.x64.exe` 14.44.35211 from its versioned URL, accepting only the SHA-256 that the URL embeds. That build is the last of the Visual Studio 2022 stream; the 14.50+ stream that ships with Visual Studio 2026 requires Windows 10, so the build machine's own Visual Studio cannot supply it. `WORKDSH_WIN7_VC_REDIST` may instead name a Microsoft-signed 14.29-14.4x redistributable, which is checked with Authenticode. It writes their paths and versions to `build/.win7/offline-payload.nsh`. electron-builder then wraps the verified application with `--prepackaged` and `build/installer-win7.nsh` into `dist/win7`. A narrowly bound afterAll hook re-checks the executable's fuses there, because the standard build already ran the packaged-runtime smoke on the same directory.

On NT 6.1 the offline installer installs the VC++ runtime when `System32\msvcp140_2.dll` is missing or older than the bundled version, and VxKex NEXT when `KexCfg.exe` is missing or `InstalledVersion` is older than 1.2.3.2463. Both run silently through the UAC `runas` verb and are verified afterwards from the file and registry, not from exit codes. The Office engine imports `msvcp140*.dll` without shipping it, and VxKex NEXT deliberately rewrites the imports of new VC++ runtimes in `System32`.

VxKex NEXT publishes no license and contains DLLs from newer Windows releases. Bundling it was an explicit product decision that relies on permission from its authors; THIRD_PARTY_NOTICES records this obligation.

## Registration

On NT 6.1 (`IsWin7` or `IsWin2008R2`), setup reads `KexDir` from `HKLM\Software\VXsoft\VxKex` in the 64-bit registry view. Without VxKex NEXT, the standard installer stops with exit code 2 and offers the download page. Otherwise setup runs `KexCfg.exe /EXE:"<INSTDIR>\WorkDSH.exe" /ENABLE:1 /DISABLEFORCHILD:0 /DISABLEAPPSPECIFIC:0`. KexCfg is VxKex's supported configuration interface: it writes the `UseFilter` and `FilterFullPath` subkey for this exact path, directly when elevated and otherwise through VxKex's SYSTEM elevation task. Propagation and app-specific fixes are always on because renderers, Node.js, Python, pnpm, and the Office engine are children of `WorkDSH.exe`, and VxKex applies its Chromium and Node fixes from their exports. Version spoofing remains the user's choice.

Setup polls the IFEO subkey for up to 10 seconds, because the elevation task is asynchronous, and checks `FilterFullPath` and `FLG_APPLICATION_VERIFIER`. A registration that does not appear produces manual instructions. Uninstall removes the configuration only when it exists and never during an upgrade (`--updated`), where it would race the new registration.

Setup finally lists missing Windows prerequisites that it cannot redistribute: Service Pack 1, KB2533623 (`kernel32!AddDllDirectory`), KB2670838 (`dxgi.dll` 6.2), Windows Management Framework 5.1, and, for the standard installer, the VC++ runtime. DSH's PowerShell executor prefixes every command with `[System.Text.UTF8Encoding]::new(...)`, which needs PowerShell 5; Windows 7 ships 2.0. VxKex NEXT's own prerequisite dialog does not run in silent mode.

## Carrier runtime policy

`src/windows7-compatibility.ts` recognizes NT 6.1 from `os.release()`. VxKex NEXT does not spoof the PEB version for Chromium or Node processes, so this value stays real unless the user enables strong spoofing; `WORKDSH_WINDOWS7_COMPAT=1` or `0` overrides detection. On Windows 7 the carrier sets `NODE_SKIP_PLATFORM_CHECK=1` in its own environment before starting the DSH Host, because Node.js 20 and later exit below Windows 10 without it. It also calls `app.disableHardwareAcceleration()`: Windows 7 has no DirectComposition, and repeated GPU-process failure terminates Electron. The browser worker is the same executable and takes the same policy. The renderer sandbox stays enabled.

## Compatibility audit

`scripts/windows7-payload-audit.ts` gates the offline installer. It requires the offline content: Node.js, pnpm, Python with the Office libraries, the three Office skills and checker, the Office skill and LibreOffice Kit packages with a `bin/libreoffice-kit.exe` engine, the DSH Profile, and the package cache. It parses the static import table of every x64 PE image and requires each imported DLL to be shipped in the payload, provided by the VC++ runtime, rewritten or supplied by VxKex NEXT 1.2.3.2463, or present on Windows 7 SP1 with the Platform Update. Delay-loaded imports are resolved when used and are not checked. A run on the pinned Electron 43.3.0, Node.js 24.21.0, Python 3.12.14 with its wheels, and LibreOffice Kit 0.1.2 Windows binaries resolved all 143 x64 images. The CI report `desktop-windows7-audit` covers the full Profile, including native Node addons.

The audit checks DLL names, not individual functions; VxKex NEXT is responsible for the missing functions it implements. Its compatibility list verifies Chromium 132 and VS Code 1.96 (Electron 32), which are older than Electron 43.

## Verification boundary

The installer logic ran under Wine configured as Windows 7 and Windows 10, using stand-in `KexCfg.exe`, KexSetup, and `vc_redist.x64.exe` programs. It covered missing VxKex, bundled installation, same, older, and newer VxKex versions, VC++ runtime version comparison, registration and its 10-second verification, upgrade, uninstall, and prerequisite detection. The real KexSetup does not run under Wine. Launching the packaged application on a real Windows 7 SP1 x64 machine remains a native release gate, like the other Windows UI checks. Windows 8/8.1 and 32-bit Windows are outside this policy. A tool that starts Node.js with a scrubbed environment does not inherit `NODE_SKIP_PLATFORM_CHECK`; that belongs to the upstream tool.
