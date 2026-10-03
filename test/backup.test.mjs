import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackup, restoreBackup, validateBackup } from "../src/backup.mjs";

test("save backups validate and restore without installation files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-backup-"));
  const userData = join(root, "user");
  await mkdir(join(userData, "Local Storage"), { recursive: true });
  await writeFile(join(userData, "Local Storage", "save"), "original");
  const backup = await createBackup(userData, join(root, "backups"));
  await validateBackup(backup);
  await writeFile(join(userData, "Local Storage", "save"), "changed");
  await restoreBackup(userData, backup);
  assert.equal(await readFile(join(userData, "Local Storage", "save"), "utf8"), "original");
});

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-restore-rollback-"));
  const userData = join(root, "user");
  await mkdir(userData, { recursive: true });
  for (const name of ["Local Storage", "IndexedDB", "Session Storage"]) {
    await mkdir(join(userData, name));
    await writeFile(join(userData, name, "save"), `original ${name}`);
    await writeFile(join(userData, name, "extra"), `original extra ${name}`);
  }
  await mkdir(join(userData, "untouched"));
  await writeFile(join(userData, "untouched", "marker"), "leave me");
  const backup = await createBackup(userData, join(root, "backups"));
  for (const name of ["Local Storage", "IndexedDB", "Session Storage"]) {
    await writeFile(join(userData, name, "save"), `changed ${name}`);
    await writeFile(join(userData, name, "extra"), `changed extra ${name}`);
  }
  return { root, userData, backup };
}

async function assertChangedFixtureRestored(userData) {
  for (const name of ["Local Storage", "IndexedDB", "Session Storage"]) {
    assert.equal(await readFile(join(userData, name, "save"), "utf8"), `changed ${name}`);
    assert.equal(await readFile(join(userData, name, "extra"), "utf8"), `changed extra ${name}`);
  }
  assert.equal(await readFile(join(userData, "untouched", "marker"), "utf8"), "leave me");
}

function faultableFilesystem(userData, rollbackPath, { failMove, failCopy, failRollback } = {}) {
  let moves = 0;
  let copies = 0;
  return {
    mkdir,
    rm,
    rollbackPath,
    rename: async (from, to) => {
      const isMoveToRollback = from.startsWith(userData) && to.startsWith(rollbackPath);
      const isRollback = from.startsWith(rollbackPath) && to.startsWith(userData);
      if (isMoveToRollback && ++moves === failMove) throw Object.assign(new Error("injected move failure"), { code: "EIO" });
      if (isRollback && failRollback) throw Object.assign(new Error("injected rollback failure"), { code: "EIO" });
      return rename(from, to);
    },
    cp: async (from, to, options) => {
      if (from.split(/[\\/]/).includes("data") && ++copies === failCopy) {
        await mkdir(to, { recursive: true });
        await writeFile(join(to, "save"), "partial copy");
        throw Object.assign(new Error("injected partial copy failure"), { code: "ENOSPC" });
      }
      return cp(from, to, options);
    }
  };
}

test("restore rolls back every failed move and copy boundary without changing other data", async () => {
  for (const boundary of ["move", "copy"]) {
    for (let failure = 1; failure <= 3; failure++) {
      const { userData, backup } = await makeFixture();
      const rollbackPath = join(userData, ".restore-rollback-test");
      const filesystem = faultableFilesystem(userData, rollbackPath, {
        failMove: boundary === "move" ? failure : undefined,
        failCopy: boundary === "copy" ? failure : undefined
      });
      await assert.rejects(restoreBackup(userData, backup, filesystem));
      await assertChangedFixtureRestored(userData);
      await assert.rejects(readdir(rollbackPath), { code: "ENOENT" });
    }
  }
});

test("restore rolls back a partial copy and leaves originally absent directories absent", async () => {
  const { userData, backup } = await makeFixture();
  await rm(join(userData, "Session Storage"), { recursive: true });
  const rollbackPath = join(userData, ".restore-rollback-test");
  const filesystem = faultableFilesystem(userData, rollbackPath, { failCopy: 3 });
  await assert.rejects(restoreBackup(userData, backup, filesystem));
  assert.equal(await readFile(join(userData, "Local Storage", "save"), "utf8"), "changed Local Storage");
  assert.equal(await readFile(join(userData, "Local Storage", "extra"), "utf8"), "changed extra Local Storage");
  assert.equal(await readFile(join(userData, "IndexedDB", "save"), "utf8"), "changed IndexedDB");
  assert.equal(await readFile(join(userData, "IndexedDB", "extra"), "utf8"), "changed extra IndexedDB");
  await assert.rejects(readdir(join(userData, "Session Storage")), { code: "ENOENT" });
});

test("restore reports and retains recovery originals when rollback fails", async () => {
  const { userData, backup } = await makeFixture();
  const rollbackPath = join(userData, ".restore-rollback-test");
  const filesystem = faultableFilesystem(userData, rollbackPath, { failCopy: 2, failRollback: true });
  await assert.rejects(restoreBackup(userData, backup, filesystem), error => {
    assert.match(error.message, /injected partial copy failure/);
    assert.match(error.message, /injected rollback failure/);
    assert.match(error.message, /\.restore-rollback-/);
    return true;
  });
  for (const name of ["Local Storage", "IndexedDB"]) {
    assert.equal(await readFile(join(rollbackPath, name, "save"), "utf8"), `changed ${name}`);
    assert.equal(await readFile(join(rollbackPath, name, "extra"), "utf8"), `changed extra ${name}`);
    await assert.rejects(readdir(join(userData, name)), { code: "ENOENT" });
  }
  assert.equal(await readFile(join(userData, "Session Storage", "save"), "utf8"), "changed Session Storage");
  assert.equal(await readFile(join(userData, "untouched", "marker"), "utf8"), "leave me");
});

test("successful restore changes declared directories and removes recovery copies", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-restore-declared-"));
  const userData = join(root, "user");
  await mkdir(join(userData, "Local Storage"), { recursive: true });
  await writeFile(join(userData, "Local Storage", "save"), "backup bytes");
  const backup = await createBackup(userData, join(root, "backups"));
  await writeFile(join(userData, "Local Storage", "save"), "changed bytes");
  await mkdir(join(userData, "IndexedDB"));
  await writeFile(join(userData, "IndexedDB", "keep"), "untouched");
  const rollbackPath = join(userData, ".restore-rollback-test");
  await restoreBackup(userData, backup, faultableFilesystem(userData, rollbackPath));
  assert.equal(await readFile(join(userData, "Local Storage", "save"), "utf8"), "backup bytes");
  assert.equal(await readFile(join(userData, "IndexedDB", "keep"), "utf8"), "untouched");
  await assert.rejects(readdir(rollbackPath), { code: "ENOENT" });
});
