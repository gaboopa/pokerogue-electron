import test from "node:test";
import assert from "node:assert/strict";
import { createMenuTemplate } from "../src/menu.mjs";


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
});
