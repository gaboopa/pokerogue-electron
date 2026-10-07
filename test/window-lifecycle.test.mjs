import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const roots = [];

test.after(async () => {
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
});

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-window-lifecycle-"));
  roots.push(root);
  const loader = join(root, "loader.mjs");
  const bootstrap = join(root, "bootstrap.mjs");
  const electron = join(root, "electron.mjs");
  const backup = join(root, "backup.mjs");
  const coordinator = join(root, "coordinator.mjs");
  const updater = join(root, "updater.mjs");
  const keymap = join(root, "keymap.mjs");
  const retention = join(root, "retention.mjs");
  const runner = join(root, "runner.mjs");
  await writeFile(loader, `export async function resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: new URL("./electron.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R06_MAIN_URL && specifier === "./backup.mjs") return { url: new URL("./backup.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R06_MAIN_URL && specifier === "./backup-coordinator.mjs") return { url: new URL("./coordinator.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R06_MAIN_URL && specifier === "./updater.mjs") return { url: new URL("./updater.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R06_MAIN_URL && specifier === "./retention.mjs") return { url: new URL("./retention.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R06_MAIN_URL && specifier === "./keymap-store.mjs") return { url: new URL("./keymap.mjs", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }`);
  await writeFile(bootstrap, `import { register } from "node:module"; register(${JSON.stringify(pathToFileURL(loader).href)});`);
  await writeFile(electron, `let resolveStartup;
    let rejectStartup;
    let stateResolveKeymapStarted;
    let stateReleaseKeymap;
    const state = { listeners: {}, onceListeners: {}, instances: [], menu: [], dialogs: [], dialogParents: [], opened: [], events: [], relaunchSnapshots: [], quitSnapshots: [], flushes: 0, backups: 0, quits: 0, relaunches: 0, relaunchArgs: null, unhandled: [], dialogResponses: JSON.parse(process.env.R06_DIALOG_RESPONSES || "[]"), startupPromise: new Promise((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; }), keymapStarted: new Promise(resolve => { stateResolveKeymapStarted = resolve; }), keymapGate: new Promise(resolve => { stateReleaseKeymap = resolve; }) };
    state.releaseKeymap = () => stateReleaseKeymap();
    state.signalKeymapStarted = () => stateResolveKeymapStarted();
    state.fireApp = (name, event = {}) => { const once = state.onceListeners[name] ?? []; delete state.onceListeners[name]; for (const callback of once) callback(event); const listener = state.listeners[name]; if (typeof listener === "function") listener(event); };
    process.on("unhandledRejection", error => state.unhandled.push(error.message));
    globalThis.__r06 = state;
    function makeEventMap() { return new Map(); }
    class Contents {
      constructor(owner) { this.owner = owner; this.handlers = makeEventMap(); this.id = owner.id; this.session = { flushStorageData: async () => { state.flushes++; } }; }
      setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
      on(name, callback) { const all = this.handlers.get(name) ?? []; all.push(callback); this.handlers.set(name, all); }
      emit(name, ...args) { for (const callback of this.handlers.get(name) ?? []) callback(...args); }
      send() { this.owner.sent++; }
      toggleDevTools() { this.owner.devtools++; }
    }
    export class BrowserWindow {
      constructor(options) { this.id = state.instances.length + 1; this.options = options; this.role = options.title === "Backups" ? "backups" : options.width === 1280 ? "game" : options.width === 760 ? "editor" : "chart"; this.destroyed = false; this.visible = false; this.handlers = makeEventMap(); this.onceHandlers = makeEventMap(); this.webContents = new Contents(this); this.reloads = 0; this.shows = 0; this.hides = 0; this.focuses = 0; this.fullscreen = false; this.sent = 0; this.devtools = 0; state.instances.push(this); state.events.push("window:" + this.role); }
      static getAllWindows() { return state.instances.filter(window => !window.destroyed); }
      isDestroyed() { return this.destroyed; }
      isVisible() { return this.visible; }
      isFullScreen() { return this.fullscreen; }
      on(name, callback) { const all = this.handlers.get(name) ?? []; all.push(callback); this.handlers.set(name, all); }
      once(name, callback) { const all = this.onceHandlers.get(name) ?? []; all.push(callback); this.onceHandlers.set(name, all); }
      emit(name, ...args) { for (const callback of this.handlers.get(name) ?? []) callback(...args); const once = this.onceHandlers.get(name) ?? []; this.onceHandlers.delete(name); for (const callback of once) callback(...args); }
      show() { this.shows++; this.visible = true; }
      hide() { this.hides++; this.visible = false; }
      focus() { this.focuses++; }
      close() { this.destroyed = true; this.emit("closed"); }
      destroy() { this.close(); }
      reload() { this.reloads++; }
      setFullScreen(value) { this.fullscreen = value; }
      setProgressBar() {}
      async loadURL(url) { this.url = url; state.urls ??= []; state.urls.push(url); if (state.rejectLoadFor === this.id) return new Promise((resolve, reject) => { state.rejectLoad = reject; }); }
      async loadFile(path) { this.file = path; }
    }
    export const app = {
      isPackaged: false, setName() {}, getAppPath() { return process.env.R06_APP_PATH; }, getPath(name) { return name === "userData" ? process.env.R06_USER_DATA : process.env.TEMP; }, getVersion() { return "test"; },
      whenReady() { return { then(callback) { Promise.resolve().then(callback).then(resolveStartup, rejectStartup); return state.startupPromise; } }; },
      on(name, callback) { state.listeners[name] = callback; }, once(name, callback) { (state.onceListeners[name] ??= []).push(callback); }, removeListener(name, callback) { state.onceListeners[name] = (state.onceListeners[name] ?? []).filter(item => item !== callback); }, relaunch(options) { state.relaunches++; state.relaunchArgs = options?.args ?? []; state.relaunchSnapshots.push({ current: state.coordinator?.getCurrent(), clearCalls: state.coordinator?.clearCalls ?? 0 }); }, quit() { state.quits++; state.quitSnapshots.push({ current: state.coordinator?.getCurrent(), clearCalls: state.coordinator?.clearCalls ?? 0 }); },
    };
    export const dialog = {
      async showMessageBox(...args) { const options = args.at(-1); state.dialogs.push({ title: options.title, message: options.message, buttons: options.buttons }); state.dialogParents.push(args.length > 1 ? args[0]?.role ?? "destroyed" : undefined); return { response: state.dialogResponses.shift() ?? options.cancelId ?? options.defaultId ?? 0 }; },
      async showOpenDialog(...args) { state.dialogParents.push(args.length > 1 ? args[0]?.role ?? "destroyed" : undefined); return process.env.R06_SELECTED_BACKUP ? { canceled: false, filePaths: [process.env.R06_SELECTED_BACKUP] } : { canceled: true, filePaths: [] }; },
      showErrorBox(title, message) { state.dialogs.push({ title, message }); },
    };
    export const ipcMain = { handle(name, callback) { state.handlers ??= {}; state.handlers[name] = callback; }, on() {} };
    export const Menu = { buildFromTemplate(value) { return value; }, setApplicationMenu(value) { state.menu = value; } };
    export const protocol = { registerSchemesAsPrivileged() {}, handle() {} };
    export const session = { defaultSession: { webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {} } };
    export const shell = { async openPath(path) { state.opened.push(path); return ""; }, async openExternal() {} };`);
  await writeFile(backup, `export class BackupRestoreError extends Error {}
    export async function validateBackup() { globalThis.__r06.validations = (globalThis.__r06.validations ?? 0) + 1; }
    export async function createBackup() { globalThis.__r06.backups++; return process.env.R06_USER_DATA + "/Save Backups/test.zip"; }
    export async function restoreBackup() { globalThis.__r06.restoreCalls = (globalThis.__r06.restoreCalls ?? 0) + 1; globalThis.__r06.events.push("restore"); }`);
  await writeFile(coordinator, `let current = ["update-captured", "restore-captured", "cheat-captured"].includes(process.env.R06_INITIAL_INTENT) ? { token: "${"b".repeat(64)}", operation: process.env.R06_INITIAL_INTENT.split("-")[0], state: "captured", revision: 3, capturedBackupPath: "profile/backup", payload: {} } : process.env.R06_INITIAL_INTENT === "unknown-operation" ? { token: "${"e".repeat(64)}", operation: "future", state: "requested", revision: 0, capturedBackupPath: null, payload: {} } : process.env.R06_INITIAL_INTENT === "update-resuming" ? { token: "${"c".repeat(64)}", operation: "update", state: "resuming", revision: 4, capturedBackupPath: "profile/backup", payload: {} } : process.env.R06_INITIAL_INTENT === "restore-resuming" ? { token: "${"d".repeat(64)}", operation: "restore", state: "resuming", revision: 4, capturedBackupPath: "profile/backup", payload: {} } : null;
    export const state = globalThis.__r06.coordinator = { created: [], transitions: [], clearCalls: 0, failNextTransition: false, prepared: 0, revalidated: 0, getCurrent: () => current };
    export async function recoverStaleIntentLock() { return false; }
    export async function readCurrentIntent() { return current; }
    export async function createIntent(input) { const intent = { token: "${"a".repeat(64)}", operation: input.operation, state: "requested", revision: 0, payload: input.payload, capturedBackupPath: null, failure: null }; current = intent; state.created.push(intent); return intent; }
    export async function transitionIntent(input) { if (state.failNextTransition && input.nextState === "failed") { state.failNextTransition = false; throw new Error("injected failure write"); } const next = { ...current, state: input.nextState, revision: current.revision + 1, failure: input.failure ?? null }; current = next; state.transitions.push(next); return next; }
    export async function prepareResumeIntent(input) { state.prepared++; current = { ...current, state: "resuming", revision: current.revision + 1 }; return { intent: current, continuation: { backupPath: "profile/backup", selectedBackup: process.env.R06_SELECTED_BACKUP, config: { enabled: true }, installerPath: process.env.R06_USER_DATA + "/Updates/setup.exe" } }; }
    export async function revalidateResumingUpdate(input) { state.revalidated++; if (process.env.R06_TAMPER === "1") throw new Error("installer hash changed"); return { installerPath: process.env.R06_USER_DATA + "/Updates/setup.exe" }; }
    export async function clearTerminalIntent() { state.clearCalls++; current = null; return true; }`);
  await writeFile(updater, `const artifact = { platform: "windows", arch: "x64", fileName: "setup.exe", size: 1, sha256: "${"a".repeat(64)}", downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v1/setup.exe" };
    const manifest = { schemaVersion: 1, version: "1.2.3", sourceRevisions: { game: "g", assets: "a", locales: "l" }, artifacts: [artifact] };
    export async function checkForUpdate() { return { available: true, artifact, manifest }; }
    export async function downloadVerified() { globalThis.__r06.downloads = (globalThis.__r06.downloads ?? 0) + 1; return process.env.R06_USER_DATA + "/Updates/setup.exe"; }`);
  await writeFile(retention, `const record = (kind, root, arg) => { (globalThis.__r06.prunes ??= []).push({ kind, root, arg }); if (process.env.R06_PRUNE_THROW) throw new Error("injected prune failure"); return { removed: [], errors: [{ path: root, message: "injected entry error" }] }; };
    export async function pruneAutomaticBackups(root, keep) { return record("backups", root, keep); }
    export async function pruneUpdateDownloads(root, version) { return record("updates", root, version); }`);
  await writeFile(keymap, `let calls = 0; let mtimeReads = 0;
    export async function loadKeymap() { calls++; if (calls === 2 && process.env.R06_DELAY_KEYMAP) { globalThis.__r06.signalKeymapStarted(); await globalThis.__r06.keymapGate; } return []; }
    export async function keymapModifiedAt() { return ++mtimeReads === 1 ? 1 : 2; }
    export async function resetKeymap() {}`);
  await writeFile(runner, `async function bounded(promise, label) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + " timeout")), 5000); })]); } finally { clearTimeout(timer); } }
    await import(process.env.R06_MAIN_URL);
    const state = globalThis.__r06;
    await bounded(state.startupPromise, "startup");
    const findMenu = label => { const visit = items => { for (const item of items) { if (item.label === label) return item; if (item.submenu) { const found = visit(item.submenu); if (found) return found; } } }; return visit(state.menu); };
    const click = async label => { const item = findMenu(label); if (!item?.click) throw new Error("Menu action not found: " + label); return item.click(); };
    const games = () => state.instances.filter(window => window.role === "game" && !window.destroyed);
    const game = games()[0];
    state.initialGame = game;
    if (process.env.R06_SCENARIO === "reopen") {
      await click("Type Chart");
      const chart = state.instances.find(window => window.role === "chart");
      chart.emit("ready-to-show");
      await click("Configure Cheats...");
      const editor = state.instances.find(window => window.role === "editor");
      await click("Restore Backup…");
      const backupWindow = state.instances.find(window => window.role === "backups");
      backupWindow.emit("ready-to-show");
      game.close();
      state.listeners.activate();
      const replacement = games()[0];
      await bounded(replacement.loadURL ? Promise.resolve() : Promise.reject(new Error("replacement missing")), "replacement construction");
      state.listeners.activate();
      state.afterRepeatedActivation = games().length;
      const before = { oldShows: game.shows, replacementShows: replacement.shows, oldReloads: game.reloads, replacementReloads: replacement.reloads };
      game.emit("ready-to-show");
      game.emit("closed");
      game.webContents.emit("before-input-event", { preventDefault() {} }, { type: "keyDown", key: "F5" });
      game.emit("focus");
      game.webContents.emit("did-finish-load");
      state.listeners.activate();
      state.afterStaleCallbacks = games().length;
      state.staleSnapshot = { before, oldShows: game.shows, replacementShows: replacement.shows, oldReloads: game.reloads, replacementReloads: replacement.reloads };
      state.auxiliaryAlive = !chart.destroyed && !editor.destroyed;
      state.backupWindowSecure = Object.fromEntries(["sandbox", "contextIsolation", "nodeIntegration", "webSecurity"].map(key => [key, backupWindow.options.webPreferences[key]]));
      replacement.emit("ready-to-show");
      state.replacementShown = replacement.shows;
    } else if (process.env.R06_SCENARIO === "guards") {
      await click("Type Chart");
      const chart = state.instances.find(window => window.role === "chart");
      chart.emit("ready-to-show");
      game.destroyed = true;
      await click("Reload");
      await click("Toggle Full Screen");
      await click("Developer Tools");
      await click("Type Chart");
      await click("Back Up Saves…");
      await click("Restore Backup…");
      const backupWindow = state.instances.find(window => window.role === "backups");
      await click("Open Save Folder");
      state.guardSnapshot = { gameDestroyed: game.destroyed, chartHides: chart.hides, flushes: state.flushes, backups: state.backups, backupWindow: Boolean(backupWindow), dialogParents: state.dialogParents, dialogs: state.dialogs.length, opened: state.opened.length, destroyedParentUsed: state.dialogParents.includes("destroyed") };
    } else if (process.env.R06_SCENARIO === "cold-cancel") {
      await click("Back Up Saves…");
      await click("Back Up Saves…");
      state.coldSnapshot = { flushes: state.flushes, backups: state.backups, relaunches: state.relaunches, created: state.coordinator.created.length, dialogs: state.dialogs, parents: state.dialogParents };
    } else if (process.env.R06_SCENARIO === "cold-request") {
      await click("Back Up Saves…");
      state.fireApp("will-quit", { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
      await new Promise(resolve => setImmediate(resolve));
      state.coldSnapshot = { flushes: state.flushes, backups: state.backups, relaunches: state.relaunches, args: state.relaunchArgs, created: state.coordinator.created, dialogs: state.dialogs };
    } else if (process.env.R06_SCENARIO === "restore-request" || process.env.R06_SCENARIO === "restore-cancel") {
      await click("Restore Backup…");
      const backupWindow = state.instances.find(window => window.role === "backups");
      if (!backupWindow) throw new Error("Restore Backup menu did not open the Backup list window");
      await state.handlers["backups:choose-folder"]({ sender: { id: backupWindow.webContents.id } });
      if (process.env.R06_SCENARIO === "restore-request") {
        state.fireApp("will-quit", { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
        await new Promise(resolve => setImmediate(resolve));
      }
      state.coldSnapshot = { flushes: state.flushes, validations: state.validations, relaunches: state.relaunches, args: state.relaunchArgs, created: state.coordinator.created, games: games().length };
    } else if (["cheat-request", "cheat-cancel", "cheat-veto"].includes(process.env.R06_SCENARIO)) {
      await click("Configure Cheats...");
      const editor = state.instances.find(window => window.role === "editor");
      const result = await state.handlers["cheats:apply"]({ sender: { id: editor.webContents.id } }, { enabled: true });
      if (process.env.R06_SCENARIO === "cheat-request" || process.env.R06_SCENARIO === "cheat-veto") {
        state.fireApp("will-quit", { defaultPrevented: process.env.R06_SCENARIO === "cheat-veto", preventDefault() { this.defaultPrevented = true; } });
        await new Promise(resolve => setImmediate(resolve));
      }
      const stored = await (await import("node:fs/promises")).readFile(process.env.R06_USER_DATA + "/cheats.json", "utf8").catch(error => error.code === "ENOENT" ? null : Promise.reject(error));
      state.coldSnapshot = { result, created: state.coordinator.created, transitions: state.coordinator.transitions, relaunches: state.relaunches, relaunchSnapshots: state.relaunchSnapshots, quitSnapshots: state.quitSnapshots, stored, games: games().length };
    } else if (process.env.R06_SCENARIO === "cold-veto" || process.env.R06_SCENARIO === "cold-persist-failure") {
      await click("Back Up Saves…");
      if (process.env.R06_SCENARIO === "cold-persist-failure") state.coordinator.failNextTransition = true;
      await new Promise(resolve => setTimeout(resolve, 1900));
      state.fireApp("will-quit", { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
      await new Promise(resolve => setTimeout(resolve, 20));
      await click("Back Up Saves…");
      state.coldSnapshot = { flushes: state.flushes, backups: state.backups, relaunches: state.relaunches, created: state.coordinator.created.length, current: state.coordinator.getCurrent(), transitions: state.coordinator.transitions, clearCalls: state.coordinator.clearCalls, dialogs: state.dialogs, games: games().length };
    } else if (process.env.R06_SCENARIO === "update-request") {
      await click("Check for Updates…");
      state.fireApp("will-quit", { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
      await new Promise(resolve => setImmediate(resolve));
      state.coldSnapshot = { flushes: state.flushes, downloads: state.downloads, relaunches: state.relaunches, args: state.relaunchArgs, created: state.coordinator.created, dialogs: state.dialogs };
    } else if (["restore-resume", "restore-interrupted", "cheat-resume"].includes(process.env.R06_SCENARIO)) {
      const stored = await (await import("node:fs/promises")).readFile(process.env.R06_USER_DATA + "/cheats.json", "utf8").catch(error => error.code === "ENOENT" ? null : Promise.reject(error));
      state.coldSnapshot = { restoreCalls: state.restoreCalls ?? 0, current: state.coordinator.getCurrent(), transitions: state.coordinator.transitions, clearCalls: state.coordinator.clearCalls, relaunches: state.relaunches, stored, events: state.events, games: games().length, dialogs: state.dialogs };
    } else if (["update-later", "update-open", "update-tampered"].includes(process.env.R06_SCENARIO)) {
      state.coldSnapshot = { opened: state.opened, revalidated: state.coordinator.revalidated, dialogs: state.dialogs, games: games().length, transitions: state.coordinator.transitions };
    } else if (process.env.R06_SCENARIO === "update-interrupted") {
      state.coldSnapshot = { current: state.coordinator.getCurrent(), transitions: state.coordinator.transitions, dialogs: state.dialogs, games: games().length };
    } else if (process.env.R06_SCENARIO === "keyboard") {
      let prevented = false;
      game.webContents.emit("before-input-event", { preventDefault() { prevented = true; } }, { type: "keyDown", key: "F5" });
      state.keyboardPrevented = prevented;
      state.afterF5Reloads = game.reloads;
      prevented = false;
      game.webContents.emit("before-input-event", { preventDefault() { prevented = true; } }, { type: "keyDown", key: "F5", control: true });
      state.keyboardModifiedPrevented = prevented;
    } else if (process.env.R06_SCENARIO === "keymap-race") {
      game.webContents.emit("did-finish-load");
      await bounded(state.keymapStarted, "delayed keymap read");
      game.close();
      state.listeners.activate();
      const replacement = games()[0];
      state.releaseKeymap();
      await new Promise(resolve => setImmediate(resolve));
      const replacementSentAfterStaleCallback = replacement.sent;
      replacement.emit("focus");
      await new Promise(resolve => setImmediate(resolve));
      state.keymapRace = { oldSent: game.sent, replacementSentAfterStaleCallback, replacementSentAfterRefresh: replacement.sent, games: games().length };
    } else if (process.env.R06_SCENARIO === "load-cancel" || process.env.R06_SCENARIO === "load-failure") {
      game.close();
      state.rejectLoadFor = 2;
      state.listeners.activate();
      const interrupted = games()[0];
      if (process.env.R06_SCENARIO === "load-cancel") interrupted.close();
      state.rejectLoad(new Error("navigation was canceled"));
      await new Promise(resolve => setImmediate(resolve));
      const reports = state.dialogs.filter(dialog => dialog.title === "Could not load game").length;
      state.listeners.activate();
      state.loadRecovery = { games: games().length, instances: state.instances.length, reports, unhandled: state.unhandled };
    } else if (process.env.R06_SCENARIO === "windows-quit") {
      for (const window of [...state.instances]) window.close();
      state.listeners["window-all-closed"]();
    }
    const snapshot = {
      pid: process.pid, platform: process.platform, quits: state.quits, relaunches: state.relaunches, relaunchSnapshots: state.relaunchSnapshots, quitSnapshots: state.quitSnapshots, initialGame: game ? { reloads: game.reloads, shows: game.shows, destroyed: game.destroyed } : null,
      games: games().length, instances: state.instances.map(window => ({ role: window.role, webPreferences: Object.fromEntries(["sandbox", "contextIsolation", "nodeIntegration", "webSecurity"].map(key => [key, window.options.webPreferences[key]])), destroyed: window.destroyed, reloads: window.reloads, shows: window.shows, hides: window.hides })),
      urls: state.urls ?? [], dialogs: state.dialogs, dialogParents: state.dialogParents, opened: state.opened, flushes: state.flushes, backups: state.backups,
      afterRepeatedActivation: state.afterRepeatedActivation, afterStaleCallbacks: state.afterStaleCallbacks, staleSnapshot: state.staleSnapshot,
      auxiliaryAlive: state.auxiliaryAlive, backupWindowSecure: state.backupWindowSecure, replacementShown: state.replacementShown, keyboardPrevented: state.keyboardPrevented,
      afterF5Reloads: state.afterF5Reloads, keyboardModifiedPrevented: state.keyboardModifiedPrevented, guardSnapshot: state.guardSnapshot,
      keymapRace: state.keymapRace, loadRecovery: state.loadRecovery,
      coldSnapshot: state.coldSnapshot, prunes: state.prunes ?? [],
    };
    await (await import("node:fs/promises")).writeFile(process.env.R06_RESULT, JSON.stringify(snapshot));`);
  return { root, bootstrap, runner };
}

