# 白牌构建

[English](white-label.en.md)

WorkDSH Desktop 的产品名称、图标和标识在**构建时**由一个品牌目录决定。同一份源码和固定的 DSH 版本可以构建出不同品牌的安装包；安装后的应用不读取外部品牌配置。

## 品牌目录

默认品牌在 `dsh-plugin-desktop/branding/workdsh/`。新品牌复制这个目录后修改：

```text
dsh-plugin-desktop/branding/acme/
├── brand.json
├── logo.png     # 正方形 PNG，至少 512 像素，建议 1024 像素
└── mark.svg     # 可选：简化标志，用于小尺寸图标、托盘、侧栏和对话首页
```

`brand.json` 示例：

```json
{
  "name": "智办助手",
  "fileName": "AcmeDesk",
  "executableName": "acmedesk",
  "appId": "com.acme.desk",
  "publisher": "Acme Ltd",
  "support": "https://acme.example/support",
  "summary": "Acme office workspace",
  "description": "Acme desktop workspace",
  "dataDirectory": "AcmeDesk",
  "logo": "logo.png",
  "mark": "mark.svg",
  "color": "#148C5A"
}
```

| 字段 | 作用 | 规则 |
| --- | --- | --- |
| `name` | 显示名称：窗口标题、快捷方式、开始菜单、卸载项、macOS 显示名、Linux 桌面项、侧栏品牌和网页标题 | 任意语言，最长 128 字符 |
| `fileName` | 应用包、可执行文件、安装目录和安装包文件名 | 英文字母、数字、`.`、`_`、`-`，不含空格 |
| `executableName` | Linux 命令和 Debian 包名 | 小写字母、数字、`.`、`+`、`-` |
| `appId` | 应用标识；不同标识会作为独立应用并存安装 | 反向域名，如 `com.acme.desk` |
| `publisher`、`support` | Linux 维护者字段、版权和作者信息 | `support` 为 http(s) 地址 |
| `summary`、`description` | Linux 摘要和应用描述 | 单行文本 |
| `dataDirectory` | 用户数据目录名（位于系统应用数据目录下） | 同 `fileName`；省略时等于 `fileName` |
| `logo` | 应用图标来源 | 正方形 PNG，至少 512 像素 |
| `mark` | 简化标志 | SVG，颜色写在 `fill`/`stroke` 属性中，不使用 `<style>` 或 `style` |
| `color` | 单色托盘图标的颜色 | `#RRGGBB`；省略时保留标志原色 |

没有 `mark` 时，小尺寸图标、侧栏和对话首页使用 `logo`，托盘模板图标取 `logo` 的轮廓。

## 构建

在仓库根目录设置 `WORKDSH_BRAND`（品牌目录或其 `brand.json`，相对路径以仓库根目录为准），然后按平台正常构建：

```sh
export WORKDSH_BRAND=dsh-plugin-desktop/branding/acme
corepack yarn build
corepack yarn workspace dsh-plugin-desktop dist:linux   # 或 dist:win、dist:mac-smoke、dist:win7
```

`corepack yarn build` 运行 `scripts/generate-brand.ts`，把所有图标、托盘位图、标志和品牌字段写入 `dsh-plugin-desktop/build/brand/`。打包脚本和校验脚本读取这里生成的品牌，而不是再次读取环境变量，因此一次构建只会以一个品牌打包。整个构建和打包过程请使用同一个 `WORKDSH_BRAND`。

也可以在 GitHub Actions 中手动运行 CI 工作流，在 `brand` 输入框填写已提交的品牌目录，得到该品牌的测试安装包。推送和发布标签始终构建 WorkDSH。

## 品牌覆盖的范围

- 安装包和应用：Windows 安装包、便携包和 Windows 7 离线安装包的文件名，`AcmeDesk.exe`，安装目录，桌面与开始菜单快捷方式，卸载项名称和图标；macOS 的 `AcmeDesk.app`、Dock 图标和显示名；Linux 的 `/opt/AcmeDesk`、`acmedesk` 命令、Debian 包名和桌面项。
- 运行时：窗口标题和图标、用户数据目录、侧栏品牌名称与标志、对话首页的标志、网页标题、浏览器提示词中的产品名，以及导出的 XLSX 和 PDF 的创建者。
- Web 部署：Host 读取 `WORKDSH_BRAND_NAME` 和 `WORKDSH_BRAND_MARK`（标志文件路径，SVG 或 PNG，最大 256 KiB），在 `/api/workdsh-brand` 提供给界面。Desktop 载体会自动设置这两个变量。

## 限制

- 内置技能、专家、Agent 提示词和诊断页中的 WorkDSH 字样保持不变；DeepSeek Harness 上游界面不做修改。
- 更换 `appId` 或 `dataDirectory` 后，应用不会读取原品牌的用户数据。
- 白牌包同样未签名，安装说明见[常见问题](faq.md)。Windows 7 离线安装包内置 VxKex NEXT，分发前请确认相应授权；使用第三方名称和标志前请确认拥有相应权利。
- 仓库的正式发布只从 `main` 构建 WorkDSH 品牌；白牌构建用于自行分发。
