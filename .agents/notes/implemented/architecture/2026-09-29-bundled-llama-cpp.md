# Agent Note: Bundled llama.cpp server for local GGUF models

Status: implemented

English | [中文](2026-09-29-bundled-llama-cpp.zh.md)

## Decision

Every Desktop installer carries the `llama-server` of llama.cpp `b11247` in `workdsh-runtime/llama`. The carrier runs it in router mode over a models folder in user data. Every GGUF file in that folder becomes a model of the `llama-local` route, which the model list shows as "本地模型 (llama.cpp)". No network access or API key is needed.

Two parts share the work, so no second model client is written:

- **The carrier** (`src/llama.ts`) owns the process and its security:
  - It creates `<userData>/models` with a bilingual `README.txt`.
  - It listens on `127.0.0.1` at a free port, with an API key generated per launch.
  - It waits for `/health`, then starts DSH with `WORKDSH_LLAMA_BASE_URL`, `WORKDSH_LLAMA_API_KEY`, `WORKDSH_LLAMA_MODELS_DIR` and `WORKDSH_LLAMA_CONTEXT_SIZE`.
  - On quit it stops the router's process group, so the model processes stop too.
  - If the server does not start, the app runs without local models, and `<userData>/llama/server.log` says why.
- **The WorkDSH Profile** (`workdsh-bundle/local-models`, enabled only when `WORKDSH_LLAMA_BASE_URL` is set) owns the route. It reads the router's `GET /v1/models?reload=1` and writes `providers.llama-local` in the `llm-pi-ai` settings section through DSH's `settings` service. DSH's own pi-ai adapter then speaks the OpenAI-compatible protocol. The route names the key's environment variable, never the key.

The plugin rescans when the folder changes, and every 30 s as a fallback. It removes the route when the folder is empty, and it rewrites settings only when a field it owns changes. The carrier rewrites the Profile's `cordis.patch.yml` at every launch, and the plugin restores the route within seconds.

## Server settings

- **Working folder:** the server runs in the models folder and serves it as `--models-dir .`, and gets the presets path relative to it when that is ASCII. On Windows, llama.cpp checks those paths through the ANSI code page, so a non-ASCII absolute path (a user profile named in Chinese, for example) is not found. Model processes inherit the folder, and the Profile resolves the relative model paths the router lists against it.
- **Router flags:** `--models-max 1`, `--sleep-idle-seconds 600`, `--no-webui` and `--offline`. Models load on first use, one at a time, and unload after ten idle minutes.
- **Key:** it is passed as `LLAMA_API_KEY`. With `--api-key`, the router's model processes would run unprotected.
- **Context:** router model processes ignore `LLAMA_ARG_*` variables, so the default 32K context comes from a generated router preset (`[*] c = 32768`). A user's `models/presets.ini` replaces it.
- **Context window:** llama.cpp caps each slot at the model's trained context. The plugin reports the smaller of the GGUF header's `<arch>.context_length` and the served size.
- **Compat:** `supportsStore`, `supportsDeveloperRole`, `supportsReasoningEffort` and `supportsStrictMode` are off, and `max_tokens` is used.

## Builds

`scripts/prepare-workdsh-llama.ts` stages only `llama-server`, its link closure (read from PE imports, ELF `DT_NEEDED` and Mach-O load commands) and the ggml backends it loads at run time. The RPC backend is left out.

| Target | Source | Acceleration |
| --- | --- | --- |
| Windows x64 | Official Vulkan archive, pinned by SHA-256 | CPU variants; Vulkan where a driver provides `vulkan-1.dll` |
| macOS arm64 / x64 | Official archives, pinned by SHA-256; minimum macOS 13.3 | Metal / CPU |
| Ubuntu x64 / arm64 | Built from the pinned commit in `ubuntu:20.04` with focal's clang-12 (`scripts/build-llama-linux.sh`), cached in CI | CPU, all variants |

The official Ubuntu builds need glibc 2.34 and OpenSSL 3, so they cannot run on 20.04. The WorkDSH build has no OpenSSL, OpenMP or web UI. On arm64 it drops the two SME variants, which no focal compiler supports; the armv8.6 variant serves those CPUs.

The Windows installer does not install the VC++ runtime, so `msvcp140.dll`, `vcruntime140.dll` and `vcruntime140_1.dll` 14.44.35112 sit next to the server. They come from the `msvc-runtime` wheel, and the wheel and each DLL are pinned by SHA-256. 14.44 is the last release that supports Windows 7. The official build uses the 14.5x STL, and all of its imports resolve against 14.44, but that pairing is not a supported Microsoft configuration.

## Gates

- **Offline files:** the Linux, macOS and Windows 7 audits require the server, its manifest and license. The Windows 7 audit also requires the runtime DLLs. It accepts `vulkan-1.dll` only as an import of `llama/bin/ggml-vulkan.dll`, which ggml loads at run time and skips without a driver.
- **Existing checks:** the glibc, `minos` and Windows 7 import checks cover every llama image.
- **Smoke:** `scripts/smoke-llama.mjs` generates a 34 KB random-weight GGUF (`scripts/tiny-gguf.mjs`) and serves a folder whose path has Chinese and a space. It checks the key, a model added after start, and a chat completion. The Ubuntu 20.04 and 24.04 containers, the macOS DMG smoke and the post-fuse Windows check run it.
- **End to end (verified during development):** with DSH 0.2.0-rc.1, the plugin wrote the route; files added while running appeared within seconds; and a DSH headless turn ran through the route to llama-server.

## Limits

- **Windows 7:** local models are best effort, because the VC++ pairing above has not run on real Windows 7.
- **Windows file names:** model file and subfolder names must be ASCII on Windows. llama.cpp lists them through the ANSI code page, so other names cannot be served. The README in the folder and the user guide say so.
- **GPU on Linux:** the Ubuntu builds use the CPU only. Vulkan needs newer shader tools than focal provides.
- **Tool calls:** they depend on each model's chat template.
- **Upgrades:** change the tag, commit, archive hashes and license hashes together. Re-run the audits, and build Linux on both architectures.
