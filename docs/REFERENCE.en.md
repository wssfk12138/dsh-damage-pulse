# Advanced reference

[Back to README](../README.en.md) · [简体中文](REFERENCE.zh-CN.md)

Advanced configuration, APIs, and recovery details live here. Ordinary installation and feature introductions are in the README.

## Historical pricing

Built-in DeepSeek pricing uses Beijing-time effective dates: legacy uniform prices before 2026-08-17, earlier peak/off-peak prices until 2026-09-10 12:00, and current rates afterward. Public holidays have been off-peak since 2026-09-25; weekends remain off-peak even on adjusted workdays. V4 Pro retains Pro pricing rather than falling back to Flash rates.

A custom `priceTable` replaces default rules from 2026-08-17 onward; older calls retain official legacy pricing. Restart the host after changing it. Rule updates do not rewrite the persisted usage ledger. See [official pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/).

## Balance scripts

Describe the request path, method, authentication, and JSON parsing in JavaScript; scripts are validated in a sandbox. An optional `display` string (trimmed, at most 48 characters) replaces the currency and amount.

An optional `windows` array accepts up to 8 windows with `label`, `used`/`remaining`/`percent`, `total`, and `resetAt` (epoch milliseconds or an ISO string). With windows, `currency` and `totalBalance` may be omitted: they default to `credits` and the first window’s remaining amount. Non-currency providers show windows without a numeric balance.

Clear and save the script to remove the override. Known DeepSeek, fastaitoken, and GLM Coding Plan gateways return to the built-in adapter; other providers become unconfigured. The equivalent API is `DELETE /api/token-monitor/balance-script?provider=<id>&expectedRevision=<n>`.

## Animation scale

The companion and damage feedback share the global <code>animationScale</code> setting. The default is <code>0.8</code> of the card width, allowed in the range <code>0.5</code> to <code>1</code>. Both scale together when the card width changes, and the character keeps its aspect ratio. Existing custom values are preserved.

To change the global scale through an authenticated DSH model session, read <code>GET /api/token-monitor/settings</code>, obtain the current <code>revision</code>, then send a PATCH with <code>{"expectedRevision":REVISION,"patch":{"animationScale":0.65}}</code>. Do not add a <code>provider</code> parameter because the scale is global. Save, read the settings again to verify, and retry after a 409 conflict by obtaining a fresh revision. Use the same endpoint to restore the default value of <code>0.8</code>.

If the authenticated endpoint is unavailable, inspect the current host configuration entry instead of guessing a profile path or replacing the complete configuration.

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

## Recovery

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

The standard package displays session amounts through the official header slot, optional host sidebar slot, or a fail-closed legacy bridge. Wait for old conversations to be folded on startup. For a complete plugin reinstall, remove the remaining entry in the desktop Plugins page, add the complete package, and restart; do not clear the ledger or removal markers.

## Architecture

| Component | Location | Responsibility |
|---|---|---|
| Host plugin | <code>plugins/dsh-token-monitor</code> | Billing eligibility, pricing, persistent ledger, balance, statistics, budget/calendar/cache alerts, WeChat, and update APIs |
| Client package | <code>packages/client/ui-token-monitor</code> | Per-request usage, session totals, balance card, Whale Girl animation, notification bubbles, and detailed settings |
| WeChat layer | <code>plugins/wechat-notify</code> / ClawBot | Connection state, login management, and message delivery; unavailability never blocks billing or balance monitoring |

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

The repository contains host patches under <code>patches/</code>. Their target versions, symptoms, and application steps are documented in [patch documentation](../patches/README.md). The package's <code>patchedDependencies</code> entry applies the required host patch automatically during installation.

The optional <code>scripts/apply-sidebar-integration.ps1</code> supports full DSH source deployments and historical custom clients. Standard packages already display session amounts and do not require that script.
