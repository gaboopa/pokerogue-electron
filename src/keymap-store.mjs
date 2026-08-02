import { readFile, stat, writeFile } from "node:fs/promises";
import { DEFAULT_KEYMAP, parseKeymap } from "./keybindings.mjs";
const serializedDefaults = `${JSON.stringify(DEFAULT_KEYMAP, null, 2)}\n`;
export async function ensureKeymap(path) {
  try { await stat(path); } catch (error) { if (error.code !== "ENOENT") throw error; await writeFile(path, serializedDefaults, { encoding: "utf8", flag: "wx" }); }
  return path;
}
export async function loadKeymap(path, warn = console.warn) {
  await ensureKeymap(path);
  try { return parseKeymap(JSON.parse(await readFile(path, "utf8")), warn); }
  catch (error) { warn(`Could not load keybindings from ${path}: ${error.message}; using defaults.`); return { ...DEFAULT_KEYMAP }; }
}
export async function resetKeymap(path) { await writeFile(path, serializedDefaults, "utf8"); return { ...DEFAULT_KEYMAP }; }
export async function keymapModifiedAt(path) { await ensureKeymap(path); return (await stat(path)).mtimeMs; }