async function launch(scenario) {
  const h = await createHarness();
  const userData = join(h.root, "user-data");
  const resultPath = join(h.root, "result.json");
  const selectedBackup = join(h.root, "selected-backup");
  await mkdir(selectedBackup);
  if (scenario === "prune-marker") {
    await mkdir(userData, { recursive: true });
    await writeFile(join(userData, "pending-restore.json"), JSON.stringify({ version: 1, status: "failed", recoveryRequired: false, selected: selectedBackup, error: { message: "earlier failure" } }));
  }
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(h.bootstrap).href, h.runner], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, R06_MAIN_URL: pathToFileURL(join(repo, "src", "main.mjs")).href, R06_APP_PATH: repo, R06_USER_DATA: userData, R06_RESULT: resultPath, R06_SELECTED_BACKUP: ["restore-request", "restore-cancel", "restore-resume"].includes(scenario) ? selectedBackup : "", R06_SCENARIO: scenario, R06_DELAY_KEYMAP: scenario === "keymap-race" ? "1" : "", R06_DIALOG_RESPONSES: ["cold-request", "cold-veto", "cold-persist-failure", "update-request", "update-open", "update-tampered", "cheat-request", "cheat-veto", "restore-request"].includes(scenario) ? "[0]" : "[]", R06_INITIAL_INTENT: ["update-later", "update-open", "update-tampered"].includes(scenario) ? "update-captured" : scenario === "prune-journal" ? "unknown-operation" : scenario === "update-interrupted" ? "update-resuming" : scenario === "restore-resume" ? "restore-captured" : scenario === "restore-interrupted" ? "restore-resuming" : scenario === "cheat-resume" ? "cheat-captured" : "", R06_TAMPER: scenario === "update-tampered" ? "1" : "", R06_PRUNE_THROW: scenario === "prune-throws" ? "1" : "" },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(await readFile(resultPath, "utf8"));
}

