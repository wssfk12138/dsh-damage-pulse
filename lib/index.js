import { constants, existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { access, copyFile, lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { withFileLock } from "@deepseek-ai/dsh-atomic-write";
import { createHash, randomUUID } from "node:crypto";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { createServer } from "node:net";
import z from "@deepseek-ai/schemastery";
//#region plugins/dsh-token-monitor/src/module-files.ts
/** Confined artifact I/O shared by uninstall and release installation. No shell commands. */
const ROOTS = /* @__PURE__ */ new Set([
	"host",
	"client",
	"assets"
]);
const MAX_BYTES = 262144e3;
const validModuleId = (id) => typeof id === "string" && /^[a-z][a-z0-9-]{0,47}$/.test(id) && ![
	"core",
	"plugin",
	"constructor",
	"prototype"
].includes(id);
const validReleaseVersion = (version) => typeof version === "string" && version.length < 48 && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version);
function compareReleaseVersions(a, b) {
	if (!validReleaseVersion(a) || !validReleaseVersion(b)) throw new Error("INVALID_RELEASE_VERSION");
	const left = a.split(".").map(BigInt), right = b.split(".").map(BigInt);
	for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
	return 0;
}
function validateManifest(value) {
	const v = value;
	if (!v || v.schemaVersion !== 1 || !validReleaseVersion(v.version) || !Array.isArray(v.core) || !v.core.length || !Array.isArray(v.modules) || v.modules.length > 64) throw new Error("INVALID_MODULE_MANIFEST");
	const ids = /* @__PURE__ */ new Set(), paths = /* @__PURE__ */ new Set();
	let size = 0, count = 0;
	const files = (list) => {
		if (!Array.isArray(list) || !list.length) throw new Error("EMPTY_MODULE_ARTIFACTS");
		for (const f of list) {
			if (!f || !ROOTS.has(f.root) || typeof f.path !== "string" || f.path.length > 240 || isAbsolute(f.path) || f.path.split("/").some((p) => !p || p === "." || p === ".." || /[\\:\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0) throw new Error("INVALID_MODULE_ARTIFACT");
			const key = `${f.root}/${f.path}`.toLowerCase();
			if (paths.has(key)) throw new Error("DUPLICATE_MODULE_ARTIFACT");
			paths.add(key);
			size += f.size;
			if (size > MAX_BYTES || ++count > 2e4) throw new Error("MODULE_RELEASE_TOO_LARGE");
		}
	};
	files(v.core);
	for (const m of v.modules) {
		if (!m || !validModuleId(m.id) || ids.has(m.id)) throw new Error("INVALID_MODULE_ID");
		ids.add(m.id);
		files(m.files);
	}
	return structuredClone(v);
}
/** Reject every link-shaped ancestor, including the target. Never recurse during deletion. */
async function confinedPath(root, file) {
	const base = resolve(root), target = resolve(base, file);
	const rel = relative(base, target);
	if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("ARTIFACT_OUTSIDE_ROOT");
	let current = base;
	for (const part of ["", ...rel.split(sep)]) {
		if (part) current = resolve(current, part);
		try {
			if ((await lstat(current)).isSymbolicLink()) throw new Error("ARTIFACT_LINK_REFUSED");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	return target;
}
async function removeArtifact(roots, file) {
	const target = await confinedPath(roots[file.root], file.path);
	try {
		await unlink(target);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}
async function verifyArtifact(roots, file) {
	const target = await confinedPath(roots[file.root], file.path);
	const stat = await lstat(target);
	if (!stat.isFile() || stat.size !== file.size || stat.size > MAX_BYTES) throw new Error("ARTIFACT_DIGEST_MISMATCH");
	const bytes = await readFile(target);
	if (bytes.length !== file.size || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("ARTIFACT_DIGEST_MISMATCH");
}
/** Same-directory rename is the commit point; the temporary file is never a recovery package. */
async function atomicJson(file, value) {
	await mkdir(dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, JSON.stringify(value, null, 2) + "\n", {
			flag: "wx",
			mode: 384
		});
		await rename(temp, file);
	} finally {
		await unlink(temp).catch((error) => {
			if (error.code !== "ENOENT") throw error;
		});
	}
}
//#endregion
//#region plugins/dsh-token-monitor/src/module-transaction.ts
var ModuleRollbackError = class extends Error {
	constructor() {
		super("MODULE_ROLLBACK_PENDING");
	}
};
/** The new state is durable; callers must not restore an older in-memory release. */
var ModuleCommittedError = class extends Error {
	constructor() {
		super("MODULE_COMMITTED_RESTART_REQUIRED");
	}
};
async function missing(file) {
	try {
		if (!(await lstat(file)).isFile()) throw new Error("ARTIFACT_NOT_FILE");
		return false;
	} catch (error) {
		if (error.code === "ENOENT") return true;
		throw error;
	}
}
async function unlinkIfPresent(file) {
	try {
		await unlink(file);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}
async function directoryFor(stateFile, id) {
	if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error("INVALID_TRANSACTION_ID");
	return confinedPath(dirname(stateFile), `module-transaction-${id}`);
}
async function temporary(roots, entry, id) {
	return confinedPath(roots[entry.file.root], `${entry.file.path}.${id}.tmp`);
}
async function clean(stateFile, roots, journal) {
	const directory = await directoryFor(stateFile, journal.id);
	for (let i = 0; i < journal.entries.length; i++) {
		await unlinkIfPresent(await confinedPath(directory, `${i}.old`));
		await unlinkIfPresent(await confinedPath(directory, `${i}.new`));
		await unlinkIfPresent(await temporary(roots, journal.entries[i], journal.id));
	}
	try {
		await rmdir(directory);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	await unlinkIfPresent(`${stateFile}.transaction.json`);
}
async function replaceFile(source, target, temp) {
	await mkdir(dirname(target), { recursive: true });
	await unlinkIfPresent(temp);
	await copyFile(source, temp, constants.COPYFILE_EXCL);
	await rename(temp, target);
}
async function rollback(stateFile, roots, journal) {
	const directory = await directoryFor(stateFile, journal.id);
	journal.phase = "rolling-back";
	await atomicJson(`${stateFile}.transaction.json`, journal);
	for (let i = 0; i < journal.entries.length; i++) {
		const entry = journal.entries[i], target = await confinedPath(roots[entry.file.root], entry.file.path);
		if (entry.existed) {
			const backup = await confinedPath(directory, `${i}.old`);
			if (await missing(backup)) throw new ModuleRollbackError();
			await replaceFile(backup, target, await temporary(roots, entry, journal.id));
		} else await unlinkIfPresent(target);
	}
	await atomicJson(stateFile, JSON.parse(journal.previousState));
	journal.phase = "rolled-back";
	await atomicJson(`${stateFile}.transaction.json`, journal);
	await clean(stateFile, roots, journal);
}
async function readJournal(stateFile) {
	const path = `${stateFile}.transaction.json`;
	try {
		const stat = await lstat(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16777216) throw new Error("INVALID_TRANSACTION_JOURNAL");
		const journal = JSON.parse(await readFile(path, "utf8"));
		if (!journal || journal.schemaVersion !== 1 || typeof journal.previousState !== "string" || ![
			"preparing",
			"replacing",
			"committing",
			"rolling-back",
			"rolled-back"
		].includes(journal.phase) || !Array.isArray(journal.entries) || !journal.entries.length || journal.entries.some((e) => !e || typeof e.existed !== "boolean" || typeof e.remove !== "boolean")) throw new Error("INVALID_TRANSACTION_JOURNAL");
		validateManifest({
			schemaVersion: 1,
			version: "0.0.0",
			core: journal.entries.map((e) => e.file),
			modules: []
		});
		await directoryFor(stateFile, journal.id);
		const previous = JSON.parse(journal.previousState);
		if (previous?.schemaVersion !== 1 || !Number.isSafeInteger(previous.revision)) throw new Error("INVALID_TRANSACTION_STATE");
		if (journal.phase === "committing" && typeof journal.nextState !== "string") throw new Error("INVALID_TRANSACTION_STATE");
		return journal;
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
}
/** Caller holds the writer lock; recovery never starts a partially replaced release. */
async function recoverModuleTransaction(stateFile, roots) {
	const journal = await readJournal(stateFile);
	if (!journal) return;
	const current = JSON.stringify(JSON.parse(await readFile(stateFile, "utf8")));
	if (journal.phase === "committing" && current === journal.nextState) {
		await clean(stateFile, roots, journal);
		return;
	}
	if (current !== JSON.stringify(JSON.parse(journal.previousState))) throw new Error("TRANSACTION_STATE_CONFLICT");
	if (journal.phase === "preparing" || journal.phase === "rolled-back") await clean(stateFile, roots, journal);
	else await rollback(stateFile, roots, journal);
}
//#endregion
//#region plugins/dsh-token-monitor/src/module-manager.ts
function validRemoval(record) {
	return !!record && typeof record.pending === "boolean" && typeof record.preserveData === "boolean" && [
		record.preserveConfig,
		record.preserveHistory,
		record.erased
	].every((value) => value === void 0 || typeof value === "boolean");
}
var ModuleOperationError = class extends Error {
	code;
	httpStatus;
	constructor(code, httpStatus = 409) {
		super(code);
		this.code = code;
		this.httpStatus = httpStatus;
	}
};
/** One authoritative state file and one operation lock govern every destructive action. */
var ModuleManager = class ModuleManager {
	manifest;
	state;
	stateFile;
	roots;
	lifecycle;
	busy = false;
	unavailable = /* @__PURE__ */ new Set();
	cleanupErrors = /* @__PURE__ */ new Map();
	constructor(manifest, state, stateFile, roots, lifecycle) {
		this.manifest = manifest;
		this.state = state;
		this.stateFile = stateFile;
		this.roots = roots;
		this.lifecycle = lifecycle;
	}
	static async open(manifest, stateFile, roots, lifecycle) {
		await mkdir(dirname(stateFile), { recursive: true });
		return withFileLock(stateFile, () => this.openLocked(manifest, stateFile, roots, lifecycle));
	}
	static async openLocked(manifest, stateFile, roots, lifecycle) {
		await recoverModuleTransaction(stateFile, roots);
		const release = validateManifest(manifest);
		let state;
		try {
			state = JSON.parse(await readFile(stateFile, "utf8"));
			if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !validReleaseVersion(state.version) || compareReleaseVersions(state.version, release.version) > 0 || !state.removed || typeof state.removed !== "object" || Array.isArray(state.removed) || typeof state.restartRequired !== "boolean") throw new Error("INVALID_MODULE_STATE");
			for (const [id, record] of Object.entries(state.removed)) if (!validModuleId(id) || !validRemoval(record)) throw new Error("INVALID_MODULE_STATE");
			if (state.wholePlugin && !validRemoval(state.wholePlugin)) throw new Error("INVALID_MODULE_STATE");
			if (state.manifest) {
				const previous = validateManifest(state.manifest);
				if (previous.version !== state.version || state.version === release.version && !sameManifest(previous, release)) throw new Error("RELEASE_CONTENT_CHANGED");
			}
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			state = {
				schemaVersion: 1,
				revision: 0,
				version: release.version,
				removed: {},
				restartRequired: false,
				manifest: release
			};
			await atomicJson(stateFile, state);
		}
		if (state.version !== release.version) {
			state.version = release.version;
			state.manifest = release;
			state.restartRequired = false;
			state.revision++;
			await atomicJson(stateFile, state);
		}
		const manager = new ModuleManager(release, state, stateFile, roots, lifecycle);
		if (state.wholePlugin) await lifecycle.stopCore();
		for (const id of Object.keys(state.removed)) await manager.finishRemoval(id);
		if (state.wholePlugin) await manager.finishRemoval("plugin");
		for (const module of release.modules) {
			if (state.removed[module.id] || state.wholePlugin) continue;
			try {
				for (const file of module.files) await verifyArtifact(roots, file);
			} catch {
				manager.unavailable.add(module.id);
			}
		}
		if (!state.wholePlugin) for (const file of release.core) await verifyArtifact(roots, file);
		if (state.restartRequired && !state.wholePlugin && !manager.unavailable.size) {
			state.restartRequired = false;
			state.revision++;
			await manager.save();
		}
		return manager;
	}
	isInstalled(id) {
		return !this.state.wholePlugin && !this.state.removed[id] && !this.unavailable.has(id) && this.manifest.modules.some((m) => m.id === id);
	}
	/** Includes tombstones for modules absent from an intermediate release. */
	autoInstallBlocked(id) {
		return !!this.state.wholePlugin || !!this.state.removed[id];
	}
	snapshot() {
		return {
			schemaVersion: 1,
			revision: this.state.revision,
			version: this.state.version,
			pluginRemoved: !!this.state.wholePlugin,
			restartRequired: this.state.restartRequired,
			...this.state.wholePlugin?.pending ? { cleanupPending: true } : {},
			...this.cleanupErrors.size ? { cleanupErrors: [...this.cleanupErrors.values()] } : {},
			modules: this.manifest.modules.map(({ id }) => {
				const removal = this.state.wholePlugin ?? this.state.removed[id];
				return {
					id,
					autoInstallBlocked: !!removal,
					status: removal ? removal.pending ? "pending-delete" : "removed" : this.unavailable.has(id) ? "unavailable" : "installed"
				};
			})
		};
	}
	async uninstall(request) {
		return this.exclusive(request.expectedRevision, async () => {
			if (this.state.wholePlugin && !request.wholePlugin) throw new ModuleOperationError("PLUGIN_REMOVED");
			if (this.state.restartRequired) throw new ModuleOperationError("PLUGIN_RESTART_REQUIRED");
			if (typeof request.preserveData !== "boolean" || [
				request.preserveConfig,
				request.preserveHistory,
				request.wholePlugin
			].some((value) => value !== void 0 && typeof value !== "boolean") || !Array.isArray(request.ids) || request.ids.length > 64 || request.ids.some((id) => !this.manifest.modules.some((m) => m.id === id)) || !request.wholePlugin && !request.ids.length) throw new ModuleOperationError("INVALID_MODULE_REQUEST", 400);
			const ids = request.wholePlugin ? this.manifest.modules.map((m) => m.id) : [...new Set(request.ids)];
			if (!request.wholePlugin && ids.some((id) => this.state.removed[id] && !this.state.removed[id].pending)) throw new ModuleOperationError("MODULE_ALREADY_REMOVED");
			const previous = structuredClone(this.state);
			const record = {
				preserveData: request.preserveData,
				preserveConfig: request.preserveConfig ?? request.preserveData,
				preserveHistory: request.preserveHistory ?? request.preserveData,
				pending: true
			};
			for (const id of ids) this.state.removed[id] ??= { ...record };
			if (request.wholePlugin) this.state.wholePlugin ??= { ...record };
			this.state.revision++;
			try {
				await this.save();
			} catch (error) {
				this.state = previous;
				throw error;
			}
			if (request.wholePlugin) try {
				await this.lifecycle.stopCore();
			} catch {
				this.cleanupErrors.set("plugin", "PLUGIN_STOP_FAILED");
				return this.snapshot();
			}
			for (const id of ids) await this.finishRemoval(id);
			if (request.wholePlugin) await this.finishRemoval("plugin");
			return this.snapshot();
		});
	}
	async finishRemoval(id) {
		const record = id === "plugin" ? this.state.wholePlugin : this.state.removed[id];
		if (!record) return;
		const files = id === "plugin" ? this.manifest.core : this.manifest.modules.find((m) => m.id === id)?.files ?? [];
		record.pending = true;
		this.cleanupErrors.delete(id);
		try {
			if (id === "plugin" && Object.values(this.state.removed).some((item) => item.pending)) return;
			if (id !== "plugin") await this.lifecycle.stop(id);
			const configuration = !(record.preserveConfig ?? record.preserveData), history = !(record.preserveHistory ?? record.preserveData);
			if (!record.erased) {
				if (configuration || history) await this.lifecycle.eraseData(id, {
					configuration,
					history
				});
				record.erased = true;
				await this.save();
			}
			let failed = false;
			for (const file of files) try {
				await removeArtifact(this.roots, file);
			} catch {
				failed = true;
			}
			if (failed) this.cleanupErrors.set(id, `${id.toUpperCase()}_FILE_DELETE_PENDING`);
			record.pending = failed;
		} catch {
			this.cleanupErrors.set(id, `${id.toUpperCase()}_CLEANUP_PENDING`);
		}
		await this.save();
	}
	/** Called by the release transaction after all bytes and their hashes are validated. */
	async install(release, expectedRevision, restoreId, replace) {
		return this.exclusive(expectedRevision, async () => {
			if (this.state.wholePlugin) throw new ModuleOperationError("PLUGIN_REMOVED");
			if (this.state.restartRequired) throw new ModuleOperationError("PLUGIN_RESTART_REQUIRED");
			const next = validateManifest(release);
			if (compareReleaseVersions(next.version, this.state.version) < 0) throw new ModuleOperationError("MODULE_DOWNGRADE_REFUSED");
			const upgrade = next.version !== this.state.version;
			const owners = (manifest) => new Map([...manifest.core.map((f) => [`${f.root}/${f.path}`.toLowerCase(), "core"]), ...manifest.modules.flatMap((m) => m.files.map((f) => [`${f.root}/${f.path}`.toLowerCase(), m.id]))]);
			const previousOwners = owners(this.manifest);
			for (const [path, owner] of owners(next)) if (previousOwners.has(path) && previousOwners.get(path) !== owner) throw new ModuleOperationError("MODULE_FILE_OWNER_CHANGED");
			if (!upgrade && !sameManifest(next, this.manifest)) throw new ModuleOperationError("RELEASE_CONTENT_CHANGED");
			if (restoreId && !next.modules.some((m) => m.id === restoreId)) throw new ModuleOperationError("MODULE_NOT_IN_RELEASE");
			if (restoreId && this.state.removed[restoreId]?.pending) throw new ModuleOperationError("MODULE_CLEANUP_PENDING");
			if (restoreId && this.isInstalled(restoreId)) throw new ModuleOperationError("MODULE_ALREADY_INSTALLED");
			if (!upgrade && !restoreId) return this.snapshot();
			const selected = next.modules.filter((m) => m.id === restoreId || upgrade && !this.state.removed[m.id]);
			const files = [...upgrade ? next.core : [], ...selected.flatMap((m) => m.files)];
			const nextPaths = new Set([...next.core, ...next.modules.flatMap((m) => m.files)].map((f) => `${f.root}/${f.path}`.toLowerCase()));
			const obsolete = upgrade ? [...this.manifest.core, ...this.manifest.modules.flatMap((m) => m.files)].filter((f) => !nextPaths.has(`${f.root}/${f.path}`.toLowerCase())) : [];
			const previous = structuredClone(this.state), previousManifest = this.manifest;
			const stopped = [];
			let coreStopped = false;
			try {
				if (upgrade) {
					coreStopped = true;
					await this.lifecycle.stopCore();
					for (const module of this.manifest.modules) {
						if (!this.isInstalled(module.id)) continue;
						stopped.push(module.id);
						await this.lifecycle.stop(module.id);
					}
				}
				await replace(files, async (persist) => {
					for (const file of files) await verifyArtifact(this.roots, file);
					if (!upgrade && restoreId) try {
						await this.lifecycle.start(restoreId);
					} catch {
						await this.lifecycle.stop(restoreId);
						throw new ModuleOperationError("MODULE_ACTIVATION_FAILED", 500);
					}
					this.manifest = next;
					this.state.manifest = next;
					this.state.version = next.version;
					this.state.restartRequired = upgrade;
					if (restoreId) delete this.state.removed[restoreId];
					this.state.revision++;
					if (persist) await persist(this.state);
					else await this.save();
				}, obsolete);
			} catch (error) {
				if (error instanceof ModuleRollbackError || error instanceof ModuleCommittedError) {
					this.state.restartRequired = true;
					throw error;
				}
				this.state = previous;
				this.manifest = previousManifest;
				await this.save();
				if (!upgrade && restoreId) await this.lifecycle.stop(restoreId);
				for (const id of stopped) await this.lifecycle.start(id);
				if (coreStopped) await this.lifecycle.startCore();
				throw error;
			}
			for (const module of selected) this.unavailable.delete(module.id);
			return this.snapshot();
		});
	}
	save() {
		return atomicJson(this.stateFile, this.state);
	}
	async exclusive(revision, action) {
		if (this.busy) throw new ModuleOperationError("MODULE_OPERATION_BUSY");
		if (!Number.isSafeInteger(revision) || revision !== this.state.revision) throw new ModuleOperationError("MODULE_STATE_CONFLICT");
		this.busy = true;
		try {
			return await withFileLock(this.stateFile, async () => {
				const disk = JSON.parse(await readFile(this.stateFile, "utf8"));
				if (JSON.stringify(disk) !== JSON.stringify(this.state)) throw new ModuleOperationError("MODULE_STATE_CONFLICT");
				return action();
			});
		} finally {
			this.busy = false;
		}
	}
};
/** Release identity does not depend on JSON object or artifact listing order. */
function sameManifest(left, right) {
	const files = (items) => items.map((f) => [
		f.root,
		f.path,
		f.sha256,
		f.size
	]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	const canonical = (manifest) => JSON.stringify({
		version: manifest.version,
		core: files(manifest.core),
		modules: manifest.modules.map((m) => ({
			id: m.id,
			files: files(m.files)
		})).sort((a, b) => a.id.localeCompare(b.id))
	});
	return canonical(left) === canonical(right);
}
//#endregion
//#region plugins/dsh-token-monitor/src/module-cleanup.ts
async function eraseRemovedPlugin(ctx, dataDir, selection) {
	if (selection.configuration) {
		if (ctx.get("settings") !== void 0 && ctx.settings.describe().some((item) => item.ns === "dsh-token-monitor")) {
			const value = ctx.settings.describe().find((item) => item.ns === "dsh-token-monitor")?.value;
			const paths = (value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).filter((key) => key !== "providerNotifications") : []).map((key) => ({
				op: "unset",
				path: [key]
			}));
			if (value && typeof value === "object" && !Array.isArray(value) && "providerNotifications" in value) paths.push({
				op: "unset",
				path: ["providerNotifications"]
			});
			if (paths.length) await ctx.settings.mutate("dsh-token-monitor", paths);
		}
		for (const name of ["state.json", "state.json.lock"]) try {
			await unlink(await confinedPath(dataDir, name));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	if (selection.history) for (const name of ["usage.jsonl", "request-details.jsonl"]) try {
		await unlink(await confinedPath(dataDir, name));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}
//#endregion
//#region plugins/dsh-token-monitor/src/module-lease.ts
/** One OS-owned listener excludes competing runtimes; process exit releases it. */
/** Acquire before reading, recovering or importing release bytes; caller disposes on shutdown. */
async function acquireModuleLease(stateFile) {
	const identity = process.platform === "win32" ? resolve(stateFile).toLowerCase() : resolve(stateFile);
	const hash = createHash("sha256").update(identity).digest("hex");
	const server = createServer((socket) => socket.destroy());
	await new Promise((accept, reject) => {
		server.once("error", () => reject(/* @__PURE__ */ new Error("MODULE_RUNTIME_ALREADY_ACTIVE")));
		if (process.platform === "win32") server.listen(`\\\\.\\pipe\\dsh-token-monitor-${hash}`, accept);
		else server.listen({
			host: "127.0.0.1",
			port: 4e4 + parseInt(hash.slice(0, 4), 16) % 2e4,
			exclusive: true
		}, accept);
	});
	server.unref();
	return () => new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
}
/** Only the exclusive runtime may recover an operation lock whose recorded process is dead. */
async function recoverModuleLock(stateFile) {
	const lock = `${stateFile}.lock`;
	let owner;
	try {
		const stat = await lstat(lock);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32) throw new Error("MODULE_LOCK_RECOVERY_REQUIRED");
		owner = await readFile(lock, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	if (!/^[1-9][0-9]*\n$/.test(owner)) throw new Error("MODULE_LOCK_RECOVERY_REQUIRED");
	try {
		process.kill(Number(owner.trim()), 0);
	} catch (error) {
		if (error.code === "ESRCH") {
			await unlink(lock);
			return;
		}
		throw new Error("MODULE_LOCK_RECOVERY_REQUIRED");
	}
	throw new Error("MODULE_LOCK_OWNER_ACTIVE");
}
//#endregion
//#region plugins/dsh-token-monitor/src/module-bootstrap.ts
/**
* runtime/ is generated by the packaging step and is not tracked, so a source
* install that never ran it ships no payload. Check it before anything else so
* the loader reports the remedy instead of a bare ENOENT on the manifest path.
*/
async function assertInstalledPayload(runtime) {
	try {
		await access(resolve(runtime, "manifest.json"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		throw new Error("dsh-damage-pulse: the installed package carries no generated runtime/ payload (runtime/manifest.json is missing), so the plugin cannot start. Install the published package with `dsh plugin --profile <profile> add dsh-damage-pulse`, or build the payload in a source checkout before mounting it.");
	}
}
async function bootModules(ctx, pluginRoot, clientRoot) {
	const runtime = resolve(pluginRoot, "runtime");
	await assertInstalledPayload(runtime);
	const stateFile = resolve(pluginRoot, "..", "..", ".dsh-damage-pulse", "module-state.json");
	const legacyStateFile = resolve(runtime, "state.json");
	const roots = {
		host: resolve(runtime, "host"),
		assets: resolve(runtime, "assets"),
		client: clientRoot
	};
	await mkdir(dirname(stateFile), { recursive: true });
	const releaseLease = await acquireModuleLease(stateFile);
	ctx.effect(() => releaseLease, "token-monitor: exclusive installed runtime");
	await recoverModuleLock(stateFile);
	const { manifest, removed } = await withFileLock(stateFile, async () => {
		try {
			await readFile(stateFile, "utf8");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			try {
				await readFile(legacyStateFile + ".transaction.json", "utf8");
				throw new Error("LEGACY_MODULE_RECOVERY_REQUIRED");
			} catch (journalError) {
				if (journalError.code !== "ENOENT") throw journalError;
			}
			try {
				await atomicJson(stateFile, JSON.parse(await readFile(legacyStateFile, "utf8")));
			} catch (legacyError) {
				if (legacyError.code !== "ENOENT") throw legacyError;
			}
		}
		await recoverModuleTransaction(stateFile, roots);
		let state;
		try {
			state = JSON.parse(await readFile(stateFile, "utf8"));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		const manifest = validateManifest(JSON.parse(await readFile(resolve(runtime, "manifest.json"), "utf8")));
		if (!state?.wholePlugin) for (const file of manifest.core) await verifyArtifact(roots, file);
		return {
			manifest,
			removed: !!state?.wholePlugin
		};
	});
	if (removed) {
		await ModuleManager.open(manifest, stateFile, roots, {
			stop: async () => {},
			start: async () => {},
			stopCore: async () => {},
			startCore: async () => {},
			eraseData: async (id, selection) => {
				if (id === "plugin" && selection) await eraseRemovedPlugin(ctx, dshHomePath("data", "dsh-token-monitor"), selection);
			}
		});
		return;
	}
	await (await import(pathToFileURL(resolve(roots.host, "manager.mjs")).href + `?v=${manifest.version}`)).apply(ctx, {
		roots,
		stateFile,
		manifest
	});
}
//#endregion
//#region packages/util/token-monitor-contract/src/index.ts
/** Maximum daily budget accepted by Token Monitor settings validation. */
const TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY = 1e6;
/** Default values applied when no persisted Token Monitor settings exist. */
const DEFAULT_TOKEN_MONITOR_SETTINGS = Object.freeze({
	displayMode: "balance",
	showWhaleGirl: true,
	dailyBudgetEnabled: true,
	dailyBudgetCny: 10,
	budgetExceededNotificationEnabled: false,
	peakReminderEnabled: true,
	peakReminderEnterPeak: true,
	peakReminderEnterValley: true,
	notifyOncePerTransition: false,
	whaleBubbleEnabled: true,
	wechatNotificationsEnabled: true,
	cacheHitAnomalyNotificationEnabled: false,
	cacheHitAnomalyThreshold: 30,
	cacheHitAnomalyConsecutiveCalls: 3
});
Object.freeze([
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
//#endregion
//#region plugins/dsh-token-monitor/src/config-base.ts
/**
* 插件自身的 `Config` schema 基座：只放用户偏好，不放运行态账本。
*
* 0.1.7 起 settings 由「插件注册的独立文档」改成「插件自己的 Config schema +
* `volatile()` 标记 + 写回 profile patch」。仅有声明了 volatile 的字段才会出现在
* 设置面板里，也才能被写入；因此每个用户可见字段都必须显式下标记。
*
* 独立成模块是为了让不依赖 cordis 运行时的纯逻辑（校验、合成）能单独引用，
* 不把整个 loader 组合拖进消费方的图里。
* @module dsh-token-monitor/config-base
*/
const providerOverrides = z.dict(z.any());
/**
* 用户可见配置。字段与 {@link TokenMonitorSettings} 一一对应，默认值取自
* contract 里的 `DEFAULT_TOKEN_MONITOR_SETTINGS`，边界沿用迁移前的校验。
*/
const Config = z.object({
	displayMode: z.union(["balance", "spend"]).default(DEFAULT_TOKEN_MONITOR_SETTINGS.displayMode).volatile(),
	showWhaleGirl: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.showWhaleGirl).volatile(),
	dailyBudgetEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetEnabled).volatile(),
	dailyBudgetCny: z.number().min(Number.MIN_VALUE).max(TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY).default(DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetCny).volatile(),
	budgetExceededNotificationEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.budgetExceededNotificationEnabled).volatile(),
	peakReminderEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnabled).volatile(),
	peakReminderEnterPeak: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterPeak).volatile(),
	peakReminderEnterValley: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterValley).volatile(),
	notifyOncePerTransition: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.notifyOncePerTransition).volatile(),
	whaleBubbleEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.whaleBubbleEnabled).volatile(),
	wechatNotificationsEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.wechatNotificationsEnabled).volatile(),
	cacheHitAnomalyNotificationEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyNotificationEnabled).volatile(),
	cacheHitAnomalyThreshold: z.number().min(0).max(100).default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyThreshold).volatile(),
	cacheHitAnomalyConsecutiveCalls: z.number().min(2).max(20).default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyConsecutiveCalls).volatile(),
	/** 逐 provider 的提醒覆盖；对象递归合并，改一家不会清掉另一家。 */
	providerNotifications: providerOverrides.default({}).volatile()
});
Object.freeze({
	pet: Object.freeze(["showWhaleGirl"]),
	overview: Object.freeze(["displayMode"]),
	billing: Object.freeze([
		"billing",
		"balanceScripts",
		"balanceProviders",
		"balanceEndpoints",
		"balanceEndpointPolicyVersion"
	]),
	notify: Object.freeze([
		"dailyBudgetEnabled",
		"dailyBudgetCny",
		"budgetExceededNotificationEnabled",
		"peakReminderEnabled",
		"peakReminderEnterPeak",
		"peakReminderEnterValley",
		"notifyOncePerTransition",
		"whaleBubbleEnabled",
		"cacheHitAnomalyNotificationEnabled",
		"cacheHitAnomalyThreshold",
		"cacheHitAnomalyConsecutiveCalls"
	]),
	wechat: Object.freeze(["wechatNotificationsEnabled"])
});
Object.freeze([
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
	"cacheHitAnomalyConsecutiveCalls",
	"providerNotifications"
]);
Object.freeze([
	"schemaVersion",
	"priceTable",
	"billing",
	"balanceScripts",
	"balanceProviders",
	"balanceEndpoints",
	"balanceEndpointPolicyVersion"
]);
//#endregion
//#region plugins/dsh-token-monitor/src/index.ts
const name = "dsh-token-monitor";
const inject = [
	"sessions",
	"credentials",
	"settings"
];
/** Start the installed release; a whole-plugin tombstone leaves this loader inert.
* @param ctx Host-owned plugin lifetime.
*/
async function apply(ctx) {
	const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const sourceClient = resolve(pluginRoot, "../../packages/client/ui-token-monitor/lib");
	const runtimeClient = resolve(pluginRoot, "runtime/client");
	const packagedClient = resolve(pluginRoot, "lib");
	const isSourceTree = pluginRoot.replaceAll("\\", "/").endsWith("/plugins/dsh-token-monitor");
	await bootModules(ctx, pluginRoot, existsSync(runtimeClient) ? runtimeClient : isSourceTree ? sourceClient : packagedClient);
}
//#endregion
export { Config, apply, inject, name };
