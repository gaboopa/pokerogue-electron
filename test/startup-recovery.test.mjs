import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBackup } from "../src/backup.mjs";
import { createIntent, getCapturePaths, prepareResumeIntent, readCurrentIntent, transitionIntent } from "../src/backup-coordinator.mjs";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const harnessRoots = [];

test.after(async () => {
  await Promise.all(harnessRoots.map(root => rm(root, { recursive: true, force: true })));
});

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-startup-recovery-"));
  harnessRoots.push(root);
  const loader = join(root, "loader.mjs");
  const bootstrap = join(root, "bootstrap.mjs");
  const electron = join(root, "electron.mjs");
  const backup = join(root, "backup.mjs");
  const coordinator = join(root, "coordinator.mjs");
  const retention = join(root, "retention.mjs");
  const fsStub = join(root, "fs.mjs");
  const runner = join(root, "runner.mjs");
  await writeFile(loader, `export async function resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: new URL("./electron.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R05_MAIN_URL && specifier === "./backup.mjs") return { url: new URL("./backup.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R05_MAIN_URL && specifier === "./backup-coordinator.mjs") {
      if (process.env.R05_REAL_COORDINATOR) return nextResolve(specifier, context);
      return { url: new URL("./coordinator.mjs", import.meta.url).href, shortCircuit: true };
    }
    if (context.parentURL === process.env.R05_MAIN_URL && specifier === "./retention.mjs") return { url: new URL("./retention.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R05_MAIN_URL && specifier === "node:fs/promises") return { url: new URL("./fs.mjs", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }`);
  await writeFile(bootstrap, `import { register } from "node:module"; register(${JSON.stringify(pathToFileURL(loader).href)});`);
  await writeFile(electron, `let resolveStartup, rejectStartup, signalRestore, releaseRestore;
    const state = { windows: 0, urls: [], dialogs: [], quits: 0, opened: [], listeners: {}, onceListeners: {}, dialogResponses: JSON.parse(process.env.R05_DIALOG_RESPONSES || "[]"), startupPromise: new Promise((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; }), restoreStarted: new Promise(resolve => { signalRestore = resolve; }), restoreRelease: new Promise(resolve => { releaseRestore = resolve; }) };
    state.signalRestoreStarted = () => signalRestore(); state.releaseRestore = () => releaseRestore();
    globalThis.__r05 = state;
    export const app = { isPackaged: false, setName() {}, getAppPath() { return process.env.R05_APP_PATH; }, getPath(n) { return n === "userData" ? process.env.R05_USER_DATA : process.env.TEMP; }, getVersion() { return "test"; }, whenReady() { return { then(callback) { Promise.resolve().then(callback).then(resolveStartup, rejectStartup); return state.startupPromise; } }; }, on(name, fn) { state.listeners[name] = fn; }, once(name, fn) { (state.onceListeners[name] ??= []).push(fn); }, removeListener(name, fn) { state.onceListeners[name] = (state.onceListeners[name] ?? []).filter(item => item !== fn); }, relaunch() { state.relaunch = true; }, quit() { state.quits++; const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; const callbacks = state.onceListeners["will-quit"] ?? []; delete state.onceListeners["will-quit"]; for (const fn of callbacks) fn(event); } };
    export class BrowserWindow { constructor() { state.windows++; this.webContents = { setWindowOpenHandler() {}, on() {}, send() {}, toggleDevTools() {}, session: { flushStorageData: async () => {} } }; } static getAllWindows() { return Array.from({ length: state.windows }); } isDestroyed() { return false; } isVisible() { return true; } isFullScreen() { return false; } show() {} focus() {} hide() {} once() {} on() {} async loadURL(url) { state.urls.push(url); } async loadFile() {} reload() {} setFullScreen() {} }
    export const dialog = { async showMessageBox(...args) { const o = args.at(-1); state.dialogs.push({ title: o.title, message: o.message, detail: o.detail, buttons: o.buttons, cancelId: o.cancelId }); const choice = state.dialogResponses.length ? String(state.dialogResponses.shift()) : process.env.R05_DIALOG_RESPONSE ?? "default"; return { response: choice === "cancel" ? o.cancelId : choice === "default" ? o.defaultId : Number(choice) }; }, async showOpenDialog() { return { canceled: false, filePaths: [process.env.R05_NEW_SELECTION || ""] }; }, showErrorBox(title, message) { state.dialogs.push({ title, message }); } };
    export const ipcMain = { handle() {}, on() {} };
    export const Menu = { buildFromTemplate(v) { return v; }, setApplicationMenu() {} };
    export const protocol = { registerSchemesAsPrivileged() {}, handle() {} };
    export const session = { defaultSession: { webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {} } };
    export const shell = { async openPath(path) { state.opened.push(path); return ""; }, async openExternal() {} };`);
  await writeFile(backup, `import { appendFile, mkdir, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    export class BackupRestoreError extends Error { constructor(message, options = {}) { super(message, { cause: options.cause }); Object.assign(this, { recoveryRequired: false, recoveryPath: undefined, recoveryErrors: [], restored: false }, options); } }
    export async function validateBackup() {}
    export async function createBackup() { return process.env.R05_SAFETY_BACKUP; }
    export async function restoreBackup(userData, selected, { rollbackPath } = {}) {
      globalThis.__r05.signalRestoreStarted();
      if (process.env.R05_DELAY_RESTORE) await globalThis.__r05.restoreRelease;
      await appendFile(process.env.R05_ATTEMPTS, selected + "\\n");
      const mode = process.env.R05_MODE || "success";
      if (mode === "missing") throw Object.assign(new BackupRestoreError("selected Backup is missing (ENOENT)"), { code: "ENOENT" });
      if (mode === "invalid") throw new BackupRestoreError("Backup checksum verification failed");
      if (mode === "rolledback") throw new BackupRestoreError("restore failed; original Save data was restored");
      if (mode === "rolledbackCleanup") { const recoveryPath = rollbackPath || join(userData, ".restore-rollback-cleanup"); await mkdir(recoveryPath, { recursive: true }); throw new BackupRestoreError("Restore failed, but rollback completed; recovery cleanup failed", { recoveryPath }); }
      if (mode === "restoredCleanup") { const recoveryPath = rollbackPath || join(userData, ".restore-rollback-cleanup"); await mkdir(recoveryPath, { recursive: true }); await writeFile(join(recoveryPath, "preserved"), "original"); throw new BackupRestoreError("Restore completed, but recovery cleanup failed", { restored: true, recoveryPath }); }
      if (mode === "incomplete") { const recoveryPath = rollbackPath || join(userData, ".restore-rollback-test"); await mkdir(recoveryPath, { recursive: true }); await writeFile(join(recoveryPath, "preserved"), "original"); throw new BackupRestoreError("rollback failed", { recoveryRequired: true, recoveryPath }); }
    }`);
  await writeFile(coordinator, `let current = null;
    export const state = globalThis.__r05Coordinator = { created: [], transitions: [] };
    export async function recoverStaleIntentLock() { return false; }
    export async function readCurrentIntent() { return current; }
    export async function createIntent(input) { current = { token: "${"a".repeat(64)}", operation: input.operation, state: "requested", revision: 0, payload: input.payload, capturedBackupPath: null, failure: null }; state.created.push(current); return current; }
    export async function transitionIntent(input) { current = { ...current, state: input.nextState, revision: current.revision + 1, failure: input.failure ?? null }; state.transitions.push(current); return current; }
    export async function prepareResumeIntent() { throw new Error("The worker continuation is not run in this recovery harness"); }
    export async function revalidateResumingUpdate() { throw new Error("Unexpected Update continuation"); }
    export async function clearTerminalIntent() { current = null; return true; }`);
  await writeFile(retention, `export async function pruneAutomaticBackups() { return { removed: [], errors: [] }; }
    export async function pruneUpdateDownloads() { return { removed: [], errors: [] }; }`);
  await writeFile(fsStub, `import * as fs from "node:fs/promises";
    export const mkdir = fs.mkdir;
    export const readFile = async (p, ...a) => { if (process.env.R05_FAIL_READ && String(p).endsWith("pending-restore.json")) throw Object.assign(new Error("marker read failed"), { code: "EACCES" }); return fs.readFile(p, ...a); };
    export const writeFile = async (p, d, ...a) => { if (String(p).endsWith("pending-restore.json.tmp")) { const s = String(d); if (process.env.R05_FAIL_APPLY_WRITE && s.includes('"status":"applying"')) throw Object.assign(new Error("marker apply write failed"), { code: "EACCES" }); if (process.env.R05_FAIL_FAILED_WRITE && s.includes('"status":"failed"')) throw Object.assign(new Error("marker failed-state write failed"), { code: "EACCES" }); if (process.env.R05_FAIL_COMPLETED_WRITE && s.includes('"status":"completed"')) throw Object.assign(new Error("marker completed-state write failed"), { code: "EACCES" }); } return fs.writeFile(p, d, ...a); };
    export const rename = async (a, b) => { if (process.env.R05_FAIL_TRANSITION && String(b).endsWith("pending-restore.json")) throw Object.assign(new Error("marker transition failed"), { code: "EACCES" }); return fs.rename(a, b); };
    export const rm = async (p, ...a) => { if (process.env.R05_FAIL_REMOVE && String(p).endsWith("pending-restore.json")) throw Object.assign(new Error("marker remove failed"), { code: "EACCES" }); return fs.rm(p, ...a); };
    export const readdir = async (p, ...a) => { if (process.env.R05_FAIL_SCAN && String(p) === process.env.R05_USER_DATA) throw Object.assign(new Error("recovery-copy scan failed"), { code: "EACCES" }); return fs.readdir(p, ...a); };`);
  await writeFile(runner, `import { writeFile } from "node:fs/promises";
    async function bounded(promise, label) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + " timeout")), 5000); })]); } finally { clearTimeout(timer); } }
    await import(process.env.R05_MAIN_URL); const state = globalThis.__r05;
    if (process.env.R05_DELAY_RESTORE) { await bounded(state.restoreStarted, "restore start"); state.listeners.activate?.(); state.windowsDuringRestore = state.windows; state.releaseRestore(); }
    await bounded(state.startupPromise, "startup"); if (!process.env.R05_DELAY_RESTORE) state.listeners.activate?.(); state.coordinator = globalThis.__r05Coordinator; await writeFile(process.env.R05_RESULT, JSON.stringify(state));`);
  return { root, bootstrap, runner };
}

