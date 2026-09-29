# WorkDSH Desktop 外壳

[English](README.md)

本包构建 Electron 应用。安装包包含 `lib/workdsh-main.js` 和一套运行时 Profile。DeepSeek Harness 的 Host、Web Client 及核心能力来自该 Profile 中固定的上游版本。WorkDSH 的项目、资料库、专家、技能、连接器及其支撑服务由 `workdsh-bundle` 组合，不是另外几个 Desktop 版本。

## 开发

使用 Node.js `^22.19.0` 或 `>=24`，以及通过 Corepack 启动的 Yarn 4.18.0。在仓库根目录执行：

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn dev
```

`dev` 构建外壳、准备固定版本的 Profile 和主运行时，再启动 Electron。它是这里唯一会打开图形应用的命令。无界面验证使用 `corepack yarn check` 和 `corepack yarn check:desktop-dsh-alignment`。`corepack yarn workspace dsh-plugin-desktop package:dir` 生成未压缩应用，并检查其中没有第二套 DSH 依赖。

Windows 7 SP1 x64 借助 [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT) 运行。`build/installer.nsh` 通过 VxKex NEXT 的 `KexCfg.exe` 为 `WorkDSH.exe` 启用它，`src/windows7-compatibility.ts` 在该系统上应用外壳的运行时策略。标准 Windows 包完成后，`corepack yarn dist:win7` 会针对 Windows 7 审计 `dist/win-unpacked`，准备固定版本的 VxKex NEXT 安装程序和支持 Windows 7 的 Microsoft VC++ 可再发行组件包，并把同一应用封装为 `dist/win7/WorkDSH-<版本>-win7-x64-Offline-Setup.exe`；发布脚本在 Windows 上会执行它。在真实 Windows 7 机器上启动验证仍是原生验证步骤；参见 [Agent Note](../.agents/notes/implemented/architecture/2026-09-28-windows7-vxkex-compatibility.zh.md)。

Ubuntu 包在各自架构上用 `corepack yarn dist:linux` 原生构建，生成 `dist/WorkDSH-<版本>-linux-<amd64|arm64>.deb`。`scripts/linux-glibc-audit.ts` 拒绝任何比 Ubuntu 20.04 所带版本需要更新的 glibc、libstdc++ 或 C++ ABI 的内置 ELF 文件，唯一记录在案的例外是需要 Ubuntu 22.04 的 x64 SenseVoice 语音转文字绑定；CI 会用 `scripts/smoke-ubuntu-deb.sh` 把每个包安装进 `ubuntu:20.04` 与 `ubuntu:24.04` 容器验证；参见 [Agent Note](../.agents/notes/implemented/architecture/2026-09-29-ubuntu-deb-packages.zh.md)。

本包不修改上游源码。升级 DSH 时，同时更新子模块固定版本和运行时准备版本；发布前验证 WorkDSH Profile、两个平台的打包检查及最终安装包。默认选择上游最新正式版；预发布版需要明确的产品决定。

外壳源码与打包脚本在本目录。Profile 包的源码和发布属于 WorkDSH 仓库；参见[Desktop 归属约束](../docs/desktop-boundaries.md)。
