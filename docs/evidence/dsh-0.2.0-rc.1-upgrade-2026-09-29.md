# DSH 0.2.0-rc.1 升级记录

2026-09-29 把 Web 与 Desktop 从 DSH `0.1.7-rc.2` 升级到 `0.2.0-rc.1`（上游标签 `dsh-v0.2.0-rc.1`，提交 `4878cdab`）。这是预发布版本；按产品决定采用，以便尽早跟进上游。正式版发布后应升级到正式版。

## 变更

- **子模块与 `upstream.json`：**固定到 `4878cdabd87d4041bdaff61d04c966883b9fd07a`，并与 Desktop 行为变更分开提交。
- **精确依赖：**根 `package.json` 与 14 个包清单里的 `@deepseek-ai/*` 全部改为 `0.2.0-rc.1`。
- **新增覆盖项：**上游新增 5 个包，DSH 各包之间以精确版本互相引用，因此在 `pnpm.overrides` 中同样固定：
  - `dsh-client-product-analytics`
  - `dsh-client-ui-settings-session-log`
  - `dsh-experimental-schedule-bundle`
  - `dsh-host-product-telemetry-otel`
  - `dsh-otel`
- **打包脚本：**`check-published-versions`，以及 Project、Library、Office 三个发布包的 `harness` 字段。
- **Desktop Profile：**dshmarket 由 `1.66.1` 升到 `1.66.5`；`1.66.1` 的 peer 范围不包含 `0.2.0-rc.1`，`1.66.4` 起才包含。SkillHub `0.2.16` 对 `dsh-tools` 的 peer 范围为 `*`，无需变更。
- **版本：**Web 与插件升到 `0.1.0-alpha.16`，各发布包同步升一个 alpha 版本；Desktop 升到 `2.0.6-alpha.3`。

WorkDSH 源码使用的公开接口没有破坏性变化，本次无需修改插件代码。

## 遥测

0.2.0-rc.1 新增的产品分析组件（`product-analytics`、`desktop-product-telemetry`）仅在 Profile 名为 `desktop` 时加载。WorkDSH 使用 `workdsh` Profile，因此它们保持停用。

会话遥测与 0.1.7 相同，默认为 `FEEDBACK_ONLY`：只有用户主动提交反馈时才会上传；设置 `DSH_TELEMETRY_DISABLED` 可完全关闭。

## 验证

| 检查 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile`、`build`、`typecheck` | 通过 |
| `pnpm check:versions` | 565 个 DSH 锁定项均为 `0.2.0-rc.1`，Cordis 只有 `4.0.3` |
| `pnpm test:integration` | 119 项全部通过，含浏览器用例 |
| `corepack yarn check:desktop-dsh-alignment`、`check:web-dsh-alignment` | 通过 |
| `corepack yarn check` | 通过 |
| 本地发布包安装进 Desktop Profile | 通过：五个产品包、SkillHub 与 dshmarket 均加载；`dsh --version` 为 `0.2.0-rc.1` |

各平台的打包运行时检查由 CI 完成。
