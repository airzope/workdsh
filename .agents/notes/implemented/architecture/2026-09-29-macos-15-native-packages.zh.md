# Agent Note：面向 Intel 与 Apple 芯片的原生 macOS 15 安装包

状态：已实现

[English](2026-09-29-macos-15-native-packages.md) | 中文

## 决策

WorkDSH 分别提供 x64（Intel）与 arm64（Apple 芯片）的未签名 macOS DMG，最低支持 macOS 15。每个 DMG 都由同架构的 Node 构建：CI 用 `macos-15-intel` 构建 x64，用 `macos-15` 构建 arm64。签名与公证仍是在有证书的机器上手动运行 `release-mac.ts`。

## 为什么要原生构建

DSH Profile 用 pnpm 安装，而 pnpm 会按运行它的 Node 选择按 CPU 区分的可选包：LibreOffice Kit 原生引擎（`@deepseek-ai/libreoffice-kit-darwin-*`）、SenseVoice 语音转文字使用的 `sherpa-onnx-darwin-*`，以及 `@napi-rs/canvas-darwin-*`。因此由 arm64 Node 打包的 x64 DMG 中，这些包只有 arm64 版本。主运行时和 Electron 是 x64 的，原有的 `lipo` 检查能通过，但在 Intel Mac 上 Office 转换和语音识别会失败。现在 `package-mac.ts` 与 `release-mac.ts` 拒绝与 Node 架构不同的目标架构。在 Apple 芯片上打 x64 包，需要在 Rosetta 下使用 x64 Node。

## 门槛

- `scripts/macos-compat-audit.ts` 解析 `.app` 中的单架构与通用 Mach-O 文件，读取 `LC_BUILD_VERSION` 与 `LC_VERSION_MIN_MACOSX`。出现以下情况时失败：
  - 主可执行文件、Node 或 Python 缺少目标架构；
  - 存在 `@scope/name-darwin-arm64` 之类的平台包，却没有对应目标 CPU 或通用版本（按包名配对，以覆盖 pnpm 的隔离布局）；
  - 目标架构的文件或 `LSMinimumSystemVersion` 需要比 15.0 更新的 macOS；
  - 离线运行时内容不完整。
- 缺少目标架构的 Mach-O 文件只列出、不检查，因为 koffi 等加载器会在运行时选择对应 CPU 的文件。
- 报告在断言之前写入 DMG 旁边的 `macos-audit.json`，CI 以 `desktop-macos-<arch>-audit` 上传。
- `scripts/smoke-macos-dmg.sh` 在 macOS 15 runner 上以只读方式挂载 DMG，并运行与 Ubuntu 冒烟共用的 `scripts/smoke-bundled-runtime.sh`。它会运行：
  - 以 Node 模式运行的 Electron 与内置 Node，两者都必须报告目标 CPU；
  - 带 Office 库的 Python；
  - DSH CLI；
  - SenseVoice 绑定；
  - 通过原生 LibreOffice Kit 引擎把 DOCX 转换为 PDF。

## 验证边界

冒烟检查是无界面的。打开窗口、未签名 DMG 的 Gatekeeper 行为以及签名发布仍需在真实 Mac 上人工检查。
