import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import os, { homedir, tmpdir } from "node:os";
import path, { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Service } from "@deepseek-ai/cordis";
import { execFile, spawn } from "node:child_process";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { z } from "zod";
import z$1 from "@deepseek-ai/schemastery";
import { SettingsConflictError } from "@deepseek-ai/dsh-settings";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
function isPlainObject$2(value) {
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
	if (!isPlainObject$2(value)) return {
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
/** Validate and detach the PATCH wire envelope, rejecting unknown and dangerous keys. */
function parseTokenMonitorSettingsPatchRequest(value) {
	if (!isPlainObject$2(value)) return {
		ok: false,
		fields: { body: "必须是普通对象" }
	};
	const fields = {};
	for (const key of Object.keys(value)) if (DANGEROUS_KEYS.has(key)) fields[key] = "禁止使用危险对象键";
	else if (key !== "patch" && key !== "expectedRevision") fields[key] = "未知请求字段";
	if (!Object.hasOwn(value, "patch")) fields.patch = "缺少必填字段";
	const parsedPatch = parseSettingsObject(value.patch, true, "patch");
	if (!parsedPatch.ok) Object.assign(fields, parsedPatch.fields);
	const expectedRevision = value.expectedRevision;
	if (expectedRevision !== void 0 && (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) fields.expectedRevision = "必须是非负安全整数";
	if (Object.keys(fields).length > 0) return {
		ok: false,
		fields
	};
	const validExpectedRevision = expectedRevision;
	return {
		ok: true,
		value: {
			...validExpectedRevision === void 0 ? {} : { expectedRevision: validExpectedRevision },
			patch: parsedPatch.ok ? parsedPatch.value : {}
		}
	};
}
/** Pick only public fields from a resolved Host settings section. */
function pickPublicTokenMonitorSettings(value) {
	const picked = {};
	for (const key of TOKEN_MONITOR_SETTING_KEYS) picked[key] = value[key];
	const parsed = parseTokenMonitorSettings(picked);
	if (!parsed.ok) throw new TypeError(`invalid resolved token monitor settings: ${JSON.stringify(parsed.fields)}`);
	return parsed.value;
}
var UnsupportedTokenMonitorSettingsVersionError = class extends Error {
	version;
	constructor(version) {
		super(`token monitor settings schema version ${String(version)} is newer than supported version ${String(3)}`);
		this.version = version;
		this.name = "UnsupportedTokenMonitorSettingsVersionError";
	}
};
const NOTIFICATION_DEFAULT_OFF_KEYS = [
	"budgetExceededNotificationEnabled",
	"peakReminderEnabled",
	"peakReminderEnterPeak",
	"peakReminderEnterValley",
	"notifyOncePerTransition",
	"whaleBubbleEnabled",
	"wechatNotificationsEnabled",
	"cacheHitAnomalyNotificationEnabled"
];
/** Persist conservative notification defaults for legacy and incomplete current settings. */
function planTokenMonitorSettingsMigration(user) {
	if (user === void 0) return void 0;
	if (!isPlainObject$2(user)) throw new TypeError("token monitor settings user section must be a plain object");
	const version = user.schemaVersion;
	if (version !== void 0 && (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0)) throw new TypeError("token monitor settings schemaVersion must be a non-negative safe integer");
	if (typeof version === "number" && version > 3) throw new UnsupportedTokenMonitorSettingsVersionError(version);
	const patch = {};
	if (version !== 3) patch.schemaVersion = 3;
	for (const key of NOTIFICATION_DEFAULT_OFF_KEYS) if (!Object.hasOwn(user, key)) patch[key] = false;
	return Object.keys(patch).length === 0 ? void 0 : patch;
}
/** Stable operation error safe to translate into an HTTP response. */
var WechatConnectionError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.code = code;
		this.name = "WechatConnectionError";
	}
};
var LoginSessionStore = class {
	ttlMs;
	now;
	createId;
	current;
	expiredSessionId;
	constructor(ttlMs, now, createId) {
		this.ttlMs = ttlMs;
		this.now = now;
		this.createId = createId;
	}
	begin(qrcode, qrPayload) {
		const session = {
			sessionId: this.createId(),
			qrcode,
			qrPayload,
			phase: "waiting",
			expiresAt: this.now() + this.ttlMs
		};
		this.current = session;
		this.expiredSessionId = void 0;
		return session;
	}
	snapshot() {
		const session = this.current;
		if (session === void 0) return void 0;
		if (this.now() >= session.expiresAt) {
			this.expiredSessionId = session.sessionId;
			this.current = void 0;
			return;
		}
		return {
			sessionId: session.sessionId,
			phase: session.phase,
			expiresAt: session.expiresAt
		};
	}
	require(sessionId) {
		const session = this.current;
		if (session === void 0) {
			if (sessionId === this.expiredSessionId) throw new WechatConnectionError("LOGIN_SESSION_EXPIRED", "微信登录二维码已过期");
			throw new WechatConnectionError("LOGIN_SESSION_NOT_FOUND", "微信登录会话不存在");
		}
		if (session.sessionId !== sessionId) throw new WechatConnectionError("LOGIN_SESSION_NOT_FOUND", "微信登录会话不存在");
		if (this.now() >= session.expiresAt) {
			this.expiredSessionId = session.sessionId;
			this.current = void 0;
			throw new WechatConnectionError("LOGIN_SESSION_EXPIRED", "微信登录二维码已过期");
		}
		return session;
	}
	markScanned(session) {
		if (this.current === session) session.phase = "scanned";
	}
	expire(session) {
		if (this.current !== session) return;
		this.expiredSessionId = session.sessionId;
		this.current = void 0;
	}
	finish(session) {
		if (this.current === session) this.current = void 0;
		this.expiredSessionId = void 0;
	}
	clear() {
		this.current = void 0;
		this.expiredSessionId = void 0;
	}
};
var SingleFlightGate = class {
	active;
	get operation() {
		return this.active ?? "idle";
	}
	async run(operation, task) {
		if (this.active !== void 0) throw new WechatConnectionError("OPERATION_IN_PROGRESS", `微信连接操作 ${this.active} 正在进行`);
		this.active = operation;
		try {
			return await task();
		} finally {
			this.active = void 0;
		}
	}
};
/** Owns the in-memory login lifecycle and refuses process changes without an injected Host owner. */
var WechatConnectionAdapter = class {
	options;
	gate = new SingleFlightGate();
	sessions;
	now;
	constructor(options) {
		this.options = options;
		this.now = options.now ?? Date.now;
		const ttlMs = options.loginTtlMs ?? 3e5;
		if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new TypeError("wechat login TTL must be a positive safe integer");
		this.sessions = new LoginSessionStore(ttlMs, this.now, options.createSessionId ?? randomUUID);
	}
	/** Read orthogonal authentication, process, and delivery facts without deriving connected from credentials. */
	async status() {
		const checkedAt = this.now();
		let availability = "unsupported";
		let credential = {
			auth: "unknown",
			delivery: "unknown"
		};
		let process = "unknown";
		let lastError;
		try {
			availability = await this.options.gateway.isAvailable() ? "available" : "unsupported";
			if (availability === "available") credential = await this.options.gateway.inspectCredentials();
		} catch {
			availability = "unsupported";
			lastError = {
				code: "CLAWBOT_UNAVAILABLE",
				message: "ClawBot 微信组件不可用"
			};
		}
		try {
			if (this.options.hostBridge !== void 0) {
				const observation = await this.options.hostBridge.inspect();
				process = observation.state === "running" ? "host-managed-running" : observation.state === "stopped" ? "host-managed-stopped" : "unknown";
			} else process = await this.options.externalBridge?.inspect() ?? "unknown";
		} catch {
			process = "unknown";
			lastError ??= {
				code: "BRIDGE_INSPECTION_FAILED",
				message: "微信 bridge 状态检查失败"
			};
		}
		lastError ??= credential.lastError;
		const pendingLogin = this.sessions.snapshot();
		const auth = pendingLogin === void 0 ? credential.auth : "pending";
		const canMutateOwnedBridge = this.options.hostBridge !== void 0 && this.gate.operation === "idle";
		return {
			schemaVersion: 1,
			provider: "clawbot-wechat",
			availability,
			auth,
			process,
			delivery: credential.delivery,
			operation: this.gate.operation,
			capabilities: {
				canLogin: availability === "available" && this.gate.operation === "idle",
				canReconnect: canMutateOwnedBridge && credential.auth === "authenticated",
				canDisconnect: canMutateOwnedBridge && (credential.auth !== "unconfigured" || pendingLogin !== void 0)
			},
			...pendingLogin === void 0 ? {} : { pendingLogin },
			...credential.maskedUserId === void 0 ? {} : { identity: { maskedUserId: credential.maskedUserId } },
			...lastError === void 0 ? {} : { lastError },
			checkedAt
		};
	}
	/** Start one five-minute in-memory QR login session. */
	async login() {
		return {
			login: await this.gate.run("login", async () => {
				if (!await this.options.gateway.isAvailable()) throw new WechatConnectionError("UNSUPPORTED", "ClawBot 微信组件不可用");
				try {
					const qr = await this.options.gateway.createLoginQr();
					assertBoundedString(qr.qrcode, "qrcode", 8192);
					assertBoundedString(qr.qrPayload, "qrPayload", 16384);
					const session = this.sessions.begin(qr.qrcode, qr.qrPayload);
					return {
						sessionId: session.sessionId,
						expiresAt: session.expiresAt,
						qrPayload: session.qrPayload
					};
				} catch (error) {
					if (error instanceof WechatConnectionError) throw error;
					throw new WechatConnectionError("OPERATION_FAILED", "微信登录二维码生成失败", { cause: error });
				}
			}),
			status: await this.status()
		};
	}
	/** Poll one short-lived login session and save only validated ClawBot credentials on confirmation. */
	async confirmLogin(sessionId) {
		let result;
		await this.gate.run("confirm-login", async () => {
			const session = this.sessions.require(sessionId);
			let polled;
			try {
				polled = await this.options.gateway.pollLogin(session.qrcode);
			} catch (error) {
				if (error instanceof WechatConnectionError) throw error;
				throw new WechatConnectionError("OPERATION_FAILED", "微信登录状态检查失败", { cause: error });
			}
			switch (polled.status) {
				case "wait":
					result = "waiting";
					return;
				case "scaned":
					this.sessions.markScanned(session);
					result = "scanned";
					return;
				case "expired":
					this.sessions.expire(session);
					result = "expired";
					return;
				case "confirmed":
					await this.options.gateway.replaceCredentials(polled.credentials);
					this.sessions.finish(session);
					result = "confirmed";
					return;
			}
		});
		return {
			result,
			status: await this.status()
		};
	}
	/** Restart only a bridge explicitly owned by the Host. */
	async reconnect() {
		await this.gate.run("reconnect", async () => {
			const bridge = this.requireHostBridge();
			if ((await this.options.gateway.inspectCredentials()).auth !== "authenticated") throw new WechatConnectionError("NEEDS_LOGIN", "微信凭据未配置或已失效");
			try {
				await bridge.stopAndWaitForExit();
				await bridge.startAndWaitUntilReady();
			} catch (error) {
				throw new WechatConnectionError("OPERATION_FAILED", "微信 bridge 重连失败", { cause: error });
			}
		});
		return await this.status();
	}
	/** Stop an owned bridge before removing credentials; external processes are never signalled. */
	async disconnect(confirm) {
		if (!confirm) throw new WechatConnectionError("CONFIRMATION_REQUIRED", "断开微信前需要明确确认");
		await this.gate.run("disconnect", async () => {
			const bridge = this.requireHostBridge();
			try {
				await bridge.stopAndWaitForExit();
				await this.options.gateway.clearCredentials();
				await this.options.gateway.clearLegacyPendingLogin();
				this.sessions.clear();
			} catch (error) {
				throw new WechatConnectionError("OPERATION_FAILED", "微信断开操作失败", { cause: error });
			}
		});
		return await this.status();
	}
	requireHostBridge() {
		if (this.options.hostBridge === void 0) throw new WechatConnectionError("BRIDGE_NOT_OWNED", "微信 bridge 不由 DSH Host 管理");
		return this.options.hostBridge;
	}
};
/** Cordis capability exposing only the sanitized adapter contract. */
var WechatConnectionService = class extends Service {
	adapter;
	constructor(ctx, adapter) {
		super(ctx, "wechatConnection");
		this.adapter = adapter;
	}
	status() {
		return this.adapter.status();
	}
	login() {
		return this.adapter.login();
	}
	confirmLogin(sessionId) {
		return this.adapter.confirmLogin(sessionId);
	}
	reconnect() {
		return this.adapter.reconnect();
	}
	disconnect(confirm) {
		return this.adapter.disconnect(confirm);
	}
};
const WECHAT_ILINK_ORIGIN = "https://ilinkai.weixin.qq.com";
const MAX_CREDENTIAL_FILE_BYTES = 65536;
const MAX_CONTEXT_FILE_BYTES = 4194304;
/** File-backed ClawBot gateway that validates all module and JSON results before use. */
var ClawbotFilesystemGateway = class {
	options;
	dataDirectory;
	importModule;
	constructor(options) {
		this.options = options;
		this.dataDirectory = options.dataDirectory ?? join(homedir(), ".wx-ai-bridge");
		this.importModule = options.importModule ?? ((url) => import(url));
	}
	async isAvailable() {
		if (this.options.clawbotIndex.trim().length === 0) return false;
		try {
			await Promise.all([
				access(this.options.clawbotIndex),
				access(join(dirname(this.options.clawbotIndex), "ilink", "auth.js")),
				access(join(dirname(this.options.clawbotIndex), "config.js"))
			]);
			return true;
		} catch {
			return false;
		}
	}
	async inspectCredentials() {
		const credentials = await readBoundedJson(join(this.dataDirectory, "credentials.json"), MAX_CREDENTIAL_FILE_BYTES);
		if (credentials.kind === "missing") return {
			auth: "unconfigured",
			delivery: "not-ready"
		};
		if (credentials.kind === "invalid") return {
			auth: "unknown",
			delivery: "unknown",
			lastError: {
				code: "CREDENTIALS_INVALID",
				message: "ClawBot 凭据文件无效"
			}
		};
		const parsedCredentials = parseStoredCredentials(credentials.value);
		if (parsedCredentials === void 0) {
			if (isPlainObject$1(credentials.value) && Object.keys(credentials.value).length === 0) return {
				auth: "unconfigured",
				delivery: "not-ready"
			};
			return {
				auth: "unknown",
				delivery: "unknown",
				lastError: {
					code: "CREDENTIALS_INVALID",
					message: "ClawBot 凭据文件无效"
				}
			};
		}
		const contexts = await readBoundedJson(join(this.dataDirectory, "context_tokens.json"), MAX_CONTEXT_FILE_BYTES);
		if (contexts.kind === "invalid") return {
			auth: "authenticated",
			delivery: "unknown",
			maskedUserId: maskIdentifier(parsedCredentials.ilinkUserId),
			lastError: {
				code: "CONTEXT_TOKENS_INVALID",
				message: "ClawBot 会话激活信息无效"
			}
		};
		let hasContext = false;
		if (contexts.kind === "value") {
			const value = contexts.value;
			if (!isStringRecord(value)) return {
				auth: "authenticated",
				delivery: "unknown",
				maskedUserId: maskIdentifier(parsedCredentials.ilinkUserId),
				lastError: {
					code: "CONTEXT_TOKENS_INVALID",
					message: "ClawBot 会话激活信息无效"
				}
			};
			hasContext = Object.values(value).some((entry) => entry.length > 0);
		}
		return {
			auth: "authenticated",
			delivery: hasContext ? "ready" : "needs-activation",
			maskedUserId: maskIdentifier(parsedCredentials.ilinkUserId)
		};
	}
	async createLoginQr() {
		const value = await getFunction(await this.loadModule("ilink/auth.js"), "getQRCode")();
		if (!isPlainObject$1(value)) throw new WechatConnectionError("LOGIN_PROTOCOL_ERROR", "微信二维码响应无效");
		const qrcode = boundedString(value.qrcode, 8192);
		const qrPayload = boundedString(value.qrcode_img_content, 16384) ?? qrcode;
		if (qrcode === void 0 || qrPayload === void 0) throw new WechatConnectionError("LOGIN_PROTOCOL_ERROR", "微信二维码响应缺少必要字段");
		return {
			qrcode,
			qrPayload
		};
	}
	async pollLogin(qrcode) {
		assertBoundedString(qrcode, "qrcode", 8192);
		const value = await getFunction(await this.loadModule("ilink/auth.js"), "pollQRCodeStatus")(qrcode);
		if (!isPlainObject$1(value)) throw new WechatConnectionError("LOGIN_PROTOCOL_ERROR", "微信登录状态响应无效");
		if (value.status === "wait" || value.status === "scaned" || value.status === "expired") return { status: value.status };
		if (value.status !== "confirmed") throw new WechatConnectionError("LOGIN_PROTOCOL_ERROR", "微信登录状态响应无效");
		const credentials = parseConfirmedCredentials(value);
		if (credentials === void 0) throw new WechatConnectionError("LOGIN_PROTOCOL_ERROR", "微信登录确认响应缺少凭据");
		return {
			status: "confirmed",
			credentials
		};
	}
	async replaceCredentials(credentials) {
		const parsed = parseStoredCredentials(credentials);
		if (parsed === void 0) throw new WechatConnectionError("LOGIN_PROTOCOL_ERROR", "微信登录凭据无效");
		await this.writeEmptyContextTokens();
		await getFunction(await this.loadModule("config.js"), "saveCredentials")(parsed);
	}
	async clearCredentials() {
		await this.writeEmptyContextTokens();
		await getFunction(await this.loadModule("config.js"), "clearCredentials")();
	}
	async clearLegacyPendingLogin() {
		try {
			await unlink(join(this.dataDirectory, "pending_qrcode.json"));
		} catch (error) {
			if (!isNodeError(error, "ENOENT")) throw error;
		}
	}
	async loadModule(relativePath) {
		if (this.options.clawbotIndex.trim().length === 0) throw new WechatConnectionError("UNSUPPORTED", "ClawBot 微信组件不可用");
		const value = await this.importModule(pathToFileURL(join(dirname(this.options.clawbotIndex), relativePath)).href);
		if (!isPlainObject$1(value)) throw new TypeError(`ClawBot module ${relativePath} has invalid exports`);
		return value;
	}
	async writeEmptyContextTokens() {
		await mkdir(this.dataDirectory, {
			recursive: true,
			mode: 448
		});
		const target = join(this.dataDirectory, "context_tokens.json");
		const temporary = `${target}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, "{}\n", {
				encoding: "utf8",
				flag: "wx",
				mode: 384
			});
			try {
				await rename(temporary, target);
			} catch {
				await writeFile(target, "{}\n", {
					encoding: "utf8",
					mode: 384
				});
			}
		} finally {
			await unlink(temporary).catch(() => void 0);
		}
	}
};
function getFunction(record, key) {
	const value = record[key];
	if (typeof value !== "function") throw new TypeError(`ClawBot module is missing ${key}`);
	return value;
}
function parseConfirmedCredentials(value) {
	return parseStoredCredentials({
		botToken: value.bot_token,
		baseUrl: value.baseurl ?? WECHAT_ILINK_ORIGIN,
		ilinkBotId: value.ilink_bot_id,
		ilinkUserId: value.ilink_user_id
	});
}
function parseStoredCredentials(value) {
	if (!isPlainObject$1(value)) return void 0;
	const botToken = boundedString(value.botToken, 4096);
	const ilinkBotId = boundedString(value.ilinkBotId, 512);
	const ilinkUserId = boundedString(value.ilinkUserId, 512);
	const baseUrl = normalizeBaseUrl(value.baseUrl);
	if (botToken === void 0 || ilinkBotId === void 0 || ilinkUserId === void 0 || baseUrl === void 0) return;
	return {
		botToken,
		baseUrl,
		ilinkBotId,
		ilinkUserId
	};
}
function normalizeBaseUrl(value) {
	const raw = boundedString(value, 2048);
	if (raw === void 0) return void 0;
	try {
		const url = new URL(raw);
		if (url.origin !== WECHAT_ILINK_ORIGIN || url.pathname !== "/" && url.pathname !== "") return void 0;
		if (url.username || url.password || url.search || url.hash) return void 0;
		return WECHAT_ILINK_ORIGIN;
	} catch {
		return;
	}
}
function boundedString(value, maximumLength) {
	if (typeof value !== "string") return void 0;
	const text = value.trim();
	return text.length > 0 && text.length <= maximumLength ? text : void 0;
}
function assertBoundedString(value, name, maximumLength) {
	if (boundedString(value, maximumLength) === void 0) throw new WechatConnectionError("LOGIN_PROTOCOL_ERROR", `${name} 无效`);
}
function maskIdentifier(value) {
	if (value.length <= 8) return "***";
	return `${value.slice(0, 4)}***${value.slice(-4)}`;
}
function isPlainObject$1(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
function isStringRecord(value) {
	if (!isPlainObject$1(value)) return false;
	return Object.keys(value).every((key) => key !== "__proto__" && key !== "prototype" && key !== "constructor") && Object.values(value).every((entry) => typeof entry === "string");
}
async function readBoundedJson(path, maximumBytes) {
	let buffer;
	try {
		buffer = await readFile(path);
	} catch (error) {
		return isNodeError(error, "ENOENT") ? { kind: "missing" } : { kind: "invalid" };
	}
	if (buffer.byteLength > maximumBytes) return { kind: "invalid" };
	try {
		return {
			kind: "value",
			value: JSON.parse(buffer.toString("utf8"))
		};
	} catch {
		return { kind: "invalid" };
	}
}
function isNodeError(error, code) {
	return error instanceof Error && "code" in error && error.code === code;
}
//#endregion
//#region plugins/wechat-notify/src/sender.ts
const ACTIVATION_FAILURE = /prepare|context[\s_-]?token|登录|扫码|发过消息|login|expired|激活/i;
const SENSITIVE_ENVIRONMENT_NAME = /KEY|PASSWORD|SECRET|TOKEN/i;
/** Preserve ordinary process settings while withholding credentials from the child CLI. */
function scrubbedParentEnv(source = process.env) {
	return Object.fromEntries(Object.entries(source).filter(([name]) => !SENSITIVE_ENVIRONMENT_NAME.test(name) && !/^DSH_/i.test(name)));
}
function runCommand(invocation) {
	return new Promise((resolve, reject) => {
		execFile(invocation.command, [...invocation.args], {
			encoding: "utf8",
			env: invocation.env,
			timeout: invocation.timeoutMs,
			windowsHide: true
		}, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}
/** Extract bounded human-readable process failure text without throwing. */
function describeFailure(error) {
	if (error !== null && typeof error === "object") {
		const value = error;
		const parts = [];
		if (typeof value.stderr === "string" && value.stderr.trim()) parts.push(value.stderr.trim());
		if (typeof value.stdout === "string" && value.stdout.trim()) parts.push(value.stdout.trim());
		if (typeof value.message === "string" && value.message.trim()) parts.push(value.message.trim());
		const text = parts.join(" | ").trim();
		if (text) return text.slice(0, 2e3);
	}
	return String(error).slice(0, 2e3);
}
/** Async UTF-8 ClawBot adapter shared by tools and background reminders. */
var ClawbotWechatSender = class {
	options;
	timeoutMs;
	tempDirectory;
	run;
	constructor(options) {
		this.options = options;
		this.timeoutMs = options.timeoutMs ?? 3e4;
		this.tempDirectory = options.tempDirectory ?? tmpdir();
		this.run = options.run ?? runCommand;
	}
	async send(message) {
		if (this.options.clawbotIndex.trim().length === 0) return {
			ok: false,
			code: "send-failed",
			detail: "未配置 WECHAT_NOTIFY_CLAWBOT_INDEX"
		};
		const privateDirectory = await mkdtemp(join(this.tempDirectory, "dsh-wechat-notify-"));
		const messageFile = join(privateDirectory, "message.txt");
		try {
			await writeFile(messageFile, message, {
				encoding: "utf8",
				flag: "wx",
				mode: 384
			});
			try {
				await this.run({
					command: process.execPath,
					args: [
						this.options.clawbotIndex,
						"send",
						"--file",
						messageFile
					],
					env: scrubbedParentEnv(),
					timeoutMs: this.timeoutMs
				});
				return { ok: true };
			} catch (error) {
				const detail = describeFailure(error);
				return {
					ok: false,
					code: ACTIVATION_FAILURE.test(detail) ? "activation-required" : "send-failed",
					detail
				};
			}
		} finally {
			await rm(privateDirectory, {
				recursive: true,
				force: true
			}).catch(() => {});
		}
	}
};
/** Fail-soft notification capability for non-interactive plugin work. */
var WechatNotifyService = class extends Service {
	sender;
	constructor(ctx, sender) {
		super(ctx, "wechatNotify");
		this.sender = sender;
	}
	async send(message) {
		try {
			return await this.sender.send(message);
		} catch (error) {
			return {
				ok: false,
				code: "send-failed",
				detail: describeFailure(error)
			};
		}
	}
};
/** Install the bundled WeChat services without requiring a separately loaded plugin. */
function installBundledWechat(ctx) {
	const clawbotIndex = process.env["WECHAT_NOTIFY_CLAWBOT_INDEX"]?.trim() ?? "";
	new WechatNotifyService(ctx, new ClawbotWechatSender({ clawbotIndex }));
	new WechatConnectionService(ctx, new WechatConnectionAdapter({ gateway: new ClawbotFilesystemGateway({ clawbotIndex }) }));
}
//#endregion
//#region plugins/wechat-notify/src/tools.ts
const UNCONFIGURED_TEXT = "微信通道未配置：请在 Host 设置 WECHAT_NOTIFY_CLAWBOT_INDEX 并重启，或安装独立 dsh-wechat-notify 插件。";
const UNSUPPORTED_TEXT = "ClawBot 微信组件不可用：请确认 WECHAT_NOTIFY_CLAWBOT_INDEX 指向本机 ClawBot CLI 入口文件。";
/** 把发送结果转成 agent 可读文本（与旧版工具文案保持一致）。 */
function notifyText(result, message) {
	if (result.ok) return `微信通知已发送：${message}`;
	if (result.code === "activation-required") return `微信通知发送失败：会话可能已过期或尚未激活。请先给 ClawBot 发一条消息激活，然后重试。原始错误：${result.detail}`;
	return `微信通知发送失败：${result.detail}`;
}
/** 连接层错误转成可读文本；非 WechatConnectionError 返回 undefined 由调用方兜底。 */
function connectionText(error) {
	if (!(error instanceof WechatConnectionError)) return void 0;
	if (error.code === "UNSUPPORTED") return UNSUPPORTED_TEXT;
	return `微信连接操作失败（${error.code}）：${error.message}`;
}
/** 构造三个微信工具定义（纯函数，便于测试）。 */
function createWechatTools(env) {
	return [
		defineTool({
			name: "wechat_notify",
			description: "通过微信给用户发一条通知，复用本机 ClawBot 微信通道（内置适配器或独立 dsh-wechat-notify 插件）。通知只发不拉取消息。",
			parameters: { message: {
				type: "string",
				required: true,
				description: "通知正文（支持中文）"
			} },
			output: {
				schema: { type: "string" },
				render: (_args, value) => [{
					type: "text",
					text: value
				}]
			},
			async execute(args) {
				if (env.notify === void 0) return UNCONFIGURED_TEXT;
				return notifyText(await env.notify.send(args.message), args.message);
			}
		}),
		defineTool({
			name: "wechat_login",
			description: "获取微信登录会话和二维码，返回 sessionId 与二维码；用户扫码后调用 wechat_login_confirm 完成登录。",
			parameters: {},
			output: {
				schema: { type: "string" },
				render: (_args, value) => [{
					type: "text",
					text: value
				}]
			},
			async execute() {
				if (env.connection === void 0) return UNCONFIGURED_TEXT;
				try {
					const start = await env.connection.login();
					const payload = start.login.qrPayload;
					const qr = payload.startsWith("data:") ? payload.length < 4e3 ? `二维码 data URL：${payload}` : "二维码已生成（data URL 较长，建议直接内嵌展示）。" : `二维码链接：${payload}`;
					return `微信登录二维码已生成，请在约 ${Math.max(1, Math.round((start.login.expiresAt - Date.now()) / 6e4))} 分钟内完成扫码。\nsessionId：${start.login.sessionId}\n${qr}\n\n请先用微信打开链接并扫码，然后调用 wechat_login_confirm 完成登录。`;
				} catch (error) {
					return connectionText(error) ?? `获取微信登录二维码失败：${String(error)}`;
				}
			}
		}),
		defineTool({
			name: "wechat_login_confirm",
			description: "确认微信扫码登录是否完成；用户扫码后调用本工具保存登录凭据。",
			parameters: { sessionId: {
				type: "string",
				required: true,
				description: "wechat_login 返回的登录会话标识"
			} },
			output: {
				schema: { type: "string" },
				render: (_args, value) => [{
					type: "text",
					text: value
				}]
			},
			async execute(args) {
				if (env.connection === void 0) return UNCONFIGURED_TEXT;
				try {
					switch ((await env.connection.confirmLogin(args.sessionId)).result) {
						case "confirmed": return "登录成功！微信通道已连接，现在可以用 wechat_notify 发送通知了。";
						case "scanned": return "已扫码，请在手机上确认登录，然后再次调用 wechat_login_confirm。";
						case "expired": return "二维码已过期。请重新调用 wechat_login 获取新二维码。";
						default: return "尚未检测到扫码。请先用微信打开二维码链接并扫码，然后再次调用 wechat_login_confirm。";
					}
				} catch (error) {
					if (error instanceof WechatConnectionError && error.code === "LOGIN_SESSION_NOT_FOUND") return "登录会话不存在或已失效。请先调用 wechat_login 获取新的二维码。";
					return connectionText(error) ?? `确认登录失败：${String(error)}`;
				}
			}
		})
	];
}
/**
* 宿主提供 tools 服务时惰性注册三个微信工具；tools 缺失时回调不触发，插件照常启动。
* 在 apply() 中于 installBundledWechat() 之后调用，保证 wechatNotify/wechatConnection 已提供。
*/
function registerWechatTools(ctx) {
	ctx.inject(["tools"], (toolsCtx) => {
		const registry = toolsCtx.tools;
		if (registry === void 0 || typeof registry.register !== "function") return;
		const env = {
			notify: ctx.get("wechatNotify", false),
			connection: ctx.get("wechatConnection", false)
		};
		for (const tool of createWechatTools(env)) registry.register(tool);
	});
}
//#endregion
//#region plugins/dsh-token-monitor/src/wechat.ts
function adaptSendResult(result) {
	if (result.ok) return {
		ok: true,
		message: "微信通知已发送"
	};
	return {
		ok: false,
		code: result.code,
		message: result.detail
	};
}
/** Compatibility facade backed exclusively by the bundled WeChat services. */
function createTokenMonitorWechatProvider(ctx) {
	return {
		id: "wechat",
		source: "bundled",
		apiVersion: "1",
		capabilities: {
			send: true,
			status: true,
			login: true,
			reconnect: true,
			disconnect: true
		},
		async send(message) {
			return adaptSendResult(await ctx.wechatNotify.send(message));
		},
		status: () => ctx.wechatConnection.status(),
		login: () => ctx.wechatConnection.login(),
		confirmLogin: (sessionId) => ctx.wechatConnection.confirmLogin(sessionId),
		reconnect: () => ctx.wechatConnection.reconnect(),
		disconnect: (confirm) => ctx.wechatConnection.disconnect(confirm)
	};
}
/** Register the legacy token-monitor capability without creating another sender. */
function provideTokenMonitorWechat(ctx) {
	const existing = ctx.get("tokenMonitorWechat", false);
	if (existing?.apiVersion === "1" && typeof existing.getProvider === "function") return existing;
	const provider = createTokenMonitorWechatProvider(ctx);
	const service = {
		apiVersion: "1",
		getProvider: () => provider
	};
	ctx.provide("tokenMonitorWechat", service);
	return service;
}
//#endregion
//#region plugins/dsh-token-monitor/src/pricing.ts
/** 2026-08-23 生效规则：工作日峰谷分段，周末全天低谷价（单位：元 / 百万 tokens）。 */
const PRICE_TABLE = {
	version: "2026-08-23",
	peakHours: [[9, 12], [14, 18]],
	models: {
		"deepseek-v4-flash-vision-exp": {
			offPeak: {
				input: 1.5,
				cacheHit: .05,
				output: 4.5
			},
			peak: {
				input: 3,
				cacheHit: .1,
				output: 9
			}
		},
		"deepseek-v4-flash": {
			offPeak: {
				input: 1.5,
				cacheHit: .05,
				output: 4.5
			},
			peak: {
				input: 3,
				cacheHit: .1,
				output: 9
			}
		},
		"deepseek-v4-pro": {
			offPeak: {
				input: 4.5,
				cacheHit: .15,
				output: 13.5
			},
			peak: {
				input: 9,
				cacheHit: .3,
				output: 27
			}
		}
	}
};
/**
* 2026-08-17 00:00（北京时间）前的旧价格：统一价，无峰谷。
* 峰值/谷值填同一组价格 + 空 peakHours，使 `isPeakHour` 恒为假、始终按 offPeak 计价。
*/
const LEGACY_PRICE_TABLE = {
	version: "legacy-before-2026-08-17",
	peakHours: [],
	models: {
		"deepseek-v4-flash-vision-exp": {
			offPeak: {
				input: 1,
				cacheHit: .02,
				output: 2
			},
			peak: {
				input: 1,
				cacheHit: .02,
				output: 2
			}
		},
		"deepseek-v4-flash": {
			offPeak: {
				input: 1,
				cacheHit: .02,
				output: 2
			},
			peak: {
				input: 1,
				cacheHit: .02,
				output: 2
			}
		},
		"deepseek-v4-pro": {
			offPeak: {
				input: 3,
				cacheHit: .025,
				output: 6
			},
			peak: {
				input: 3,
				cacheHit: .025,
				output: 6
			}
		}
	}
};
/**
* 峰谷新价格生效时刻：2026-08-17 00:00 北京时间 = 2026-08-16 16:00 UTC。
* 此前的调用按旧统一价计价，此后按峰谷价计价。
*/
const PEAK_PRICING_START = Date.UTC(2026, 7, 16, 16, 0, 0);
/** 按时间戳选择价格表：8-17 前用旧统一价，之后用（可配置的）峰谷价。 */
function selectPriceTable(ts, table = PRICE_TABLE) {
	return ts < PEAK_PRICING_START ? LEGACY_PRICE_TABLE : table;
}
/** DSH 内 DeepSeek 官方供应商的稳定 ID；只有该供应商具备计费资格。 */
const OFFICIAL_PROVIDER_ID = "deepseek-official";
/** 取时间戳对应的北京时间小时（0-23）；解析失败返回 -1。 */
function beijingHour(ts) {
	const hour = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Asia/Shanghai",
		hour: "2-digit",
		hour12: false
	}).formatToParts(new Date(ts)).find((p) => p.type === "hour")?.value;
	return hour === void 0 ? -1 : Number(hour);
}
/** 取时间戳对应的北京时间星期（0=周日，6=周六）；解析失败返回 -1。 */
function beijingWeekday(ts) {
	const weekday = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Asia/Shanghai",
		weekday: "short"
	}).formatToParts(new Date(ts)).find((p) => p.type === "weekday")?.value;
	return weekday === void 0 ? -1 : [
		"Sun",
		"Mon",
		"Tue",
		"Wed",
		"Thu",
		"Fri",
		"Sat"
	].indexOf(weekday);
}
/** 工作日按原峰谷时段判断；周六、周日始终返回低谷。 */
function isPeakHour(ts, peakHours) {
	const weekday = beijingWeekday(ts);
	if (weekday === 0 || weekday === 6) return false;
	const hour = beijingHour(ts);
	return peakHours.some(([start, end]) => hour >= start && hour < end);
}
/**
* 计费资格统一入口：必须同时来自 DeepSeek 官方供应商并明确命中价格表。
* 允许已登记模型的版本后缀按最长前缀匹配；未知模型不再按 Flash 猜价。
*/
function resolvePricingEligibility(provider, model, ts, table = PRICE_TABLE) {
	if (provider !== "deepseek-official" || typeof model !== "string") return void 0;
	const active = selectPriceTable(ts, table);
	const matched = Object.entries(active.models).sort(([a], [b]) => b.length - a.length).find(([name]) => model === name || model.startsWith(`${name}-`));
	if (matched === void 0) return void 0;
	return {
		provider: OFFICIAL_PROVIDER_ID,
		model,
		matchedModel: matched[0],
		price: matched[1]
	};
}
/**
* 按 (token 数, provider, 模型, 时间戳) 计算一次调用的费用。
* 缓存命中（cacheReadTokens）按 cacheHit 价；缓存写入（cacheWriteTokens）并入缓存未命中价。
* 未通过 provider + model 资格门禁时返回 undefined，调用方不得记录或展示费用。
*/
function priceUsage(inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, provider, model, ts, table = PRICE_TABLE) {
	if (![
		inputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		outputTokens
	].every((value) => Number.isSafeInteger(value) && value >= 0)) return void 0;
	if (!Number.isSafeInteger(ts) || ts < 0) return void 0;
	const active = selectPriceTable(ts, table);
	const eligibility = resolvePricingEligibility(provider, model, ts, table);
	if (eligibility === void 0) return void 0;
	const peak = isPeakHour(ts, active.peakHours);
	const rate = peak ? eligibility.price.peak : eligibility.price.offPeak;
	const costInput = inputTokens / 1e6 * rate.input;
	const costCacheRead = cacheReadTokens / 1e6 * rate.cacheHit;
	const costCacheWrite = cacheWriteTokens / 1e6 * rate.input;
	const costCache = costCacheRead + costCacheWrite;
	const costOutput = outputTokens / 1e6 * rate.output;
	if (![
		costInput,
		costCacheRead,
		costCacheWrite,
		costCache,
		costOutput
	].every((value) => Number.isFinite(value) && value >= 0)) return void 0;
	const cost = costInput + costCache + costOutput;
	if (!Number.isFinite(cost) || cost < 0) return void 0;
	return {
		costInput,
		costCache,
		costCacheRead,
		costCacheWrite,
		costOutput,
		cost,
		peak
	};
}
//#endregion
//#region plugins/dsh-token-monitor/src/charge.ts
/** 环形缓冲区上限：保留最近 500 次扣费，避免长期运行无限增长。 */
const MAX_EVENTS = 500;
const events = [];
const seenSourceEvents = /* @__PURE__ */ new Set();
const seenSourceEventOrder = [];
let seqCounter = 0;
const streamId = randomUUID();
function sourceEventKey(sourceEvent) {
	return JSON.stringify([sourceEvent.sessionId, sourceEvent.seq]);
}
/** 记录一次扣费（cost 为正数金额）。 */
function recordCharge(cost, timestamp, damageKind, breakdown, sourceEvent) {
	const identity = sourceEvent?.sourceEventSeq === void 0 ? void 0 : {
		sessionId: sourceEvent.sessionId,
		seq: sourceEvent.sourceEventSeq
	};
	if (identity !== void 0) {
		const key = sourceEventKey(identity);
		if (seenSourceEvents.has(key)) return;
		seenSourceEvents.add(key);
		seenSourceEventOrder.push(key);
		if (seenSourceEventOrder.length > 2e3) {
			const expired = seenSourceEventOrder.shift();
			if (expired !== void 0) seenSourceEvents.delete(expired);
		}
	}
	events.push({
		seq: ++seqCounter,
		cost,
		timestamp,
		damageKind,
		...identity === void 0 ? {} : { sourceEvent: identity },
		...breakdown === void 0 ? {} : { breakdown }
	});
	if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}
/** 返回 seq 严格大于 since 的扣费事件（按 seq 升序）。 */
function chargesSince(since) {
	if (since >= seqCounter) return [];
	return events.filter((event) => event.seq > since);
}
function chargeBatchSince(since) {
	const firstSeq = events[0]?.seq ?? seqCounter + 1;
	return {
		streamId,
		seq: seqCounter,
		firstSeq,
		dropped: events.length > 0 && since < firstSeq - 1,
		events: chargesSince(since)
	};
}
//#endregion
//#region plugins/dsh-token-monitor/src/types.ts
/**
* Normalize durable usage rows written before cache read/write costs were split.
* @param value Parsed JSONL value from durable history.
* @returns A normalized candidate for strict validation, or undefined for non-object input.
*/
function normalizeUsageRecord(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const candidate = value;
	const normalized = { ...candidate };
	if (!Object.prototype.hasOwnProperty.call(candidate, "costCacheRead")) normalized.costCacheRead = candidate.costCache;
	if (!Object.prototype.hasOwnProperty.call(candidate, "costCacheWrite")) normalized.costCacheWrite = 0;
	return normalized;
}
function isValidUsageRecord(record) {
	if (typeof record !== "object" || record === null) return false;
	if (![
		record.sessionId,
		record.provider,
		record.model
	].every((value) => typeof value === "string" && value.trim() !== "")) return false;
	for (const value of [
		record.turn,
		record.step,
		record.timestamp,
		record.inputTokens,
		record.cacheReadTokens,
		record.cacheWriteTokens,
		record.outputTokens,
		record.reasoningTokens
	]) if (!Number.isSafeInteger(value) || value < 0) return false;
	if (record.sourceEventSeq !== void 0 && (!Number.isSafeInteger(record.sourceEventSeq) || record.sourceEventSeq < 0)) return false;
	for (const value of [
		record.costInput,
		record.costCache,
		record.costCacheRead,
		record.costCacheWrite,
		record.costOutput,
		record.cost
	]) if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
	if (typeof record.peak !== "boolean") return false;
	const cacheTotal = record.costCacheRead + record.costCacheWrite;
	const componentTotal = record.costInput + cacheTotal + record.costOutput;
	const tolerance = Math.max(1e-12, record.cost * 1e-9);
	return Number.isFinite(componentTotal) && Math.abs(record.costCache - cacheTotal) <= tolerance && Math.abs(record.cost - componentTotal) <= tolerance;
}
//#endregion
//#region plugins/dsh-token-monitor/src/collector.ts
/** 把一条 assistant/message 的 usage 转成 UsageRecord。 */
function buildRecord(sessionId, turn, step, sourceEventSeq, timestamp, provider, model, usage, priceTable) {
	const inputTokens = usage.inputTokens;
	const cacheReadTokens = usage.cacheReadTokens ?? 0;
	const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
	const outputTokens = usage.outputTokens;
	const breakdown = priceUsage(inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, provider, model, timestamp, priceTable);
	if (breakdown === void 0) return void 0;
	if (breakdown.cost <= 0) return void 0;
	const record = {
		sessionId,
		turn,
		step,
		sourceEventSeq,
		timestamp,
		provider,
		model,
		inputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		outputTokens,
		reasoningTokens: usage.reasoningTokens ?? 0,
		costInput: breakdown.costInput,
		costCache: breakdown.costCache,
		costCacheRead: breakdown.costCacheRead,
		costCacheWrite: breakdown.costCacheWrite,
		costOutput: breakdown.costOutput,
		cost: breakdown.cost,
		peak: breakdown.peak
	};
	return isValidUsageRecord(record) ? record : void 0;
}
function attachCollector(ctx, storage, priceTable, options = {}) {
	ctx.on("session/event", (session, event) => {
		if (event.type !== "assistant/message") return;
		const usage = event.data.usage;
		if (usage === void 0) return;
		const source = event.data.message.source;
		if (source.kind !== "model") return;
		const record = buildRecord(session.id, event.data.turn, event.data.step, event.seq, event.time, source.provider, source.model, usage, priceTable);
		if (record === void 0) return;
		if (storage.add(record) === void 0) return;
		const damageKind = record.inputTokens > 0 || record.cacheWriteTokens > 0 ? "miss" : "normal";
		recordCharge(record.cost, record.timestamp, damageKind, {
			cacheHit: {
				tokens: record.cacheReadTokens,
				cost: record.costCacheRead
			},
			cacheMiss: {
				tokens: record.inputTokens + record.cacheWriteTokens,
				cost: record.costInput + record.costCacheWrite
			},
			output: {
				tokens: record.outputTokens,
				cost: record.costOutput
			}
		}, {
			sessionId: record.sessionId,
			sourceEventSeq: record.sourceEventSeq
		});
		options.onPersistedRecord?.(record, damageKind);
		session.append("token-usage/record", { record });
	});
}
//#endregion
//#region plugins/dsh-token-monitor/src/cache-hit-anomaly.ts
function formatCacheHitAnomalyMessage(payload) {
	return [
		"【dsh-damage-pulse · 缓存小警报】",
		"",
		"鲸鱼娘发现缓存命中率有点低啦 (｡•́︿•̀｡)",
		"",
		`最近 ${String(payload.sampleCount)} 次合格调用的聚合命中率约为 ${(payload.observedRate * 100).toFixed(1)}%，低于设定阈值 ${(payload.threshold * 100).toFixed(0)}%。`,
		"",
		"建议检查一下最近调用的缓存复用情况哦～",
		"我会继续帮你认真盯着！"
	].join("\n");
}
/**
* Runtime-only detector for low cache hit rate. It deliberately has no disk
* state: a Host restart starts a fresh episode and never backfills alerts.
*/
function createCacheHitAnomalyDetector(readSettings) {
	let samples = [];
	let episodeLatched = false;
	let episodeId = 0;
	let settingsFingerprint = "";
	const reset = () => {
		samples = [];
		episodeLatched = false;
	};
	const observe = (record) => {
		const settings = readSettings();
		const fingerprint = `${String(settings.enabled)}:${String(settings.thresholdPercent)}:${String(settings.consecutiveCalls)}`;
		if (fingerprint !== settingsFingerprint) {
			settingsFingerprint = fingerprint;
			reset();
		}
		if (!settings.enabled) {
			reset();
			return;
		}
		if (!Number.isSafeInteger(settings.consecutiveCalls) || settings.consecutiveCalls < 2) {
			reset();
			return;
		}
		if (!Number.isSafeInteger(record.timestamp) || record.timestamp < 0) return void 0;
		if (!Number.isFinite(record.inputTokens) || !Number.isFinite(record.cacheReadTokens) || record.inputTokens < 0 || record.cacheReadTokens < 0) return void 0;
		const denominator = record.inputTokens + record.cacheReadTokens;
		if (!Number.isFinite(denominator) || denominator <= 0) return void 0;
		samples.push({
			inputTokens: record.inputTokens,
			cacheReadTokens: record.cacheReadTokens,
			observedAt: record.timestamp
		});
		if (samples.length > settings.consecutiveCalls) samples = samples.slice(-settings.consecutiveCalls);
		if (samples.length < settings.consecutiveCalls) return void 0;
		const inputTokens = samples.reduce((sum, sample) => sum + sample.inputTokens, 0);
		const cacheReadTokens = samples.reduce((sum, sample) => sum + sample.cacheReadTokens, 0);
		const total = inputTokens + cacheReadTokens;
		if (total <= 0) return void 0;
		const observedRate = cacheReadTokens / total;
		const threshold = Math.max(0, Math.min(100, settings.thresholdPercent)) / 100;
		if (observedRate >= threshold) {
			episodeLatched = false;
			return;
		}
		if (episodeLatched) return void 0;
		episodeLatched = true;
		episodeId += 1;
		return {
			episodeId,
			observedRate,
			threshold,
			sampleCount: samples.length,
			consecutiveCalls: settings.consecutiveCalls,
			observedAt: samples[samples.length - 1].observedAt
		};
	};
	return {
		observe,
		reset
	};
}
//#endregion
//#region plugins/dsh-token-monitor/src/balance-selection.ts
function parseAmount(value, field) {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`balance response has invalid ${field}`);
	const amount = Number(value);
	if (!Number.isFinite(amount)) throw new Error(`balance response has invalid ${field}`);
	return amount;
}
function parseEntry(info) {
	const currency = info.currency?.trim().toUpperCase();
	if (currency === void 0 || currency.length === 0) throw new Error("balance response has invalid currency");
	return {
		currency,
		totalBalance: parseAmount(info.total_balance, "total_balance"),
		grantedBalance: parseAmount(info.granted_balance, "granted_balance"),
		toppedUpBalance: parseAmount(info.topped_up_balance, "topped_up_balance")
	};
}
/** Select a funded balance deterministically when the API returns currencies in arbitrary order. */
function selectBalanceInfo(response) {
	const entries = [];
	for (const info of response.balance_infos ?? []) try {
		entries.push(parseEntry(info));
	} catch {}
	if (entries.length === 0) throw new Error("balance response has no valid balance_infos");
	entries.sort((left, right) => {
		const funded = Number(right.totalBalance > 0) - Number(left.totalBalance > 0);
		if (funded !== 0) return funded;
		const preferredCurrency = Number(right.currency === "CNY") - Number(left.currency === "CNY");
		if (preferredCurrency !== 0) return preferredCurrency;
		const total = right.totalBalance - left.totalBalance;
		if (total !== 0) return total;
		return left.currency.localeCompare(right.currency);
	});
	return entries[0];
}
//#endregion
//#region plugins/dsh-token-monitor/src/balance.ts
const DEEPSEEK_API_KEY = credentialRef("DEEPSEEK_API_KEY");
const BALANCE_URL = "https://api.deepseek.com/user/balance";
/** DeepSeek /user/balance 原始响应（金额字段为字符串）。 */
/** 从 ctx.credentials 解析 DeepSeek API key（每操作重新解析，遵循凭据热更新约定）。 */
async function resolveApiKey(ctx) {
	return (await ctx.credentials.resolve(DEEPSEEK_API_KEY))?.value;
}
/** 查询一次 DeepSeek 账户余额。 */
async function fetchBalance(apiKey) {
	const res = await fetch(BALANCE_URL, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			Accept: "application/json"
		},
		signal: AbortSignal.timeout(1e4)
	});
	if (!res.ok) throw new Error(`balance HTTP ${res.status}`);
	const json = await res.json();
	return {
		...selectBalanceInfo(json),
		isAvailable: json.is_available !== false,
		updatedAt: Date.now()
	};
}
/** 余额服务：定时轮询 + 缓存最新值。 */
var BalanceService = class {
	ctx;
	pollMs;
	latest;
	timer;
	warnedMissingKey = false;
	lastLoggedTotal;
	constructor(ctx, pollMs = 6e4) {
		this.ctx = ctx;
		this.pollMs = pollMs;
	}
	/** 查询并缓存最新余额；失败只告警不抛。 */
	async refresh() {
		try {
			const apiKey = await resolveApiKey(this.ctx);
			if (apiKey === void 0) {
				if (!this.warnedMissingKey) {
					console.warn("[dsh-token-monitor] 未配置 DEEPSEEK_API_KEY，余额卡片将显示未配置态");
					this.warnedMissingKey = true;
				}
				return;
			}
			const next = await fetchBalance(apiKey);
			this.latest = next;
			if (this.lastLoggedTotal !== next.totalBalance) {
				this.lastLoggedTotal = next.totalBalance;
				console.log(`[dsh-token-monitor] 余额 ${next.currency} ${next.totalBalance.toFixed(2)} (赠送 ${next.grantedBalance.toFixed(2)} / 充值 ${next.toppedUpBalance.toFixed(2)})`);
			}
			return next;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`[dsh-token-monitor] 余额查询失败: ${message}`);
			return;
		}
	}
	get() {
		return this.latest;
	}
	/** 启动轮询：立即查一次，之后每 pollMs 一次。 */
	start() {
		this.refresh();
		this.timer = setInterval(() => void this.refresh(), this.pollMs);
	}
	stop() {
		if (this.timer !== void 0) {
			clearInterval(this.timer);
			this.timer = void 0;
		}
	}
};
/** 挂载余额服务：启动轮询，fiber dispose 时清理定时器。 */
function attachBalance(ctx) {
	const service = new BalanceService(ctx);
	ctx.effect(() => {
		service.start();
		return () => service.stop();
	}, "dsh-token-monitor balance polling");
	return service;
}
/** 注册余额 HTTP 端点（仅 web 装配有 webServer 服务）：Client 余额卡片定时拉取。 */
function registerBalanceRoute(ctx, service) {
	ctx.webServer.register({
		kind: "exact",
		path: "/api/token-monitor/balance",
		handler: (_req, res) => {
			const balance = service.get();
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Cache-Control": "no-store"
			});
			res.end(JSON.stringify(balance ?? null));
		}
	});
}
//#endregion
//#region plugins/dsh-token-monitor/src/budget.ts
/** Derive the display value without clamping: an over-budget remainder stays negative. */
function dailyBudgetInfo(today, budget) {
	const remaining = budget - today.cost;
	return {
		date: today.date,
		timeZone: today.timeZone,
		currency: today.currency,
		budget,
		spend: today.cost,
		remaining,
		exceeded: remaining < 0,
		updatedAt: today.updatedAt
	};
}
/** Pure crossing rule used by both live delivery and replay-oriented tests. */
function crossedDailyBudget(previousSpend, currentSpend, budget) {
	return previousSpend < budget && currentSpend >= budget;
}
/**
* Tracks one current Beijing day. Cold-start state is seeded from authoritative
* usage, so replay/restart never re-sends an already crossed threshold.
*/
var DailyBudgetThresholdTracker = class {
	date;
	spend;
	notified;
	budget;
	enabled;
	constructor(initial, budget, enabled = true) {
		this.date = initial.date;
		this.spend = initial.cost;
		this.budget = budget;
		this.enabled = enabled;
		this.notified = initial.cost >= budget;
	}
	observe(current, budget = this.budget, enabled = this.enabled) {
		if (current.date !== this.date) {
			this.date = current.date;
			this.spend = 0;
			this.notified = false;
		}
		const previousSpend = this.spend;
		if (budget !== this.budget || enabled !== this.enabled) {
			this.budget = budget;
			this.enabled = enabled;
			this.notified = previousSpend >= budget;
		}
		this.spend = Math.max(this.spend, current.cost);
		if (!this.enabled || this.notified || !crossedDailyBudget(previousSpend, this.spend, this.budget)) return void 0;
		this.notified = true;
		return {
			date: current.date,
			budget: this.budget,
			previousSpend,
			currentSpend: this.spend,
			remaining: this.budget - this.spend
		};
	}
};
const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
	timeZone: "Asia/Shanghai",
	year: "numeric",
	month: "2-digit",
	day: "2-digit"
});
/** 返回指定时间戳对应的北京时间自然日键。 */
function beijingDateKey(timestamp) {
	const parts = DATE_FORMATTER.formatToParts(new Date(timestamp));
	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return values.year + "-" + values.month + "-" + values.day;
}
//#endregion
//#region plugins/dsh-token-monitor/src/budget-notify.ts
function formatBudgetThresholdMessage(event) {
	return [
		"【dsh-damage-pulse · 今日预算】",
		"",
		`今天（${event.date}）已经花费 CNY ${event.currentSpend.toFixed(2)}，刚刚越过 CNY ${event.budget.toFixed(2)} 的预算线啦 (｡•́︿•̀｡)`,
		"",
		`当前剩余预算：CNY ${event.remaining.toFixed(2)}`,
		"",
		"别担心～鲸鱼娘只负责提醒，不会阻止或取消任何请求。"
	].join("\n");
}
/**
* Observe the collector's post-persistence token-usage event. Delivery is
* intentionally detached and fail-soft: sender failures never escape into
* session event handling, usage persistence, charge animation, or UI reads.
*/
function attachBudgetThresholdNotifications(ctx, storage, getSettings, sender, options = {}) {
	const now = options.now ?? (() => Date.now());
	const warn = options.warn ?? ((message) => console.warn(message));
	const initialSettings = getSettings();
	const tracker = new DailyBudgetThresholdTracker(storage.todaySpend(), initialSettings.dailyBudgetCny, initialSettings.dailyBudgetEnabled);
	ctx.on("session/event", (_session, event) => {
		if (event.type !== "token-usage/record") return;
		const observedAt = now();
		const timestamp = event.data.record.timestamp;
		if (!Number.isFinite(timestamp) || timestamp > observedAt) return;
		const current = storage.todaySpend(observedAt);
		if (current.date !== beijingDateKey(timestamp)) return;
		const settings = getSettings();
		const crossing = tracker.observe(current, settings.dailyBudgetCny, settings.dailyBudgetEnabled);
		if (crossing === void 0) return;
		if (!settings.budgetExceededNotificationEnabled) return;
		options.onCrossing?.(crossing, observedAt);
		Promise.resolve(sender.send(formatBudgetThresholdMessage(crossing))).then((result) => {
			if (!result.ok) warn(`[dsh-token-monitor] 微信预算提醒发送失败（不影响计费/UI）: ${result.detail}`);
		}, (error) => {
			warn(`[dsh-token-monitor] 微信预算提醒异常（不影响计费/UI）: ${String(error)}`);
		});
	});
}
//#endregion
//#region plugins/dsh-token-monitor/src/budget-routes.ts
/** Publish only the current configured allowlist; the Client never embeds pricing model names. */
function pricingEligibilityInfo(table, now = Date.now()) {
	return {
		provider: OFFICIAL_PROVIDER_ID,
		models: Object.keys(table.models),
		updatedAt: now
	};
}
/** Register additive M2 read endpoints without changing request admission or cancellation paths. */
function registerBudgetRoutes(ctx, storage, getBudget, table) {
	ctx.webServer.register({
		kind: "exact",
		path: "/api/token-monitor/daily-budget",
		handler: (_req, res) => {
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Cache-Control": "no-store"
			});
			res.end(JSON.stringify(dailyBudgetInfo(storage.todaySpend(), getBudget())));
		}
	});
	ctx.webServer.register({
		kind: "exact",
		path: "/api/token-monitor/pricing-eligibility",
		handler: (_req, res) => {
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Cache-Control": "no-store"
			});
			res.end(JSON.stringify(pricingEligibilityInfo(table)));
		}
	});
}
//#endregion
//#region plugins/dsh-token-monitor/src/charge-route.ts
const TOKEN_MONITOR_CHARGE_EVENTS_PATH = "/api/token-monitor/charge-events";
function writeJson$1(res, status, body, headers = {}) {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
		...headers
	});
	res.end(JSON.stringify(body));
}
function parseSince$1(request) {
	const value = new URL(request.url ?? "/api/token-monitor/charge-events", "http://localhost").searchParams.get("since");
	if (value === null) return 0;
	if (!/^(0|[1-9]\d*)$/.test(value)) return void 0;
	const since = Number(value);
	return Number.isSafeInteger(since) ? since : void 0;
}
function createChargeEventsRouteHandler(batch = chargeBatchSince) {
	return (request, response) => {
		const method = request.method ?? "GET";
		if (method !== "GET" && method !== "HEAD") {
			writeJson$1(response, 405, { error: {
				code: "METHOD_NOT_ALLOWED",
				message: "Only GET and HEAD are supported"
			} }, { Allow: "GET, HEAD" });
			return;
		}
		const since = parseSince$1(request);
		if (since === void 0) {
			writeJson$1(response, 400, { error: {
				code: "INVALID_SINCE",
				message: "since must be a non-negative safe integer"
			} });
			return;
		}
		const value = batch(since);
		response.writeHead(200, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store"
		});
		response.end(method === "HEAD" ? void 0 : JSON.stringify(value));
	};
}
function registerChargeEventsRoute(ctx) {
	ctx.webServer.register({
		kind: "exact",
		path: TOKEN_MONITOR_CHARGE_EVENTS_PATH,
		handler: createChargeEventsRouteHandler()
	});
}
function assertNonEmptyString(value, name) {
	if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}
function assertFiniteNumber(value, name) {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}
function assertNonNegativeSafeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
}
function stableNotificationKey(kind, identity) {
	return `token-monitor-notification:v1:${kind}:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}
function draft(kind, timestamp, priority, payload, identity) {
	const dedupeKey = stableNotificationKey(kind, identity);
	return {
		schemaVersion: 1,
		id: dedupeKey,
		dedupeKey,
		kind,
		timestamp,
		priority,
		payload
	};
}
function createBudgetThresholdNotification(crossing, timestamp) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(crossing.date)) throw new TypeError("crossing.date must be YYYY-MM-DD");
	assertNonNegativeSafeInteger(timestamp, "timestamp");
	for (const [name, value] of Object.entries({
		budget: crossing.budget,
		previousSpend: crossing.previousSpend,
		currentSpend: crossing.currentSpend,
		remaining: crossing.remaining
	})) assertFiniteNumber(value, `crossing.${name}`);
	if (crossing.budget <= 0) throw new RangeError("crossing.budget must be positive");
	if (crossing.previousSpend < 0 || crossing.currentSpend < 0) throw new RangeError("crossing spend values must be non-negative");
	if (!(crossing.previousSpend < crossing.budget && crossing.currentSpend >= crossing.budget)) throw new RangeError("crossing must cross the configured budget");
	const budgetCents = Math.round(crossing.budget * 100);
	if (!Number.isSafeInteger(budgetCents)) throw new RangeError("crossing.budget is outside the supported range");
	return draft("budget-threshold", timestamp, "high", { ...crossing }, [crossing.date, budgetCents]);
}
function createPeakTransitionNotification(transition) {
	assertNonNegativeSafeInteger(transition.observedAt, "transition.observedAt");
	assertNonEmptyString(transition.key, "transition.key");
	if (transition.from === transition.to) throw new RangeError("transition must change period");
	const kind = transition.to === "peak" ? "peak-enter" : "peak-exit";
	const payload = {
		from: transition.from,
		to: transition.to,
		periodKey: transition.key
	};
	return draft(kind, transition.observedAt, "normal", payload, [transition.key]);
}
function createCacheHitAnomalyNotification(payload) {
	assertNonNegativeSafeInteger(payload.episodeId, "cache anomaly episodeId");
	assertFiniteNumber(payload.observedRate, "cache anomaly observedRate");
	assertFiniteNumber(payload.threshold, "cache anomaly threshold");
	assertNonNegativeSafeInteger(payload.sampleCount, "cache anomaly sampleCount");
	assertNonNegativeSafeInteger(payload.consecutiveCalls, "cache anomaly consecutiveCalls");
	assertNonNegativeSafeInteger(payload.observedAt, "cache anomaly observedAt");
	if (payload.observedRate < 0 || payload.observedRate > 1 || payload.threshold < 0 || payload.threshold > 1) throw new RangeError("cache anomaly rates must be within 0..1");
	if (payload.episodeId < 1 || payload.sampleCount < 2 || payload.consecutiveCalls < 2) throw new RangeError("cache anomaly counters are invalid");
	return draft("cache-hit-anomaly", payload.observedAt, "normal", payload, [payload.episodeId]);
}
function validateEvent(event) {
	if (typeof event !== "object" || event === null) throw new TypeError("notification event must be an object");
	const candidate = event;
	if (candidate.schemaVersion !== 1) throw new TypeError("notification event schemaVersion is unsupported");
	assertNonNegativeSafeInteger(candidate.seq, "notification event seq");
	if (candidate.seq === 0) throw new RangeError("notification event seq must be positive");
	assertNonEmptyString(candidate.id, "notification event id");
	assertNonEmptyString(candidate.dedupeKey, "notification event dedupeKey");
	if (candidate.id !== candidate.dedupeKey) throw new TypeError("notification event id must equal dedupeKey");
	assertNonNegativeSafeInteger(candidate.timestamp, "notification event timestamp");
	if (candidate.priority !== "normal" && candidate.priority !== "high") throw new TypeError("notification event priority is invalid");
	if (![
		"charge",
		"budget-threshold",
		"peak-enter",
		"peak-exit",
		"cache-hit-anomaly"
	].includes(String(candidate.kind))) throw new TypeError("notification event kind is invalid");
	if (typeof candidate.payload !== "object" || candidate.payload === null) throw new TypeError("notification event payload must be an object");
	const payload = candidate.payload;
	if (candidate.kind === "charge") {
		assertFiniteNumber(payload.cost, "charge payload cost");
		if (payload.cost <= 0) throw new RangeError("charge payload cost must be positive");
		if (payload.damageKind !== "normal" && payload.damageKind !== "miss") throw new TypeError("charge payload damageKind is invalid");
		assertNonEmptyString(payload.sessionId, "charge payload sessionId");
		assertNonNegativeSafeInteger(payload.turn, "charge payload turn");
		assertNonNegativeSafeInteger(payload.step, "charge payload step");
		assertNonEmptyString(payload.provider, "charge payload provider");
		assertNonEmptyString(payload.model, "charge payload model");
		return;
	}
	if (candidate.kind === "budget-threshold") {
		if (typeof payload.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) throw new TypeError("budget payload date must be YYYY-MM-DD");
		assertFiniteNumber(payload.budget, "budget payload budget");
		assertFiniteNumber(payload.previousSpend, "budget payload previousSpend");
		assertFiniteNumber(payload.currentSpend, "budget payload currentSpend");
		assertFiniteNumber(payload.remaining, "budget payload remaining");
		return;
	}
	if (candidate.kind === "cache-hit-anomaly") {
		assertNonNegativeSafeInteger(payload.episodeId, "cache anomaly episodeId");
		assertFiniteNumber(payload.observedRate, "cache anomaly observedRate");
		assertFiniteNumber(payload.threshold, "cache anomaly threshold");
		assertNonNegativeSafeInteger(payload.sampleCount, "cache anomaly sampleCount");
		assertNonNegativeSafeInteger(payload.consecutiveCalls, "cache anomaly consecutiveCalls");
		assertNonNegativeSafeInteger(payload.observedAt, "cache anomaly observedAt");
		if (payload.observedRate < 0 || payload.observedRate > 1 || payload.threshold < 0 || payload.threshold > 1) throw new RangeError("cache anomaly rates must be within 0..1");
		if (payload.sampleCount < 2 || payload.consecutiveCalls < 2 || payload.episodeId < 1) throw new RangeError("cache anomaly counters are invalid");
		return;
	}
	if (payload.from !== "peak" && payload.from !== "offPeak") throw new TypeError("peak payload from is invalid");
	if (payload.to !== "peak" && payload.to !== "offPeak") throw new TypeError("peak payload to is invalid");
	if (payload.from === payload.to) throw new RangeError("peak payload must change period");
	assertNonEmptyString(payload.periodKey, "peak payload periodKey");
	if (candidate.kind === "peak-enter" !== (payload.to === "peak")) throw new TypeError("peak event kind does not match its destination period");
}
/** In-memory stream cursor plus a separate bounded business-key dedupe index. */
var NotificationEventBuffer = class {
	streamId;
	capacity;
	dedupeCapacity;
	events = [];
	seenKeys = /* @__PURE__ */ new Set();
	seenKeyOrder = [];
	seqCounter = 0;
	constructor(options = {}) {
		this.capacity = options.capacity ?? 500;
		this.dedupeCapacity = options.dedupeCapacity ?? 2e3;
		this.streamId = options.streamId ?? randomUUID();
		if (!Number.isSafeInteger(this.capacity) || this.capacity <= 0) throw new RangeError("capacity must be positive");
		if (!Number.isSafeInteger(this.dedupeCapacity) || this.dedupeCapacity < this.capacity) throw new RangeError("dedupeCapacity must be an integer at least as large as capacity");
		assertNonEmptyString(this.streamId, "streamId");
	}
	publish(value) {
		const nextSeq = this.seqCounter + 1;
		const event = {
			...value,
			seq: nextSeq
		};
		validateEvent(event);
		if (this.seenKeys.has(value.dedupeKey)) return void 0;
		this.seqCounter = nextSeq;
		this.seenKeys.add(event.dedupeKey);
		this.seenKeyOrder.push(event.dedupeKey);
		if (this.seenKeyOrder.length > this.dedupeCapacity) {
			const expired = this.seenKeyOrder.shift();
			if (expired !== void 0) this.seenKeys.delete(expired);
		}
		this.events.push(event);
		if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
		return event;
	}
	currentSeq() {
		return this.seqCounter;
	}
	since(since) {
		assertNonNegativeSafeInteger(since, "since");
		if (since >= this.seqCounter) return [];
		return this.events.filter((event) => event.seq > since);
	}
	batchSince(since) {
		return {
			streamId: this.streamId,
			seq: this.seqCounter,
			events: this.since(since)
		};
	}
};
//#endregion
//#region plugins/dsh-token-monitor/src/notification-route.ts
const TOKEN_MONITOR_NOTIFICATION_EVENTS_PATH = "/api/token-monitor/notification-events";
function writeJson(res, status, body, headers = {}) {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
		...headers
	});
	res.end(JSON.stringify(body));
}
function routeError(code, message) {
	return { error: {
		code,
		message
	} };
}
function parseSince(request) {
	const value = new URL(request.url ?? "/api/token-monitor/notification-events", "http://localhost").searchParams.get("since");
	if (value === null) return 0;
	if (!/^(0|[1-9]\d*)$/.test(value)) return void 0;
	const since = Number(value);
	return Number.isSafeInteger(since) ? since : void 0;
}
function createNotificationEventsRouteHandler(buffer) {
	return (request, response) => {
		const method = request.method ?? "GET";
		if (method !== "GET" && method !== "HEAD") {
			writeJson(response, 405, routeError("METHOD_NOT_ALLOWED", "Only GET and HEAD are supported"), { Allow: "GET, HEAD" });
			return;
		}
		const since = parseSince(request);
		if (since === void 0) {
			writeJson(response, 400, routeError("INVALID_SINCE", "since must be a non-negative safe integer"));
			return;
		}
		response.writeHead(200, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store"
		});
		response.end(method === "HEAD" ? void 0 : JSON.stringify(buffer.batchSince(since)));
	};
}
/** Register the Host-owned notification stream used by the whale bubble client. */
function registerNotificationEventsRoute(ctx, buffer) {
	ctx.webServer.register({
		kind: "exact",
		path: TOKEN_MONITOR_NOTIFICATION_EVENTS_PATH,
		handler: createNotificationEventsRouteHandler(buffer)
	});
}
//#endregion
//#region plugins/dsh-token-monitor/src/peak-transition.ts
const SHANGHAI_OFFSET_MS = 288e5;
const PEAK_BOUNDARY_MINUTES = [
	540,
	720,
	840,
	1080
];
const systemClock = {
	now: () => Date.now(),
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (handle) => clearTimeout(handle)
};
function beijingDate$1(timestamp) {
	return new Date(timestamp + SHANGHAI_OFFSET_MS);
}
function isWeekday(day) {
	return day >= 1 && day <= 5;
}
function localTimestamp(date, minutes) {
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Math.floor(minutes / 60), minutes % 60) - SHANGHAI_OFFSET_MS;
}
/** Return the effective billing period at an epoch timestamp. */
function peakPeriodAt(timestamp) {
	const local = beijingDate$1(timestamp);
	if (!isWeekday(local.getUTCDay())) return "offPeak";
	const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
	return minutes >= 540 && minutes < 720 || minutes >= 840 && minutes < 1080 ? "peak" : "offPeak";
}
/** Return the first genuine period boundary strictly after `timestamp`. */
function nextPeakBoundary(timestamp) {
	const local = beijingDate$1(timestamp);
	for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
		const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset));
		if (!isWeekday(day.getUTCDay())) continue;
		for (const minutes of PEAK_BOUNDARY_MINUTES) {
			const candidate = localTimestamp(day, minutes);
			if (candidate > timestamp) return candidate;
		}
	}
	throw new Error("peak transition: failed to find the next weekday boundary");
}
/** Stable idempotency key for the current effective period segment. */
function peakPeriodKey(timestamp) {
	const local = beijingDate$1(timestamp);
	let start;
	if (isWeekday(local.getUTCDay())) {
		const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
		if (minutes >= 1080) start = localTimestamp(local, 1080);
		else if (minutes >= 840) start = localTimestamp(local, 840);
		else if (minutes >= 720) start = localTimestamp(local, 720);
		else if (minutes >= 540) start = localTimestamp(local, 540);
	}
	if (start === void 0) for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
		const prior = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dayOffset));
		if (!isWeekday(prior.getUTCDay())) continue;
		start = localTimestamp(prior, 1080);
		break;
	}
	if (start === void 0) throw new Error("peak transition: failed to identify the current period");
	return `${peakPeriodAt(timestamp)}:${start}`;
}
/**
* Owns one timer and compares effective state, rather than replaying scheduled
* boundaries. A late callback after sleep therefore emits at most one useful
* transition and emits nothing when the current state still matches baseline.
*/
var PeakTransitionScheduler = class {
	onTransition;
	clock;
	onError;
	running = false;
	timer;
	period;
	lastEmittedKey;
	constructor(onTransition, options = {}) {
		this.onTransition = onTransition;
		this.clock = options.clock ?? systemClock;
		this.onError = options.onError ?? (() => {});
	}
	/** Start with a silent baseline. Repeated starts are no-ops. */
	start() {
		if (this.running) return;
		this.running = true;
		this.period = peakPeriodAt(this.clock.now());
		this.lastEmittedKey = void 0;
		this.scheduleNext();
	}
	/** Stop and release the owned timer. Repeated stops are no-ops. */
	stop() {
		if (!this.running) return;
		this.running = false;
		if (this.timer !== void 0) this.clock.clearTimeout(this.timer);
		this.timer = void 0;
		this.period = void 0;
		this.lastEmittedKey = void 0;
	}
	/** Check current state immediately; useful for timer callbacks and tests. */
	check() {
		if (!this.running) return;
		const observedAt = this.clock.now();
		const nextPeriod = peakPeriodAt(observedAt);
		const previousPeriod = this.period;
		this.period = nextPeriod;
		if (previousPeriod !== void 0 && previousPeriod !== nextPeriod) {
			const key = peakPeriodKey(observedAt);
			if (key !== this.lastEmittedKey) {
				this.lastEmittedKey = key;
				const transition = {
					from: previousPeriod,
					to: nextPeriod,
					observedAt,
					key
				};
				try {
					Promise.resolve(this.onTransition(transition)).catch((error) => this.report(error));
				} catch (error) {
					this.report(error);
				}
			}
		}
		this.scheduleNext();
	}
	scheduleNext() {
		if (!this.running) return;
		if (this.timer !== void 0) this.clock.clearTimeout(this.timer);
		const now = this.clock.now();
		const delayMs = Math.max(1, nextPeakBoundary(now) - now);
		this.timer = this.clock.setTimeout(() => {
			this.timer = void 0;
			this.check();
		}, delayMs);
	}
	report(error) {
		try {
			this.onError(error);
		} catch {}
	}
};
//#endregion
//#region plugins/dsh-token-monitor/src/peak-reminder.ts
const DEFAULT_PEAK_REMINDER_SETTINGS = Object.freeze({
	peakReminderEnabled: false,
	peakReminderEnterPeak: false,
	peakReminderEnterValley: false
});
/** Fixed user-facing message for a genuine effective-period transition. */
function formatPeakTransitionMessage(transition) {
	const schedule = ["工作日峰时段：09:00–12:00、14:00–18:00", "其余工作日时段及周末全天为谷时段。"];
	if (transition.to === "peak") return [
		"【dsh-damage-pulse · 峰时提醒】",
		"",
		"叮咚～现在进入峰时段啦（北京时间）！( •̀ ω •́ )✧",
		"安排调用时记得留意峰时价格哦～",
		"",
		...schedule,
		"",
		"鲸鱼娘会继续帮你盯着余额和消耗～"
	].join("\n");
	return [
		"【dsh-damage-pulse · 谷时提醒】",
		"",
		"好消息～现在进入谷时段啦（北京时间）！ヾ(≧▽≦*)o",
		"想安排调用的话，可以留意一下现在的谷时价格哦～",
		"",
		...schedule,
		"",
		"鲸鱼娘会继续乖乖守着余额变化～"
	].join("\n");
}
/**
* Bind the scheduler to the plugin lifecycle. Notification failures are
* contained here and never enter accounting, persistence, or request paths.
*/
function attachPeakBoundaryReminder(ctx, sender, options = {}) {
	const warn = options.warn ?? ((message) => console.warn(message));
	const scheduler = new PeakTransitionScheduler(async (transition) => {
		options.onTransition?.(transition);
		const settings = options.settings?.() ?? DEFAULT_PEAK_REMINDER_SETTINGS;
		if (!settings.peakReminderEnabled) return;
		if (transition.to === "peak" && !settings.peakReminderEnterPeak) return;
		if (transition.to === "offPeak" && !settings.peakReminderEnterValley) return;
		const result = await sender.send(formatPeakTransitionMessage(transition));
		if (!result.ok) warn(`[dsh-token-monitor] 微信峰谷提醒发送失败（不影响计费/UI）: ${result.detail}`);
	}, {
		...options.clock === void 0 ? {} : { clock: options.clock },
		onError: (error) => warn(`[dsh-token-monitor] 微信峰谷提醒异常（不影响计费/UI）: ${String(error)}`)
	});
	ctx.effect(() => {
		scheduler.start();
		return () => scheduler.stop();
	}, "dsh-token-monitor: peak boundary reminder");
}
//#endregion
//#region plugins/dsh-token-monitor/src/projection.ts
/**
* tokenCost projection：fold assistant/message.usage，累计每个会话的 token 用量与金额。
* 经 session-projection 缝自动推送（registry 快照 / 变更流 / session/projection 帧），
* Web Client 据此渲染「会话累计」统计条。
* 定义同时携带两代 DSH 宿主的字段：0.1.0-rc.6/rc.7/rc.8 读取 schema/view，
* 0.1.1-rc.1/rc.2 读取 stateSchema/wire；两侧 registry 都只消费自己认识的字段。
* @module dsh-token-monitor/projection
*/
/** Persisted fold state (the DSH 0.1.1 wire contract validates this shape). */
const stateSchema = z.object({
	calls: z.number().int().nonnegative(),
	inputTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative(),
	cacheWriteTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cost: z.number().nonnegative(),
	lastActivity: z.number().nonnegative()
}).strict();
/** Client-facing aggregate; derived fields stay out of persisted fold state. */
const viewSchema = z.object({
	calls: z.number().int().nonnegative(),
	inputTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative(),
	cacheWriteTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	totalTokens: z.number().int().nonnegative(),
	cost: z.number().nonnegative(),
	lastActivity: z.number().nonnegative()
}).strict();
/** 按给定价格表构造 tokenCost projection 单元。 */
function createTokenCostProjectionDefinition(priceTable) {
	/** 共享的 state → wire 投影：旧宿主经 view 读取，新宿主经 wire.view 读取。 */
	const wireView = (state) => ({
		calls: state.calls,
		inputTokens: state.inputTokens,
		cacheReadTokens: state.cacheReadTokens,
		cacheWriteTokens: state.cacheWriteTokens,
		outputTokens: state.outputTokens,
		totalTokens: state.inputTokens + state.cacheReadTokens + state.cacheWriteTokens + state.outputTokens,
		cost: state.cost,
		lastActivity: state.lastActivity
	});
	return {
		key: "tokenCost",
		stateSchema,
		init: () => ({
			calls: 0,
			inputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			outputTokens: 0,
			cost: 0,
			lastActivity: 0
		}),
		apply: (state, event) => {
			if (event.type !== "assistant/message") return state;
			const usage = event.data.usage;
			if (usage === void 0) return state;
			const source = event.data.message.source;
			if (source.kind !== "model") return state;
			const inputTokens = usage.inputTokens;
			const cacheReadTokens = usage.cacheReadTokens ?? 0;
			const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
			const outputTokens = usage.outputTokens;
			if (![
				inputTokens,
				cacheReadTokens,
				cacheWriteTokens,
				outputTokens
			].every((value) => Number.isSafeInteger(value) && value >= 0)) return state;
			const breakdown = priceUsage(inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, source.provider, source.model, event.time, priceTable);
			if (breakdown === void 0) return state;
			return {
				...state,
				calls: state.calls + 1,
				inputTokens: state.inputTokens + inputTokens,
				cacheReadTokens: state.cacheReadTokens + cacheReadTokens,
				cacheWriteTokens: state.cacheWriteTokens + cacheWriteTokens,
				outputTokens: state.outputTokens + outputTokens,
				cost: state.cost + breakdown.cost,
				lastActivity: event.time
			};
		},
		wire: {
			viewSchema,
			view: wireView
		},
		schema: viewSchema,
		view: wireView,
		stateVersion: 4
	};
}
//#endregion
//#region plugins/dsh-token-monitor/src/settings.ts
const TOKEN_MONITOR_SETTINGS_NS = "dsh-token-monitor";
const settingsSchema = z$1.object({
	schemaVersion: z$1.number().min(0).default(3),
	priceTable: z$1.any().default(PRICE_TABLE),
	displayMode: z$1.union(["balance", "spend"]).default(DEFAULT_TOKEN_MONITOR_SETTINGS.displayMode),
	showWhaleGirl: z$1.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.showWhaleGirl),
	dailyBudgetEnabled: z$1.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetEnabled),
	dailyBudgetCny: z$1.number().min(Number.MIN_VALUE).max(TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY).default(DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetCny),
	budgetExceededNotificationEnabled: z$1.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.budgetExceededNotificationEnabled),
	peakReminderEnabled: z$1.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnabled),
	peakReminderEnterPeak: z$1.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterPeak),
	peakReminderEnterValley: z$1.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterValley),
	notifyOncePerTransition: z$1.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.notifyOncePerTransition),
	whaleBubbleEnabled: z$1.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.whaleBubbleEnabled),
	wechatNotificationsEnabled: z$1.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.wechatNotificationsEnabled),
	cacheHitAnomalyNotificationEnabled: z$1.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyNotificationEnabled),
	cacheHitAnomalyThreshold: z$1.number().min(0).max(100).default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyThreshold),
	cacheHitAnomalyConsecutiveCalls: z$1.number().min(2).max(20).default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyConsecutiveCalls)
});
function validateResolvedSettings(value) {
	if (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 0) throw new TypeError("dsh-token-monitor schemaVersion must be a non-negative safe integer");
	if (value.schemaVersion > 3) throw new UnsupportedTokenMonitorSettingsVersionError(value.schemaVersion);
	pickPublicTokenMonitorSettings(value);
}
function descriptorFor(settings) {
	const descriptor = settings.describe({ redactSecrets: true }).find((candidate) => candidate.ns === TOKEN_MONITOR_SETTINGS_NS);
	if (descriptor === void 0) throw new Error("dsh-token-monitor settings namespace is not registered");
	return descriptor;
}
async function migrateLegacySettings(settings) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const descriptor = descriptorFor(settings);
		const patch = planTokenMonitorSettingsMigration(descriptor.user);
		if (patch === void 0) return;
		try {
			await settings.update(TOKEN_MONITOR_SETTINGS_NS, patch, descriptor.revision);
			return;
		} catch (error) {
			if (error instanceof SettingsConflictError && attempt < 2) continue;
			throw error;
		}
	}
}
function registerTokenMonitorSettings(settings) {
	return {
		scope: settings.register(TOKEN_MONITOR_SETTINGS_NS, settingsSchema, {
			applies: "live",
			validate: validateResolvedSettings
		}),
		ready: migrateLegacySettings(settings)
	};
}
function createTokenMonitorSettingsController(settings, scope) {
	const read = () => {
		return {
			schemaVersion: 3,
			revision: descriptorFor(settings).revision,
			settings: pickPublicTokenMonitorSettings(scope.get())
		};
	};
	return {
		read,
		async patch(request) {
			if (Object.keys(request.patch).length === 0) return read();
			await settings.update(TOKEN_MONITOR_SETTINGS_NS, request.patch, request.expectedRevision);
			return read();
		}
	};
}
var RequestBodyError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
function sendJson$1(response, status, value, head = false, headers = {}) {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		...headers
	});
	response.end(head ? void 0 : JSON.stringify(value));
}
function sendError$1(response, status, code, message, fields, headers) {
	sendJson$1(response, status, { error: {
		code,
		message,
		...fields === void 0 ? {} : { details: { fields } }
	} }, false, headers);
}
async function readJsonBody(request) {
	const contentLength = request.headers["content-length"];
	if (contentLength !== void 0) {
		const declared = Number(contentLength);
		if (Number.isFinite(declared) && declared > 16384) {
			request.resume();
			throw new RequestBodyError("PAYLOAD_TOO_LARGE", "请求体超过 16 KiB 限制");
		}
	}
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.byteLength;
		if (size > 16384) {
			request.resume();
			throw new RequestBodyError("PAYLOAD_TOO_LARGE", "请求体超过 16 KiB 限制");
		}
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim().length === 0) throw new RequestBodyError("INVALID_JSON", "请求体不能为空");
	try {
		return JSON.parse(text);
	} catch {
		throw new RequestBodyError("INVALID_JSON", "请求体不是有效 JSON");
	}
}
function createTokenMonitorSettingsRouteHandler(controller, reportInternalError = () => void 0) {
	return async (request, response) => {
		const method = request.method ?? "GET";
		if (method === "GET" || method === "HEAD") {
			sendJson$1(response, 200, controller.read(), method === "HEAD");
			return;
		}
		if (method !== "PATCH") {
			sendError$1(response, 405, "METHOD_NOT_ALLOWED", "仅支持 GET、HEAD 和 PATCH", void 0, { Allow: "GET, HEAD, PATCH" });
			return;
		}
		if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
			sendError$1(response, 415, "UNSUPPORTED_MEDIA_TYPE", "PATCH 请求必须使用 application/json");
			return;
		}
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			if (error instanceof RequestBodyError) {
				sendError$1(response, error.code === "PAYLOAD_TOO_LARGE" ? 413 : 400, error.code, error.message);
				return;
			}
			reportInternalError(error);
			sendError$1(response, 500, "WRITE_FAILED", "设置读取失败，请稍后重试");
			return;
		}
		const parsed = parseTokenMonitorSettingsPatchRequest(body);
		if (!parsed.ok) {
			sendError$1(response, 400, "VALIDATION_ERROR", "设置字段校验失败", parsed.fields);
			return;
		}
		try {
			sendJson$1(response, 200, await controller.patch(parsed.value));
		} catch (error) {
			if (error instanceof SettingsConflictError) {
				sendError$1(response, 409, "CONFLICT", "设置已被其他窗口更新，请刷新后重试");
				return;
			}
			reportInternalError(error);
			sendError$1(response, 500, "WRITE_FAILED", "设置保存失败，原设置保持不变");
		}
	};
}
function registerTokenMonitorSettingsRoute(ctx, registration) {
	const handler = createTokenMonitorSettingsRouteHandler(createTokenMonitorSettingsController(ctx.settings, registration.scope), (error) => {
		ctx.logger.warn("dsh-token-monitor settings route failed");
		ctx.logger.warn(error instanceof Error ? error : new Error(String(error)));
	});
	ctx.webServer.register({
		kind: "exact",
		path: "/api/token-monitor/settings",
		handler: (request, response) => handler(request, response)
	});
}
//#endregion
//#region plugins/dsh-token-monitor/src/storage.ts
/**
* 会话累计存储 + 单次用量明细持久化（JSONL）。
* 会话累计（tokenCost projection）已由 session-projection-cache 持久化；
* 这里额外落盘单次用量明细，供历史查询与导出。
* @module dsh-token-monitor/storage
*/
/** 明细数据目录：~/.dsh/data/dsh-token-monitor/ */
const DATA_DIR = join(homedir(), ".dsh", "data", "dsh-token-monitor");
/** 按会话累计用量与金额，并追加持久化单次明细。 */
var UsageStorage = class {
	summaries = /* @__PURE__ */ new Map();
	records = [];
	dailySpend = /* @__PURE__ */ new Map();
	seenSourceEvents = /* @__PURE__ */ new Set();
	isEligible;
	dataDir;
	constructor(isEligible, dataDir = DATA_DIR) {
		this.isEligible = isEligible;
		this.dataDir = dataDir;
		try {
			mkdirSync(this.dataDir, { recursive: true });
		} catch (error) {
			console.warn(`[dsh-token-monitor] 创建数据目录失败: ${String(error)}`);
		}
		this.loadHistory();
	}
	/** 冷启动回读历史明细（fail-soft：文件缺失/损坏行静默跳过）。 */
	loadHistory() {
		try {
			const text = readFileSync(join(this.dataDir, "usage.jsonl"), "utf8");
			let excluded = 0;
			for (const line of text.split("\n")) {
				const trimmed = line.trim();
				if (trimmed === "") continue;
				try {
					const record = normalizeUsageRecord(JSON.parse(trimmed));
					if (record !== void 0 && isValidUsageRecord(record) && this.isEligible(record)) {
						if (this.isDuplicateSourceEvent(record)) continue;
						this.records.push(record);
						this.summaries.set(record.sessionId, this.fold(record));
						this.addToDailySpend(record);
					} else excluded++;
				} catch {}
			}
			if (this.records.length > 0) console.log(`[dsh-token-monitor] 已加载 ${this.records.length} 条历史明细`);
			if (excluded > 0) console.log(`[dsh-token-monitor] 已从运行时汇总排除 ${excluded} 条不合格历史明细（原始 JSONL 未修改）`);
		} catch {}
	}
	/** 将明细折叠到会话摘要；冷启动与新增路径共用，避免摘要状态分叉。 */
	fold(record) {
		const prev = this.summaries.get(record.sessionId);
		if (prev === void 0) return {
			sessionId: record.sessionId,
			calls: 1,
			inputTokens: record.inputTokens,
			cacheReadTokens: record.cacheReadTokens,
			cacheWriteTokens: record.cacheWriteTokens,
			outputTokens: record.outputTokens,
			totalTokens: record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens + record.outputTokens,
			cost: record.cost,
			lastActivity: record.timestamp
		};
		return {
			...prev,
			calls: prev.calls + 1,
			inputTokens: prev.inputTokens + record.inputTokens,
			cacheReadTokens: prev.cacheReadTokens + record.cacheReadTokens,
			cacheWriteTokens: prev.cacheWriteTokens + record.cacheWriteTokens,
			outputTokens: prev.outputTokens + record.outputTokens,
			totalTokens: prev.totalTokens + record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens + record.outputTokens,
			cost: prev.cost + record.cost,
			lastActivity: record.timestamp
		};
	}
	/** 将合格明细累加到北京时间日期索引，避免今日消费查询重复扫描全部历史。 */
	addToDailySpend(record) {
		const date = beijingDateKey(record.timestamp);
		const previous = this.dailySpend.get(date);
		if (previous === void 0) {
			this.dailySpend.set(date, {
				cost: record.cost,
				calls: 1
			});
			return;
		}
		previous.cost += record.cost;
		previous.calls += 1;
	}
	/** 把一条单次记录累加到对应会话，并追加持久化明细。 */
	add(record) {
		if (!isValidUsageRecord(record) || !this.isEligible(record)) return void 0;
		if (this.isDuplicateSourceEvent(record)) return void 0;
		const next = this.fold(record);
		this.summaries.set(record.sessionId, next);
		this.records.push(record);
		this.addToDailySpend(record);
		try {
			appendFileSync(join(this.dataDir, "usage.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
		} catch (error) {
			console.warn(`[dsh-token-monitor] 明细落盘失败: ${String(error)}`);
		}
		return next;
	}
	isDuplicateSourceEvent(record) {
		if (record.sourceEventSeq === void 0) return false;
		const key = JSON.stringify([record.sessionId, record.sourceEventSeq]);
		if (this.seenSourceEvents.has(key)) return true;
		this.seenSourceEvents.add(key);
		return false;
	}
	get(sessionId) {
		return this.summaries.get(sessionId);
	}
	list() {
		return [...this.summaries.values()];
	}
	/** 单次用量明细（可按会话过滤）。 */
	history(sessionId) {
		if (sessionId === void 0) return [...this.records];
		return this.records.filter((record) => record.sessionId === sessionId);
	}
	/** 按北京时间自然日聚合当前运行时已通过资格门禁的记录。 */
	todaySpend(now = Date.now()) {
		const date = beijingDateKey(now);
		const summary = this.dailySpend.get(date);
		return {
			date,
			timeZone: "Asia/Shanghai",
			currency: "CNY",
			cost: summary?.cost ?? 0,
			calls: summary?.calls ?? 0,
			updatedAt: now
		};
	}
};
//#endregion
//#region plugins/dsh-token-monitor/src/usage-summary.ts
const BEIJING_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
	timeZone: "Asia/Shanghai",
	year: "numeric",
	month: "2-digit",
	day: "2-digit"
});
function beijingDate(timestamp) {
	if (!Number.isFinite(timestamp)) return void 0;
	const parts = BEIJING_DATE_FORMATTER.formatToParts(timestamp);
	const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
	if (typeof values.year !== "string" || typeof values.month !== "string" || typeof values.day !== "string") return void 0;
	return `${values.year}-${values.month}-${values.day}`;
}
function beijingToday(timestamp) {
	return beijingDate(timestamp) ?? "1970-01-01";
}
function addDays(date, days) {
	const [year, month, day] = date.split("-").map(Number);
	const utc = Date.UTC(year, month - 1, day + days);
	const shifted = new Date(utc);
	return `${shifted.getUTCFullYear().toString().padStart(4, "0")}-${(shifted.getUTCMonth() + 1).toString().padStart(2, "0")}-${shifted.getUTCDate().toString().padStart(2, "0")}`;
}
function isFiniteNonNegative(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isValidRecord(record) {
	return Number.isFinite(record.timestamp) && isFiniteNonNegative(record.cost) && isFiniteNonNegative(record.inputTokens) && isFiniteNonNegative(record.outputTokens) && isFiniteNonNegative(record.cacheReadTokens) && isFiniteNonNegative(record.cacheWriteTokens);
}
function rangeStart(range, today) {
	if (range === "all") return null;
	if (range === "today") return today;
	if (range === "7d") return addDays(today, -6);
	return addDays(today, -29);
}
/** Aggregate persisted eligible records using each record's historical cost. */
function summarizeUsage(records, range, now = Date.now()) {
	if (![
		"all",
		"30d",
		"7d",
		"today"
	].includes(range)) return void 0;
	const to = beijingToday(now);
	const from = rangeStart(range, to);
	const selected = records.filter((record) => {
		if (!isValidRecord(record)) return false;
		const date = beijingDate(record.timestamp);
		if (date === void 0) return false;
		return (from === null || date >= from) && date <= to;
	});
	const spendCny = selected.reduce((sum, record) => sum + record.cost, 0);
	const inputTokens = selected.reduce((sum, record) => sum + record.inputTokens, 0);
	const outputTokens = selected.reduce((sum, record) => sum + record.outputTokens, 0);
	const cacheHitTokens = selected.reduce((sum, record) => sum + record.cacheReadTokens, 0);
	const cacheWriteTokens = selected.reduce((sum, record) => sum + record.cacheWriteTokens, 0);
	const activeDays = new Set(selected.map((record) => beijingDate(record.timestamp)).filter((date) => date !== void 0)).size;
	return {
		range,
		from: selected.length === 0 ? null : from ?? beijingDate(Math.min(...selected.map((record) => record.timestamp))) ?? null,
		to,
		spendCny: Math.round(spendCny * 1e6) / 1e6,
		requestCount: selected.length,
		totalTokens: inputTokens + cacheHitTokens + cacheWriteTokens + outputTokens,
		cacheHitTokens,
		cacheHitRate: inputTokens + cacheHitTokens > 0 ? cacheHitTokens / (inputTokens + cacheHitTokens) : 0,
		activeDays
	};
}
//#endregion
//#region plugins/dsh-token-monitor/src/wechat-routes.ts
const WECHAT_CONNECTION_BASE_PATH = "/api/token-monitor/wechat";
const WECHAT_STATUS_PATH = `${WECHAT_CONNECTION_BASE_PATH}/status`;
const WECHAT_LOGIN_PATH = `${WECHAT_CONNECTION_BASE_PATH}/login`;
const WECHAT_LOGIN_CONFIRM_PATH = `${WECHAT_LOGIN_PATH}/confirm`;
const WECHAT_RECONNECT_PATH = `${WECHAT_CONNECTION_BASE_PATH}/reconnect`;
const WECHAT_DISCONNECT_PATH = `${WECHAT_CONNECTION_BASE_PATH}/disconnect`;
const WECHAT_TEST_PATH = `${WECHAT_CONNECTION_BASE_PATH}/test`;
var WechatRequestError = class extends Error {
	status;
	code;
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
		this.name = "WechatRequestError";
	}
};
const serviceErrorCodes = [
	"UNSUPPORTED",
	"OPERATION_IN_PROGRESS",
	"LOGIN_SESSION_NOT_FOUND",
	"LOGIN_SESSION_EXPIRED",
	"LOGIN_PROTOCOL_ERROR",
	"NEEDS_LOGIN",
	"BRIDGE_NOT_OWNED",
	"CONFIRMATION_REQUIRED",
	"OPERATION_FAILED"
];
function sendJson(response, status, value, head = false, headers = {}) {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		...headers
	});
	response.end(head ? void 0 : JSON.stringify(value));
}
function sendError(response, status, code, message, headers = {}) {
	sendJson(response, status, { error: {
		code,
		message
	} }, false, headers);
}
function isPlainObject(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
function hasExactKeys(record, keys) {
	const actual = Object.keys(record);
	return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function hasDangerousKey(record) {
	return Object.keys(record).some((key) => key === "__proto__" || key === "prototype" || key === "constructor");
}
function mediaType(request) {
	return request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
}
async function readBodyText(request) {
	const contentLength = request.headers["content-length"];
	if (contentLength !== void 0) {
		const declared = Number(contentLength);
		if (Number.isFinite(declared) && declared > 4096) {
			request.resume();
			throw new WechatRequestError(413, "PAYLOAD_TOO_LARGE", "请求体超过 4 KiB 限制");
		}
	}
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.byteLength;
		if (size > 4096) {
			request.resume();
			throw new WechatRequestError(413, "PAYLOAD_TOO_LARGE", "请求体超过 4 KiB 限制");
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
async function requireEmptyBody(request) {
	if ((await readBodyText(request)).trim().length !== 0) throw new WechatRequestError(400, "VALIDATION_ERROR", "该操作不接受请求体");
}
async function readJsonObject(request) {
	if (mediaType(request) !== "application/json") throw new WechatRequestError(415, "UNSUPPORTED_MEDIA_TYPE", "请求必须使用 application/json");
	const text = await readBodyText(request);
	if (text.trim().length === 0) throw new WechatRequestError(400, "INVALID_JSON", "请求体不能为空");
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new WechatRequestError(400, "INVALID_JSON", "请求体不是有效 JSON");
	}
	if (!isPlainObject(value) || hasDangerousKey(value)) throw new WechatRequestError(400, "VALIDATION_ERROR", "请求字段校验失败");
	return value;
}
async function readConfirmLogin(request) {
	const value = await readJsonObject(request);
	if (!hasExactKeys(value, ["sessionId"]) || typeof value.sessionId !== "string" || value.sessionId.length < 1 || value.sessionId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value.sessionId)) throw new WechatRequestError(400, "VALIDATION_ERROR", "sessionId 无效");
	return value.sessionId;
}
async function readDisconnect(request) {
	const value = await readJsonObject(request);
	if (!hasExactKeys(value, ["confirm"]) || typeof value.confirm !== "boolean") throw new WechatRequestError(400, "VALIDATION_ERROR", "confirm 必须是布尔值");
	return value.confirm;
}
async function readTestMessage(request) {
	const value = await readJsonObject(request);
	if (!hasExactKeys(value, ["message"]) || typeof value.message !== "string" || value.message.trim().length === 0 || value.message.length > 2e3) throw new WechatRequestError(400, "VALIDATION_ERROR", "message 必须是 1–2000 个字符的非空文本");
	return value.message;
}
function serviceErrorStatus(code) {
	switch (code) {
		case "LOGIN_SESSION_NOT_FOUND": return 404;
		case "LOGIN_SESSION_EXPIRED": return 410;
		case "UNSUPPORTED": return 503;
		case "LOGIN_PROTOCOL_ERROR": return 502;
		case "OPERATION_IN_PROGRESS":
		case "BRIDGE_NOT_OWNED":
		case "NEEDS_LOGIN": return 409;
		case "CONFIRMATION_REQUIRED": return 400;
		case "OPERATION_FAILED": return 500;
	}
}
function parseServiceError(error) {
	if (!(error instanceof Error) || !("code" in error)) return void 0;
	const code = error.code;
	if (typeof code !== "string" || !serviceErrorCodes.includes(code)) return void 0;
	if (error.message.length < 1 || error.message.length > 512) return void 0;
	return {
		code,
		message: error.message
	};
}
function allowedMethods(action) {
	return action === "status" ? "GET, HEAD" : "POST";
}
/** Standalone handler seam shared by route registration and focused tests. */
function createWechatConnectionRouteHandler(service, action, reportInternalError = () => void 0) {
	return async (request, response) => {
		const method = request.method ?? "GET";
		const allow = allowedMethods(action);
		if (action === "status" && method !== "GET" && method !== "HEAD" || action !== "status" && method !== "POST") {
			sendError(response, 405, "METHOD_NOT_ALLOWED", `仅支持 ${allow}`, { Allow: allow });
			return;
		}
		try {
			let result;
			switch (action) {
				case "status":
					result = await service.status();
					break;
				case "login":
					await requireEmptyBody(request);
					result = await service.login();
					break;
				case "confirm-login":
					result = await service.confirmLogin(await readConfirmLogin(request));
					break;
				case "reconnect":
					await requireEmptyBody(request);
					result = await service.reconnect();
					break;
				case "disconnect":
					result = await service.disconnect(await readDisconnect(request));
					break;
				case "test-message": {
					const message = await readTestMessage(request);
					if (service.testMessage === void 0) {
						sendError(response, 503, "UNSUPPORTED", "微信测试消息能力当前不可用");
						return;
					}
					const delivery = await service.testMessage(message);
					if (delivery.ok) {
						result = { ok: true };
						break;
					}
					if (delivery.code === "activation-required") {
						sendError(response, 409, "ACTIVATION_REQUIRED", "微信通知通道需要先激活", {});
						return;
					}
					sendError(response, 502, "SEND_FAILED", "微信测试消息发送失败");
					return;
				}
			}
			sendJson(response, 200, result, method === "HEAD");
		} catch (error) {
			if (error instanceof WechatRequestError) {
				sendError(response, error.status, error.code, error.message);
				return;
			}
			const serviceError = parseServiceError(error);
			if (serviceError !== void 0) {
				sendError(response, serviceErrorStatus(serviceError.code), serviceError.code, serviceError.message);
				return;
			}
			reportInternalError(error);
			sendError(response, 500, "OPERATION_FAILED", "微信连接操作失败，请稍后重试");
		}
	};
}
function registerWechatRoutes(ctx, service) {
	const report = (_error) => {
		ctx.logger.warn("dsh-token-monitor wechat connection route failed");
	};
	const routes = [
		{
			path: WECHAT_STATUS_PATH,
			action: "status"
		},
		{
			path: WECHAT_LOGIN_PATH,
			action: "login"
		},
		{
			path: WECHAT_LOGIN_CONFIRM_PATH,
			action: "confirm-login"
		},
		{
			path: WECHAT_RECONNECT_PATH,
			action: "reconnect"
		},
		{
			path: WECHAT_DISCONNECT_PATH,
			action: "disconnect"
		},
		{
			path: WECHAT_TEST_PATH,
			action: "test-message"
		}
	];
	for (const route of routes) ctx.webServer.register({
		kind: "exact",
		path: route.path,
		handler: createWechatConnectionRouteHandler(service, route.action, report)
	});
}
//#endregion
//#region plugins/dsh-token-monitor/src/update.ts
const UPDATE_STATUS_PATH = "/api/token-monitor/update";
const UPDATE_INSTALL_PATH = "/api/token-monitor/update/install";
const UPDATE_REPOSITORY = "wssfk12138/dsh-damage-pulse";
const CURRENT_RELEASE_VERSION = "4.0.5";
const RELEASES_API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;
const ASSET_HOST = "github.com";
const REDIRECT_HOSTS = /* @__PURE__ */ new Set(["release-assets.githubusercontent.com"]);
const ASSET_MAX_BYTES = 52428800;
const REQUEST_TIMEOUT_MS = 12e3;
const DOWNLOAD_TIMEOUT_MS = 3e4;
const INSTALL_TIMEOUT_MS = 3e5;
const INSTALL_REQUEST_MAX_BYTES = 8192;
const ASSET_NAME = /^dsh-damage-pulse-v?(\d+\.\d+\.\d+)\.tgz$/;
const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/i;
const PROFILE_NAME = /^(?!node_modules$)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function json(response, status, value) {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store"
	});
	response.end(JSON.stringify(value));
}
function semver(value) {
	return /^v?(\d+\.\d+\.\d+)$/.exec(value.trim())?.[1];
}
function newer(left, right) {
	const a = left.split(".").map(Number);
	const b = right.split(".").map(Number);
	for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index];
	return false;
}
function assertRelease(value) {
	if (typeof value !== "object" || value === null) throw new Error("GitHub release 响应无效");
	const record = value;
	if (typeof record.tag_name !== "string" || typeof record.html_url !== "string" || !Array.isArray(record.assets)) throw new Error("GitHub release 响应字段缺失");
	const releaseUrl = new URL(record.html_url);
	if (releaseUrl.protocol !== "https:" || releaseUrl.hostname !== ASSET_HOST || !releaseUrl.pathname.startsWith(`/wssfk12138/dsh-damage-pulse/releases/`)) throw new Error("GitHub release 地址不在允许范围内");
	const assets = record.assets.flatMap((asset) => {
		if (typeof asset !== "object" || asset === null) return [];
		const item = asset;
		if (typeof item.name !== "string" || typeof item.size !== "number" || typeof item.browser_download_url !== "string") return [];
		const digest = typeof item.digest === "string" && SHA256_DIGEST.test(item.digest) ? item.digest : void 0;
		return [{
			name: item.name,
			size: item.size,
			...digest === void 0 ? {} : { digest },
			browser_download_url: item.browser_download_url
		}];
	});
	return {
		tag_name: record.tag_name,
		html_url: releaseUrl.href,
		assets
	};
}
async function fetchJson() {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(RELEASES_API, {
			signal: controller.signal,
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "dsh-damage-pulse-updater"
			}
		});
		if (!response.ok) throw new Error(`GitHub 返回 HTTP ${String(response.status)}`);
		return assertRelease(await response.json());
	} finally {
		clearTimeout(timer);
	}
}
function selectAsset(release) {
	const releaseVersion = semver(release.tag_name);
	if (releaseVersion === void 0) return void 0;
	return release.assets.find((asset) => {
		const match = ASSET_NAME.exec(asset.name);
		return match !== null && match[1] === releaseVersion && asset.size > 0 && asset.size <= ASSET_MAX_BYTES && asset.digest !== void 0;
	});
}
function statusFrom(release) {
	const latestVersion = semver(release.tag_name);
	if (latestVersion === void 0) throw new Error("GitHub Release 版本号无效");
	const asset = selectAsset(release);
	return {
		repository: UPDATE_REPOSITORY,
		currentVersion: CURRENT_RELEASE_VERSION,
		latestVersion,
		hasUpdate: newer(latestVersion, CURRENT_RELEASE_VERSION),
		releaseUrl: release.html_url,
		asset: asset === void 0 ? null : {
			name: asset.name,
			size: asset.size,
			digest: asset.digest
		}
	};
}
async function statusPayload() {
	return statusFrom(await fetchJson());
}
function assertInitialAssetUrl(asset) {
	const url = new URL(asset.browser_download_url);
	if (url.protocol !== "https:" || url.hostname !== ASSET_HOST || !url.pathname.startsWith(`/wssfk12138/dsh-damage-pulse/releases/download/`) || !url.pathname.endsWith(`/${asset.name}`)) throw new Error("更新资产来源不在允许范围内");
	return url;
}
async function downloadAsset(asset) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
	let url = assertInitialAssetUrl(asset);
	try {
		for (let redirect = 0; redirect <= 2; redirect += 1) {
			const response = await fetch(url, {
				signal: controller.signal,
				redirect: "manual",
				headers: { "User-Agent": "dsh-damage-pulse-updater" }
			});
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location");
				if (location === null || redirect === 2) throw new Error("更新资产重定向无效");
				const next = new URL(location, url);
				if (next.protocol !== "https:" || !REDIRECT_HOSTS.has(next.hostname)) throw new Error("更新资产重定向不在允许范围内");
				url = next;
				continue;
			}
			if (!response.ok) throw new Error(`更新资产下载失败（HTTP ${String(response.status)}）`);
			if (Number(response.headers.get("content-length") ?? "0") > ASSET_MAX_BYTES) throw new Error("更新资产超过大小限制");
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (bytes.byteLength === 0 || bytes.byteLength > ASSET_MAX_BYTES) throw new Error("更新资产大小无效");
			return bytes;
		}
		throw new Error("更新资产重定向次数过多");
	} finally {
		clearTimeout(timer);
	}
}
function inferRunningProfile(argv) {
	const args = argv.slice(2);
	if (args[0] === "web") return "web";
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--profile") {
			const profile = args[index + 1];
			return profile !== void 0 && PROFILE_NAME.test(profile) ? profile : void 0;
		}
		if (argument.startsWith("--profile=")) {
			const profile = argument.slice(10);
			return PROFILE_NAME.test(profile) ? profile : void 0;
		}
		if (argument === "--patch") {
			index += 1;
			continue;
		}
		if (argument === "--dump-config" || argument === "--dump-default-config") continue;
		break;
	}
}
function loaderArgs(execArgv, cliEntry) {
	if (!cliEntry.toLowerCase().endsWith(".ts")) return [];
	const result = [];
	for (let index = 0; index < execArgv.length; index += 1) {
		const argument = execArgv[index];
		if (argument === "--import" || argument === "--loader") {
			const value = execArgv[index + 1];
			if (value !== void 0 && value.length <= 256) {
				result.push(argument, value);
				index += 1;
			}
		} else if (/^--(?:import|loader)=.{1,256}$/.test(argument)) result.push(argument);
	}
	if (result.length === 0) throw new Error("当前源码运行方式缺少 TypeScript loader，无法启动官方安装器");
	return result;
}
function runOfficialInstall(runtime, profile, packagePath) {
	const cliEntry = runtime.argv[1];
	if (cliEntry === void 0 || !path.isAbsolute(cliEntry)) throw new Error("无法定位当前 DSH CLI 入口");
	const args = [
		...loaderArgs(runtime.execArgv, cliEntry),
		cliEntry,
		"plugin",
		"--profile",
		profile,
		"add",
		packagePath
	];
	return new Promise((resolve, reject) => {
		const child = spawn(runtime.execPath, args, {
			shell: false,
			windowsHide: true,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		let diagnostics = "";
		const collect = (chunk) => {
			diagnostics = `${diagnostics}${chunk.toString("utf8")}`.slice(-8192);
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		const timer = setTimeout(() => {
			child.kill();
			reject(/* @__PURE__ */ new Error("官方插件安装超时，更新包已保留"));
		}, INSTALL_TIMEOUT_MS);
		child.once("error", (cause) => {
			clearTimeout(timer);
			reject(cause);
		});
		child.once("exit", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(/* @__PURE__ */ new Error(`官方插件安装失败（退出码 ${String(code ?? "unknown")}）${diagnostics.trim() === "" ? "" : `：${diagnostics.trim()}`}`));
		});
	});
}
async function installLatest(options) {
	const release = await fetchJson();
	const status = statusFrom(release);
	const asset = selectAsset(release);
	if (asset === void 0) throw new Error("最新 Release 没有带 SHA-256 摘要的插件资产");
	if (!status.hasUpdate) return {
		...status,
		installed: false,
		staged: false,
		message: "当前已经是最新版本。"
	};
	const bytes = await downloadAsset(asset);
	const digest = createHash("sha256").update(bytes).digest("hex");
	if (asset.digest === void 0 || asset.digest.toLowerCase() !== `sha256:${digest}`) throw new Error("更新资产 SHA-256 校验失败");
	const root = path.join(os.tmpdir(), "dsh-damage-pulse-updates");
	await mkdir(root, { recursive: true });
	const target = path.join(root, asset.name);
	const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(temp, bytes, { flag: "wx" });
		await rename(temp, target);
	} catch (cause) {
		await rm(temp, { force: true });
		throw cause;
	}
	const runtime = options.runtime ?? {
		argv: process.argv,
		execArgv: process.execArgv,
		execPath: process.execPath
	};
	const profile = inferRunningProfile(runtime.argv);
	if (profile === void 0) throw new Error("更新包已下载并校验，但无法可靠识别当前 DSH profile；未执行安装");
	await (options.installPackage ?? ((name, packagePath) => runOfficialInstall(runtime, name, packagePath)))(profile, target);
	return {
		...status,
		hasUpdate: false,
		installed: true,
		staged: true,
		stagedAsset: asset.name,
		sha256: digest,
		profile,
		message: `v${status.latestVersion} 已安装到 ${profile} profile，重启 DSH 后生效。`
	};
}
function requestOriginAllowed(request) {
	const origin = request.headers.origin;
	const referer = request.headers.referer;
	if (origin === void 0 && referer === void 0) return true;
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "") return false;
	const allowed = /* @__PURE__ */ new Set([`http://${host}`, `https://${host}`]);
	for (const value of [origin, referer]) {
		if (value === void 0) continue;
		try {
			const url = new URL(value);
			if (!allowed.has(url.origin)) return false;
		} catch {
			return false;
		}
	}
	return true;
}
async function bodyWithinLimit(request) {
	const declared = request.headers["content-length"];
	if (declared !== void 0) {
		const length = Number(declared);
		if (!Number.isSafeInteger(length) || length < 0 || length > INSTALL_REQUEST_MAX_BYTES) return false;
	}
	let total = 0;
	for await (const chunk of request) {
		total += Buffer.byteLength(chunk);
		if (total > INSTALL_REQUEST_MAX_BYTES) return false;
	}
	return true;
}
function registerUpdateRoutes(ctx, options = {}) {
	ctx.webServer.register({
		kind: "exact",
		path: UPDATE_STATUS_PATH,
		handler: async (request, response) => {
			if (request.method !== "GET" && request.method !== "HEAD") {
				response.writeHead(405, { Allow: "GET, HEAD" });
				response.end();
				return;
			}
			try {
				const payload = await statusPayload();
				if (request.method === "HEAD") {
					response.writeHead(200, { "Cache-Control": "no-store" });
					response.end();
				} else json(response, 200, payload);
			} catch (cause) {
				json(response, 502, { error: {
					code: "UPDATE_CHECK_FAILED",
					message: cause instanceof Error ? cause.message : "检查更新失败"
				} });
			}
		}
	});
	ctx.webServer.register({
		kind: "exact",
		path: UPDATE_INSTALL_PATH,
		handler: async (request, response) => {
			if (request.method !== "POST") {
				response.writeHead(405, { Allow: "POST" });
				response.end();
				return;
			}
			if (!requestOriginAllowed(request)) {
				json(response, 403, { error: {
					code: "UPDATE_INSTALL_FORBIDDEN",
					message: "更新请求来源不受信任"
				} });
				return;
			}
			if (!await bodyWithinLimit(request)) {
				json(response, 413, { error: {
					code: "UPDATE_INSTALL_BODY_TOO_LARGE",
					message: "更新请求体超过大小限制"
				} });
				return;
			}
			try {
				json(response, 200, await installLatest(options));
			} catch (cause) {
				json(response, 502, { error: {
					code: "UPDATE_INSTALL_FAILED",
					message: cause instanceof Error ? cause.message : "安装更新失败"
				} });
			}
		}
	});
}
//#endregion
//#region plugins/dsh-token-monitor/src/assets.ts
const REPO_ROOT_MARKERS = ["packages", "assets"];
/**
* 从模块所在目录向上查找仓库根（同时包含 packages/ 与 assets/ 的目录）。
* 兼容两种运行面：源码直跑（src/assets.ts，tsx/vitest）与打包产物（lib/index.js），
* 二者都从插件目录向上 2 层到达仓库根，保证素材定位一致。
*/
function resolveTokenMonitorAssetRoot(moduleUrl = import.meta.url) {
	let dir = dirname(fileURLToPath(moduleUrl));
	for (let depth = 0; depth < 8; depth += 1) {
		if (REPO_ROOT_MARKERS.every((marker) => existsSync(join(dir, marker)))) return join(dir, "assets", "dsh-token-monitor");
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return resolve(dirname(fileURLToPath(moduleUrl)), "..", "assets", "dsh-token-monitor");
}
const ASSET_ROOT = resolveTokenMonitorAssetRoot();
const ROUTES = [{
	route: "/assets/dsh-token-monitor/whale-girl",
	directory: "whale-girl"
}, {
	route: "/assets/dsh-token-monitor/settings-ui/cute",
	directory: "settings-ui/cute"
}];
function assetHandler(route, directory) {
	const root = resolve(ASSET_ROOT, directory);
	return async (request, response) => {
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.writeHead(405, {
				Allow: "GET, HEAD",
				"Cache-Control": "no-store"
			});
			response.end();
			return;
		}
		let pathname;
		try {
			pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
		} catch {
			response.writeHead(400, { "Cache-Control": "no-store" });
			response.end();
			return;
		}
		const requested = pathname.startsWith(`${route}/`) ? pathname.slice(route.length + 1) : "";
		if (!requested.endsWith(".png") || requested.split("/").some((part) => !/^[A-Za-z0-9._-]+$/.test(part))) {
			response.writeHead(404, {
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff"
			});
			response.end();
			return;
		}
		const target = resolve(root, ...requested.split("/"));
		const local = relative(root, target);
		if (local.startsWith(`..${sep}`) || local === ".." || local === "") {
			response.writeHead(404, {
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff"
			});
			response.end();
			return;
		}
		try {
			const body = await readFile(target);
			response.writeHead(200, {
				"Content-Type": "image/png",
				"Content-Length": body.byteLength,
				"Cache-Control": "public, max-age=31536000, immutable",
				"X-Content-Type-Options": "nosniff"
			});
			response.end(request.method === "HEAD" ? void 0 : body);
		} catch {
			response.writeHead(404, {
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff"
			});
			response.end();
		}
	};
}
/** Register the two package-owned PNG trees required by the Client. */
function registerTokenMonitorAssetRoutes(ctx) {
	for (const entry of ROUTES) ctx.webServer.register({
		kind: "prefix",
		path: entry.route,
		handler: assetHandler(entry.route, entry.directory)
	});
}
/** Backward-compatible entry point that retains the original single-route behavior. */
function registerWhaleAssetRoute(ctx) {
	const entry = ROUTES[0];
	ctx.webServer.register({
		kind: "prefix",
		path: entry.route,
		handler: assetHandler(entry.route, entry.directory)
	});
}
//#endregion
//#region plugins/dsh-token-monitor/src/migration.ts
function isPromiseLike(value) {
	return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
function isMissingEventsContractError(error) {
	return error instanceof TypeError && error.message.includes("undefined") && error.message.includes("at");
}
/**
* 0.1.0/0.1.1 的 coldSnapshot(id) 为异步持久化冷读；0.1.2-alpha.1
* 改为同步 coldSnapshot(meta, events)。旧契约返回 Promise；新版按旧契约调用时
* 会在读取缺失 events 前同步抛错，此时再读取完整 inspection 并切换到新契约。
*/
async function rebuildTokenCostSnapshot(ctx, sessionId) {
	const coldSnapshot = ctx.sessionProjectionCache.coldSnapshot;
	let legacyResult;
	try {
		legacyResult = coldSnapshot.call(ctx.sessionProjectionCache, sessionId);
	} catch (error) {
		if (!isMissingEventsContractError(error)) throw error;
		const inspection = await ctx.sessionPersistence.inspect(sessionId);
		coldSnapshot.call(ctx.sessionProjectionCache, inspection.meta, inspection.events);
		return;
	}
	if (isPromiseLike(legacyResult)) await legacyResult;
}
/** 为缺失 tokenCost 投影的历史会话触发一次兼容宿主版本的冷读重建。 */
async function migrateMissingTokenCost(ctx) {
	try {
		const headers = await ctx.sessionPersistence.list();
		let migrated = 0;
		for (const header of headers) {
			if (ctx.sessionProjectionCache.cachedSnapshot(header)?.values.tokenCost !== void 0) continue;
			await rebuildTokenCostSnapshot(ctx, header.id);
			migrated++;
		}
		if (migrated > 0) console.log(`[dsh-token-monitor] 已为 ${migrated} 个历史会话重建 tokenCost 投影`);
	} catch (error) {
		console.warn(`[dsh-token-monitor] 历史会话投影迁移失败: ${String(error)}`);
	}
}
//#endregion
//#region plugins/dsh-token-monitor/src/index.ts
const name = "dsh-token-monitor";
const inject = ["sessions", "credentials"];
/** Dynamic master gate shared by budget, peak-period, and cache anomaly delivery. */
function createGatedWechatSender(isEnabled, getSender) {
	return { async send(message) {
		const sender = getSender();
		if (!isEnabled() || sender === void 0) return { ok: true };
		return await sender.send(message);
	} };
}
const DEFAULT_C2_RUNTIME_SETTINGS = Object.freeze({
	dailyBudgetEnabled: DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetEnabled,
	dailyBudgetCny: DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetCny,
	budgetExceededNotificationEnabled: DEFAULT_TOKEN_MONITOR_SETTINGS.budgetExceededNotificationEnabled,
	peakReminderEnabled: DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnabled,
	peakReminderEnterPeak: DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterPeak,
	peakReminderEnterValley: DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterValley,
	wechatNotificationsEnabled: DEFAULT_TOKEN_MONITOR_SETTINGS.wechatNotificationsEnabled,
	cacheHitAnomalyNotificationEnabled: DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyNotificationEnabled,
	cacheHitAnomalyThreshold: DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyThreshold,
	cacheHitAnomalyConsecutiveCalls: DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyConsecutiveCalls
});
const readDefaultC2Settings = () => DEFAULT_C2_RUNTIME_SETTINGS;
function apply(ctx) {
	console.log("[dsh-token-monitor] plugin loaded");
	installBundledWechat(ctx);
	registerWechatTools(ctx);
	provideTokenMonitorWechat(ctx);
	let priceTable = PRICE_TABLE;
	let readC2Settings = readDefaultC2Settings;
	ctx.inject(["settings"], async (settingsCtx) => {
		const registration = registerTokenMonitorSettings(settingsCtx.settings);
		const section = registration.scope.get();
		const readScopeSettings = () => registration.scope.get();
		readC2Settings = readScopeSettings;
		settingsCtx.effect(() => () => {
			if (readC2Settings === readScopeSettings) readC2Settings = readDefaultC2Settings;
		}, "dsh-token-monitor: C2 runtime settings");
		if (section.priceTable !== void 0) {
			priceTable = section.priceTable;
			console.log(`[dsh-token-monitor] 使用 settings 价格表 v${priceTable.version}`);
		}
		console.log(`[dsh-token-monitor] 使用每日预算 CNY ${section.dailyBudgetCny.toFixed(2)}`);
		await registration.ready;
		settingsCtx.inject(["webServer"], (webCtx) => {
			registerTokenMonitorSettingsRoute(webCtx, registration);
			console.log("[dsh-token-monitor] settings route registered");
		});
	});
	const storage = new UsageStorage((record) => resolvePricingEligibility(record.provider, record.model, record.timestamp, priceTable) !== void 0);
	const notificationEvents = new NotificationEventBuffer();
	let wechatSender;
	const gatedWechatSender = createGatedWechatSender(() => readC2Settings().wechatNotificationsEnabled, () => wechatSender);
	const cacheHitAnomalyDetector = createCacheHitAnomalyDetector(() => ({
		enabled: readC2Settings().cacheHitAnomalyNotificationEnabled,
		thresholdPercent: readC2Settings().cacheHitAnomalyThreshold,
		consecutiveCalls: readC2Settings().cacheHitAnomalyConsecutiveCalls
	}));
	attachCollector(ctx, storage, priceTable, { onPersistedRecord: (record) => {
		const anomaly = cacheHitAnomalyDetector.observe(record);
		if (anomaly !== void 0) {
			if (notificationEvents.publish(createCacheHitAnomalyNotification(anomaly)) !== void 0) gatedWechatSender.send(formatCacheHitAnomalyMessage(anomaly)).catch((error) => {
				console.warn(`[dsh-token-monitor] 缓存命中异常微信通知发送失败: ${String(error)}`);
			});
		}
	} });
	const balance = attachBalance(ctx);
	attachPeakBoundaryReminder(ctx, gatedWechatSender, {
		settings: () => readC2Settings(),
		onTransition: (transition) => {
			notificationEvents.publish(createPeakTransitionNotification(transition));
		}
	});
	attachBudgetThresholdNotifications(ctx, storage, () => readC2Settings(), gatedWechatSender, { onCrossing: (crossing, observedAt) => {
		notificationEvents.publish(createBudgetThresholdNotification(crossing, observedAt));
	} });
	ctx.inject(["wechatNotify"], (notifyCtx) => {
		const sender = notifyCtx.wechatNotify;
		wechatSender = sender;
		notifyCtx.effect(() => () => {
			if (wechatSender === sender) wechatSender = void 0;
		}, "dsh-token-monitor: optional wechat sender");
	});
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		projectionCtx.sessionProjections.register(createTokenCostProjectionDefinition(priceTable));
		console.log("[dsh-token-monitor] tokenCost projection registered");
	});
	ctx.inject([
		"sessionProjections",
		"sessionProjectionCache",
		"sessionPersistence"
	], async (migrateCtx) => {
		await migrateMissingTokenCost(migrateCtx);
	});
	ctx.inject(["webServer"], (webCtx) => {
		registerTokenMonitorAssetRoutes(webCtx);
		console.log("[dsh-token-monitor] asset routes registered");
		registerBalanceRoute(webCtx, balance);
		console.log("[dsh-token-monitor] balance route registered");
		webCtx.webServer.register({
			kind: "exact",
			path: "/api/token-monitor/usage",
			handler: (req, res) => {
				const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("sessionId") ?? void 0;
				const records = storage.history(sessionId);
				res.writeHead(200, {
					"Content-Type": "application/json",
					"Cache-Control": "no-store"
				});
				res.end(JSON.stringify(records));
			}
		});
		console.log("[dsh-token-monitor] usage route registered");
		webCtx.webServer.register({
			kind: "exact",
			path: "/api/token-monitor/today-spend",
			handler: (_req, res) => {
				res.writeHead(200, {
					"Content-Type": "application/json",
					"Cache-Control": "no-store"
				});
				res.end(JSON.stringify(storage.todaySpend()));
			}
		});
		console.log("[dsh-token-monitor] today-spend route registered");
		webCtx.webServer.register({
			kind: "exact",
			path: "/api/token-monitor/usage-summary",
			handler: (req, res) => {
				const rawRange = new URL(req.url ?? "/", "http://localhost").searchParams.get("range") ?? "today";
				const range = (/* @__PURE__ */ new Set([
					"all",
					"30d",
					"7d",
					"today"
				])).has(rawRange) ? rawRange : void 0;
				const summary = range === void 0 ? void 0 : summarizeUsage(storage.history(), range, Date.now());
				const origin = req.headers.origin;
				const cors = origin === "http://127.0.0.1:18765" || origin === "http://localhost:18765" ? {
					"Access-Control-Allow-Origin": origin,
					Vary: "Origin"
				} : {};
				res.writeHead(summary === void 0 ? 400 : 200, {
					"Content-Type": "application/json",
					"Cache-Control": "no-store",
					...cors
				});
				res.end(JSON.stringify(summary === void 0 ? { error: {
					code: "INVALID_RANGE",
					message: "range 必须是 all、30d、7d 或 today"
				} } : summary));
			}
		});
		console.log("[dsh-token-monitor] usage-summary route registered");
		registerBudgetRoutes(webCtx, storage, () => readC2Settings().dailyBudgetCny, priceTable);
		console.log("[dsh-token-monitor] daily budget and pricing eligibility routes registered");
		registerNotificationEventsRoute(webCtx, notificationEvents);
		console.log("[dsh-token-monitor] notification events route registered");
		registerUpdateRoutes(webCtx);
		console.log("[dsh-token-monitor] update routes registered");
		registerChargeEventsRoute(webCtx);
		console.log("[dsh-token-monitor] charge-events route registered");
	});
	ctx.inject([
		"wechatConnection",
		"wechatNotify",
		"webServer"
	], (wechatCtx) => {
		const connection = wechatCtx.wechatConnection;
		registerWechatRoutes(wechatCtx, {
			status: () => connection.status(),
			login: () => connection.login(),
			confirmLogin: (sessionId) => connection.confirmLogin(sessionId),
			reconnect: () => connection.reconnect(),
			disconnect: (confirm) => connection.disconnect(confirm),
			testMessage: (message) => wechatCtx.wechatNotify.send(message)
		});
		console.log("[dsh-token-monitor] wechat connection routes registered");
	});
}
//#endregion
export { apply, createGatedWechatSender, inject, name, registerWhaleAssetRoute };
