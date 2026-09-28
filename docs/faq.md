# WorkDSH 常见问题

[English](faq.en.md)

## 这是 DeepSeek 官方产品吗？

不是。WorkDSH 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的独立社区项目，未获得官方背书。

## 支持哪些平台？

以 [GitHub Releases](https://github.com/techflag/workdsh/releases) 中实际附带的文件为准。当前打包目标是 Windows x64，以及分别提供的 macOS arm64、x64 版本；没有 Universal 或 Linux 安装包。Windows 7 SP1 x64 需借助 VxKex NEXT 运行，见下一节。

## 能在 Windows 7 上运行吗？

Windows 7 SP1 x64 可借助第三方兼容层 [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT)（[Gitee 镜像](https://gitee.com/YuZhouRen86/VxKex-NEXT)）运行，属于尽力支持：Electron、Node.js 和 Python 的官方发行版均已不支持 Windows 7。

1. 先安装 Service Pack 1、KB2533623 与 KB2670838 更新，再安装最新版 VxKex NEXT。
2. 运行同一个 Windows x64 Setup。安装程序检测到 Windows 7 后，通过 VxKex NEXT 的 `KexCfg.exe` 为 `WorkDSH.exe` 启用 VxKex NEXT，并保持子进程继承；未检测到 VxKex NEXT 时安装会停止并提示下载。升级保留该配置，卸载时移除。
3. WorkDSH 在 Windows 7 上为内置 Node.js 设置 `NODE_SKIP_PLATFORM_CHECK=1`，并关闭 GPU 硬件加速。

Portable ZIP 不经过安装程序：解压后右键单击 `WorkDSH.exe`，在“属性”>“VxKex”中勾选“为此程序启用 VxKex NEXT”，不要勾选“为子进程禁用 VxKex NEXT”。如果在 VxKex NEXT 中启用了强版本伪装导致 WorkDSH 识别不到 Windows 7，可设置环境变量 `WORKDSH_WINDOWS7_COMPAT=1`。Windows 8/8.1 与 32 位 Windows 不在支持范围内；在 Windows 7 上报告问题时请注明 VxKex NEXT 版本。

## 需要自己安装 Node.js、Python 或 DSH 吗？

普通用户不需要。安装包附带固定版本的运行时与 DSH Profile。开发者从源码构建时需要仓库要求的 Node.js 和包管理器。

## 是否修改了官方 Harness？

没有。仓库固定一个未修改的上游子模块。Electron 外壳启动该版本的 DSH Profile，WorkDSH 功能由 Profile 包组合。

## 数据与插件在哪里？

DSH home 位于本机应用数据目录。项目、资料库、专家、技能和连接器属于 WorkDSH Profile；市场与 Fabric 目前仅是设计文档。外部模型是否接收数据取决于用户的配置。

## 如何更新？

当前版本不提供自动更新管理器。到 [Releases](https://github.com/techflag/workdsh/releases) 手动下载新安装包；升级前备份重要数据。问题可在 [GitHub Issues](https://github.com/techflag/workdsh/issues) 报告。
