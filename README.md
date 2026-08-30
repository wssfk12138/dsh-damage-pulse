# dsh-damage-pulse

<p align="center">
  <img src="docs/assets/dsh-damage-pulse-peak-valley-whale-poster.png" alt="dsh-damage-pulse 实时用量、鲸鱼娘、提醒规则、微信通知与安全更新功能总览" width="100%">
</p>

<p align="center">
  <a href="https://linux.do/t/topic/2773449" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/LINUX-DO-FFB003.svg?logo=data:image/svg%2bxml;base64,DQo8c3ZnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiPjxwYXRoIGQ9Ik00Ni44Mi0uMDU1aDYuMjVxMjMuOTY5IDIuMDYyIDM4IDIxLjQyNmM1LjI1OCA3LjY3NiA4LjIxNSAxNi4xNTYgOC44NzUgMjUuNDV2Ni4yNXEtMi4wNjQgMjMuOTY4LTIxLjQzIDM4LTExLjUxMiA3Ljg4NS0yNS40NDUgOC44NzRoLTYuMjVxLTIzLjk3LTIuMDY0LTM4LjAwNC0yMS40M1EuOTcxIDY3LjA1Ni0uMDU0IDUzLjE4di02LjQ3M0MxLjM2MiAzMC43ODEgOC41MDMgMTguMTQ4IDIxLjM3IDguODE3IDI5LjA0NyAzLjU2MiAzNy41MjcuNjA0IDQ2LjgyMS0uMDU2IiBzdHlsZT0ic3Ryb2tlOm5vbmU7ZmlsbC1ydWxlOmV2ZW5vZGQ7ZmlsbDojZWNlY2VjO2ZpbGwtb3BhY2l0eToxIi8+PHBhdGggZD0iTTQ3LjI2NiAyLjk1N3EyMi41My0uNjUgMzcuNzc3IDE1LjczOGE0OS43IDQ5LjcgMCAwIDEgNi44NjcgMTAuMTU3cS00MS45NjQuMjIyLTgzLjkzIDAgOS43NS0xOC42MTYgMzAuMDI0LTI0LjM4N2E2MSA2MSAwIDAgMSA5LjI2Mi0xLjUwOCIgc3R5bGU9InN0cm9rZTpub25lO2ZpbGwtcnVsZTpldmVub2RkO2ZpbGw6IzE5MTkxOTtmaWxsLW9wYWNpdHk6MSIvPjxwYXRoIGQ9Ik03Ljk4IDcwLjkyNmMyNy45NzctLjAzNSA1NS45NTQgMCA4My45My4xMTNRODMuNDI2IDg3LjQ3MyA2Ni4xMyA5NC4wODZxLTE4LjgxIDYuNTQ0LTM2LjgzMi0xLjg5OC0xNC4yMDMtNy4wOS0yMS4zMTctMjEuMjYyIiBzdHlsZT0ic3Ryb2tlOm5vbmU7ZmlsbC1ydWxlOmV2ZW5vZGQ7ZmlsbDojZjlhZjAwO2ZpbGwtb3BhY2l0eToxIi8+PC9zdmc+" alt="LINUX DO 社区认可"></a>
  <a href="#sponsor"><img src="https://img.shields.io/badge/FastAI-%E6%A8%A1%E5%9E%8B%E8%B5%9E%E5%8A%A9%E5%95%86-4F7CFF.svg?logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAABYlAAAWJQFJUiTwAAABmUlEQVRYw%2B2Vv0tbURTHP%2BfmvcS8lx%2BYKrZ16modFbQiKrgWuujQpZtgqV3s0rGT4N9Q6NJBM0nWUoe6uSj4BxQKUnBSSPISk3tPB1%2BhS42JFqHcD1wuXM79fs89HM4Fj8fjuWdk4Jubl9PEUiEC4nSV0r0cQATkgBIHjEvzbzLBIN7mrd11JVkBoJgeZgSMghGw%2Bjv0kHEzc61W3%2B7r3Zcuk5oDNP8oogKamlvp0O6u95LrrwKvtYDRbQRoiSWrX7DawoniABVQFVTbtOwn5rJHd5uA7c6SMd8QA44aH8zO%2FTThG30sea1qzCMKQCFtwBJIkZ8ayxJT0rmJ1EBNSKAf1fCMDCAComn5QRP7noWgc2OpnhFrGrKM45in1NsJJtxgSBYIFIQGqidYFIslcXs8D6p9vaVnxESjwlk8ghAR5baARbKaJycK3Re8C7%2FepgeuT6CaPMENhZzbScZkngszSaB5ALLuM5u3M%2B89B1bz36%2FMkn0i84BRflDGMkyN0Gz8%2B1FcrT%2Fkst3EVoq8klP%2Fc3k8Hs9%2FyS8IrHi9DaVvuAAAAABJRU5ErkJggg%3D%3D" alt="FastAI 模型赞助商"></a>