async function launch(h, userData, extra = {}) {
  const resultPath = join(userData, `result-${Math.random()}.json`);
  const mainUrl = pathToFileURL(join(repo, "src", "main.mjs")).href;
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(h.bootstrap).href, h.runner], { encoding: "utf8", timeout: 10000, env: { ...process.env, R05_MAIN_URL: mainUrl, R05_APP_PATH: repo, R05_USER_DATA: userData, R05_RESULT: resultPath, R05_ATTEMPTS: join(userData, "attempts.log"), R05_SAFETY_BACKUP: join(userData, "Save Backups", "safety"), ...extra } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(await readFile(resultPath, "utf8"));
}

async function pending(userData, selected, overrides = {}) {
  await mkdir(userData, { recursive: true });
  const marker = join(userData, "pending-restore.json");
  await writeFile(marker, JSON.stringify({ version: 1, status: "pending", selected, safetyBackup: join(userData, "Save Backups", "safety"), ...overrides }));
  return marker;
}

async function attempts(userData) {
  try { return (await readFile(join(userData, "attempts.log"), "utf8")).trim().split(/\r?\n/).filter(Boolean); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function seedSafeColdRestore(userData, root) {
  const oldSelected = await createBackup(userData, join(root, "old-selected"));
  const freshSelected = await createBackup(userData, join(root, "fresh-selected"));
  const old = await createIntent({ userData, operation: "restore", payload: { selectedBackup: oldSelected } });
  let current = await transitionIntent({ userData, expectedToken: old.token, expectedRevision: old.revision, nextState: "capturing" });
  const capture = getCapturePaths(userData, old);
  const oldCapture = await createBackup(userData, join(root, "old-capture"));
  await mkdir(capture.backupRoot, { recursive: true });
  await cp(oldCapture, capture.finalBackupPath, { recursive: true });
  current = await transitionIntent({ userData, expectedToken: old.token, expectedRevision: current.revision, nextState: "captured", capturedBackupPath: capture.finalBackupPath });
  current = (await prepareResumeIntent({ userData, expectedToken: current.token, expectedRevision: current.revision })).intent;
  await writeFile(join(userData, "pending-restore.json"), JSON.stringify({ version: 1, status: "failed", selected: oldSelected, safetyBackup: current.capturedBackupPath, coldToken: old.token, recoveryRequired: false, error: { message: "The previous Restore failed and its rollback completed." } }));
  return { old, freshSelected };
}

async function captureIntent(userData, intent) {
  let current = await transitionIntent({ userData, expectedToken: intent.token, expectedRevision: intent.revision, nextState: "capturing" });
  const capture = getCapturePaths(userData, intent);
  const published = await createBackup(userData, join(userData, "test-capture-stage"));
  await mkdir(capture.backupRoot, { recursive: true });
  await cp(published, capture.finalBackupPath, { recursive: true });
  current = await transitionIntent({ userData, expectedToken: intent.token, expectedRevision: current.revision, nextState: "captured", capturedBackupPath: capture.finalBackupPath });
  return current;
}

test("missing and corrupt Backups are marked failed once and startup continues", async () => {
  for (const mode of ["missing", "invalid", "rolledback"]) {
    const h = await harness();
    const userData = join(h.root, "user");
    const selected = join(h.root, `${mode}-backup`);
    const markerPath = await pending(userData, selected);
    const first = await launch(h, userData, { R05_MODE: mode });
    const failed = JSON.parse(await readFile(markerPath, "utf8"));
    assert.equal(failed.status, "failed", mode);
    assert.equal(failed.selected, selected);
    assert.equal(failed.safetyBackup, join(userData, "Save Backups", "safety"));
    assert.match(failed.error.message, /missing|checksum|restore failed/i);
    assert.equal(first.windows, 1, mode);
    assert.ok(first.urls.length > 0, mode);
    assert.ok(first.dialogs.some(d => d.buttons.includes("Choose another Backup")), mode);
    const second = await launch(h, userData, { R05_MODE: mode });
    assert.equal(second.windows, 1, mode);
    assert.deepEqual(await attempts(userData), [selected], mode);
  }
});

test("a successful restore consumes its marker once, including when removal initially fails", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  const selected = join(h.root, "good-backup");
  const markerPath = await pending(userData, selected);
  const first = await launch(h, userData, { R05_FAIL_REMOVE: "1" });
  assert.equal(first.windows, 1);
  assert.equal(JSON.parse(await readFile(markerPath, "utf8")).status, "completed");
  assert.ok(first.dialogs.some(d => d.title === "Backup restore completed with a warning"));
  const second = await launch(h, userData);
  assert.equal(second.windows, 1);
  assert.deepEqual(await attempts(userData), [selected]);
  await assert.rejects(readFile(markerPath), { code: "ENOENT" });
});

test("a completed restore with cleanup warnings is reported accurately and never retried", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  const selected = join(h.root, "selected");
  const markerPath = await pending(userData, selected);
  const first = await launch(h, userData, { R05_MODE: "restoredCleanup" });
  const warning = first.dialogs.find(d => d.title === "Backup restore completed with a warning");
  assert.ok(warning);
  assert.match(warning.message, /Backup was restored/i);
  assert.match(warning.detail, /restore completed, but recovery cleanup failed/i);
  assert.ok(warning.detail.includes(join(userData, ".restore-rollback-")));
  assert.equal(first.windows, 1);
  await assert.rejects(readFile(markerPath), { code: "ENOENT" });
  const second = await launch(h, userData);
  assert.equal(second.windows, 1);
  assert.deepEqual(await attempts(userData), [selected]);
});

