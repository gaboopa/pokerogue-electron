import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAXIMUM_FUN_CHEATS, NEUTRAL_CHEATS, applyCheatConfiguration, loadCheatDocument, validateCheatConfig, writeCheatDocument } from "../src/cheats.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-cheats-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, "nested", "cheats.json");
}

test("cheat validation discards unknown keys and bounds invalid values", () => {
  const result = validateCheatConfig({ enabled: true, minimumMoney: 1_000_000_000, xpMultiplier: 10, extraCandy: -1, pokeballs: { poke: 999, great: 1000 }, unknown: "ignored" });
  assert.equal(result.enabled, true); assert.equal(result.minimumMoney, 0); assert.equal(result.xpMultiplier, 10); assert.equal(result.extraCandy, 0);
  assert.deepEqual(result.pokeballs, { poke: 999, great: 0, ultra: 0, rogue: 0, master: 0 });
  assert.equal(Object.hasOwn(result, "unknown"), false);
});

test("maximum fun and neutral presets remain stable", () => {
  assert.equal(MAXIMUM_FUN_CHEATS.minimumMoney, 1_000_000); assert.equal(MAXIMUM_FUN_CHEATS.xpMultiplier, 10);
  assert.deepEqual(MAXIMUM_FUN_CHEATS.pokeballs, { poke: 99, great: 99, ultra: 99, rogue: 99, master: 10 });
  assert.equal(Object.values(NEUTRAL_CHEATS).filter(value => value === true).length, 0);
});

test("cheat documents write atomically and malformed files fail closed", async t => {
  const path = await fixture(t); const document = { schemaVersion: 1, config: MAXIMUM_FUN_CHEATS, usage: { everEnabled: true, lastEnabledAt: null, lastAppliedAt: null, applyCount: 3 } };
  await writeCheatDocument(path, document); assert.deepEqual((await loadCheatDocument(path)).config, MAXIMUM_FUN_CHEATS);
  await writeFile(path, "broken-json"); assert.deepEqual((await loadCheatDocument(path)).config, NEUTRAL_CHEATS);
});

test("enabled changes confirm, back up, persist metadata, then relaunch", async t => {
  const path = await fixture(t); const calls = [];
  const result = await applyCheatConfiguration({
    path, requested: MAXIMUM_FUN_CHEATS, confirm: async () => { calls.push("confirm"); return true; }, backup: async () => calls.push("backup"), relaunch: async () => calls.push("relaunch"), now: () => new Date("2026-08-01T12:00:00Z"),
  });
  assert.equal(result.applied, true); assert.deepEqual(calls, ["confirm", "backup", "relaunch"]);
  const stored = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(stored.usage, { everEnabled: true, lastEnabledAt: "2026-08-01T12:00:00.000Z", lastAppliedAt: "2026-08-01T12:00:00.000Z", applyCount: 1 });
});

test("cancel and backup failure leave the existing configuration untouched", async t => {
  const path = await fixture(t); await writeCheatDocument(path, { schemaVersion: 1, config: MAXIMUM_FUN_CHEATS, usage: { everEnabled: true, lastEnabledAt: null, lastAppliedAt: null, applyCount: 1 } });
  const before = await readFile(path, "utf8");
  const cancelled = await applyCheatConfiguration({ path, requested: NEUTRAL_CHEATS, confirm: async () => false, backup: async () => assert.fail(), relaunch: async () => assert.fail() });
  assert.equal(cancelled.reason, "cancelled"); assert.equal(await readFile(path, "utf8"), before);
  await assert.rejects(applyCheatConfiguration({ path, requested: NEUTRAL_CHEATS, confirm: async () => true, backup: async () => { throw new Error("backup failed"); }, relaunch: async () => assert.fail() }), /backup failed/);
  assert.equal(await readFile(path, "utf8"), before);
});

test("disabled-to-disabled updates need no backup but still persist and relaunch", async t => {
  const path = await fixture(t); let backups = 0; let relaunched = false;
  await applyCheatConfiguration({ path, requested: { ...NEUTRAL_CHEATS, xpMultiplier: 4 }, confirm: async () => assert.fail(), backup: async () => backups++, relaunch: async () => { relaunched = true; } });
  assert.equal(backups, 0); assert.equal(relaunched, true); assert.equal((await loadCheatDocument(path)).config.xpMultiplier, 4);
});

test("cheat window and IPC remain local and sandboxed", async () => {
  for (const file of ["index.html", "styles.css", "renderer.mjs", "preload.cjs"]) await access(new URL(`../src/cheat-window/${file}`, import.meta.url));
  const controller = await readFile(new URL("../src/cheat-main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../src/cheat-window/preload.cjs", import.meta.url), "utf8");
  const gamePreload = await readFile(new URL("../src/preload-cheats.cjs", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(controller, /event\.sender\.id !== editorWindow\.webContents\.id/);
  assert.match(controller, /sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true/);
  assert.match(controller, /preload\.cjs/);
  assert.match(preload, /applyConfig: config => ipcRenderer\.invoke\("cheats:apply", config\)/);
  assert.match(main, /preload-cheats\.cjs/);
  assert.match(gamePreload, /getCheatConfig: \(\) => ipcRenderer\.invoke\("cheats:get-config"\)/);
  assert.match(main, /scheme === "http:" \|\| scheme === "https:" \|\| scheme === "ws:" \|\| scheme === "wss:"/);
});
