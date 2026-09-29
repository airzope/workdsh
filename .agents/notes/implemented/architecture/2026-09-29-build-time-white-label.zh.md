# Agent Note：构建时白牌

Status: implemented

[English](2026-09-29-build-time-white-label.md) | 中文

## Decision

品牌目录（`brand.json`、正方形 `logo.png`、可选 `mark.svg`）在构建载体时决定 Desktop 产品的名称、标识与图标。`dsh-plugin-desktop/branding/workdsh/` 是默认品牌，也就是 `package.json` 中的取值；`WORKDSH_BRAND` 选择其他目录。安装后的应用不读取外部品牌文件，因此构建完成的包不能被改名，固定版本的 DSH 运行时也保持不变。

## Flow

1. `yarn build` 首先运行 `scripts/generate-brand.ts`。它用 `scripts/brand.ts` 校验品牌，并写入 `build/brand/`：`app-icon.png`、带精确 DPI 帧的 Windows ICO、带内边距的 macOS 图标、托盘位图、标志，以及包含品牌名称与标识的 `brand.json`。WorkDSH 品牌生成的每个文件与此前提交在 `build/` 下的图标逐字节一致。
2. 打包脚本（`package-linux`、`package-mac`、`release-mac`、`package-win`、`package-win7`、`package-dir`）读取生成的 `build/brand/brand.json`，而不是环境变量，并且只在品牌与 WorkDSH 不同时追加 electron-builder 覆盖项：`productName`、产物名称、NSIS 快捷方式与卸载项名称、`CFBundleDisplayName`、Linux 桌面项名称、`appId`、Linux 可执行文件与 Debian 包名、维护者、版权与描述。校验脚本按品牌的 `fileName` 查找产物。因此一次构建只会以一个品牌打包。
3. 载体从归档中读取 `build/brand/brand.json`，设置窗口标题与图标、`app.setName(name)`，并把 `userData` 固定为 `<appData>/<dataDirectory>`。它向运行时传入 `WORKDSH_BRAND_NAME` 与 `WORKDSH_BRAND_MARK`；标志路径指向 `app.asar.unpacked`，因为内置 Node.js 不能读取归档内部。缺少品牌文件、窗口图标或解包后的标志时，`afterPack` 会失败。
4. 在 Profile 中，`workdsh-bundle` 在 `/api/workdsh-brand` 提供 `{ name, mark }`（标志为 SVG 或 PNG data URL，最大 256 KiB），并在浏览器提示词中使用产品名。客户端据此填充 DSH 的 `sidebar.brand.name`、`sidebar.brand.mark` 插槽和页面标题，并按来源记住上次的品牌，避免白牌窗口先闪现 WorkDSH。Office 插件把品牌写为导出 XLSX 和 PDF 的创建者。没有这些变量时（例如普通 Web 部署），一切仍为 WorkDSH。

## Constraints

- `fileName` 会成为安装目录、应用包、可执行文件和产物名称，因此只能是不含空格的 ASCII；显示名称 `name` 可以使用任意语言。
- 不同的 `appId` 会并存安装。更换 `appId` 或 `dataDirectory` 不会迁移已有用户数据。
- 自定义 logo 可以是至少 512 像素的任意正方形 PNG。标志必须把颜色写在 `fill`/`stroke` 属性中；托盘变体会把颜色替换为黑色（模板图标）或品牌 `color`。
- 内置技能、专家与提示词文本、诊断页以及上游 DSH 界面保持原有措辞。项目、技能与工作台面板和访问拒绝原因中的产品名已改为中性措辞。
- CI 工作流在手动运行时接受 `brand` 输入；推送和 `desktop-v*` 标签只构建 WorkDSH。正式发布仍是来自 `main` 的 WorkDSH 产物。

## Verification

`tests/brand.spec.ts` 覆盖校验、目录选择、覆盖项列表、无标志品牌的生成文件以及运行时辅助函数。Linux 打包测试在生成的自定义品牌下构建，载体测试覆盖打包品牌检查。`packages/bundle/tests/brand.test.mjs` 覆盖 Host 路由及其输入限制。用示例品牌在本地运行 `electron-builder --linux dir`，得到了 `acmedesk`、解包后的标志，打包品牌检查通过。