test("game, cheat editor, chart, and Backup windows use the secure web preferences", async () => {
  const state = await launch("reopen");
  const securePreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true };
  for (const role of ["game", "editor", "chart"]) {
    const window = state.instances.find(instance => instance.role === role);
    assert.deepEqual(window.webPreferences, securePreferences, `${role} window`);
  }
  assert.deepEqual(state.backupWindowSecure, securePreferences, "Backup window");
});

test("activation reopens one game window while chart and cheat editor survive, and stale callbacks cannot affect it", async () => {
  const state = await launch("reopen");
  assert.equal(state.auxiliaryAlive, true);
  assert.equal(state.quits, 0);
  assert.equal(state.afterRepeatedActivation, 1);
  assert.equal(state.afterStaleCallbacks, 1);
  assert.deepEqual(state.staleSnapshot, { before: { oldShows: 0, replacementShows: 0, oldReloads: 0, replacementReloads: 0 }, oldShows: 0, replacementShows: 0, oldReloads: 0, replacementReloads: 0 });
  assert.equal(state.replacementShown, 1);
  assert.equal(state.games, 1);
});

test("menu and auxiliary-window actions tolerate an absent or destroyed game window", async () => {
  const state = await launch("guards");
  assert.equal(state.guardSnapshot.gameDestroyed, true);
  assert.equal(state.guardSnapshot.chartHides, 1);
  assert.equal(state.guardSnapshot.flushes, 0);
  assert.equal(state.guardSnapshot.backups, 0);
  assert.equal(state.guardSnapshot.backupWindow, true);
  assert.equal(state.guardSnapshot.destroyedParentUsed, false);
  assert.deepEqual(state.guardSnapshot.dialogParents, [null]);
  assert.equal(state.guardSnapshot.dialogs, 1);
  assert.equal(state.guardSnapshot.opened, 1);
});

