# WorkDSH user guide

[中文](user-guide.md)

## Install and launch

Download a release with actual installer assets from [GitHub Releases](https://github.com/techflag/workdsh/releases). Use the x64 Setup or Portable package on Windows; on Windows 7 SP1 x64, use the win7 offline installer (see the [FAQ](faq.en.md#does-it-run-on-windows-7)). On macOS, choose the Apple Silicon (arm64) or Intel (x64) DMG for your computer. On Ubuntu 20.04 or newer, use the amd64 or arm64 `.deb` package (see the [FAQ](faq.en.md#how-do-i-install-it-on-ubuntu)). The installer includes Electron, Node, and a pinned DSH Profile; ordinary users do not need to install Node.js or Python.

WorkDSH starts the official DSH service from that Profile locally and opens its page in the application window. Projects, library, experts, skills, and connectors come from the WorkDSH Profile. Closing the window exits the application on Windows and Linux; macOS follows its normal window lifecycle. The current carrier does not include the former tray, multi-Profile selector, or automatic update panel described in older documentation.

## Document conversion and text recognition

The library imports Markdown, TXT, HTML, PDF, Word (DOC/DOCX), Excel (XLS/XLSX), PowerPoint (PPT/PPTX), OpenDocument, RTF, EPUB, CSV, and images (PNG/JPEG/BMP/GIF/WebP/TIFF), and produces text you can search and reference in conversations.

- Office, OpenDocument, RTF, EPUB, and CSV files are converted locally by AnyDoc.
- Images, and PDF pages without a text layer (scans), are recognized locally by PaddleOCR (PP-OCRv5 mobile), up to 100 pages per PDF. When you open such a file, you can switch between the original and the recognized text.
- Recognition can make mistakes; check key numbers and proper names.

In conversations the AI can also process workspace files directly: `document_to_markdown` converts a document to Markdown, and `document_ocr` recognizes the text of an image or of PDF pages, with a confidence per page. Conversion and recognition run offline, so files never leave the computer.

## Audio and video

The installers bundle FFmpeg and FFprobe. Describe what you need in the conversation, for example "convert meeting.mov to MP4", "compress this video to under 50 MB", "cut 01:10 to 02:30 without re-encoding", "extract the audio as MP3", or "join these three clips". The AI uses the bundled `media-ffmpeg` skill:

- It first inspects duration, codecs, and resolution, then chooses an approach. Results go to a new file next to the original, which is never overwritten.
- Changing the container, cutting a range, and joining clips with identical parameters copy the audio and video streams, so quality is unchanged and the work is fast. A lossless cut can only start at a keyframe, so it may begin a few seconds before the requested time; when you need frame accuracy, the AI says so and re-encodes instead.
- Compression defaults to H.264/AAC MP4 for the widest compatibility; you can also compress to a target size, a lower resolution, or H.265.
- Commands run through the conversation's command tool, under your current permission and sandbox settings. All processing happens offline on your computer.

## Local models

The installers bundle the llama.cpp model server, so you can run open models offline and without an API key:

1. At first launch, choose "本地模型 (llama.cpp)" (local models) in the model choice and click "启动本地模型" (start local models). Later, turn the server on or off on the local models card at the bottom of Settings > Models.
2. Download a model in GGUF format (`*.gguf`), for example a quantized Qwen, Llama, or Gemma model.
3. Put it in the models folder. It is created at first launch and contains a short note; once local models are started, the dialog and the local models card show its path:
   - Windows: `%APPDATA%\WorkDSH\models`
   - macOS: `~/Library/Application Support/WorkDSH/models`
   - Ubuntu: `~/.config/WorkDSH/models`
4. Within seconds, the model appears under "本地模型 (llama.cpp)" in the model list, named after the file. If you chose local models at first launch, the first model becomes the default for new sessions.

- If you did not choose at first launch, the server still starts by itself once the models folder holds a GGUF model. After you turn it off in Settings > Models, it no longer starts by itself. Turning it off also restores the previous default model when the default was a local one.

- Each file is one model. Put a multimodal model (with its `mmproj` file) or a multi-part model in its own subfolder; the model is named after the folder.
- On Windows, name model files and subfolders with English letters, digits, `-`, `_` and `.` only: the bundled llama.cpp cannot open file names with Chinese or other non-ASCII characters there. This does not apply to the path of the models folder itself.
- A model loads on first use, one at a time, and unloads after ten idle minutes to free memory. It needs somewhat more memory than the file's size.
- Each model gets a 32K context by default, capped at its trained length. To change the context, GPU layers, or other settings, create `presets.ini` in the models folder in llama.cpp's router preset format; the default no longer applies once that file exists.
- The Windows build uses the GPU when a Vulkan driver is installed, and Apple silicon Macs use Metal; Intel Macs and the Ubuntu builds use the CPU.
- The server listens only on the loopback address, with a key generated at each launch. Its log is `llama/server.log`, next to the models folder; when the server fails to start, the local models card shows the log's last line.
- Tool use depends on the model; smaller models may not complete multi-step tasks reliably.

## Voice input

The installers bundle the SenseVoiceSmall speech recognition model (INT4-quantized, about 155 MB) and the Silero voice activity detector, so recordings are recognized on your computer without downloading a model:

1. Open Plugins in the sidebar and turn on "语音输入" (Voice input). It stays on across restarts and updates.
2. With a workspace selected, click the microphone right of the model selector, allow microphone access, and click "停止并识别" (stop and recognize) when you finish; the text is inserted into the message box.

- It recognizes automatically, or Chinese, English, Cantonese, Japanese or Korean, chosen in the Voice input plugin details.
- The plugin details call the recognizer "SenseVoiceSmall (INT8)": DSH names model files only by INT8 and FP32, so the bundled INT4 weights keep the INT8 file name. The note "首次使用需安装依赖" (first use needs installing dependencies) in the plugin list also comes from DSH; the bundled model needs no installation.
- Recognition runs on the CPU and takes about 300 MB of memory once loaded; it is released when idle.

## Data and plugins

Runtime data lives in a DSH home under the local application-data directory. The installer contains the pinned Profile dependencies; the Electron carrier does not install a second DSH npm tree into `app.asar`. Models and external tools may access the network according to user configuration.

WorkDSH features update with the downloaded release. To add third-party plugins through official DSH mechanisms, follow the upstream documentation for the pinned version and inspect the active Profile. Do not use the former `desktopProfiles` or `desktopPnpm` APIs. Manage projects and library content through the product UI.

## Updates and troubleshooting

The current Desktop has no automatic update manager. To upgrade, download a newer installer for your platform from [Releases](https://github.com/techflag/workdsh/releases). Back up important workspaces and application data first.

If no window appears, check that the installer matches your OS architecture, restart, and record the error. Include the OS, WorkDSH version, reproduction steps, and error in a [GitHub Issue](https://github.com/techflag/workdsh/issues). See the [architecture](architecture.en.md) for development and packaging boundaries.
