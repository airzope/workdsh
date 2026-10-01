# Agent Note：内置 SenseVoiceSmall INT4，离线语音输入

Status: implemented

[English](2026-10-01-bundled-sensevoice-int4.md) | 中文

## Decision

DSH 的本地语音转文字在首次使用时下载 SenseVoiceSmall INT8（239 MB）。现在每个 Desktop 安装包都在 `workdsh-runtime/speech/sensevoice` 中携带 INT4 版本（155 MB）及其词表和 Silero VAD，因此语音输入无需下载、可离线使用。

- **权重：**DSH 0.2.0-rc.1 所固定的 FP32 导出（`model.onnx`，SHA-256 `977016bd…`），其中每个 MatMul 权重都由 ONNX Runtime 1.23.2 的 `MatMulNBitsQuantizer` 量化：4 位、每块 32 个、非对称、就近取整（`scripts/sensevoice/quantize.py`）。99.6% 的参数是 MatMul 权重。sherpa-onnx 读取的模型元数据保持不变。结果逐字节可复现，并已固定（SHA-256 `bd13a01e…`，154,616,782 字节）。
- **接入：**载体传入 `WORKDSH_SENSEVOICE_MODEL_DIR` 与 `WORKDSH_SENSEVOICE_VAD`。WorkDSH Profile 中的一行据此设置提供者的 `modelDirectory` 与 `vadModelPath`，并重述语音组合包的 `dataRoot`，因为 patch 会替换整个配置。没有这两个变量时（例如 Web 部署），提供者仍照常下载。
- **文件名：**DSH 只按 `int8` 和 `fp32` 两种选择命名权重，默认加载 `model.int8.onnx`，因此 INT4 文件沿用这个名字。`manifest.json` 记录真实精度。插件详情因此显示“SenseVoiceSmall (INT8)”。
- **开启：**语音输入仍是 DSH 的可选组合包，在“插件”中开启。载体现在会在多次启动之间保留这个选择（[设置的 Agent Note](2026-10-01-runtime-profile-patch-settings.zh.md)）。

## Evaluation

用应用自带的同一个 sherpa-onnx-node 1.13.8，以各个版本识别 208 段音频：

- 180 段：用 sherpa-onnx 的 `vits-melo-tts-zh_en` 以两种语速合成的 60 句中文和 30 句英文，文本已知；
- 28 段：sherpa-onnx 测试集中的真实录音（普通话，四川、河南、天津方言，LibriSpeech 英语，韩语、日语和粤语；其中三段英语录音出现在三个测试集中）。这些录音没有标注，以 FP32 的结果为参照。

| 权重 | 大小 | 中文 CER | 英文 WER | 与 FP32 的差异 | 加载 | 内存 |
| --- | --- | --- | --- | --- | --- | --- |
| FP32 | 938 MB | 4.11% | 13.93% | — | 4.0 秒 | 1,502 MB |
| INT8（DSH） | 239 MB | 4.22% | 13.80% | 1.9% 的单位，43 段 | 21.0 秒 | 400 MB |
| **INT4，块 32，非对称（内置）** | **155 MB** | **3.94%** | **14.19%** | 3.2%，69 段 | 1.4 秒 | 310 MB |
| INT4，块 32，对称 | 151 MB | 4.44% | 16.67% | 4.2%，77 段 | — | — |
| INT4，块 64，非对称 | 138 MB | 4.50% | 15.62% | 3.7%，69 段 | 1.2 秒 | 294 MB |
| INT4，块 128，非对称 | 130 MB | 4.50% | 18.10% | 4.8%，88 段 | 0.9 秒 | 281 MB |
| INT4 块 64，CTC 层 8 位 | 145 MB | 4.33% | 15.76% | 3.5%，65 段 | — | — |

在这组数据的噪声范围内（约 2,000 个中文字），所选版本与 FP32 和 INT8 相当。各版本的英文 WER 都偏高，是因为合成语音读英文带口音。各版本识别速度相近（4 线程下实时率约 0.05）；加载时间与内存在 sherpa 的五段示例音频上以 2 线程测得。在应用中，用虚拟麦克风把 sherpa 的中文和英文示例音频输入语音输入：英文结果与按文件识别的结果相同；中文结果相差一个字，因为浏览器会重新编码录音。

## Builds

`scripts/prepare-workdsh-speech.ts` 在 `build/.workdsh-speech-cache` 中保存校验过的文件：

- INT4 权重，缺失时从 FP32 导出生成；
- 词表与 VAD（来自 Hugging Face，或保存着相同字节的 sherpa-onnx GitHub 发布）；
- 按提交固定的 FunASR 模型许可证和 Silero VAD 许可证。

FP32 导出来自 DSH 固定的 Hugging Face 地址，或 sherpa-onnx 的发布归档，均按同一 SHA-256 校验。量化需要 Linux x64 上的 Python 3.11 或 3.12，以及 `scripts/sensevoice/requirements.txt` 中按哈希固定的 wheel。CI 的 `speech-model` 作业在每次运行中生成或恢复一次缓存，并以 artifact 交给各打包作业。

## Gates

- **离线文件：**Linux、macOS 与 Windows 7 审计都要求所放置的权重、词表、VAD、清单和许可证存在。
- **冒烟：**`scripts/smoke-speech.mjs` 按 `manifest.json` 检查每个文件，用打包的 sherpa-onnx 加载权重和 VAD，并识别一小段信号，以证明该平台的 ONNX Runtime 能运行 4 位内核。Ubuntu 20.04 与 24.04 容器、macOS DMG 冒烟以及封装熔丝后的 Windows 检查都会运行它。
- **固定值：**单元测试要求来源、词表和 VAD 的固定值与所固定 DSH 的 `assets.json` 一致。

## Limits

- 许可证要求保留来源、作者和模型名称；`README.md`、`THIRD_PARTY_NOTICES.md` 和模型元数据都保留了。
- 如上所述，插件详情显示 INT8；插件列表中仍有 DSH 的“首次使用需安装依赖”说明。
- 若 DSH 升级后改用新的 SenseVoice 导出，固定值随之改变，需要重新生成并评估 INT4 权重。
