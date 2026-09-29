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

## Data and plugins

Runtime data lives in a DSH home under the local application-data directory. The installer contains the pinned Profile dependencies; the Electron carrier does not install a second DSH npm tree into `app.asar`. Models and external tools may access the network according to user configuration.

WorkDSH features update with the downloaded release. To add third-party plugins through official DSH mechanisms, follow the upstream documentation for the pinned version and inspect the active Profile. Do not use the former `desktopProfiles` or `desktopPnpm` APIs. Manage projects and library content through the product UI.

## Updates and troubleshooting

The current Desktop has no automatic update manager. To upgrade, download a newer installer for your platform from [Releases](https://github.com/techflag/workdsh/releases). Back up important workspaces and application data first.

If no window appears, check that the installer matches your OS architecture, restart, and record the error. Include the OS, WorkDSH version, reproduction steps, and error in a [GitHub Issue](https://github.com/techflag/workdsh/issues). See the [architecture](architecture.en.md) for development and packaging boundaries.