test("a completed data rollback with cleanup failure permits startup without replay", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  const selected = join(h.root, "selected");
  const markerPath = await pending(userData, selected);
  const first = await launch(h, userData, { R05_MODE: "rolledbackCleanup" });
  const failed = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.recoveryRequired, false);
  assert.ok(failed.recoveryPath.startsWith(join(userData, ".restore-rollback-")));
  assert.equal(first.windows, 1);
  const second = await launch(h, userData);
  assert.equal(second.windows, 1);
  assert.deepEqual(await attempts(userData), [selected]);
});

test("activation during a delayed incomplete restore cannot open the game", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  const selected = join(h.root, "bad-backup");
  const markerPath = await pending(userData, selected);
  const first = await launch(h, userData, { R05_MODE: "incomplete", R05_DELAY_RESTORE: "1", R05_DIALOG_RESPONSE: "cancel" });
  const failed = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.recoveryRequired, true);
  assert.equal(failed.selected, selected);
  assert.equal(failed.safetyBackup, join(userData, "Save Backups", "safety"));
  assert.equal(first.windowsDuringRestore, 0);
  assert.equal(first.windows, 0);
  assert.equal(first.quits, 1);
  assert.deepEqual(first.urls, []);
  const recoveryDialog = first.dialogs.find(d => d.title === "Save recovery required");
  assert.ok(recoveryDialog.detail.includes(failed.safetyBackup));
  assert.ok(recoveryDialog.detail.includes(failed.recoveryPath));
  assert.equal(recoveryDialog.buttons.includes("Choose another Backup"), false);
  assert.equal(recoveryDialog.cancelId, 2);
  assert.equal(first.opened.length, 0);
  assert.equal(first.windows, 0, "activate must remain blocked after the recovery UI closes");
  assert.deepEqual(await attempts(userData), [selected]);
  const second = await launch(h, userData);
  assert.equal(second.windows, 0);
  assert.deepEqual(await attempts(userData), [selected]);
});

