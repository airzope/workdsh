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

## 音视频处理

安装包内置 FFmpeg 与 FFprobe。在对话中直接说明需求即可，例如“把 会议.mov 转成 MP4”“把这个视频压缩到 50 MB 以内”“截取 01:10 到 02:30，不要重新编码”“提取音频为 MP3”“合并这三段视频”。AI 会使用内置的 `media-ffmpeg` 技能：

- 先查看时长、编码和分辨率，再选择做法；结果写入原文件旁的新文件，不会覆盖原件。
- 只换封装、截取片段和合并同规格片段时直接复制音视频流，不损失画质，速度也快。无损剪辑只能从关键帧开始，起点可能比指定时间早几秒；需要精确到帧时，AI 会说明并改为重新编码。
- 压缩默认使用 H.264/AAC 的 MP4，兼容性最好；也可按目标大小、分辨率或 H.265 压缩。
- 命令通过对话中的命令工具运行，受当前权限与沙箱设置约束。处理全部在本机离线完成。

## 本地模型

安装包内置 llama.cpp 模型服务，可以不联网、不用 API 密钥运行开源模型：

1. 首次启动时，在“选择要使用的模型”中选择“本地模型 (llama.cpp)”，点击“启动本地模型”。之后也可以在“设置 → 模型”底部的本地模型卡片中开关服务。
2. 下载 GGUF 格式的模型文件（`*.gguf`），例如 Qwen、Llama、Gemma 等模型的量化版本。
3. 放进模型文件夹（首次启动后自动创建，内有说明文件；启动本地模型后，对话框和本地模型卡片都会显示它的路径）：
   - Windows：`%APPDATA%\WorkDSH\models`
   - macOS：`~/Library/Application Support/WorkDSH/models`
   - Ubuntu：`~/.config/WorkDSH/models`
4. 几秒后，模型出现在模型选择的“本地模型 (llama.cpp)”中，模型名与文件同名。在首次启动时选择本地模型的，第一个模型会成为新会话的默认模型。

- 没有在首次启动时选择也没关系：只要模型文件夹里有 GGUF 模型，服务就会自动启动；在“设置 → 模型”中关闭后则不再自动启动。关闭服务时，如果默认模型是本地模型，会恢复为之前的默认模型。

- 一个文件对应一个模型。多模态模型（附带 `mmproj` 文件）或分卷模型各放在一个子文件夹中，模型名为子文件夹名。
- Windows 上的模型文件名和子文件夹名请只用英文字母、数字、`-`、`_` 和 `.`：内置的 llama.cpp 在 Windows 上无法打开含中文等字符的文件名。模型文件夹本身所在的路径不受此限制。
- 模型在首次使用时加载，同一时间只加载一个，闲置十分钟后自动卸载以释放内存。内存需求取决于模型大小，通常略大于文件本身。
- 每个模型默认使用 32K 上下文，且不超过模型的训练长度。可在模型文件夹中创建 `presets.ini`，按 llama.cpp 路由预设的格式调整上下文、显卡层数等参数；存在该文件时不再使用默认值。
- Windows 版在有 Vulkan 显卡驱动时使用显卡加速，Apple 芯片的 Mac 使用 Metal；Intel Mac 与 Ubuntu 版使用 CPU。
- 服务只监听本机回环地址，并使用每次启动随机生成的密钥。服务日志位于模型文件夹旁的 `llama/server.log`；服务启动失败时，本地模型卡片会显示日志的最后一行。
- 能否调用工具取决于模型本身；较小的模型可能无法稳定完成多步任务。

## 语音输入

安装包内置 SenseVoiceSmall 语音识别模型（INT4 量化，约 155 MB）和 Silero 语音检测模型，录音在本机识别，不需要联网下载模型：

1. 打开侧栏的“插件”，开启“语音输入”。开启状态在重启和升级后保留。
2. 选择工作区后，点击输入框中模型选择右侧的麦克风，允许使用麦克风，说完后点击“停止并识别”，识别结果会插入输入框。

- 支持自动识别、中文、英文、粤语、日语和韩语，可在“语音输入”插件详情中选择。
- 插件详情中的识别服务显示为“SenseVoiceSmall (INT8)”：DSH 只按 INT8 和 FP32 命名模型文件，内置的 INT4 权重沿用 INT8 的文件名。插件列表中“首次使用需安装依赖”的说明也来自 DSH；内置模型无需安装。
- 识别在 CPU 上运行，加载后约占 300 MB 内存，闲置后自动释放。

## 数据与插件

运行数据位于本机应用数据目录下的 DSH home。安装包内的 Profile 提供固定版本依赖；桌面外壳不会把另一套 DSH npm 依赖安装到 `app.asar`。模型或外部工具可能按用户配置访问网络。

WorkDSH 功能随所下载的版本一起更新。使用官方 DSH 插件机制添加第三方插件时，应以该版本的官方 DSH 文档和实际 Profile 为准；不要使用旧版 `desktopProfiles` 或 `desktopPnpm` 接口。项目和资料库中的内容请按产品界面管理。

## 更新与排查

当前 Desktop 没有自动更新管理器。需要升级时，到 [Releases](https://github.com/techflag/workdsh/releases) 获取目标平台的新安装包。升级前备份重要工作目录及应用数据。

如果窗口没有出现，先确认安装包与操作系统架构匹配，再重新启动并记录错误。报告问题时请附操作系统、WorkDSH 版本、复现步骤及错误信息；提交到 [GitHub Issues](https://github.com/techflag/workdsh/issues)。开发与打包边界见[架构说明](architecture.md)。
