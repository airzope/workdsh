# Agent Note: Windows 7 x64 through VxKex NEXT

Status: implemented

English | [中文](2026-09-28-windows7-vxkex-compatibility.zh.md)

## Decision

WorkDSH supports Windows 7 SP1 x64 on a best-effort basis through the third-party [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT) compatibility layer. Windows 7 uses the same x64 NSIS installer, carrier source, Electron version, and runtime Profile as every other Windows host; there is no separate build or release channel. Electron 43, the bundled Node.js 24, and Python 3.12 import APIs that Windows 7 lacks. VxKex NEXT supplies them per executable through Image File Execution Options (IFEO) and propagates itself into child processes.

## Installer

On NT 6.1 (`IsWin7` or `IsWin2008R2`), setup reads `KexDir` from `HKLM\Software\VXsoft\VxKex` in the 64-bit registry view. If `KexCfg.exe` is not there, setup stops with exit code 2 and offers the VxKex NEXT download page. Otherwise it runs `KexCfg.exe /EXE:"<INSTDIR>\WorkDSH.exe" /ENABLE:1 /DISABLEFORCHILD:0 /DISABLEAPPSPECIFIC:0`. KexCfg is VxKex's supported configuration interface. It creates the `UseFilter` and `FilterFullPath` subkey for this exact path, writes directly when elevated, and otherwise uses VxKex's SYSTEM elevation task, so a per-user installation needs no UAC prompt.

Propagation and app-specific fixes are always turned on. Renderers, Node.js, Python, and pnpm are children of `WorkDSH.exe`, and VxKex recognizes Chromium and Node from their exports to apply the kernel32 version spoof and the Windows 10 DirectWrite implementation. Windows version spoofing remains the user's choice.

The elevation task applies changes asynchronously, so setup polls the IFEO subkey for up to 10 seconds and checks both `FilterFullPath` and `FLG_APPLICATION_VERIFIER`. If the registration does not appear, setup shows manual instructions and still completes. Uninstall removes the configuration with an all-default KexCfg call, but only when the registration exists and never during an upgrade (`--updated`), where the removal could race the new installer's registration.

## Carrier runtime policy

`src/windows7-compatibility.ts` recognizes NT 6.1 from `os.release()`. VxKex NEXT does not spoof the PEB version for Chromium or Node processes, so this value stays real unless the user enables strong spoofing. `WORKDSH_WINDOWS7_COMPAT=1` or `0` overrides detection. On Windows 7 the carrier:

- sets `NODE_SKIP_PLATFORM_CHECK=1` in its own environment before starting the DSH Host. Node.js 20 and later exit below Windows 10 without it, and VxKex does not spoof the version that Node checks. Every runtime child inherits the variable.
- calls `app.disableHardwareAcceleration()`. Windows 7 has no DirectComposition, current Chromium no longer tests its Windows 7 GPU paths, and repeated GPU-process failure terminates Electron.

The renderer sandbox stays enabled; VxKex NEXT adds `--no-sandbox` only for 32-bit Chromium.

## Limits and verification boundary

The supported host is Windows 7 SP1 x64 with KB2533623, KB2670838, and the latest VxKex NEXT. Windows 8/8.1, 32-bit Windows, and hosts without VxKex are outside this policy. The Portable ZIP bypasses setup, so users enable VxKex for `WorkDSH.exe` in its Properties > VxKex tab. A tool that starts Node.js with a scrubbed environment does not inherit `NODE_SKIP_PLATFORM_CHECK` and fails on Windows 7; that belongs to the upstream tool.

VxKex NEXT's compatibility list verifies Chromium 132 and VS Code 1.96 (Electron 32); Electron 43 is newer than any verified entry. The installer logic was exercised under Wine configured as Windows 7 and Windows 10 with a stand-in `KexCfg.exe`: missing VxKex, registration and verification, a registration that never appears, upgrade, and uninstall. Launching the packaged application on a real Windows 7 SP1 x64 machine with VxKex NEXT remains a native release gate, like the other Windows UI checks.