</p>

`dsh-damage-pulse` 是为 DSH（DeepSeek Harness）打造的 DeepSeek 用量、消费与余额监控插件。它按照官方计费规则记录每次调用，通过单次、会话和全局三个层级呈现 Token 与费用，并用鲸鱼娘的动态反馈把抽象的模型消耗变成一眼就能看懂的变化。

> 如果你正在寻找稳定、实惠的 AI 模型中转服务，可以试试 [FastAiToken](https://www.fastaitoken.com/register?aff=BF9KNKFHX725)，也可以先阅读[中转站新手帮助文档](https://github.com/wssfk12138/fastaitoken-beginner-guide)了解中转站、倍率、计费和使用方式。你在 FastAiToken 中的每一笔消费都会让作者获得一定数量的返利，我会把它转化为 Token，继续开发更多新项目并上传至 GitHub。当前所有项目均使用了 FastAiToken 提供的 5.6 Sol 模型参与开发。**注册后点击右上角用户头像前往QQ客服群@群主可领3刀试用金（需提供用户id，暗号：GitHub来的）。** <a href="https://www.fastaitoken.com/register?aff=BF9KNKFHX725" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/FastAI-%E7%82%B9%E5%87%BB%E6%B3%A8%E5%86%8C-4F7CFF.svg?logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAABYlAAAWJQFJUiTwAAABmUlEQVRYw%2B2Vv0tbURTHP%2BfmvcS8lx%2BYKrZ16modFbQiKrgWuujQpZtgqV3s0rGT4N9Q6NJBM0nWUoe6uSj4BxQKUnBSSPISk3tPB1%2BhS42JFqHcD1wuXM79fs89HM4Fj8fjuWdk4Jubl9PEUiEC4nSV0r0cQATkgBIHjEvzbzLBIN7mrd11JVkBoJgeZgSMghGw%2Bjv0kHEzc61W3%2B7r3Zcuk5oDNP8oogKamlvp0O6u95LrrwKvtYDRbQRoiSWrX7DawoniABVQFVTbtOwn5rJHd5uA7c6SMd8QA44aH8zO%2FTThG30sea1qzCMKQCFtwBJIkZ8ayxJT0rmJ1EBNSKAf1fCMDCAComn5QRP7noWgc2OpnhFrGrKM45in1NsJJtxgSBYIFIQGqidYFIslcXs8D6p9vaVnxESjwlk8ghAR5baARbKaJycK3Re8C7%2FepgeuT6CaPMENhZzbScZkngszSaB5ALLuM5u3M%2B89B1bz36%2FMkn0i84BRflDGMkyN0Gz8%2B1FcrT%2Fkst3EVoq8klP%2Fc3k8Hs9%2FyS8IrHi9DaVvuAAAAABJRU5ErkJggg%3D%3D" alt="fastai 点击注册"></a>

## 功能总览

| 能力 | 你能看到什么 |
|---|---|
| 精准计费 | 按 provider、model、缓存类型和北京时间峰谷价格计算每次真实费用 |
| 三层用量展示 | 对话内单次明细、输入区会话累计、全局账户余额悬浮卡 |
| 历史统计 | 今日、近 7 天、近 30 天和全部历史的消费、请求与 Token 概览 |
| 余额与峰谷监控 | 官方余额定时校准、实时扣减、充值恢复及峰谷状态提示 |
| 鲸鱼娘动态反馈 | 待机、眨眼、扣费受击、缓存未命中、余额耗尽与充值复活 |
| 主动提醒 | 每日预算、峰谷切换、缓存命中异常和鲸鱼娘通知气泡 |
| 微信通知 | 在详细设置中登录、管理 ClawBot，并接收少女风业务提醒 |
| 安全更新 | 检查 GitHub Release，验证版本、来源与 SHA-256 后再安装 |

### 精准计费与持久账本

- 同时依据 provider 与 model 判断计费资格，未知或不合格模型不会套用默认价格。
- 分别统计未缓存输入、缓存读取、缓存写入和输出，并按调用发生时的北京时间选择峰价或谷价。
- 视觉模型直接使用 DeepSeek 返回的 usage 数据，不对图片 Token 重复估算。
- 合格调用写入本地持久账本；重启后可恢复历史统计和会话摘要，零成本记录不会污染账本。
- 使用 `sessionId + sourceEventSeq` 保证事件幂等，避免重放导致重复扣费。

### 三层用量与历史统计

- **单次用量行**：每次模型调用结束，在对话流中显示输入、缓存、输出、思考 Token 和精确金额。
- **会话累计条**：输入区持续显示当前会话累计 Token 与费用。
- **全局悬浮卡**：跨会话持续显示 DeepSeek 账户余额；今日消费与历史范围统计集中在详细设置概览中。
- **统计概览**：支持今日、近 7 天、近 30 天和全部时间，汇总消费金额、请求数、Token 总数、缓存命中 Token、缓存命中率和活跃天数。
- **中文大数单位**：概览按“万、千万、亿、万亿”逐级显示，千万级数字不再折算成两位数的“百万”；舍入跨越边界时会自动提升单位。

### 余额、峰谷与悬浮交互

- 查询 DeepSeek 官方余额并每 60 秒校准；扣费事件到达时先逐笔更新显示余额，充值后以绿色反馈恢复金额。
- 余额查询失败或缺少 API Key 时显示明确状态；本地账本统计的今日消费不依赖余额接口成功。
- 峰谷标识每 30 秒刷新，峰时使用红色、谷时使用绿色提示。
- 悬浮卡支持鼠标拖动、键盘移动、视口边界限制和位置记忆；右键可隐藏鲸鱼娘或打开详细设置。

## 鲸鱼娘

鲸鱼娘是趴在余额悬浮卡上的桌面伙伴。她会用待机和眨眼动作陪你等待，并根据普通扣费、缓存未命中、连续消费、余额耗尽与充值恢复呈现不同反馈。扣费金额按事件顺序排队飘字，不同费用类型使用不同颜色与反馈强度；普通扣费保持轻量，不会频繁弹出气泡打扰工作。

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/assets/readme/whale-girl-idle-bite-finger.png" alt="鲸鱼娘啃手指待机原画" width="260"><br>
      <sub><b>等待任务时：啃手指待机</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/assets/readme/whale-girl-critical-damage.png" alt="鲸鱼娘严重扣费原画" width="260"><br>
      <sub><b>缓存未命中时：严重扣费反应</b></sub>
    </td>
  </tr>
</table>

## 提醒与微信通知

- **每日预算**：设置当日预算金额，首次越过预算线时提醒；提醒不会阻止、取消或限流模型请求。
- **峰谷切换**：进入峰时和进入谷时可分别启用提醒，同一价格边界不会重复通知。
- **缓存异常**：可设置缓存命中率阈值与连续异常次数，恢复后再次异常仍可重新提醒。
- **鲸鱼娘气泡**：只承载预算越线、峰谷切换和缓存异常等需要关注的事件，可独立关闭。
- **ClawBot 微信通知**：在详细设置中查看连接、认证与投递状态，完成二维码登录、刷新、重连、安全断开和测试消息发送。
- **少女风文案**：通道测试、预算越线、进入峰时、进入谷时和缓存异常均使用 `dsh-damage-pulse` 标准项目名；Star 邀请只出现在测试消息中。
- 所有业务通知开关默认关闭；旧配置从 v0、v1、v2、v3 迁移且缺少通知字段时，也会保守补为关闭。发送测试消息是独立的通道验证，不受业务微信通知总开关限制。

<p align="center">
  <img src="docs/assets/readme/dsh-damage-pulse-wechat-live.jpg" alt="dsh-damage-pulse 通过 ClawBot 发送的微信通知实机截图" width="520">
</p>

## 详细设置与安全更新

插件提供蓝粉双色的响应式详细设置面板，集中展示今日消费与历史统计，并可配置鲸鱼娘、每日预算、峰谷提醒、缓存异常、气泡和微信通知。设置更新使用 revision 防止多个页面互相覆盖，并兼容旧字段迁移。

更新面板可以打开项目主页、检查最新 Release、比较版本并下载安装包。安装前会校验 Release/tag 版本、资产名称、下载来源、重定向域名和 SHA-256，且只有识别到可安装 profile 时才执行安装。

## 架构

> 项目公开品牌为 `dsh-damage-pulse`。为兼容已安装用户，下列目录名、包名、API 路径、设置命名空间和本地存储键仍沿用 `dsh-token-monitor` / `token-monitor`，无需迁移已有配置与历史数据。

| 部分 | 位置 | 职责 |
|---|---|---|
| Host 插件 | `plugins/dsh-token-monitor` | 计费资格、价格计算、持久账本、余额、统计、预算/峰谷/缓存提醒、微信与更新 API |
| Client 包 | `packages/client/ui-token-monitor` | 单次用量、会话累计、余额悬浮卡、鲸鱼娘动画、通知气泡和详细设置 |
| 微信能力 | `plugins/wechat-notify` / ClawBot | 连接状态、登录管理与消息投递；不可用时不会阻塞计费和余额监控 |

## 安装

本仓库从 `0.2.0` 起提供标准 DSH Host + Client 组合包和预编译产物。`4.0.3` 明确兼容 DSH Desktop `2.0.4`（DSH `0.1.2-alpha.1`），并继续支持 `0.1.0-rc.5` 之后的旧版兼容宿主（含 `0.1.0-rc.6/rc.7/rc.8` 与 `0.1.1-rc.2`）。无需复制源码、修改 DSH `tsconfig`、手动传入 `--patch` 或重建 Client bundle。

Desktop `2.0.4` 不再提供旧的 `@deepseek-ai/dsh-client-runtime` 模块；`4.0.3` 已将该包从产品 peer 与 Client 注入图中移除，仅在开发环境保留旧宿主回归测试。

旧版或社区自行打包的 DSH 客户端应在其现有项目中沿用宿主自身的 lock 文件和依赖版本安装本插件。不要在一个新建的纯 npm 依赖树中把 rc.5/rc.6/rc.7 宿主包与当前 registry 的 rc.8 上游包混合钉定；这种组合会因上游 peer 版本漂移而解析失败，并不表示插件与原宿主不兼容。

```powershell
dsh plugin --profile web add github:wssfk12138/dsh-damage-pulse
```

安装后重启 Web profile：

```powershell
dsh --profile web
```

标准包提供余额悬浮栏、余额实时扣减、缓存命中/未命中动画、单次用量行和输入区会话累计。升级自早期源码集成版时，请移除原有手工 `--patch` 或重复挂载项，避免同一插件加载两次。

### 原生侧边栏会话金额（标准包能力）

左侧原生会话行金额属于标准包能力，标准包开箱即可提供，无需手工改宿主源码：

- **新宿主**（声明 `sidebar.workspaces.sessionRow.trailing` 原生席位）：标准包注册正式尾部席位，会话行在时间前显示金额，不修改任何宿主文件，也无需重建 bundle。
- **旧版 / 社区自行打包或定制客户端**（没有该席位）：标准包内置严格 fail-closed 的兼容桥，只在能对原生会话行做唯一、无歧义匹配时显示金额；一旦检测到宿主已带正式席位标记、稳定会话标识或既有金额，立即整体停用，不会重复写入。
- **输入区会话累计条** 行为不变，上述两种客户端下都可用。

`scripts/apply-sidebar-integration.ps1` 保留为完整 DSH 源码部署的开发/历史兼容工具；标准包已自动显示金额时无需运行。如需在完整 DSH 源码上手工挂载，运行：

```powershell
.\scripts\apply-sidebar-integration.ps1 -HarnessRoot 'C:\path\to\deepseek-harness'
$env:DSH_BUILD_FACE = 'client'
corepack pnpm --dir 'C:\path\to\deepseek-harness\packages\client\ui-workspace' exec tsdown
```

脚本会先备份三个目标文件，并以幂等方式读取 `projectionValues.tokenCost.cost`。上游结构不匹配时会停止，不会猜测写入。

### 源码开发

```powershell
corepack pnpm install
corepack pnpm build
corepack pnpm run check:bundle
```

## 配置

### API Key

通过 DSH 的 credentials 机制配置 `DEEPSEEK_API_KEY`（`~/.dsh/.credentials.yaml`），未配置时余额卡片显示引导态，token 计量不受影响。

### 价格表（可选覆盖）

价格表默认内置（见 `src/pricing.ts`），可通过 settings namespace `dsh-token-monitor` 的 `priceTable` 字段覆盖价格和工作日高峰时段。周一至周五默认按北京时间 `9:00–12:00`、`14:00–18:00` 为峰价，其余时间为谷价；周六、周日无论时段均按谷价。官方依据：[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[图像理解 Token 用量](https://api-docs.deepseek.com/zh-cn/guides/vision#token-usage)。

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

插件内置一个不注册 Cordis 工具的轻量 ClawBot 适配器，并按以下优先级选择通知 provider：新版外部 wechat-notify 能力对象 → 旧版 send() / status() 接口 → 内置适配器 → 不可用。任一时刻只会选择一个 provider；微信未登录、超时或发送失败不会阻塞余额监控、计费和鲸鱼娘动画。

如果用户已经安装独立 dsh-wechat-notify，本插件会复用它的发送能力；未安装时，只要设置 `WECHAT_NOTIFY_CLAWBOT_INDEX`，内置适配器即可开箱发送。该变量必须指向本机 ClawBot CLI 的入口文件，例如：

```powershell
$env:WECHAT_NOTIFY_CLAWBOT_INDEX = 'C:\path\to\clawbot-cli\dist\index.js'
dsh --profile web
```

兼容层不迁移或删除原插件凭据，也不会重复注册 wechat_notify、扫码工具或 bridge。旧版接口若只能发送，状态面板会明确标注“发送可用，登录管理由原插件负责”。

## 常见问题

- **余额卡片显示「未配置」**：未配置 `DEEPSEEK_API_KEY`，token 计量仍正常。
- **左侧原生会话行没有金额**：新宿主会自动显示；旧版客户端由标准包内置的 fail-closed 兼容桥在能安全匹配时显示。若仍未出现，先确认重启了目标 profile；完整源码部署可选运行开发兼容脚本，但标准包已显示金额时不要再运行，避免重复写入。输入区会话累计条始终可用。
- **只有旧会话没有金额**：插件加载前结束的旧会话需在下次启动时自动补齐（插件启动时对缺失投影的历史会话触发冷读 fold），启动后请稍等几秒再刷新页面。
- **窗口启动后仍无动画**：确认已重启安装目标 profile；若以前使用过源码集成版，先删除旧的手工 patch 和重复挂载。

## 社区与反馈

欢迎在 [LINUX DO 社区](https://linux.do/) 交流使用体验、反馈问题和分享改进建议。插件的安装、运行和全部功能均不依赖任何中转服务或充值渠道。

## 许可证

MIT

<a id="sponsor"></a>
## 赞助商简介

本项目由 <a href="https://www.fastaitoken.com/register?aff=BF9KNKFHX725" target="_blank" rel="noopener noreferrer">fastaitoken</a> 提供的 GPT 5.6sol 开发。<a href="https://www.fastaitoken.com/register?aff=BF9KNKFHX725" target="_blank" rel="noopener noreferrer">fastaitoken</a> 是低价实惠的 AI Token 中转站，覆盖 `GPT / Claude` 全模型，提供主流生图、视频模型。包纯度，实用耐蹬。<strong>注册后点击右上角用户头像前往 QQ 客服群 @群主可领 3 刀试用金（需提供用户 ID，暗号：GitHub 来的）。</strong> <a href="https://www.fastaitoken.com/register?aff=BF9KNKFHX725" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/FastAI-%E7%82%B9%E5%87%BB%E6%B3%A8%E5%86%8C-4F7CFF.svg?logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAABYlAAAWJQFJUiTwAAABmUlEQVRYw%2B2Vv0tbURTHP%2BfmvcS8lx%2BYKrZ16modFbQiKrgWuujQpZtgqV3s0rGT4N9Q6NJBM0nWUoe6uSj4BxQKUnBSSPISk3tPB1%2BhS42JFqHcD1wuXM79fs89HM4Fj8fjuWdk4Jubl9PEUiEC4nSV0r0cQATkgBIHjEvzbzLBIN7mrd11JVkBoJgeZgSMghGw%2Bjv0kHEzc61W3%2B7r3Zcuk5oDNP8oogKamlvp0O6u95LrrwKvtYDRbQRoiSWrX7DawoniABVQFVTbtOwn5rJHd5uA7c6SMd8QA44aH8zO%2FTThG30sea1qzCMKQCFtwBJIkZ8ayxJT0rmJ1EBNSKAf1fCMDCAComn5QRP7noWgc2OpnhFrGrKM45in1NsJJtxgSBYIFIQGqidYFIslcXs8D6p9vaVnxESjwlk8ghAR5baARbKaJycK3Re8C7%2FepgeuT6CaPMENhZzbScZkngszSaB5ALLuM5u3M%2B89B1bz36%2FMkn0i84BRflDGMkyN0Gz8%2B1FcrT%2Fkst3EVoq8klP%2Fc3k8Hs9%2FyS8IrHi9DaVvuAAAAABJRU5ErkJggg%3D%3D" alt="fastai 点击注册"></a>

<p><img src="docs/assets/fastaitoken-channel-models.png" alt="FastAiToken 支持的渠道与模型" width="100%"></p>
