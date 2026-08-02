import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_KEYMAP, KeyRemapController, normalizeKey, parseKeymap } from "../src/keybindings.mjs";
import { ensureKeymap, keymapModifiedAt, loadKeymap, resetKeymap } from "../src/keymap-store.mjs";

const keyboard = (type, key, extra = {}) => ({ type, key, isTrusted: true, ctrlKey: false, altKey: false, metaKey: false, repeat: false, ...extra });

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

test("remapping forwards down, repeat, and up while bypassing modifiers", () => {
  const output = []; const controller = new KeyRemapController((...entry) => output.push(entry), { W: "ArrowUp" });
  assert.equal(controller.handle(keyboard("keydown", "w")), true); assert.equal(controller.handle(keyboard("keydown", "w", { repeat: true })), true);
  assert.equal(controller.handle(keyboard("keyup", "w")), true); assert.equal(controller.handle(keyboard("keydown", "w", { ctrlKey: true })), false);
  assert.equal(controller.handle(keyboard("keydown", "w", { isTrusted: false })), false);
  assert.deepEqual(output, [["keydown", "ArrowUp", false], ["keydown", "ArrowUp", true], ["keyup", "ArrowUp", false]]);
});

test("duplicate targets stay held until every source is released", () => {
  const output = []; const controller = new KeyRemapController((...entry) => output.push(entry), { W: "ArrowUp", A: "ArrowUp" });
  controller.handle(keyboard("keydown", "w")); controller.handle(keyboard("keydown", "a")); controller.handle(keyboard("keyup", "w"));
  assert.deepEqual(output, [["keydown", "ArrowUp", false]]); controller.handle(keyboard("keyup", "a"));
  assert.deepEqual(output.at(-1), ["keyup", "ArrowUp", false]);
});

test("reloading mappings releases synthetic keys that are still held", () => {
  const output = []; const controller = new KeyRemapController((...entry) => output.push(entry), { W: "ArrowUp" });
  controller.handle(keyboard("keydown", "w")); controller.replaceMappings({ W: "Z" });
  assert.deepEqual(output.at(-1), ["keyup", "ArrowUp", false]);
});
