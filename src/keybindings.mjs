export const DEFAULT_KEYMAP = Object.freeze({ W: "W", A: "A", S: "S", D: "D", Z: "Z", X: "X", C: "C", G: "G", E: "E", N: "N" });
const NAMED_KEYS = new Map([["ARROWUP", "ArrowUp"], ["ARROWDOWN", "ArrowDown"], ["ARROWLEFT", "ArrowLeft"], ["ARROWRIGHT", "ArrowRight"], ["SPACE", "Space"], [" ", "Space"], ["ENTER", "Enter"], ["ESC", "Escape"], ["ESCAPE", "Escape"], ["TAB", "Tab"]]);

export function normalizeKey(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^[a-z0-9]$/i.test(trimmed)) return trimmed.toUpperCase();
  return NAMED_KEYS.get(value.toUpperCase()) ?? NAMED_KEYS.get(trimmed.toUpperCase()) ?? null;
}

export function parseKeymap(value, warn = () => {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warn("Keybindings must be a JSON object; using defaults.");
    return { ...DEFAULT_KEYMAP };
  }
  const result = {};
  for (const [sourceValue, targetValue] of Object.entries(value)) {
    const source = normalizeKey(sourceValue);
    const target = normalizeKey(targetValue);
    if (!source || !target) { warn(`Ignoring invalid keybinding ${JSON.stringify(sourceValue)}: ${JSON.stringify(targetValue)}.`); continue; }
    result[source] = target;
  }
  return result;
}

export function domKey(key) { return key === "Space" ? " " : key; }
export function domCode(key) {
  if (/^[A-Z]$/.test(key)) return `Key${key}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key;
}

export class KeyRemapController {
  constructor(emit, mappings = {}) { this.emit = emit; this.mappings = { ...mappings }; this.sources = new Map(); this.targetCounts = new Map(); }
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
  releaseAll() { for (const target of this.targetCounts.keys()) this.emit("keyup", target, false); this.sources.clear(); this.targetCounts.clear(); }
}
