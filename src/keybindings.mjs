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
