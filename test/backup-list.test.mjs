import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listBackups, resolveBackupName } from "../src/backup-list.mjs";

test("Backup listing filters entries, maps reasons, falls back to manifest time, and sorts newest first", async t => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-backup-list-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const names = ["manual", "update", "restore", "cheat"].map((reason, index) => `backup-2026-10-0${index + 1}T12-00-00.000Z-${reason}-${String(index).padStart(8, "0")}`);
  for (const name of names) await mkdir(join(root, name));
  await mkdir(join(root, "legacy"));
  await writeFile(join(root, "legacy", "manifest.json"), JSON.stringify({ createdAt: "2026-10-05T12:00:00.000Z" }));
  await mkdir(join(root, ".hidden"));
  await writeFile(join(root, "not-a-directory"), "file");
  const listed = await listBackups(root, {
    readdir: async (...args) => [...await readdir(...args), { name: "linked", isDirectory: () => false, isSymbolicLink: () => true }],
    readFile,
  });
  assert.deepEqual(listed.map(item => item.name), ["legacy", names[3], names[2], names[1], names[0]]);
  assert.deepEqual(Object.fromEntries(listed.filter(item => item.reason !== "unknown").map(item => [item.reason, item.createdAt])), {
    cheat: "2026-10-04T12:00:00.000Z", restore: "2026-10-03T12:00:00.000Z", update: "2026-10-02T12:00:00.000Z", manual: "2026-10-01T12:00:00.000Z",
  });
  assert.deepEqual(listed[0], { name: "legacy", createdAt: "2026-10-05T12:00:00.000Z", reason: "unknown" });
});

test("missing Backup folders list as empty and unparseable manifests have blank time", async t => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-backup-list-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await listBackups(join(root, "missing")), []);
  await mkdir(join(root, "legacy"));
  assert.deepEqual(await listBackups(root), [{ name: "legacy", createdAt: "", reason: "unknown" }]);
});

test("Backup name resolution only accepts listed direct child names", () => {
  const root = join(tmpdir(), "backups");
  assert.equal(resolveBackupName(root, "listed", ["listed"]), join(root, "listed"));
  for (const name of ["unknown", "../listed", "folder\\listed", "folder/listed", root]) {
    assert.throws(() => resolveBackupName(root, name, ["listed"]));
  }
});
