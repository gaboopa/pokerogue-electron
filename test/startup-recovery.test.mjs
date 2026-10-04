import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-startup-recovery-"));
  const loader = join(root, "loader.mjs");
  const bootstrap = join(root, "bootstrap.mjs");
  const electron = join(root, "electron.mjs");
  const backup = join(root, "backup.mjs");
  const fsStub = join(root, "fs.mjs");
  const runner = join(root, "runner.mjs");
  await writeFile(loader, `export async function resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: new URL("./electron.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R05_MAIN_URL && specifier === "./backup.mjs") return { url: new URL("./backup.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R05_MAIN_URL && specifier === "node:fs/promises") return { url: new URL("./fs.mjs", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }`);
  await writeFile(bootstrap, `import { register } from "node:module"; register(${JSON.stringify(pathToFileURL(loader).href)});`);
  await writeFile(electron, `const state = { windows: 0, urls: [], dialogs: [], quits: 0, opened: [], listeners: {} };
    globalThis.__r05 = state;
    export const app = { isPackaged: false, setName() {}, getPath(n) { return n === "userData" ? process.env.R05_USER_DATA : process.env.TEMP; }, getVersion() { return "test"; }, whenReady() { return Promise.resolve(); }, on(name, fn) { state.listeners[name] = fn; }, relaunch() { state.relaunch = true; }, quit() { state.quits++; } };
    export class BrowserWindow { constructor() { state.windows++; this.webContents = { setWindowOpenHandler() {}, on() {}, send() {}, toggleDevTools() {}, session: { flushStorageData: async () => {} } }; } static getAllWindows() { return Array.from({ length: state.windows }); } isDestroyed() { return false; } isVisible() { return true; } isFullScreen() { return false; } show() {} focus() {} hide() {} once() {} on() {} async loadURL(url) { state.urls.push(url); } async loadFile() {} reload() {} setFullScreen() {} }
    export const dialog = { async showMessageBox(...args) { const o = args.at(-1); state.dialogs.push({ title: o.title, message: o.message, detail: o.detail, buttons: o.buttons }); return { response: Number(process.env.R05_DIALOG_RESPONSE ?? -1) }; }, async showOpenDialog() { return { canceled: false, filePaths: [process.env.R05_NEW_SELECTION || ""] }; }, showErrorBox(title, message) { state.dialogs.push({ title, message }); } };
    export const ipcMain = { handle() {}, on() {} };
    export const Menu = { buildFromTemplate(v) { return v; }, setApplicationMenu() {} };
    export const protocol = { registerSchemesAsPrivileged() {}, handle() {} };
    export const session = { defaultSession: { webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {} } };
    export const shell = { async openPath(path) { state.opened.push(path); return ""; }, async openExternal() {} };`);
  await writeFile(backup, `import { appendFile, mkdir, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    export class BackupRestoreError extends Error { constructor(message, options = {}) { super(message, { cause: options.cause }); Object.assign(this, options); } }
    export async function validateBackup() {}
    export async function createBackup() { return process.env.R05_SAFETY_BACKUP; }
    export async function restoreBackup(userData, selected) {
      await appendFile(process.env.R05_ATTEMPTS, selected + "\\n");
      const mode = process.env.R05_MODE || "success";
      if (mode === "missing") throw Object.assign(new BackupRestoreError("selected Backup is missing (ENOENT)"), { code: "ENOENT" });
      if (mode === "invalid") throw new BackupRestoreError("Backup checksum verification failed");
      if (mode === "rolledback") throw new BackupRestoreError("restore failed; original Save data was restored");
      if (mode === "incomplete") { const recoveryPath = join(userData, ".restore-rollback-test"); await mkdir(recoveryPath, { recursive: true }); await writeFile(join(recoveryPath, "preserved"), "original"); throw new BackupRestoreError("rollback failed", { recoveryRequired: true, recoveryPath }); }
    }`);
  await writeFile(fsStub, `import * as fs from "node:fs/promises";
    export const mkdir = fs.mkdir;
    export const readFile = async (p, ...a) => { if (process.env.R05_FAIL_READ && String(p).endsWith("pending-restore.json")) throw Object.assign(new Error("marker read failed"), { code: "EACCES" }); return fs.readFile(p, ...a); };
    export const writeFile = async (p, d, ...a) => { if (String(p).endsWith("pending-restore.json.tmp")) { const s = String(d); if (process.env.R05_FAIL_APPLY_WRITE && s.includes('"status":"applying"')) throw Object.assign(new Error("marker apply write failed"), { code: "EACCES" }); if (process.env.R05_FAIL_FAILED_WRITE && s.includes('"status":"failed"')) throw Object.assign(new Error("marker failed-state write failed"), { code: "EACCES" }); if (process.env.R05_FAIL_COMPLETED_WRITE && s.includes('"status":"completed"')) throw Object.assign(new Error("marker completed-state write failed"), { code: "EACCES" }); } return fs.writeFile(p, d, ...a); };
    export const rename = async (a, b) => { if (process.env.R05_FAIL_TRANSITION && String(b).endsWith("pending-restore.json")) throw Object.assign(new Error("marker transition failed"), { code: "EACCES" }); return fs.rename(a, b); };
    export const rm = async (p, ...a) => { if (process.env.R05_FAIL_REMOVE && String(p).endsWith("pending-restore.json")) throw Object.assign(new Error("marker remove failed"), { code: "EACCES" }); return fs.rm(p, ...a); };
    export const readdir = fs.readdir;`);
  await writeFile(runner, `import { setTimeout as delay } from "node:timers/promises"; import { writeFile } from "node:fs/promises"; await import(process.env.R05_MAIN_URL); await delay(150); globalThis.__r05.listeners.activate?.(); await delay(25); await writeFile(process.env.R05_RESULT, JSON.stringify(globalThis.__r05));`);
  return { root, bootstrap, runner };
}