test("an interrupted applying marker shows retained copies and blocks retry", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  await mkdir(join(userData, ".restore-rollback-interrupted"), { recursive: true });
  await pending(userData, join(h.root, "selected"), { status: "applying" });
  const result = await launch(h, userData);
  assert.equal(result.windows, 0);
  assert.deepEqual(result.urls, []);
  assert.ok(result.dialogs[0].detail.includes(join(userData, ".restore-rollback-interrupted")));
  assert.deepEqual(await attempts(userData), []);
});

test("legacy pending requests with retained rollback copies are blocked and show their paths", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  await mkdir(userData, { recursive: true });
  const recoveryPath = join(userData, ".restore-rollback-legacy");
  await mkdir(recoveryPath);
  await writeFile(join(recoveryPath, "preserved"), "original");
  const markerPath = join(userData, "pending-restore.json");
  const selected = join(h.root, "legacy-selected");
  await writeFile(markerPath, JSON.stringify({ selected, safetyBackup: join(userData, "safety" ) }));
  const result = await launch(h, userData, { R05_DIALOG_RESPONSE: "cancel" });
  const failed = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.recoveryRequired, true);
  assert.ok(result.dialogs[0].detail.includes(recoveryPath));
  assert.equal(result.dialogs[0].buttons.includes("Choose another Backup"), false);
  assert.equal(result.dialogs[0].cancelId, 2);
  assert.equal(result.windows, 0);
  assert.deepEqual(await attempts(userData), []);
});

