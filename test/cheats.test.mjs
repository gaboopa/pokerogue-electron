import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAXIMUM_FUN_CHEATS, NEUTRAL_CHEATS, applyCheatConfiguration, emptyCheatDocument, loadCheatDocument, validateCheatConfig, writeCheatDocument } from "../src/cheats.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-cheats-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "nested"), { recursive: true });
  return join(root, "nested", "cheats.json");
}

test("cheat validation discards unknown keys and bounds invalid values", () => {
  const result = validateCheatConfig({ enabled: true, minimumMoney: 1_000_000_000, xpMultiplier: 10, extraCandy: -1, pokeballs: { poke: 999, great: 1000 }, unknown: "ignored" });
  assert.equal(result.enabled, true); assert.equal(result.minimumMoney, 0); assert.equal(result.xpMultiplier, 10); assert.equal(result.extraCandy, 0);
  assert.deepEqual(result.pokeballs, { poke: 999, great: 0, ultra: 0, rogue: 0, master: 0 });
  assert.equal(Object.hasOwn(result, "unknown"), false);
});

test("boolean defaults determine accepted keys and invalid-type fallback", () => {
  const defaults = Object.fromEntries(Object.entries(NEUTRAL_CHEATS).filter(([, value]) => typeof value === "boolean"));
  const keys = Object.keys(defaults);
  assert.equal(keys.length, 12);

  const requested = Object.fromEntries(keys.map(key => [key, !defaults[key]]));
  const accepted = validateCheatConfig(requested);
  assert.deepEqual(Object.fromEntries(keys.map(key => [key, accepted[key]])), requested);

  const invalid = Object.fromEntries(keys.map(key => [key, "invalid"]));
  const fallback = validateCheatConfig(invalid);
  assert.deepEqual(Object.fromEntries(keys.map(key => [key, fallback[key]])), defaults);
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

test("malformed cheat document values load fresh neutral documents", async t => {
  const path = await fixture(t);
  for (const value of [null, [], false, 42, "cheats", { config: null, usage: [] }]) {
    await writeFile(path, JSON.stringify(value));
    const first = await loadCheatDocument(path);
    const second = await loadCheatDocument(path);
    assert.deepEqual(first, emptyCheatDocument());
    assert.deepEqual(second, emptyCheatDocument());
    assert.notStrictEqual(first.config, second.config);
    assert.notStrictEqual(first.config.pokeballs, second.config.pokeballs);
    assert.notStrictEqual(first.usage, second.usage);
  }
});

test("valid cheat config and usage fields keep their existing normalization", async t => {
  const path = await fixture(t);
  await writeFile(path, JSON.stringify({
    schemaVersion: 99,
    config: { enabled: true, minimumMoney: 25, unknown: "ignored" },
    usage: { everEnabled: true, lastEnabledAt: "2026-08-01T12:00:00.000Z", lastAppliedAt: 7, applyCount: 3, unknown: true },
  }));
  const document = await loadCheatDocument(path);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.config.enabled, true);
  assert.equal(document.config.minimumMoney, 25);
  assert.equal(Object.hasOwn(document.config, "unknown"), false);
  assert.deepEqual(document.usage, { everEnabled: true, lastEnabledAt: "2026-08-01T12:00:00.000Z", lastAppliedAt: null, applyCount: 3 });
});

test("loading and resetting a null cheat document persists neutral state and relaunches", async t => {
  const path = await fixture(t);
  await writeFile(path, "null");
  const calls = [];
  assert.deepEqual(await loadCheatDocument(path), emptyCheatDocument());

  const result = await applyCheatConfiguration({
    path,
    requested: NEUTRAL_CHEATS,
    confirm: async () => { calls.push("confirm"); return true; },
    backup: async () => calls.push("backup"),
    relaunch: async () => calls.push("relaunch"),
  });

  assert.equal(result.applied, true);
  assert.deepEqual(calls, ["relaunch"]);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    schemaVersion: 1,
    config: NEUTRAL_CHEATS,
    usage: { everEnabled: false, lastEnabledAt: null, lastAppliedAt: result.document.usage.lastAppliedAt, applyCount: 1 },
  });
});

test("missing and syntax-invalid documents recover while other read errors propagate", async t => {
  const path = await fixture(t);
  assert.deepEqual(await loadCheatDocument(path), emptyCheatDocument());
  await writeFile(path, "broken-json");
  assert.deepEqual(await loadCheatDocument(path), emptyCheatDocument());

  await rm(path);
  await mkdir(path, { recursive: true });
  await assert.rejects(loadCheatDocument(path), error => error.code !== "ENOENT" && !(error instanceof SyntaxError));
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

test("a queued cold Backup defers cheat writes, then a verified continuation preserves usage ordering", async t => {
  const path = await fixture(t); let relaunched = false;
  const queued = await applyCheatConfiguration({ path, requested: MAXIMUM_FUN_CHEATS, confirm: async () => true, backup: async () => ({ deferred: true }), relaunch: async () => assert.fail() });
  assert.deepEqual(queued, { applied: false, reason: "backup-pending" });
  assert.deepEqual(await loadCheatDocument(path), emptyCheatDocument());
  const resumed = await applyCheatConfiguration({ path, requested: MAXIMUM_FUN_CHEATS, backupCompleted: true, relaunch: async () => { relaunched = true; }, now: () => new Date("2026-08-01T12:00:00Z") });
  assert.equal(resumed.applied, true); assert.equal(relaunched, true);
  assert.deepEqual((await loadCheatDocument(path)).usage, { everEnabled: true, lastEnabledAt: "2026-08-01T12:00:00.000Z", lastAppliedAt: "2026-08-01T12:00:00.000Z", applyCount: 1 });
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
