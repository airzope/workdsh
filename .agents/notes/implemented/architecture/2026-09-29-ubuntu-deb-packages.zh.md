# Agent Note：面向 Ubuntu 20.04 及以上的 x64 与 arm64 安装包

状态：已实现

[English](2026-09-29-ubuntu-deb-packages.md) | 中文

## 决策

WorkDSH 提供 x64（`amd64`）与 arm64 的 Ubuntu `.deb` 安装包，与其他平台使用同一套外壳源码、Electron 版本和固定版本的 DSH Profile。最低支持 Ubuntu 20.04 LTS：glibc 2.31、libstdc++ `GLIBCXX_3.4.28`、C++ ABI `CXXABI_1.3.12`。每个安装包都在对应架构的原生 runner 上构建，因为打包过程会执行内置的 Node.js 与 Python（主运行时冒烟检查、Profile 清单检查和 DSH CLI 冒烟检查）。

安装包安装到 `/opt/WorkDSH`，命令为 `workdsh`，deb 包名为 `workdsh`，文件名为 `WorkDSH-<版本>-linux-<amd64|arm64>.deb`。它依赖 Electron 所链接的库（GTK 3、NSS、GBM、ALSA、CUPS、xkbcommon、DRM 以及 electron-builder 的默认依赖）。Ubuntu 24.04 为 64 位 `time_t` 改名的库以可选依赖声明，t64 名称在前，例如 `libasound2t64 | libasound2`。只写改名前的名称不够：在 24.04 上 apt 可能用 `liboss4-salsa-asound2` 满足虚拟包 `libasound2`，而它缺少 Electron 需要的 `ALSA_0.9` 符号，导致 Electron 无法启动。改用可选依赖后，同一份依赖列表可在 20.04 到 24.04 上解析。安装包推荐 `fonts-noto-cjk`，因为中文文档需要 CJK 字体才能正确渲染和转换。electron-builder 的安装后脚本会写入 Ubuntu 24.04 上 Chromium 沙箱所需的 AppArmor 配置，并仅在没有用户命名空间的系统上为 `chrome-sandbox` 设置 SUID。

## 运行时

`prepare-workdsh-primary-runtime.mjs` 按主机架构选择上游的 `linux-x64` 或 `linux-arm64` 主运行时目标。它提供 Node.js 24.21.0、python-build-standalone 3.12.14、numpy/pandas/Pillow/lxml 的 manylinux 2.28 wheels，以及 pnpm。在 Linux 上，LibreOffice Kit 使用 WebAssembly 引擎，npm 会为所有 Linux 架构安装它，因此 Office 渲染与 PDF 转换无需原生 LibreOffice。外壳无需改动；其 Windows 7 策略不适用。

## 门槛

- `scripts/linux-glibc-audit.ts` 解析 `linux-unpacked` 或 `linux-arm64-unpacked` 中每个目标架构 ELF 文件的 `.gnu.version_r` 版本需求。任何比 Ubuntu 20.04 更新的 `GLIBC`、`GLIBCXX` 或 `CXXABI` 版本都会使其失败。它还要求主可执行文件、Node.js 与 Python 的架构正确，并要求离线内容齐全：Node.js、pnpm、带 Office 库的 Python、三个 Office 技能、Office 技能与带 WebAssembly 引擎的 LibreOffice Kit 包、DSH Profile，以及包缓存。其他架构的 ELF 文件（例如用不到的预编译包）只列出，不做检查。对两种架构下固定版本的 Electron 43.3.0、Node.js 24.21.0、Python 3.12.14 与 wheels 实测，最高需求为 `GLIBC_2.28`、`GLIBCXX_3.4.21` 与 `CXXABI_1.3.11`。在对比过的 Electron、Node.js 与共享库二进制上，解析器结果与 `readelf` 一致。
- `LINUX_FEATURE_EXCEPTIONS` 记录了一个例外。固定版本 DSH 的实验性本地 SenseVoice 语音转文字使用 sherpa-onnx-node 1.13.8，其 x64 Node-API 绑定 `sherpa-onnx.node` 由 GCC 11 在 glibc 2.32 上构建（`__libc_single_threaded` 与 `std::__throw_bad_array_new_length`）。它的 ONNX 库以及整个 arm64 构建都在 Ubuntu 20.04 的范围内。DSH 只在 SenseVoice 识别进程中加载该绑定，因此在 Ubuntu 20.04 x64 上只有该功能不可用，WorkDSH 的其他功能不受影响。替换这一依赖就要修改固定版本的 DSH，而仓库规则禁止这样做。该例外只针对这一个文件，任何比 Ubuntu 22.04（glibc 2.35、`GLIBCXX_3.4.30`、`CXXABI_1.3.13`）更新的需求仍会使检查失败。审计报告在 `limitedFeatures` 中列出它。
- `scripts/package-linux.ts` 还会检查安装包的 `Package`、`Architecture` 与 `Recommends` 字段。
- CI 使用 `scripts/smoke-ubuntu-deb.sh` 把每个安装包分别装进全新的 `ubuntu:20.04` 与 `ubuntu:24.04` 容器，覆盖最旧的支持版本与 t64 改名。每个容器从 Ubuntu 软件源解析安装包自身的依赖，然后以 Node 模式运行 Electron，并运行 Node.js、带 Office 库的 Python 与 DSH CLI，然后加载 SenseVoice 绑定：从 Ubuntu 22.04（glibc 2.35）起必须加载成功，更旧的版本只报告结果。最后通过内置 LibreOffice Kit 把 python-docx 文档转换为 PDF。

## 验证边界

容器冒烟检查是无界面的。在真实的 Ubuntu 20.04、22.04 或 24.04 桌面上打开窗口，包括 24.04 上的 AppArmor 行为和 Wayland 会话，仍属于人工发布检查。其他 glibc 2.31 及以上的 Debian 系发行版属于尽力支持。不生成 AppImage、RPM 或 Snap。
