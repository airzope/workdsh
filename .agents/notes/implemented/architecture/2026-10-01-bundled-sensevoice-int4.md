# Agent Note: Bundled SenseVoiceSmall INT4 for offline voice input

Status: implemented

English | [中文](2026-10-01-bundled-sensevoice-int4.zh.md)

## Decision

DSH's local speech-to-text downloads SenseVoiceSmall INT8 (239 MB) on first use. Every Desktop installer now carries an INT4 version (155 MB) with its tokens and the Silero VAD in `workdsh-runtime/speech/sensevoice`, so Voice Input works offline with no download.

- **Weights:** the FP32 export that DSH 0.2.0-rc.1 pins (`model.onnx`, SHA-256 `977016bd…`), with every MatMul weight quantized by ONNX Runtime 1.23.2's `MatMulNBitsQuantizer`: 4 bits, blocks of 32, asymmetric, round-to-nearest (`scripts/sensevoice/quantize.py`). 99.6% of the parameters are MatMul weights. The model metadata that sherpa-onnx reads is unchanged. The result is byte-for-byte reproducible and pinned (SHA-256 `bd13a01e…`, 154,616,782 bytes).
- **Wiring:** the carrier passes `WORKDSH_SENSEVOICE_MODEL_DIR` and `WORKDSH_SENSEVOICE_VAD`. A row of the WorkDSH Profile sets the provider's `modelDirectory` and `vadModelPath` from them, restating the voice bundle's `dataRoot`, because a patch replaces the whole config. Without the variables, as on the Web, the provider downloads as before.
- **File name:** DSH names weights only by its `int8` and `fp32` choices and loads `model.int8.onnx` by default, so the INT4 file takes that name. `manifest.json` records the real precision. The plugin details therefore show "SenseVoiceSmall (INT8)".
- **Turning it on:** Voice Input stays an optional DSH bundle, turned on under Plugins. The carrier now keeps that choice across launches ([Settings Agent Note](2026-10-01-runtime-profile-patch-settings.md)).

## Evaluation

The same sherpa-onnx-node 1.13.8 that the app ships decoded 208 clips with each variant:

- 180 clips: 60 Chinese and 30 English sentences, synthesized by sherpa-onnx's `vits-melo-tts-zh_en` at two speeds, with known text;
- 28 clips: real recordings from sherpa-onnx's test sets (Mandarin, Sichuan, Henan and Tianjin dialects, LibriSpeech English, Korean, Japanese and Cantonese; three English recordings appear in three sets). These have no labels and are scored against FP32.

| Weights | Size | Chinese CER | English WER | Differs from FP32 | Load | Memory |
| --- | --- | --- | --- | --- | --- | --- |
| FP32 | 938 MB | 4.11% | 13.93% | — | 4.0 s | 1,502 MB |
| INT8 (DSH) | 239 MB | 4.22% | 13.80% | 1.9% of units, 43 clips | 21.0 s | 400 MB |
| **INT4, block 32, asymmetric (bundled)** | **155 MB** | **3.94%** | **14.19%** | 3.2%, 69 clips | 1.4 s | 310 MB |
| INT4, block 32, symmetric | 151 MB | 4.44% | 16.67% | 4.2%, 77 clips | — | — |
| INT4, block 64, asymmetric | 138 MB | 4.50% | 15.62% | 3.7%, 69 clips | 1.2 s | 294 MB |
| INT4, block 128, asymmetric | 130 MB | 4.50% | 18.10% | 4.8%, 88 clips | 0.9 s | 281 MB |
| INT4 block 64 with an 8-bit CTC layer | 145 MB | 4.33% | 15.76% | 3.5%, 65 clips | — | — |

The chosen variant matches FP32 and INT8 within this set's noise (about 2,000 Chinese characters). The English WER is high for every variant because the TTS voice reads English with an accent. All variants decode at about the same speed (real-time factor about 0.05 with 4 threads); load time and memory were measured on sherpa's five sample clips with 2 threads. Through the app, a fake microphone fed sherpa's Chinese and English sample clips into Voice Input. The English transcript equalled the file-based one; the Chinese one differed in one character, as the browser re-encodes the recording.

## Builds

`scripts/prepare-workdsh-speech.ts` keeps verified files in `build/.workdsh-speech-cache`:

- the INT4 weights, made when missing from the FP32 export;
- the tokens and VAD (from Hugging Face, or sherpa-onnx's GitHub releases, which hold the same bytes);
- the FunASR model license and Silero VAD license, pinned at commits.

The FP32 export comes from DSH's pinned Hugging Face URL, or from the sherpa-onnx release archive, verified against the same SHA-256. Quantizing needs Python 3.11 or 3.12 on Linux x64 with the hash-pinned wheels of `scripts/sensevoice/requirements.txt`. CI's `speech-model` job makes or restores the cache once per run and hands it to every packaging job as an artifact.

## Gates

- **Offline files:** the Linux, macOS and Windows 7 audits require the staged weights, tokens, VAD, manifest and license.
- **Smoke:** `scripts/smoke-speech.mjs` checks every file against `manifest.json`, loads the weights and VAD with the packaged sherpa-onnx and decodes a short signal. That proves the platform's ONNX Runtime runs the 4-bit kernels. It runs in the Ubuntu 20.04 and 24.04 containers, the macOS DMG smoke and the post-fuse Windows check.
- **Pins:** a unit test requires the source, tokens and VAD pins to equal those of the pinned DSH's `assets.json`.

## Limits

- The license requires keeping the source, author and model name; `README.md`, `THIRD_PARTY_NOTICES.md` and the model metadata do.
- The plugin details show INT8, as explained above, and DSH's "first use needs installing dependencies" note remains in the plugin list.
- A DSH upgrade that changes the SenseVoice export changes the pins; the INT4 weights must then be made and evaluated again.
