import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installersToOffer, offerOldInstallers, pruneAutomaticBackups, pruneUpdateDownloads } from "../src/retention.mjs";

const roots = [];
test.after(() => Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))));

async function temp() {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-retention-"));
  roots.push(root);
  return root;
}

const name = (second, operation, token = "1a2b3c4d") => `backup-2026-10-05T16-19-${String(second).padStart(2, "0")}.123Z-${operation}-${token}`;
const entries = async root => (await readdir(root)).sort();

test("keeps the five newest automatic Backups and removes exactly the two oldest", async () => {
  const root = await temp();
  const names = [name(1, "update"), name(2, "restore"), name(3, "cheat"), name(4, "update"), name(5, "restore"), name(6, "cheat"), name(7, "update")];
  for (const entry of [...names].reverse()) await mkdir(join(root, entry, "data"), { recursive: true });
  const result = await pruneAutomaticBackups(root, 5);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.removed.sort(), names.slice(0, 2).map(entry => join(root, entry)));
  assert.deepEqual(await entries(root), names.slice(2));
});

test("equal stamps are ordered by full name", async () => {
  const root = await temp();
  const names = ["aaaaaaaa", "bbbbbbbb", "cccccccc"].map(token => name(9, "update", token));
  for (const entry of names) await mkdir(join(root, entry));
  const result = await pruneAutomaticBackups(root, 2);
  assert.deepEqual(result.removed, [join(root, names[0])]);
});

test("manual Backups are never removed and do not count toward keep", async () => {
  const root = await temp();
  const manual = Array.from({ length: 8 }, (_, index) => name(index, "manual", `0000000${index}`));
  const automatic = [name(20, "update"), name(21, "cheat"), name(22, "restore")];
  for (const entry of [...manual, ...automatic]) await mkdir(join(root, entry));
  const result = await pruneAutomaticBackups(root, 2);
  assert.deepEqual(result.removed, [join(root, automatic[0])]);
  assert.deepEqual(await entries(root), [...manual, ...automatic.slice(1)].sort());
});

test("legacy names, stage directories, files and links are left alone", async t => {
  const root = await temp();
  const outside = join(await temp(), "target");
  await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "x");
  const legacy = ["backup-2026-01-01T00-00-00.000Z-11111111-2222-3333-4444-555555555555", `backup-capture-${"a".repeat(64)}`, `.capture-${"b".repeat(16)}`, "my-own-notes"];
  for (const entry of legacy) await mkdir(join(root, entry));
  const file = name(1, "update");
  await writeFile(join(root, file), "not a directory");
  let linked = true;
  const link = name(2, "update", "ffffffff");
  try { await symlink(outside, join(root, link), "junction"); } catch { linked = false; }
  const newest = Array.from({ length: 3 }, (_, index) => name(30 + index, "cheat", `1111111${index}`));
  for (const entry of newest) await mkdir(join(root, entry));
  const result = await pruneAutomaticBackups(root, 3);
  assert.deepEqual(result, { removed: [], errors: [] });
  assert.deepEqual(await entries(root), [...legacy, file, ...(linked ? [link] : []), ...newest].sort());
  assert.deepEqual(await entries(outside), ["keep.txt"]);
  if (!linked) t.diagnostic("link creation refused; link case skipped");
});

test("a link with an automatic Backup name is skipped even when it would be pruned", async t => {
  const root = await temp();
  const outside = join(await temp(), "target");
  await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "x");
  try { await symlink(outside, join(root, name(1, "update")), "junction"); } catch { return t.skip("platform refused to create a link"); }
  await mkdir(join(root, name(2, "update", "22222222")));
  const result = await pruneAutomaticBackups(root, 1);
  assert.deepEqual(result, { removed: [], errors: [] });
  assert.deepEqual(await entries(outside), ["keep.txt"]);
});