test("invalid markers with retained rollback copies stay blocked and show their paths", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  await mkdir(userData, { recursive: true });
  const recoveryPath = join(userData, ".restore-rollback-invalid-marker");
  await mkdir(recoveryPath);
  const markerPath = join(userData, "pending-restore.json");
  await writeFile(markerPath, JSON.stringify({ version: 99, status: "applying", selected: join(h.root, "selected"), safetyBackup: join(userData, "safety") }));
  const result = await launch(h, userData, { R05_DIALOG_RESPONSE: "cancel" });
  const failed = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(failed.recoveryRequired, true);
  assert.ok(result.dialogs[0].detail.includes(recoveryPath));
  assert.equal(result.windows, 0);
  assert.deepEqual(await attempts(userData), []);
});

test("failed markers without a valid recovery discriminator use scan-aware blocking", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  await mkdir(userData, { recursive: true });
  const recoveryPath = join(userData, ".restore-rollback-unknown-failure");
  await mkdir(recoveryPath);
  const markerPath = join(userData, "pending-restore.json");
  await writeFile(markerPath, JSON.stringify({ version: 1, status: "failed", selected: "selected", safetyBackup: "safety" }));
  const result = await launch(h, userData, { R05_DIALOG_RESPONSE: "cancel" });
  const failed = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(failed.recoveryRequired, true);
  assert.ok(result.dialogs[0].detail.includes(recoveryPath));
  assert.equal(result.windows, 0);
  assert.deepEqual(await attempts(userData), []);
});

test("marker read or transition failures fail closed before applying the Backup", async () => {
  for (const extra of [{ R05_FAIL_READ: "1" }, { R05_FAIL_APPLY_WRITE: "1" }, { R05_FAIL_TRANSITION: "1" }]) {
    const h = await harness();
    const userData = join(h.root, "user");
    await pending(userData, join(h.root, "selected"));
    const result = await launch(h, userData, extra);
    assert.equal(result.windows, 0);
    assert.deepEqual(result.urls, []);
    assert.deepEqual(await attempts(userData), []);
  }
});

