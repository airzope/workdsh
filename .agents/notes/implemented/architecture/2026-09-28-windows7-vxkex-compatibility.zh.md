# Agent Note：借助 VxKex NEXT 支持 Windows 7 x64

状态：已实现

[English](2026-09-28-windows7-vxkex-compatibility.md) | 中文

## 决策

WorkDSH 借助第三方兼容层 [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT) 尽力支持 Windows 7 SP1 x64。Windows 7 与其他 Windows 主机使用同一个 x64 NSIS 安装包、外壳源码、Electron 版本和运行时 Profile，不另设构建或发布通道。Electron 43、内置 Node.js 24 与 Python 3.12 都导入了 Windows 7 缺少的 API；VxKex NEXT 通过映像文件执行选项（IFEO）按可执行文件提供这些 API，并传播到子进程。

## 安装程序

在 NT 6.1（`IsWin7` 或 `IsWin2008R2`）上，安装程序在 64 位注册表视图中读取 `HKLM\Software\VXsoft\VxKex` 的 `KexDir`。若其中没有 `KexCfg.exe`，安装以退出码 2 停止，并提供 VxKex NEXT 下载页。否则运行 `KexCfg.exe /EXE:"<INSTDIR>\WorkDSH.exe" /ENABLE:1 /DISABLEFORCHILD:0 /DISABLEAPPSPECIFIC:0`。KexCfg 是 VxKex 支持的配置接口：它为这一确切路径创建 `UseFilter` 与 `FilterFullPath` 子键，已提权时直接写入，否则通过 VxKex 的 SYSTEM 提权计划任务写入，因此按用户安装无需 UAC 提示。

子进程传播和应用专用修复始终开启。渲染进程、Node.js、Python 和 pnpm 都是 `WorkDSH.exe` 的子进程；VxKex 通过导出函数识别 Chromium 与 Node，并为其应用 kernel32 版本伪装和 Windows 10 DirectWrite 实现。Windows 版本伪装仍由用户决定。

提权计划任务异步生效，因此安装程序最多轮询 IFEO 子键 10 秒，并同时检查 `FilterFullPath` 与 `FLG_APPLICATION_VERIFIER`。若注册始终未出现，安装程序显示手动启用说明，但仍完成安装。卸载时以全默认参数调用 KexCfg 删除配置，但仅在注册存在时执行；升级（`--updated`）时从不删除，否则会与新安装程序的注册发生竞争。

## 外壳运行时策略

`src/windows7-compatibility.ts` 依据 `os.release()` 识别 NT 6.1。VxKex NEXT 不为 Chromium 和 Node 进程伪装 PEB 版本，因此除非用户启用强版本伪装，该值保持真实。`WORKDSH_WINDOWS7_COMPAT=1` 或 `0` 可覆盖检测结果。在 Windows 7 上，外壳会：

- 在启动 DSH Host 前，于自身环境中设置 `NODE_SKIP_PLATFORM_CHECK=1`。Node.js 20 及以上版本在低于 Windows 10 的系统上缺少该变量会直接退出，而 VxKex 不伪装 Node 检查的版本。所有运行时子进程都会继承该变量。
- 调用 `app.disableHardwareAcceleration()`。Windows 7 没有 DirectComposition，当前 Chromium 不再测试其 Windows 7 GPU 路径，而 GPU 进程反复失败会终止 Electron。

渲染进程沙箱保持开启；VxKex NEXT 只为 32 位 Chromium 添加 `--no-sandbox`。

## 限制与验证边界

受支持的主机是已安装 KB2533623、KB2670838 和最新版 VxKex NEXT 的 Windows 7 SP1 x64。Windows 8/8.1、32 位 Windows 以及未安装 VxKex 的主机不在此策略范围内。Portable ZIP 不经过安装程序，用户需在 `WorkDSH.exe` 的“属性”>“VxKex”选项卡中启用 VxKex。以清空环境的方式启动 Node.js 的工具不会继承 `NODE_SKIP_PLATFORM_CHECK`，在 Windows 7 上会失败；这属于上游工具的问题。

VxKex NEXT 的兼容性列表验证过 Chromium 132 与 VS Code 1.96（Electron 32）；Electron 43 比其中任何已验证条目都新。安装程序逻辑已在配置为 Windows 7 和 Windows 10 的 Wine 中，配合替身 `KexCfg.exe` 运行过以下场景：未安装 VxKex、注册与校验、注册始终未出现、升级和卸载。在真实 Windows 7 SP1 x64 机器上配合 VxKex NEXT 启动打包应用，仍与其他 Windows 界面检查一样，属于原生发布门槛。
