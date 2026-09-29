# Agent Note：内置 FFmpeg 处理音视频

Status: implemented

[English](2026-09-29-bundled-ffmpeg.md) | 中文

## Decision

每个 Desktop 安装包都在 `workdsh-runtime/media/bin/` 中携带 FFmpeg 8.1.2 与 FFprobe，WorkDSH Office 插件注册 `media-ffmpeg` 技能。技能覆盖查看、转换、压缩、无损剪辑（从关键帧开始的流复制）、合并和提取音频。命令由 AI 通过 DSH 的命令工具运行，因此遵循会话的审批与沙箱策略，没有另设绕过它们的媒体工具。

这沿用上游对内置运行时的做法：`dsh-skill-office` 把 LibreOffice Kit 的绝对路径附在技能正文末尾，`load_workspace_dependencies` 返回解释器路径而不修改 PATH。载体向运行时传入 `WORKDSH_MEDIA_TOOLS`。Office 插件按以下顺序查找可执行文件：

1. 该目录中的 `bin/ffmpeg`、`bin/ffprobe` 及其 `manifest.json`；
2. `WORKDSH_FFMPEG` 与 `WORKDSH_FFPROBE`；
3. PATH。

找到后把结果附在技能正文末尾。找不到时，技能要求 AI 向用户说明，而不是自行下载 FFmpeg。

## Build

`scripts/prepare-workdsh-media.ts` 在准备主运行时之后执行。它从 Shaka Project 的 `static-ffmpeg-binaries` `n8.1.2-1` 下载当前主机对应的固定构建，并按每个目标记录的 SHA-256 校验。该项目用同一条公开流水线、同一套配置构建全部五个目标，配置为 `--enable-gpl --enable-version3`，包含 x264、x265、libvpx、SVT-AV1、Opus、LAME 与 Mbed TLS。

脚本随后运行 `ffmpeg -encoders`，缺少必需编码器时直接失败。它写入 `manifest.json`（版本、许可、目标、编码器）、`COPYING.GPLv3`，以及列出全部上游源码和构建脚本提交的 `SOURCES.md`。

选择这一构建的原因：

- **Windows：**链接 msvcrt，导入的函数都不晚于 Windows 7，因此既不需要 UCRT，也不需要 VxKex。
- **Linux：**完全静态（musl），没有 glibc 版本要求。
- **macOS：**两个构建的最低系统版本都是 macOS 15.0。
- **其他候选：**
  - BtbN 只保留滚动标签，其 Windows 构建需要 VxKex。
  - gyan.dev 的构建更大，且不公开依赖的构建脚本。
  - `ffmpeg-static` 在安装时才下载，且混用多个来源。

该构建没有 zlib，因此没有 PNG 编码器；静帧使用 JPEG。

## Gates

- **离线文件：**Linux、macOS 与 Windows 7 审计都要求 `media/manifest.json`、`bin/ffmpeg` 和 `bin/ffprobe` 存在；在 Linux 与 macOS 上，它们还必须是目标架构的映像。原有的 glibc、`minos` 与 Windows 7 导入检查像对待其他二进制文件一样覆盖它们。
- **运行冒烟：**`scripts/smoke-media.mjs` 生成一个文件名含中文和空格的片段，然后：
  - 用 `-c copy` 截取并核对时长与编码；
  - 把音频转为 MP3；
  - 压缩片段，并确认文件变小；
  - 确认打包后的 Office 插件把内置路径交给技能。

  Ubuntu 容器冒烟与 macOS DMG 冒烟会运行它，封装熔丝后的打包检查也会运行它；这是 Windows 上唯一的运行时检查。

## Licensing

这些可执行文件采用 GPLv3。WorkDSH 把它们作为独立程序运行，不与其链接，因此自身许可不受影响。GPL 文本与 `SOURCES.md` 放在可执行文件旁，THIRD_PARTY_NOTICES 也记录了该构建。

Shaka 只公开构建脚本，不托管源码归档。CI 任务 `ffmpeg-sources` 运行 `scripts/pack-ffmpeg-sources.ts`，按固定的标签或提交获取每个组件，并按固定的 SHA-256 校验 LAME 源码包；结果以 `dsh-plugin-desktop-ffmpeg-sources` 上传，因此每个 Desktop 发布都会在安装包旁附带 `ffmpeg-8.1.2-corresponding-source.tar.gz`。

## Upgrades

Shaka 的 macOS 构建使用运行器的 SDK，没有固定部署目标。每次升级版本时：

- 重新计算校验和；
- 重新运行 macOS 审计，最低系统版本必须保持在 15.0 及以下；
- 重新运行 Windows 7 导入检查；
- 按 Shaka 的 `versions.txt` 更新 `SOURCES.md`。
