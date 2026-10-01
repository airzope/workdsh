# Agent Note：设置与组合包选择在运行时 Profile 中跨启动保留

Status: implemented

[English](2026-10-01-runtime-profile-patch-settings.md) | 中文

## Decision

DSH 把每一项设置改动保存在当前 Profile 的 `cordis.patch.yml` 中：默认模型、模型提供商路由、设置页中的字段以及已确认的提示。在 WorkDSH Desktop 中，这个文件同时承载载体从内置 Profile 安装的 WorkDSH 组合。直到 Desktop 2.0.6-alpha.3，载体每次启动都用内置文件覆盖它，因此所有设置改动在下次启动时都会丢失。

现在载体只负责该文件中内置的部分（`src/profile-patch.ts`）：

- 把安装的内置文件记录为 patch 旁边的 `.workdsh-bundled-cordis.patch.yml`；
- 内置文件未变时，不改动 patch；
- 内置文件变化而用户的 patch 未改动时，安装新文件；
- 两者都变化时，以新的内置文件为基础，追加用户自己的行：按 id 指定条目、不插入任何内容、既不是新内置文件中的行、也不是旧内置文件中未改动的行的顶层行。DSH 的配置编辑器为下层声明的条目追加的正是这类行。原来的 patch 保存为 `cordis.patch.yml.before-update`；
- 无法拆分为顶层块状行的 patch 由内置文件替换，同样保留备份。

早期版本的 Profile 没有内置文件的记录。新版本首次启动时按同样的方式合并，因此更新前最后一次会话中保存的设置得以保留。

“插件”页通过修改 Profile `package.json` 中的 `dsh.profile.bundles` 来开启或关闭可选组合包（例如语音输入），而载体以前同样在每次启动时覆盖这个文件。`src/profile-manifest.ts` 以同样的方式处理它：把内置文件记录为 `.workdsh-bundled-package.json`，内置文件未变时不改动 Profile 中的文件；更新时采用新的内置文件，加入用户添加的组合包，去掉用户移除的组合包。没有记录时，保留新增的组合包，不移除任何组合包。

## Constraints

- 用户在内置文件拥有的行中所做的改动（例如 WorkDSH Profile 插入的插件的配置）保留到内置文件下次更新为止，之后被替换；备份中仍有这些改动。
- 带过来的行如果指向新组合中已不存在的条目，DSH 只给出警告，不会启动失败。
- 拆分基于文本，因此带过来的行中的注释和 `!!js` 表达式原样保留。只接受块状列表和空列表 `[]`。

## Verification

`tests/profile-patch.spec.ts` 与 `tests/profile-manifest.spec.ts` 覆盖拆分、有无记录时的合并、安装、未变化的启动、更新以及替换无法读取的文件。在已放置的 Profile 上，无头运行确认了欢迎提示并选择了本地默认模型；重启后 patch 报告为未变化，提示仍为已确认，默认模型也保持不变。把 alpha.16 的内置 patch 与 DSH 改写过的 patch 合并时，保留了提示确认的那一行。在“插件”页开启的语音输入在重启后仍然开启，其麦克风通过内置的 SenseVoice 权重完成识别。
