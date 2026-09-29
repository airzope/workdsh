# WorkDSH Web and plugins v0.1.0-alpha.15

This release packages the current WorkDSH Profile for DeepSeek Harness 0.1.7-rc.2.

- **Library (0.1.0-alpha.6):** converts DOC, XLS/XLSX, PPT, ODT/ODS/ODP, RTF, EPUB, and CSV to searchable Markdown with AnyDoc. It recognizes images, and PDF pages without a text layer, with PaddleOCR PP-OCRv5 mobile running in a worker thread. The models and runtime are pinned by SHA-256. Agents can call `document_to_markdown` and `document_ocr`. Everything runs offline.
- **Office (0.1.0-alpha.10):** adds the built-in `media-ffmpeg` skill for converting, compressing, losslessly trimming, joining, and inspecting audio and video. It uses the FFmpeg that the Desktop app bundles; on the Web, it uses `WORKDSH_FFMPEG`/`WORKDSH_FFPROBE` or FFmpeg on the Host's PATH. Exported XLSX and PDF files name the white-label product as their creator.
- **Bundle (0.1.0-alpha.54):** serves the white-label product name and mark at `/api/workdsh-brand`, and shows them in the sidebar and the page title.
- **Access, Skills, Projects:** use neutral wording where the product name appeared, so that white-label builds read correctly.

The release contains 12 WorkDSH packages, the install script, a manifest, and SHA-256 checksums. SkillHub and dsh-market are third-party services or plugins, and their catalog entries are neither bundled nor approved by WorkDSH. Check each item's license, dependencies, and DSH compatibility before you install it.

This is an Alpha release. Back up local profiles before you upgrade. The desktop installers are published separately as `desktop-v*` releases.
