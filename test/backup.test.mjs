import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