test("failure-state write errors leave an applying marker that cannot replay", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  const selected = join(h.root, "selected");
  const markerPath = await pending(userData, selected);
  const first = await launch(h, userData, { R05_MODE: "missing", R05_FAIL_FAILED_WRITE: "1", R05_DIALOG_RESPONSE: "cancel" });
  assert.equal(first.windows, 0);
  assert.equal(first.relaunch, undefined, "cancel must quit instead of choosing another Backup");
  assert.equal(first.quits, 1);
  assert.equal(first.dialogs[0].cancelId, 3);
  assert.equal(JSON.parse(await readFile(markerPath, "utf8")).status, "applying");
  const second = await launch(h, userData);
  assert.equal(second.windows, 0);
  assert.deepEqual(await attempts(userData), [selected]);
});

test("completion write errors preserve an applying marker and never replay a successful restore", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  const selected = join(h.root, "selected");
  const markerPath = await pending(userData, selected);
  const first = await launch(h, userData, { R05_FAIL_COMPLETED_WRITE: "1" });
  assert.equal(first.windows, 0);
  assert.ok(first.dialogs[0].title.includes("status needs review"));
  assert.match(first.dialogs[0].message, /Backup was applied, but its completion could not be recorded/i);
  assert.equal(first.dialogs[0].buttons.includes("Choose another Backup"), false);
  assert.deepEqual(await attempts(userData), [selected]);
  assert.equal(JSON.parse(await readFile(markerPath, "utf8")).status, "applying");
  const second = await launch(h, userData);
  assert.equal(second.windows, 0);
  assert.deepEqual(await attempts(userData), [selected]);
});

test("malformed pending marker is recorded failed before a fresh cold restore is queued", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  await mkdir(userData, { recursive: true });
  const markerPath = join(userData, "pending-restore.json");
  await writeFile(markerPath, "{");
  const result = await launch(h, userData, { R05_DIALOG_RESPONSES: "[1,0]", R05_NEW_SELECTION: join(h.root, "fresh-backup") });
  assert.equal(result.relaunch, true);
  assert.equal(result.windows, 0, "a scheduled restart must not create a window in the old process");
  assert.deepEqual(result.urls, []);
  const preservedFailure = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(preservedFailure.status, "failed");
  assert.equal(preservedFailure.recoveryRequired, false);
  assert.equal(result.coordinator.created[0].operation, "restore");
  assert.equal(result.coordinator.created[0].payload.selectedBackup, join(h.root, "fresh-backup"));
});

test("failed recovery-copy scans make malformed, invalid, and legacy requests unknown", async () => {
  const markers = [
    "{",
    JSON.stringify({ version: 99, status: "applying", selected: "selected" }),
    JSON.stringify({ selected: "selected", safetyBackup: "safety" }),
  ];
  for (const value of markers) {
    const h = await harness();
    const userData = join(h.root, "user");
    await mkdir(userData, { recursive: true });
    await writeFile(join(userData, "pending-restore.json"), value);
    const result = await launch(h, userData, { R05_FAIL_SCAN: "1", R05_FAIL_FAILED_WRITE: "1", R05_DIALOG_RESPONSE: "cancel" });
    assert.equal(result.windows, 0);
    assert.deepEqual(await attempts(userData), []);
    assert.ok(result.dialogs[0].detail.includes("Could not scan for retained recovery copies"));
    assert.equal(result.dialogs[0].buttons.includes("Choose another Backup"), false);
  }
});

test("failed marker writes allow choosing fresh only when the recovery scan is clear", async () => {
  const clear = await harness();
  const clearUserData = join(clear.root, "user");
  await mkdir(clearUserData, { recursive: true });
  await writeFile(join(clearUserData, "pending-restore.json"), "{");
  const selected = join(clear.root, "fresh-backup");
  const clearResult = await launch(clear, clearUserData, { R05_FAIL_FAILED_WRITE: "1", R05_DIALOG_RESPONSES: "[2,0]", R05_NEW_SELECTION: selected });
  assert.equal(clearResult.relaunch, true);
  assert.ok(clearResult.dialogs[0].buttons.includes("Choose another Backup"));
  assert.equal(clearResult.coordinator.created[0].operation, "restore");
  assert.equal(clearResult.coordinator.created[0].payload.selectedBackup, selected);

  const retained = await harness();
  const retainedUserData = join(retained.root, "user");
  await mkdir(join(retainedUserData, ".restore-rollback-retained"), { recursive: true });
  await writeFile(join(retainedUserData, "pending-restore.json"), "{");
  const retainedResult = await launch(retained, retainedUserData, { R05_FAIL_FAILED_WRITE: "1", R05_DIALOG_RESPONSE: "2", R05_NEW_SELECTION: join(retained.root, "must-not-select") });
  assert.equal(retainedResult.relaunch, undefined);
  assert.equal(retainedResult.quits, 1);
  assert.equal(retainedResult.dialogs[0].buttons.includes("Choose another Backup"), false);
});

