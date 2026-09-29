# Agent Note：内置 llama.cpp 服务，运行本地 GGUF 模型

Status: implemented

[English](2026-09-29-bundled-llama-cpp.md) | 中文

## Decision

每个 Desktop 安装包都在 `workdsh-runtime/llama` 中携带 llama.cpp `b11247` 的 `llama-server`。载体以路由模式运行它，服务用户数据中的模型文件夹。该文件夹中的每个 GGUF 文件都会成为 `llama-local` 路由的一个模型，在模型列表中显示为“本地模型 (llama.cpp)”。无需联网，也无需 API 密钥。

工作由两部分分担，因此没有另写一个模型客户端：

- **载体**（`src/llama.ts`）负责进程与安全：
  - 创建 `<userData>/models`，并放入中英双语的 `README.txt`；
  - 在 `127.0.0.1` 的空闲端口监听，每次启动生成新的 API 密钥；
  - 等待 `/health` 就绪后，才以 `WORKDSH_LLAMA_BASE_URL`、`WORKDSH_LLAMA_API_KEY`、`WORKDSH_LLAMA_MODELS_DIR` 和 `WORKDSH_LLAMA_CONTEXT_SIZE` 启动 DSH；
  - 退出时停止路由服务的整个进程组，模型进程随之停止；
  - 服务未能启动时，应用照常运行但没有本地模型，原因记录在 `<userData>/llama/server.log`。
- **WorkDSH Profile**（`workdsh-bundle/local-models`，仅在设置了 `WORKDSH_LLAMA_BASE_URL` 时启用）负责路由。它读取路由服务的 `GET /v1/models?reload=1`，通过 DSH 的 `settings` 服务写入 `llm-pi-ai` 设置中的 `providers.llama-local`。随后由 DSH 自带的 pi-ai 适配器处理 OpenAI 兼容协议。路由里只写密钥所在的环境变量名，不写密钥本身。

文件夹变化时插件立即重新扫描，并每 30 秒扫描一次作为兜底。文件夹为空时它删除该路由；只有它负责的字段变化时才改写设置。载体每次启动都会改写 Profile 的 `cordis.patch.yml`，插件会在几秒内恢复该路由。

## Server settings

- **工作目录：**服务在模型文件夹中运行，以 `--models-dir .` 服务该文件夹；预设文件路径在为 ASCII 时改用相对该文件夹的路径。llama.cpp 在 Windows 上通过 ANSI 代码页检查这些路径，因此非 ASCII 的绝对路径（例如以中文命名的用户目录）会找不到。模型进程继承该工作目录，Profile 按它解析路由服务列出的相对模型路径。
- **路由参数：**`--models-max 1`、`--sleep-idle-seconds 600`、`--no-webui` 与 `--offline`。模型在首次使用时加载，同一时间只加载一个，闲置十分钟后卸载。
- **密钥：**通过 `LLAMA_API_KEY` 传入。若改用 `--api-key`，路由服务启动的模型进程将不受保护。
- **上下文：**路由服务的模型进程不读取 `LLAMA_ARG_*` 变量，因此默认的 32K 上下文由生成的路由预设（`[*] c = 32768`）提供。用户的 `models/presets.ini` 会取代它。
- **上下文窗口：**llama.cpp 把每个槽位限制在模型的训练上下文内。插件上报 GGUF 头中 `<arch>.context_length` 与服务上下文中的较小值。
- **兼容设置：**关闭 `supportsStore`、`supportsDeveloperRole`、`supportsReasoningEffort` 与 `supportsStrictMode`，并使用 `max_tokens`。

## Builds

`scripts/prepare-workdsh-llama.ts` 只放入 `llama-server`、它的链接闭包（读取 PE 导入、ELF `DT_NEEDED` 与 Mach-O 加载命令），以及它在运行时加载的 ggml 后端，不含 RPC 后端。

| 目标 | 来源 | 加速 |
| --- | --- | --- |
| Windows x64 | 官方 Vulkan 归档，按 SHA-256 固定 | CPU 各变体；有驱动提供 `vulkan-1.dll` 时使用 Vulkan |
| macOS arm64 / x64 | 官方归档，按 SHA-256 固定；最低 macOS 13.3 | Metal / CPU |
| Ubuntu x64 / arm64 | 在 `ubuntu:20.04` 中用 focal 的 clang-12 从固定提交构建（`scripts/build-llama-linux.sh`），CI 中缓存 | CPU，全部变体 |

官方 Ubuntu 构建需要 glibc 2.34 与 OpenSSL 3，无法在 20.04 上运行。WorkDSH 的构建不含 OpenSSL、OpenMP 和网页界面。arm64 构建去掉了两个 SME 变体，因为 focal 的编译器都不支持 SME；这类 CPU 由 armv8.6 变体服务。

Windows 安装包不安装 VC++ 运行库，因此服务旁放有 14.44.35112 版的 `msvcp140.dll`、`vcruntime140.dll` 和 `vcruntime140_1.dll`。它们取自 `msvc-runtime` wheel，wheel 与每个 DLL 都按 SHA-256 固定。14.44 是支持 Windows 7 的最后一个版本。官方构建使用 14.5x 的 STL，其全部导入都能在 14.44 中解析，但这种搭配不属于微软支持的配置。

## Gates

- **离线文件：**Linux、macOS 与 Windows 7 审计都要求服务程序、清单和许可证。Windows 7 审计还要求上述运行库 DLL；它只把 `vulkan-1.dll` 作为 `llama/bin/ggml-vulkan.dll` 的导入接受——ggml 在运行时加载该后端，没有驱动时会跳过它。
- **既有检查：**glibc、`minos` 与 Windows 7 导入检查覆盖每个 llama 映像。
- **冒烟：**`scripts/smoke-llama.mjs` 生成一个 34 KB 的随机权重 GGUF（`scripts/tiny-gguf.mjs`），服务一个路径含中文和空格的文件夹。它检查密钥、启动后新增的模型，以及一次对话补全。Ubuntu 20.04 与 24.04 容器、macOS DMG 冒烟以及封装熔丝后的 Windows 检查都会运行它。
- **端到端（开发时已验证）：**在 DSH 0.2.0-rc.1 上，插件写入了该路由；运行中新增的文件几秒内出现；DSH headless 的一轮对话经该路由在 llama-server 上完成。

## Limits

- **Windows 7：**本地模型为尽力支持，因为上述 VC++ 搭配尚未在真实的 Windows 7 上运行过。
- **Windows 文件名：**Windows 上模型文件名与子文件夹名必须是 ASCII。llama.cpp 通过 ANSI 代码页列出它们，其他名称无法提供服务。模型文件夹中的说明与用户指南都写明了这一点。
- **Linux GPU：**Ubuntu 构建只用 CPU。Vulkan 需要比 focal 更新的着色器工具。
- **工具调用：**取决于各模型的对话模板。
- **升级：**标签、提交、归档哈希与许可证哈希必须一起更新；重新运行各审计，并在两种架构上构建 Linux 版本。
