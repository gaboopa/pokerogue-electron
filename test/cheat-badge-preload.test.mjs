import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("cheat preload hides the badge when present or inserted later", async () => {
  const source = await readFile(new URL("../src/preload-cheats.cjs", import.meta.url), "utf8");
  let domReady;
  let mutation;
  const badge = { style: {} };
  let present = true;
  const window = { addEventListener(type, callback) { if (type === "DOMContentLoaded") domReady = callback; } };
  class MutationObserver { constructor(callback) { mutation = callback; } observe() {} disconnect() { this.disconnected = true; } }
  const contextBridge = { executeInMainWorld() {}, exposeInMainWorld() {} };
  runInNewContext(source, {
    require: () => ({ contextBridge, ipcRenderer: { on() {}, invoke() {} } }),
    window,
    document: { getElementById: () => present ? badge : null, documentElement: {} },
    MutationObserver,
  });
  domReady();
  assert.equal(badge.style.display, "none");
  present = false;
  domReady();
  present = true;
  mutation();
  assert.equal(badge.style.display, "none");
});