test("manual Backup Cancel through the menu twice leaves the profile live without capture or relaunch", async () => {
  const state = await launch("cold-cancel");
  assert.equal(state.coldSnapshot.flushes, 0);
  assert.equal(state.coldSnapshot.backups, 0);
  assert.equal(state.coldSnapshot.relaunches, 0);
  assert.equal(state.coldSnapshot.created, 0);
  assert.equal(state.coldSnapshot.dialogs.length, 2);
  assert.ok(state.coldSnapshot.dialogs.every(dialog => dialog.buttons?.[1] === "Cancel"));
  assert.deepEqual(state.coldSnapshot.parents, ["game", "game"]);
});

test("accepted manual Backup flushes storage and launches the real bootstrap worker argument shape", async () => {
  const state = await launch("cold-request");
  assert.equal(state.coldSnapshot.flushes, 1);
  assert.equal(state.coldSnapshot.backups, 0);
  assert.equal(state.coldSnapshot.relaunches, 1);
  assert.deepEqual(state.coldSnapshot.args, [repo, "--", "--backup-worker", `--backup-token=${"a".repeat(64)}`, `--backup-parent-pid=${state.pid}`]);
  assert.equal(state.coldSnapshot.created[0].operation, "manual");

  const root = await mkdtemp(join(tmpdir(), "pokerogue-bootstrap-argv-"));
  roots.push(root);
  await mkdir(join(root, "profile"));
  const loader = join(root, "loader.mjs");
  const registerLoader = join(root, "register-loader.mjs");
  const electron = join(root, "electron.mjs");
  await writeFile(loader, `export async function resolve(specifier, context, nextResolve) { if (specifier === "electron") return { url: new URL("./electron.mjs", import.meta.url).href, shortCircuit: true }; return nextResolve(specifier, context); }`);
  await writeFile(registerLoader, `import { register } from "node:module"; register(${JSON.stringify(pathToFileURL(loader).href)});`);
  await writeFile(electron, `export const app = { isPackaged: false, setName() {}, getAppPath() { return process.env.R06_APP_PATH; }, getPath() { return process.env.R06_USER_DATA; }, setPath() {}, requestSingleInstanceLock() { return true; }, exit(code) { process.exitCode = code; }, relaunch() {}, quit() {} }; export const dialog = { showErrorBox(title, message) { process.stderr.write(JSON.stringify({ code: "dialog", title, message }) + "\\n"); } };`);
  const bootstrap = pathToFileURL(join(repo, "src", "bootstrap.mjs")).href;
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(registerLoader).href, "-e", `import(${JSON.stringify(bootstrap)})`, ...state.coldSnapshot.args], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, R06_APP_PATH: repo, R06_USER_DATA: join(root, "profile") },
  });
  assert.notEqual(result.status, 0);
  const workerFailure = result.stderr.split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).find(record => record?.code === "worker-failed");
  assert.ok(workerFailure, `${result.stdout}\n${result.stderr}`);
  assert.match(workerFailure.error, /backup-intent|journal/i);
});

