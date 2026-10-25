English | [简体中文](README.md)

# dsh-damage-pulse

<p align="center">
  <img src="docs/assets/dsh-damage-pulse-peak-valley-whale-poster.png" alt="dsh-damage-pulse overview: live usage, the Whale Girl companion, alerts, WeChat notifications, and verified updates" width="100%">
</p>

<p align="center">
  <a href="https://linux.do/t/topic/2773449" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/LINUX-DO-FFB003.svg" alt="LINUX DO community"></a>
  <a href="#sponsors"><img src="assets/fastai-sponsor.svg" alt="Fastai model sponsor"></a>
</p>

<code>dsh-damage-pulse</code> is a DeepSeek usage, spending, and balance monitor for DSH (DeepSeek Harness). It follows the official pricing rules, records every eligible model call, and presents usage at three levels: per request, per conversation, and across the account. The Whale Girl companion turns abstract token consumption into immediate visual feedback.

The public package name is <code>dsh-damage-pulse</code>. Internal identifiers such as <code>dsh-token-monitor</code> and <code>token-monitor</code> remain in place for compatibility with existing settings, API paths, storage keys, and usage ledgers.

## Contents

- [Features](#features)
- [Billing model](#billing-model)
- [Usage views and balance card](#usage-views-and-balance-card)
- [Module management](#module-management)
- [Editable billing rules](#editable-billing-rules)
- [Detailed usage window](#detailed-usage-window)
- [Whale Girl companion](#whale-girl-companion)
- [Alerts and WeChat notifications](#alerts-and-wechat-notifications)
- [Verified updates](#verified-updates)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
- [HTTP endpoints](#http-endpoints)
- [WeChat compatibility adapter](#wechat-compatibility-adapter)
- [Troubleshooting](#troubleshooting)
- [Current release and compatibility](#current-release-and-compatibility)
- [Development](#development)
- [Community](#community)
- [License](#license)

## Features

| Capability | What it provides |
|---|---|
| Accurate billing | Calculates each request from provider, model, cache type, and the applicable Beijing-time peak or off-peak rate |
| Three-level usage display | Per-request details in the conversation, session totals near the composer, and a global account-balance card |
| Historical statistics | Today, 7-day, 30-day, and all-time spending, request, token, cache-hit, and active-day summaries |
| Balance monitoring | Periodic official balance checks, immediate charge deductions, recharge recovery, and peak/off-peak status |
| Whale Girl feedback | Idle and blink states, charge reactions, cache-miss reactions, depleted balance, and recharge revival |
| Proactive alerts | Daily budgets, peak/off-peak transitions, cache-hit anomalies, and optional companion bubbles |
| WeChat notifications | QR login, connection management, delivery status, and test messages through ClawBot |
| Modular lifecycle | Inspect, remove, or reinstall five independent feature modules and install verified updates from the plugin |
| Editable pricing | Configure fixed or peak/off-peak prices, tiers, multipliers, and third-party provider balance scripts |
| Detailed usage window | Draggable, resizable filtering by time, provider, model, project, and conversation, with column controls and pagination |
| Holiday-aware pricing | Public holidays and adjusted weekends use off-peak rates for the entire day |
| Secure updates | Checks GitHub Releases and verifies the version, source, asset name, redirects, and SHA-256 before installation |

## Billing model

### Official September 2026 pricing changes

Effective at 12:00 Beijing time on September 10, 2026, <code>deepseek-flash</code> (V4.1 Flash), <code>deepseek-v4-flash</code>, and <code>deepseek-v4-flash-vision-exp</code> share the new Flash rates. The per-million-token prices in CNY are:

| Period | Cached input | Uncached input | Output |
|---|---:|---:|---:|
| Off-peak | ¥0.02 | ¥1 | ¥4 |
| Peak | ¥0.04 | ¥2 | ¥8 |

Peak hours are 09:00–12:00 and 14:00–18:00 Beijing time on weekdays. Weekends are off-peak for the full day.

DeepSeek's canceled adjustment for <code>deepseek-v4-pro</code> remains canceled: V4 Pro continues to use its Pro rates. Per million tokens, off-peak pricing is ¥0.15 for cached input, ¥4.5 for uncached input, and ¥13.5 for output. Peak pricing is ¥0.3, ¥9, and ¥27 respectively.

The built-in price table is segmented by effective time:

- Before 00:00 Beijing time on August 17, 2026: legacy uniform pricing.
- From August 17, 2026 00:00 to September 10, 2026 12:00: earlier peak/off-peak pricing.
- After September 10, 2026 12:00: current pricing.

Starting September 25, 2026, public holidays use off-peak rates for the entire day. Weekends also remain off-peak even when an adjusted workday falls on a Saturday or Sunday. The same calendar rules apply to built-in DeepSeek pricing and custom third-party rules.

Pricing reference: [DeepSeek official models and pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing).

### Accurate accounting and a persistent ledger

- Billing eligibility depends on both provider and model. Unknown or ineligible models never fall back to the Flash price.
- Uncached input, cache reads, cache writes, and output are counted separately. The rate is chosen from the Beijing-time calendar at the moment of the call.
- Vision models use the usage returned by DeepSeek instead of re-estimating image tokens.
- Eligible calls are written to a local persistent ledger. Restarting the host restores historical statistics and session summaries.
- Zero-cost records do not pollute the ledger.
- <code>sessionId + sourceEventSeq</code> makes event processing idempotent and prevents duplicate charges after replay.

## Usage views and balance card

- **Per-request row:** After every model call, the conversation shows input, cached, output, reasoning tokens, and the exact amount.
- **Session total:** The composer area continuously shows accumulated tokens and cost for the current conversation.
- **Global floating card:** The card follows the user across conversations and shows the DeepSeek account balance. Today's spending and historical summaries are available in detailed settings.
- **Statistics overview:** Today, 7-day, 30-day, and all-time views summarize spending, request count, total tokens, cache-hit tokens, cache-hit rate, and active days.
- **Large-number formatting:** Chinese magnitude units are used in the localized interface, including 万, 千万, 亿, and 万亿, with automatic promotion at rounding boundaries.

Balance and interaction behavior:

- The official DeepSeek balance is checked every 60 seconds. New charge events update the displayed balance immediately, and a successful recharge produces a green recovery animation.
- Missing credentials and failed balance requests produce explicit states. Local spending totals do not depend on the balance API.
- TUN and Fake-IP proxies work without extra configuration when the domain resolves into <code>198.18.0.0/15</code>. The plugin verifies the TLS certificate identity for that address before sending the API key. IPv6 and IPv4-mapped Fake-IP answers are not currently supported and behave like a failed query.
- Peak/off-peak status refreshes every 30 seconds. Peak is red; off-peak is green.
- The card supports dragging, keyboard movement, viewport bounds, and position memory. Right-clicking can hide the companion or open detailed settings.
- The context menu contains Show Whale Girl, Usage Overview, Usage Details, Notification Settings, Billing Rules, and Uninstall / Update.

<p align="center">
  <img src="docs/assets/readme/balance-card-no-credentials.png" alt="Balance card without credentials, showing request tokens and latency" width="330">
  &nbsp;&nbsp;
  <img src="docs/assets/readme/balance-card-usage.png" alt="Balance card with account balance, tokens, and latency" width="330">
</p>

<p align="center">
  <img src="docs/assets/readme/balance-card-context-menu.png" alt="Balance card context menu" width="420">
</p>

## Module management

The plugin separates optional capabilities into five modules:

1. **Companion** — Whale Girl animation, dragging, and companion assets.
2. **Usage overview** — summaries, detailed usage, and historical queries.
3. **Notifications** — budgets, anomalies, peak/off-peak alerts, and companion bubbles.
4. **Billing rules** — built-in and third-party pricing, balance queries, and charge animations.
5. **WeChat channel** — login, connection management, test messages, and delivery.

From Uninstall / Update, you can inspect the plugin version and module state, remove one module, or remove the whole plugin. Removed modules stay disabled across restarts and upgrades.

Uninstall preserves configuration and historical data by default. Clearing that option removes the affected module's settings, usage ledger, and history, but does not remove host credentials. The plugin can install a newer GitHub Release after validating the version, asset name, download origin, redirects, and SHA-256. If the package is missing or corrupted later, the plugin does not silently restore it; startup logs indicate that a reinstall is required.

The floating card remembers its relative position inside the movable area and scales that position when the window or card size changes.

<p align="center">
  <img src="docs/assets/readme/module-management.png" alt="Uninstall and update panel with five modules" width="640">
</p>

## Editable billing rules

The pricing editor lets users describe how each provider/model combination is billed, including third-party model relays.

- **Fixed or peak/off-peak:** choose either a fixed price or custom peak windows by weekday and time. All remaining time is off-peak.
- **Holiday and weekend rules:** public holidays and adjusted weekends use off-peak pricing for the full day.
- **Tiers and multipliers:** set tier prices by maximum context length and apply a multiplier for relay markups.
- **Templates and provenance:** preview built-in templates, apply one to the model, and inspect the rule source, version, and autosave state. Models and providers can be enabled independently.
- **Provider balance scripts:** write a small JavaScript adapter that describes the request path, method, authentication, and JSON response mapping. A sandbox check must pass before the card can display that provider's balance. A script may also return an optional `display` string (trimmed, up to 48 characters); when present, the card uses it instead of the currency symbol and amount, which suits percentages or combined quota summaries.

The billing editor and usage window support dragging, eight-direction resizing, maximizing, and position memory. Clicking outside a panel does not close it, so prices can be edited while the conversation remains visible.

<p align="center">
  <img src="docs/assets/readme/billing-rules.png" alt="Billing rules by provider and model" width="720">
</p>

<p align="center">
  <img src="docs/assets/readme/balance-script.png" alt="Third-party provider balance script editor" width="720">
</p>

## Detailed usage window

Open Usage Details from the balance card context menu to view a draggable, resizable, maximizable window that keeps its size and position.

- **Overview:** spending, requests, total tokens, active days, cached tokens, cache-hit rate, cost per 100 million tokens, and average daily spend.
- **Detail table:** model, conversation, provider, project, token breakdown, reasoning tokens, reasoning effort, local cost, first-token and total latency, and timestamp with peak/off-peak marker.
- **Filters and pagination:** time range, model, project, or conversation. The error-request view supports error type and whether canceled requests are included. Page size is 20, 50, or 100 rows.
- **Columns:** choose visible columns or restore the defaults.
- **Cost breakdown:** open the info action beside a charge to inspect uncached input, cache hit, cache write, and output costs, token counts, unit prices, pricing mode, tier limit, multiplier, and rule identifier.

<p align="center">
  <img src="docs/assets/readme/usage-details.png" alt="Detailed usage overview, filters, and table" width="100%">
</p>

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/assets/readme/usage-details-columns.png" alt="Column selector" width="300"><br><sub><b>Column selection</b></sub></td>
    <td align="center" width="50%"><img src="docs/assets/readme/usage-details-by-provider.png" alt="Provider filter" width="300"><br><sub><b>Filter by provider</b></sub></td>
  </tr>
</table>

<p align="center">
  <img src="docs/assets/readme/fee-explanation.png" alt="Per-request cost breakdown" width="620">
</p>

## Whale Girl companion

The Whale Girl sits on the balance card, idles, blinks, and reacts differently to ordinary charges, cache misses, repeated spending, balance depletion, and recharge recovery. Charge amounts are queued in event order, while colors and reaction strength distinguish cost types. Routine charges remain lightweight so the companion does not interrupt normal work.

The companion and damage feedback share the global <code>animationScale</code> setting. The default is <code>0.8</code> of the card width, allowed in the range <code>0.5</code> to <code>1</code>. Both scale together when the card width changes, and the character keeps its aspect ratio. Existing custom values are preserved.

To change the global scale through an authenticated DSH model session, read <code>GET /api/token-monitor/settings</code>, obtain the current <code>revision</code>, then send a PATCH with <code>{"expectedRevision":REVISION,"patch":{"animationScale":0.65}}</code>. Do not add a <code>provider</code> parameter because the scale is global. Save, read the settings again to verify, and retry after a 409 conflict by obtaining a fresh revision. Use the same endpoint to restore the default value of <code>0.8</code>.

If the authenticated endpoint is unavailable, inspect the current host configuration entry instead of guessing a profile path or replacing the complete configuration.

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/assets/readme/whale-girl-idle-bite-finger.png" alt="Whale Girl idle pose" width="260"><br>
      <sub><b>Idle while waiting for a task</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/assets/readme/whale-girl-critical-damage.png" alt="Whale Girl strong charge reaction" width="260"><br>
      <sub><b>Reaction to a cache miss</b></sub>
    </td>
  </tr>
</table>

## Alerts and WeChat notifications

- **Daily budget:** notify the first time today's spending crosses the configured budget. The alert never blocks, cancels, or rate-limits model requests.
- **Peak/off-peak transitions:** enable notifications separately for entering peak and entering off-peak. A single boundary is not announced twice.
- **Cache anomaly:** configure a cache-hit threshold and consecutive-anomaly count. The alert can fire again after recovery.
- **Companion bubbles:** reserved for budget, peak/off-peak, and cache anomalies. The bubble channel can be disabled independently.
- **ClawBot WeChat:** inspect connection, authentication, and delivery state; scan the QR code; refresh; reconnect; disconnect; and send a test message.
- **Notification copy:** business alerts use the public project name <code>dsh-damage-pulse</code>. A Star invitation appears only in test messages.
- All business notification switches default to off. Migration from older configuration versions also leaves them off when fields are absent. Sending a test message is an independent channel check and is not blocked by the business notification switch.

<p align="center">
  <img src="docs/assets/readme/notification-settings.png" alt="Alert rules and notification channels" width="720">
</p>

<p align="center">
  <img src="docs/assets/readme/dsh-damage-pulse-wechat-live.jpg" alt="WeChat notification delivered through ClawBot" width="520">
</p>

## Verified updates

The update panel can open the project page, query the latest GitHub Release, compare versions, and install a package. Installation validates the release/tag version, asset name, download origin, redirect domain, SHA-256 digest, and whether a supported profile is present.

The settings model uses revisions to prevent one page from overwriting another page's changes and migrates older field layouts. The responsive settings panel combines current spending, historical statistics, companion settings, budgets, alerts, and WeChat controls.

## Architecture

| Component | Location | Responsibility |
|---|---|---|
| Host plugin | <code>plugins/dsh-token-monitor</code> | Billing eligibility, pricing, persistent ledger, balance, statistics, budget/calendar/cache alerts, WeChat, and update APIs |
| Client package | <code>packages/client/ui-token-monitor</code> | Per-request usage, session totals, balance card, Whale Girl animation, notification bubbles, and detailed settings |
| WeChat layer | <code>plugins/wechat-notify</code> / ClawBot | Connection state, login management, and message delivery; unavailability never blocks billing or balance monitoring |

## Installation

Use the published package or a prebuilt release tarball. Do not install the GitHub repository page, a source archive, or a local source checkout directly: those inputs do not contain the <code>runtime/</code> payload generated during packaging, so the plugin cannot start.

### Install from npm

~~~powershell
# Web profile
dsh plugin --profile web add dsh-damage-pulse

# Desktop profile; replace "desktop" with the profile you actually use
dsh plugin --profile desktop add dsh-damage-pulse
~~~

If npm has not yet received the current release, install the matching prebuilt tarball:

~~~powershell
# Web profile
dsh plugin --profile web add https://github.com/wssfk12138/dsh-damage-pulse/releases/download/v4.3.0/dsh-damage-pulse-4.3.0.tgz

# Desktop profile
dsh plugin --profile desktop add https://github.com/wssfk12138/dsh-damage-pulse/releases/download/v4.3.0/dsh-damage-pulse-4.3.0.tgz
~~~

The accepted desktop input is the package name or the path to a complete prebuilt <code>.tgz</code>. Extracting a tarball into a folder does not create a valid package installation. If the same version is already present, remove it before reinstalling.

### Restart the target profile

~~~powershell
dsh --profile web
dsh --profile desktop
~~~

For the desktop app, fully quit the application, including any tray process, and reopen it. Closing a settings panel alone is not a restart. After installation or upgrade, confirm the version in Uninstall / Update.

If the host uses a startup-failure isolation plugin, it may write a disabled entry into the profile's <code>cordis.patch.yml</code>:

~~~yaml
- id: dsh-token-monitor
  disabled: true
~~~

After installing a complete package, remove that entry or enable the plugin again; otherwise the installed plugin remains unmounted.

### Upgrade notes

- If upgrading from an early source-based integration, remove the old manual <code>--patch</code> entry and duplicate mounts.
- After an in-app update, fully exit and reopen the desktop application. The host plugin list may continue to display the version of the originally installed package, so inspect the plugin's own version indicator and the rendered UI.
- Do not delete the ledger or clear module-removal state to work around a startup error. Preserve the error text and current version when reporting a problem.
- A downgrade is not guaranteed to reverse data migrations. Back up the profile and plugin data before changing versions.

## Configuration

### DeepSeek API key

Configure <code>DEEPSEEK_API_KEY</code> through the DSH credentials mechanism, normally <code>~/.dsh/.credentials.yaml</code>. The key is used only for balance queries.

Loading, conversation usage collection, and billing do not require this key. Without it, the balance card shows a setup state while token accounting and the ledger continue to work.

### Price table override

The default price table is built into the plugin. A custom table can be supplied through the <code>priceTable</code> field in the <code>dsh-token-monitor</code> settings namespace. A custom table replaces the default rules from August 17, 2026 onward; older calls still use the official legacy pricing.

Reference:

- [DeepSeek models and pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
- [Vision token usage](https://api-docs.deepseek.com/zh-cn/guides/vision#token-usage)

## HTTP endpoints

| Endpoint | Purpose |
|---|---|
| <code>GET /api/token-monitor/balance</code> | DeepSeek balance, currency, total, and granted balance |
| <code>GET /api/token-monitor/usage?sessionId=</code> | Usage details, optionally filtered by conversation |
| <code>GET /api/token-monitor/usage-summary?range=</code> | Aggregated statistics for today, 7 days, 30 days, or all time |
| <code>GET /api/token-monitor/charge-events?since=SEQ</code> | Strictly increasing charge-event stream for balance changes and animations |
| <code>GET /api/token-monitor/notification-events?since=SEQ</code> | Budget, peak/off-peak, and cache-anomaly event stream |
| <code>GET/PATCH /api/token-monitor/settings</code> | Revision-aware settings read and update |
| <code>GET /api/token-monitor/wechat/status</code> | WeChat connection, authentication, delivery, and login-session state |
| <code>POST /api/token-monitor/wechat/login</code> | Create a QR login session |
| <code>POST /api/token-monitor/wechat/login/confirm</code> | Confirm the current QR login |
| <code>POST /api/token-monitor/wechat/reconnect</code> | Reconnect the host-managed WeChat bridge |
| <code>POST /api/token-monitor/wechat/disconnect</code> | Disconnect the host-managed bridge after explicit confirmation |
| <code>POST /api/token-monitor/wechat/test</code> | Send a test message independently of business notification switches |
| <code>GET/POST /api/token-monitor/update*</code> | Release checks and the guarded installation flow |

## WeChat compatibility adapter

The plugin includes a lightweight ClawBot adapter that does not register Cordis tools. Notification providers are selected in this order:

1. A host-provided <code>wechatNotify</code> sender and <code>wechatConnection</code> service.
2. The built-in adapter.
3. Unavailable.

The two capabilities are selected independently and reused when the services load later. Each message uses exactly one provider. A missing login, timeout, or delivery failure never blocks balance monitoring, billing, or companion animation.

If the standalone <code>dsh-wechat-notify</code> plugin is installed, this project reuses its sender. Otherwise, set <code>WECHAT_NOTIFY_CLAWBOT_INDEX</code> to the local ClawBot CLI entry point:

~~~powershell
$env:WECHAT_NOTIFY_CLAWBOT_INDEX = 'C:\path\to\clawbot-cli\dist\index.js'
dsh --profile web
~~~

The compatibility layer does not migrate or delete another plugin's credentials, register duplicate WeChat tools, or create a second bridge. If an older interface supports sending only, the status panel reports that sending is available while login management belongs to the original plugin.

## Troubleshooting

### The balance card says "not configured"

The plugin is loaded, but no usable <code>DEEPSEEK_API_KEY</code> is available for a balance query. Token collection and billing continue normally.

### The card has no balance

Distinguish missing credentials from a failed query. TUN and Fake-IP proxies are supported when the domain resolves into <code>198.18.0.0/15</code>. IPv6 and IPv4-mapped Fake-IP answers are not currently supported; configure the proxy to return an IPv4 public address or IPv4 Fake-IP.

### Session amounts are missing

The standard package registers the amount badge in the official session-header slot. Older or customized clients use a fail-closed compatibility bridge that writes only when it can uniquely identify the native session row. Confirm that the target profile was restarted. The composer's session total remains available in every supported client.

### Older conversations have no amount

Conversations completed before the plugin loaded are folded into the projection on the next startup. Wait a few seconds after startup and refresh the view.

### No animation after launch

Confirm that the profile containing the plugin was restarted. If an old source integration was used previously, remove its manual patch and duplicate mounts.

### The package reports <code>runtime/manifest.json</code> is missing

The installed input lacks the prebuilt <code>runtime/</code> payload. Reinstall the npm package or the complete release tarball, then restart the target profile. Source archives, repository URLs, <code>github:</code> specifications, and local source folders are not valid production installs unless they were built and packaged first.

### The package name installs an older version

Package managers may defer very recent releases through a minimum-release-age policy. Install the matching release tarball when a specific version is required. Do not disable package-manager safety globally.

## Current release and compatibility

Current release: **v4.3.0**.

Version 4.3.0 shows the Plan quota tab only when the Host confirms a real subscription: a provider that merely has an API key no longer leaves an empty card or a failed query behind, 401/403/404 and an answer with no quota window count as "not connected" and are not retried for 30 minutes, while 5xx and network failures still surface as errors. It also supports DeepSeek Harness <code>0.2.1-rc.3</code>. The 4.2.9 built-in GLM Coding Plan quota windows, the custom balance script <code>display</code> override and the quota-only card layout are retained.

Version 4.3.0 was verified on DeepSeek Harness <code>0.2.1-rc.3</code> desktop with the actual tarball in an isolated profile: the Plan tab stays hidden without a subscription, appears with a synthetic subscription snapshot, and Escape still closes only the top layer. Earlier verification: 4.2.9 on <code>0.2.1-rc.2</code> with the actual tarball: the served client matched the built bundle byte for byte, and balance, menus, usage details and the quota window layout rendered correctly. The quota window was exercised with a synthetic payload; the real GLM endpoint was not queried. Other host versions were not individually verified on physical installations.

The peer range retains compatibility with older DSH releases, but a declared peer range does not mean every version has been tested on a real installation. See [GitHub Releases](https://github.com/wssfk12138/dsh-damage-pulse/releases) for historical changes and downloadable packages.

## Development

Requirements:

- Node.js <code>^22.19.0</code> or <code>&gt;=24.0.0</code>
- pnpm <code>11.7.0</code> through Corepack

~~~powershell
corepack pnpm install
corepack pnpm build
corepack pnpm run check:bundle
~~~

Other repository scripts:

~~~powershell
corepack pnpm test
corepack pnpm typecheck
corepack pnpm run pack:check
~~~

The repository contains host patches under <code>patches/</code>. Their target versions, symptoms, and application steps are documented in <code>patches/README.md</code>. The package's <code>patchedDependencies</code> entry applies the required host patch automatically during installation.

The optional <code>scripts/apply-sidebar-integration.ps1</code> supports full DSH source deployments and historical custom clients. Standard packages already display session amounts and do not require that script.

## Community

Join the discussion on [LINUX DO](https://linux.do/). Installation and all core features work independently of any model relay or top-up service.

Reviewed community fixes are merged into the main branch and credited in release notes. Merged contribution: <code>@gurio-wine</code> (PR #17, desktop card position and Whale Girl toggle fixes, included in 4.0.9).

## License

MIT. See [LICENSE](LICENSE).

<a id="sponsors"></a>
## Sponsors

Fastai supports model access during development. If you need a model relay, you can use [Fastai](https://www.fastaitoken.com/register?aff=BF9KNKFHX725&promo=WSSFK); the link includes an affiliate code, and qualifying purchases provide credits and tokens that support ongoing development. GPT routing is not guaranteed to avoid model degradation, so other model groups may be preferable.

Free software still has development costs. Sponsorship helps keep features available to all users without in-app advertising.

<p align="center">
  <img src="docs/assets/readme/wechat-sponsor-qr.png" alt="WeChat sponsorship QR code" width="360">
</p>
