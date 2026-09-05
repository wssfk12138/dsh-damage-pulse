window.__ModuleLoader__.load({
	id: "dsh-damage-pulse",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
		//#endregion
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region packages/client/ui-token-monitor/src/client/usage-node.ts
		function locationOf(context) {
			return context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" };
		}
		const tokenUsageNodeDefinition = {
			kind: "token-usage",
			target: "chat",
			match: (event) => {
				if (event.type === "token-usage/record") return {
					id: String(event.seq),
					role: "start"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "token-usage/record") throw new Error("token-usage requires token-usage/record");
				const record = match.event.data.record;
				if (record === void 0) throw new Error("token-usage event is missing its record");
				return record;
			},
			update: (context) => context.state,
			publication: () => "immediate",
			buildViewNode: (context) => {
				if (context.state === void 0) return null;
				return {
					key: context.key,
					kind: "token-usage",
					id: context.id,
					target: "chat",
					anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
					location: locationOf(context),
					visibility: "visible",
					data: context.state
				};
			}
		};
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/UsageNodeView.tsx
		/**
		* 单次用量行 renderer：对话流内紧凑展示一次模型调用的 token 与金额。
		* 无 locale（文案硬编码中文），无 CSS module（内联样式，M4 验证用）。
		*/
		const ROW = {
			display: "inline-flex",
			alignItems: "baseline",
			gap: 8,
			padding: "3px 10px",
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsh-color-text-secondary, #888)",
			fontVariantNumeric: "tabular-nums"
		};
		const COST$1 = {
			fontWeight: 600,
			color: "var(--dsh-color-accent, #4c8dff)"
		};
		/** 把大 token 数格式化为 1.2k / 3.4M 的紧凑形式。 */
		function fmtTokens$1(n) {
			if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
			if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
			return String(n);
		}
		/** 金额格式：保留足够小数位，极小值也用科学计数兜底。 */
		function fmtCost$2(n) {
			if (n === 0) return "¥0";
			if (n < 1e-4) return `¥${n.toExponential(2)}`;
			if (n < .01) return `¥${n.toFixed(5)}`;
			return `¥${n.toFixed(4)}`;
		}
		const UsageNodeView = (0, react.memo)(function UsageNodeView({ node }) {
			const r = node.data;
			const total = r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens + r.outputTokens;
			const cache = r.cacheReadTokens > 0 ? ` · 缓存 ${fmtTokens$1(r.cacheReadTokens)}` : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: ROW,
				"data-token-usage": "",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: r.model }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"↑ ",
						fmtTokens$1(r.inputTokens + r.cacheWriteTokens),
						cache
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["↓ ", fmtTokens$1(r.outputTokens)] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"∑ ",
						fmtTokens$1(total),
						" tok"
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: r.peak ? "峰时" : "谷时" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: COST$1,
						children: fmtCost$2(r.cost)
					})
				]
			});
		});
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/SessionStatsBar.tsx
		const BAR = {
			display: "inline-flex",
			alignItems: "baseline",
			gap: 10,
			fontSize: 12,
			lineHeight: "16px",
			color: "var(--dsh-color-text-secondary, #888)",
			fontVariantNumeric: "tabular-nums"
		};
		const COST = {
			fontWeight: 600,
			color: "var(--dsh-color-accent, #4c8dff)"
		};
		function fmtTokens(n) {
			if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
			if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
			return String(n);
		}
		function fmtCost$1(n) {
			if (n === 0) return "¥0";
			if (n < 1e-4) return `¥${n.toExponential(2)}`;
			if (n < .01) return `¥${n.toFixed(5)}`;
			return `¥${n.toFixed(4)}`;
		}
		function SessionStatsBar({ useProjection }) {
			const projection = useProjection("tokenCost");
			if (projection === void 0 || projection === null) return null;
			const p = projection;
			if (p.calls === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: BAR,
				"data-token-monitor-stats": "",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "本次会话" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: COST,
						children: fmtCost$1(p.cost)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [fmtTokens(p.totalTokens), " tokens"] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [p.calls, " 次调用"] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["↑ ", fmtTokens(p.inputTokens + p.cacheWriteTokens)] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["↓ ", fmtTokens(p.outputTokens)] })
				]
			});
		}
		const TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY = 1e6;
		const DEFAULT_TOKEN_MONITOR_SETTINGS = Object.freeze({
			displayMode: "balance",
			showWhaleGirl: true,
			dailyBudgetEnabled: true,
			dailyBudgetCny: 10,
			budgetExceededNotificationEnabled: false,
			peakReminderEnabled: false,
			peakReminderEnterPeak: false,
			peakReminderEnterValley: false,
			notifyOncePerTransition: false,
			whaleBubbleEnabled: false,
			wechatNotificationsEnabled: false,
			cacheHitAnomalyNotificationEnabled: false,
			cacheHitAnomalyThreshold: 30,
			cacheHitAnomalyConsecutiveCalls: 3
		});
		const TOKEN_MONITOR_SETTING_KEYS = Object.freeze([
			"displayMode",
			"showWhaleGirl",
			"dailyBudgetEnabled",
			"dailyBudgetCny",
			"budgetExceededNotificationEnabled",
			"peakReminderEnabled",
			"peakReminderEnterPeak",
			"peakReminderEnterValley",
			"notifyOncePerTransition",
			"whaleBubbleEnabled",
			"wechatNotificationsEnabled",
			"cacheHitAnomalyNotificationEnabled",
			"cacheHitAnomalyThreshold",
			"cacheHitAnomalyConsecutiveCalls"
		]);
		Object.freeze(["showWhaleGirl", "dailyBudgetEnabled"]);
		const BOOLEAN_KEYS = /* @__PURE__ */ new Set([
			"showWhaleGirl",
			"dailyBudgetEnabled",
			"budgetExceededNotificationEnabled",
			"peakReminderEnabled",
			"peakReminderEnterPeak",
			"peakReminderEnterValley",
			"notifyOncePerTransition",
			"whaleBubbleEnabled",
			"wechatNotificationsEnabled",
			"cacheHitAnomalyNotificationEnabled"
		]);
		const DANGEROUS_KEYS = /* @__PURE__ */ new Set([
			"__proto__",
			"constructor",
			"prototype"
		]);
		function isPlainObject(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const prototype = Object.getPrototypeOf(value);
			return prototype === Object.prototype || prototype === null;
		}
		function hasAtMostTwoDecimalPlaces(value) {
			const rounded = Math.round(value * 100) / 100;
			return Math.abs(value - rounded) <= 1e-9;
		}
		function validateSettingValue(key, value) {
			if (BOOLEAN_KEYS.has(key)) return typeof value === "boolean" ? void 0 : "必须是布尔值";
			if (key === "displayMode") return value === "balance" || value === "spend" ? void 0 : "只能是 balance 或 spend";
			if (key === "dailyBudgetCny") {
				if (typeof value !== "number" || !Number.isFinite(value)) return "必须是有限数字";
				if (value <= 0 || value > 1e6) return `必须大于 0 且不超过 ${String(TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY)}`;
				if (!hasAtMostTwoDecimalPlaces(value)) return "最多保留两位小数";
			}
			if (key === "cacheHitAnomalyThreshold") {
				if (typeof value !== "number" || !Number.isSafeInteger(value)) return "必须是 0 到 100 的整数百分比";
				if (value < 0 || value > 100) return "必须在 0 到 100 之间";
			}
			if (key === "cacheHitAnomalyConsecutiveCalls") {
				if (typeof value !== "number" || !Number.isSafeInteger(value)) return "必须是 2 到 20 的整数";
				if (value < 2 || value > 20) return "必须在 2 到 20 之间";
			}
		}
		function parseSettingsObject(value, partial, prefix) {
			if (!isPlainObject(value)) return {
				ok: false,
				fields: { [prefix]: "必须是普通对象" }
			};
			const fields = {};
			const output = {};
			const allowed = new Set(TOKEN_MONITOR_SETTING_KEYS);
			for (const key of Object.keys(value)) {
				const path = `${prefix}.${key}`;
				if (DANGEROUS_KEYS.has(key)) {
					fields[path] = "禁止使用危险对象键";
					continue;
				}
				if (!allowed.has(key)) {
					fields[path] = "未知设置字段";
					continue;
				}
				const error = validateSettingValue(key, value[key]);
				if (error !== void 0) fields[path] = error;
				else output[key] = value[key];
			}
			if (!partial) {
				for (const key of TOKEN_MONITOR_SETTING_KEYS) if (!(key in value)) fields[`${prefix}.${key}`] = "缺少必填字段";
			}
			return Object.keys(fields).length > 0 ? {
				ok: false,
				fields
			} : {
				ok: true,
				value: output
			};
		}
		/** Validate and detach a complete public settings object. */
		function parseTokenMonitorSettings(value) {
			const result = parseSettingsObject(value, false, "settings");
			return result.ok ? {
				ok: true,
				value: result.value
			} : result;
		}
		/** Validate a successful GET/PATCH response before Client code trusts it. */
		function parseTokenMonitorSettingsSnapshot(value) {
			if (!isPlainObject(value)) return {
				ok: false,
				fields: { response: "必须是普通对象" }
			};
			const fields = {};
			for (const key of Object.keys(value)) if (key !== "schemaVersion" && key !== "revision" && key !== "settings") fields[key] = "未知响应字段";
			if (value.schemaVersion !== 3) fields.schemaVersion = "不支持的 schemaVersion";
			if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0) fields.revision = "必须是非负安全整数";
			const parsedSettings = parseTokenMonitorSettings(value.settings);
			if (!parsedSettings.ok) Object.assign(fields, parsedSettings.fields);
			if (Object.keys(fields).length > 0) return {
				ok: false,
				fields
			};
			return {
				ok: true,
				value: {
					schemaVersion: 3,
					revision: value.revision,
					settings: parsedSettings.ok ? parsedSettings.value : { ...DEFAULT_TOKEN_MONITOR_SETTINGS }
				}
			};
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/settingsApi.ts
		var TokenMonitorSettingsApiError = class extends Error {
			status;
			code;
			fields;
			constructor(status, code, message, fields) {
				super(message);
				this.status = status;
				this.code = code;
				this.fields = fields;
				this.name = "TokenMonitorSettingsApiError";
			}
		};
		var TokenMonitorSettingsProtocolError = class extends Error {
			fields;
			constructor(fields) {
				super("Token Monitor 设置接口返回了不符合契约的数据");
				this.fields = fields;
				this.name = "TokenMonitorSettingsProtocolError";
			}
		};
		function isRecord$2(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function parseErrorResponse(status, value) {
			if (!isRecord$2(value) || !isRecord$2(value.error)) return new TokenMonitorSettingsApiError(status, "HTTP_ERROR", `Token Monitor 设置请求失败（HTTP ${String(status)}）`);
			const error = value.error;
			const code = typeof error.code === "string" ? error.code : "HTTP_ERROR";
			const message = typeof error.message === "string" ? error.message : `Token Monitor 设置请求失败（HTTP ${String(status)}）`;
			const details = isRecord$2(error.details) ? error.details : void 0;
			const rawFields = details !== void 0 && isRecord$2(details.fields) ? details.fields : void 0;
			const fields = rawFields === void 0 ? void 0 : Object.fromEntries(Object.entries(rawFields).filter((entry) => typeof entry[1] === "string"));
			return new TokenMonitorSettingsApiError(status, [
				"METHOD_NOT_ALLOWED",
				"INVALID_JSON",
				"PAYLOAD_TOO_LARGE",
				"UNSUPPORTED_MEDIA_TYPE",
				"VALIDATION_ERROR",
				"CONFLICT",
				"WRITE_FAILED"
			].includes(code) ? code : "HTTP_ERROR", message, fields);
		}
		async function readJson$2(response) {
			try {
				return await response.json();
			} catch {
				if (!response.ok) throw new TokenMonitorSettingsApiError(response.status, "HTTP_ERROR", `Token Monitor 设置请求失败（HTTP ${String(response.status)}）`);
				throw new TokenMonitorSettingsProtocolError({ response: "响应不是有效 JSON" });
			}
		}
		async function parseResponse$1(response) {
			const value = await readJson$2(response);
			if (!response.ok) throw parseErrorResponse(response.status, value);
			const parsed = parseTokenMonitorSettingsSnapshot(value);
			if (!parsed.ok) throw new TokenMonitorSettingsProtocolError(parsed.fields);
			return parsed.value;
		}
		/** Browser-safe client for the dedicated Token Monitor settings endpoint. */
		function createTokenMonitorSettingsApi(fetcher = fetch, endpoint = "/api/token-monitor/settings") {
			return {
				async get(signal) {
					return parseResponse$1(await fetcher(endpoint, {
						cache: "no-store",
						...signal === void 0 ? {} : { signal }
					}));
				},
				async patch(request, signal) {
					return parseResponse$1(await fetcher(endpoint, {
						method: "PATCH",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(request),
						cache: "no-store",
						...signal === void 0 ? {} : { signal }
					}));
				}
			};
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/wechatConnectionApi.ts
		var WechatConnectionApiError = class extends Error {
			status;
			code;
			constructor(status, code, message) {
				super(message);
				this.status = status;
				this.code = code;
				this.name = "WechatConnectionApiError";
			}
		};
		var WechatConnectionProtocolError = class extends Error {
			field;
			constructor(field) {
				super(`微信连接接口返回了不符合契约的数据：${field}`);
				this.field = field;
				this.name = "WechatConnectionProtocolError";
			}
		};
		const availabilityValues = ["available", "unsupported"];
		const authValues = [
			"unconfigured",
			"pending",
			"authenticated",
			"expired",
			"unknown"
		];
		const processValues = [
			"host-managed-running",
			"host-managed-stopped",
			"external",
			"none",
			"unknown"
		];
		const deliveryValues = [
			"ready",
			"needs-activation",
			"not-ready",
			"unknown"
		];
		const operationValues = [
			"idle",
			"login",
			"confirm-login",
			"reconnect",
			"disconnect"
		];
		const knownErrorCodes = [
			"UNSUPPORTED",
			"OPERATION_IN_PROGRESS",
			"LOGIN_SESSION_NOT_FOUND",
			"LOGIN_SESSION_EXPIRED",
			"LOGIN_PROTOCOL_ERROR",
			"NEEDS_LOGIN",
			"BRIDGE_NOT_OWNED",
			"CONFIRMATION_REQUIRED",
			"OPERATION_FAILED",
			"METHOD_NOT_ALLOWED",
			"INVALID_JSON",
			"PAYLOAD_TOO_LARGE",
			"UNSUPPORTED_MEDIA_TYPE",
			"VALIDATION_ERROR",
			"ACTIVATION_REQUIRED",
			"SEND_FAILED"
		];
		function isRecord$1(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const prototype = Object.getPrototypeOf(value);
			return prototype === Object.prototype || prototype === null;
		}
		function exact$1(record, required, _optional = []) {
			return required.every((key) => Object.prototype.hasOwnProperty.call(record, key));
		}
		function boundedString$1(value, maximum) {
			return typeof value === "string" && value.length > 0 && value.length <= maximum;
		}
		function timestamp(value) {
			return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
		}
		function parseStatus$1(value) {
			if (!isRecord$1(value) || !exact$1(value, [
				"schemaVersion",
				"provider",
				"availability",
				"auth",
				"process",
				"delivery",
				"operation",
				"capabilities",
				"checkedAt"
			], [
				"pendingLogin",
				"identity",
				"lastError"
			])) throw new WechatConnectionProtocolError("status");
			if (value.schemaVersion !== 1 || value.provider !== "clawbot-wechat" || !availabilityValues.includes(value.availability) || !authValues.includes(value.auth) || !processValues.includes(value.process) || !deliveryValues.includes(value.delivery) || !operationValues.includes(value.operation) || !timestamp(value.checkedAt)) throw new WechatConnectionProtocolError("status");
			const capabilities = value.capabilities;
			if (!isRecord$1(capabilities) || !exact$1(capabilities, [
				"canLogin",
				"canReconnect",
				"canDisconnect"
			]) || typeof capabilities.canLogin !== "boolean" || typeof capabilities.canReconnect !== "boolean" || typeof capabilities.canDisconnect !== "boolean") throw new WechatConnectionProtocolError("status.capabilities");
			let pendingLogin;
			if (value.pendingLogin !== void 0) {
				const pending = value.pendingLogin;
				if (!isRecord$1(pending) || !exact$1(pending, [
					"sessionId",
					"phase",
					"expiresAt"
				]) || !boundedString$1(pending.sessionId, 128) || pending.phase !== "waiting" && pending.phase !== "scanned" || !timestamp(pending.expiresAt)) throw new WechatConnectionProtocolError("status.pendingLogin");
				pendingLogin = {
					sessionId: pending.sessionId,
					phase: pending.phase,
					expiresAt: pending.expiresAt
				};
			}
			let identity;
			if (value.identity !== void 0) {
				if (!isRecord$1(value.identity) || !exact$1(value.identity, ["maskedUserId"]) || typeof value.identity.maskedUserId !== "string" || value.identity.maskedUserId !== "***" && !/^.{4}\*{3}.{4}$/u.test(value.identity.maskedUserId)) throw new WechatConnectionProtocolError("status.identity");
				identity = { maskedUserId: value.identity.maskedUserId };
			}
			let lastError;
			if (value.lastError !== void 0) {
				if (!isRecord$1(value.lastError) || !exact$1(value.lastError, ["code", "message"]) || !boundedString$1(value.lastError.code, 128) || !boundedString$1(value.lastError.message, 512)) throw new WechatConnectionProtocolError("status.lastError");
				lastError = {
					code: value.lastError.code,
					message: value.lastError.message
				};
			}
			return {
				schemaVersion: 1,
				provider: "clawbot-wechat",
				availability: value.availability,
				auth: value.auth,
				process: value.process,
				delivery: value.delivery,
				operation: value.operation,
				capabilities: {
					canLogin: capabilities.canLogin,
					canReconnect: capabilities.canReconnect,
					canDisconnect: capabilities.canDisconnect
				},
				...pendingLogin === void 0 ? {} : { pendingLogin },
				...identity === void 0 ? {} : { identity },
				...lastError === void 0 ? {} : { lastError },
				checkedAt: value.checkedAt
			};
		}
		function parseLogin(value) {
			if (!isRecord$1(value) || !exact$1(value, ["login", "status"]) || !isRecord$1(value.login) || !exact$1(value.login, [
				"sessionId",
				"expiresAt",
				"qrPayload"
			]) || !boundedString$1(value.login.sessionId, 128) || !timestamp(value.login.expiresAt) || !boundedString$1(value.login.qrPayload, 16384)) throw new WechatConnectionProtocolError("login");
			return {
				login: {
					sessionId: value.login.sessionId,
					expiresAt: value.login.expiresAt,
					qrPayload: value.login.qrPayload
				},
				status: parseStatus$1(value.status)
			};
		}
		function parseConfirmation(value) {
			if (!isRecord$1(value) || !exact$1(value, ["result", "status"]) || value.result !== "waiting" && value.result !== "scanned" && value.result !== "confirmed" && value.result !== "expired") throw new WechatConnectionProtocolError("confirmation");
			return {
				result: value.result,
				status: parseStatus$1(value.status)
			};
		}
		function parseTestMessage(value) {
			if (!isRecord$1(value) || !exact$1(value, ["ok"]) || value.ok !== true) throw new WechatConnectionProtocolError("test-message");
			return { ok: true };
		}
		async function readJson$1(response) {
			try {
				return await response.json();
			} catch {
				if (response.ok) throw new WechatConnectionProtocolError("response");
				throw new WechatConnectionApiError(response.status, "HTTP_ERROR", `微信连接请求失败（HTTP ${String(response.status)}）`);
			}
		}
		function parseError(response, value) {
			const fallback = `微信连接请求失败（HTTP ${String(response.status)}）`;
			if (!isRecord$1(value) || !exact$1(value, ["error"]) || !isRecord$1(value.error) || !exact$1(value.error, ["code", "message"]) || typeof value.error.code !== "string" || !knownErrorCodes.includes(value.error.code) || !boundedString$1(value.error.message, 512)) return new WechatConnectionApiError(response.status, "HTTP_ERROR", fallback);
			return new WechatConnectionApiError(response.status, value.error.code, value.error.message);
		}
		async function parseResponse(response, parser) {
			const value = await readJson$1(response);
			if (!response.ok) throw parseError(response, value);
			return parser(value);
		}
		function signalInit(signal) {
			return signal === void 0 ? {} : { signal };
		}
		function createWechatConnectionApi(fetcher = fetch, basePath = "/api/token-monitor/wechat") {
			return {
				async status(signal) {
					return parseResponse(await fetcher(`${basePath}/status`, {
						cache: "no-store",
						...signalInit(signal)
					}), parseStatus$1);
				},
				async login(signal) {
					return parseResponse(await fetcher(`${basePath}/login`, {
						method: "POST",
						cache: "no-store",
						...signalInit(signal)
					}), parseLogin);
				},
				async confirmLogin(sessionId, signal) {
					return parseResponse(await fetcher(`${basePath}/login/confirm`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ sessionId }),
						cache: "no-store",
						...signalInit(signal)
					}), parseConfirmation);
				},
				async reconnect(signal) {
					return parseResponse(await fetcher(`${basePath}/reconnect`, {
						method: "POST",
						cache: "no-store",
						...signalInit(signal)
					}), parseStatus$1);
				},
				async disconnect(signal) {
					return parseResponse(await fetcher(`${basePath}/disconnect`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ confirm: true }),
						cache: "no-store",
						...signalInit(signal)
					}), parseStatus$1);
				},
				async testMessage(message, signal) {
					return parseResponse(await fetcher(`${basePath}/test`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ message }),
						cache: "no-store",
						...signalInit(signal)
					}), parseTestMessage);
				}
			};
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/compactNumber.ts
		const COMPACT_NUMBER_UNITS = [
			{
				threshold: 0xe8d4a51000,
				divisor: 0xe8d4a51000,
				suffix: "万亿"
			},
			{
				threshold: 1e8,
				divisor: 1e8,
				suffix: "亿"
			},
			{
				threshold: 1e7,
				divisor: 1e7,
				suffix: "千万"
			},
			{
				threshold: 1e4,
				divisor: 1e4,
				suffix: "万"
			}
		];
		function trimFraction(value) {
			return value.toFixed(2).replace(/\.?0+$/, "");
		}
		function findCompactUnit(absolute) {
			const index = COMPACT_NUMBER_UNITS.findIndex((candidate) => absolute >= candidate.threshold);
			if (index < 0) return void 0;
			const unit = COMPACT_NUMBER_UNITS[index];
			if (unit === void 0) return void 0;
			const largerIndex = index - 1;
			const largerUnit = largerIndex >= 0 ? COMPACT_NUMBER_UNITS[largerIndex] : void 0;
			const roundedValue = Number((absolute / unit.divisor).toFixed(2));
			return largerUnit !== void 0 && roundedValue * unit.divisor >= largerUnit.threshold ? largerUnit : unit;
		}
		function formatChineseCompactNumber(value) {
			if (!Number.isFinite(value)) return "0";
			const sign = value < 0 ? "-" : "";
			const absolute = Math.abs(value);
			const unit = findCompactUnit(absolute);
			if (unit === void 0) return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
			return `${sign}${trimFraction(absolute / unit.divisor)}${unit.suffix}`;
		}
		function formatChineseCompactCurrency(value) {
			if (!Number.isFinite(value)) return "0.00";
			if (Math.abs(value) < 1e4) return value.toLocaleString("zh-CN", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2
			});
			return formatChineseCompactNumber(value);
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/updateApi.ts
		var TokenMonitorUpdateApiError = class extends Error {
			status;
			code;
			constructor(status, code, message) {
				super(message);
				this.status = status;
				this.code = code;
				this.name = "TokenMonitorUpdateApiError";
			}
		};
		var TokenMonitorUpdateProtocolError = class extends Error {
			field;
			constructor(field) {
				super(`更新接口返回了不符合契约的数据：${field}`);
				this.field = field;
				this.name = "TokenMonitorUpdateProtocolError";
			}
		};
		function record(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function text(value, max = 256) {
			return typeof value === "string" && value.length > 0 && value.length <= max;
		}
		function version(value) {
			return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
		}
		function parseStatus(value) {
			if (!record(value) || !text(value.repository, 200) || !version(value.currentVersion) || !version(value.latestVersion) || typeof value.hasUpdate !== "boolean" || !text(value.releaseUrl, 500) || !record(value.asset) && value.asset !== null) throw new TokenMonitorUpdateProtocolError("status");
			let asset = null;
			if (value.asset !== null) {
				if (!text(value.asset.name, 200) || typeof value.asset.size !== "number" || !Number.isSafeInteger(value.asset.size) || value.asset.size <= 0 || value.asset.digest !== null && !text(value.asset.digest, 100)) throw new TokenMonitorUpdateProtocolError("status.asset");
				asset = {
					name: value.asset.name,
					size: value.asset.size,
					digest: value.asset.digest
				};
			}
			return {
				repository: value.repository,
				currentVersion: value.currentVersion,
				latestVersion: value.latestVersion,
				hasUpdate: value.hasUpdate,
				releaseUrl: value.releaseUrl,
				asset
			};
		}
		async function readJson(response) {
			try {
				return await response.json();
			} catch {
				throw new TokenMonitorUpdateProtocolError("response");
			}
		}
		async function parse(response, parser) {
			const value = await readJson(response);
			if (!response.ok) {
				const error = record(value) && record(value.error) ? value.error : void 0;
				throw new TokenMonitorUpdateApiError(response.status, error && text(error.code, 80) ? error.code : "HTTP_ERROR", error && text(error.message, 512) ? error.message : `更新请求失败（HTTP ${String(response.status)}）`);
			}
			return parser(value);
		}
		function parseInstall(value) {
			if (!record(value) || typeof value.installed !== "boolean" || typeof value.staged !== "boolean" || !text(value.message, 512)) throw new TokenMonitorUpdateProtocolError("install");
			return {
				...parseStatus(value),
				installed: value.installed,
				staged: value.staged,
				...text(value.stagedAsset, 200) ? { stagedAsset: value.stagedAsset } : {},
				...text(value.sha256, 100) ? { sha256: value.sha256 } : {},
				message: value.message
			};
		}
		function createTokenMonitorUpdateApi(fetcher = fetch, basePath = "/api/token-monitor/update") {
			return {
				async check(signal) {
					return parse(await fetcher(basePath, {
						cache: "no-store",
						...signal === void 0 ? {} : { signal }
					}), parseStatus);
				},
				async install(signal) {
					return parse(await fetcher(`${basePath}/install`, {
						method: "POST",
						cache: "no-store",
						...signal === void 0 ? {} : { signal }
					}), parseInstall);
				}
			};
		}
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/can-promise.js
		var require_can_promise = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			module.exports = function() {
				return typeof Promise === "function" && Promise.prototype && Promise.prototype.then;
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/utils.js
		var require_utils$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
			let toSJISFunction;
			const CODEWORDS_COUNT = [
				0,
				26,
				44,
				70,
				100,
				134,
				172,
				196,
				242,
				292,
				346,
				404,
				466,
				532,
				581,
				655,
				733,
				815,
				901,
				991,
				1085,
				1156,
				1258,
				1364,
				1474,
				1588,
				1706,
				1828,
				1921,
				2051,
				2185,
				2323,
				2465,
				2611,
				2761,
				2876,
				3034,
				3196,
				3362,
				3532,
				3706
			];
			/**
			* Returns the QR Code size for the specified version
			*
			* @param  {Number} version QR Code version
			* @return {Number}         size of QR code
			*/
			exports.getSymbolSize = function getSymbolSize(version) {
				if (!version) throw new Error("\"version\" cannot be null or undefined");
				if (version < 1 || version > 40) throw new Error("\"version\" should be in range from 1 to 40");
				return version * 4 + 17;
			};
			/**
			* Returns the total number of codewords used to store data and EC information.
			*
			* @param  {Number} version QR Code version
			* @return {Number}         Data length in bits
			*/
			exports.getSymbolTotalCodewords = function getSymbolTotalCodewords(version) {
				return CODEWORDS_COUNT[version];
			};
			/**
			* Encode data with Bose-Chaudhuri-Hocquenghem
			*
			* @param  {Number} data Value to encode
			* @return {Number}      Encoded value
			*/
			exports.getBCHDigit = function(data) {
				let digit = 0;
				while (data !== 0) {
					digit++;
					data >>>= 1;
				}
				return digit;
			};
			exports.setToSJISFunction = function setToSJISFunction(f) {
				if (typeof f !== "function") throw new Error("\"toSJISFunc\" is not a valid function.");
				toSJISFunction = f;
			};
			exports.isKanjiModeEnabled = function() {
				return typeof toSJISFunction !== "undefined";
			};
			exports.toSJIS = function toSJIS(kanji) {
				return toSJISFunction(kanji);
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/error-correction-level.js
		var require_error_correction_level = /* @__PURE__ */ __commonJSMin(((exports) => {
			exports.L = { bit: 1 };
			exports.M = { bit: 0 };
			exports.Q = { bit: 3 };
			exports.H = { bit: 2 };
			function fromString(string) {
				if (typeof string !== "string") throw new Error("Param is not a string");
				switch (string.toLowerCase()) {
					case "l":
					case "low": return exports.L;
					case "m":
					case "medium": return exports.M;
					case "q":
					case "quartile": return exports.Q;
					case "h":
					case "high": return exports.H;
					default: throw new Error("Unknown EC Level: " + string);
				}
			}
			exports.isValid = function isValid(level) {
				return level && typeof level.bit !== "undefined" && level.bit >= 0 && level.bit < 4;
			};
			exports.from = function from(value, defaultValue) {
				if (exports.isValid(value)) return value;
				try {
					return fromString(value);
				} catch (e) {
					return defaultValue;
				}
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/bit-buffer.js
		var require_bit_buffer = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			function BitBuffer() {
				this.buffer = [];
				this.length = 0;
			}
			BitBuffer.prototype = {
				get: function(index) {
					const bufIndex = Math.floor(index / 8);
					return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
				},
				put: function(num, length) {
					for (let i = 0; i < length; i++) this.putBit((num >>> length - i - 1 & 1) === 1);
				},
				getLengthInBits: function() {
					return this.length;
				},
				putBit: function(bit) {
					const bufIndex = Math.floor(this.length / 8);
					if (this.buffer.length <= bufIndex) this.buffer.push(0);
					if (bit) this.buffer[bufIndex] |= 128 >>> this.length % 8;
					this.length++;
				}
			};
			module.exports = BitBuffer;
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/bit-matrix.js
		var require_bit_matrix = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			/**
			* Helper class to handle QR Code symbol modules
			*
			* @param {Number} size Symbol size
			*/
			function BitMatrix(size) {
				if (!size || size < 1) throw new Error("BitMatrix size must be defined and greater than 0");
				this.size = size;
				this.data = new Uint8Array(size * size);
				this.reservedBit = new Uint8Array(size * size);
			}
			/**
			* Set bit value at specified location
			* If reserved flag is set, this bit will be ignored during masking process
			*
			* @param {Number}  row
			* @param {Number}  col
			* @param {Boolean} value
			* @param {Boolean} reserved
			*/
			BitMatrix.prototype.set = function(row, col, value, reserved) {
				const index = row * this.size + col;
				this.data[index] = value;
				if (reserved) this.reservedBit[index] = true;
			};
			/**
			* Returns bit value at specified location
			*
			* @param  {Number}  row
			* @param  {Number}  col
			* @return {Boolean}
			*/
			BitMatrix.prototype.get = function(row, col) {
				return this.data[row * this.size + col];
			};
			/**
			* Applies xor operator at specified location
			* (used during masking process)
			*
			* @param {Number}  row
			* @param {Number}  col
			* @param {Boolean} value
			*/
			BitMatrix.prototype.xor = function(row, col, value) {
				this.data[row * this.size + col] ^= value;
			};
			/**
			* Check if bit at specified location is reserved
			*
			* @param {Number}   row
			* @param {Number}   col
			* @return {Boolean}
			*/
			BitMatrix.prototype.isReserved = function(row, col) {
				return this.reservedBit[row * this.size + col];
			};
			module.exports = BitMatrix;
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/alignment-pattern.js
		var require_alignment_pattern = /* @__PURE__ */ __commonJSMin(((exports) => {
			/**
			* Alignment pattern are fixed reference pattern in defined positions
			* in a matrix symbology, which enables the decode software to re-synchronise
			* the coordinate mapping of the image modules in the event of moderate amounts
			* of distortion of the image.
			*
			* Alignment patterns are present only in QR Code symbols of version 2 or larger
			* and their number depends on the symbol version.
			*/
			const getSymbolSize = require_utils$1().getSymbolSize;
			/**
			* Calculate the row/column coordinates of the center module of each alignment pattern
			* for the specified QR Code version.
			*
			* The alignment patterns are positioned symmetrically on either side of the diagonal
			* running from the top left corner of the symbol to the bottom right corner.
			*
			* Since positions are simmetrical only half of the coordinates are returned.
			* Each item of the array will represent in turn the x and y coordinate.
			* @see {@link getPositions}
			*
			* @param  {Number} version QR Code version
			* @return {Array}          Array of coordinate
			*/
			exports.getRowColCoords = function getRowColCoords(version) {
				if (version === 1) return [];
				const posCount = Math.floor(version / 7) + 2;
				const size = getSymbolSize(version);
				const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
				const positions = [size - 7];
				for (let i = 1; i < posCount - 1; i++) positions[i] = positions[i - 1] - intervals;
				positions.push(6);
				return positions.reverse();
			};
			/**
			* Returns an array containing the positions of each alignment pattern.
			* Each array's element represent the center point of the pattern as (x, y) coordinates
			*
			* Coordinates are calculated expanding the row/column coordinates returned by {@link getRowColCoords}
			* and filtering out the items that overlaps with finder pattern
			*
			* @example
			* For a Version 7 symbol {@link getRowColCoords} returns values 6, 22 and 38.
			* The alignment patterns, therefore, are to be centered on (row, column)
			* positions (6,22), (22,6), (22,22), (22,38), (38,22), (38,38).
			* Note that the coordinates (6,6), (6,38), (38,6) are occupied by finder patterns
			* and are not therefore used for alignment patterns.
			*
			* let pos = getPositions(7)
			* // [[6,22], [22,6], [22,22], [22,38], [38,22], [38,38]]
			*
			* @param  {Number} version QR Code version
			* @return {Array}          Array of coordinates
			*/
			exports.getPositions = function getPositions(version) {
				const coords = [];
				const pos = exports.getRowColCoords(version);
				const posLength = pos.length;
				for (let i = 0; i < posLength; i++) for (let j = 0; j < posLength; j++) {
					if (i === 0 && j === 0 || i === 0 && j === posLength - 1 || i === posLength - 1 && j === 0) continue;
					coords.push([pos[i], pos[j]]);
				}
				return coords;
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/finder-pattern.js
		var require_finder_pattern = /* @__PURE__ */ __commonJSMin(((exports) => {
			const getSymbolSize = require_utils$1().getSymbolSize;
			const FINDER_PATTERN_SIZE = 7;
			/**
			* Returns an array containing the positions of each finder pattern.
			* Each array's element represent the top-left point of the pattern as (x, y) coordinates
			*
			* @param  {Number} version QR Code version
			* @return {Array}          Array of coordinates
			*/
			exports.getPositions = function getPositions(version) {
				const size = getSymbolSize(version);
				return [
					[0, 0],
					[size - FINDER_PATTERN_SIZE, 0],
					[0, size - FINDER_PATTERN_SIZE]
				];
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/mask-pattern.js
		var require_mask_pattern = /* @__PURE__ */ __commonJSMin(((exports) => {
			/**
			* Data mask pattern reference
			* @type {Object}
			*/
			exports.Patterns = {
				PATTERN000: 0,
				PATTERN001: 1,
				PATTERN010: 2,
				PATTERN011: 3,
				PATTERN100: 4,
				PATTERN101: 5,
				PATTERN110: 6,
				PATTERN111: 7
			};
			/**
			* Weighted penalty scores for the undesirable features
			* @type {Object}
			*/
			const PenaltyScores = {
				N1: 3,
				N2: 3,
				N3: 40,
				N4: 10
			};
			/**
			* Check if mask pattern value is valid
			*
			* @param  {Number}  mask    Mask pattern
			* @return {Boolean}         true if valid, false otherwise
			*/
			exports.isValid = function isValid(mask) {
				return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
			};
			/**
			* Returns mask pattern from a value.
			* If value is not valid, returns undefined
			*
			* @param  {Number|String} value        Mask pattern value
			* @return {Number}                     Valid mask pattern or undefined
			*/
			exports.from = function from(value) {
				return exports.isValid(value) ? parseInt(value, 10) : void 0;
			};
			/**
			* Find adjacent modules in row/column with the same color
			* and assign a penalty value.
			*
			* Points: N1 + i
			* i is the amount by which the number of adjacent modules of the same color exceeds 5
			*/
			exports.getPenaltyN1 = function getPenaltyN1(data) {
				const size = data.size;
				let points = 0;
				let sameCountCol = 0;
				let sameCountRow = 0;
				let lastCol = null;
				let lastRow = null;
				for (let row = 0; row < size; row++) {
					sameCountCol = sameCountRow = 0;
					lastCol = lastRow = null;
					for (let col = 0; col < size; col++) {
						let module$1 = data.get(row, col);
						if (module$1 === lastCol) sameCountCol++;
						else {
							if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
							lastCol = module$1;
							sameCountCol = 1;
						}
						module$1 = data.get(col, row);
						if (module$1 === lastRow) sameCountRow++;
						else {
							if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
							lastRow = module$1;
							sameCountRow = 1;
						}
					}
					if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
					if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
				}
				return points;
			};
			/**
			* Find 2x2 blocks with the same color and assign a penalty value
			*
			* Points: N2 * (m - 1) * (n - 1)
			*/
			exports.getPenaltyN2 = function getPenaltyN2(data) {
				const size = data.size;
				let points = 0;
				for (let row = 0; row < size - 1; row++) for (let col = 0; col < size - 1; col++) {
					const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
					if (last === 4 || last === 0) points++;
				}
				return points * PenaltyScores.N2;
			};
			/**
			* Find 1:1:3:1:1 ratio (dark:light:dark:light:dark) pattern in row/column,
			* preceded or followed by light area 4 modules wide
			*
			* Points: N3 * number of pattern found
			*/
			exports.getPenaltyN3 = function getPenaltyN3(data) {
				const size = data.size;
				let points = 0;
				let bitsCol = 0;
				let bitsRow = 0;
				for (let row = 0; row < size; row++) {
					bitsCol = bitsRow = 0;
					for (let col = 0; col < size; col++) {
						bitsCol = bitsCol << 1 & 2047 | data.get(row, col);
						if (col >= 10 && (bitsCol === 1488 || bitsCol === 93)) points++;
						bitsRow = bitsRow << 1 & 2047 | data.get(col, row);
						if (col >= 10 && (bitsRow === 1488 || bitsRow === 93)) points++;
					}
				}
				return points * PenaltyScores.N3;
			};
			/**
			* Calculate proportion of dark modules in entire symbol
			*
			* Points: N4 * k
			*
			* k is the rating of the deviation of the proportion of dark modules
			* in the symbol from 50% in steps of 5%
			*/
			exports.getPenaltyN4 = function getPenaltyN4(data) {
				let darkCount = 0;
				const modulesCount = data.data.length;
				for (let i = 0; i < modulesCount; i++) darkCount += data.data[i];
				return Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10) * PenaltyScores.N4;
			};
			/**
			* Return mask value at given position
			*
			* @param  {Number} maskPattern Pattern reference value
			* @param  {Number} i           Row
			* @param  {Number} j           Column
			* @return {Boolean}            Mask value
			*/
			function getMaskAt(maskPattern, i, j) {
				switch (maskPattern) {
					case exports.Patterns.PATTERN000: return (i + j) % 2 === 0;
					case exports.Patterns.PATTERN001: return i % 2 === 0;
					case exports.Patterns.PATTERN010: return j % 3 === 0;
					case exports.Patterns.PATTERN011: return (i + j) % 3 === 0;
					case exports.Patterns.PATTERN100: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
					case exports.Patterns.PATTERN101: return i * j % 2 + i * j % 3 === 0;
					case exports.Patterns.PATTERN110: return (i * j % 2 + i * j % 3) % 2 === 0;
					case exports.Patterns.PATTERN111: return (i * j % 3 + (i + j) % 2) % 2 === 0;
					default: throw new Error("bad maskPattern:" + maskPattern);
				}
			}
			/**
			* Apply a mask pattern to a BitMatrix
			*
			* @param  {Number}    pattern Pattern reference number
			* @param  {BitMatrix} data    BitMatrix data
			*/
			exports.applyMask = function applyMask(pattern, data) {
				const size = data.size;
				for (let col = 0; col < size; col++) for (let row = 0; row < size; row++) {
					if (data.isReserved(row, col)) continue;
					data.xor(row, col, getMaskAt(pattern, row, col));
				}
			};
			/**
			* Returns the best mask pattern for data
			*
			* @param  {BitMatrix} data
			* @return {Number} Mask pattern reference number
			*/
			exports.getBestMask = function getBestMask(data, setupFormatFunc) {
				const numPatterns = Object.keys(exports.Patterns).length;
				let bestPattern = 0;
				let lowerPenalty = Infinity;
				for (let p = 0; p < numPatterns; p++) {
					setupFormatFunc(p);
					exports.applyMask(p, data);
					const penalty = exports.getPenaltyN1(data) + exports.getPenaltyN2(data) + exports.getPenaltyN3(data) + exports.getPenaltyN4(data);
					exports.applyMask(p, data);
					if (penalty < lowerPenalty) {
						lowerPenalty = penalty;
						bestPattern = p;
					}
				}
				return bestPattern;
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/error-correction-code.js
		var require_error_correction_code = /* @__PURE__ */ __commonJSMin(((exports) => {
			const ECLevel = require_error_correction_level();
			const EC_BLOCKS_TABLE = [
				1,
				1,
				1,
				1,
				1,
				1,
				1,
				1,
				1,
				1,
				2,
				2,
				1,
				2,
				2,
				4,
				1,
				2,
				4,
				4,
				2,
				4,
				4,
				4,
				2,
				4,
				6,
				5,
				2,
				4,
				6,
				6,
				2,
				5,
				8,
				8,
				4,
				5,
				8,
				8,
				4,
				5,
				8,
				11,
				4,
				8,
				10,
				11,
				4,
				9,
				12,
				16,
				4,
				9,
				16,
				16,
				6,
				10,
				12,
				18,
				6,
				10,
				17,
				16,
				6,
				11,
				16,
				19,
				6,
				13,
				18,
				21,
				7,
				14,
				21,
				25,
				8,
				16,
				20,
				25,
				8,
				17,
				23,
				25,
				9,
				17,
				23,
				34,
				9,
				18,
				25,
				30,
				10,
				20,
				27,
				32,
				12,
				21,
				29,
				35,
				12,
				23,
				34,
				37,
				12,
				25,
				34,
				40,
				13,
				26,
				35,
				42,
				14,
				28,
				38,
				45,
				15,
				29,
				40,
				48,
				16,
				31,
				43,
				51,
				17,
				33,
				45,
				54,
				18,
				35,
				48,
				57,
				19,
				37,
				51,
				60,
				19,
				38,
				53,
				63,
				20,
				40,
				56,
				66,
				21,
				43,
				59,
				70,
				22,
				45,
				62,
				74,
				24,
				47,
				65,
				77,
				25,
				49,
				68,
				81
			];
			const EC_CODEWORDS_TABLE = [
				7,
				10,
				13,
				17,
				10,
				16,
				22,
				28,
				15,
				26,
				36,
				44,
				20,
				36,
				52,
				64,
				26,
				48,
				72,
				88,
				36,
				64,
				96,
				112,
				40,
				72,
				108,
				130,
				48,
				88,
				132,
				156,
				60,
				110,
				160,
				192,
				72,
				130,
				192,
				224,
				80,
				150,
				224,
				264,
				96,
				176,
				260,
				308,
				104,
				198,
				288,
				352,
				120,
				216,
				320,
				384,
				132,
				240,
				360,
				432,
				144,
				280,
				408,
				480,
				168,
				308,
				448,
				532,
				180,
				338,
				504,
				588,
				196,
				364,
				546,
				650,
				224,
				416,
				600,
				700,
				224,
				442,
				644,
				750,
				252,
				476,
				690,
				816,
				270,
				504,
				750,
				900,
				300,
				560,
				810,
				960,
				312,
				588,
				870,
				1050,
				336,
				644,
				952,
				1110,
				360,
				700,
				1020,
				1200,
				390,
				728,
				1050,
				1260,
				420,
				784,
				1140,
				1350,
				450,
				812,
				1200,
				1440,
				480,
				868,
				1290,
				1530,
				510,
				924,
				1350,
				1620,
				540,
				980,
				1440,
				1710,
				570,
				1036,
				1530,
				1800,
				570,
				1064,
				1590,
				1890,
				600,
				1120,
				1680,
				1980,
				630,
				1204,
				1770,
				2100,
				660,
				1260,
				1860,
				2220,
				720,
				1316,
				1950,
				2310,
				750,
				1372,
				2040,
				2430
			];
			/**
			* Returns the number of error correction block that the QR Code should contain
			* for the specified version and error correction level.
			*
			* @param  {Number} version              QR Code version
			* @param  {Number} errorCorrectionLevel Error correction level
			* @return {Number}                      Number of error correction blocks
			*/
			exports.getBlocksCount = function getBlocksCount(version, errorCorrectionLevel) {
				switch (errorCorrectionLevel) {
					case ECLevel.L: return EC_BLOCKS_TABLE[(version - 1) * 4 + 0];
					case ECLevel.M: return EC_BLOCKS_TABLE[(version - 1) * 4 + 1];
					case ECLevel.Q: return EC_BLOCKS_TABLE[(version - 1) * 4 + 2];
					case ECLevel.H: return EC_BLOCKS_TABLE[(version - 1) * 4 + 3];
					default: return;
				}
			};
			/**
			* Returns the number of error correction codewords to use for the specified
			* version and error correction level.
			*
			* @param  {Number} version              QR Code version
			* @param  {Number} errorCorrectionLevel Error correction level
			* @return {Number}                      Number of error correction codewords
			*/
			exports.getTotalCodewordsCount = function getTotalCodewordsCount(version, errorCorrectionLevel) {
				switch (errorCorrectionLevel) {
					case ECLevel.L: return EC_CODEWORDS_TABLE[(version - 1) * 4 + 0];
					case ECLevel.M: return EC_CODEWORDS_TABLE[(version - 1) * 4 + 1];
					case ECLevel.Q: return EC_CODEWORDS_TABLE[(version - 1) * 4 + 2];
					case ECLevel.H: return EC_CODEWORDS_TABLE[(version - 1) * 4 + 3];
					default: return;
				}
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/galois-field.js
		var require_galois_field = /* @__PURE__ */ __commonJSMin(((exports) => {
			const EXP_TABLE = /* @__PURE__ */ new Uint8Array(512);
			const LOG_TABLE = /* @__PURE__ */ new Uint8Array(256);
			(function initTables() {
				let x = 1;
				for (let i = 0; i < 255; i++) {
					EXP_TABLE[i] = x;
					LOG_TABLE[x] = i;
					x <<= 1;
					if (x & 256) x ^= 285;
				}
				for (let i = 255; i < 512; i++) EXP_TABLE[i] = EXP_TABLE[i - 255];
			})();
			/**
			* Returns log value of n inside Galois Field
			*
			* @param  {Number} n
			* @return {Number}
			*/
			exports.log = function log(n) {
				if (n < 1) throw new Error("log(" + n + ")");
				return LOG_TABLE[n];
			};
			/**
			* Returns anti-log value of n inside Galois Field
			*
			* @param  {Number} n
			* @return {Number}
			*/
			exports.exp = function exp(n) {
				return EXP_TABLE[n];
			};
			/**
			* Multiplies two number inside Galois Field
			*
			* @param  {Number} x
			* @param  {Number} y
			* @return {Number}
			*/
			exports.mul = function mul(x, y) {
				if (x === 0 || y === 0) return 0;
				return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/polynomial.js
		var require_polynomial = /* @__PURE__ */ __commonJSMin(((exports) => {
			const GF = require_galois_field();
			/**
			* Multiplies two polynomials inside Galois Field
			*
			* @param  {Uint8Array} p1 Polynomial
			* @param  {Uint8Array} p2 Polynomial
			* @return {Uint8Array}    Product of p1 and p2
			*/
			exports.mul = function mul(p1, p2) {
				const coeff = new Uint8Array(p1.length + p2.length - 1);
				for (let i = 0; i < p1.length; i++) for (let j = 0; j < p2.length; j++) coeff[i + j] ^= GF.mul(p1[i], p2[j]);
				return coeff;
			};
			/**
			* Calculate the remainder of polynomials division
			*
			* @param  {Uint8Array} divident Polynomial
			* @param  {Uint8Array} divisor  Polynomial
			* @return {Uint8Array}          Remainder
			*/
			exports.mod = function mod(divident, divisor) {
				let result = new Uint8Array(divident);
				while (result.length - divisor.length >= 0) {
					const coeff = result[0];
					for (let i = 0; i < divisor.length; i++) result[i] ^= GF.mul(divisor[i], coeff);
					let offset = 0;
					while (offset < result.length && result[offset] === 0) offset++;
					result = result.slice(offset);
				}
				return result;
			};
			/**
			* Generate an irreducible generator polynomial of specified degree
			* (used by Reed-Solomon encoder)
			*
			* @param  {Number} degree Degree of the generator polynomial
			* @return {Uint8Array}    Buffer containing polynomial coefficients
			*/
			exports.generateECPolynomial = function generateECPolynomial(degree) {
				let poly = new Uint8Array([1]);
				for (let i = 0; i < degree; i++) poly = exports.mul(poly, new Uint8Array([1, GF.exp(i)]));
				return poly;
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/reed-solomon-encoder.js
		var require_reed_solomon_encoder = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			const Polynomial = require_polynomial();
			function ReedSolomonEncoder(degree) {
				this.genPoly = void 0;
				this.degree = degree;
				if (this.degree) this.initialize(this.degree);
			}
			/**
			* Initialize the encoder.
			* The input param should correspond to the number of error correction codewords.
			*
			* @param  {Number} degree
			*/
			ReedSolomonEncoder.prototype.initialize = function initialize(degree) {
				this.degree = degree;
				this.genPoly = Polynomial.generateECPolynomial(this.degree);
			};
			/**
			* Encodes a chunk of data
			*
			* @param  {Uint8Array} data Buffer containing input data
			* @return {Uint8Array}      Buffer containing encoded data
			*/
			ReedSolomonEncoder.prototype.encode = function encode(data) {
				if (!this.genPoly) throw new Error("Encoder not initialized");
				const paddedData = new Uint8Array(data.length + this.degree);
				paddedData.set(data);
				const remainder = Polynomial.mod(paddedData, this.genPoly);
				const start = this.degree - remainder.length;
				if (start > 0) {
					const buff = new Uint8Array(this.degree);
					buff.set(remainder, start);
					return buff;
				}
				return remainder;
			};
			module.exports = ReedSolomonEncoder;
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/version-check.js
		var require_version_check = /* @__PURE__ */ __commonJSMin(((exports) => {
			/**
			* Check if QR Code version is valid
			*
			* @param  {Number}  version QR Code version
			* @return {Boolean}         true if valid version, false otherwise
			*/
			exports.isValid = function isValid(version) {
				return !isNaN(version) && version >= 1 && version <= 40;
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/regex.js
		var require_regex = /* @__PURE__ */ __commonJSMin(((exports) => {
			const numeric = "[0-9]+";
			const alphanumeric = "[A-Z $%*+\\-./:]+";
			let kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
			kanji = kanji.replace(/u/g, "\\u");
			const byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + ")(?:.|[\r\n]))+";
			exports.KANJI = new RegExp(kanji, "g");
			exports.BYTE_KANJI = /* @__PURE__ */ new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
			exports.BYTE = new RegExp(byte, "g");
			exports.NUMERIC = new RegExp(numeric, "g");
			exports.ALPHANUMERIC = new RegExp(alphanumeric, "g");
			const TEST_KANJI = new RegExp("^" + kanji + "$");
			const TEST_NUMERIC = /* @__PURE__ */ new RegExp("^[0-9]+$");
			const TEST_ALPHANUMERIC = /* @__PURE__ */ new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
			exports.testKanji = function testKanji(str) {
				return TEST_KANJI.test(str);
			};
			exports.testNumeric = function testNumeric(str) {
				return TEST_NUMERIC.test(str);
			};
			exports.testAlphanumeric = function testAlphanumeric(str) {
				return TEST_ALPHANUMERIC.test(str);
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/mode.js
		var require_mode = /* @__PURE__ */ __commonJSMin(((exports) => {
			const VersionCheck = require_version_check();
			const Regex = require_regex();
			/**
			* Numeric mode encodes data from the decimal digit set (0 - 9)
			* (byte values 30HEX to 39HEX).
			* Normally, 3 data characters are represented by 10 bits.
			*
			* @type {Object}
			*/
			exports.NUMERIC = {
				id: "Numeric",
				bit: 1,
				ccBits: [
					10,
					12,
					14
				]
			};
			/**
			* Alphanumeric mode encodes data from a set of 45 characters,
			* i.e. 10 numeric digits (0 - 9),
			*      26 alphabetic characters (A - Z),
			*   and 9 symbols (SP, $, %, *, +, -, ., /, :).
			* Normally, two input characters are represented by 11 bits.
			*
			* @type {Object}
			*/
			exports.ALPHANUMERIC = {
				id: "Alphanumeric",
				bit: 2,
				ccBits: [
					9,
					11,
					13
				]
			};
			/**
			* In byte mode, data is encoded at 8 bits per character.
			*
			* @type {Object}
			*/
			exports.BYTE = {
				id: "Byte",
				bit: 4,
				ccBits: [
					8,
					16,
					16
				]
			};
			/**
			* The Kanji mode efficiently encodes Kanji characters in accordance with
			* the Shift JIS system based on JIS X 0208.
			* The Shift JIS values are shifted from the JIS X 0208 values.
			* JIS X 0208 gives details of the shift coded representation.
			* Each two-byte character value is compacted to a 13-bit binary codeword.
			*
			* @type {Object}
			*/
			exports.KANJI = {
				id: "Kanji",
				bit: 8,
				ccBits: [
					8,
					10,
					12
				]
			};
			/**
			* Mixed mode will contain a sequences of data in a combination of any of
			* the modes described above
			*
			* @type {Object}
			*/
			exports.MIXED = { bit: -1 };
			/**
			* Returns the number of bits needed to store the data length
			* according to QR Code specifications.
			*
			* @param  {Mode}   mode    Data mode
			* @param  {Number} version QR Code version
			* @return {Number}         Number of bits
			*/
			exports.getCharCountIndicator = function getCharCountIndicator(mode, version) {
				if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
				if (!VersionCheck.isValid(version)) throw new Error("Invalid version: " + version);
				if (version >= 1 && version < 10) return mode.ccBits[0];
				else if (version < 27) return mode.ccBits[1];
				return mode.ccBits[2];
			};
			/**
			* Returns the most efficient mode to store the specified data
			*
			* @param  {String} dataStr Input data string
			* @return {Mode}           Best mode
			*/
			exports.getBestModeForData = function getBestModeForData(dataStr) {
				if (Regex.testNumeric(dataStr)) return exports.NUMERIC;
				else if (Regex.testAlphanumeric(dataStr)) return exports.ALPHANUMERIC;
				else if (Regex.testKanji(dataStr)) return exports.KANJI;
				else return exports.BYTE;
			};
			/**
			* Return mode name as string
			*
			* @param {Mode} mode Mode object
			* @returns {String}  Mode name
			*/
			exports.toString = function toString(mode) {
				if (mode && mode.id) return mode.id;
				throw new Error("Invalid mode");
			};
			/**
			* Check if input param is a valid mode object
			*
			* @param   {Mode}    mode Mode object
			* @returns {Boolean} True if valid mode, false otherwise
			*/
			exports.isValid = function isValid(mode) {
				return mode && mode.bit && mode.ccBits;
			};
			/**
			* Get mode object from its name
			*
			* @param   {String} string Mode name
			* @returns {Mode}          Mode object
			*/
			function fromString(string) {
				if (typeof string !== "string") throw new Error("Param is not a string");
				switch (string.toLowerCase()) {
					case "numeric": return exports.NUMERIC;
					case "alphanumeric": return exports.ALPHANUMERIC;
					case "kanji": return exports.KANJI;
					case "byte": return exports.BYTE;
					default: throw new Error("Unknown mode: " + string);
				}
			}
			/**
			* Returns mode from a value.
			* If value is not a valid mode, returns defaultValue
			*
			* @param  {Mode|String} value        Encoding mode
			* @param  {Mode}        defaultValue Fallback value
			* @return {Mode}                     Encoding mode
			*/
			exports.from = function from(value, defaultValue) {
				if (exports.isValid(value)) return value;
				try {
					return fromString(value);
				} catch (e) {
					return defaultValue;
				}
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/version.js
		var require_version = /* @__PURE__ */ __commonJSMin(((exports) => {
			const Utils = require_utils$1();
			const ECCode = require_error_correction_code();
			const ECLevel = require_error_correction_level();
			const Mode = require_mode();
			const VersionCheck = require_version_check();
			const G18 = 7973;
			const G18_BCH = Utils.getBCHDigit(G18);
			function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
				for (let currentVersion = 1; currentVersion <= 40; currentVersion++) if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, mode)) return currentVersion;
			}
			function getReservedBitsCount(mode, version) {
				return Mode.getCharCountIndicator(mode, version) + 4;
			}
			function getTotalBitsFromDataArray(segments, version) {
				let totalBits = 0;
				segments.forEach(function(data) {
					const reservedBits = getReservedBitsCount(data.mode, version);
					totalBits += reservedBits + data.getBitsLength();
				});
				return totalBits;
			}
			function getBestVersionForMixedData(segments, errorCorrectionLevel) {
				for (let currentVersion = 1; currentVersion <= 40; currentVersion++) if (getTotalBitsFromDataArray(segments, currentVersion) <= exports.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED)) return currentVersion;
			}
			/**
			* Returns version number from a value.
			* If value is not a valid version, returns defaultValue
			*
			* @param  {Number|String} value        QR Code version
			* @param  {Number}        defaultValue Fallback value
			* @return {Number}                     QR Code version number
			*/
			exports.from = function from(value, defaultValue) {
				if (VersionCheck.isValid(value)) return parseInt(value, 10);
				return defaultValue;
			};
			/**
			* Returns how much data can be stored with the specified QR code version
			* and error correction level
			*
			* @param  {Number} version              QR Code version (1-40)
			* @param  {Number} errorCorrectionLevel Error correction level
			* @param  {Mode}   mode                 Data mode
			* @return {Number}                      Quantity of storable data
			*/
			exports.getCapacity = function getCapacity(version, errorCorrectionLevel, mode) {
				if (!VersionCheck.isValid(version)) throw new Error("Invalid QR Code version");
				if (typeof mode === "undefined") mode = Mode.BYTE;
				const dataTotalCodewordsBits = (Utils.getSymbolTotalCodewords(version) - ECCode.getTotalCodewordsCount(version, errorCorrectionLevel)) * 8;
				if (mode === Mode.MIXED) return dataTotalCodewordsBits;
				const usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version);
				switch (mode) {
					case Mode.NUMERIC: return Math.floor(usableBits / 10 * 3);
					case Mode.ALPHANUMERIC: return Math.floor(usableBits / 11 * 2);
					case Mode.KANJI: return Math.floor(usableBits / 13);
					case Mode.BYTE:
					default: return Math.floor(usableBits / 8);
				}
			};
			/**
			* Returns the minimum version needed to contain the amount of data
			*
			* @param  {Segment} data                    Segment of data
			* @param  {Number} [errorCorrectionLevel=H] Error correction level
			* @param  {Mode} mode                       Data mode
			* @return {Number}                          QR Code version
			*/
			exports.getBestVersionForData = function getBestVersionForData(data, errorCorrectionLevel) {
				let seg;
				const ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
				if (Array.isArray(data)) {
					if (data.length > 1) return getBestVersionForMixedData(data, ecl);
					if (data.length === 0) return 1;
					seg = data[0];
				} else seg = data;
				return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
			};
			/**
			* Returns version information with relative error correction bits
			*
			* The version information is included in QR Code symbols of version 7 or larger.
			* It consists of an 18-bit sequence containing 6 data bits,
			* with 12 error correction bits calculated using the (18, 6) Golay code.
			*
			* @param  {Number} version QR Code version
			* @return {Number}         Encoded version info bits
			*/
			exports.getEncodedBits = function getEncodedBits(version) {
				if (!VersionCheck.isValid(version) || version < 7) throw new Error("Invalid QR Code version");
				let d = version << 12;
				while (Utils.getBCHDigit(d) - G18_BCH >= 0) d ^= G18 << Utils.getBCHDigit(d) - G18_BCH;
				return version << 12 | d;
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/format-info.js
		var require_format_info = /* @__PURE__ */ __commonJSMin(((exports) => {
			const Utils = require_utils$1();
			const G15 = 1335;
			const G15_MASK = 21522;
			const G15_BCH = Utils.getBCHDigit(G15);
			/**
			* Returns format information with relative error correction bits
			*
			* The format information is a 15-bit sequence containing 5 data bits,
			* with 10 error correction bits calculated using the (15, 5) BCH code.
			*
			* @param  {Number} errorCorrectionLevel Error correction level
			* @param  {Number} mask                 Mask pattern
			* @return {Number}                      Encoded format information bits
			*/
			exports.getEncodedBits = function getEncodedBits(errorCorrectionLevel, mask) {
				const data = errorCorrectionLevel.bit << 3 | mask;
				let d = data << 10;
				while (Utils.getBCHDigit(d) - G15_BCH >= 0) d ^= G15 << Utils.getBCHDigit(d) - G15_BCH;
				return (data << 10 | d) ^ G15_MASK;
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/numeric-data.js
		var require_numeric_data = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			const Mode = require_mode();
			function NumericData(data) {
				this.mode = Mode.NUMERIC;
				this.data = data.toString();
			}
			NumericData.getBitsLength = function getBitsLength(length) {
				return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
			};
			NumericData.prototype.getLength = function getLength() {
				return this.data.length;
			};
			NumericData.prototype.getBitsLength = function getBitsLength() {
				return NumericData.getBitsLength(this.data.length);
			};
			NumericData.prototype.write = function write(bitBuffer) {
				let i, group, value;
				for (i = 0; i + 3 <= this.data.length; i += 3) {
					group = this.data.substr(i, 3);
					value = parseInt(group, 10);
					bitBuffer.put(value, 10);
				}
				const remainingNum = this.data.length - i;
				if (remainingNum > 0) {
					group = this.data.substr(i);
					value = parseInt(group, 10);
					bitBuffer.put(value, remainingNum * 3 + 1);
				}
			};
			module.exports = NumericData;
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/alphanumeric-data.js
		var require_alphanumeric_data = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			const Mode = require_mode();
			/**
			* Array of characters available in alphanumeric mode
			*
			* As per QR Code specification, to each character
			* is assigned a value from 0 to 44 which in this case coincides
			* with the array index
			*
			* @type {Array}
			*/
			const ALPHA_NUM_CHARS = [
				"0",
				"1",
				"2",
				"3",
				"4",
				"5",
				"6",
				"7",
				"8",
				"9",
				"A",
				"B",
				"C",
				"D",
				"E",
				"F",
				"G",
				"H",
				"I",
				"J",
				"K",
				"L",
				"M",
				"N",
				"O",
				"P",
				"Q",
				"R",
				"S",
				"T",
				"U",
				"V",
				"W",
				"X",
				"Y",
				"Z",
				" ",
				"$",
				"%",
				"*",
				"+",
				"-",
				".",
				"/",
				":"
			];
			function AlphanumericData(data) {
				this.mode = Mode.ALPHANUMERIC;
				this.data = data;
			}
			AlphanumericData.getBitsLength = function getBitsLength(length) {
				return 11 * Math.floor(length / 2) + 6 * (length % 2);
			};
			AlphanumericData.prototype.getLength = function getLength() {
				return this.data.length;
			};
			AlphanumericData.prototype.getBitsLength = function getBitsLength() {
				return AlphanumericData.getBitsLength(this.data.length);
			};
			AlphanumericData.prototype.write = function write(bitBuffer) {
				let i;
				for (i = 0; i + 2 <= this.data.length; i += 2) {
					let value = ALPHA_NUM_CHARS.indexOf(this.data[i]) * 45;
					value += ALPHA_NUM_CHARS.indexOf(this.data[i + 1]);
					bitBuffer.put(value, 11);
				}
				if (this.data.length % 2) bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i]), 6);
			};
			module.exports = AlphanumericData;
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/byte-data.js
		var require_byte_data = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			const Mode = require_mode();
			function ByteData(data) {
				this.mode = Mode.BYTE;
				if (typeof data === "string") this.data = new TextEncoder().encode(data);
				else this.data = new Uint8Array(data);
			}
			ByteData.getBitsLength = function getBitsLength(length) {
				return length * 8;
			};
			ByteData.prototype.getLength = function getLength() {
				return this.data.length;
			};
			ByteData.prototype.getBitsLength = function getBitsLength() {
				return ByteData.getBitsLength(this.data.length);
			};
			ByteData.prototype.write = function(bitBuffer) {
				for (let i = 0, l = this.data.length; i < l; i++) bitBuffer.put(this.data[i], 8);
			};
			module.exports = ByteData;
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/kanji-data.js
		var require_kanji_data = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			const Mode = require_mode();
			const Utils = require_utils$1();
			function KanjiData(data) {
				this.mode = Mode.KANJI;
				this.data = data;
			}
			KanjiData.getBitsLength = function getBitsLength(length) {
				return length * 13;
			};
			KanjiData.prototype.getLength = function getLength() {
				return this.data.length;
			};
			KanjiData.prototype.getBitsLength = function getBitsLength() {
				return KanjiData.getBitsLength(this.data.length);
			};
			KanjiData.prototype.write = function(bitBuffer) {
				let i;
				for (i = 0; i < this.data.length; i++) {
					let value = Utils.toSJIS(this.data[i]);
					if (value >= 33088 && value <= 40956) value -= 33088;
					else if (value >= 57408 && value <= 60351) value -= 49472;
					else throw new Error("Invalid SJIS character: " + this.data[i] + "\nMake sure your charset is UTF-8");
					value = (value >>> 8 & 255) * 192 + (value & 255);
					bitBuffer.put(value, 13);
				}
			};
			module.exports = KanjiData;
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/dijkstrajs@1.0.3/node_modules/dijkstrajs/dijkstra.js
		var require_dijkstra = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			/******************************************************************************
			* Created 2008-08-19.
			*
			* Dijkstra path-finding functions. Adapted from the Dijkstar Python project.
			*
			* Copyright (C) 2008
			*   Wyatt Baldwin <self@wyattbaldwin.com>
			*   All rights reserved
			*
			* Licensed under the MIT license.
			*
			*   http://www.opensource.org/licenses/mit-license.php
			*
			* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
			* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
			* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
			* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
			* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
			* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
			* THE SOFTWARE.
			*****************************************************************************/
			var dijkstra = {
				single_source_shortest_paths: function(graph, s, d) {
					var predecessors = {};
					var costs = {};
					costs[s] = 0;
					var open = dijkstra.PriorityQueue.make();
					open.push(s, 0);
					var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit;
					while (!open.empty()) {
						closest = open.pop();
						u = closest.value;
						cost_of_s_to_u = closest.cost;
						adjacent_nodes = graph[u] || {};
						for (v in adjacent_nodes) if (adjacent_nodes.hasOwnProperty(v)) {
							cost_of_e = adjacent_nodes[v];
							cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e;
							cost_of_s_to_v = costs[v];
							first_visit = typeof costs[v] === "undefined";
							if (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) {
								costs[v] = cost_of_s_to_u_plus_cost_of_e;
								open.push(v, cost_of_s_to_u_plus_cost_of_e);
								predecessors[v] = u;
							}
						}
					}
					if (typeof d !== "undefined" && typeof costs[d] === "undefined") {
						var msg = [
							"Could not find a path from ",
							s,
							" to ",
							d,
							"."
						].join("");
						throw new Error(msg);
					}
					return predecessors;
				},
				extract_shortest_path_from_predecessor_list: function(predecessors, d) {
					var nodes = [];
					var u = d;
					while (u) {
						nodes.push(u);
						predecessors[u];
						u = predecessors[u];
					}
					nodes.reverse();
					return nodes;
				},
				find_path: function(graph, s, d) {
					var predecessors = dijkstra.single_source_shortest_paths(graph, s, d);
					return dijkstra.extract_shortest_path_from_predecessor_list(predecessors, d);
				},
				/**
				* A very naive priority queue implementation.
				*/
				PriorityQueue: {
					make: function(opts) {
						var T = dijkstra.PriorityQueue, t = {}, key;
						opts = opts || {};
						for (key in T) if (T.hasOwnProperty(key)) t[key] = T[key];
						t.queue = [];
						t.sorter = opts.sorter || T.default_sorter;
						return t;
					},
					default_sorter: function(a, b) {
						return a.cost - b.cost;
					},
					/**
					* Add a new item to the queue and ensure the highest priority element
					* is at the front of the queue.
					*/
					push: function(value, cost) {
						var item = {
							value,
							cost
						};
						this.queue.push(item);
						this.queue.sort(this.sorter);
					},
					/**
					* Return the highest priority element in the queue.
					*/
					pop: function() {
						return this.queue.shift();
					},
					empty: function() {
						return this.queue.length === 0;
					}
				}
			};
			if (typeof module !== "undefined") module.exports = dijkstra;
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/segments.js
		var require_segments = /* @__PURE__ */ __commonJSMin(((exports) => {
			const Mode = require_mode();
			const NumericData = require_numeric_data();
			const AlphanumericData = require_alphanumeric_data();
			const ByteData = require_byte_data();
			const KanjiData = require_kanji_data();
			const Regex = require_regex();
			const Utils = require_utils$1();
			const dijkstra = require_dijkstra();
			/**
			* Returns UTF8 byte length
			*
			* @param  {String} str Input string
			* @return {Number}     Number of byte
			*/
			function getStringByteLength(str) {
				return unescape(encodeURIComponent(str)).length;
			}
			/**
			* Get a list of segments of the specified mode
			* from a string
			*
			* @param  {Mode}   mode Segment mode
			* @param  {String} str  String to process
			* @return {Array}       Array of object with segments data
			*/
			function getSegments(regex, mode, str) {
				const segments = [];
				let result;
				while ((result = regex.exec(str)) !== null) segments.push({
					data: result[0],
					index: result.index,
					mode,
					length: result[0].length
				});
				return segments;
			}
			/**
			* Extracts a series of segments with the appropriate
			* modes from a string
			*
			* @param  {String} dataStr Input string
			* @return {Array}          Array of object with segments data
			*/
			function getSegmentsFromString(dataStr) {
				const numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr);
				const alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr);
				let byteSegs;
				let kanjiSegs;
				if (Utils.isKanjiModeEnabled()) {
					byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr);
					kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr);
				} else {
					byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr);
					kanjiSegs = [];
				}
				return numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs).sort(function(s1, s2) {
					return s1.index - s2.index;
				}).map(function(obj) {
					return {
						data: obj.data,
						mode: obj.mode,
						length: obj.length
					};
				});
			}
			/**
			* Returns how many bits are needed to encode a string of
			* specified length with the specified mode
			*
			* @param  {Number} length String length
			* @param  {Mode} mode     Segment mode
			* @return {Number}        Bit length
			*/
			function getSegmentBitsLength(length, mode) {
				switch (mode) {
					case Mode.NUMERIC: return NumericData.getBitsLength(length);
					case Mode.ALPHANUMERIC: return AlphanumericData.getBitsLength(length);
					case Mode.KANJI: return KanjiData.getBitsLength(length);
					case Mode.BYTE: return ByteData.getBitsLength(length);
				}
			}
			/**
			* Merges adjacent segments which have the same mode
			*
			* @param  {Array} segs Array of object with segments data
			* @return {Array}      Array of object with segments data
			*/
			function mergeSegments(segs) {
				return segs.reduce(function(acc, curr) {
					const prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
					if (prevSeg && prevSeg.mode === curr.mode) {
						acc[acc.length - 1].data += curr.data;
						return acc;
					}
					acc.push(curr);
					return acc;
				}, []);
			}
			/**
			* Generates a list of all possible nodes combination which
			* will be used to build a segments graph.
			*
			* Nodes are divided by groups. Each group will contain a list of all the modes
			* in which is possible to encode the given text.
			*
			* For example the text '12345' can be encoded as Numeric, Alphanumeric or Byte.
			* The group for '12345' will contain then 3 objects, one for each
			* possible encoding mode.
			*
			* Each node represents a possible segment.
			*
			* @param  {Array} segs Array of object with segments data
			* @return {Array}      Array of object with segments data
			*/
			function buildNodes(segs) {
				const nodes = [];
				for (let i = 0; i < segs.length; i++) {
					const seg = segs[i];
					switch (seg.mode) {
						case Mode.NUMERIC:
							nodes.push([
								seg,
								{
									data: seg.data,
									mode: Mode.ALPHANUMERIC,
									length: seg.length
								},
								{
									data: seg.data,
									mode: Mode.BYTE,
									length: seg.length
								}
							]);
							break;
						case Mode.ALPHANUMERIC:
							nodes.push([seg, {
								data: seg.data,
								mode: Mode.BYTE,
								length: seg.length
							}]);
							break;
						case Mode.KANJI:
							nodes.push([seg, {
								data: seg.data,
								mode: Mode.BYTE,
								length: getStringByteLength(seg.data)
							}]);
							break;
						case Mode.BYTE: nodes.push([{
							data: seg.data,
							mode: Mode.BYTE,
							length: getStringByteLength(seg.data)
						}]);
					}
				}
				return nodes;
			}
			/**
			* Builds a graph from a list of nodes.
			* All segments in each node group will be connected with all the segments of
			* the next group and so on.
			*
			* At each connection will be assigned a weight depending on the
			* segment's byte length.
			*
			* @param  {Array} nodes    Array of object with segments data
			* @param  {Number} version QR Code version
			* @return {Object}         Graph of all possible segments
			*/
			function buildGraph(nodes, version) {
				const table = {};
				const graph = { start: {} };
				let prevNodeIds = ["start"];
				for (let i = 0; i < nodes.length; i++) {
					const nodeGroup = nodes[i];
					const currentNodeIds = [];
					for (let j = 0; j < nodeGroup.length; j++) {
						const node = nodeGroup[j];
						const key = "" + i + j;
						currentNodeIds.push(key);
						table[key] = {
							node,
							lastCount: 0
						};
						graph[key] = {};
						for (let n = 0; n < prevNodeIds.length; n++) {
							const prevNodeId = prevNodeIds[n];
							if (table[prevNodeId] && table[prevNodeId].node.mode === node.mode) {
								graph[prevNodeId][key] = getSegmentBitsLength(table[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table[prevNodeId].lastCount, node.mode);
								table[prevNodeId].lastCount += node.length;
							} else {
								if (table[prevNodeId]) table[prevNodeId].lastCount = node.length;
								graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version);
							}
						}
					}
					prevNodeIds = currentNodeIds;
				}
				for (let n = 0; n < prevNodeIds.length; n++) graph[prevNodeIds[n]].end = 0;
				return {
					map: graph,
					table
				};
			}
			/**
			* Builds a segment from a specified data and mode.
			* If a mode is not specified, the more suitable will be used.
			*
			* @param  {String} data             Input data
			* @param  {Mode | String} modesHint Data mode
			* @return {Segment}                 Segment
			*/
			function buildSingleSegment(data, modesHint) {
				let mode;
				const bestMode = Mode.getBestModeForData(data);
				mode = Mode.from(modesHint, bestMode);
				if (mode !== Mode.BYTE && mode.bit < bestMode.bit) throw new Error("\"" + data + "\" cannot be encoded with mode " + Mode.toString(mode) + ".\n Suggested mode is: " + Mode.toString(bestMode));
				if (mode === Mode.KANJI && !Utils.isKanjiModeEnabled()) mode = Mode.BYTE;
				switch (mode) {
					case Mode.NUMERIC: return new NumericData(data);
					case Mode.ALPHANUMERIC: return new AlphanumericData(data);
					case Mode.KANJI: return new KanjiData(data);
					case Mode.BYTE: return new ByteData(data);
				}
			}
			/**
			* Builds a list of segments from an array.
			* Array can contain Strings or Objects with segment's info.
			*
			* For each item which is a string, will be generated a segment with the given
			* string and the more appropriate encoding mode.
			*
			* For each item which is an object, will be generated a segment with the given
			* data and mode.
			* Objects must contain at least the property "data".
			* If property "mode" is not present, the more suitable mode will be used.
			*
			* @param  {Array} array Array of objects with segments data
			* @return {Array}       Array of Segments
			*/
			exports.fromArray = function fromArray(array) {
				return array.reduce(function(acc, seg) {
					if (typeof seg === "string") acc.push(buildSingleSegment(seg, null));
					else if (seg.data) acc.push(buildSingleSegment(seg.data, seg.mode));
					return acc;
				}, []);
			};
			/**
			* Builds an optimized sequence of segments from a string,
			* which will produce the shortest possible bitstream.
			*
			* @param  {String} data    Input string
			* @param  {Number} version QR Code version
			* @return {Array}          Array of segments
			*/
			exports.fromString = function fromString(data, version) {
				const graph = buildGraph(buildNodes(getSegmentsFromString(data, Utils.isKanjiModeEnabled())), version);
				const path = dijkstra.find_path(graph.map, "start", "end");
				const optimizedSegs = [];
				for (let i = 1; i < path.length - 1; i++) optimizedSegs.push(graph.table[path[i]].node);
				return exports.fromArray(mergeSegments(optimizedSegs));
			};
			/**
			* Splits a string in various segments with the modes which
			* best represent their content.
			* The produced segments are far from being optimized.
			* The output of this function is only used to estimate a QR Code version
			* which may contain the data.
			*
			* @param  {string} data Input string
			* @return {Array}       Array of segments
			*/
			exports.rawSplit = function rawSplit(data) {
				return exports.fromArray(getSegmentsFromString(data, Utils.isKanjiModeEnabled()));
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/qrcode.js
		var require_qrcode = /* @__PURE__ */ __commonJSMin(((exports) => {
			const Utils = require_utils$1();
			const ECLevel = require_error_correction_level();
			const BitBuffer = require_bit_buffer();
			const BitMatrix = require_bit_matrix();
			const AlignmentPattern = require_alignment_pattern();
			const FinderPattern = require_finder_pattern();
			const MaskPattern = require_mask_pattern();
			const ECCode = require_error_correction_code();
			const ReedSolomonEncoder = require_reed_solomon_encoder();
			const Version = require_version();
			const FormatInfo = require_format_info();
			const Mode = require_mode();
			const Segments = require_segments();
			/**
			* QRCode for JavaScript
			*
			* modified by Ryan Day for nodejs support
			* Copyright (c) 2011 Ryan Day
			*
			* Licensed under the MIT license:
			*   http://www.opensource.org/licenses/mit-license.php
			*
			//---------------------------------------------------------------------
			// QRCode for JavaScript
			//
			// Copyright (c) 2009 Kazuhiko Arase
			//
			// URL: http://www.d-project.com/
			//
			// Licensed under the MIT license:
			//   http://www.opensource.org/licenses/mit-license.php
			//
			// The word "QR Code" is registered trademark of
			// DENSO WAVE INCORPORATED
			//   http://www.denso-wave.com/qrcode/faqpatent-e.html
			//
			//---------------------------------------------------------------------
			*/
			/**
			* Add finder patterns bits to matrix
			*
			* @param  {BitMatrix} matrix  Modules matrix
			* @param  {Number}    version QR Code version
			*/
			function setupFinderPattern(matrix, version) {
				const size = matrix.size;
				const pos = FinderPattern.getPositions(version);
				for (let i = 0; i < pos.length; i++) {
					const row = pos[i][0];
					const col = pos[i][1];
					for (let r = -1; r <= 7; r++) {
						if (row + r <= -1 || size <= row + r) continue;
						for (let c = -1; c <= 7; c++) {
							if (col + c <= -1 || size <= col + c) continue;
							if (r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4) matrix.set(row + r, col + c, true, true);
							else matrix.set(row + r, col + c, false, true);
						}
					}
				}
			}
			/**
			* Add timing pattern bits to matrix
			*
			* Note: this function must be called before {@link setupAlignmentPattern}
			*
			* @param  {BitMatrix} matrix Modules matrix
			*/
			function setupTimingPattern(matrix) {
				const size = matrix.size;
				for (let r = 8; r < size - 8; r++) {
					const value = r % 2 === 0;
					matrix.set(r, 6, value, true);
					matrix.set(6, r, value, true);
				}
			}
			/**
			* Add alignment patterns bits to matrix
			*
			* Note: this function must be called after {@link setupTimingPattern}
			*
			* @param  {BitMatrix} matrix  Modules matrix
			* @param  {Number}    version QR Code version
			*/
			function setupAlignmentPattern(matrix, version) {
				const pos = AlignmentPattern.getPositions(version);
				for (let i = 0; i < pos.length; i++) {
					const row = pos[i][0];
					const col = pos[i][1];
					for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) if (r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0) matrix.set(row + r, col + c, true, true);
					else matrix.set(row + r, col + c, false, true);
				}
			}
			/**
			* Add version info bits to matrix
			*
			* @param  {BitMatrix} matrix  Modules matrix
			* @param  {Number}    version QR Code version
			*/
			function setupVersionInfo(matrix, version) {
				const size = matrix.size;
				const bits = Version.getEncodedBits(version);
				let row, col, mod;
				for (let i = 0; i < 18; i++) {
					row = Math.floor(i / 3);
					col = i % 3 + size - 8 - 3;
					mod = (bits >> i & 1) === 1;
					matrix.set(row, col, mod, true);
					matrix.set(col, row, mod, true);
				}
			}
			/**
			* Add format info bits to matrix
			*
			* @param  {BitMatrix} matrix               Modules matrix
			* @param  {ErrorCorrectionLevel}    errorCorrectionLevel Error correction level
			* @param  {Number}    maskPattern          Mask pattern reference value
			*/
			function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
				const size = matrix.size;
				const bits = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern);
				let i, mod;
				for (i = 0; i < 15; i++) {
					mod = (bits >> i & 1) === 1;
					if (i < 6) matrix.set(i, 8, mod, true);
					else if (i < 8) matrix.set(i + 1, 8, mod, true);
					else matrix.set(size - 15 + i, 8, mod, true);
					if (i < 8) matrix.set(8, size - i - 1, mod, true);
					else if (i < 9) matrix.set(8, 15 - i - 1 + 1, mod, true);
					else matrix.set(8, 15 - i - 1, mod, true);
				}
				matrix.set(size - 8, 8, 1, true);
			}
			/**
			* Add encoded data bits to matrix
			*
			* @param  {BitMatrix}  matrix Modules matrix
			* @param  {Uint8Array} data   Data codewords
			*/
			function setupData(matrix, data) {
				const size = matrix.size;
				let inc = -1;
				let row = size - 1;
				let bitIndex = 7;
				let byteIndex = 0;
				for (let col = size - 1; col > 0; col -= 2) {
					if (col === 6) col--;
					while (true) {
						for (let c = 0; c < 2; c++) if (!matrix.isReserved(row, col - c)) {
							let dark = false;
							if (byteIndex < data.length) dark = (data[byteIndex] >>> bitIndex & 1) === 1;
							matrix.set(row, col - c, dark);
							bitIndex--;
							if (bitIndex === -1) {
								byteIndex++;
								bitIndex = 7;
							}
						}
						row += inc;
						if (row < 0 || size <= row) {
							row -= inc;
							inc = -inc;
							break;
						}
					}
				}
			}
			/**
			* Create encoded codewords from data input
			*
			* @param  {Number}   version              QR Code version
			* @param  {ErrorCorrectionLevel}   errorCorrectionLevel Error correction level
			* @param  {ByteData} data                 Data input
			* @return {Uint8Array}                    Buffer containing encoded codewords
			*/
			function createData(version, errorCorrectionLevel, segments) {
				const buffer = new BitBuffer();
				segments.forEach(function(data) {
					buffer.put(data.mode.bit, 4);
					buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version));
					data.write(buffer);
				});
				const dataTotalCodewordsBits = (Utils.getSymbolTotalCodewords(version) - ECCode.getTotalCodewordsCount(version, errorCorrectionLevel)) * 8;
				if (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits) buffer.put(0, 4);
				while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(0);
				const remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
				for (let i = 0; i < remainingByte; i++) buffer.put(i % 2 ? 17 : 236, 8);
				return createCodewords(buffer, version, errorCorrectionLevel);
			}
			/**
			* Encode input data with Reed-Solomon and return codewords with
			* relative error correction bits
			*
			* @param  {BitBuffer} bitBuffer            Data to encode
			* @param  {Number}    version              QR Code version
			* @param  {ErrorCorrectionLevel} errorCorrectionLevel Error correction level
			* @return {Uint8Array}                     Buffer containing encoded codewords
			*/
			function createCodewords(bitBuffer, version, errorCorrectionLevel) {
				const totalCodewords = Utils.getSymbolTotalCodewords(version);
				const dataTotalCodewords = totalCodewords - ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
				const ecTotalBlocks = ECCode.getBlocksCount(version, errorCorrectionLevel);
				const blocksInGroup1 = ecTotalBlocks - totalCodewords % ecTotalBlocks;
				const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
				const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
				const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
				const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;
				const rs = new ReedSolomonEncoder(ecCount);
				let offset = 0;
				const dcData = new Array(ecTotalBlocks);
				const ecData = new Array(ecTotalBlocks);
				let maxDataSize = 0;
				const buffer = new Uint8Array(bitBuffer.buffer);
				for (let b = 0; b < ecTotalBlocks; b++) {
					const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
					dcData[b] = buffer.slice(offset, offset + dataSize);
					ecData[b] = rs.encode(dcData[b]);
					offset += dataSize;
					maxDataSize = Math.max(maxDataSize, dataSize);
				}
				const data = new Uint8Array(totalCodewords);
				let index = 0;
				let i, r;
				for (i = 0; i < maxDataSize; i++) for (r = 0; r < ecTotalBlocks; r++) if (i < dcData[r].length) data[index++] = dcData[r][i];
				for (i = 0; i < ecCount; i++) for (r = 0; r < ecTotalBlocks; r++) data[index++] = ecData[r][i];
				return data;
			}
			/**
			* Build QR Code symbol
			*
			* @param  {String} data                 Input string
			* @param  {Number} version              QR Code version
			* @param  {ErrorCorretionLevel} errorCorrectionLevel Error level
			* @param  {MaskPattern} maskPattern     Mask pattern
			* @return {Object}                      Object containing symbol data
			*/
			function createSymbol(data, version, errorCorrectionLevel, maskPattern) {
				let segments;
				if (Array.isArray(data)) segments = Segments.fromArray(data);
				else if (typeof data === "string") {
					let estimatedVersion = version;
					if (!estimatedVersion) {
						const rawSegments = Segments.rawSplit(data);
						estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
					}
					segments = Segments.fromString(data, estimatedVersion || 40);
				} else throw new Error("Invalid data");
				const bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
				if (!bestVersion) throw new Error("The amount of data is too big to be stored in a QR Code");
				if (!version) version = bestVersion;
				else if (version < bestVersion) throw new Error("\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: " + bestVersion + ".\n");
				const dataBits = createData(version, errorCorrectionLevel, segments);
				const moduleCount = Utils.getSymbolSize(version);
				const modules = new BitMatrix(moduleCount);
				setupFinderPattern(modules, version);
				setupTimingPattern(modules);
				setupAlignmentPattern(modules, version);
				setupFormatInfo(modules, errorCorrectionLevel, 0);
				if (version >= 7) setupVersionInfo(modules, version);
				setupData(modules, dataBits);
				if (isNaN(maskPattern)) maskPattern = MaskPattern.getBestMask(modules, setupFormatInfo.bind(null, modules, errorCorrectionLevel));
				MaskPattern.applyMask(maskPattern, modules);
				setupFormatInfo(modules, errorCorrectionLevel, maskPattern);
				return {
					modules,
					version,
					errorCorrectionLevel,
					maskPattern,
					segments
				};
			}
			/**
			* QR Code
			*
			* @param {String | Array} data                 Input data
			* @param {Object} options                      Optional configurations
			* @param {Number} options.version              QR Code version
			* @param {String} options.errorCorrectionLevel Error correction level
			* @param {Function} options.toSJISFunc         Helper func to convert utf8 to sjis
			*/
			exports.create = function create(data, options) {
				if (typeof data === "undefined" || data === "") throw new Error("No input text");
				let errorCorrectionLevel = ECLevel.M;
				let version;
				let mask;
				if (typeof options !== "undefined") {
					errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M);
					version = Version.from(options.version);
					mask = MaskPattern.from(options.maskPattern);
					if (options.toSJISFunc) Utils.setToSJISFunction(options.toSJISFunc);
				}
				return createSymbol(data, version, errorCorrectionLevel, mask);
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/renderer/utils.js
		var require_utils = /* @__PURE__ */ __commonJSMin(((exports) => {
			function hex2rgba(hex) {
				if (typeof hex === "number") hex = hex.toString();
				if (typeof hex !== "string") throw new Error("Color should be defined as hex string");
				let hexCode = hex.slice().replace("#", "").split("");
				if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8) throw new Error("Invalid hex color: " + hex);
				if (hexCode.length === 3 || hexCode.length === 4) hexCode = Array.prototype.concat.apply([], hexCode.map(function(c) {
					return [c, c];
				}));
				if (hexCode.length === 6) hexCode.push("F", "F");
				const hexValue = parseInt(hexCode.join(""), 16);
				return {
					r: hexValue >> 24 & 255,
					g: hexValue >> 16 & 255,
					b: hexValue >> 8 & 255,
					a: hexValue & 255,
					hex: "#" + hexCode.slice(0, 6).join("")
				};
			}
			exports.getOptions = function getOptions(options) {
				if (!options) options = {};
				if (!options.color) options.color = {};
				const margin = typeof options.margin === "undefined" || options.margin === null || options.margin < 0 ? 4 : options.margin;
				const width = options.width && options.width >= 21 ? options.width : void 0;
				const scale = options.scale || 4;
				return {
					width,
					scale: width ? 4 : scale,
					margin,
					color: {
						dark: hex2rgba(options.color.dark || "#000000ff"),
						light: hex2rgba(options.color.light || "#ffffffff")
					},
					type: options.type,
					rendererOpts: options.rendererOpts || {}
				};
			};
			exports.getScale = function getScale(qrSize, opts) {
				return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
			};
			exports.getImageWidth = function getImageWidth(qrSize, opts) {
				const scale = exports.getScale(qrSize, opts);
				return Math.floor((qrSize + opts.margin * 2) * scale);
			};
			exports.qrToImageData = function qrToImageData(imgData, qr, opts) {
				const size = qr.modules.size;
				const data = qr.modules.data;
				const scale = exports.getScale(size, opts);
				const symbolSize = Math.floor((size + opts.margin * 2) * scale);
				const scaledMargin = opts.margin * scale;
				const palette = [opts.color.light, opts.color.dark];
				for (let i = 0; i < symbolSize; i++) for (let j = 0; j < symbolSize; j++) {
					let posDst = (i * symbolSize + j) * 4;
					let pxColor = opts.color.light;
					if (i >= scaledMargin && j >= scaledMargin && i < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
						const iSrc = Math.floor((i - scaledMargin) / scale);
						const jSrc = Math.floor((j - scaledMargin) / scale);
						pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
					}
					imgData[posDst++] = pxColor.r;
					imgData[posDst++] = pxColor.g;
					imgData[posDst++] = pxColor.b;
					imgData[posDst] = pxColor.a;
				}
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/renderer/canvas.js
		var require_canvas = /* @__PURE__ */ __commonJSMin(((exports) => {
			const Utils = require_utils();
			function clearCanvas(ctx, canvas, size) {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				if (!canvas.style) canvas.style = {};
				canvas.height = size;
				canvas.width = size;
				canvas.style.height = size + "px";
				canvas.style.width = size + "px";
			}
			function getCanvasElement() {
				try {
					return document.createElement("canvas");
				} catch (e) {
					throw new Error("You need to specify a canvas element");
				}
			}
			exports.render = function render(qrData, canvas, options) {
				let opts = options;
				let canvasEl = canvas;
				if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
					opts = canvas;
					canvas = void 0;
				}
				if (!canvas) canvasEl = getCanvasElement();
				opts = Utils.getOptions(opts);
				const size = Utils.getImageWidth(qrData.modules.size, opts);
				const ctx = canvasEl.getContext("2d");
				const image = ctx.createImageData(size, size);
				Utils.qrToImageData(image.data, qrData, opts);
				clearCanvas(ctx, canvasEl, size);
				ctx.putImageData(image, 0, 0);
				return canvasEl;
			};
			exports.renderToDataURL = function renderToDataURL(qrData, canvas, options) {
				let opts = options;
				if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
					opts = canvas;
					canvas = void 0;
				}
				if (!opts) opts = {};
				const canvasEl = exports.render(qrData, canvas, opts);
				const type = opts.type || "image/png";
				const rendererOpts = opts.rendererOpts || {};
				return canvasEl.toDataURL(type, rendererOpts.quality);
			};
		}));
		//#endregion
		//#region ../../dsh-token-monitor/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/renderer/svg-tag.js
		var require_svg_tag = /* @__PURE__ */ __commonJSMin(((exports) => {
			const Utils = require_utils();
			function getColorAttrib(color, attrib) {
				const alpha = color.a / 255;
				const str = attrib + "=\"" + color.hex + "\"";
				return alpha < 1 ? str + " " + attrib + "-opacity=\"" + alpha.toFixed(2).slice(1) + "\"" : str;
			}
			function svgCmd(cmd, x, y) {
				let str = cmd + x;
				if (typeof y !== "undefined") str += " " + y;
				return str;
			}
			function qrToPath(data, size, margin) {
				let path = "";
				let moveBy = 0;
				let newRow = false;
				let lineLength = 0;
				for (let i = 0; i < data.length; i++) {
					const col = Math.floor(i % size);
					const row = Math.floor(i / size);
					if (!col && !newRow) newRow = true;
					if (data[i]) {
						lineLength++;
						if (!(i > 0 && col > 0 && data[i - 1])) {
							path += newRow ? svgCmd("M", col + margin, .5 + row + margin) : svgCmd("m", moveBy, 0);
							moveBy = 0;
							newRow = false;
						}
						if (!(col + 1 < size && data[i + 1])) {
							path += svgCmd("h", lineLength);
							lineLength = 0;
						}
					} else moveBy++;
				}
				return path;
			}
			exports.render = function render(qrData, options, cb) {
				const opts = Utils.getOptions(options);
				const size = qrData.modules.size;
				const data = qrData.modules.data;
				const qrcodesize = size + opts.margin * 2;
				const bg = !opts.color.light.a ? "" : "<path " + getColorAttrib(opts.color.light, "fill") + " d=\"M0 0h" + qrcodesize + "v" + qrcodesize + "H0z\"/>";
				const path = "<path " + getColorAttrib(opts.color.dark, "stroke") + " d=\"" + qrToPath(data, size, opts.margin) + "\"/>";
				const viewBox = "viewBox=\"0 0 " + qrcodesize + " " + qrcodesize + "\"";
				const svgTag = "<svg xmlns=\"http://www.w3.org/2000/svg\" " + (!opts.width ? "" : "width=\"" + opts.width + "\" height=\"" + opts.width + "\" ") + viewBox + " shape-rendering=\"crispEdges\">" + bg + path + "</svg>\n";
				if (typeof cb === "function") cb(null, svgTag);
				return svgTag;
			};
		}));
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/TokenMonitorSettingsPanel.tsx
		var import_browser = (/* @__PURE__ */ __commonJSMin(((exports) => {
			const canPromise = require_can_promise();
			const QRCode = require_qrcode();
			const CanvasRenderer = require_canvas();
			const SvgRenderer = require_svg_tag();
			function renderCanvas(renderFunc, canvas, text, opts, cb) {
				const args = [].slice.call(arguments, 1);
				const argsNum = args.length;
				const isLastArgCb = typeof args[argsNum - 1] === "function";
				if (!isLastArgCb && !canPromise()) throw new Error("Callback required as last argument");
				if (isLastArgCb) {
					if (argsNum < 2) throw new Error("Too few arguments provided");
					if (argsNum === 2) {
						cb = text;
						text = canvas;
						canvas = opts = void 0;
					} else if (argsNum === 3) {
						if (canvas.getContext && typeof cb === "undefined") {
							cb = opts;
							opts = void 0;
						} else {
							cb = opts;
							opts = text;
							text = canvas;
							canvas = void 0;
						}
					}
				} else {
					if (argsNum < 1) throw new Error("Too few arguments provided");
					if (argsNum === 1) {
						text = canvas;
						canvas = opts = void 0;
					} else if (argsNum === 2 && !canvas.getContext) {
						opts = text;
						text = canvas;
						canvas = void 0;
					}
					return new Promise(function(resolve, reject) {
						try {
							resolve(renderFunc(QRCode.create(text, opts), canvas, opts));
						} catch (e) {
							reject(e);
						}
					});
				}
				try {
					const data = QRCode.create(text, opts);
					cb(null, renderFunc(data, canvas, opts));
				} catch (e) {
					cb(e);
				}
			}
			exports.create = QRCode.create;
			exports.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
			exports.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
			exports.toString = renderCanvas.bind(null, function(data, _, opts) {
				return SvgRenderer.render(data, opts);
			});
		})))();
		const CUTE_ASSET_ROOT = "/assets/dsh-token-monitor/settings-ui/cute";
		function cuteAsset(name) {
			return `${CUTE_ASSET_ROOT}/${name}.png`;
		}
		const SETTINGS_KEYS = [
			"dailyBudgetEnabled",
			"dailyBudgetCny",
			"budgetExceededNotificationEnabled",
			"peakReminderEnabled",
			"peakReminderEnterPeak",
			"peakReminderEnterValley",
			"whaleBubbleEnabled",
			"wechatNotificationsEnabled",
			"cacheHitAnomalyNotificationEnabled",
			"cacheHitAnomalyThreshold",
			"cacheHitAnomalyConsecutiveCalls"
		];
		const PANEL = {
			width: "min(760px, calc(100vw - 24px))",
			maxHeight: "min(760px, calc(100vh - 24px))",
			overflow: "auto",
			border: "1px solid #c6d4f2",
			borderRadius: 23,
			background: "linear-gradient(155deg, #fbfcff, #eef3ff 58%, #fff)",
			color: "#283868",
			boxShadow: "0 24px 70px rgba(40, 56, 104, 0.22), inset 0 0 0 5px rgba(238, 243, 255, 0.72)",
			fontFamily: "var(--dsh-font-family, ui-sans-serif, system-ui, sans-serif)"
		};
		const SECTION = {
			minWidth: 0,
			margin: 0,
			padding: 14,
			border: "1px solid rgba(56, 88, 168, 0.20)",
			borderRadius: 16,
			background: "rgba(255, 255, 255, 0.88)",
			boxShadow: "0 7px 18px rgba(40, 56, 104, 0.08)"
		};
		const BUTTON = {
			minHeight: 36,
			padding: "7px 13px",
			border: "1px solid rgba(56, 88, 168, 0.38)",
			borderRadius: 10,
			background: "#f5f7ff",
			color: "#283868",
			cursor: "pointer",
			font: "inherit",
			fontSize: 13,
			fontWeight: 650
		};
		const PRIMARY_BUTTON = {
			...BUTTON,
			borderColor: "transparent",
			background: "linear-gradient(135deg, #3858a8, #476fc4)",
			color: "#fff",
			boxShadow: "0 7px 18px rgba(56, 88, 168, 0.24)"
		};
		function descriptionStyle(disabled = false) {
			return {
				marginTop: 3,
				color: "#6874a8",
				fontSize: 12,
				lineHeight: 1.45,
				opacity: disabled ? .62 : 1
			};
		}
		function errorMessage(error) {
			if (error instanceof WechatConnectionApiError && error.code === "BRIDGE_NOT_OWNED") return "当前微信 bridge 不由 DSH Host 管理，不能在这里重连或断开。";
			return error instanceof Error ? error.message : "操作失败，请稍后重试。";
		}
		/**
		* ClawBot returns the short-lived login payload rather than image bytes. Keep
		* it in component memory and encode the QR as an SVG data URL in the browser;
		* the direct login link remains available as a local fallback.
		*/
		function LocalLoginQr({ payload }) {
			const [src, setSrc] = (0, react.useState)();
			(0, react.useEffect)(() => {
				let cancelled = false;
				setSrc(void 0);
				(0, import_browser.toString)(payload, {
					type: "svg",
					width: 180,
					margin: 1,
					errorCorrectionLevel: "M"
				}).then((svg) => {
					if (!cancelled) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
				}).catch(() => {
					if (!cancelled) setSrc(void 0);
				});
				return () => {
					cancelled = true;
				};
			}, [payload]);
			if (src === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "正在生成二维码…" });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				"aria-label": "微信登录二维码内容",
				"data-wechat-qr-image": "",
				src,
				alt: "微信登录二维码",
				width: "180",
				height: "180"
			});
		}
		function connectionSummary(status) {
			if (status === void 0) return "正在读取运行状态…";
			if (status.availability === "unsupported") return "当前环境不支持微信连接";
			if (status.process === "external") return "外部 bridge 正在运行（非 DSH Host 管理）";
			if (status.auth === "authenticated" && status.process === "host-managed-running") return "已登录 · DSH Host 托管运行中";
			if (status.auth === "authenticated" && status.process === "host-managed-stopped") return "已登录 · Host bridge 已停止";
			if (status.auth === "pending") return "等待扫码确认";
			if (status.auth === "expired") return "登录已过期";
			if (status.auth === "unconfigured") return "尚未登录";
			return "状态暂不可确定";
		}
		function deliverySummary(status) {
			if (status === void 0 || status.auth !== "authenticated") return void 0;
			if (status.delivery === "ready") return "消息通道已激活";
			if (status.delivery === "needs-activation") return "请先给 ClawBot 发一条消息激活通知通道";
			if (status.delivery === "not-ready") return "消息通道尚未就绪";
			return "消息通道状态未知";
		}
		function capabilityHint(status) {
			if (status?.process === "external") return "这个 bridge 由外部进程管理。为避免误杀，重连和断开均已禁用。";
			if (status !== void 0 && !status.capabilities.canReconnect && !status.capabilities.canDisconnect) return "当前连接不由 DSH Host 管理，不能在此重连或断开。";
		}
		function SwitchField(props) {
			const { id, label, checked, disabled = false, indent = false } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `token-monitor-settings__switch-field${indent ? " token-monitor-settings__switch-field--indent" : ""}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
					htmlFor: id,
					style: {
						flex: 1,
						minWidth: 0,
						cursor: disabled ? "not-allowed" : "pointer",
						opacity: disabled ? .58 : 1
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							display: "block",
							fontSize: 14,
							fontWeight: 650
						},
						children: label
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					id,
					type: "button",
					role: "switch",
					"aria-checked": checked,
					disabled,
					onClick: () => {
						props.onChange(!checked);
					},
					style: {
						position: "relative",
						width: 42,
						height: 24,
						flex: "0 0 auto",
						padding: 0,
						border: "1px solid rgba(40, 56, 104, 0.18)",
						borderRadius: 999,
						background: checked ? "linear-gradient(135deg, #3858a8, #476fc4)" : "rgba(104, 116, 168, 0.22)",
						cursor: disabled ? "not-allowed" : "pointer",
						opacity: disabled ? .58 : 1,
						transition: "background 160ms ease"
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						style: {
							position: "absolute",
							top: 2,
							left: checked ? 20 : 2,
							width: 18,
							height: 18,
							borderRadius: "50%",
							background: "#fff",
							boxShadow: "0 2px 6px rgba(40, 56, 104, 0.26)",
							transition: "left 160ms ease"
						}
					})
				})]
			});
		}
		function SectionTitle({ title, iconName }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "token-monitor-settings__section-title",
				children: [iconName !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: cuteAsset(iconName),
					alt: "",
					width: "28",
					height: "28",
					style: {
						objectFit: "contain",
						flex: "0 0 auto"
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					style: {
						margin: 0,
						fontSize: 15,
						lineHeight: 1.35
					},
					children: title
				})]
			});
		}
		function metricTitle(value, prefix = "", suffix = "") {
			return `${prefix}${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${suffix}`;
		}
		const SUMMARY_RANGES = [
			{
				value: "all",
				label: "可用历史"
			},
			{
				value: "30d",
				label: "30天"
			},
			{
				value: "7d",
				label: "7天"
			},
			{
				value: "today",
				label: "今日"
			}
		];
		function SummaryRangeSelector({ value, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					minWidth: 0,
					maxWidth: "100%",
					overflowX: "auto",
					overscrollBehaviorX: "contain",
					scrollbarWidth: "thin",
					scrollbarColor: "#b7c9ee transparent"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					role: "radiogroup",
					"aria-label": "概览时间范围",
					style: {
						display: "inline-flex",
						minWidth: "max-content",
						padding: 3,
						border: "1px solid #b8c8eb",
						borderRadius: 999,
						background: "rgba(255, 255, 255, 0.58)"
					},
					children: SUMMARY_RANGES.map((range) => {
						const selected = value === range.value;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "radio",
							"aria-checked": selected,
							onClick: () => onChange(range.value),
							style: {
								minHeight: 28,
								padding: "4px 13px",
								border: 0,
								borderRadius: 999,
								background: selected ? "linear-gradient(135deg, #3858a8, #476fc4)" : "transparent",
								color: selected ? "#fff" : "#5870a7",
								font: "inherit",
								fontSize: 12,
								fontWeight: 700,
								lineHeight: 1.2,
								whiteSpace: "nowrap",
								cursor: "pointer",
								boxShadow: selected ? "0 3px 8px rgba(56, 88, 168, 0.24)" : "none"
							},
							children: range.label
						}, range.value);
					})
				})
			});
		}
		function actionButtonStyle(disabled, dangerous = false) {
			return {
				...BUTTON,
				...dangerous ? {
					borderColor: "rgba(204, 72, 99, 0.42)",
					color: "#bd3e5a"
				} : {},
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? .5 : 1
			};
		}
		function TokenMonitorSettingsPanel(props) {
			const { snapshot } = props;
			const [draft, setDraft] = (0, react.useState)(() => ({ ...snapshot.settings }));
			const [budgetInput, setBudgetInput] = (0, react.useState)(() => String(snapshot.settings.dailyBudgetCny));
			const [cacheThresholdInput, setCacheThresholdInput] = (0, react.useState)(() => String(snapshot.settings.cacheHitAnomalyThreshold));
			const [cacheCallsInput, setCacheCallsInput] = (0, react.useState)(() => String(snapshot.settings.cacheHitAnomalyConsecutiveCalls));
			const [saveState, setSaveState] = (0, react.useState)("idle");
			const [saveError, setSaveError] = (0, react.useState)();
			const [status, setStatus] = (0, react.useState)();
			const [statusError, setStatusError] = (0, react.useState)();
			const [action, setAction] = (0, react.useState)();
			const [actionMessage, setActionMessage] = (0, react.useState)();
			const [actionError, setActionError] = (0, react.useState)();
			const [loginSession, setLoginSession] = (0, react.useState)();
			const [disconnectConfirmation, setDisconnectConfirmation] = (0, react.useState)(false);
			const [summaryRange, setSummaryRange] = (0, react.useState)("today");
			const [usageSummary, setUsageSummary] = (0, react.useState)();
			const [usageSummaryLoading, setUsageSummaryLoading] = (0, react.useState)(false);
			const [clock, setClock] = (0, react.useState)(() => Date.now());
			const [updateStatus, setUpdateStatus] = (0, react.useState)();
			const [updateAction, setUpdateAction] = (0, react.useState)();
			const [updateMessage, setUpdateMessage] = (0, react.useState)();
			const [updateError, setUpdateError] = (0, react.useState)();
			const mounted = (0, react.useRef)(true);
			const statusController = (0, react.useRef)();
			const actionController = (0, react.useRef)();
			const updateApi = (0, react.useRef)(createTokenMonitorUpdateApi());
			(0, react.useEffect)(() => {
				setDraft({ ...snapshot.settings });
				setBudgetInput(String(snapshot.settings.dailyBudgetCny));
				setCacheThresholdInput(String(snapshot.settings.cacheHitAnomalyThreshold));
				setCacheCallsInput(String(snapshot.settings.cacheHitAnomalyConsecutiveCalls));
				setSaveState("idle");
				setSaveError(void 0);
			}, [snapshot]);
			(0, react.useEffect)(() => {
				mounted.current = true;
				const controller = new AbortController();
				statusController.current = controller;
				setStatusError(void 0);
				props.wechatApi.status(controller.signal).then((nextStatus) => {
					if (mounted.current && !controller.signal.aborted) setStatus(nextStatus);
				}).catch((error) => {
					if (mounted.current && !controller.signal.aborted) setStatusError(errorMessage(error));
				});
				return () => {
					mounted.current = false;
					controller.abort();
					actionController.current?.abort();
				};
			}, [props.wechatApi]);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setUsageSummaryLoading(true);
				fetch("/api/token-monitor/usage-summary?range=" + summaryRange, {
					cache: "no-store",
					signal: controller.signal
				}).then(async (response) => {
					if (!response.ok) throw new Error("概览数据读取失败");
					return await response.json();
				}).then((summary) => {
					if (!controller.signal.aborted) setUsageSummary(summary);
				}).catch(() => {
					if (!controller.signal.aborted) setUsageSummary(void 0);
				}).finally(() => {
					if (!controller.signal.aborted) setUsageSummaryLoading(false);
				});
				return () => controller.abort();
			}, [summaryRange]);
			(0, react.useEffect)(() => {
				if ((loginSession?.expiresAt ?? status?.pendingLogin?.expiresAt) === void 0) return;
				const updateClock = () => {
					const now = Date.now();
					setClock(now);
					if (loginSession !== void 0 && now >= loginSession.expiresAt) {
						setLoginSession(void 0);
						setActionMessage("登录二维码已过期，请重新获取。");
					}
				};
				updateClock();
				const timer = window.setInterval(updateClock, 1e3);
				return () => {
					window.clearInterval(timer);
				};
			}, [loginSession, status?.pendingLogin?.expiresAt]);
			const updateDraft = (key, value) => {
				setDraft((current) => ({
					...current,
					[key]: value
				}));
				setSaveState("idle");
				setSaveError(void 0);
			};
			const refreshStatus = async () => {
				statusController.current?.abort();
				const controller = new AbortController();
				statusController.current = controller;
				setStatusError(void 0);
				try {
					const nextStatus = await props.wechatApi.status(controller.signal);
					if (mounted.current && !controller.signal.aborted) setStatus(nextStatus);
				} catch (error) {
					if (mounted.current && !controller.signal.aborted) setStatusError(errorMessage(error));
				}
			};
			const beginAction = (nextAction) => {
				if (action !== void 0) return void 0;
				const controller = new AbortController();
				actionController.current = controller;
				setAction(nextAction);
				setActionError(void 0);
				setActionMessage(void 0);
				return controller;
			};
			const finishAction = (controller) => {
				if (!mounted.current || controller.signal.aborted) return;
				actionController.current = void 0;
				setAction(void 0);
			};
			const startLogin = async () => {
				const controller = beginAction("login");
				if (controller === void 0) return;
				try {
					const result = await props.wechatApi.login(controller.signal);
					if (!mounted.current || controller.signal.aborted) return;
					setStatus(result.status);
					setLoginSession(result.login);
					setClock(Date.now());
					setActionMessage("二维码已生成，请使用微信扫码后确认登录状态。");
				} catch (error) {
					if (mounted.current && !controller.signal.aborted) setActionError(errorMessage(error));
				} finally {
					finishAction(controller);
				}
			};
			const activeSessionId = loginSession?.sessionId ?? status?.pendingLogin?.sessionId;
			const confirmLogin = async () => {
				if (activeSessionId === void 0) return;
				const controller = beginAction("confirm");
				if (controller === void 0) return;
				try {
					const result = await props.wechatApi.confirmLogin(activeSessionId, controller.signal);
					if (!mounted.current || controller.signal.aborted) return;
					setStatus(result.status);
					setActionMessage({
						waiting: "还在等待扫码。",
						scanned: "已扫码，请在微信中确认登录。",
						confirmed: "微信登录已确认。",
						expired: "登录二维码已过期，请重新获取。"
					}[result.result]);
					if (result.result === "confirmed" || result.result === "expired") setLoginSession(void 0);
				} catch (error) {
					if (mounted.current && !controller.signal.aborted) setActionError(errorMessage(error));
				} finally {
					finishAction(controller);
				}
			};
			const reconnect = async () => {
				const controller = beginAction("reconnect");
				if (controller === void 0) return;
				try {
					const nextStatus = await props.wechatApi.reconnect(controller.signal);
					if (!mounted.current || controller.signal.aborted) return;
					setStatus(nextStatus);
					setActionMessage("已请求 DSH Host 重连微信 bridge。");
				} catch (error) {
					if (mounted.current && !controller.signal.aborted) setActionError(errorMessage(error));
				} finally {
					finishAction(controller);
				}
			};
			const disconnect = async () => {
				const controller = beginAction("disconnect");
				if (controller === void 0) return;
				try {
					const nextStatus = await props.wechatApi.disconnect(controller.signal);
					if (!mounted.current || controller.signal.aborted) return;
					setStatus(nextStatus);
					setLoginSession(void 0);
					setDisconnectConfirmation(false);
					setActionMessage("DSH Host 管理的微信 bridge 已断开。");
				} catch (error) {
					if (mounted.current && !controller.signal.aborted) setActionError(errorMessage(error));
				} finally {
					finishAction(controller);
				}
			};
			const testMessage = async () => {
				const controller = beginAction("test");
				if (controller === void 0) return;
				try {
					await props.wechatApi.testMessage([
						"【dsh-damage-pulse】",
						"",
						"连线成功啦～鲸鱼娘已经顺利抵达微信！(｡•̀ᴗ-)✧",
						"以后预算、峰谷时段和缓存小状况，我都会及时来提醒你哦～",
						"",
						"如果你喜欢这个插件，欢迎去 GitHub 给 dsh-damage-pulse 点一颗 Star 呀～你的喜欢，就是我继续努力更新的最大动力！(≧▽≦)♡"
					].join("\n"), controller.signal);
					if (!mounted.current || controller.signal.aborted) return;
					setActionMessage("测试消息已发送。");
				} catch (error) {
					if (mounted.current && !controller.signal.aborted) setActionError(errorMessage(error));
				} finally {
					finishAction(controller);
				}
			};
			const checkForUpdates = async () => {
				if (updateAction !== void 0) return;
				const controller = new AbortController();
				setUpdateAction("check");
				setUpdateError(void 0);
				setUpdateMessage(void 0);
				try {
					const result = await updateApi.current.check(controller.signal);
					if (!mounted.current || controller.signal.aborted) return;
					setUpdateStatus(result);
					setUpdateMessage(result.hasUpdate ? `发现新版本 v${result.latestVersion}。` : `当前已是最新版本 v${result.currentVersion}。`);
				} catch (error) {
					if (mounted.current && !controller.signal.aborted) setUpdateError(error instanceof TokenMonitorUpdateApiError ? error.message : "检查更新失败，请稍后重试。");
				} finally {
					if (mounted.current && !controller.signal.aborted) setUpdateAction(void 0);
				}
			};
			const installUpdate = async () => {
				if (updateAction !== void 0 || updateStatus?.hasUpdate !== true) return;
				const controller = new AbortController();
				setUpdateAction("install");
				setUpdateError(void 0);
				setUpdateMessage(void 0);
				try {
					const result = await updateApi.current.install(controller.signal);
					if (!mounted.current || controller.signal.aborted) return;
					setUpdateStatus({
						repository: result.repository,
						currentVersion: result.currentVersion,
						latestVersion: result.latestVersion,
						hasUpdate: result.installed ? false : result.hasUpdate,
						releaseUrl: result.releaseUrl,
						asset: result.asset
					});
					setUpdateMessage(result.installed ? result.message : `更新包已校验但尚未安装：${result.message}`);
				} catch (error) {
					if (mounted.current && !controller.signal.aborted) setUpdateError(error instanceof TokenMonitorUpdateApiError ? error.message : "安装更新失败，请稍后重试。");
				} finally {
					if (mounted.current && !controller.signal.aborted) setUpdateAction(void 0);
				}
			};
			const submit = async (event) => {
				event.preventDefault();
				if (saveState === "saving") return;
				const budget = Number(budgetInput);
				if (!Number.isFinite(budget) || budget <= 0 || budget > 1e6 || Math.abs(budget * 100 - Math.round(budget * 100)) > 1e-9) {
					setSaveError(`每日预算必须大于 0、不超过 ${String(TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY)}，且最多两位小数。`);
					return;
				}
				const cacheThreshold = Number(cacheThresholdInput);
				const cacheCalls = Number(cacheCallsInput);
				if (!Number.isInteger(cacheThreshold) || cacheThreshold < 0 || cacheThreshold > 100) {
					setSaveError("缓存命中率阈值必须是 0 到 100 的整数。");
					return;
				}
				if (!Number.isInteger(cacheCalls) || cacheCalls < 2 || cacheCalls > 20) {
					setSaveError("连续低于次数必须是 2 到 20 的整数。");
					return;
				}
				const normalizedDraft = {
					...draft,
					dailyBudgetCny: budget,
					cacheHitAnomalyThreshold: cacheThreshold,
					cacheHitAnomalyConsecutiveCalls: cacheCalls
				};
				const patch = {};
				for (const key of SETTINGS_KEYS) if (normalizedDraft[key] !== snapshot.settings[key]) patch[key] = normalizedDraft[key];
				setSaveState("saving");
				setSaveError(void 0);
				try {
					const nextSnapshot = await props.onSave({
						expectedRevision: snapshot.revision,
						patch
					});
					if (!mounted.current) return;
					setDraft({ ...nextSnapshot.settings });
					setBudgetInput(String(nextSnapshot.settings.dailyBudgetCny));
					setSaveState("saved");
				} catch (error) {
					if (!mounted.current) return;
					setSaveState("idle");
					setSaveError(error instanceof Error ? error.message : "设置保存失败，请稍后重试。");
				}
			};
			const busy = action !== void 0 || status?.operation !== void 0 && status.operation !== "idle";
			const ownershipHint = capabilityHint(status);
			const expiresAt = loginSession?.expiresAt ?? status?.pendingLogin?.expiresAt;
			const secondsRemaining = expiresAt === void 0 ? void 0 : Math.max(0, Math.ceil((expiresAt - clock) / 1e3));
			const canLogin = status?.capabilities.canLogin === true && !busy;
			const canReconnect = status?.capabilities.canReconnect === true && !busy;
			const canDisconnect = status?.capabilities.canDisconnect === true && !busy;
			const canConfirm = activeSessionId !== void 0 && secondsRemaining !== 0 && !busy;
			const canTestMessage = status?.delivery === "ready" && !busy;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				"aria-label": "Token Monitor 设置",
				className: "token-monitor-settings",
				"data-token-monitor-settings-theme": "whale-outfit-blue",
				onSubmit: (event) => {
					submit(event);
				},
				onPointerDown: (event) => {
					event.stopPropagation();
				},
				onPointerMove: (event) => {
					event.stopPropagation();
				},
				onPointerUp: (event) => {
					event.stopPropagation();
				},
				onPointerCancel: (event) => {
					event.stopPropagation();
				},
				onClick: (event) => {
					event.stopPropagation();
				},
				onContextMenu: (event) => {
					event.stopPropagation();
				},
				onKeyDown: (event) => {
					if (event.key === "Escape" && !disconnectConfirmation) props.onClose();
				},
				style: PANEL,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: `
        .token-monitor-settings { scrollbar-color: #9eb2df transparent; }
        .token-monitor-settings * { box-sizing: border-box; }
        .token-monitor-settings__head { position: sticky; top: 0; z-index: 3; display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 22px 14px; border-bottom: 1px solid rgba(56,88,168,.18); background: linear-gradient(90deg,rgba(226,235,255,.97),rgba(246,248,255,.97)); overflow: hidden; }
        .token-monitor-settings__head-copy { position: relative; z-index: 1; padding-right: 82px; }
        .token-monitor-settings__ribbon { position: absolute; z-index: 1; top: 2px; right: 52px; width: 62px; height: 62px; object-fit: contain; opacity: .82; pointer-events: auto; }
        .token-monitor-settings__kicker { color: #3858a8; font-size: 10px; font-weight: 800; letter-spacing: .12em; }
        .token-monitor-settings__title { margin: 4px 0 0; color: #283868; font-size: 22px; line-height: 1.3; }
        .token-monitor-settings__close { position: relative; z-index: 2; display: grid; place-items: center; width: 34px; height: 34px; padding: 5px; border: 1px solid #c6d4f2; border-radius: 12px; background: rgba(255,255,255,.82); cursor: pointer; }
        .token-monitor-settings__close:hover { border-color: #476fc4; background: #fff; }
        .token-monitor-settings__close img { width: 100%; height: 100%; object-fit: contain; }
        .token-monitor-settings__grid { display: grid; grid-template-columns: minmax(300px,.88fr) minmax(0,1.12fr); align-items: stretch; gap: 10px; padding: 14px 16px 10px; }
        .token-monitor-settings__section--overview { grid-column: 1 / -1; }
        .token-monitor-settings__section { min-width: 0; }
        .token-monitor-settings__section h2 { color: #283868; }
        .token-monitor-settings__section h2::before { content: ""; display: inline-block; width: 5px; height: 18px; margin-right: 7px; vertical-align: -3px; border-radius: 5px; background: linear-gradient(#3858a8,#6f91dc); }
        .token-monitor-settings__section-title { display: flex; align-items: center; gap: 9px; min-height: 28px; margin-bottom: 7px; }
        .token-monitor-settings__overview-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 7px; }
        .token-monitor-settings__overview-heading .token-monitor-settings__section-title { margin-bottom: 0; }
        .token-monitor-settings__overview { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
        .token-monitor-settings__metric { min-width: 0; min-height: 68px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 9px 12px; border: 1px solid rgba(56,88,168,.14); border-radius: 12px; background: rgba(255,255,255,.74); text-align: center; overflow: hidden; }
        .token-monitor-settings__metric span { display: block; width: 100%; color: #6874a8; font-size: 11px; text-align: center; }
        .token-monitor-settings__metric strong { display: block; width: 100%; margin-top: 4px; color: #3858a8; font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; text-align: center; }
        .token-monitor-settings__fixed-note { margin: 9px 0 2px; padding: 8px 10px; border: 1px dashed #b8c8eb; border-radius: 10px; background: rgba(238,243,255,.86); color: #6874a8; font-size: 11px; line-height: 1.5; }
        .token-monitor-settings__left-stack { display: flex; min-width: 0; flex-direction: column; gap: 10px; }
        .token-monitor-settings__left-stack > .token-monitor-settings__section { width: 100%; }
        .token-monitor-settings__switch-field { display: flex; align-items: center; gap: 14px; min-height: 30px; padding: 3px 0; }
        .token-monitor-settings__switch-field--indent { padding-left: 14px; }
        .token-monitor-settings__subgroup { margin-top: 4px; padding-top: 4px; border-top: 1px dashed #cbd7ef; }
        .token-monitor-settings__budget { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; padding: 3px 0 3px 14px; }
        .token-monitor-settings__budget-row { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
        .token-monitor-settings__budget-input { width: 76px; height: 22px; min-height: 22px; padding: 1px 7px; border: 1px solid #c6d4f2; border-radius: 7px; outline: none; background: #fff; color: #283868; font: 600 12px/18px ui-sans-serif,system-ui,sans-serif; font-variant-numeric: tabular-nums; text-align: right; }
        .token-monitor-settings__budget-input:focus { border-color: #3858a8; box-shadow: 0 0 0 3px rgba(56,88,168,.14); }
        .token-monitor-settings__wechat { width: 100%; min-width: 0; margin-top: 6px; padding: 8px; border: 1px solid rgba(56,88,168,.17); border-radius: 12px; background: rgba(245,247,255,.82); overflow: hidden; }
        .token-monitor-settings__wechat-status { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
        .token-monitor-settings__wechat-status-copy { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
        .token-monitor-settings__wechat-status-copy > div { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
        .token-monitor-settings__wechat-refresh { flex: 0 0 auto; }
        .token-monitor-settings__wechat-hint, .token-monitor-settings__wechat-message { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
        .token-monitor-settings__section--notification { height: 100%; }
        .token-monitor-settings__qr-area { display: grid; place-items: center; width: min(148px,100%); aspect-ratio: 1; margin: 6px auto 0; padding: 6px; overflow: hidden; border: 1px dashed rgba(56,88,168,.38); border-radius: 12px; background: #fff; color: #6874a8; text-align: center; }
        .token-monitor-settings__qr-area > * { max-width: 100%; max-height: 100%; }
        .token-monitor-settings__qr-area img { display: block; width: 100%; height: 100%; padding: 0; border-radius: 7px; background: #fff; object-fit: contain; image-rendering: pixelated; }
        .token-monitor-settings__qr-meta { margin-top: 4px; text-align: center; }
        .token-monitor-settings__wechat-actions { display: grid; gap: 5px; margin-top: 6px; }
        .token-monitor-settings__wechat-actions-short { display: grid; grid-template-columns: repeat(2,minmax(0,92px)); justify-content: center; gap: 5px; }
        .token-monitor-settings__wechat-actions-long { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 5px; }
        .token-monitor-settings__disconnect-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .token-monitor-settings__disconnect-actions > button { flex: 1 1 112px; min-width: 0; }
        .token-monitor-settings__update-version { margin-top: 8px; color: #6874a8; font-size: 11px; }
        .token-monitor-settings__update-actions { display: grid; grid-template-columns: 36px minmax(94px,1fr) minmax(94px,1fr); align-items: center; gap: 7px; margin-top: 10px; }
        .token-monitor-settings__update-icon { display: grid; place-items: center; width: 36px; height: 34px; padding: 0; border: 1px solid rgba(56,88,168,.3); border-radius: 9px; background: #f5f7ff; color: #3858a8; text-decoration: none; cursor: pointer; }
        .token-monitor-settings__update-icon svg { width: 19px; height: 19px; fill: currentColor; }
        .token-monitor-settings__update-icon:hover { border-color: #3858a8; background: #eaf0ff; }
        .token-monitor-settings__update-icon:disabled { cursor: not-allowed; opacity: .5; }
        .token-monitor-settings__update-check, .token-monitor-settings__update-install { min-height: 34px; padding: 6px 10px; border: 1px solid rgba(56,88,168,.3); border-radius: 9px; font: inherit; white-space: nowrap; cursor: pointer; }
        .token-monitor-settings__update-check { background: #f5f7ff; color: #3858a8; }
        .token-monitor-settings__update-install { background: linear-gradient(135deg, #3858a8, #476fc4); color: #fff; }
        .token-monitor-settings__update-check:disabled,
        .token-monitor-settings__update-install:disabled { cursor: not-allowed; opacity: .45; }
        .token-monitor-settings button[role="switch"] { flex-basis: 46px; }
        .token-monitor-settings__footer { position: sticky; bottom: 0; z-index: 3; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 9px; padding: 13px 20px 18px; border-top: 1px solid rgba(56,88,168,.10); background: linear-gradient(0deg,#f8faff 78%,rgba(248,250,255,.92)); }
        .token-monitor-settings__footer-message { flex: 1 1 180px; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
        .token-monitor-settings__footer > button { flex: 0 0 auto; }
        @media (max-width: 719px) { .token-monitor-settings { width: min(560px,calc(100vw - 24px)) !important; } .token-monitor-settings__grid { grid-template-columns: 1fr; } .token-monitor-settings__section--overview { grid-column: auto; } .token-monitor-settings__overview { grid-template-columns: 1fr; } .token-monitor-settings__wechat-actions-short, .token-monitor-settings__wechat-actions-long { grid-template-columns: 1fr; } .token-monitor-settings__wechat-refresh { min-width: 0; } .token-monitor-settings__update-actions { grid-template-columns: 36px minmax(0,1fr) minmax(0,1fr); } .token-monitor-settings__head-copy { padding-right: 64px; } .token-monitor-settings__ribbon { right: 46px; opacity: .55; } }
      ` }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "token-monitor-settings__head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								className: "token-monitor-settings__ribbon",
								src: cuteAsset("cute-decoration-ribbon"),
								alt: ""
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "token-monitor-settings__head-copy",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
									className: "token-monitor-settings__title",
									children: "详细设置"
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "token-monitor-settings__close",
								"aria-label": "关闭监控设置",
								onClick: props.onClose,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
									src: cuteAsset("cute-icon-close"),
									alt: ""
								})
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "token-monitor-settings__grid",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: "token-monitor-settings__section token-monitor-settings__section--overview",
								style: SECTION,
								"aria-labelledby": "overview-settings-title",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "token-monitor-settings__overview-heading",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										id: "overview-settings-title",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionTitle, {
											iconName: "cute-icon-account-balance",
											title: "概览"
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SummaryRangeSelector, {
										value: summaryRange,
										onChange: setSummaryRange
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "token-monitor-settings__overview",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "token-monitor-settings__metric",
											title: usageSummary === void 0 ? void 0 : metricTitle(usageSummary.spendCny, "¥"),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "消费" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: usageSummary === void 0 ? usageSummaryLoading ? "…" : "¥0.00" : `¥${formatChineseCompactCurrency(usageSummary.spendCny)}` })]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "token-monitor-settings__metric",
											title: usageSummary === void 0 ? void 0 : metricTitle(usageSummary.requestCount),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "请求数" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: formatChineseCompactNumber(usageSummary?.requestCount ?? 0) })]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "token-monitor-settings__metric",
											title: usageSummary === void 0 ? void 0 : metricTitle(usageSummary.totalTokens),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Token 总数" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: formatChineseCompactNumber(usageSummary?.totalTokens ?? 0) })]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "token-monitor-settings__metric",
											title: usageSummary === void 0 ? void 0 : metricTitle(usageSummary.cacheHitTokens),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "缓存命中 Token" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: formatChineseCompactNumber(usageSummary?.cacheHitTokens ?? 0) })]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "token-monitor-settings__metric",
											title: usageSummary === void 0 ? void 0 : metricTitle(usageSummary.cacheHitRate * 100, "", "%"),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "缓存命中率" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: usageSummary === void 0 ? "0%" : `${(usageSummary.cacheHitRate * 100).toFixed(1)}%` })]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "token-monitor-settings__metric",
											title: usageSummary === void 0 ? void 0 : metricTitle(usageSummary.activeDays),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "活跃天数" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: formatChineseCompactNumber(usageSummary?.activeDays ?? 0) })]
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "token-monitor-settings__left-stack",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: "token-monitor-settings__section",
									style: SECTION,
									"aria-labelledby": "rules-settings-title",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											id: "rules-settings-title",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionTitle, {
												iconName: "cute-icon-warning",
												title: "提醒规则"
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchField, {
											id: "daily-budget-enabled",
											label: "启用今日预算",
											checked: draft.dailyBudgetEnabled,
											onChange: (value) => {
												updateDraft("dailyBudgetEnabled", value);
											}
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											htmlFor: "daily-budget-cny",
											className: "token-monitor-settings__budget",
											style: { opacity: draft.dailyBudgetEnabled ? 1 : .58 },
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													display: "block",
													fontSize: 14,
													fontWeight: 650
												},
												children: "预算阈值"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "token-monitor-settings__budget-row",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													"aria-hidden": "true",
													style: { color: "#6874a8" },
													children: "¥"
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													id: "daily-budget-cny",
													className: "token-monitor-settings__budget-input",
													inputMode: "decimal",
													value: budgetInput,
													disabled: !draft.dailyBudgetEnabled,
													onChange: (event) => {
														setBudgetInput(event.currentTarget.value);
														setSaveState("idle");
														setSaveError(void 0);
													}
												})]
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchField, {
											id: "budget-exceeded-notification-enabled",
											label: "超过预算时提醒",
											checked: draft.budgetExceededNotificationEnabled,
											disabled: !draft.dailyBudgetEnabled,
											indent: true,
											onChange: (value) => {
												updateDraft("budgetExceededNotificationEnabled", value);
											}
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "token-monitor-settings__subgroup",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchField, {
													id: "peak-reminder-enabled",
													label: "峰谷提醒总开关",
													checked: draft.peakReminderEnabled,
													onChange: (value) => {
														updateDraft("peakReminderEnabled", value);
													}
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchField, {
													id: "peak-reminder-enter-peak",
													label: "进入峰时段",
													checked: draft.peakReminderEnterPeak,
													disabled: !draft.peakReminderEnabled,
													indent: true,
													onChange: (value) => {
														updateDraft("peakReminderEnterPeak", value);
													}
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchField, {
													id: "peak-reminder-enter-valley",
													label: "进入谷时段",
													checked: draft.peakReminderEnterValley,
													disabled: !draft.peakReminderEnabled,
													indent: true,
													onChange: (value) => {
														updateDraft("peakReminderEnterValley", value);
													}
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "token-monitor-settings__subgroup",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchField, {
													id: "cache-hit-anomaly-enabled",
													label: "缓存命中异常提醒",
													checked: draft.cacheHitAnomalyNotificationEnabled,
													onChange: (value) => {
														updateDraft("cacheHitAnomalyNotificationEnabled", value);
													}
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													htmlFor: "cache-hit-anomaly-threshold",
													className: "token-monitor-settings__budget",
													style: { opacity: draft.cacheHitAnomalyNotificationEnabled ? 1 : .58 },
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															display: "block",
															fontSize: 14,
															fontWeight: 650
														},
														children: "缓存命中率阈值"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "token-monitor-settings__budget-row",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															id: "cache-hit-anomaly-threshold",
															className: "token-monitor-settings__budget-input",
															inputMode: "numeric",
															value: cacheThresholdInput,
															onChange: (event) => {
																setCacheThresholdInput(event.currentTarget.value);
																setSaveState("idle");
															}
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "%" })]
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													htmlFor: "cache-hit-anomaly-consecutive",
													className: "token-monitor-settings__budget",
													style: { opacity: draft.cacheHitAnomalyNotificationEnabled ? 1 : .58 },
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															display: "block",
															fontSize: 14,
															fontWeight: 650
														},
														children: "连续低于次数"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "token-monitor-settings__budget-row",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															id: "cache-hit-anomaly-consecutive",
															className: "token-monitor-settings__budget-input",
															inputMode: "numeric",
															value: cacheCallsInput,
															onChange: (event) => {
																setCacheCallsInput(event.currentTarget.value);
																setSaveState("idle");
															}
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "次" })]
													})]
												})
											]
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: "token-monitor-settings__section token-monitor-settings__section--updates",
									style: SECTION,
									"aria-labelledby": "update-settings-title",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											id: "update-settings-title",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionTitle, {
												iconName: "cute-icon-settings",
												title: "插件更新"
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "token-monitor-settings__update-version",
											children: ["当前版本 v", updateStatus?.currentVersion ?? "4.0.5"]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "token-monitor-settings__update-actions",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
													className: "token-monitor-settings__update-icon",
													href: "https://github.com/wssfk12138/dsh-damage-pulse",
													target: "_blank",
													rel: "noreferrer",
													role: "button",
													"aria-label": "打开 GitHub 项目主页",
													title: "打开 GitHub 项目主页",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
														viewBox: "0 0 16 16",
														"aria-hidden": "true",
														children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.64 5.47 7.72.4.08.55-.18.55-.39 0-.19-.01-.83-.01-1.5-2.01.38-2.53-.5-2.69-.96-.09-.23-.48-.96-.82-1.15-.28-.15-.68-.54-.01-.55.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.9-3.64-4.01 0-.89.31-1.62.82-2.19-.08-.2-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.48 7.48 0 0 1 8 3.89c.68 0 1.36.09 2 .27 1.53-1.06 2.2-.84 2.2-.84.44 1.12.16 1.96.08 2.16.51.57.82 1.3.82 2.19 0 3.12-1.87 3.8-3.65 4.01.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.47.55.39A8.04 8.04 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z" })
													})
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													className: "token-monitor-settings__update-check",
													type: "button",
													disabled: updateAction !== void 0,
													onClick: () => {
														checkForUpdates();
													},
													children: updateAction === "check" ? "检查中…" : "检查更新"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													className: "token-monitor-settings__update-install",
													type: "button",
													disabled: updateAction !== void 0 || updateStatus?.hasUpdate !== true,
													onClick: () => {
														installUpdate();
													},
													children: updateAction === "install" ? "安装中…" : "安装更新"
												})
											]
										}),
										updateStatus !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											style: {
												...descriptionStyle(),
												marginBottom: 0
											},
											children: [
												"最新 v",
												updateStatus.latestVersion,
												updateStatus.asset === null ? " · 暂无可用安装包" : ""
											]
										}),
										updateMessage !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											"aria-live": "polite",
											style: {
												...descriptionStyle(),
												marginBottom: 0,
												color: "#3f8f6a"
											},
											children: updateMessage
										}),
										updateError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											role: "alert",
											style: {
												...descriptionStyle(),
												marginBottom: 0,
												color: "#bd3e5a"
											},
											children: updateError
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: "token-monitor-settings__section token-monitor-settings__section--notification",
								style: SECTION,
								"aria-labelledby": "notification-settings-title",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										id: "notification-settings-title",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionTitle, {
											iconName: "cute-icon-notification",
											title: "通知渠道"
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchField, {
										id: "whale-bubble-enabled",
										label: "鲸鱼娘通知气泡",
										checked: draft.whaleBubbleEnabled,
										onChange: (value) => {
											updateDraft("whaleBubbleEnabled", value);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchField, {
										id: "wechat-notifications-enabled",
										label: "微信通知",
										checked: draft.wechatNotificationsEnabled,
										onChange: (value) => {
											updateDraft("wechatNotificationsEnabled", value);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "token-monitor-settings__wechat",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												"aria-live": "polite",
												className: "token-monitor-settings__wechat-status",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														"aria-hidden": "true",
														style: {
															width: 9,
															height: 9,
															marginTop: 5,
															borderRadius: "50%",
															background: status?.auth === "authenticated" ? "#46a878" : "#9eb2df",
															boxShadow: "0 0 0 4px rgba(56,88,168,.10)"
														}
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "token-monitor-settings__wechat-status-copy",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																style: {
																	color: "#283868",
																	fontSize: 13,
																	fontWeight: 700
																},
																children: connectionSummary(status)
															}),
															status?.identity !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																style: descriptionStyle(),
																children: ["账号 ", status.identity.maskedUserId]
															}),
															deliverySummary(status) !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																style: descriptionStyle(),
																children: deliverySummary(status)
															}),
															status?.lastError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																style: {
																	...descriptionStyle(),
																	color: "#bd3e5a"
																},
																children: status.lastError.message
															}),
															statusError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																role: "alert",
																style: {
																	...descriptionStyle(),
																	color: "#bd3e5a"
																},
																children: statusError
															})
														]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														className: "token-monitor-settings__wechat-refresh",
														type: "button",
														disabled: action !== void 0,
														onClick: () => {
															refreshStatus();
														},
														style: actionButtonStyle(action !== void 0),
														children: "刷新"
													})
												]
											}),
											ownershipHint !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "token-monitor-settings__wechat-hint",
												"data-wechat-ownership-hint": "",
												style: {
													margin: "10px 0 0",
													padding: "9px 11px",
													borderRadius: 10,
													background: "rgba(230,167,81,.11)",
													color: "#6874a8",
													fontSize: 12,
													lineHeight: 1.5
												},
												children: ownershipHint
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "token-monitor-settings__qr-area",
												"data-wechat-qr-area": "",
												children: loginSession === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "登录微信后，二维码显示在此处" }) : props.renderLoginQr === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LocalLoginQr, { payload: loginSession.qrPayload }) : props.renderLoginQr(loginSession.qrPayload)
											}),
											loginSession !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "token-monitor-settings__qr-meta",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: descriptionStyle(),
													children: [
														"二维码约 ",
														String(secondsRemaining ?? 0),
														" 秒后失效。"
													]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
													style: {
														marginTop: 5,
														textAlign: "left"
													},
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
														style: {
															cursor: "pointer",
															color: "#6874a8",
															fontSize: 12
														},
														children: "二维码无法加载？打开登录链接"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
														href: loginSession.qrPayload,
														target: "_blank",
														rel: "noreferrer",
														"data-wechat-qr-link": "",
														style: {
															display: "block",
															marginTop: 6,
															color: "#3858a8",
															fontSize: 11,
															overflowWrap: "anywhere"
														},
														children: loginSession.qrPayload
													})]
												})]
											}),
											loginSession === void 0 && status?.pendingLogin !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												style: {
													...descriptionStyle(),
													margin: "10px 0 0"
												},
												children: "Host 中仍有短时登录会话；二维码不会跨面板恢复，可确认状态或重新获取。"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "token-monitor-settings__wechat-actions",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "token-monitor-settings__wechat-actions-short",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														disabled: !canReconnect,
														onClick: () => {
															reconnect();
														},
														style: actionButtonStyle(!canReconnect),
														children: action === "reconnect" ? "正在重连…" : "重连"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														disabled: !canDisconnect,
														onClick: () => {
															setDisconnectConfirmation(true);
														},
														style: actionButtonStyle(!canDisconnect, true),
														children: "断开"
													})]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "token-monitor-settings__wechat-actions-long",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															disabled: !canLogin,
															onClick: () => {
																startLogin();
															},
															style: actionButtonStyle(!canLogin),
															children: action === "login" ? "正在获取…" : "登录微信"
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															disabled: !canConfirm,
															onClick: () => {
																confirmLogin();
															},
															style: actionButtonStyle(!canConfirm),
															children: action === "confirm" ? "正在确认…" : "确认登录状态"
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															disabled: !canTestMessage,
															onClick: () => {
																testMessage();
															},
															style: actionButtonStyle(!canTestMessage),
															children: action === "test" ? "正在发送…" : "发送测试消息"
														})
													]
												})]
											}),
											disconnectConfirmation && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												role: "alertdialog",
												"aria-label": "确认断开微信连接",
												style: {
													marginTop: 12,
													padding: 12,
													border: "1px solid rgba(204,72,99,.30)",
													borderRadius: 12,
													background: "rgba(204,72,99,.07)"
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														style: {
															fontSize: 13,
															fontWeight: 750
														},
														children: "确定断开 DSH Host 管理的微信 bridge？"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														style: descriptionStyle(),
														children: "只会操作 Host-owned 进程；外部 bridge 不会被结束。"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "token-monitor-settings__disconnect-actions",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															disabled: action !== void 0,
															onClick: () => {
																setDisconnectConfirmation(false);
															},
															style: actionButtonStyle(action !== void 0),
															children: "取消"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															disabled: !canDisconnect,
															onClick: () => {
																disconnect();
															},
															style: {
																...actionButtonStyle(!canDisconnect, true),
																background: "#c94b68",
																color: "#fff",
																borderColor: "transparent"
															},
															children: action === "disconnect" ? "正在断开…" : "确认断开"
														})]
													})
												]
											}),
											actionMessage !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "token-monitor-settings__wechat-message",
												"aria-live": "polite",
												style: {
													...descriptionStyle(),
													marginBottom: 0,
													color: "#3f8f6a"
												},
												children: actionMessage
											}),
											actionError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "token-monitor-settings__wechat-message",
												role: "alert",
												style: {
													...descriptionStyle(),
													marginBottom: 0,
													color: "#bd3e5a"
												},
												children: actionError
											})
										]
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
						className: "token-monitor-settings__footer",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "token-monitor-settings__footer-message",
								"aria-live": "polite",
								style: {
									color: saveError === void 0 ? "#3f8f6a" : "#bd3e5a",
									fontSize: 12
								},
								children: saveError ?? (saveState === "saved" ? "设置已保存。" : "")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: props.onClose,
								style: BUTTON,
								children: "关闭"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								disabled: saveState === "saving",
								style: {
									...PRIMARY_BUTTON,
									opacity: saveState === "saving" ? .62 : 1,
									cursor: saveState === "saving" ? "wait" : "pointer"
								},
								children: saveState === "saving" ? "保存中…" : "保存设置"
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/notificationApi.ts
		const notificationKinds = [
			"charge",
			"budget-threshold",
			"peak-enter",
			"peak-exit",
			"cache-hit-anomaly"
		];
		const priorities = ["normal", "high"];
		const maximumBatchEvents = 2e3;
		/** HTTP failure from the notification endpoint. */
		var NotificationEventsApiError = class extends Error {
			status;
			constructor(status) {
				super(`Token Monitor notification request failed (HTTP ${String(status)})`);
				this.status = status;
				this.name = "NotificationEventsApiError";
			}
		};
		/** Invalid JSON or response fields from the notification endpoint. */
		var NotificationEventsProtocolError = class extends Error {
			field;
			constructor(field) {
				super(`Token Monitor notification response is invalid: ${field}`);
				this.field = field;
				this.name = "NotificationEventsProtocolError";
			}
		};
		function isRecord(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const prototype = Object.getPrototypeOf(value);
			return prototype === Object.prototype || prototype === null;
		}
		function exact(record, fields) {
			return fields.every((field) => Object.prototype.hasOwnProperty.call(record, field));
		}
		function boundedString(value, maximum) {
			return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
		}
		function nonNegativeSafeInteger(value) {
			return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
		}
		function finiteNumber(value) {
			return typeof value === "number" && Number.isFinite(value);
		}
		function parseBase(value, kind) {
			if (value.schemaVersion !== 1) throw new NotificationEventsProtocolError("events[].schemaVersion");
			if (!nonNegativeSafeInteger(value.seq) || value.seq === 0) throw new NotificationEventsProtocolError("events[].seq");
			if (!boundedString(value.id, 256)) throw new NotificationEventsProtocolError("events[].id");
			if (!boundedString(value.dedupeKey, 256) || value.dedupeKey !== value.id) throw new NotificationEventsProtocolError("events[].dedupeKey");
			if (value.kind !== kind) throw new NotificationEventsProtocolError("events[].kind");
			if (!nonNegativeSafeInteger(value.timestamp)) throw new NotificationEventsProtocolError("events[].timestamp");
			if (!priorities.includes(value.priority)) throw new NotificationEventsProtocolError("events[].priority");
			return {
				seq: value.seq,
				id: value.id,
				dedupeKey: value.dedupeKey,
				timestamp: value.timestamp,
				priority: value.priority
			};
		}
		function parseChargePayload(value) {
			if (!isRecord(value) || !exact(value, [
				"cost",
				"damageKind",
				"sessionId",
				"turn",
				"step",
				"provider",
				"model"
			])) throw new NotificationEventsProtocolError("events[].payload");
			if (!finiteNumber(value.cost) || value.cost <= 0) throw new NotificationEventsProtocolError("events[].payload.cost");
			if (value.damageKind !== "normal" && value.damageKind !== "miss") throw new NotificationEventsProtocolError("events[].payload.damageKind");
			if (!boundedString(value.sessionId, 256)) throw new NotificationEventsProtocolError("events[].payload.sessionId");
			if (!nonNegativeSafeInteger(value.turn)) throw new NotificationEventsProtocolError("events[].payload.turn");
			if (!nonNegativeSafeInteger(value.step)) throw new NotificationEventsProtocolError("events[].payload.step");
			if (!boundedString(value.provider, 256)) throw new NotificationEventsProtocolError("events[].payload.provider");
			if (!boundedString(value.model, 256)) throw new NotificationEventsProtocolError("events[].payload.model");
			return {
				cost: value.cost,
				damageKind: value.damageKind,
				sessionId: value.sessionId,
				turn: value.turn,
				step: value.step,
				provider: value.provider,
				model: value.model
			};
		}
		function parseBudgetPayload(value) {
			if (!isRecord(value) || !exact(value, [
				"date",
				"budget",
				"previousSpend",
				"currentSpend",
				"remaining"
			])) throw new NotificationEventsProtocolError("events[].payload");
			if (typeof value.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new NotificationEventsProtocolError("events[].payload.date");
			if (!finiteNumber(value.budget) || value.budget <= 0) throw new NotificationEventsProtocolError("events[].payload.budget");
			if (!finiteNumber(value.previousSpend) || value.previousSpend < 0) throw new NotificationEventsProtocolError("events[].payload.previousSpend");
			if (!finiteNumber(value.currentSpend) || value.currentSpend < value.budget || value.previousSpend >= value.budget) throw new NotificationEventsProtocolError("events[].payload.currentSpend");
			if (!finiteNumber(value.remaining)) throw new NotificationEventsProtocolError("events[].payload.remaining");
			return {
				date: value.date,
				budget: value.budget,
				previousSpend: value.previousSpend,
				currentSpend: value.currentSpend,
				remaining: value.remaining
			};
		}
		function parsePeakPayload(value, kind) {
			if (!isRecord(value) || !exact(value, [
				"from",
				"to",
				"periodKey"
			])) throw new NotificationEventsProtocolError("events[].payload");
			if (value.from !== "peak" && value.from !== "offPeak") throw new NotificationEventsProtocolError("events[].payload.from");
			if (value.to !== "peak" && value.to !== "offPeak") throw new NotificationEventsProtocolError("events[].payload.to");
			if (value.from === value.to || kind === "peak-enter" !== (value.to === "peak")) throw new NotificationEventsProtocolError("events[].payload.to");
			if (!boundedString(value.periodKey, 256)) throw new NotificationEventsProtocolError("events[].payload.periodKey");
			return {
				from: value.from,
				to: value.to,
				periodKey: value.periodKey
			};
		}
		function parseCacheHitAnomalyPayload(value) {
			if (!isRecord(value) || !exact(value, [
				"episodeId",
				"observedRate",
				"threshold",
				"sampleCount",
				"consecutiveCalls",
				"observedAt"
			])) throw new NotificationEventsProtocolError("events[].payload");
			if (!nonNegativeSafeInteger(value.episodeId) || value.episodeId < 1) throw new NotificationEventsProtocolError("events[].payload.episodeId");
			if (!finiteNumber(value.observedRate) || value.observedRate < 0 || value.observedRate > 1) throw new NotificationEventsProtocolError("events[].payload.observedRate");
			if (!finiteNumber(value.threshold) || value.threshold < 0 || value.threshold > 1) throw new NotificationEventsProtocolError("events[].payload.threshold");
			if (!nonNegativeSafeInteger(value.sampleCount) || value.sampleCount < 2) throw new NotificationEventsProtocolError("events[].payload.sampleCount");
			if (!nonNegativeSafeInteger(value.consecutiveCalls) || value.consecutiveCalls < 2) throw new NotificationEventsProtocolError("events[].payload.consecutiveCalls");
			if (!nonNegativeSafeInteger(value.observedAt)) throw new NotificationEventsProtocolError("events[].payload.observedAt");
			return {
				episodeId: value.episodeId,
				observedRate: value.observedRate,
				threshold: value.threshold,
				sampleCount: value.sampleCount,
				consecutiveCalls: value.consecutiveCalls,
				observedAt: value.observedAt
			};
		}
		function parseEvent(value) {
			if (!isRecord(value) || !exact(value, [
				"schemaVersion",
				"seq",
				"id",
				"dedupeKey",
				"kind",
				"timestamp",
				"priority",
				"payload"
			])) throw new NotificationEventsProtocolError("events[]");
			if (!notificationKinds.includes(value.kind)) throw new NotificationEventsProtocolError("events[].kind");
			const kind = value.kind;
			const base = parseBase(value, kind);
			switch (kind) {
				case "charge": return {
					schemaVersion: 1,
					...base,
					kind,
					payload: parseChargePayload(value.payload)
				};
				case "budget-threshold": return {
					schemaVersion: 1,
					...base,
					kind,
					payload: parseBudgetPayload(value.payload)
				};
				case "peak-enter":
				case "peak-exit": return {
					schemaVersion: 1,
					...base,
					kind,
					payload: parsePeakPayload(value.payload, kind)
				};
				case "cache-hit-anomaly": return {
					schemaVersion: 1,
					...base,
					kind,
					payload: parseCacheHitAnomalyPayload(value.payload)
				};
			}
		}
		/**
		* Validate and copy an untrusted notification response.
		* @param value Parsed JSON from the Host endpoint.
		* @returns A batch containing only validated fields.
		*/
		function parseNotificationEventsBatch(value) {
			if (!isRecord(value) || !exact(value, [
				"streamId",
				"seq",
				"events"
			])) throw new NotificationEventsProtocolError("response");
			if (!boundedString(value.streamId, 128)) throw new NotificationEventsProtocolError("streamId");
			if (!nonNegativeSafeInteger(value.seq)) throw new NotificationEventsProtocolError("seq");
			if (!Array.isArray(value.events) || value.events.length > maximumBatchEvents) throw new NotificationEventsProtocolError("events");
			const events = value.events.map(parseEvent);
			let previousSeq = 0;
			const dedupeKeys = /* @__PURE__ */ new Set();
			for (const event of events) {
				if (event.seq <= previousSeq || event.seq > value.seq) throw new NotificationEventsProtocolError("events[].seq");
				if (dedupeKeys.has(event.dedupeKey)) throw new NotificationEventsProtocolError("events[].dedupeKey");
				previousSeq = event.seq;
				dedupeKeys.add(event.dedupeKey);
			}
			return {
				streamId: value.streamId,
				seq: value.seq,
				events
			};
		}
		function assertSince(since) {
			if (!Number.isSafeInteger(since) || since < 0) throw new RangeError("since must be a non-negative safe integer");
		}
		function assertCursor(cursor) {
			assertSince(cursor.seq);
			if (cursor.streamId === void 0) {
				if (cursor.seq !== 0) throw new RangeError("a cursor without streamId must start at seq 0");
				return;
			}
			if (!boundedString(cursor.streamId, 128)) throw new RangeError("cursor.streamId must be a non-empty string");
		}
		function isAbort(error, signal) {
			return signal?.aborted === true || error instanceof Error && error.name === "AbortError";
		}
		function failure(error, signal) {
			if (isAbort(error, signal)) return {
				ok: false,
				failure: {
					kind: "aborted",
					message: "Notification poll was aborted"
				}
			};
			if (error instanceof NotificationEventsApiError) return {
				ok: false,
				failure: {
					kind: "http",
					message: error.message,
					status: error.status
				}
			};
			if (error instanceof NotificationEventsProtocolError) return {
				ok: false,
				failure: {
					kind: "protocol",
					message: error.message
				}
			};
			return {
				ok: false,
				failure: {
					kind: "network",
					message: error instanceof Error ? error.message : "Notification request failed"
				}
			};
		}
		/**
		* Create a browser client for the Host notification stream.
		* @param fetcher Fetch implementation used by the browser runtime or tests.
		* @param endpoint Notification endpoint path.
		* @returns Strict and fail-soft notification operations.
		*/
		function createNotificationEventsApi(fetcher = fetch, endpoint = "/api/token-monitor/notification-events") {
			const request = async (since, signal) => {
				assertSince(since);
				const response = await fetcher(`${endpoint}${endpoint.includes("?") ? "&" : "?"}since=${String(since)}`, {
					method: "GET",
					cache: "no-store",
					...signal === void 0 ? {} : { signal }
				});
				if (!response.ok) throw new NotificationEventsApiError(response.status);
				let value;
				try {
					value = await response.json();
				} catch {
					throw new NotificationEventsProtocolError("response");
				}
				return parseNotificationEventsBatch(value);
			};
			return {
				get: request,
				async poll(cursor, signal) {
					assertCursor(cursor);
					try {
						let batch = await request(cursor.seq, signal);
						const streamChanged = cursor.streamId !== void 0 && batch.streamId !== cursor.streamId;
						if (streamChanged && cursor.seq !== 0) batch = await request(0, signal);
						return {
							ok: true,
							requestedCursor: { ...cursor },
							streamChanged,
							batch
						};
					} catch (error) {
						return failure(error, signal);
					}
				}
			};
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/notificationQueue.ts
		const defaultDedupeCapacity = 2e3;
		function assertNonNegativeInteger(value, name) {
			if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
		}
		function appendSeen(keys, key, capacity) {
			keys.push(key);
			if (keys.length > capacity) keys.splice(0, keys.length - capacity);
		}
		function cursorsEqual(left, right) {
			return left.seq === right.seq && left.streamId === right.streamId;
		}
		/**
		* Create an empty notification queue.
		* @param options Bounded dedupe options.
		* @returns Initial state with an unbound stream cursor.
		*/
		function createNotificationQueueState(options = {}) {
			const dedupeCapacity = options.dedupeCapacity ?? defaultDedupeCapacity;
			if (!Number.isSafeInteger(dedupeCapacity) || dedupeCapacity <= 0) throw new RangeError("dedupeCapacity must be a positive safe integer");
			return {
				cursor: { seq: 0 },
				ready: [],
				seenDedupeKeys: [],
				dedupeCapacity
			};
		}
		/**
		* Apply a validated Host batch without mutating its raw events.
		* @param state Current immutable queue state.
		* @param batch Strictly parsed Host batch.
		* @param now Current epoch time, validated for consistency with poll callers.
		* @returns Updated queue state and stream/application metadata.
		*/
		function applyNotificationBatch(state, batch, now) {
			assertNonNegativeInteger(now, "now");
			const sameStream = state.cursor.streamId === batch.streamId;
			const streamChanged = state.cursor.streamId !== void 0 && !sameStream;
			if (sameStream && batch.seq < state.cursor.seq) return {
				state,
				accepted: 0,
				streamChanged: false,
				stale: true
			};
			const ready = [...state.ready];
			const seenDedupeKeys = [...state.seenDedupeKeys];
			const seen = new Set(seenDedupeKeys);
			let accepted = 0;
			for (const event of batch.events) {
				if (sameStream && event.seq <= state.cursor.seq) continue;
				if (seen.has(event.dedupeKey)) continue;
				seen.add(event.dedupeKey);
				appendSeen(seenDedupeKeys, event.dedupeKey, state.dedupeCapacity);
				accepted++;
				if (event.kind !== "charge") ready.push({
					kind: "event",
					event
				});
			}
			return {
				state: {
					...state,
					cursor: {
						streamId: batch.streamId,
						seq: batch.seq
					},
					ready,
					seenDedupeKeys
				},
				accepted,
				streamChanged,
				stale: false
			};
		}
		/**
		* Apply a fail-soft API result and ignore stale concurrent poll completions.
		* @param state Current immutable queue state.
		* @param result Result returned by NotificationEventsApi.poll.
		* @param now Current epoch time, validated by the batch application path.
		* @returns Updated state; failures preserve the cursor and queued events.
		*/
		function applyNotificationPollResult(state, result, now) {
			if (!result.ok) return {
				state,
				accepted: 0,
				streamChanged: false,
				stale: false,
				failure: result.failure
			};
			if (!cursorsEqual(state.cursor, result.requestedCursor)) return {
				state,
				accepted: 0,
				streamChanged: false,
				stale: true
			};
			return applyNotificationBatch(state, result.batch, now);
		}
		/**
		* Consume at most one ready visual item.
		* @param state Current immutable queue state.
		* @param now Current epoch time in milliseconds.
		* @returns The next visual item and remaining state, or only the advanced state.
		*/
		function dequeueNotificationItem(state, now) {
			assertNonNegativeInteger(now, "now");
			const item = state.ready[0];
			if (item === void 0) return { state };
			return {
				state: {
					...state,
					ready: state.ready.slice(1)
				},
				item
			};
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/useRouteEligibility.ts
		/** Current-session route visibility with abort + generation guards against stale settlements. */
		function useRouteEligibility(useSessions, load, bypass) {
			const sessionId = useSessions((snapshot) => snapshot.current);
			const generation = (0, react.useRef)(0);
			const [eligible, setEligible] = (0, react.useState)(bypass ? true : void 0);
			(0, react.useEffect)(() => {
				const currentGeneration = ++generation.current;
				if (bypass) {
					setEligible(true);
					return;
				}
				setEligible(void 0);
				if (sessionId === void 0 || load === void 0) return;
				const controller = new AbortController();
				let timer;
				const refresh = async () => {
					try {
						const next = await load(sessionId, controller.signal);
						if (!controller.signal.aborted && generation.current === currentGeneration) setEligible(next);
					} catch {
						if (!controller.signal.aborted && generation.current === currentGeneration) setEligible(void 0);
					} finally {
						if (!controller.signal.aborted) timer = setTimeout(() => {
							refresh();
						}, 5e3);
					}
				};
				refresh();
				return () => {
					controller.abort();
					clearTimeout(timer);
				};
			}, [
				bypass,
				load,
				sessionId
			]);
			return eligible;
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/WhaleGirlStage.tsx
		const ASSET_ROOT = "/assets/dsh-token-monitor/whale-girl";
		const IDLE_ROOT = `${ASSET_ROOT}/idle-v4-r2`;
		const FEEDBACK_EXPRESSION_ROOT = `${ASSET_ROOT}/feedback-expression-v4-r4-model/frames`;
		const CRITICAL_EXPRESSION_ROOT = `${ASSET_ROOT}/feedback-expression-v4-r5-critical-model/frames`;
		const BASE_IDLE_ASSET = `${IDLE_ROOT}/idle-08.png`;
		const REVIVE_ROOT = `${ASSET_ROOT}/revive-recharge-v1/frames`;
		const SIZE = 512;
		const IDLE_ASSETS = {
			...Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
				const name = `idle-${String(index + 1).padStart(2, "0")}`;
				return [name, `${IDLE_ROOT}/${name}.png`];
			})),
			...Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
				const name = `acting-${String(index + 1).padStart(2, "0")}`;
				return [name, `${IDLE_ROOT}/${name}.png`];
			})),
			"blink-half-close": `${IDLE_ROOT}/blink-half-close.png`,
			"blink-soft": `${IDLE_ROOT}/blink-soft.png`,
			"blink-reopen": `${IDLE_ROOT}/blink-reopen.png`
		};
		const FEEDBACK_EXPRESSION_ASSETS = Object.fromEntries([
			"weak",
			"normal",
			"critical"
		].flatMap((level) => [
			"half",
			"close",
			"reopen"
		].map((phase) => {
			const name = `${level}-${phase}`;
			return [name, `${FEEDBACK_EXPRESSION_ROOT}/${name}.png`];
		})));
		const CRITICAL_EXPRESSION_ASSETS = Object.fromEntries([
			"notice",
			"brace",
			"peak",
			"overflow",
			"comfort",
			"recover"
		].map((phase) => [`critical-r5-${phase}`, `${CRITICAL_EXPRESSION_ROOT}/critical-${phase}.png`]));
		const REVIVE_ASSETS = Object.fromEntries([
			"death-start",
			"wake",
			"lift",
			"relief",
			"hop",
			"settle",
			"reopen"
		].map((name) => [`revive-${name}`, `${REVIVE_ROOT}/revive-${name}.png`]));
		const ACTION_DURATIONS = {
			blink: 760,
			peek: 2850,
			tilt: 3100,
			tail: 4600,
			nibble: 4800
		};
		const clamp$1 = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
		const smoother = (value) => {
			const x = clamp$1(value);
			return x * x * x * (x * (x * 6 - 15) + 10);
		};
		const wave = (progress, cycles = 1, phase = 0) => Math.sin((progress * cycles + phase) * Math.PI * 2);
		const pulse = (progress, start, end) => Math.sin(Math.PI * clamp$1((progress - start) / (end - start)));
		const envelope = (progress, start = .08, end = .9) => {
			if (progress <= start) return smoother(progress / start);
			if (progress >= end) return 1 - smoother((progress - end) / (1 - end));
			return 1;
		};
		function idleMotion(now, epoch, strength) {
			const t = (now - epoch) / 1e3;
			return {
				x: (.34 * wave(t, .13) + .16 * wave(t, .31, .2)) * strength,
				y: (-.7 + .62 * wave(t, .245) + .14 * wave(t, .61, .35)) * strength,
				angle: (.18 * wave(t, .17) + .08 * wave(t, .43, .4)) * strength,
				sx: 1 + .0013 * wave(t, .245, .5) * strength,
				sy: 1 + .0018 * wave(t, .245) * strength
			};
		}
		function loadImage(url) {
			return new Promise((resolve, reject) => {
				const image = new Image();
				image.onload = async () => {
					try {
						await image.decode();
					} catch {}
					resolve(image);
				};
				image.onerror = () => reject(/* @__PURE__ */ new Error(`Failed to load whale-girl asset: ${url}`));
				image.src = url;
			});
		}
		/**
		* 鲸鱼娘固定 512px 单画布舞台。待机和旧反馈姿态均先在离屏画布完成，再一次提交可见帧。
		* @param props 当前由既有余额事件状态机选择的反馈姿态。
		* @returns 宽度由父容器固定为余额卡 80% 的透明 Canvas。
		*/
		const isPainPose = (pose) => ![
			"idle",
			"heal-happy",
			"revive-recharge"
		].includes(pose);
		function WhaleGirlStage({ pose, impactPulse = 0, onPoseComplete, syncEpoch }) {
			const canvasRef = (0, react.useRef)(null);
			const poseRef = (0, react.useRef)(pose);
			const impactPulseRef = (0, react.useRef)(impactPulse);
			const onPoseCompleteRef = (0, react.useRef)(onPoseComplete);
			(0, react.useEffect)(() => {
				poseRef.current = pose;
			}, [pose]);
			(0, react.useEffect)(() => {
				impactPulseRef.current = impactPulse;
			}, [impactPulse]);
			(0, react.useEffect)(() => {
				onPoseCompleteRef.current = onPoseComplete;
			}, [onPoseComplete]);
			(0, react.useEffect)(() => {
				const canvas = canvasRef.current;
				if (canvas === null) return;
				const context = canvas.getContext("2d", { alpha: true });
				if (context === null) return;
				const buffer = document.createElement("canvas");
				buffer.width = SIZE;
				buffer.height = SIZE;
				const bufferContext = buffer.getContext("2d", { alpha: true });
				if (bufferContext === null) return;
				context.imageSmoothingEnabled = true;
				context.imageSmoothingQuality = "high";
				bufferContext.imageSmoothingEnabled = true;
				bufferContext.imageSmoothingQuality = "high";
				let disposed = false;
				let frame = 0;
				let idleEpoch = syncEpoch ?? performance.now();
				let action = null;
				let actionStartedAt = 0;
				let nextActionAt = idleEpoch + (syncEpoch === void 0 ? 2500 + Math.random() * 2500 : 900);
				let lastAction = null;
				let showcaseActionIndex = 0;
				let lastPose = poseRef.current;
				let feedbackStartedAt = idleEpoch;
				let lastImpactPulse = impactPulseRef.current;
				let lastImpactAt = idleEpoch;
				let reviveCompleted = false;
				let reviveReady = false;
				let reviveWaitingForAssets = poseRef.current === "revive-recharge";
				let tiltSide = 1;
				const images = /* @__PURE__ */ new Map();
				const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
				const draw = (image, motion = {}, yOffset = 0) => {
					if (image === void 0) return;
					const x = motion.x ?? 0;
					const y = motion.y ?? 0;
					const angle = motion.angle ?? 0;
					const sx = motion.sx ?? 1;
					const sy = motion.sy ?? 1;
					bufferContext.save();
					bufferContext.translate(256 + x, 470 + y);
					bufferContext.rotate(angle * Math.PI / 180);
					bufferContext.scale(sx, sy);
					bufferContext.drawImage(image, -256, -470 + yOffset, SIZE, SIZE);
					bufferContext.restore();
				};
				const present = () => {
					context.save();
					context.globalCompositeOperation = "copy";
					context.drawImage(buffer, 0, 0);
					context.restore();
				};
				const begin = () => bufferContext.clearRect(0, 0, SIZE, SIZE);
				const get = (name) => images.get(name);
				const poseKey = (progress, keys) => keys[Math.min(keys.length - 1, Math.floor(clamp$1(progress) * keys.length))];
				const renderIdle = (now) => {
					const motion = idleMotion(now, idleEpoch, reducedMotion.matches ? .18 : 1);
					motion.x = clamp$1(motion.x, -.45, .45);
					motion.angle = clamp$1(motion.angle, -.16, .16);
					draw(get("idle-08"), motion);
				};
				const renderAction = (name, progress, now) => {
					if (name === "blink") {
						const key = poseKey(progress, [
							"idle",
							"half-close",
							"soft",
							"soft",
							"reopen",
							"half-close",
							"idle"
						]);
						const motion = idleMotion(now, idleEpoch, .18);
						motion.x = clamp$1(motion.x, -.35, .35);
						motion.angle = clamp$1(motion.angle, -.12, .12);
						draw(get(key === "idle" ? "idle-08" : `blink-${key}`), motion);
						return;
					}
					if (name === "peek") {
						const phase = progress < .16 ? 5 : progress < .4 ? 6 : progress < .72 ? 7 : 8;
						const q = envelope(progress, .11, .86);
						const motion = idleMotion(now, idleEpoch, .35);
						motion.x += -3.2 * pulse(progress, 0, .14) + 7.2 * q + .9 * wave(progress, 1.65) * q * (1 - progress);
						motion.y += 6.4 * q + 1.1 * wave(progress, 2.3) * q;
						motion.angle += 2.4 * q + .8 * wave(progress) * q;
						draw(get(`acting-${String(phase).padStart(2, "0")}`), motion);
						return;
					}
					if (name === "tilt") {
						const q = envelope(progress, .16, .82);
						const settle = 1.1 * wave(progress, 2.2) * q * (1 - progress);
						const motion = idleMotion(now, idleEpoch, .35);
						motion.x += tiltSide * (7.8 * q + 1.2 * settle);
						motion.y += 4.8 * q;
						motion.angle += tiltSide * (6.8 * q + settle);
						draw(get(q > .48 ? tiltSide > 0 ? "idle-04" : "idle-03" : "idle-08"), motion);
						return;
					}
					if (name === "tail") {
						const q = envelope(progress, .12, .88);
						const sway = wave(progress, 1.5);
						const motion = idleMotion(now, idleEpoch, .25);
						motion.x += clamp$1(-5.4 * sway * q, -5.4, 3.6);
						motion.y -= 5 * q;
						motion.angle += (-2.35 * sway + .65 * wave(progress, 3, .18) * q * (1 - progress)) * q;
						draw(get("idle-08"), motion);
						return;
					}
					const phase = progress < .18 ? 1 : progress < .38 ? 2 : progress < .68 ? 3 : progress < .88 ? 2 : 4;
					const q = envelope(progress, .1, .91);
					const motion = idleMotion(now, idleEpoch, .3);
					motion.x += -4.8 * q + 1.3 * wave(progress, 1.4) * q;
					motion.y += 7.2 * q + (phase === 3 ? 1.1 * wave(progress, 5.5) : 0);
					motion.angle += -2.2 * q + .7 * wave(progress, 1.2) * q * (1 - progress);
					draw(get(`acting-${String(phase).padStart(2, "0")}`), motion);
				};
				const drawImpactMark = (x, y, size, alpha) => {
					bufferContext.save();
					bufferContext.translate(x, y);
					bufferContext.globalAlpha = clamp$1(alpha);
					bufferContext.strokeStyle = "#ff758c";
					bufferContext.lineWidth = 4;
					bufferContext.lineCap = "round";
					for (let index = 0; index < 3; index += 1) {
						bufferContext.rotate(-Math.PI / 3);
						bufferContext.beginPath();
						bufferContext.moveTo(0, -size * .35);
						bufferContext.lineTo(0, -size);
						bufferContext.stroke();
					}
					bufferContext.restore();
				};
				/**
				* 反馈始终使用 V4 同身份的完整单源帧。眼睛、嘴、腮红和泪滴全部来自
				* Sota gpt-image-2 素材；运行时只画一张完整人物图，不程序绘制或叠加面部。
				* 脸区以外像素和透明轮廓逐像素继承 idle-v4-r2 母版。
				*/
				const renderFeedback = (currentPose, now) => {
					const elapsed = Math.max(0, now - feedbackStartedAt);
					const sinceImpact = Math.max(0, now - lastImpactAt);
					const progress = clamp$1(elapsed / 1250);
					const impactProgress = clamp$1(sinceImpact / 1250);
					const release = Math.max(envelope(progress, .08, .78), envelope(impactProgress, .08, .78));
					const motion = idleMotion(now, idleEpoch, .08);
					const feedbackFrame = (pain = true) => {
						if (elapsed < 80) return get("idle-08");
						if (!pain) {
							if (elapsed < 155) return get("blink-half-close");
							if (elapsed < 980) return get("blink-soft");
							if (elapsed < 1060) return get("blink-half-close");
							if (elapsed < 1145) return get("blink-reopen");
							return get("idle-08");
						}
						const criticalFrame = () => {
							if (elapsed < 165) return get("critical-r5-notice");
							if (elapsed < 300) return get("critical-r5-brace");
							if (elapsed < 500 || sinceImpact < 430) return get("critical-r5-peak");
							if (elapsed < 720 || sinceImpact < 650) return get("critical-r5-overflow");
							if (sinceImpact < 940) return get("critical-r5-comfort");
							if (sinceImpact < 1155) return get("critical-r5-recover");
							return get("idle-08");
						};
						if (currentPose === "critical-pain" || currentPose === "critical-combo") return criticalFrame();
						const level = currentPose === "weak-pain" ? "weak" : "normal";
						if (elapsed < 165) return get(`${level}-half`);
						if (elapsed < 650 || sinceImpact < 650) return get(`${level}-close`);
						if (sinceImpact < 900) return get(`${level}-half`);
						if (sinceImpact < 990) return get(`${level}-close`);
						if (sinceImpact < 1080) return get(`${level}-half`);
						if (sinceImpact < 1155) return get(`${level}-reopen`);
						return get("idle-08");
					};
					if (currentPose === "heal-happy") {
						motion.y -= 7.2 * pulse(progress, 0, .58);
						motion.x += 1.1 * wave(progress, 1.5) * release;
						motion.angle += 1.25 * wave(progress, 1.5) * release;
						draw(feedbackFrame(false), motion);
						bufferContext.save();
						bufferContext.globalAlpha = .72 * release;
						bufferContext.fillStyle = "#72e6b1";
						bufferContext.font = "700 25px system-ui, sans-serif";
						bufferContext.fillText("+", 155, 345 - 9 * progress);
						bufferContext.fillText("✦", 349, 316 - 12 * progress);
						bufferContext.restore();
						return;
					}
					const strength = currentPose === "weak-pain" ? .5 : currentPose === "normal-pain" ? .76 : 1;
					const hit = Math.max(Math.exp(-elapsed / 150), Math.exp(-sinceImpact / 150) * .65);
					const tremble = Math.sin(elapsed * .105) * hit * strength;
					motion.x += (-7.5 * hit + 2.2 * tremble) * strength;
					motion.y += (2.4 * hit + 3.8 * pulse(progress, 0, .55)) * strength;
					motion.angle += (-1.7 * hit + .55 * tremble) * strength;
					if (currentPose === "critical-combo") {
						const comboRelease = Math.max(0, 1 - progress * 1.15);
						motion.x += Math.sin(elapsed * .16) * comboRelease * 3.4;
						motion.angle += Math.sin(elapsed * .11) * comboRelease * .7;
					}
					draw(feedbackFrame(), motion);
					drawImpactMark(346, 294, 16 + 5 * strength, release * strength);
				};
				/**
				* 复苏使用六张图片模型生成的完整人物关键姿势。任意可见帧只绘制
				* 一张完整人物图；姿势停留区间仅施加刚体位移/旋转/缩放和缓动。
				*/
				const renderRevive = (now) => {
					if (!reviveReady) {
						draw(get("revive-death-start") ?? get("idle-08"));
						return;
					}
					const elapsed = Math.max(0, now - feedbackStartedAt);
					let key = "revive-death-start";
					const motion = {
						x: 0,
						y: 0,
						angle: 0,
						sx: 1,
						sy: 1
					};
					if (elapsed < 220) motion.y = 1.5 * smoother(elapsed / 220);
					else if (elapsed < 720) {
						key = "revive-wake";
						const p = (elapsed - 220) / 500;
						motion.y = 3 - 3 * smoother(p);
						motion.angle = -.8 * pulse(p, 0, .62);
					} else if (elapsed < 1250) {
						key = "revive-lift";
						const p = (elapsed - 720) / 530;
						motion.y = 4 - 6 * smoother(p);
						motion.angle = .65 * pulse(p, 0, .72);
					} else if (elapsed < 1900) {
						key = "revive-relief";
						const p = (elapsed - 1250) / 650;
						motion.y = -2 - 1.2 * wave(p, .72);
						motion.angle = .35 * wave(p, .7);
					} else if (elapsed < 2400) {
						key = "revive-hop";
						const p = (elapsed - 1900) / 500;
						motion.y = -3 - 15 * Math.sin(Math.PI * p);
						motion.angle = -.7 * Math.sin(Math.PI * p);
						motion.sx = 1 - .008 * Math.sin(Math.PI * p);
						motion.sy = 1 + .008 * Math.sin(Math.PI * p);
					} else if (elapsed < 2850) {
						key = "revive-settle";
						const p = (elapsed - 2400) / 450;
						const settle = Math.sin(p * Math.PI * 2.4) * (1 - p);
						motion.y = 3.6 * settle;
						motion.sx = 1 + .006 * Math.max(0, settle);
						motion.sy = 1 - .006 * Math.max(0, settle);
					} else {
						key = "revive-reopen";
						const p = clamp$1((elapsed - 2850) / 500);
						motion.y = -.8 * Math.sin(Math.PI * p);
					}
					draw(get(key), motion);
					if (elapsed >= 3350 && !reviveCompleted) {
						reviveCompleted = true;
						queueMicrotask(() => onPoseCompleteRef.current?.("revive-recharge"));
					}
				};
				const chooseAction = () => {
					if (reducedMotion.matches) return "blink";
					if (syncEpoch !== void 0) {
						const sequence = [
							"blink",
							"tail",
							"tilt",
							"peek",
							"nibble"
						];
						const selected = sequence[showcaseActionIndex % sequence.length];
						showcaseActionIndex += 1;
						return selected;
					}
					const choices = [
						"peek",
						"tilt",
						"tail",
						"nibble",
						"blink",
						"tail",
						"tilt",
						"nibble"
					].filter((candidate) => candidate !== lastAction);
					return choices[Math.floor(Math.random() * choices.length)];
				};
				const tick = (now) => {
					const currentPose = poseRef.current;
					const currentImpactPulse = impactPulseRef.current;
					if (currentImpactPulse !== lastImpactPulse) {
						lastImpactPulse = currentImpactPulse;
						lastImpactAt = now;
					}
					if (currentPose !== lastPose) {
						action = null;
						idleEpoch = now;
						if (isPainPose(currentPose) !== isPainPose(lastPose) || currentPose === "heal-happy" || lastPose === "heal-happy" || currentPose === "revive-recharge" || lastPose === "revive-recharge") feedbackStartedAt = now;
						if (currentPose === "revive-recharge") {
							reviveCompleted = false;
							reviveWaitingForAssets = !reviveReady;
						}
						nextActionAt = now + (syncEpoch === void 0 ? 2200 + Math.random() * 2800 : 700);
						lastPose = currentPose;
					}
					if (currentPose === "revive-recharge" && reviveWaitingForAssets && reviveReady) {
						feedbackStartedAt = now;
						reviveWaitingForAssets = false;
					}
					begin();
					if (currentPose === "revive-recharge") renderRevive(now);
					else if (currentPose !== "idle") renderFeedback(currentPose, now);
					else if (action !== null) {
						const progress = clamp$1((now - actionStartedAt) / ACTION_DURATIONS[action]);
						renderAction(action, progress, now);
						if (progress >= 1) {
							lastAction = action;
							action = null;
							idleEpoch = now - 700;
							nextActionAt = now + (syncEpoch === void 0 ? 1800 + Math.random() * 4200 : 700);
						}
					} else {
						renderIdle(now);
						if (now >= nextActionAt) {
							action = chooseAction();
							if (action === "tilt") tiltSide *= -1;
							actionStartedAt = now;
						}
					}
					present();
					if (!disposed) frame = requestAnimationFrame(tick);
				};
				const baseUrl = BASE_IDLE_ASSET;
				const reviveDeathUrl = REVIVE_ASSETS["revive-death-start"];
				const reviveMotionUrls = Object.values(REVIVE_ASSETS).filter((url) => url !== reviveDeathUrl);
				const backgroundUrls = [
					...Object.values(IDLE_ASSETS),
					...Object.values(FEEDBACK_EXPRESSION_ASSETS),
					...Object.values(CRITICAL_EXPRESSION_ASSETS)
				].filter((url) => url !== baseUrl);
				loadImage(baseUrl).then((baseImage) => {
					if (disposed) return;
					images.set(baseUrl, baseImage);
					images.set("idle-08", baseImage);
					frame = requestAnimationFrame(tick);
					return loadImage(reviveDeathUrl);
				}).then((deathImage) => {
					if (disposed || deathImage === void 0) return;
					images.set(reviveDeathUrl, deathImage);
					images.set("revive-death-start", deathImage);
					return Promise.all(reviveMotionUrls.map(async (url) => [url, await loadImage(url)]));
				}).then((reviveLoaded) => {
					if (disposed || reviveLoaded === void 0) return;
					for (const [url, image] of reviveLoaded) images.set(url, image);
					for (const [name, url] of Object.entries(REVIVE_ASSETS)) images.set(name, images.get(url));
					reviveReady = true;
					return Promise.all(backgroundUrls.map(async (url) => [url, await loadImage(url)]));
				}).then((loaded) => {
					if (disposed || loaded === void 0) return;
					for (const [url, image] of loaded) images.set(url, image);
					for (const [name, url] of Object.entries(IDLE_ASSETS)) images.set(name, images.get(url));
					for (const [name, url] of Object.entries(FEEDBACK_EXPRESSION_ASSETS)) images.set(name, images.get(url));
					for (const [name, url] of Object.entries(CRITICAL_EXPRESSION_ASSETS)) images.set(name, images.get(url));
				}).catch((error) => {
					if (!disposed) console.error(error);
				});
				return () => {
					disposed = true;
					cancelAnimationFrame(frame);
				};
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
				ref: canvasRef,
				width: SIZE,
				height: SIZE,
				style: {
					display: "block",
					width: "100%",
					height: "100%"
				}
			});
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/peakPeriod.ts
		/** 工作日高峰时段（北京时间，半开区间 [start, end)）。 */
		const PEAK_HOURS = [[9, 12], [14, 18]];
		/** 判断时间戳是否处于北京时间高峰；周末全天返回低谷。 */
		function isPeakPeriod(ts, peakHours = PEAK_HOURS) {
			const parts = new Intl.DateTimeFormat("en-GB", {
				timeZone: "Asia/Shanghai",
				hour: "2-digit",
				hour12: false,
				weekday: "short"
			}).formatToParts(new Date(ts));
			const weekday = parts.find((part) => part.type === "weekday")?.value;
			if (weekday === "Sat" || weekday === "Sun") return false;
			const hour = Number(parts.find((part) => part.type === "hour")?.value ?? -1);
			return peakHours.some(([start, end]) => hour >= start && hour < end);
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/balanceMath.ts
		/** Apply one queued debit to the local visual balance without hiding overdraft. */
		function applyDebitToDisplay(previous, debit) {
			if (previous === null || !Number.isFinite(debit) || debit < 0) return previous;
			return previous - debit;
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/BalanceWidget.tsx
		/**
		* 余额悬浮卡片：挂载在 frame 级浮动层（shell.overlay，右下角）。
		*
		* 数据源两个：
		* - 扣费：每秒增量拉取 /api/token-monitor/charge-events（Host collector 每次模型调用算出的精确 cost），
		*   按 seq 逐事件排队 → 每条独立飘字 + 余额逐条扣减 + 可打断的连续回弹 + 鲸鱼娘持续受击。
		* - 余额：每 60 秒拉取 /api/token-monitor/balance，校准显示余额；检测到余额变多（充值）→
		*   绿色「加费」飘字动画 + 数字绿色闪烁。
		*
		* 全局（root scope）组件，无 session 依赖。
		*/
		const settingsApi = createTokenMonitorSettingsApi();
		const notificationEventsApi = createNotificationEventsApi();
		const wechatConnectionApi = createWechatConnectionApi();
		const CARD = {
			position: "fixed",
			padding: "6px 12px",
			borderRadius: 8,
			background: "var(--dsh-color-surface-overlay, rgba(30, 30, 30, 0.82))",
			color: "var(--dsh-color-text, #e8e8e8)",
			fontSize: 16,
			lineHeight: "22px",
			fontVariantNumeric: "tabular-nums",
			pointerEvents: "auto",
			cursor: "grab",
			userSelect: "none",
			boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
			zIndex: 1e3
		};
		const RED = "#ff3b30";
		const GREEN = "#30a46c";
		const DEATH_ASSET = `/assets/dsh-token-monitor/whale-girl/death-stranded-v6-trim.png`;
		/** 附件参考节奏：扣费文字以最终字号快速显现，平稳上飘后渐隐。 */
		const KEYFRAMES = `
@keyframes tkm-impact-float {
  0%   { opacity: 0; transform: translate3d(0, 5px, 0); }
  8%   { opacity: 1; transform: translate3d(0, 0, 0); }
  64%  { opacity: 1; transform: translate3d(0, -32px, 0); }
  82%  { opacity: .76; transform: translate3d(0, -43px, 0); }
  100% { opacity: 0; transform: translate3d(0, -56px, 0); }
}
@keyframes tkm-impact-float-reduced {
  0%   { opacity: 0; transform: translate3d(0, 6px, 0); }
  35%  { opacity: 1; transform: translate3d(0, -6px, 0); }
  100% { opacity: 0; transform: translate3d(0, -30px, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .tkm-impact-float {
    animation: tkm-impact-float-reduced 180ms ease-out forwards !important;
  }
}
`;
		/** 单条扣费文字；定位由鲸鱼娘头顶的独立反馈层负责。 */
		const FLOAT = {
			position: "absolute",
			left: "50%",
			bottom: 0,
			fontFamily: "Inter, \"Segoe UI\", \"Microsoft YaHei\", sans-serif",
			fontSize: 18,
			fontWeight: 700,
			lineHeight: 1,
			fontVariantNumeric: "tabular-nums",
			pointerEvents: "none",
			zIndex: 1001,
			animation: "tkm-impact-float 1250ms cubic-bezier(.2,.72,.3,1) forwards",
			transformOrigin: "50% 100%",
			translate: "-50% 0",
			whiteSpace: "nowrap",
			willChange: "transform, opacity",
			textShadow: "0 1px 3px rgba(0,0,0,0.5)"
		};
		/** 悬浮窗位置持久化 key。 */
		const POS_KEY = "dsh-token-monitor-balance-pos";
		const WHALE_VISIBLE_KEY = "dsh-token-monitor-show-whale-girl";
		/** 从 localStorage 恢复上次位置；缺失或非法则用右下角默认值。 */
		function loadPos() {
			try {
				const raw = localStorage.getItem(POS_KEY);
				if (raw !== null) {
					const parsed = JSON.parse(raw);
					if (typeof parsed.left === "number" && typeof parsed.top === "number") return {
						left: parsed.left,
						top: parsed.top
					};
				}
			} catch {}
			return {
				left: Math.max(0, window.innerWidth - 220),
				top: Math.max(0, window.innerHeight - 72)
			};
		}
		/** 持久化悬浮窗位置。 */
		function savePos(pos) {
			try {
				localStorage.setItem(POS_KEY, JSON.stringify(pos));
			} catch {}
		}
		/** 恢复鲸鱼娘显示偏好；首次使用默认显示。 */
		function loadWhaleVisible() {
			try {
				const raw = localStorage.getItem(WHALE_VISIBLE_KEY);
				if (raw === null) return true;
				const parsed = JSON.parse(raw);
				return typeof parsed === "boolean" ? parsed : true;
			} catch {
				return true;
			}
		}
		/** 限制数值在 [min, max] 区间。 */
		function clamp(value, min, max) {
			return Math.min(Math.max(value, min), max);
		}
		/** 紧凑金额格式：小金额保留 4 位，大金额保留 2 位。 */
		function fmtCost(cost) {
			return cost < .01 ? cost.toFixed(4) : cost.toFixed(2);
		}
		function notificationText(item) {
			const event = item.event;
			if (event.kind === "budget-threshold") return `今日花费 ¥${fmtCost(event.payload.currentSpend)}，已达到预算阈值`;
			if (event.kind === "peak-enter") return "进入峰时段，当前价格较高";
			if (event.kind === "peak-exit") return "进入谷时段，当前价格较低";
			if (event.kind === "cache-hit-anomaly") return `缓存命中率偏低：最近 ${String(event.payload.sampleCount)} 次约 ${(event.payload.observedRate * 100).toFixed(1)}%，低于 ${(event.payload.threshold * 100).toFixed(0)}% 阈值`;
			return "Token 消耗提醒";
		}
		/** 当前时刻是否落在高峰时段。 */
		function isPeakNow() {
			return isPeakPeriod(Date.now());
		}
		const CHARGE_POLL_MS = 1e3;
		const BALANCE_POLL_MS = 6e4;
		const FLOAT_MS = 1250;
		const FLOAT_EMIT_INTERVAL_MS = 450;
		const FLASH_MS = 620;
		const WHALE_POSE_MS = 1250;
		const DRAG_THRESHOLD_PX = 4;
		function BalanceWidget({ previewOverride, loadRouteEligibility, useSessions }) {
			const routeEligible = useRouteEligibility(useSessions, loadRouteEligibility, previewOverride !== void 0);
			const shouldPoll = routeEligible !== false || previewOverride !== void 0;
			const [balanceInfo, setBalanceInfo] = (0, react.useState)(void 0);
			const [display, setDisplay] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(false);
			const [flash, setFlash] = (0, react.useState)(null);
			const [anims, setAnims] = (0, react.useState)([]);
			const [whalePose, setWhalePose] = (0, react.useState)("idle");
			const [whaleImpactPulse, setWhaleImpactPulse] = (0, react.useState)(0);
			const [reviving, setReviving] = (0, react.useState)(false);
			const [showWhaleGirl, setShowWhaleGirl] = (0, react.useState)(loadWhaleVisible);
			const [settingsSnapshot, setSettingsSnapshot] = (0, react.useState)();
			const [settingsOpen, setSettingsOpen] = (0, react.useState)(false);
			const [settingsError, setSettingsError] = (0, react.useState)();
			const [notificationBubble, setNotificationBubble] = (0, react.useState)();
			const [contextMenu, setContextMenu] = (0, react.useState)(null);
			const [pos, setPos] = (0, react.useState)(() => previewOverride?.fixedPosition ?? loadPos());
			const [dragging, setDragging] = (0, react.useState)(false);
			const [isPeak, setIsPeak] = (0, react.useState)(() => previewOverride?.forcedPeak ?? isPeakNow());
			const chargeSeq = (0, react.useRef)(0);
			const chargeStreamId = (0, react.useRef)();
			const chargeSeeded = (0, react.useRef)(false);
			const animId = (0, react.useRef)(0);
			const flashTimer = (0, react.useRef)(void 0);
			const animTimers = (0, react.useRef)(/* @__PURE__ */ new Set());
			const animQueue = (0, react.useRef)([]);
			const queuedDebit = (0, react.useRef)(0);
			const queueTimer = (0, react.useRef)(void 0);
			const whalePoseTimer = (0, react.useRef)(void 0);
			const lastCriticalAt = (0, react.useRef)(0);
			const activeWhaleSeverity = (0, react.useRef)(0);
			const lastBalanceSnapshot = (0, react.useRef)(null);
			const revivingRef = (0, react.useRef)(false);
			const showWhaleGirlRef = (0, react.useRef)(showWhaleGirl);
			const balanceValueRef = (0, react.useRef)(null);
			const cardRef = (0, react.useRef)(null);
			const dragStart = (0, react.useRef)(null);
			const contextMenuRef = (0, react.useRef)(null);
			const settingsRef = (0, react.useRef)(settingsSnapshot);
			const notificationQueueRef = (0, react.useRef)(createNotificationQueueState());
			const notificationSeeded = (0, react.useRef)(false);
			const notificationBubbleTimer = (0, react.useRef)(void 0);
			/** 右键打开余额显示设置菜单，并限制菜单不超出视口。 */
			const onContextMenu = (0, react.useCallback)((event) => {
				event.preventDefault();
				dragStart.current = null;
				setDragging(false);
				setContextMenu({
					left: clamp(event.clientX, 4, Math.max(4, window.innerWidth - 176 - 4)),
					top: clamp(event.clientY, 4, Math.max(4, window.innerHeight - 160 - 4))
				});
			}, []);
			/** 支持 Context Menu 键和 Shift+F10 打开设置。 */
			const onKeyDown = (0, react.useCallback)((event) => {
				if (event.key === "Escape") {
					setContextMenu(null);
					return;
				}
				if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
					event.preventDefault();
					const rect = event.currentTarget.getBoundingClientRect();
					setContextMenu({
						left: clamp(rect.left, 4, Math.max(4, window.innerWidth - 180)),
						top: clamp(rect.bottom + 4, 4, Math.max(4, window.innerHeight - 164))
					});
				}
			}, []);
			const toggleWhaleGirl = (0, react.useCallback)(() => {
				setShowWhaleGirl((visible) => {
					const next = !visible;
					try {
						localStorage.setItem(WHALE_VISIBLE_KEY, JSON.stringify(next));
					} catch {}
					return next;
				});
				setContextMenu(null);
			}, []);
			(0, react.useEffect)(() => {
				if (contextMenu === null) return;
				const close = (event) => {
					if (contextMenuRef.current?.contains(event.target)) return;
					setContextMenu(null);
				};
				const onBlur = () => setContextMenu(null);
				document.addEventListener("pointerdown", close);
				window.addEventListener("blur", onBlur);
				return () => {
					document.removeEventListener("pointerdown", close);
					window.removeEventListener("blur", onBlur);
				};
			}, [contextMenu]);
			(0, react.useEffect)(() => {
				if (contextMenu === null) return;
				const frame = window.requestAnimationFrame(() => {
					const rect = contextMenuRef.current?.getBoundingClientRect();
					if (rect === void 0) return;
					setContextMenu((current) => current === null ? null : {
						left: clamp(current.left, 4, Math.max(4, window.innerWidth - rect.width - 4)),
						top: clamp(current.top, 4, Math.max(4, window.innerHeight - rect.height - 4))
					});
				});
				return () => window.cancelAnimationFrame(frame);
			}, [contextMenu]);
			(0, react.useEffect)(() => {
				showWhaleGirlRef.current = showWhaleGirl;
				if (showWhaleGirl) {
					setWhalePose("idle");
					return;
				}
				if (whalePoseTimer.current !== void 0) clearTimeout(whalePoseTimer.current);
				whalePoseTimer.current = void 0;
				setWhalePose("idle");
				revivingRef.current = false;
				setReviving(false);
			}, [showWhaleGirl]);
			(0, react.useEffect)(() => {
				settingsRef.current = settingsSnapshot;
			}, [settingsSnapshot]);
			const applySettingsSnapshot = (0, react.useCallback)((snapshot) => {
				setSettingsSnapshot(snapshot);
				setShowWhaleGirl(snapshot.settings.showWhaleGirl);
				try {
					localStorage.setItem(WHALE_VISIBLE_KEY, JSON.stringify(snapshot.settings.showWhaleGirl));
				} catch {}
			}, []);
			const openSettings = (0, react.useCallback)(async () => {
				setContextMenu(null);
				setSettingsOpen(true);
				setSettingsError(void 0);
				try {
					applySettingsSnapshot(await settingsApi.get());
				} catch (error) {
					setSettingsError(error instanceof Error ? error.message : "设置读取失败，请稍后重试。");
				}
			}, [applySettingsSnapshot]);
			const saveSettings = (0, react.useCallback)(async (request) => {
				try {
					const snapshot = await settingsApi.patch(request);
					applySettingsSnapshot(snapshot);
					setSettingsError(void 0);
					return snapshot;
				} catch (error) {
					if (error instanceof TokenMonitorSettingsApiError && error.code === "CONFLICT") try {
						applySettingsSnapshot(await settingsApi.get());
						setSettingsError("设置版本已更新，已重新读取最新值，请确认后再次保存。");
					} catch {
						setSettingsError("设置版本已过期，且最新值读取失败。");
					}
					throw error;
				}
			}, [applySettingsSnapshot]);
			/** 卡片完整约束在视口内；窗口缩放后也会修正并保存位置。 */
			const constrainPos = (0, react.useCallback)((next) => {
				const rect = cardRef.current?.getBoundingClientRect();
				const width = rect?.width ?? 180;
				const height = rect?.height ?? 34;
				return {
					left: clamp(next.left, 0, Math.max(0, window.innerWidth - width)),
					top: clamp(next.top, 0, Math.max(0, window.innerHeight - height))
				};
			}, []);
			(0, react.useEffect)(() => {
				const onResize = () => setPos((current) => {
					const next = constrainPos(current);
					savePos(next);
					return next;
				});
				window.addEventListener("resize", onResize);
				onResize();
				return () => window.removeEventListener("resize", onResize);
			}, [constrainPos]);
			/** 拖拽开始：记录起点，捕获指针。 */
			const onPointerDown = (0, react.useCallback)((event) => {
				if (previewOverride !== void 0) return;
				if (event.button !== 0) return;
				if (event.target.closest("[role=menu]") !== null) return;
				dragStart.current = {
					x: event.clientX,
					y: event.clientY,
					left: pos.left,
					top: pos.top,
					pointerId: event.pointerId,
					moved: false
				};
				event.currentTarget.setPointerCapture(event.pointerId);
			}, [pos, previewOverride]);
			/** 拖拽移动：按位移更新位置，并限制在视口内。 */
			const onPointerMove = (0, react.useCallback)((event) => {
				const start = dragStart.current;
				if (start === null) return;
				const dx = event.clientX - start.x;
				const dy = event.clientY - start.y;
				if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
				if (!start.moved) {
					start.moved = true;
					setDragging(true);
					setContextMenu(null);
				}
				setPos(constrainPos({
					left: start.left + dx,
					top: start.top + dy
				}));
			}, [constrainPos]);
			/** 拖拽结束：持久化位置。 */
			const onPointerUp = (0, react.useCallback)((event) => {
				if (dragStart.current === null) return;
				dragStart.current = null;
				setDragging(false);
				if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
				setPos((current) => {
					savePos(current);
					return current;
				});
			}, []);
			/** 余额节点保留同一 DOM；连续扣费从当前视觉状态接续，不再靠 key 强制重播。 */
			const pulseBalance = (0, react.useCallback)((kind) => {
				const node = balanceValueRef.current;
				if (node === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
				for (const animation of node.getAnimations()) {
					try {
						animation.commitStyles();
					} catch {}
					animation.cancel();
				}
				const strong = kind === "miss";
				node.animate([
					{ transform: getComputedStyle(node).transform === "none" ? "translate3d(0,0,0) scale(1)" : getComputedStyle(node).transform },
					{
						transform: strong ? "translate3d(-2px,3px,0) scale(.955)" : "translate3d(0,2px,0) scale(.978)",
						offset: .22
					},
					{
						transform: strong ? "translate3d(2px,-1px,0) scale(1.025)" : "translate3d(0,-1px,0) scale(1.012)",
						offset: .55
					},
					{ transform: "translate3d(0,0,0) scale(1)" }
				], {
					duration: strong ? 620 : 440,
					easing: "cubic-bezier(.2,.86,.25,1)",
					fill: "forwards"
				});
			}, []);
			/** 将一条反馈真正发射到共同轨道。 */
			const emit = (0, react.useCallback)((pending) => {
				const { eventId, seq, text, color, kind, label, debit, suppressWhaleReaction = false } = pending;
				const id = ++animId.current;
				const next = {
					eventId,
					text,
					color,
					damageKind: kind,
					...seq === void 0 ? {} : { seq },
					...label === void 0 ? {} : { label }
				};
				setAnims((list) => [...list, {
					id,
					...next
				}].slice(-64));
				if (debit !== void 0 && debit > 0) {
					queuedDebit.current = Math.max(0, queuedDebit.current - debit);
					setDisplay((previous) => applyDebitToDisplay(previous, debit));
				}
				if (color === "red" && revivingRef.current) {
					revivingRef.current = false;
					setReviving(false);
				}
				if (showWhaleGirlRef.current && !suppressWhaleReaction) {
					const now = Date.now();
					const severity = color === "green" ? 0 : kind === "output" ? 1 : kind === "normal" ? 2 : 3;
					activeWhaleSeverity.current = Math.max(activeWhaleSeverity.current, severity);
					const pose = color === "green" ? "heal-happy" : activeWhaleSeverity.current === 1 ? "weak-pain" : activeWhaleSeverity.current === 2 ? "normal-pain" : now - lastCriticalAt.current < 900 ? "critical-combo" : "critical-pain";
					if (kind === "miss") lastCriticalAt.current = now;
					setWhalePose(pose);
					setWhaleImpactPulse((pulse) => pulse + 1);
					if (whalePoseTimer.current !== void 0) clearTimeout(whalePoseTimer.current);
					whalePoseTimer.current = setTimeout(() => {
						whalePoseTimer.current = void 0;
						activeWhaleSeverity.current = 0;
						setWhalePose("idle");
					}, WHALE_POSE_MS);
				}
				setFlash(color);
				pulseBalance(kind);
				if (flashTimer.current !== void 0) clearTimeout(flashTimer.current);
				flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
				const timer = setTimeout(() => {
					animTimers.current.delete(timer);
					setAnims((list) => list.filter((anim) => anim.id !== id));
				}, FLOAT_MS);
				animTimers.current.add(timer);
			}, [pulseBalance]);
			/** FIFO 发射器：首条立即出现，后续按指定 GIF 的约 450ms 节奏发射。 */
			const drainQueue = (0, react.useCallback)(function drain() {
				const next = animQueue.current.shift();
				if (next === void 0) {
					queueTimer.current = void 0;
					return;
				}
				emit(next);
				queueTimer.current = setTimeout(drain, FLOAT_EMIT_INTERVAL_MS);
			}, [emit]);
			/** 将反馈加入共同轨道队列，连续触发时保持可辨识的部分覆盖。 */
			const trigger = (0, react.useCallback)((eventId, text, color, kind = "normal", label, seq, debit, suppressWhaleReaction = false) => {
				if (debit !== void 0 && debit > 0) queuedDebit.current += debit;
				animQueue.current.push({
					eventId,
					text,
					color,
					kind,
					...seq === void 0 ? {} : { seq },
					...label === void 0 ? {} : { label },
					...debit === void 0 ? {} : { debit },
					...suppressWhaleReaction ? { suppressWhaleReaction } : {}
				});
				if (queueTimer.current === void 0 && animQueue.current.length === 1) drainQueue();
			}, [drainQueue]);
			(0, react.useEffect)(() => () => {
				if (flashTimer.current !== void 0) clearTimeout(flashTimer.current);
				if (queueTimer.current !== void 0) clearTimeout(queueTimer.current);
				animTimers.current.forEach((timer) => clearTimeout(timer));
				animTimers.current.clear();
				animQueue.current = [];
				queuedDebit.current = 0;
				if (whalePoseTimer.current !== void 0) clearTimeout(whalePoseTimer.current);
			}, []);
			const cancelDrag = (0, react.useCallback)(() => {
				if (dragStart.current === null) return;
				dragStart.current = null;
				setDragging(false);
				setPos((current) => {
					const next = constrainPos(current);
					savePos(next);
					return next;
				});
			}, [constrainPos]);
			(0, react.useEffect)(() => {
				if (!dragging) return;
				const finish = () => cancelDrag();
				window.addEventListener("pointerup", finish);
				window.addEventListener("pointercancel", finish);
				window.addEventListener("blur", finish);
				return () => {
					window.removeEventListener("pointerup", finish);
					window.removeEventListener("pointercancel", finish);
					window.removeEventListener("blur", finish);
				};
			}, [cancelDrag, dragging]);
			(0, react.useEffect)(() => {
				if (previewOverride !== void 0) {
					setIsPeak(previewOverride.forcedPeak);
					setPos(previewOverride.fixedPosition);
					return;
				}
				const update = () => setIsPeak(isPeakNow());
				const timer = setInterval(update, 3e4);
				return () => clearInterval(timer);
			}, [previewOverride]);
			(0, react.useEffect)(() => {
				if (!shouldPoll) return;
				let cancelled = false;
				const poll = async () => {
					try {
						const res = await fetch(`/api/token-monitor/charge-events?since=${chargeSeq.current}`, { cache: "no-store" });
						if (!res.ok) return;
						const data = await res.json();
						const streamChanged = chargeStreamId.current !== void 0 && data.streamId !== chargeStreamId.current;
						const seqRegressed = Number.isSafeInteger(data.seq) && data.seq < chargeSeq.current;
						const gapDetected = data.dropped === true || Number.isSafeInteger(data.firstSeq) && chargeSeq.current < data.firstSeq - 1;
						if (!chargeSeeded.current) {
							chargeSeeded.current = true;
							chargeStreamId.current = data.streamId;
							chargeSeq.current = data.seq;
							return;
						}
						if (streamChanged || seqRegressed || gapDetected) {
							chargeStreamId.current = data.streamId;
							chargeSeq.current = data.seq;
							try {
								const balanceRes = await fetch("/api/token-monitor/balance", { cache: "no-store" });
								if (balanceRes.ok) {
									const balance = await balanceRes.json();
									if (!cancelled && balance !== null) {
										setBalanceInfo(balance);
										lastBalanceSnapshot.current = balance.totalBalance;
										setDisplay(balance.totalBalance + queuedDebit.current);
									}
								}
							} catch {}
							return;
						}
						const events = [...data.events ?? []].filter((event) => Number.isFinite(event.seq) && event.seq > chargeSeq.current).sort((left, right) => left.seq - right.seq);
						if (events.length === 0) return;
						if (cancelled) return;
						for (const event of events) {
							const eventId = event.id ?? `charge-${event.seq}`;
							const topKind = event.kind;
							const parts = [];
							if (topKind !== void 0) parts.push({
								suffix: topKind,
								cost: event.cost,
								kind: topKind === "miss" ? "miss" : topKind === "output" ? "output" : "normal",
								label: topKind === "miss" ? "未命中" : topKind === "output" ? "输出" : "命中"
							});
							else {
								const hit = Number(event.breakdown?.cacheHit?.cost ?? 0);
								const output = Number(event.breakdown?.output?.cost ?? 0);
								const miss = Number(event.breakdown?.cacheMiss?.cost ?? 0);
								if ([
									hit,
									output,
									miss
								].every((cost) => Number.isFinite(cost) && cost >= 0) && hit + output + miss > 0) {
									if (hit > 0) parts.push({
										suffix: "hit",
										cost: hit,
										kind: "normal",
										label: "命中"
									});
									if (output > 0) parts.push({
										suffix: "output",
										cost: output,
										kind: "output",
										label: "输出"
									});
									if (miss > 0) parts.push({
										suffix: "miss",
										cost: miss,
										kind: "miss",
										label: "未命中"
									});
								} else {
									const fallbackKind = event.damageKind === "miss" ? "miss" : "normal";
									parts.push({
										suffix: "legacy",
										cost: event.cost,
										kind: fallbackKind,
										label: fallbackKind === "miss" ? "未命中" : "命中"
									});
								}
							}
							for (const part of parts) {
								if (!Number.isFinite(part.cost) || part.cost <= 0) continue;
								trigger(`${eventId}-${part.suffix}`, `-${fmtCost(part.cost)}¥`, "red", part.kind, part.label, event.seq, part.cost);
							}
							chargeSeq.current = Math.max(chargeSeq.current, event.seq);
						}
					} catch {}
				};
				poll();
				const timer = setInterval(() => void poll(), CHARGE_POLL_MS);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [shouldPoll, trigger]);
			(0, react.useEffect)(() => {
				if (!shouldPoll) return;
				let cancelled = false;
				const poll = async () => {
					try {
						const res = await fetch("/api/token-monitor/balance", { cache: "no-store" });
						if (!res.ok) {
							if (!cancelled) setError(true);
							return;
						}
						const data = await res.json();
						if (cancelled) return;
						setBalanceInfo(data);
						setError(false);
						if (data !== null) {
							const previousSnapshot = lastBalanceSnapshot.current;
							const grew = previousSnapshot !== null && data.totalBalance > previousSnapshot + 1e-9;
							const crossedFromDepleted = previousSnapshot !== null && previousSnapshot <= 0 && data.totalBalance > 0;
							if (grew) trigger(`heal-${Date.now()}`, `+${fmtCost(data.totalBalance - previousSnapshot)}¥`, "green", "normal", void 0, void 0, void 0, crossedFromDepleted);
							lastBalanceSnapshot.current = data.totalBalance;
							setDisplay(data.totalBalance + queuedDebit.current);
							if (crossedFromDepleted && showWhaleGirlRef.current) {
								if (whalePoseTimer.current !== void 0) clearTimeout(whalePoseTimer.current);
								whalePoseTimer.current = void 0;
								activeWhaleSeverity.current = 0;
								revivingRef.current = true;
								setReviving(true);
								setWhalePose("revive-recharge");
							} else if (data.totalBalance <= 0) {
								if (whalePoseTimer.current !== void 0) clearTimeout(whalePoseTimer.current);
								whalePoseTimer.current = void 0;
								revivingRef.current = false;
								setReviving(false);
								setWhalePose("idle");
							}
						}
					} catch {
						if (!cancelled) setError(true);
					}
				};
				poll();
				const timer = setInterval(() => void poll(), BALANCE_POLL_MS);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [shouldPoll, trigger]);
			(0, react.useEffect)(() => {
				if (!shouldPoll) return;
				const controller = new AbortController();
				const refresh = async () => {
					try {
						const snapshot = await settingsApi.get(controller.signal);
						if (!controller.signal.aborted) applySettingsSnapshot(snapshot);
					} catch {}
				};
				const onFocus = () => void refresh();
				refresh();
				window.addEventListener("focus", onFocus);
				return () => {
					controller.abort();
					window.removeEventListener("focus", onFocus);
				};
			}, [applySettingsSnapshot, shouldPoll]);
			const consumeNotification = (0, react.useCallback)(() => {
				const result = dequeueNotificationItem(notificationQueueRef.current, Date.now());
				notificationQueueRef.current = result.state;
				if (!("item" in result)) return;
				if (settingsRef.current?.settings.whaleBubbleEnabled === false) return;
				setNotificationBubble(notificationText(result.item));
				if (notificationBubbleTimer.current !== void 0) clearTimeout(notificationBubbleTimer.current);
				notificationBubbleTimer.current = setTimeout(() => {
					notificationBubbleTimer.current = void 0;
					setNotificationBubble(void 0);
				}, 4e3);
			}, []);
			(0, react.useEffect)(() => {
				if (!shouldPoll) return;
				const timer = setInterval(consumeNotification, 250);
				return () => clearInterval(timer);
			}, [consumeNotification, shouldPoll]);
			(0, react.useEffect)(() => {
				if (!shouldPoll) return;
				let cancelled = false;
				const poll = async () => {
					const result = await notificationEventsApi.poll(notificationQueueRef.current.cursor);
					if (cancelled || !result.ok) return;
					if (!notificationSeeded.current) {
						notificationSeeded.current = true;
						notificationQueueRef.current = {
							...notificationQueueRef.current,
							cursor: {
								streamId: result.batch.streamId,
								seq: result.batch.seq
							}
						};
						return;
					}
					const update = applyNotificationPollResult(notificationQueueRef.current, result, Date.now());
					notificationQueueRef.current = update.state;
					consumeNotification();
				};
				poll();
				const timer = setInterval(() => void poll(), 1e3);
				return () => {
					cancelled = true;
					clearInterval(timer);
					if (notificationBubbleTimer.current !== void 0) clearTimeout(notificationBubbleTimer.current);
				};
			}, [consumeNotification, shouldPoll]);
			if (previewOverride === void 0 && routeEligible === false) return null;
			if (balanceInfo === void 0 && !error) return null;
			const amountColor = flash === "red" ? RED : flash === "green" ? GREEN : "var(--dsh-color-accent, #4c8dff)";
			const balanceAvailable = balanceInfo !== void 0 && balanceInfo !== null && !error;
			const shownBalance = display ?? balanceInfo?.totalBalance ?? 0;
			const depleted = balanceAvailable && shownBalance <= 0;
			const onWhalePoseComplete = (completedPose) => {
				if (completedPose !== "revive-recharge" || !revivingRef.current) return;
				revivingRef.current = false;
				setReviving(false);
				setWhalePose("idle");
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: cardRef,
				style: {
					...CARD,
					left: pos.left,
					top: pos.top,
					cursor: previewOverride === void 0 ? dragging ? "grabbing" : "grab" : "default"
				},
				"data-token-monitor-balance": "",
				"data-showcase-instance": previewOverride?.instanceId,
				"data-showcase-peak": isPeak ? "peak" : "valley",
				title: "DeepSeek 账户余额（扣费实时、余额 60s 校准；可拖动）",
				tabIndex: 0,
				onContextMenu,
				onKeyDown,
				onPointerDown,
				onPointerMove,
				onPointerUp,
				onPointerCancel: cancelDrag,
				onLostPointerCapture: cancelDrag,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: KEYFRAMES }),
					contextMenu !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: contextMenuRef,
						role: "menu",
						"aria-label": "余额显示设置",
						onPointerDown: (event) => event.stopPropagation(),
						onKeyDown: (event) => {
							if (event.key === "Escape") {
								event.stopPropagation();
								setContextMenu(null);
							}
						},
						style: {
							position: "fixed",
							left: contextMenu.left,
							top: contextMenu.top,
							minWidth: 176,
							padding: 6,
							borderRadius: 6,
							background: "var(--dsh-color-surface-overlay, rgba(28, 28, 28, 0.96))",
							color: "var(--dsh-color-text, #e8e8e8)",
							boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
							border: "1px solid rgba(255,255,255,0.12)",
							zIndex: 1100
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									padding: "2px 8px 5px",
									fontSize: 11,
									opacity: .65
								},
								children: "余额显示设置"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								role: "menuitemcheckbox",
								"aria-checked": showWhaleGirl,
								onClick: toggleWhaleGirl,
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8,
									width: "100%",
									padding: "6px 8px",
									border: 0,
									borderRadius: 4,
									background: "transparent",
									color: "inherit",
									textAlign: "left",
									cursor: "pointer",
									font: "inherit"
								},
								onMouseEnter: (event) => {
									event.currentTarget.style.background = "rgba(255,255,255,0.10)";
								},
								onMouseLeave: (event) => {
									event.currentTarget.style.background = "transparent";
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									style: {
										width: 14,
										textAlign: "center",
										color: "#79b8ff"
									},
									children: showWhaleGirl ? "✓" : ""
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "显示鲸鱼娘" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								role: "menuitem",
								onClick: () => {
									openSettings();
								},
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8,
									width: "100%",
									padding: "6px 8px",
									border: 0,
									borderRadius: 4,
									background: "transparent",
									color: "inherit",
									textAlign: "left",
									cursor: "pointer",
									font: "inherit"
								},
								onMouseEnter: (event) => {
									event.currentTarget.style.background = "rgba(255,255,255,0.10)";
								},
								onMouseLeave: (event) => {
									event.currentTarget.style.background = "transparent";
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									style: {
										width: 14,
										textAlign: "center",
										color: "#79b8ff"
									},
									children: "⚙"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "详细设置" })]
							})
						]
					}),
					settingsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						role: "dialog",
						"aria-label": "Token Monitor 详细设置",
						style: {
							position: "fixed",
							inset: 0,
							zIndex: 1200,
							display: "grid",
							placeItems: "center",
							padding: 16,
							background: "rgba(25, 20, 34, 0.24)"
						},
						onPointerDown: (event) => {
							if (event.target === event.currentTarget) setSettingsOpen(false);
						},
						children: settingsError !== void 0 && settingsSnapshot === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							role: "alert",
							style: {
								maxWidth: 420,
								padding: 20,
								borderRadius: 14,
								background: "var(--dsh-color-surface, #fff)",
								color: "var(--dsh-color-text, #292534)"
							},
							children: [settingsError, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => setSettingsOpen(false),
								style: {
									display: "block",
									marginTop: 12
								},
								children: "关闭"
							})]
						}) : settingsSnapshot !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TokenMonitorSettingsPanel, {
							snapshot: settingsSnapshot,
							onSave: saveSettings,
							onClose: () => setSettingsOpen(false),
							wechatApi: wechatConnectionApi
						})
					}),
					showWhaleGirl && balanceAvailable && depleted && !reviving && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"aria-hidden": "true",
						"data-token-monitor-whale-depleted": "",
						style: {
							position: "absolute",
							left: "10%",
							bottom: "calc(100% - 8px)",
							width: "80%",
							aspectRatio: "1351 / 691",
							zIndex: 2,
							pointerEvents: "none",
							overflow: "visible"
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							src: DEATH_ASSET,
							alt: "",
							style: {
								position: "absolute",
								inset: 0,
								width: "100%",
								height: "100%",
								objectFit: "contain",
								objectPosition: "bottom center",
								display: "block"
							}
						})
					}),
					showWhaleGirl && balanceAvailable && (reviving || !depleted) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"aria-hidden": "true",
						style: {
							position: "absolute",
							left: "10%",
							bottom: "calc(100% - 8px)",
							width: "80%",
							aspectRatio: "1 / 1",
							zIndex: 2,
							pointerEvents: "none",
							overflow: "visible"
						},
						"data-token-monitor-whale-layer": "",
						"data-token-monitor-whale-pose": whalePose,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WhaleGirlStage, {
							pose: whalePose,
							impactPulse: whaleImpactPulse,
							onPoseComplete: onWhalePoseComplete,
							...previewOverride?.syncEpoch === void 0 ? {} : { syncEpoch: previewOverride.syncEpoch }
						})
					}),
					anims.length > 0 && balanceAvailable && !depleted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"aria-hidden": "true",
						"data-token-monitor-damage-layer": "head-front",
						style: {
							position: "absolute",
							left: "50%",
							bottom: showWhaleGirl ? "calc(100% + 42px)" : "calc(100% + 8px)",
							width: 0,
							height: 0,
							zIndex: 12,
							pointerEvents: "none",
							overflow: "visible"
						},
						children: anims.map((anim) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "tkm-impact-float",
							"data-charge-event-id": anim.eventId,
							"data-charge-seq": anim.seq,
							"data-charge-kind": anim.damageKind,
							style: {
								...FLOAT,
								color: anim.color,
								display: "flex",
								alignItems: "baseline",
								justifyContent: "center",
								gap: anim.damageKind === "miss" ? 5 : 4,
								fontSize: anim.damageKind === "miss" ? 23 : FLOAT.fontSize,
								fontWeight: 800,
								animation: FLOAT.animation,
								textShadow: anim.damageKind === "miss" ? "0 1px 3px rgba(0,0,0,0.76), 0 0 7px rgba(255,59,48,0.42)" : FLOAT.textShadow
							},
							children: [anim.label !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									color: RED,
									fontSize: 11,
									fontWeight: 800
								},
								children: anim.label
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: anim.text })]
						}, anim.id))
					}),
					notificationBubble !== void 0 && showWhaleGirl && balanceAvailable && !depleted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						role: "status",
						"aria-live": "polite",
						"data-token-monitor-notification-bubble": "",
						style: {
							position: "absolute",
							right: 0,
							top: "calc(100% + 8px)",
							maxWidth: 260,
							transform: "none",
							zIndex: 5,
							pointerEvents: "none",
							padding: "7px 11px",
							borderRadius: 12,
							background: "rgba(255,255,255,0.96)",
							color: "#3b3150",
							border: "1px solid rgba(128, 101, 215, 0.24)",
							boxShadow: "0 7px 20px rgba(42, 27, 69, 0.18)",
							fontSize: 12,
							lineHeight: 1.35,
							textAlign: "center",
							whiteSpace: "normal"
						},
						children: notificationBubble
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							position: "relative",
							zIndex: 4
						},
						"data-token-monitor-display": "",
						children: [
							"余额",
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									position: "relative",
									display: "inline-block"
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									ref: balanceValueRef,
									style: {
										fontWeight: 700,
										fontVariantNumeric: "tabular-nums",
										display: "inline-block",
										color: amountColor,
										transition: "color 0.25s ease",
										transform: "translate3d(0,0,0) scale(1)",
										willChange: "transform"
									},
									children: balanceAvailable ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										balanceInfo.currency,
										" ",
										shownBalance.toFixed(2)
									] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: "未配置 API Key 或查询失败" })
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontWeight: 700,
									marginLeft: 6,
									color: isPeak ? RED : GREEN,
									textShadow: isPeak ? "0 0 6px rgba(255,59,48,0.9), 0 0 14px rgba(255,59,48,0.55)" : "0 0 6px rgba(48,164,108,0.9), 0 0 14px rgba(48,164,108,0.55)",
									transition: "color 0.3s ease, text-shadow 0.3s ease"
								},
								children: isPeak ? "峰" : "谷"
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/sessionCost.ts
		/** 宿主正式席位键：ui-workspace 声明的 sidebar.workspaces.sessionRow.trailing。 */
		const SESSION_ROW_TRAILING_SLOT = "sidebar.workspaces.sessionRow.trailing";
		/** 会话行金额节点的统一 data 标记。 */
		const SESSION_COST_MARKER = "data-dsh-token-monitor-session-cost";
		/** 新增会话行金额节点的统一中文提示。 */
		const SESSION_COST_TITLE = "会话消费金额";
		/** 旧补丁脚本（rc.5/rc.7 apply-sidebar-integration.ps1）写入的历史英文提示，仅用于识别既有节点。 */
		const SESSION_COST_LEGACY_TITLE = "Session cost";
		/**
		* 从会话投影值读取可展示金额：缺失、非有限或非正数一律不展示。
		*/
		function readSessionCost(projection) {
			const cost = projection?.tokenCost?.cost;
			return typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : void 0;
		}
		/**
		* 金额格式：小金额保留四位（如 ¥0.0080），普通金额两位（如 ¥38.60）。
		*/
		function formatSessionCost(cost) {
			return `¥${cost < .01 ? cost.toFixed(4) : cost.toFixed(2)}`;
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/SessionCostBadge.tsx
		const BADGE = {
			flex: "none",
			marginRight: 12,
			fontSize: 12,
			lineHeight: "20px",
			color: "#4176e6",
			fontVariantNumeric: "tabular-nums"
		};
		/**
		* 会话行金额徽标：仅在会话存在且投影金额为正有限值时渲染。
		* @param props - 席位 owner 与全局钩子。
		* @returns 金额节点，或 null。
		*/
		function SessionCostBadge({ sessionId, useSessions }) {
			const cost = useSessions((state) => readSessionCost(state.byId[sessionId]?.projectionValues));
			if (cost === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: BADGE,
				[SESSION_COST_MARKER]: "",
				title: SESSION_COST_TITLE,
				children: formatSessionCost(cost)
			});
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/LegacySessionCostBridge.tsx
		/**
		* 旧宿主会话行金额兼容桥（无视觉，挂在 shell.overlay 列表末尾）。
		*
		* 目标宿主：rc.5/rc.7 等旧版 ui-workspace —— 没有 sidebar.workspaces.sessionRow.trailing
		* 席位、没有 data-session-id、没有 data-session-row-trailing-slot marker；会话行是
		*   <div role="treeitem" aria-selected=… draggable=…>
		*     <span>状态点</span> <span>标题</span> <span>相对时间</span> <span>行操作</span>
		* 本桥只在这种旧结构上，按「唯一 displayTitle」把金额节点插到标题后、时间前
		* （与旧版 apply-sidebar-integration.ps1 的落点一致）。
		*
		* 整体停用（fail-closed，出现任一条件即停止并清理）：
		* - 文档中出现 data-session-row-trailing-slot（正式席位）或带 data-session-id 的
		*   treeitem 行 → 新宿主，由正式席位渲染，本桥全部移除。
		* - 行内出现非本桥的会话金额节点（title=Session cost / 会话消费金额，或带
		*   data-dsh-token-monitor-session-cost 但无本桥标记）→ 已有原生/旧补丁能力，
		*   防双写，整体停用。
		*
		* 单行跳过（fail-closed，结构不可信即不注入）：
		* - 行不是 div treeitem 或没有 aria-selected（排除项目行/搜索行）；
		* - 标题不是行的直接子元素 span，或同一行出现多个标题匹配；
		* - 标题在会话索引中重名（不唯一）；
		* - 标题后没有可作为时间锚点的兄弟 span（空白会话行或不可信结构）。
		*
		* 幂等与清理：MutationObserver 只对缺本桥标记的行补注入；文本更新只改 textContent；
		* 卸载或停用时移除 observer、样式与全部注入节点。
		*/
		/** 本桥注入节点的专属标记（用于幂等与清理，绝不能与正式席位 marker 混用）。 */
		const BRIDGE_MARKER = "data-dsh-token-monitor-legacy-session-cost";
		/** 注入节点上携带的稳定会话 id（仅存在于本桥节点，行元素本身不加 data-session-id）。 */
		const SESSION_ID_ATTR = "data-dsh-token-monitor-session-id";
		const STYLE_ID = "dsh-token-monitor-legacy-session-cost-style";
		/** 旧行判定：仅 div treeitem 且带 aria-selected（项目行无 aria-selected，搜索行是 button）。 */
		const LEGACY_ROW_SELECTOR = "div[role=\"treeitem\"][aria-selected]";
		/** 非本桥的既有金额能力：旧补丁 span、中文/英文 title、无本桥标记的 data 徽标。 */
		const FOREIGN_COST_SELECTOR = [
			`[data-dsh-token-monitor-session-cost]:not([${BRIDGE_MARKER}])`,
			`[title="${SESSION_COST_TITLE}"]:not([${BRIDGE_MARKER}])`,
			`[title="${SESSION_COST_LEGACY_TITLE}"]:not([${BRIDGE_MARKER}])`
		].join(", ");
		/**
		* 与旧版补丁一致的视觉（标题后、时间前；hover 时随行操作浮出而隐藏；
		* 仅作用于不带 data-session-id 的旧行，避免影响正式席位徽标）。
		*/
		const STYLE_TEXT = [
			`[${SESSION_COST_MARKER}] {`,
			"  flex: none;",
			"  margin-right: 12px;",
			"  font-size: 12px;",
			"  line-height: 20px;",
			"  color: #4176e6;",
			"  font-variant-numeric: tabular-nums;",
			"}",
			`[role="treeitem"]:not([data-session-id]):hover [${SESSION_COST_MARKER}],`,
			`[role="treeitem"]:not([data-session-id])[class*="menuOpen"] [${SESSION_COST_MARKER}] {`,
			"  display: none;",
			"}"
		].join("\n");
		function buildCostIndex(byId) {
			const bySessionId = /* @__PURE__ */ new Map();
			const titleCounts = /* @__PURE__ */ new Map();
			const ambiguousTitles = /* @__PURE__ */ new Set();
			for (const summary of Object.values(byId)) {
				const cost = readSessionCost(summary.projectionValues);
				if (cost !== void 0) bySessionId.set(summary.id, cost);
				titleCounts.set(summary.displayTitle, (titleCounts.get(summary.displayTitle) ?? 0) + 1);
			}
			const byUniqueTitle = /* @__PURE__ */ new Map();
			for (const summary of Object.values(byId)) if ((titleCounts.get(summary.displayTitle) ?? 0) === 1) byUniqueTitle.set(summary.displayTitle, summary);
			else ambiguousTitles.add(summary.displayTitle);
			return {
				bySessionId,
				byUniqueTitle,
				ambiguousTitles
			};
		}
		function resolveTitle(row, index) {
			const matches = Array.from(row.children).filter((child) => child.tagName === "SPAN" && Array.from(child.childNodes).every((node) => node.nodeType === Node.TEXT_NODE) && (child.textContent ?? "").trim().length > 0 && (index.byUniqueTitle.has((child.textContent ?? "").trim()) || index.ambiguousTitles.has((child.textContent ?? "").trim())));
			if (matches.length > 1) return { kind: "multi" };
			if (matches.length === 0) return { kind: "none" };
			const span = matches[0];
			const text = (span.textContent ?? "").trim();
			if (index.ambiguousTitles.has(text)) return { kind: "ambiguous" };
			if (!index.byUniqueTitle.has(text)) return { kind: "none" };
			return {
				kind: "ok",
				title: text,
				span
			};
		}
		/** 标题后的第一个直接子元素 span（旧结构 title → time → rowActions）。 */
		function timeAnchorAfter(row, span) {
			const directChildren = Array.from(row.children);
			const order = directChildren.indexOf(span);
			return directChildren.slice(order + 1).find((child) => child.tagName === "SPAN");
		}
		/**
		* 向一行已通过结构判定的旧会话行注入金额节点。判定失败返回 'noop'
		* （无金额）或 'blocked'（结构不可信，触发单次告警），绝不写坏既有 DOM。
		*/
		function injectIntoRow(row, index, resolution) {
			const summary = index.byUniqueTitle.get(resolution.title);
			if (summary === void 0) return "noop";
			const cost = index.bySessionId.get(summary.id);
			if (cost === void 0) return "noop";
			const timeNode = timeAnchorAfter(row, resolution.span);
			if (timeNode === void 0) return "blocked";
			const span = document.createElement("span");
			span.setAttribute(SESSION_COST_MARKER, "");
			span.setAttribute(BRIDGE_MARKER, "");
			span.setAttribute(SESSION_ID_ATTR, summary.id);
			span.setAttribute("title", SESSION_COST_TITLE);
			span.textContent = formatSessionCost(cost);
			row.insertBefore(span, timeNode);
			return "injected";
		}
		/**
		* 旧宿主兼容桥组件：无视觉的控制器。挂载后立即扫描一次，并随 DOM 变更与
		* 会话索引变更重扫；新宿主或已具备金额能力时整体停用。
		* @param props - 全局 kit（useSessions）。
		* @returns 恒为 null。
		*/
		function LegacySessionCostBridge({ useSessions }) {
			const byId = useSessions((state) => state.byId);
			const costIndex = (0, react.useMemo)(() => buildCostIndex(byId), [byId]);
			const costIndexRef = (0, react.useRef)(costIndex);
			costIndexRef.current = costIndex;
			const stoppedRef = (0, react.useRef)(false);
			const warnedRef = (0, react.useRef)(false);
			const styleRef = (0, react.useRef)(null);
			const observerRef = (0, react.useRef)(null);
			const scanRef = (0, react.useRef)(() => {});
			(0, react.useEffect)(() => {
				const doc = document;
				stoppedRef.current = false;
				warnedRef.current = false;
				const observer = new MutationObserver(() => scanRef.current());
				observer.observe(doc.documentElement, {
					childList: true,
					subtree: true,
					characterData: true,
					attributes: true
				});
				observerRef.current = observer;
				scanRef.current();
				return () => {
					stoppedRef.current = true;
					observer.disconnect();
					if (observerRef.current === observer) observerRef.current = null;
					doc.querySelectorAll(`[${BRIDGE_MARKER}]`).forEach((node) => node.remove());
					if (styleRef.current !== null) {
						styleRef.current.remove();
						styleRef.current = null;
					}
				};
			}, []);
			(0, react.useEffect)(() => {
				if (stoppedRef.current) return;
				scanRef.current();
			}, [costIndex]);
			scanRef.current = () => {
				if (stoppedRef.current) return;
				const doc = document;
				if (doc.querySelector("[data-session-row-trailing-slot]") !== null || doc.querySelector("[role=\"treeitem\"][data-session-id]") !== null) {
					deactivate();
					return;
				}
				const index = costIndexRef.current;
				let injectedAny = false;
				let blocked = false;
				const rows = Array.from(doc.querySelectorAll(LEGACY_ROW_SELECTOR));
				for (const row of rows) {
					if (row.hasAttribute("data-session-id") || row.querySelector("[data-session-row-trailing-slot]") !== null) {
						deactivate();
						return;
					}
					if (row.querySelector(FOREIGN_COST_SELECTOR) !== null) {
						deactivate();
						return;
					}
				}
				const entries = rows.map((row) => ({
					row,
					resolution: resolveTitle(row, index)
				}));
				const domTitleCounts = /* @__PURE__ */ new Map();
				for (const entry of entries) {
					if (entry.resolution.kind !== "ok") continue;
					domTitleCounts.set(entry.resolution.title, (domTitleCounts.get(entry.resolution.title) ?? 0) + 1);
				}
				for (const entry of entries) {
					const existing = entry.row.querySelector(`[${BRIDGE_MARKER}]`);
					if (existing !== null) {
						const current = entry.resolution.kind === "ok" ? index.byUniqueTitle.get(entry.resolution.title) : void 0;
						const cost = current === void 0 ? void 0 : index.bySessionId.get(current.id);
						if (entry.resolution.kind === "ok" && current !== void 0 && cost !== void 0 && (domTitleCounts.get(entry.resolution.title) ?? 0) === 1 && existing.getAttribute(SESSION_ID_ATTR) === current.id && timeAnchorAfter(entry.row, entry.resolution.span) !== void 0) {
							const text = formatSessionCost(cost);
							if (existing.textContent !== text) existing.textContent = text;
							continue;
						}
						existing.remove();
						if (entry.resolution.kind === "ambiguous" || entry.resolution.kind === "multi") blocked = true;
					}
					if (entry.resolution.kind === "ambiguous" || entry.resolution.kind === "multi") {
						blocked = true;
						continue;
					}
					if (entry.resolution.kind !== "ok") continue;
					if ((domTitleCounts.get(entry.resolution.title) ?? 0) > 1) {
						blocked = true;
						continue;
					}
					const outcome = injectIntoRow(entry.row, index, entry.resolution);
					if (outcome === "injected") injectedAny = true;
					if (outcome === "blocked") blocked = true;
				}
				if (injectedAny) ensureStyle();
				if (blocked && !warnedRef.current) {
					warnedRef.current = true;
					console.warn("[dsh-token-monitor] 旧版侧边栏会话行结构无法可靠识别（标题重名或结构不匹配），已跳过会话金额降级注入。");
				}
			};
			/** 仅注入成功时惰性挂载样式。 */
			const ensureStyle = () => {
				if (styleRef.current !== null || document.getElementById(STYLE_ID) !== null) return;
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = STYLE_TEXT;
				document.head.appendChild(style);
				styleRef.current = style;
			};
			/** 整体停用：断开观察、移除全部注入节点与样式，之后不再操作。 */
			const deactivate = () => {
				if (stoppedRef.current) return;
				stoppedRef.current = true;
				observerRef.current?.disconnect();
				observerRef.current = null;
				document.querySelectorAll(`[${BRIDGE_MARKER}]`).forEach((node) => node.remove());
				if (styleRef.current !== null) {
					styleRef.current.remove();
					styleRef.current = null;
				}
			};
			return null;
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/routeEligibility.ts
		function parsePricingEligibilityInfo(value) {
			if (value === null || typeof value !== "object") return void 0;
			const data = value;
			if (typeof data.provider !== "string" || !Array.isArray(data.models) || !data.models.every((model) => typeof model === "string" && model.length > 0) || !Number.isFinite(data.updatedAt)) return void 0;
			return {
				provider: data.provider,
				models: data.models,
				updatedAt: data.updatedAt
			};
		}
		/** Mirror Host longest-prefix model matching for the current configured price table. */
		function matchesPricedModel(model, configuredModels) {
			return configuredModels.some((name) => model === name || model.startsWith(`${name}-`));
		}
		/** Explicit incompatibility is false; unavailable or unresolved state remains indeterminate. */
		function isRouteEligible(route, pricing) {
			if (route.routable === false) return false;
			if (route.routable === null || route.current === null || pricing === void 0) return void 0;
			if (pricing.provider !== "deepseek-official") return false;
			const current = route.current;
			return current.provider === pricing.provider && typeof current.model === "string" && matchesPricedModel(current.model, pricing.models);
		}
		/** Build the latest-session loader used by the React hook; pricing HTTP honors cancellation. */
		function createRouteEligibilityLoader(modelDirectories, fetcher = fetch) {
			return async (sessionId, signal) => {
				if (signal.aborted) return void 0;
				try {
					const directory = modelDirectories.directoryFor(sessionId);
					if (signal.aborted) return void 0;
					const [route, response] = await Promise.all([directory.load(), fetcher("/api/token-monitor/pricing-eligibility", {
						cache: "no-store",
						signal
					})]);
					if (signal.aborted || !response.ok) return void 0;
					const pricing = parsePricingEligibilityInfo(await response.json());
					if (signal.aborted) return void 0;
					return isRouteEligible(route, pricing);
				} catch {
					return;
				}
			};
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/index.ts
		/** 核心依赖：slot 注册 + Host 连接。旧版 Conversation Node 注册表按需使用。 */
		const inject = [
			"slots",
			"connection",
			"modelDirectories"
		];
		function apply(ctx) {
			const loadRouteEligibility = createRouteEligibilityLoader(ctx.get("modelDirectories"));
			const conversationEvents = ctx.get("conversationEvents", false);
			if (conversationEvents !== void 0) {
				conversationEvents.register(tokenUsageNodeDefinition);
				ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
					name: "conversation.chat.node",
					key: "token-usage"
				}, UsageNodeView));
			}
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "token-monitor-stats",
				order: 0
			}, SessionStatsBar));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "token-monitor-balance",
				inject: () => ({ loadRouteEligibility })
			}, BalanceWidget));
			ctx.slots.inject(SESSION_ROW_TRAILING_SLOT, () => ctx.slots.register({ name: SESSION_ROW_TRAILING_SLOT }, SessionCostBadge));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "token-monitor-legacy-session-cost",
				order: 999
			}, LegacySessionCostBridge));
		}
		//#endregion
		exports.BalanceWidget = BalanceWidget;
		exports.LegacySessionCostBridge = LegacySessionCostBridge;
		exports.SESSION_COST_MARKER = SESSION_COST_MARKER;
		exports.SESSION_COST_TITLE = SESSION_COST_TITLE;
		exports.SESSION_ROW_TRAILING_SLOT = SESSION_ROW_TRAILING_SLOT;
		exports.SessionCostBadge = SessionCostBadge;
		exports.SessionStatsBar = SessionStatsBar;
		exports.TokenMonitorSettingsApiError = TokenMonitorSettingsApiError;
		exports.TokenMonitorSettingsProtocolError = TokenMonitorSettingsProtocolError;
		exports.TokenMonitorUpdateApiError = TokenMonitorUpdateApiError;
		exports.TokenMonitorUpdateProtocolError = TokenMonitorUpdateProtocolError;
		exports.UsageNodeView = UsageNodeView;
		exports.apply = apply;
		exports.createTokenMonitorSettingsApi = createTokenMonitorSettingsApi;
		exports.createTokenMonitorUpdateApi = createTokenMonitorUpdateApi;
		exports.formatSessionCost = formatSessionCost;
		exports.inject = inject;
		exports.readSessionCost = readSessionCost;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map