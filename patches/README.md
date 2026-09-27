# 宿主侧补丁（平台侧）

本目录收录本插件在 DSH 宿主（平台）侧需要的补丁。它们不改插件自身行为，只把宿主已发布版本中会影响插件使用的问题修好；每条补丁都写清了目标包、目标版本、缺失时的症状与退场条件。

## 1. @deepseek-ai__dsh-session@0.1.7-alpha.2.patch

- 目标：`@deepseek-ai/dsh-session@0.1.7-alpha.2` 的 `lib/index.js` 与 `lib/types/index.d.ts`。
- 内容：让 `Session.append` 把调用方传入的 `ignorable` 一并写进 surface metadata。该版本只转发 `sourceEventSeqs` 与 `surfaceOp`，插件追加的 `token-usage/record` 因此无法被标记为可忽略。
- 缺失症状：插件写入的用量事件不带 `ignorable` 标记，宿主的一致性校验按普通事件对待，折叠或压缩过的历史会更严格。
- 应用方式：已由 `pnpm-workspace.yaml` 的 `patchedDependencies` 固定，`pnpm install` 时自动应用；本仓库的构建与测试都建立在该补丁之上，社区重建本仓库不需要额外操作。

## 2. harness/@deepseek-ai__dsh-session-format-v3-to-v4@0.1.7-rc.2.patch

- 目标：`packages/session/session-format-v3-to-v4/src/migration.ts`（源码部署），或已发布的 `@deepseek-ai/dsh-session-format-v3-to-v4@0.1.7-rc.2` 的 `lib/index.js`（打包部署，二者不是逐行对应）。
- 内容：v3→v4 迁移在关闭 step 边界时，为「已声明但从未启动」的工具调用补发中断结果、为「已启动但从未结算」的调用补发普通中断结果，并继续拒绝其他不一致；同时修正从工具来源读取工具结果 call id 的路径。
- 缺失症状：旧会话的 v3 日志若在工具调用过程中被中断（进程被杀、会话中断），迁移会拒绝整份产物，宿主报「历史加载失败：Session migration from v3 to v4 refuses the transformed artifact」，且不修改源日志——该会话完全打不开，其金额与用量也随之缺失。
- 影响版本：官方 `0.1.7-rc.2` 以及更早的 v3→v4 迁移实现（本轮核对到的 `official-alpha2/alpha3/alpha4` 均不含该修复）。
- 应用方式：
  - 源码部署：在 deepseek-harness 检出根目录执行 `git apply patches/harness/@deepseek-ai__dsh-session-format-v3-to-v4@0.1.7-rc.2.patch`，再按宿主自身流程重建 `@deepseek-ai/dsh-session-format-v3-to-v4`。补丁路径以仓库根为基准（`packages/session/...`），不用 `-p` 调整层级。
  - 打包部署：请不要把这份源码补丁直接打到 `node_modules` 的 `lib/index.js`；请升级到含该修复的宿主版本，或在该修复进入上游前避免让受影响的旧会话参与迁移。
  - 本机实装树已通过本地提交 `b0925a169d`（中断工具调用修复）与 `0db33ce6e8`（工具结果 call id）应用该修复，桌面端历史加载失败计数已归零。
- 核对方式：把本补丁反向应用到已修复的检出（`git apply --check --reverse`）可无冲突通过，说明补丁与已应用的修复逐字节一致。

## 维护约定

- 补丁只做定向适配，不扩大宿主行为改动；每条补丁必须写清目标版本、症状与退场条件（上游修复发布后即删除对应文件）。
- 命名沿用 `<包名>@<版本>.patch`；宿主源码补丁放在 `harness/` 子目录。
- `patches/**/*` 随 npm 包一起发布，便于使用者核对与自助修复。

