# WorkDSH Web and plugins v0.1.0-alpha.16

This release packages the WorkDSH Profile for DeepSeek Harness 0.2.0-rc.1, a release candidate. It also contains the changes prepared as alpha.15, which was not published separately.

- **DeepSeek Harness 0.2.0-rc.1:** every package now depends on DSH 0.2.0-rc.1 exactly, and each released package moves up one alpha version. The Desktop Profile installs dshmarket 1.66.5, the first version compatible with it. Product analytics in this DSH release load only in a Profile named `desktop`, so the WorkDSH Profile keeps them off.
- **Bundle (0.1.0-alpha.55):**
  - `workdsh-bundle/local-models` turns the GGUF models of a llama.cpp router into the `llama-local` model route, "本地模型 (llama.cpp)". Desktop starts that server for the user's models folder; models added or removed there appear within seconds, without a restart. A Web deployment can point `WORKDSH_LLAMA_BASE_URL` and `WORKDSH_LLAMA_API_KEY` at its own router.
  - The bundle serves the white-label product name and mark at `/api/workdsh-brand`, and shows them in the sidebar and the page title.
- **Library (0.1.0-alpha.7):**
  - Converts DOC, XLS/XLSX, PPT, ODT/ODS/ODP, RTF, EPUB, and CSV to searchable Markdown with AnyDoc.
  - Recognizes text in images, and in PDF pages without a text layer, with PaddleOCR PP-OCRv5 mobile running in a worker thread; the models and runtime are pinned by SHA-256.
  - Agents can call `document_to_markdown` and `document_ocr`. Everything runs offline.
- **Office (0.1.0-alpha.11):**
  - Adds the built-in `media-ffmpeg` skill for converting, compressing, losslessly trimming, joining, and inspecting audio and video. It uses the FFmpeg that the Desktop app bundles; on the Web, it uses `WORKDSH_FFMPEG`/`WORKDSH_FFPROBE` or FFmpeg on the Host's PATH.
  - Exported XLSX and PDF files name the white-label product as their creator.
- **Access, Skills, Projects:** use neutral wording where the product name appeared, so that white-label builds read correctly.

The release contains 12 WorkDSH packages, the install script, a manifest, and SHA-256 checksums. SkillHub and dsh-market are third-party services or plugins, and their catalog entries are neither bundled nor approved by WorkDSH. Check each item's license, dependencies, and DSH compatibility before you install it.

This is an Alpha release built on a DSH release candidate. Back up local profiles before you upgrade. The desktop installers are published separately as `desktop-v*` releases.
