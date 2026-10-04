import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { BackupRestoreError, createBackup, restoreBackup, validateBackup } from "../src/backup.mjs";

test("save backups validate and restore without installation files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-backup-"));
  const userData = join(root, "user");
  await mkdir(join(userData, "Local Storage"), { recursive: true });
  await writeFile(join(userData, "Local Storage", "save"), "original");
  const backup = await createBackup(userData, join(root, "backups"));
  assert.equal((await validateBackup(backup)).schemaVersion, 2);
  await writeFile(join(userData, "Local Storage", "save"), "changed");
  await restoreBackup(userData, backup);
  assert.equal(await readFile(join(userData, "Local Storage", "save"), "utf8"), "original");
});

test("missing and invalid Backups report failures before mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-backup-preflight-"));
  const userData = join(root, "user");
  await mkdir(join(userData, "Local Storage"), { recursive: true });
  await writeFile(join(userData, "Local Storage", "save"), "original");
  await assert.rejects(restoreBackup(userData, join(root, "missing")), error => {
    assert.ok(error instanceof BackupRestoreError);
    assert.equal(error.recoveryRequired, false);
    assert.equal(error.restored, false);
    return true;
  });
  const backup = await createBackup(userData, join(root, "backups"));
  await writeFile(join(backup, "manifest.json"), "null");
  await assert.rejects(restoreBackup(userData, backup), error => {
    assert.ok(error instanceof BackupRestoreError);
    assert.equal(error.recoveryRequired, false);
    assert.equal(error.restored, false);
    return true;
  });
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