test("only installers at or below the current version and any installer .partial are removed", async () => {
  const root = await temp();
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const removed = ["PokeRogue-Offline-0.1.4-windows-x64.exe", "PokeRogue-Offline-0.1.5-windows-x64.exe", "PokeRogue-Offline-0.1.4-macos-arm64.dmg", "PokeRogue-Offline-0.1.5-macos-arm64.dmg", `PokeRogue-Offline-0.1.6-windows-x64.exe.${uuid}.partial`, `PokeRogue-Offline-0.0.1-macos-arm64.dmg.${uuid}.partial`];
  const kept = ["PokeRogue-Offline-0.1.6-windows-x64.exe", "PokeRogue-Offline-0.2.0-macos-arm64.dmg", "notes.txt", "PokeRogue-Offline-0.1.4-windows-x64.exe.bak", "PokeRogue-Offline-0.1.4-linux-x64.AppImage", "PokeRogue-Offline-0.1.4-windows-arm64.exe", "PokeRogue-Offline-0.1.4-windows-x64.exe.partial", `prefix-PokeRogue-Offline-0.1.4-windows-x64.exe.${uuid}.partial`, "PokeRogue-Offline-0.1.4-DO-NOT-DISTRIBUTE-windows-x64.exe"];
  for (const entry of [...removed, ...kept]) await writeFile(join(root, entry), "x");
  await mkdir(join(root, "PokeRogue-Offline-0.1.3-windows-x64.exe"));
  const result = await pruneUpdateDownloads(root, "0.1.5");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.removed.sort(), removed.map(entry => join(root, entry)).sort());
  assert.deepEqual(await entries(root), [...kept, "PokeRogue-Offline-0.1.3-windows-x64.exe"].sort());
});

test("missing roots return empty results", async () => {
  const root = join(await temp(), "absent");
  assert.deepEqual(await pruneAutomaticBackups(root, 5), { removed: [], errors: [] });
  assert.deepEqual(await pruneUpdateDownloads(root, "0.1.5"), { removed: [], errors: [] });
});

test("one entry failing is reported and does not stop the rest", async () => {
  const backups = await temp();
  const names = [name(1, "update"), name(2, "update"), name(3, "update")];
  for (const entry of names) await mkdir(join(backups, entry));
  const failing = { lstat: (await import("node:fs/promises")).lstat, readdir, rm: async (path, options) => { if (path.endsWith(names[0])) throw new Error("locked"); return rm(path, options); } };
  const result = await pruneAutomaticBackups(backups, 0, failing);
  assert.deepEqual(result.errors, [{ path: join(backups, names[0]), message: "locked" }]);
  assert.deepEqual(result.removed.sort(), names.slice(1).map(entry => join(backups, entry)));
  assert.deepEqual(await entries(backups), [names[0]]);

  const updates = await temp();
  const old = ["PokeRogue-Offline-0.1.1-windows-x64.exe", "PokeRogue-Offline-0.1.2-windows-x64.exe"];
  for (const entry of old) await writeFile(join(updates, entry), "x");
  const locked = { lstat: failing.lstat, readdir, rm: async (path, options) => { if (path.endsWith(old[0])) throw new Error("EBUSY"); return rm(path, options); } };
  const installers = await pruneUpdateDownloads(updates, "0.1.5", locked);
  assert.deepEqual(installers.errors, [{ path: join(updates, old[0]), message: "EBUSY" }]);
  assert.deepEqual(installers.removed, [join(updates, old[1])]);
});

test("installer offer candidates accept both artifact types and browser duplicates only", () => {
  const names = [
    "PokeRogue-Offline-0.1.4-windows-x64.exe",
    "PokeRogue-Offline-0.1.4-windows-x64 (1).exe",
    "PokeRogue-Offline-0.1.4-macos-arm64.dmg",
    "PokeRogue-Offline-0.1.4-macos-arm64 (12).dmg",
    "PokeRogue-Offline-0.1.6-windows-x64.exe",
    "prefix-PokeRogue-Offline-0.1.4-windows-x64.exe",
    "PokeRogue-Offline-0.1.4-windows-x64.exe.bak",
    "PokeRogue-Offline-0.1.4-windows-x64.exe.partial",
    "folder/PokeRogue-Offline-0.1.4-windows-x64.exe",
    "folder\\PokeRogue-Offline-0.1.4-windows-x64.exe",
  ];
  assert.deepEqual(installersToOffer(names, "0.1.5"), names.slice(0, 4));
});

