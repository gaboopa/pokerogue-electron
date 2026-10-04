import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const keymap = join(root, "keymap.mjs");
  const runner = join(root, "runner.mjs");
  await writeFile(loader, `export async function resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: new URL("./electron.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R06_MAIN_URL && specifier === "./backup.mjs") return { url: new URL("./backup.mjs", import.meta.url).href, shortCircuit: true };
    if (context.parentURL === process.env.R06_MAIN_URL && specifier === "./keymap-store.mjs") return { url: new URL("./keymap.mjs", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }`);
  await writeFile(bootstrap, `import { register } from "node:module"; register(${JSON.stringify(pathToFileURL(loader).href)});`);
  await writeFile(electron, `let resolveStartup;
    let rejectStartup;
    let stateResolveKeymapStarted;
    let stateReleaseKeymap;
    const state = { listeners: {}, instances: [], menu: [], dialogs: [], dialogParents: [], opened: [], flushes: 0, backups: 0, quits: 0, relaunches: 0, unhandled: [], startupPromise: new Promise((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; }), keymapStarted: new Promise(resolve => { stateResolveKeymapStarted = resolve; }), keymapGate: new Promise(resolve => { stateReleaseKeymap = resolve; }) };
    state.releaseKeymap = () => stateReleaseKeymap();
    state.signalKeymapStarted = () => stateResolveKeymapStarted();
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
      constructor(options) { this.id = state.instances.length + 1; this.options = options; this.role = options.width === 1280 ? "game" : options.width === 760 ? "editor" : "chart"; this.destroyed = false; this.visible = false; this.handlers = makeEventMap(); this.onceHandlers = makeEventMap(); this.webContents = new Contents(this); this.reloads = 0; this.shows = 0; this.hides = 0; this.focuses = 0; this.fullscreen = false; this.sent = 0; this.devtools = 0; state.instances.push(this); }
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
      async loadURL(url) { this.url = url; state.urls ??= []; state.urls.push(url); if (state.rejectLoadFor === this.id) return new Promise((resolve, reject) => { state.rejectLoad = reject; }); }
      async loadFile(path) { this.file = path; }
    }
    export const app = {
      isPackaged: false, setName() {}, getPath(name) { return name === "userData" ? process.env.R06_USER_DATA : process.env.TEMP; }, getVersion() { return "test"; },
      whenReady() { return { then(callback) { Promise.resolve().then(callback).then(resolveStartup, rejectStartup); return state.startupPromise; } }; },
      on(name, callback) { state.listeners[name] = callback; }, relaunch() { state.relaunches++; }, quit() { state.quits++; },
    };
    export const dialog = {
      async showMessageBox(...args) { const options = args.at(-1); state.dialogs.push({ title: options.title, message: options.message, buttons: options.buttons }); state.dialogParents.push(args.length > 1 ? args[0]?.role ?? "destroyed" : undefined); return { response: options.cancelId ?? options.defaultId ?? 0 }; },
      async showOpenDialog(...args) { state.dialogParents.push(args.length > 1 ? args[0]?.role ?? "destroyed" : undefined); return { canceled: true, filePaths: [] }; },
      showErrorBox(title, message) { state.dialogs.push({ title, message }); },
    };
    export const ipcMain = { handle(name, callback) { state.handlers ??= {}; state.handlers[name] = callback; }, on() {} };
    export const Menu = { buildFromTemplate(value) { return value; }, setApplicationMenu(value) { state.menu = value; } };
    export const protocol = { registerSchemesAsPrivileged() {}, handle() {} };
    export const session = { defaultSession: { webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {} } };
    export const shell = { async openPath(path) { state.opened.push(path); return ""; }, async openExternal() {} };`);
  await writeFile(backup, `export class BackupRestoreError extends Error {}
    export async function validateBackup() {}
    export async function createBackup() { globalThis.__r06.backups++; return process.env.R06_USER_DATA + "/Save Backups/test.zip"; }
    export async function restoreBackup() {}`);
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
      await click("Open Save Folder");
      state.guardSnapshot = { gameDestroyed: game.destroyed, chartHides: chart.hides, flushes: state.flushes, backups: state.backups, dialogParents: state.dialogParents, dialogs: state.dialogs.length, opened: state.opened.length, destroyedParentUsed: state.dialogParents.includes("destroyed") };
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
      platform: process.platform, quits: state.quits, relaunches: state.relaunches, initialGame: { reloads: game.reloads, shows: game.shows, destroyed: game.destroyed },
      games: games().length, instances: state.instances.map(window => ({ role: window.role, destroyed: window.destroyed, reloads: window.reloads, shows: window.shows, hides: window.hides })),
      urls: state.urls ?? [], dialogs: state.dialogs, dialogParents: state.dialogParents, opened: state.opened, flushes: state.flushes, backups: state.backups,
      afterRepeatedActivation: state.afterRepeatedActivation, afterStaleCallbacks: state.afterStaleCallbacks, staleSnapshot: state.staleSnapshot,
      auxiliaryAlive: state.auxiliaryAlive, replacementShown: state.replacementShown, keyboardPrevented: state.keyboardPrevented,
      afterF5Reloads: state.afterF5Reloads, keyboardModifiedPrevented: state.keyboardModifiedPrevented, guardSnapshot: state.guardSnapshot,
      keymapRace: state.keymapRace, loadRecovery: state.loadRecovery,
    };
    await (await import("node:fs/promises")).writeFile(process.env.R06_RESULT, JSON.stringify(snapshot));`);
  return { root, bootstrap, runner };
}

async function launch(scenario) {
  const h = await createHarness();
  const userData = join(h.root, "user-data");
  const resultPath = join(h.root, "result.json");
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(h.bootstrap).href, h.runner], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, R06_MAIN_URL: pathToFileURL(join(repo, "src", "main.mjs")).href, R06_USER_DATA: userData, R06_RESULT: resultPath, R06_SCENARIO: scenario, R06_DELAY_KEYMAP: scenario === "keymap-race" ? "1" : "" },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(await readFile(resultPath, "utf8"));
}

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
  assert.equal(state.guardSnapshot.backups, 1);
  assert.equal(state.guardSnapshot.destroyedParentUsed, false);
  assert.deepEqual(state.guardSnapshot.dialogParents, [null, null]);
  assert.equal(state.guardSnapshot.dialogs, 1);
  assert.equal(state.guardSnapshot.opened, 1);
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