test("a safe failed cold Restore survives replacement approval until fresh capture resumes once", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  await mkdir(userData, { recursive: true });
  const { old, freshSelected } = await seedSafeColdRestore(userData, h.root);
  const markerPath = join(userData, "pending-restore.json");
  const oldMarker = await readFile(markerPath, "utf8");

  const first = await launch(h, userData, { R05_REAL_COORDINATOR: "1", R05_DIALOG_RESPONSES: "[1,0]", R05_NEW_SELECTION: freshSelected });
  assert.equal(first.windows, 0);
  assert.equal(first.relaunch, true);
  assert.equal(await readFile(markerPath, "utf8"), oldMarker);
  const requested = await readCurrentIntent({ userData });
  assert.equal(requested.operation, "restore");
  assert.equal(requested.state, "requested");
  assert.notEqual(requested.token, old.token);
  await assert.rejects(createIntent({ userData, operation: "restore", payload: { selectedBackup: freshSelected } }), /already pending/);

  const captured = await captureIntent(userData, requested);
  assert.equal(captured.state, "captured");
  const second = await launch(h, userData, { R05_REAL_COORDINATOR: "1" });
  assert.equal(second.windows, 1);
  assert.deepEqual(await attempts(userData), [freshSelected]);
  await assert.rejects(readFile(markerPath), { code: "ENOENT" });
  assert.equal(await readCurrentIntent({ userData }), null);

  const third = await launch(h, userData, { R05_REAL_COORDINATOR: "1" });
  assert.equal(third.windows, 1);
  assert.deepEqual(await attempts(userData), [freshSelected]);
});

test("cancelling safe failed cold Restore replacement preserves its marker and resuming token", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  await mkdir(userData, { recursive: true });
  const { old, freshSelected } = await seedSafeColdRestore(userData, h.root);
  const markerPath = join(userData, "pending-restore.json");
  const oldMarker = await readFile(markerPath, "utf8");

  const result = await launch(h, userData, { R05_REAL_COORDINATOR: "1", R05_DIALOG_RESPONSES: "[1,1]", R05_NEW_SELECTION: freshSelected });
  assert.equal(result.relaunch, undefined);
  assert.equal(result.quits, 0);
  assert.equal(result.windows, 1);
  assert.equal(await readFile(markerPath, "utf8"), oldMarker);
  assert.deepEqual(await attempts(userData), []);
  const current = await readCurrentIntent({ userData });
  assert.equal(current.token, old.token);
  assert.equal(current.state, "resuming");
  await assert.rejects(createIntent({ userData, operation: "restore", payload: { selectedBackup: freshSelected } }), /already pending/);
});

test("an unrecorded completed restore stays blocked and is never replayed", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  const selected = join(h.root, "selected");
  const markerPath = await pending(userData, selected);
  const first = await launch(h, userData, { R05_MODE: "restoredCleanup", R05_FAIL_COMPLETED_WRITE: "1", R05_DIALOG_RESPONSE: "cancel" });
  assert.equal(JSON.parse(await readFile(markerPath, "utf8")).status, "applying");
  assert.equal(first.windows, 0);
  assert.ok(first.dialogs[0].title.includes("status needs review"));
  assert.match(first.dialogs[0].message, /Backup was applied, but its completion could not be recorded/i);
  assert.ok(first.dialogs[0].detail.includes(join(userData, ".restore-rollback-")));
  const second = await launch(h, userData, { R05_DIALOG_RESPONSE: "cancel" });
  assert.equal(second.windows, 0);
  assert.deepEqual(await attempts(userData), [selected]);
});