test("installer cleanup records empty scans and Keep, and moves only after confirmation", async () => {
  const root = await temp();
  const downloads = join(root, "Downloads");
  await mkdir(downloads);
  const statePath = join(root, "installer-cleanup.json");
  const state = async () => JSON.parse(await readFile(statePath, "utf8"));
  const askNothing = async () => { throw new Error("unexpected prompt"); };

  const empty = await offerOldInstallers({ statePath, downloadsPath: downloads, currentVersion: "0.1.5", ask: askNothing, trashItem() { throw new Error("unexpected trash"); } });
  assert.deepEqual(empty, { scanned: true, moved: 0, failed: 0 });
  assert.deepEqual(await state(), { schemaVersion: 1, askedForVersion: "0.1.5" });

  await writeFile(join(downloads, "PokeRogue-Offline-0.1.4-windows-x64.exe"), "fixture");
  let prompted;
  const keep = await offerOldInstallers({
    statePath, downloadsPath: downloads, currentVersion: "0.1.6",
    ask: async names => { prompted = names; return "keep"; }, trashItem() { throw new Error("unexpected trash"); },
  });
  assert.deepEqual(prompted, ["PokeRogue-Offline-0.1.4-windows-x64.exe"]);
  assert.deepEqual(keep, { scanned: true, moved: 0, failed: 0 });
  assert.deepEqual(await state(), { schemaVersion: 1, askedForVersion: "0.1.6" });
});

test("installer cleanup records successful moves and retries after any trash failure", async () => {
  const root = await temp();
  const downloads = join(root, "Downloads");
  await mkdir(downloads);
  const filenames = ["PokeRogue-Offline-0.1.4-windows-x64.exe", "PokeRogue-Offline-0.1.5-macos-arm64.dmg"];
  for (const filename of filenames) await writeFile(join(downloads, filename), "fixture");
  const statePath = join(root, "installer-cleanup.json");
  const options = { statePath, downloadsPath: downloads, currentVersion: "0.1.6", ask: async () => "move" };
  const movedPaths = [];
  const moved = await offerOldInstallers({ ...options, trashItem: async path => movedPaths.push(path) });
  assert.deepEqual(moved, { scanned: true, moved: 2, failed: 0 });
  assert.deepEqual(movedPaths.map(path => path.split(/[\\/]/).pop()), filenames);
  assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), { schemaVersion: 1, askedForVersion: "0.1.6" });

  await writeFile(statePath, "{");
  const failed = await offerOldInstallers({ ...options, trashItem: async path => { if (path.endsWith(filenames[1])) throw new Error("fixture failure"); } });
  assert.deepEqual(failed, { scanned: true, moved: 1, failed: 1 });
  assert.equal(await readFile(statePath, "utf8"), "{");
});

test("installer cleanup treats a malformed state as unasked and skips scans for an asked version", async () => {
  const root = await temp();
  const statePath = join(root, "installer-cleanup.json");
  await writeFile(statePath, "not json");
  let scans = 0;
  const fs = {
    lstat, mkdir, readFile, rename, rm, writeFile,
    readdir: async () => { scans++; return []; },
  };
  await offerOldInstallers({ statePath, downloadsPath: join(root, "Downloads"), currentVersion: "0.1.5", ask: async () => "keep", trashItem() {}, fs });
  const sameVersion = await offerOldInstallers({ statePath, downloadsPath: join(root, "Downloads"), currentVersion: "0.1.5", ask: async () => "keep", trashItem() {}, fs });
  assert.equal(scans, 1);
  assert.deepEqual(sameVersion, { scanned: false, moved: 0, failed: 0 });
});
