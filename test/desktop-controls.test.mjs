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
    profileNames: ["Clean"],
    activeProfile: "Clean",
  });
  const view = menu.find((item) => item.label === "View");
  assert.deepEqual(view.submenu.map((item) => item.accelerator), ["CommandOrControl+R", "F11", "F12"]);
  const labels = menu.map(item => item.label);
  assert.equal(menu[0].submenu.find(item => item.label === "Restore Backup…").label, "Restore Backup…");
  assert.equal(labels.indexOf("Profiles"), labels.indexOf("Cheats") + 1);
  const profiles = menu.find(item => item.label === "Profiles").submenu;
  assert.deepEqual(profiles.filter(item => item.type === "radio").map(item => item.label), ["Default", "Clean"]);
  assert.equal(profiles[0].checked, false);
  assert.equal(profiles[1].checked, true);
  assert.equal(profiles.at(-1).label, "New Profile…");
});
