# WorkDSH Desktop 外壳

[English](README.md)

本包构建 Electron 应用。安装包包含 `lib/workdsh-main.js` 和一套运行时 Profile。DeepSeek Harness 的 Host、Web Client 及核心能力来自该 Profile 中固定的上游版本。WorkDSH 的项目、资料库、专家、技能、连接器及其支撑服务由 `workdsh-bundle` 组合，不是另外几个 Desktop 版本。载体每次启动时把该 Profile 链接到 `<userData>/dsh-home`；只有内置组合变化时才替换 Profile 的 `cordis.patch.yml`，并保留 DSH 设置追加的行，因此设置在多次启动和更新之间得以保留（[Agent Note](../.agents/notes/implemented/architecture/2026-10-01-runtime-profile-patch-settings.zh.md)）。

## 开发

使用 Node.js `^22.19.0` 或 `>=24`，以及通过 Corepack 启动的 Yarn 4.18.0。在仓库根目录执行：

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn dev
```

`dev` 构建外壳、准备固定版本的 Profile 和主运行时，再启动 Electron。它是这里唯一会打开图形应用的命令。无界面验证使用 `corepack yarn check` 和 `corepack yarn check:desktop-dsh-alignment`。`corepack yarn workspace dsh-plugin-desktop package:dir` 生成未压缩应用，并检查其中没有第二套 DSH 依赖。

macOS DMG 在各自 CPU 上原生构建（`WORKDSH_MAC_ARCH` 必须与 Node 架构一致，因为 Profile 中按 CPU 区分的包跟随 Node 架构）。随后 `scripts/macos-compat-audit.ts` 拒绝以下情况的 `.app`：可执行文件缺少目标架构、Profile 中装了其他 CPU 的平台包，或目标架构的文件需要比 15.0 更新的 macOS。CI 在 `macos-15-intel` 与 `macos-15` 上构建，并在同一机器上运行 `scripts/smoke-macos-dmg.sh`；参见 [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-macos-15-native-packages.zh.md)。

Windows 7 SP1 x64 借助 [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT) 运行。`build/installer.nsh` 通过 VxKex NEXT 的 `KexCfg.exe` 为 `WorkDSH.exe` 启用它，`src/windows7-compatibility.ts` 在该系统上应用外壳的运行时策略。标准 Windows 包完成后，`corepack yarn dist:win7` 会针对 Windows 7 审计 `dist/win-unpacked`，准备固定版本的 VxKex NEXT 安装程序和支持 Windows 7 的 Microsoft VC++ 可再发行组件包，并把同一应用封装为 `dist/win7/WorkDSH-<版本>-win7-x64-Offline-Setup.exe`；发布脚本在 Windows 上会执行它。在真实 Windows 7 机器上启动验证仍是原生验证步骤；参见 [Agent Note](../.agents/notes/implemented/architecture/2026-09-28-windows7-vxkex-compatibility.zh.md)。

Ubuntu 包在各自架构上用 `corepack yarn dist:linux` 原生构建，生成 `dist/WorkDSH-<版本>-linux-<amd64|arm64>.deb`。`scripts/linux-glibc-audit.ts` 拒绝任何比 Ubuntu 20.04 所带版本需要更新的 glibc、libstdc++ 或 C++ ABI 的内置 ELF 文件。在此之前，`scripts/linux-sherpa-onnx.ts` 会在 `ubuntu:20.04` 容器中用固定版本的 sherpa-onnx 源码重新编译 x64 的 SenseVoice 语音转文字绑定，因此构建 x64 包需要 Docker 与 Git；CI 会用 `scripts/smoke-ubuntu-deb.sh` 把每个包安装进 `ubuntu:20.04` 与 `ubuntu:24.04` 容器验证；参见 [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-ubuntu-deb-packages.zh.md)。

`scripts/prepare-workdsh-media.ts` 把固定版本的静态 FFmpeg 8.1.2 与 FFprobe（Shaka Project `n8.1.2-1`，GPLv3，按目标校验 SHA-256）连同许可文本和 `SOURCES.md` 放到 `build/workdsh-runtime/media/`。载体以 `WORKDSH_MEDIA_TOOLS` 把该目录传给运行时，Office 插件的 `media-ffmpeg` 技能写明可执行文件路径，各平台审计与打包后的运行冒烟都要求它们存在。附带它们的发布必须同时发布对应的源码归档；参见 [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-bundled-ffmpeg.zh.md)。

名称、标识与图标来自构建时的品牌目录，默认为 `branding/workdsh/`。`scripts/generate-brand.ts` 把 `WORKDSH_BRAND` 选择的品牌生成到 `build/brand/`（各平台图标、托盘位图、标志与品牌字段）；打包脚本据此追加对应的 electron-builder 覆盖项，并按品牌文件名校验产物，载体再把显示名称和标志传给 Profile。参见[白牌构建](../docs/white-label.md)和 [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-build-time-white-label.zh.md)。

`scripts/prepare-workdsh-llama.ts` 把 llama.cpp `b11247` 的 `llama-server` 放到 `build/workdsh-runtime/llama/`：Windows（Vulkan 构建，旁附 VC++ 运行库 DLL）与 macOS 使用官方归档；Ubuntu 使用 `scripts/build-llama-linux.sh` 在 `ubuntu:20.04` 中从同一提交构建的版本，因此构建 Linux 包需要 Docker。`src/llama.ts` 创建 `<userData>/models`，并把服务路径、该文件夹和每次启动新生成的密钥交给运行时。Profile 中的 `workdsh-bundle/local-models` 在用户于首次启动或“设置 → 模型”中选择本地模型时，或在文件夹中出现模型后，以路由模式在回环端口上启动服务，并把该文件夹中的每个 GGUF 文件变成一个本地模型；参见 [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-bundled-llama-cpp.zh.md)。

`scripts/prepare-workdsh-speech.ts` 把 SenseVoiceSmall INT4 权重、词表和 Silero VAD 放到 `build/workdsh-runtime/speech/sensevoice/`，载体再把它们告诉 Profile，因此 DSH 的本地语音转文字无需下载。它在由 `scripts/sensevoice/requirements.txt` 中按哈希固定的 wheel 组成的虚拟环境里（Linux x64 上的 Python 3.11 或 3.12），用 `scripts/sensevoice/quantize.py` 量化所固定 DSH 版本所固定的 FP32 导出，并且只接受固定的结果；结果保存在 `build/.workdsh-speech-cache`，CI 在每次运行的 `speech-model` 作业中生成一次。参见 [Agent Note](../.agents/notes/implemented/architecture/2026-10-01-bundled-sensevoice-int4.zh.md)。

发布只来自默认分支：手动运行的 `Release` 工作流在分支最新提交上创建 `v<Web 版本>` 并运行 Web 发布，随后创建 `desktop-v<Desktop 版本>` 并运行 CI 的标签构建，由它发布安装包、`SHA256SUMS` 与 FFmpeg 源码归档。

本包不修改上游源码。升级 DSH 时，同时更新子模块固定版本和运行时准备版本；发布前验证 WorkDSH Profile、两个平台的打包检查及最终安装包。默认选择上游最新正式版；预发布版需要明确的产品决定。

外壳源码与打包脚本在本目录。Profile 包的源码和发布属于 WorkDSH 仓库；参见[Desktop 归属约束](../docs/desktop-boundaries.md)。
