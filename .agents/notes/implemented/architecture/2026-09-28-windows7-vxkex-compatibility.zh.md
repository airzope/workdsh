# Agent Note：借助 VxKex NEXT 支持 Windows 7 x64

状态：已实现

[English](2026-09-28-windows7-vxkex-compatibility.md) | 中文

## 决策

WorkDSH 借助第三方兼容层 [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT) 尽力支持 Windows 7 SP1 x64。Windows 7 与其他 Windows 主机使用同一套外壳源码、Electron 版本和运行时 Profile。Electron 43、内置 Node.js 24、Python 3.12 与 LibreOffice Kit 引擎都导入了 Windows 7 缺少的 API；VxKex NEXT 通过映像文件执行选项（IFEO）按可执行文件提供这些 API，并传播到子进程。

两个安装包封装同一个 `dist/win-unpacked` 目录。标准 x64 Setup 要求事先装好 VxKex NEXT。Windows 7 x64 离线安装包（`WorkDSH-<版本>-win7-x64-Offline-Setup.exe`）另外携带固定版本的 VxKex NEXT 安装程序和 Microsoft VC++ 可再发行组件包，因此安装无需联网。它由同一份源码和同一个 DSH 版本构建，不是另一个版本线。

## 离线安装包

`scripts/package-win7.ts` 在标准 Windows 包之后运行。它先审计 `dist/win-unpacked`（见下文），再从 VxKex NEXT 发布页下载 `KexSetup_Release_1_2_3_2463.exe` 并只接受固定的 SHA-256；然后从 Microsoft 带版本号的地址下载 `VC_redist.x64.exe` 14.44.35211，只接受该地址中嵌入的 SHA-256。该版本是 Visual Studio 2022 系列的最后一版；Visual Studio 2026 附带的 14.50+ 系列要求 Windows 10，因此构建机自带的 Visual Studio 无法提供它。也可以用 `WORKDSH_WIN7_VC_REDIST` 指定一个经 Authenticode 校验的、Microsoft 签名的 14.29-14.4x 可再发行组件包。二者的路径和版本写入 `build/.win7/offline-payload.nsh`。electron-builder 随后以 `--prepackaged` 和 `build/installer-win7.nsh` 把已验证的应用封装到 `dist/win7`。一个范围收窄的 afterAll 钩子在那里重新检查可执行文件的 fuse，因为标准构建已对同一目录运行过打包运行时冒烟检查。

在 NT 6.1 上，离线安装包在 `System32\msvcp140_2.dll` 缺失或旧于内置版本时安装 VC++ 运行库，在 `KexCfg.exe` 缺失或 `InstalledVersion` 旧于 1.2.3.2463 时安装 VxKex NEXT。二者都经 UAC `runas` 动词静默运行，事后依据文件与注册表而非退出码核实结果。Office 引擎导入 `msvcp140*.dll` 却不自带它，而 VxKex NEXT 会有意重写 `System32` 中新版 VC++ 运行库的导入。

VxKex NEXT 没有发布许可证，并包含取自新版 Windows 的 DLL。内置它是明确的产品决定，依赖其作者的许可；THIRD_PARTY_NOTICES 记录了这一义务。

## 注册

在 NT 6.1（`IsWin7` 或 `IsWin2008R2`）上，安装程序在 64 位注册表视图中读取 `HKLM\Software\VXsoft\VxKex` 的 `KexDir`。未装 VxKex NEXT 时，标准安装包以退出码 2 停止并提供下载页。否则运行 `KexCfg.exe /EXE:"<INSTDIR>\WorkDSH.exe" /ENABLE:1 /DISABLEFORCHILD:0 /DISABLEAPPSPECIFIC:0`。KexCfg 是 VxKex 支持的配置接口：它为这一确切路径写入 `UseFilter` 与 `FilterFullPath` 子键，已提权时直接写入，否则通过 VxKex 的 SYSTEM 提权计划任务写入。子进程传播和应用专用修复始终开启，因为渲染进程、Node.js、Python、pnpm 与 Office 引擎都是 `WorkDSH.exe` 的子进程，VxKex 依据导出函数为 Chromium 与 Node 应用修复。版本伪装仍由用户决定。

