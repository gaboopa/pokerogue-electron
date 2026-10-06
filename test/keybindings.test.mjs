import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_KEYMAP, normalizeKey, parseKeymap } from "../src/keybindings.mjs";
import { ensureKeymap, keymapModifiedAt, loadKeymap, resetKeymap } from "../src/keymap-store.mjs";

test("supported key names normalize to canonical values", () => {
  assert.equal(normalizeKey("w"), "W"); assert.equal(normalizeKey("7"), "7"); assert.equal(normalizeKey("arrowleft"), "ArrowLeft");
  assert.equal(normalizeKey(" "), "Space"); assert.equal(normalizeKey("Esc"), "Escape"); assert.equal(normalizeKey("Shift"), null);
});

test("keymap parsing retains valid entries and warns about invalid entries", () => {
  const warnings = [];
  assert.deepEqual(parseKeymap({ w: "ArrowUp", Bad: "Shift", x: "7" }, warning => warnings.push(warning)), { W: "ArrowUp", X: "7" });
  assert.equal(warnings.length, 1); assert.deepEqual(parseKeymap(null, warning => warnings.push(warning)), DEFAULT_KEYMAP);
});

test("keymap store creates, loads, resets, and reports changes", async t => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-keymap-")); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "keymap.json"); await ensureKeymap(path);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), DEFAULT_KEYMAP);
  const firstModified = await keymapModifiedAt(path);
  await writeFile(path, JSON.stringify({ q: "z", invalid: "Shift" }));
  assert.deepEqual(await loadKeymap(path, () => {}), { Q: "Z" }); assert.ok(await keymapModifiedAt(path) >= firstModified);
  assert.deepEqual(await resetKeymap(path), DEFAULT_KEYMAP); assert.deepEqual(await loadKeymap(path), DEFAULT_KEYMAP);
});

test("invalid JSON falls back without overwriting the user file", async t => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-keymap-invalid-")); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "keymap.json"); await writeFile(path, "not-json");
  assert.deepEqual(await loadKeymap(path, () => {}), DEFAULT_KEYMAP); assert.equal(await readFile(path, "utf8"), "not-json");
});
