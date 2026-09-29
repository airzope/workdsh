# Third-party notices

WorkDSH Desktop contains Electron and a pinned DeepSeek Harness runtime Profile.
The official DeepSeek Harness version is recorded in the repository's
[`upstream.json`](../upstream.json); the installed app's `workdsh-runtime` directory
contains the actual Profile package manifests and applicable license files.

DeepSeek Harness is distributed under the MIT License. Its version-specific
third-party notices are maintained by the upstream project:
<https://github.com/deepseek-ai/deepseek-harness/blob/master/THIRD_PARTY_NOTICES.md>.
WorkDSH bundles and their dependencies retain their own license terms, which
must be checked from the exact release artifacts used for an installer.

The Desktop Profile bundles two separate third-party plugins:

- [`@cocofhu/skillhub`](https://www.npmjs.com/package/@cocofhu/skillhub)
  version 0.2.16 for SkillHub integration. Source and MIT license:
  <https://github.com/cocofhu/skillhub>.
- [`dshmarket`](https://www.npmjs.com/package/dshmarket) version 1.66.5 for
  DSH community plugin discovery. Source and MIT license:
  <https://github.com/dsh-market/dsh-market>.

The SkillHub catalog and API are maintained separately by
[`Tencent/skillhub`](https://github.com/Tencent/skillhub). The plugin catalog
used by dshmarket is maintained by
[`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).

The Windows 7 x64 offline installer additionally carries two unmodified
installers, which it runs only on Windows 7 when the component is missing or
older:

- [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT) 1.2.3.2463
  (`KexSetup_Release_1_2_3_2463.exe`, SHA-256
  `757fb01cf38daa38c6e2db542169554117c533921e5edc119a567bfbe18566af`). The
  upstream repository publishes no license; redistributing it relies on
  permission from its authors, which the WorkDSH maintainers are responsible
  for holding. VxKex NEXT contains DLLs taken from newer Windows releases and
  remains subject to its authors' and Microsoft's terms.
- The Microsoft Visual C++ 2015-2022 Redistributable (x64) 14.44.35211
  (`VC_redist.x64.exe`, SHA-256
  `cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b`),
  distributed under the Microsoft Software License Terms for Visual Studio.

The Library plugin in every package converts documents and recognizes text
offline with:

- [AnyDoc](https://github.com/firecrawl/anydoc) (`@firecrawl/anydoc` 0.2.4 and
  its per-platform native package), MIT License. Only local conversion is used;
  its hosted OCR option is never enabled.
- The PP-OCRv5 mobile text detection and recognition models and dictionary from
  [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), Apache License 2.0,
  as converted to ONNX by [eSearch-OCR](https://github.com/xushengfeng/eSearch-OCR)
  (Apache License 2.0), pinned by SHA-256.
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.30.0 (its Node
  entry and one WebAssembly build) and `onnxruntime-common`, MIT License.
- [utif2](https://github.com/photopea/UTIF.js) for TIFF images, MIT License.

The Library's `resources/ocr/NOTICE.md` records the exact files.

The Ubuntu x64 package replaces one file of the Profile's
[`sherpa-onnx-linux-x64`](https://www.npmjs.com/package/sherpa-onnx-linux-x64)
1.13.8 package, which DSH uses for local SenseVoice speech-to-text:
`sherpa-onnx.node` is compiled from the unmodified sources of
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) at commit
`11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf` (tag `v1.13.8`, Apache License 2.0)
on Ubuntu 20.04, so that it runs with glibc 2.31. It links the package's own
`libsherpa-onnx-c-api.so`, which is shipped unchanged.

Every installer includes `workdsh-runtime/media/bin/ffmpeg` and `ffprobe`:
[FFmpeg](https://ffmpeg.org/) 8.1.2 as built by
[shaka-project/static-ffmpeg-binaries](https://github.com/shaka-project/static-ffmpeg-binaries)
`n8.1.2-1` (build scripts under the Apache License 2.0), with x264, x265,
libvpx, SVT-AV1, Opus, LAME and Mbed TLS. The executables are licensed under
the **GNU General Public License version 3 or later**; WorkDSH runs them as
separate programs and does not link to them. The same directory contains the
license text (`COPYING.GPLv3`) and `SOURCES.md`, which lists the exact
upstream source of every component. Each Desktop release attaches
`ffmpeg-8.1.2-corresponding-source.tar.gz`, which
`scripts/pack-ffmpeg-sources.ts` assembles from exactly those sources.

Every installer includes `workdsh-runtime/llama`: the `llama-server` of
[llama.cpp](https://github.com/ggml-org/llama.cpp) `b11247` (commit
`0bc845d356f437d5ce4fe975c36428f7522829cb`) with the ggml libraries it loads,
MIT License. It also contains, each under the license text shipped next to it:

- [cpp-httplib](https://github.com/yhirose/cpp-httplib), MIT License;
- [nlohmann/json](https://github.com/nlohmann/json), MIT License;
- [xxHash](https://github.com/Cyan4973/xxHash), BSD 2-Clause License;
- the rotate-bits header (MIT License) and the public-domain SHA-1 and SHA-256
  code in llama.cpp's `vendor/hash`;
- [stb_image](https://github.com/nothings/stb), [miniaudio](https://github.com/mackron/miniaudio)
  and [subprocess.h](https://github.com/sheredom/subprocess.h), public domain.

The Windows and macOS builds are llama.cpp's official release archives. They
also link BoringSSL (OpenSSL and ISC licenses) and embed llama.cpp's web UI,
which WorkDSH does not serve (`--no-webui`). The Windows build is the Vulkan
build and carries the LLVM OpenMP runtime `libomp.dll` (Apache License 2.0 with
LLVM Exceptions, `LICENSE-LLVM-OpenMP`). Next to it are `msvcp140.dll`,
`vcruntime140.dll` and `vcruntime140_1.dll` 14.44.35112, unmodified Microsoft
Visual C++ runtime files redistributed under the Microsoft Software License
Terms for Visual Studio, taken from the `msvc-runtime` 14.44.35112 wheel and
pinned by SHA-256. The Ubuntu builds are compiled by WorkDSH from the same
commit in `ubuntu:20.04` (`scripts/build-llama-linux.sh`) without OpenSSL,
OpenMP or the web UI.

This file intentionally does not freeze a dependency inventory from an older
DSH release. Check the bundled Profile and its license files when publishing.