test("Restore validates its selection and requests a cold safety Backup before relaunch", async () => {
  const state = await launch("restore-request");
  assert.equal(state.coldSnapshot.validations, 1);
  assert.equal(state.coldSnapshot.flushes, 1);
  assert.equal(state.coldSnapshot.relaunches, 1);
  assert.deepEqual(state.coldSnapshot.args.slice(0, 3), [repo, "--", "--backup-worker"]);
  assert.equal(state.coldSnapshot.created[0].operation, "restore");
  assert.match(state.coldSnapshot.created[0].payload.selectedBackup, /selected-backup$/);
  assert.equal(state.coldSnapshot.games, 1);
  const cancelled = await launch("restore-cancel");
  assert.equal(cancelled.coldSnapshot.validations, 1);
  assert.equal(cancelled.coldSnapshot.flushes, 0);
  assert.equal(cancelled.coldSnapshot.created.length, 0);
  assert.equal(cancelled.coldSnapshot.relaunches, 0);
  assert.deepEqual(cancelled.dialogParents, ["backups", "backups"], "the picker and the confirmation open in front of the Backups window");
  assert.equal(cancelled.instances.find(window => window.role === "backups").destroyed, false, "cancelling keeps the Backups window open");
  assert.equal(state.instances.find(window => window.role === "backups").destroyed, true, "confirming closes the Backups window");
});