async function launch(h, userData, extra = {}) {
  const resultPath = join(userData, `result-${Math.random()}.json`);
  const mainUrl = pathToFileURL(join(repo, "src", "main.mjs")).href;
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(h.bootstrap).href, h.runner], { encoding: "utf8", env: { ...process.env, R05_MAIN_URL: mainUrl, R05_USER_DATA: userData, R05_RESULT: resultPath, R05_ATTEMPTS: join(userData, "attempts.log"), R05_SAFETY_BACKUP: join(userData, "Save Backups", "safety"), ...extra } });
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
  const second = await launch(h, userData);
  assert.equal(second.windows, 1);
  assert.deepEqual(await attempts(userData), [selected]);
  await assert.rejects(readFile(markerPath), { code: "ENOENT" });
});

test("an incomplete rollback keeps recovery copies and never loads Save data", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  const selected = join(h.root, "bad-backup");
  const markerPath = await pending(userData, selected);
  const first = await launch(h, userData, { R05_MODE: "incomplete" });
  const failed = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.recoveryRequired, true);
  assert.equal(failed.selected, selected);
  assert.equal(failed.safetyBackup, join(userData, "Save Backups", "safety"));
  assert.equal(first.windows, 0);
  assert.deepEqual(first.urls, []);
  assert.ok(first.dialogs.some(d => d.title === "Save recovery required" && d.detail.includes(failed.safetyBackup)));
  assert.equal(first.opened.length, 0);
  assert.equal(first.windows, 0, "activate must remain blocked after the recovery UI closes");
  assert.deepEqual(await attempts(userData), [selected]);
  const second = await launch(h, userData);
  assert.equal(second.windows, 0);
  assert.deepEqual(await attempts(userData), [selected]);
});

test("an interrupted applying marker blocks startup without retrying the restore", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  await pending(userData, join(h.root, "selected"), { status: "applying" });
  const result = await launch(h, userData);
  assert.equal(result.windows, 0);
  assert.deepEqual(result.urls, []);
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
  const first = await launch(h, userData, { R05_MODE: "missing", R05_FAIL_FAILED_WRITE: "1" });
  assert.equal(first.windows, 0);
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
  assert.equal(JSON.parse(await readFile(markerPath, "utf8")).status, "applying");
  const second = await launch(h, userData);
  assert.equal(second.windows, 0);
  assert.deepEqual(await attempts(userData), [selected]);
});

test("malformed pending marker is archived as failed and allows choosing a fresh Backup", async () => {
  const h = await harness();
  const userData = join(h.root, "user");
  await mkdir(userData, { recursive: true });
  const markerPath = join(userData, "pending-restore.json");
  await writeFile(markerPath, "{");
  const result = await launch(h, userData, { R05_DIALOG_RESPONSE: "1", R05_NEW_SELECTION: join(h.root, "fresh-backup") });
  assert.equal(result.relaunch, true);
  const replaced = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(replaced.status, "pending");
  assert.equal(replaced.selected, join(h.root, "fresh-backup"));
});
