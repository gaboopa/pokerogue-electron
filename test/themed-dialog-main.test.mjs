import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("themed dialogs validate replies and resolve independently when closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-themed-dialog-"));
  try {
    const electron = join(root, "electron.mjs");
    const loader = join(root, "loader.mjs");
    const bootstrap = join(root, "bootstrap.mjs");
    const runner = join(root, "runner.mjs");
    await writeFile(electron, `const state = globalThis.__dialogTest = { windows: [], handlers: {}, listeners: {} };
      export const ipcMain = { handle(name, fn) { state.handlers[name] = fn; }, on(name, fn) { state.listeners[name] = fn; } };
      export const screen = { getDisplayMatching() { return { workAreaSize: { height: 900 } }; } };
      export class BrowserWindow {
        constructor(options) { this.options = options; this.destroyed = false; this.shown = false; this.contents = { id: state.windows.length + 1, setWindowOpenHandler(fn) { this.openHandler = fn; }, on(name, fn) { this.listeners ??= {}; this.listeners[name] = fn; }, emit(name, ...args) { this.listeners?.[name]?.(...args); } }; this.handlers = {}; this.onceHandlers = {}; state.windows.push(this); }
        get webContents() { if (this.destroyed) throw new Error("webContents accessed after destruction"); return this.contents; }
        isDestroyed() { return this.destroyed; } isVisible() { return this.shown; }
        on(name, fn) { this.handlers[name] = fn; } once(name, fn) { this.onceHandlers[name] = fn; }
        emit(name, ...args) { this.handlers[name]?.(...args); this.onceHandlers[name]?.(...args); delete this.onceHandlers[name]; }
        getBounds() { return { x: 0, y: 0, width: 560, height: 96 }; } setContentSize(width, height) { this.size = [width, height]; }
        show() { this.shown = true; } close() { if (this.destroyed) return; this.destroyed = true; this.emit("closed"); }
        async loadFile() { queueMicrotask(() => this.emit("ready-to-show")); }
      }
    `);
    await writeFile(loader, `export async function resolve(specifier, context, nextResolve) { if (specifier === "electron") return { url: new URL("./electron.mjs", import.meta.url).href, shortCircuit: true }; return nextResolve(specifier, context); }`);
    await writeFile(bootstrap, `import { register } from "node:module"; register(${JSON.stringify(pathToFileURL(loader).href)});`);
    await writeFile(runner, `import assert from "node:assert/strict";
      const { BrowserWindow, ipcMain } = await import("electron");
      const { showThemedMessageBox } = await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "src", "dialog-main.mjs")).href)});
      const parent = { isDestroyed() { return false; }, getBounds() { return { x: 0, y: 0, width: 800, height: 600 }; } };
      const call = (window, index, sender = window.webContents) => globalThis.__dialogTest.listeners["dialog:respond"]({ sender }, index);
      const first = showThemedMessageBox(parent, { buttons: ["Yes", "No"], defaultId: 1, cancelId: 1 });
      const firstWindow = globalThis.__dialogTest.windows[0];
      assert.equal(firstWindow.options.parent, parent);
      assert.equal(firstWindow.options.modal, true);
      assert.equal(firstWindow.options.frame, false);
      assert.equal(firstWindow.options.resizable, false);
      assert.equal(firstWindow.options.minimizable, false);
      assert.equal(firstWindow.options.width, 560);
      assert.equal(firstWindow.options.webPreferences.sandbox, true);
      const firstSender = firstWindow.webContents;
      let firstSettled = false; first.then(() => { firstSettled = true; });
      call(firstWindow, 2);
      call(firstWindow, 0, { id: 999 });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(firstSettled, false);
      call(firstWindow, 1);
      assert.deepEqual(await first, { response: 1 });
      assert.equal(globalThis.__dialogTest.handlers["dialog:options"]({ sender: firstSender }), undefined);

      const closed = showThemedMessageBox(parent, { buttons: ["Proceed", "Cancel"], cancelId: 1 });
      globalThis.__dialogTest.windows[1].close();
      assert.deepEqual(await closed, { response: 1 });

      const left = showThemedMessageBox(parent, { buttons: ["A", "B"] });
      const right = showThemedMessageBox(parent, { buttons: ["C", "D"] });
      const leftWindow = globalThis.__dialogTest.windows[2];
      const rightWindow = globalThis.__dialogTest.windows[3];
      call(rightWindow, 0);
      assert.deepEqual(await right, { response: 0 });
      let leftSettled = false; left.then(() => { leftSettled = true; });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(leftSettled, false);
      call(leftWindow, 1);
      assert.deepEqual(await left, { response: 1 });

      const fallback = showThemedMessageBox(parent, { buttons: ["OK"] });
      const fallbackWindow = globalThis.__dialogTest.windows[4];
      await new Promise(resolve => setTimeout(resolve, 350));
      assert.equal(fallbackWindow.isVisible(), true);
      fallbackWindow.close();
      assert.deepEqual(await fallback, { response: 0 });

      const crashed = showThemedMessageBox(parent, { buttons: ["OK"], cancelId: 0 });
      const crashedWindow = globalThis.__dialogTest.windows[5];
      crashedWindow.contents.emit("render-process-gone");
      assert.deepEqual(await crashed, { response: 0 });

      let parentDestroyed = false;
      const parentThatCloses = { isDestroyed() { return parentDestroyed; }, getBounds() { if (parentDestroyed) throw new Error("destroyed parent bounds read"); return { x: 0, y: 0, width: 800, height: 600 }; } };
      const resized = showThemedMessageBox(parentThatCloses, { buttons: ["OK"] });
      const resizedWindow = globalThis.__dialogTest.windows[6];
      parentDestroyed = true;
      globalThis.__dialogTest.listeners["dialog:resize"]({ sender: resizedWindow.webContents }, 200);
      assert.deepEqual(resizedWindow.size, [560, 200]);
      resizedWindow.close();
      assert.deepEqual(await resized, { response: 0 });
    `);
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(bootstrap).href, runner], { encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