test("cheat approval queues cold Backup without writing, while cancellation queues nothing", async () => {
  const approved = await launch("cheat-request");
  assert.equal(approved.coldSnapshot.result.reason, "backup-pending");
  assert.equal(approved.coldSnapshot.created[0].operation, "cheat");
  assert.equal(approved.coldSnapshot.created[0].payload.config.enabled, true);
  assert.equal(approved.coldSnapshot.stored, null);
  assert.equal(approved.coldSnapshot.relaunches, 1);

  const cancelled = await launch("cheat-cancel");
  assert.equal(cancelled.coldSnapshot.result.reason, "cancelled");
  assert.equal(cancelled.coldSnapshot.created.length, 0);
  assert.equal(cancelled.coldSnapshot.stored, null);
  assert.equal(cancelled.coldSnapshot.relaunches, 0);

  const vetoed = await launch("cheat-veto");
  assert.equal(vetoed.coldSnapshot.stored, null);
  assert.equal(vetoed.coldSnapshot.relaunches, 0);
  assert.ok(vetoed.coldSnapshot.transitions.some(intent => intent.state === "failed" && intent.failure.code === "quit-vetoed"));
});

test("captured Restore applies once before game creation, while interrupted Restore never replays", async () => {
  const resumed = await launch("restore-resume");
  assert.equal(resumed.coldSnapshot.restoreCalls, 1);
  assert.ok(resumed.coldSnapshot.events.indexOf("restore") < resumed.coldSnapshot.events.indexOf("window:game"));
  assert.equal(resumed.coldSnapshot.clearCalls, 1);
  assert.equal(resumed.coldSnapshot.games, 1);

  const interrupted = await launch("restore-interrupted");
  assert.equal(interrupted.coldSnapshot.restoreCalls, 0);
  assert.ok(interrupted.coldSnapshot.transitions.some(intent => intent.state === "interrupted"));
  assert.equal(interrupted.coldSnapshot.games, 1);
});

