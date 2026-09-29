# WorkDSH FAQ

[中文](faq.md)

## Is this an official DeepSeek product?

No. WorkDSH is an independent community project built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and is not officially endorsed.

## Which platforms are supported?

Check the actual assets attached to [GitHub Releases](https://github.com/techflag/workdsh/releases). Current build targets are Windows x64, separate macOS arm64 and x64 packages, and Ubuntu 20.04+ x64 (amd64) and arm64 `.deb` packages. There is no macOS Universal package. Windows 7 SP1 x64 runs through VxKex NEXT; see the next section.

## Does it run on Windows 7?

Windows 7 SP1 x64 is supported on a best-effort basis through the third-party compatibility layer [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT) ([Gitee mirror](https://gitee.com/YuZhouRen86/VxKex-NEXT)). Official Electron, Node.js, and Python releases no longer support Windows 7.

Use the **Windows 7 x64 offline installer** (`WorkDSH-<version>-win7-x64-Offline-Setup.exe`); installation needs no network:

1. It contains everything the standard package does: Electron (which also serves as the built-in browser), Node.js 24, Python 3.12 with python-docx, python-pptx, openpyxl, XlsxWriter, numpy, pandas, Pillow, and lxml, the Word/PowerPoint/Excel Office skills, the LibreOffice Kit engine for rendering and PDF conversion, and the DSH Profile.
2. On Windows 7 it also carries VxKex NEXT 1.2.3.2463 and the Microsoft VC++ 2015-2022 x64 runtime, and installs each silently only when it is missing or older. Both need administrator rights, so UAC prompts appear. It then uses VxKex NEXT's `KexCfg.exe` to enable VxKex NEXT for `WorkDSH.exe`, keeping it inherited by child processes. Upgrades keep this setting; uninstalling removes it.
3. At the end, setup checks for Service Pack 1, KB2533623, KB2670838, and Windows Management Framework 5.1 (PowerShell 5.1, which DSH's command tool needs). These are Windows updates that the installer cannot redistribute; any that are missing are listed with a prompt to get them from Microsoft.
4. On Windows 7, WorkDSH sets `NODE_SKIP_PLATFORM_CHECK=1` for its bundled Node.js and turns off GPU hardware acceleration.

The standard Windows x64 Setup also installs on Windows 7, but only after VxKex NEXT and the VC++ runtime are already present. The Portable ZIP bypasses the installer: after extracting it, right-click `WorkDSH.exe`, open Properties > VxKex, check "Enable VxKex NEXT for this program", and leave "Disable VxKex NEXT for child processes" unchecked. If strong version spoofing in VxKex NEXT hides Windows 7 from WorkDSH, set the environment variable `WORKDSH_WINDOWS7_COMPAT=1`. Windows 8/8.1 and 32-bit Windows are not supported. When reporting a Windows 7 problem, include the VxKex NEXT version.

## How do I install it on Ubuntu?

Download the package for your CPU (`amd64` for x64, `arm64` for ARM), run `sudo apt install ./WorkDSH-<version>-linux-<arch>.deb`, then start WorkDSH from the application menu or with the `workdsh` command. Ubuntu 20.04, 22.04, and 24.04 are supported; other Debian-based distributions with glibc 2.31 or newer are best effort.

- The package contains Electron, Node.js 24, Python 3.12 with its Office libraries, the Office skills, the LibreOffice Kit WebAssembly engine, and the DSH Profile, so these components install and work without a network.
- Each package is built natively for its architecture and installed into fresh Ubuntu 20.04 and 24.04 containers, where Electron, Node.js, Python, and the DSH CLI run and a Word document is converted to PDF offline.
- Exception: on Ubuntu 20.04 x64, the experimental local SenseVoice speech-to-text is unavailable. The sherpa-onnx 1.13.8 x64 binding that comes with the pinned DSH needs glibc 2.32, so it requires Ubuntu 22.04 or later. It loads only in its own recognition process, so the rest of WorkDSH is unaffected; the arm64 package supports this feature on 20.04.
- The package recommends `fonts-noto-cjk` so Chinese documents render correctly; add Chinese fonts yourself when installing with `--no-install-recommends`.
- Ubuntu 24.04 restricts unprivileged user namespaces by default; the install script adds an AppArmor profile for WorkDSH, and older systems get a SUID `chrome-sandbox` when needed.

## Must I install Node.js, Python, or DSH myself?

Ordinary users do not. The installer includes a pinned runtime and DSH Profile. Developers building from source need the repository's required Node.js and package manager.

## Is official Harness modified?

No. The repository pins an unmodified upstream submodule. The Electron carrier starts that DSH Profile, and WorkDSH features are composed by Profile packages.

## Where are data and plugins?

DSH home is under local application data. Projects, library, experts, skills, and connectors belong to the WorkDSH Profile. Community Market and Fabric currently remain design documents. Whether an external model receives data depends on user configuration.

## How do I update?

The current carrier has no automatic update manager. Download a newer installer manually from [Releases](https://github.com/techflag/workdsh/releases), backing up important data first. Report problems through [GitHub Issues](https://github.com/techflag/workdsh/issues).