提权计划任务异步生效，因此安装程序最多轮询 IFEO 子键 10 秒，并检查 `FilterFullPath` 与 `FLG_APPLICATION_VERIFIER`。注册始终未出现时给出手动启用说明。卸载仅在注册存在时删除配置；升级（`--updated`）时从不删除，否则会与新注册竞争。

最后，安装程序列出它不能代为分发的缺失 Windows 前置条件：Service Pack 1、KB2533623（`kernel32!AddDllDirectory`）、KB2670838（`dxgi.dll` 6.2）、Windows Management Framework 5.1，以及标准安装包缺少的 VC++ 运行库。DSH 的 PowerShell 执行器为每条命令加上 `[System.Text.UTF8Encoding]::new(...)` 前缀，这需要 PowerShell 5；Windows 7 自带 2.0。VxKex NEXT 自己的前置条件对话框在静默模式下不会运行。

## 外壳运行时策略

`src/windows7-compatibility.ts` 依据 `os.release()` 识别 NT 6.1。VxKex NEXT 不为 Chromium 和 Node 进程伪装 PEB 版本，因此除非用户启用强版本伪装，该值保持真实；`WORKDSH_WINDOWS7_COMPAT=1` 或 `0` 可覆盖检测结果。在 Windows 7 上，外壳在启动 DSH Host 前于自身环境设置 `NODE_SKIP_PLATFORM_CHECK=1`，因为 Node.js 20 及以上版本在低于 Windows 10 的系统上缺少该变量会直接退出。它还调用 `app.disableHardwareAcceleration()`：Windows 7 没有 DirectComposition，而 GPU 进程反复失败会终止 Electron。浏览器 worker 是同一个可执行文件，采用同一策略。渲染进程沙箱保持开启。

## 兼容性审计

`scripts/windows7-payload-audit.ts` 是离线安装包的门槛。它要求离线内容齐全：Node.js、pnpm、带 Office 库的 Python、三个 Office 技能及检查器、Office 技能与 LibreOffice Kit 包及其 `bin/libreoffice-kit.exe` 引擎、DSH Profile，以及包缓存。它解析每个 x64 PE 映像的静态导入表，要求每个被导入的 DLL 要么随载荷提供，要么由 VC++ 运行库提供，要么由 VxKex NEXT 1.2.3.2463 重写或提供，要么存在于装有 Platform Update 的 Windows 7 SP1 中。延迟加载的导入在使用时解析，不在检查范围内。对固定版本的 Electron 43.3.0、Node.js 24.21.0、Python 3.12.14 及其 wheels、LibreOffice Kit 0.1.2 Windows 二进制运行审计，143 个 x64 映像全部解析成功。CI 报告 `desktop-windows7-audit` 覆盖完整 Profile，包括原生 Node 插件。

审计检查的是 DLL 名称而非单个函数；缺失函数由 VxKex NEXT 负责实现。其兼容性列表验证过 Chromium 132 与 VS Code 1.96（Electron 32），都比 Electron 43 旧。

## 验证边界

安装程序逻辑已在配置为 Windows 7 和 Windows 10 的 Wine 中运行，并使用替身 `KexCfg.exe`、KexSetup 与 `vc_redist.x64.exe`。覆盖场景包括：未装 VxKex、安装内置 VxKex、VxKex 版本相同/较旧/较新、VC++ 运行库版本比较、注册及其 10 秒核实、升级、卸载与前置条件检测。真实的 KexSetup 无法在 Wine 中运行。在真实 Windows 7 SP1 x64 机器上启动打包应用，仍与其他 Windows 界面检查一样，属于原生发布门槛。Windows 8/8.1 与 32 位 Windows 不在此策略范围内。以清空环境的方式启动 Node.js 的工具不会继承 `NODE_SKIP_PLATFORM_CHECK`；这属于上游工具的问题。
