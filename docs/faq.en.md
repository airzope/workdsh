# WorkDSH FAQ

[中文](faq.md)

## Is this an official DeepSeek product?

No. WorkDSH is an independent community project built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and is not officially endorsed.

## Which platforms are supported?

Check the actual assets attached to [GitHub Releases](https://github.com/techflag/workdsh/releases). Current build targets are Windows x64 and separate macOS arm64 and x64 packages. There is no Universal or Linux installer. Windows 7 SP1 x64 runs through VxKex NEXT; see the next section.

## Does it run on Windows 7?

Windows 7 SP1 x64 is supported on a best-effort basis through the third-party compatibility layer [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT) ([Gitee mirror](https://gitee.com/YuZhouRen86/VxKex-NEXT)). Official Electron, Node.js, and Python releases no longer support Windows 7.

1. Install Service Pack 1 and updates KB2533623 and KB2670838, then install the latest VxKex NEXT.
2. Run the same Windows x64 Setup. On Windows 7 the installer uses VxKex NEXT's `KexCfg.exe` to enable VxKex NEXT for `WorkDSH.exe`, keeping it inherited by child processes. Without VxKex NEXT, setup stops and offers the download page. Upgrades keep this setting; uninstalling removes it.
3. On Windows 7, WorkDSH sets `NODE_SKIP_PLATFORM_CHECK=1` for its bundled Node.js and turns off GPU hardware acceleration.

The Portable ZIP bypasses the installer: after extracting it, right-click `WorkDSH.exe`, open Properties > VxKex, check "Enable VxKex NEXT for this program", and leave "Disable VxKex NEXT for child processes" unchecked. If strong version spoofing in VxKex NEXT hides Windows 7 from WorkDSH, set the environment variable `WORKDSH_WINDOWS7_COMPAT=1`. Windows 8/8.1 and 32-bit Windows are not supported. When reporting a Windows 7 problem, include the VxKex NEXT version.

## Must I install Node.js, Python, or DSH myself?

Ordinary users do not. The installer includes a pinned runtime and DSH Profile. Developers building from source need the repository's required Node.js and package manager.

## Is official Harness modified?

No. The repository pins an unmodified upstream submodule. The Electron carrier starts that DSH Profile, and WorkDSH features are composed by Profile packages.

## Where are data and plugins?

DSH home is under local application data. Projects, library, experts, skills, and connectors belong to the WorkDSH Profile. Community Market and Fabric currently remain design documents. Whether an external model receives data depends on user configuration.

## How do I update?

The current carrier has no automatic update manager. Download a newer installer manually from [Releases](https://github.com/techflag/workdsh/releases), backing up important data first. Report problems through [GitHub Issues](https://github.com/techflag/workdsh/issues).
