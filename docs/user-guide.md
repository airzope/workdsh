# WorkDSH 用户指南

[English](user-guide.en.md)

## 安装与启动

从 [GitHub Releases](https://github.com/techflag/workdsh/releases) 下载含实际安装文件的版本。Windows 使用 x64 Setup 或 Portable（Windows 7 SP1 x64 使用 win7 离线安装包，见[常见问题](faq.md#能在-windows-7-上运行吗)）；macOS 根据电脑选择 Apple Silicon（arm64）或 Intel（x64）DMG；Ubuntu 20.04 及以上选择 amd64 或 arm64 的 `.deb` 包（见[常见问题](faq.md#如何在-ubuntu-上安装)）。安装包自带 Electron、Node 和固定版本的 DSH Profile，普通用户无需安装 Node.js 或 Python。

启动后，WorkDSH 在本机运行 Profile 中的官方 DSH 服务，并在应用窗口打开本机页面。项目、资料库、专家、技能与连接器由 WorkDSH Profile 提供。窗口关闭会结束 Windows 与 Linux 上的应用；macOS 遵循系统窗口生命周期。当前外壳不提供旧文档描述的托盘、多 Profile 选择或自动更新面板。

## 文档转换与文字识别

资料库可导入 Markdown、TXT、HTML、PDF、Word（DOC/DOCX）、Excel（XLS/XLSX）、PowerPoint（PPT/PPTX）、OpenDocument、RTF、EPUB、CSV 和图片（PNG/JPEG/BMP/GIF/WebP/TIFF），并生成可搜索、可在对话中引用的文本。

- Office、OpenDocument、RTF、EPUB 与 CSV 由 AnyDoc 在本机转换。
- 图片和扫描版 PDF 中没有文字层的页面由 PaddleOCR（PP-OCRv5 移动版）在本机识别。每个 PDF 最多识别 100 页；打开这类资料时可在原件与识别文本之间切换。
- 识别结果可能有误，请核对关键数字和专有名词。

对话中也可以让 AI 直接处理工作区文件：`document_to_markdown` 把文档转换为 Markdown，`document_ocr` 逐页识别图片或 PDF 并给出置信度。所有转换与识别都离线进行，文件不会离开本机。

## 数据与插件

运行数据位于本机应用数据目录下的 DSH home。安装包内的 Profile 提供固定版本依赖；桌面外壳不会把另一套 DSH npm 依赖安装到 `app.asar`。模型或外部工具可能按用户配置访问网络。

WorkDSH 功能随所下载的版本一起更新。使用官方 DSH 插件机制添加第三方插件时，应以该版本的官方 DSH 文档和实际 Profile 为准；不要使用旧版 `desktopProfiles` 或 `desktopPnpm` 接口。项目和资料库中的内容请按产品界面管理。

## 更新与排查

当前 Desktop 没有自动更新管理器。需要升级时，到 [Releases](https://github.com/techflag/workdsh/releases) 获取目标平台的新安装包。升级前备份重要工作目录及应用数据。

如果窗口没有出现，先确认安装包与操作系统架构匹配，再重新启动并记录错误。报告问题时请附操作系统、WorkDSH 版本、复现步骤及错误信息；提交到 [GitHub Issues](https://github.com/techflag/workdsh/issues)。开发与打包边界见[架构说明](architecture.md)。