test("captured cheat continuation writes metadata and relaunches without opening the game", async () => {
  const state = await launch("cheat-resume");
  assert.equal(state.coldSnapshot.relaunches, 1);
  assert.equal(state.coldSnapshot.games, 0);
  const stored = JSON.parse(state.coldSnapshot.stored);
  assert.equal(stored.config.enabled, true);
  assert.ok(state.coldSnapshot.transitions.some(intent => intent.state === "completed"));
  assert.deepEqual(state.relaunchSnapshots, [{ current: null, clearCalls: 1 }]);
  assert.deepEqual(state.quitSnapshots, [{ current: null, clearCalls: 1 }]);
});

test("a shutdown veto or window close cancellation cannot leave a queued worker for a later quit", async () => {
  const state = await launch("cold-veto");
  assert.equal(state.coldSnapshot.flushes, 1);
  assert.equal(state.coldSnapshot.backups, 0);
  assert.equal(state.coldSnapshot.relaunches, 0);
  assert.equal(state.coldSnapshot.current.state, "failed");
  assert.equal(state.coldSnapshot.created, 1);
  assert.equal(state.coldSnapshot.clearCalls, 0);
  assert.ok(state.coldSnapshot.transitions.some(intent => intent.state === "failed" && intent.failure.code === "quit-vetoed"));
  assert.ok(state.coldSnapshot.dialogs.some(dialog => dialog.title === "Backup not completed"));
  assert.ok(state.coldSnapshot.dialogs.some(dialog => dialog.title === "Backup already in progress"));
  assert.equal(state.coldSnapshot.games, 1);
});

