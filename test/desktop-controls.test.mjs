import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMenuTemplate } from "../src/menu.mjs";

const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
const preload = await readFile(new URL("../src/preload-keybindings.mjs", import.meta.url), "utf8");

test("desktop reload, fullscreen, and developer shortcuts remain registered", () => {
  const menu = createMenuTemplate({
    isMac: false,
    productName: "PokeRogue Offline",
    onCheckForUpdates() {},
    onBackup() {},
    onRestore() {},
    onOpenSaveFolder() {},
    onReload() {},
    onToggleFullscreen() {},
    onDeveloperTools() {},
    utilities: [],
    keybindings: [],
    cheats: [],
  });
  const view = menu.find((item) => item.label === "View");
  assert.deepEqual(view.submenu.map((item) => item.accelerator), ["CommandOrControl+R", "F11", "F12"]);
  assert.match(main, /input\.key === "F5"/);
});

test("validated mappings use one-way IPC without exposing filesystem access", () => {
  assert.match(main, /webContents\.send\("keybindings:update", mappings\)/);
  assert.match(preload, /ipcRenderer\.on\("keybindings:update"/);
  assert.doesNotMatch(preload, /readFile|writeFile|openPath/);
});
