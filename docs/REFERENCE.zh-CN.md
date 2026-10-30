# 高级参考

[返回 README](../README.md) · [English](REFERENCE.en.md)

本文保留高级配置、接口与旧版恢复步骤。常规安装和功能说明见 README；这些操作不要求普通用户逐项执行。

## 价格与历史计费

内置 DeepSeek 价格按北京时间的生效日期分段：2026-08-17 之前为旧统一价，之后至 2026-09-10 12:00 为旧峰谷价，再之后为当前价格。2026-09-25 起法定节假日全天按谷价；周末含调休上班日全天按谷价。V4 Pro 保留 Pro 价格，不按 Flash 价格回退。

自定义 `priceTable` 取代 2026-08-17 及之后的默认规则，更早调用仍按官方旧统一价；修改后重启宿主加载。已写入的 usage 账本不会随规则更新被重写。价格依据：[官方模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。

## 余额脚本

为第三方供应商写一小段 JavaScript 描述余额接口（请求路径、方法、鉴权方式，以及如何处理返回的 JSON），在沙箱里校验通过后，悬浮卡即可显示该供应商的余额。脚本可返回可选的 `windows` 数组（`label` + `used`/`remaining`/`percent` + `total`，`resetAt` 支持 epoch 毫秒或 ISO 字符串，最多 8 项），悬浮卡会逐窗口显示「剩余/共」，额度型供应商（`currency` 不是三位货币代码，如默认 `credits`）只显示窗口、不再显示余额数字；有 `windows` 时 `currency` 与 `totalBalance` 可省略，默认 `credits` 与首个窗口的剩余量。脚本也可以返回可选的 `display` 字符串（去除首尾空白后最多 48 个字符），存在时悬浮卡用它整段替代「货币符号 + 金额」，适合百分比或组合额度等非货币形态。清空脚本并保存即删除该供应商的自定义脚本：已知网关（DeepSeek、fastaitoken、GLM Coding Plan）会自动回落到内置适配器，其余供应商进入「未配置」状态；`DELETE /api/token-monitor/balance-script?provider=<id>&expectedRevision=<n>` 提供同等的删除入口。

## 动画比例

鲸鱼娘与扣血反馈共用后台配置 `animationScale`，默认 `0.8`（卡片宽度的 80%），允许 `0.5`–`1` 的数字。卡片宽度变化时两者同比缩放，角色保持原宽高比；此项没有新增前端设置控件。旧配置未写此字段时使用 80%，已明确写入的自定义值会保留。

可直接请模型：“将 dsh-damage-pulse 的全局 animationScale 改为 0.65，保留其他设置，并验证保存后读回。”模型应通过当前桌面应用已认证的 `GET /api/token-monitor/settings` 读取 `revision`，再向同一路径发送 `PATCH`，正文为 `{"expectedRevision":读取到的revision,"patch":{"animationScale":0.65}}`；不要添加 `provider` 参数，比例属于全局设置。接口沿用宿主鉴权与 profile 配置持久化，保存后应再 GET 核对；409 冲突时重新读取后重试。切回应用会触发刷新，应用活动时最迟约 5 秒生效，重启后保留。恢复默认使用同一路径将值设回 `0.8`。无法访问认证接口时，模型应先核对宿主当前配置入口，不猜测 profile 路径或覆盖整份配置。

## HTTP 端点

| 端点 | 说明 |
|---|---|
| `GET /api/token-monitor/balance` | DeepSeek 账户余额（含 currency / 总余额 / 赠送余额） |
| `GET /api/token-monitor/usage?sessionId=` | 用量明细历史（可过滤会话） |
| `GET /api/token-monitor/usage-summary?range=` | 今日 / 7 天 / 30 天 / 全部时间的聚合统计 |
| `GET /api/token-monitor/charge-events?since=<seq>` | 严格递增的扣费事件流，驱动余额变化、飘字和受击动画 |
| `GET /api/token-monitor/notification-events?since=<seq>` | 预算、峰谷和缓存异常通知流 |
| `GET/PATCH /api/token-monitor/settings` | 带 revision 的统一设置读取与更新 |
| `GET /api/token-monitor/wechat/status` | 查询微信连接、认证、投递和短时登录会话状态；设置页“刷新”会重新请求此端点 |
| `POST /api/token-monitor/wechat/login` | 创建二维码登录会话 |
| `POST /api/token-monitor/wechat/login/confirm` | 确认当前二维码登录状态 |
| `POST /api/token-monitor/wechat/reconnect` | 重连由 DSH Host 管理的微信 bridge |
| `POST /api/token-monitor/wechat/disconnect` | 经显式确认后断开由 DSH Host 管理的微信 bridge |
| `POST /api/token-monitor/wechat/test` | 发送独立测试消息，不受业务微信通知总开关限制 |
| `GET/POST /api/token-monitor/update*` | Release 检查与受安全门禁保护的安装流程 |

## 微信通知兼容层

插件内置一个不注册 Cordis 工具的轻量 ClawBot 适配器，并按以下优先级选择通知 provider：宿主提供的 wechatNotify 发送服务及 wechatConnection 连接服务 → 内置适配器 → 不可用。两类能力分别选择，服务晚加载时自动复用；每次发送只会调用一个 provider；微信未登录、超时或发送失败不会阻塞余额监控、计费和鲸鱼娘动画。

如果用户已经安装独立 dsh-wechat-notify，本插件会复用它的发送能力；未安装时，只要设置 `WECHAT_NOTIFY_CLAWBOT_INDEX`，内置适配器即可开箱发送。该变量必须指向本机 ClawBot CLI 的入口文件，例如：

```powershell
$env:WECHAT_NOTIFY_CLAWBOT_INDEX = 'C:\path\to\clawbot-cli\dist\index.js'
dsh --profile web
```

兼容层不迁移或删除原插件凭据，也不会重复注册 wechat_notify、扫码工具或 bridge。旧版接口若只能发送，状态面板会明确标注“发送可用，登录管理由原插件负责”。

## 安装恢复

出错时还要留意第二种表现：如果宿主装了「启动失败隔离」类插件（例如第三方插件控制台），它可能把这条 loader 报错自动写进 profile 的 `cordis.patch.yml`：

```yaml
- id: dsh-token-monitor
  disabled: true
```

这种情况下插件只是从「启动时报错」变成「界面上不出现」，很容易被误判成没装上。改用包含 runtime 的正式预编译包安装后，记得删掉这段（或在插件管理界面点启用），否则装好了也不会挂载。

安装后重启**实际安装的那个 profile**。web 端：

```powershell
dsh --profile web
```

桌面端在界面里重启，或运行（把 `desktop` 换成你实际的 profile 名）：

```powershell
dsh --profile desktop
```

标准包提供余额悬浮栏、余额实时扣减、缓存命中/未命中动画、单次用量行和输入区会话累计。升级自早期源码集成版时，请移除原有手工 `--patch` 或重复挂载项，避免同一插件加载两次。

正常升级保留设置、usage.jsonl 账本与模块卸载状态。变更版本前备份 profile 与插件数据，降级不保证撤销迁移。整体卸载后要恢复，请从桌面插件页移除仍列出的条目，再添加完整包并重启；不要删除账本、清除卸载标记或绕过摘要校验。

### 原生会话金额（标准包能力）

会话金额属于标准包能力，标准包开箱即可提供，无需手工改宿主源码：

- **官方会话头席位**（`conversation.session.header.actions`）：0.1.5-alpha 与 rc.7 的会话头都声明该席位，标准包把金额徽标注册到会话标题旁的操作区；`sessionId` 与 `useSessions` 由宿主标准 props 提供，不改任何宿主文件，也无需重建 bundle。
- **兼容宿主侧栏尾席位**（`sidebar.workspaces.sessionRow.trailing`）：该席位由本机侧边栏补丁宿主自行声明，上游 0.1.3 / 0.1.5 都未提供。标准包只在宿主声明后追加注册，会话行在时间前显示金额；未声明时保持等待，不注册也不报错。
- **旧版 / 社区自行打包或定制客户端**（既无官方会话头席位，也无侧栏尾席位）：标准包内置严格 fail-closed 的兼容桥，只在能对原生会话行做唯一、无歧义匹配时显示金额；一旦检测到宿主已带正式席位标记、稳定会话标识或既有金额，立即整体停用，不会重复写入。
- **输入区会话累计条** 行为不变，上述所有客户端下都可用。

`scripts/apply-sidebar-integration.ps1` 保留为完整 DSH 源码部署的开发/历史兼容工具；标准包已自动显示金额时无需运行。如需在完整 DSH 源码上手工挂载，运行：

```powershell
.\scripts\apply-sidebar-integration.ps1 -HarnessRoot 'C:\path\to\deepseek-harness'
$env:DSH_BUILD_FACE = 'client'
corepack pnpm --dir 'C:\path\to\deepseek-harness\packages\client\ui-workspace' exec tsdown
```

脚本会先备份三个目标文件，并以幂等方式读取 `projectionValues.tokenCost.cost`。上游结构不匹配时会停止，不会猜测写入。

### 宿主侧补丁（平台侧）

`patches/` 收录本插件在 DSH 宿主侧需要的补丁，随 npm 包一起发布，目标版本、症状与完整应用步骤见 [补丁说明](../patches/README.md)：

- `@deepseek-ai/dsh-session@0.1.7-alpha.2`：让 `Session.append` 转发 `ignorable`，插件写入的用量行才能被标记为可忽略。本仓库的 `patchedDependencies` 会在安装时自动应用，社区重建本仓库不需要额外操作。
- `@deepseek-ai/dsh-session-format-v3-to-v4@0.1.7-rc.2`：修复「会话在工具调用过程中被中断」的旧日志无法迁移的问题。缺少该补丁时，这类会话会被整份拒绝迁移并报「历史加载失败」，源日志保持不动，会话完全打不开，其金额与用量也随之缺失；官方 `0.1.7-rc.2` 及更早的 v3→v4 迁移都不含该修复，源码部署可按 [补丁说明](../patches/README.md) 直接 `git apply` 后重建该包。

### 源码开发

```powershell
corepack pnpm install
corepack pnpm build
corepack pnpm run check:bundle
```

## 架构

> 项目公开品牌为 `dsh-damage-pulse`。为兼容已安装用户，下列目录名、包名、API 路径、设置命名空间和本地存储键仍沿用 `dsh-token-monitor` / `token-monitor`，无需迁移已有配置与历史数据。

| 部分 | 位置 | 职责 |
|---|---|---|
| Host 插件 | `plugins/dsh-token-monitor` | 计费资格、价格计算、持久账本、余额、统计、预算/峰谷/缓存提醒、微信与更新 API |
| Client 包 | `packages/client/ui-token-monitor` | 单次用量、会话累计、余额悬浮卡、鲸鱼娘动画、通知气泡和详细设置 |
| 微信能力 | `plugins/wechat-notify` / ClawBot | 连接状态、登录管理与消息投递；不可用时不会阻塞计费和余额监控 |