async function legacyHashTree(root) {
  const hash = createHash("sha256");
  async function visit(dir, prefix = "") {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = join(prefix, entry.name);
      if (entry.isDirectory()) await visit(join(dir, entry.name), rel);
      else {
        hash.update(rel.replaceAll("\\", "/"));
        hash.update(await readFile(join(dir, entry.name)));
      }
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function createHistoricalV1Backup(userData, backupRoot) {
  const backup = join(backupRoot, "historical-v1");
  const dataRoot = join(backup, "data");
  await mkdir(dataRoot, { recursive: true });
  const included = [];
  for (const name of ["Local Storage", "IndexedDB", "Session Storage"]) {
    try {
      await cp(join(userData, name), join(dataRoot, name), { recursive: true, errorOnExist: true });
      included.push(name);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const manifest = {
    schemaVersion: 1,
    createdAt: "2026-10-01T12:00:00.000Z",
    included,
    sha256: await legacyHashTree(dataRoot)
  };
  await writeFile(join(backup, "manifest.json"), JSON.stringify(manifest, null, 2));
  return backup;
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
  await assert.rejects(restoreBackup(userData, backup, filesystem), error => {
    assert.ok(error instanceof BackupRestoreError);
    assert.equal(error.recoveryRequired, false);
    assert.equal(error.restored, false);
    return true;
  });
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
    assert.ok(error instanceof BackupRestoreError);
    assert.equal(error.recoveryRequired, true);
    assert.equal(error.restored, false);
    assert.equal(error.recoveryPath, rollbackPath);
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

test("restore permits startup when only cleanup of a fully restored rollback copy fails", async () => {
  const { userData, backup } = await makeFixture();
  const rollbackPath = join(userData, ".restore-rollback-test");
  const filesystem = faultableFilesystem(userData, rollbackPath, { failCopy: 2 });
  const originalRemove = filesystem.rm;
  filesystem.rm = async (path, options) => {
    if (path === rollbackPath) throw Object.assign(new Error("injected recovery cleanup failure"), { code: "EIO" });
    return originalRemove(path, options);
  };
  await assert.rejects(restoreBackup(userData, backup, filesystem), error => {
    assert.ok(error instanceof BackupRestoreError);
    assert.equal(error.recoveryRequired, false);
    assert.equal(error.restored, false);
    assert.equal(error.recoveryPath, rollbackPath);
    assert.match(error.message, /rollback completed.*cleanup failed/i);
    return true;
  });
  await assertChangedFixtureRestored(userData);
  assert.deepEqual(await readdir(rollbackPath), []);
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

test("restore distinguishes a completed restore with retained recovery copies", async () => {
  const { userData, backup } = await makeFixture();
  const rollbackPath = join(userData, ".restore-rollback-test");
  const filesystem = faultableFilesystem(userData, rollbackPath);
  filesystem.rm = async (path, options) => {
    if (path === rollbackPath) throw Object.assign(new Error("injected cleanup failure"), { code: "EIO" });
    return rm(path, options);
  };
  await assert.rejects(restoreBackup(userData, backup, filesystem), error => {
    assert.ok(error instanceof BackupRestoreError);
    assert.equal(error.recoveryRequired, false);
    assert.equal(error.restored, true);
    assert.equal(error.recoveryPath, rollbackPath);
    return true;
  });
  assert.equal(await readFile(join(userData, "Local Storage", "save"), "utf8"), "original Local Storage");
  assert.equal(await readFile(join(rollbackPath, "Local Storage", "save"), "utf8"), "changed Local Storage");
});

test("restore rejects an empty inventory hiding backed-up data before target mutation", async () => {
  const { userData, backup } = await makeFixture();
  const manifestPath = join(backup, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.included = [];
  await writeFile(manifestPath, JSON.stringify(manifest));

  await assert.rejects(restoreBackup(userData, backup), /inventory|directory/i);
  await assertChangedFixtureRestored(userData);
});

test("valid historical schemaVersion 1 backups restore with their original tree checksum", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-backup-v1-"));
  const userData = join(root, "user");
  await mkdir(userData, { recursive: true });
  for (const name of ["Local Storage", "IndexedDB", "Session Storage"]) {
    await mkdir(join(userData, name));
    await writeFile(join(userData, name, "save"), `historical ${name}`);
  }
  const backup = await createHistoricalV1Backup(userData, join(root, "backups"));
  const manifest = await validateBackup(backup);
  assert.equal(manifest.schemaVersion, 1);
  const corruptedBackup = await createHistoricalV1Backup(userData, join(root, "corrupted-backups"));
  const legacyFile = join(corruptedBackup, "data", "Local Storage", "save");
  const legacyBytes = Buffer.from(await readFile(legacyFile));
  legacyBytes[0] ^= 1;
  await writeFile(legacyFile, legacyBytes);
  await assert.rejects(validateBackup(corruptedBackup), /checksum/i);
  assert.equal(await readFile(join(userData, "Local Storage", "save"), "utf8"), "historical Local Storage");
  manifest.createdAt = "2026-10-02T12:00:00.000Z";
  await writeFile(join(backup, "manifest.json"), JSON.stringify(manifest));
  assert.equal((await validateBackup(backup)).createdAt, manifest.createdAt);

  for (const name of ["Local Storage", "IndexedDB", "Session Storage"]) {
    await writeFile(join(userData, name, "save"), `changed ${name}`);
  }
  await restoreBackup(userData, backup);
  for (const name of ["Local Storage", "IndexedDB", "Session Storage"]) {
    assert.equal(await readFile(join(userData, name, "save"), "utf8"), `historical ${name}`);
  }
});

test("new backup integrity binds its canonical restore metadata", async () => {
  const { userData, backup } = await makeFixture();
  const manifestPath = join(backup, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(manifest.included, ["IndexedDB", "Local Storage", "Session Storage"]);
  manifest.schemaVersion = 1;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(validateBackup(backup), /checksum/i);
  manifest.schemaVersion = 2;
  manifest.createdAt = "2026-10-02T12:00:00.000Z";
  await writeFile(manifestPath, JSON.stringify(manifest));

  await assert.rejects(validateBackup(backup), /checksum/i);
  await assert.rejects(restoreBackup(userData, backup), /checksum/i);
  await assertChangedFixtureRestored(userData);
});

test("same-size backup corruption is rejected before restore changes the target", async () => {
  const { userData, backup } = await makeFixture();
  const savedFile = join(backup, "data", "Local Storage", "save");
  const bytes = await readFile(savedFile);
  const corrupted = Buffer.from(bytes);
  corrupted[0] ^= 1;
  assert.equal(corrupted.length, bytes.length);
  await writeFile(savedFile, corrupted);

  await assert.rejects(validateBackup(backup), /checksum/i);
  await assert.rejects(restoreBackup(userData, backup), /checksum/i);
  await assertChangedFixtureRestored(userData);
});

test("malformed manifests and mismatched inventories fail before target mutation", async () => {
  const cases = [
    ["null manifest", async ({ backup }) => writeFile(join(backup, "manifest.json"), "null")],
    ["array manifest", async ({ backup }) => writeFile(join(backup, "manifest.json"), "[]")],
    ["missing manifest field", async ({ backup, manifest }) => {
      delete manifest.createdAt;
      await writeFile(join(backup, "manifest.json"), JSON.stringify(manifest));
    }],
    ["unexpected manifest field", async ({ backup, manifest }) => {
      manifest.extra = true;
      await writeFile(join(backup, "manifest.json"), JSON.stringify(manifest));
    }],
    ["duplicate inventory entry", async ({ backup, manifest }) => {
      manifest.included.push(manifest.included[0]);
      await writeFile(join(backup, "manifest.json"), JSON.stringify(manifest));
    }],
    ["invalid checksum encoding", async ({ backup, manifest }) => {
      manifest.sha256 = "not-a-sha256";
      await writeFile(join(backup, "manifest.json"), JSON.stringify(manifest));
    }],
    ["missing inventory directory", async ({ backup }) => rm(join(backup, "data", "Session Storage"), { recursive: true })],
    ["unlisted inventory directory", async ({ backup }) => mkdir(join(backup, "data", "unexpected"))],
    ["unexpected data file", async ({ backup }) => writeFile(join(backup, "data", "unexpected.txt"), "extra")]
  ];

  for (const [name, change] of cases) {
    const { userData, backup } = await makeFixture();
    const manifest = JSON.parse(await readFile(join(backup, "manifest.json"), "utf8"));
    await change({ backup, manifest });
    await assert.rejects(validateBackup(backup), undefined, name);
    await assert.rejects(restoreBackup(userData, backup), undefined, name);
    await assertChangedFixtureRestored(userData);
  }
});

test("genuine empty snapshots validate and leave target storage untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-empty-backup-"));
  const userData = join(root, "user");
  await mkdir(userData, { recursive: true });
  const backup = await createBackup(userData, join(root, "backups"));
  assert.deepEqual((await validateBackup(backup)).included, []);
  await mkdir(join(userData, "Local Storage"));
  await writeFile(join(userData, "Local Storage", "save"), "keep current data");

  await restoreBackup(userData, backup);
  assert.equal(await readFile(join(userData, "Local Storage", "save"), "utf8"), "keep current data");
});

test("backup inventory rejects symbolic links", async t => {
  const { root, backup } = await makeFixture();
  const outside = join(root, "outside-storage");
  await mkdir(outside);
  await writeFile(join(outside, "outside-save"), "outside data");
  try {
    await symlink(outside, join(backup, "data", "Local Storage", "outside-link"), "junction");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      t.skip(`this Windows environment does not permit symbolic links: ${error.message}`);
      return;
    }
    throw error;
  }
  await assert.rejects(validateBackup(backup), /symbolic link|unsupported/i);
});

async function makePublicationFixture() {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-backup-publish-"));
  const userData = join(root, "user");
  const backupRoot = join(root, "backups");
  await mkdir(backupRoot, { recursive: true });
  for (const name of ["Local Storage", "IndexedDB", "Session Storage"]) {
    await mkdir(join(userData, name), { recursive: true });
    await writeFile(join(userData, name, "save"), `source ${name}`);
  }
  const unrelated = join(backupRoot, "backup-prior");
  await mkdir(unrelated);
  await writeFile(join(unrelated, "sentinel"), "preserve prior bytes");
  return { root, userData, backupRoot, unrelated };
}

async function publicationEntries(backupRoot) {
  return readdir(backupRoot);
}

async function assertOnlyPriorBackupRemains(backupRoot) {
  assert.deepEqual(await publicationEntries(backupRoot), ["backup-prior"]);
  assert.equal(await readFile(join(backupRoot, "backup-prior", "sentinel"), "utf8"), "preserve prior bytes");
}

async function assertPublicationSourceIntact(userData) {
  for (const name of ["Local Storage", "IndexedDB", "Session Storage"]) {
    assert.equal(await readFile(join(userData, name, "save"), "utf8"), `source ${name}`);
  }
}

test("Backup publication validates a unique staging directory before atomic rename", async () => {
  const { root, userData, backupRoot } = await makePublicationFixture();
  try {
    const first = await createBackup(userData, backupRoot);
    const second = await createBackup(userData, backupRoot);
    assert.notEqual(first, second);
    for (const backup of [first, second]) {
      const manifest = await validateBackup(backup);
      assert.equal(manifest.schemaVersion, 2);
      assert.deepEqual(manifest.included, ["IndexedDB", "Local Storage", "Session Storage"]);
      for (const name of manifest.included) {
        assert.equal(await readFile(join(backup, "data", name, "save"), "utf8"), `source ${name}`);
      }
    }
    const entries = await publicationEntries(backupRoot);
    assert.equal(entries.filter(name => name.startsWith(".backup-")).length, 0);
    assert.deepEqual(entries.filter(name => name.startsWith("backup-")).sort(), ["backup-prior", first.split(/[\\/]/).at(-1), second.split(/[\\/]/).at(-1)].sort());
    assert.equal(await readFile(join(backupRoot, "backup-prior", "sentinel"), "utf8"), "preserve prior bytes");
    await assertPublicationSourceIntact(userData);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overlapping Backup creations publish separate validated directories without replacing prior data", async () => {
  const { root, userData, backupRoot } = await makePublicationFixture();
  let releaseCopies;
  let signalBothCopies;
  const copyGate = new Promise(resolve => { releaseCopies = resolve; });
  const bothCopies = new Promise(resolve => { signalBothCopies = resolve; });
  let firstCopies = 0;
  const filesystem = {
    cp: async (source, destination, options) => {
      if (firstCopies < 2) {
        firstCopies++;
        if (firstCopies === 2) signalBothCopies();
        await copyGate;
      }
      return cp(source, destination, options);
    }
  };
  try {
    const onePromise = createBackup(userData, backupRoot, filesystem);
    const twoPromise = createBackup(userData, backupRoot, filesystem);
    let timer;
    await Promise.race([bothCopies, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("overlapping copies did not reach the gate")), 5000); })]);
    clearTimeout(timer);
    releaseCopies();
    const [one, two] = await Promise.all([onePromise, twoPromise]);
    assert.notEqual(one, two);
    await Promise.all([validateBackup(one), validateBackup(two)]);
    assert.equal((await publicationEntries(backupRoot)).filter(name => name.startsWith(".backup-")).length, 0);
    assert.equal(await readFile(join(backupRoot, "backup-prior", "sentinel"), "utf8"), "preserve prior bytes");
    await assertPublicationSourceIntact(userData);
  } finally {
    releaseCopies();
    await rm(root, { recursive: true, force: true });
  }
});

test("copy, hash, manifest, validation, and publish failures never expose a final Backup", async t => {
  const failures = [
    ["copy", async () => ({ cp: async (_source, destination) => { await mkdir(destination, { recursive: true }); await writeFile(join(destination, "partial"), "partial bytes"); throw new Error("injected copy failure"); } })],
    ["hash", async () => ({ readdir: async (path, options) => { if (String(path).endsWith(join("data"))) throw new Error("injected hash failure"); return readdir(path, options); } })],
    ["manifest", async () => ({ writeFile: async (path, ...args) => { if (String(path).endsWith("manifest.json")) throw new Error("injected manifest failure"); return writeFile(path, ...args); } })],
    ["validation", async () => { let manifestWritten = false; return {
      writeFile: async (path, ...args) => { const result = await writeFile(path, ...args); if (String(path).endsWith("manifest.json")) manifestWritten = true; return result; },
      readFile: async (path, ...args) => { if (manifestWritten && String(path).endsWith("manifest.json")) throw new Error("injected validation failure"); return readFile(path, ...args); }
    }; }],
    ["publish", async () => ({ rename: async () => { throw new Error("injected publish failure"); } })]
  ];
  for (const [boundary, makeFaults] of failures) {
    await t.test(boundary, async () => {
      const { root, userData, backupRoot } = await makePublicationFixture();
      try {
        const faults = await makeFaults({ cp });
        await assert.rejects(createBackup(userData, backupRoot, faults), new RegExp(`injected ${boundary} failure`));
        await assertOnlyPriorBackupRemains(backupRoot);
        await assertPublicationSourceIntact(userData);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("a failed stage cleanup reports the original error and retained owned path", async () => {
  const { root, userData, backupRoot } = await makePublicationFixture();
  let retainedStage;
  const filesystem = {
    cp: async (source, destination, options) => { await cp(source, destination, options); throw new Error("original copy failure"); },
    rm: async (path, options) => { if (String(path).includes(".backup-")) { retainedStage = path; throw new Error("stage cleanup failure"); } return rm(path, options); }
  };
  try {
    await assert.rejects(createBackup(userData, backupRoot, filesystem), error => {
      assert.match(error.message, /original copy failure/);
      assert.match(error.message, /stage cleanup failure/);
      assert.ok(error.message.includes(retainedStage));
      return true;
    });
    assert.ok(retainedStage);
    assert.equal(dirname(retainedStage), backupRoot);
    assert.deepEqual((await readdir(retainedStage)).includes("manifest.json"), false);
    assert.deepEqual((await publicationEntries(backupRoot)).sort(), ["backup-prior", retainedStage.split(/[\\/]/).at(-1)].sort());
    assert.equal(await readFile(join(backupRoot, "backup-prior", "sentinel"), "utf8"), "preserve prior bytes");
    await assertPublicationSourceIntact(userData);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