test("a live failure to persist the veto reports synchronously and keeps later Backup requests blocked", async () => {
  const state = await launch("cold-persist-failure");
  assert.equal(state.coldSnapshot.flushes, 1);
  assert.equal(state.coldSnapshot.backups, 0);
  assert.equal(state.coldSnapshot.relaunches, 0);
  assert.equal(state.coldSnapshot.created, 1);
  assert.equal(state.coldSnapshot.clearCalls, 0);
  assert.equal(state.coldSnapshot.current.state, "requested");
  assert.ok(state.coldSnapshot.dialogs.some(dialog => dialog.title === "Backup request needs attention"));
  assert.ok(state.coldSnapshot.dialogs.some(dialog => dialog.title === "Backup already in progress"));
  assert.equal(state.coldSnapshot.games, 1);
});

test("Update requires the cold Backup restart before download continuation and preserves Later", async () => {
  const request = await launch("update-request");
  assert.equal(request.coldSnapshot.downloads, 1);
  assert.equal(request.coldSnapshot.flushes, 1);
  assert.deepEqual(request.coldSnapshot.args.slice(0, 3), [repo, "--", "--backup-worker"]);
  assert.equal(request.coldSnapshot.created[0].operation, "update");
  assert.deepEqual(request.coldSnapshot.dialogs[0].buttons, ["Download and Restart", "Cancel"]);

  const later = await launch("update-later");
  assert.deepEqual(later.coldSnapshot.opened, []);
  assert.equal(later.coldSnapshot.revalidated, 0);
  assert.equal(later.coldSnapshot.games, 1);
});

test("Update Open revalidates immediately, while installer tampering fails visibly without opening", async () => {
  const open = await launch("update-open");
  assert.equal(open.coldSnapshot.revalidated, 1);
  assert.equal(open.coldSnapshot.opened.length, 1);
  assert.match(open.coldSnapshot.opened[0], /[\\/]Updates[\\/]setup\.exe$/);
  assert.match(open.coldSnapshot.dialogs[0].title, /Update downloaded/);

  const tampered = await launch("update-tampered");
  assert.equal(tampered.coldSnapshot.revalidated, 1);
  assert.deepEqual(tampered.coldSnapshot.opened, []);
  assert.ok(tampered.coldSnapshot.dialogs.some(dialog => dialog.title === "Update backup did not complete"));
  assert.equal(tampered.coldSnapshot.games, 1);
});

test("interrupted Update intent is marked failed once, reported, and does not strand game startup", async () => {
  const state = await launch("update-interrupted");
  assert.equal(state.coldSnapshot.current, null);
  assert.ok(state.coldSnapshot.transitions.some(intent => intent.state === "interrupted"));
  assert.ok(state.coldSnapshot.transitions.some(intent => intent.state === "failed"));
  assert.ok(state.coldSnapshot.dialogs.some(dialog => dialog.title === "Update backup did not complete"));
  assert.equal(state.coldSnapshot.games, 1);
});

test("F5 reload remains available while modified shortcuts are left to the system", async () => {
  const state = await launch("keyboard");
  assert.equal(state.keyboardPrevented, true);
  assert.equal(state.afterF5Reloads, 1);
  assert.equal(state.keyboardModifiedPrevented, false);
});

test("a delayed keymap read from a closed window cannot send to its replacement", async () => {
  const state = await launch("keymap-race");
  assert.deepEqual(state.keymapRace, { oldSent: 0, replacementSentAfterStaleCallback: 0, replacementSentAfterRefresh: 1, games: 1 });
});

test("a window closed during navigation is discarded without an unhandled rejection", async () => {
  const state = await launch("load-cancel");
  assert.deepEqual(state.loadRecovery, { games: 1, instances: 3, reports: 0, unhandled: [] });
});

test("real game navigation failures are reported and activation can retry", async () => {
  const state = await launch("load-failure");
  assert.deepEqual(state.loadRecovery, { games: 1, instances: 3, reports: 1, unhandled: [] });
});

test("closing every window preserves the platform-specific quit behavior", async () => {
  const state = await launch("windows-quit");
  assert.equal(state.quits, state.platform === "darwin" ? 0 : 1);
});

test("startup pruning runs once on a clean profile, before the window", async () => {
  const state = await launch("prune-clean");
  assert.deepEqual(state.prunes.map(call => [call.kind, call.arg]), [["backups", 5], ["updates", "test"]]);
  assert.match(state.prunes[0].root, /[\\/]Save Backups$/);
  assert.match(state.prunes[1].root, /[\\/]Updates$/);
  assert.equal(state.games, 1);
});

test("startup pruning is skipped while a journal or pending-restore.json exists", async () => {
  const journal = await launch("prune-journal");
  assert.deepEqual(journal.prunes, []);
  assert.equal(journal.games, 1);
  const marker = await launch("prune-marker");
  assert.deepEqual(marker.prunes, []);
  assert.equal(marker.games, 1);
});

test("a pruning failure is reported to stderr and never blocks startup", async () => {
  const state = await launch("prune-throws");
  assert.equal(state.prunes.length, 1);
  assert.equal(state.games, 1);
});
