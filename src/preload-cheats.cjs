const { contextBridge, ipcRenderer } = require("electron");

const NAMED_KEYS = new Map([
  ["ARROWUP", "ArrowUp"], ["ARROWDOWN", "ArrowDown"], ["ARROWLEFT", "ArrowLeft"], ["ARROWRIGHT", "ArrowRight"],
  ["SPACE", "Space"], [" ", "Space"], ["ENTER", "Enter"], ["ESC", "Escape"], ["ESCAPE", "Escape"], ["TAB", "Tab"],
]);

function normalizeKey(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^[a-z0-9]$/i.test(trimmed)) return trimmed.toUpperCase();
  return NAMED_KEYS.get(value.toUpperCase()) ?? NAMED_KEYS.get(trimmed.toUpperCase()) ?? null;
}

function domKey(key) { return key === "Space" ? " " : key; }
function domCode(key) {
  if (/^[A-Z]$/.test(key)) return `Key${key}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key;
}

class KeyRemapController {
  constructor(emit) { this.emit = emit; this.mappings = {}; this.sources = new Map(); this.targetCounts = new Map(); }
  replaceMappings(mappings) { this.releaseAll(); this.mappings = { ...mappings }; }
  handle(event) {
    if (!event?.isTrusted || event.ctrlKey || event.altKey || event.metaKey) return false;
    const source = normalizeKey(event.key);
    const target = source ? this.mappings[source] : null;
    if (!source || !target || source === target) return false;
    if (event.type === "keydown") {
      if (event.repeat && this.sources.get(source) === target) { this.emit("keydown", target, true); return true; }
      if (this.sources.has(source)) return true;
      this.sources.set(source, target);
      const count = this.targetCounts.get(target) ?? 0;
      this.targetCounts.set(target, count + 1);
      if (count === 0) this.emit("keydown", target, false);
      return true;
    }
    if (event.type === "keyup") {
      const pressedTarget = this.sources.get(source);
      if (!pressedTarget) return true;
      this.sources.delete(source);
      const count = (this.targetCounts.get(pressedTarget) ?? 1) - 1;
      if (count <= 0) { this.targetCounts.delete(pressedTarget); this.emit("keyup", pressedTarget, false); }
      else this.targetCounts.set(pressedTarget, count);
      return true;
    }
    return false;
  }
  releaseAll() {
    for (const target of this.targetCounts.keys()) this.emit("keyup", target, false);
    this.sources.clear(); this.targetCounts.clear();
  }
}

const remapper = new KeyRemapController((type, key, repeat) => window.dispatchEvent(new KeyboardEvent(type, {
  key: domKey(key), code: domCode(key), repeat, bubbles: true, cancelable: true,
})));
function remapKeyboardEvent(event) {
  if (!remapper.handle(event)) return;
  event.preventDefault(); event.stopImmediatePropagation();
}
window.addEventListener("keydown", remapKeyboardEvent, true);
window.addEventListener("keyup", remapKeyboardEvent, true);
window.addEventListener("blur", () => remapper.releaseAll());
ipcRenderer.on("keybindings:update", (_event, mappings) => remapper.replaceMappings(mappings));

function positionCheatBadge() {
  const badge = document.getElementById("desktop-cheats-active");
  if (!badge) return false;
  badge.style.left = "8px";
  badge.style.right = "auto";
  return true;
}

window.addEventListener("DOMContentLoaded", () => {
  if (positionCheatBadge()) return;
  const observer = new MutationObserver(() => {
    if (!positionCheatBadge()) return;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});

contextBridge.exposeInMainWorld("pokerogueDesktop", {
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  getCheatConfig: () => ipcRenderer.invoke("cheats:get-config"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  backupSaves: () => ipcRenderer.invoke("saves:backup"),
  restoreSaves: () => ipcRenderer.invoke("saves:restore"),
  openSaveFolder: () => ipcRenderer.invoke("saves:open-folder"),
});
