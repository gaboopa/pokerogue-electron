import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export const STORAGE_DIRECTORIES = ["Local Storage", "IndexedDB", "Session Storage"];

async function hashTree(root) {
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

export async function createBackup(userData, backupRoot) {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const destination = join(backupRoot, `backup-${stamp}`);
  await mkdir(join(destination, "data"), { recursive: true });
  const included = [];
  for (const name of STORAGE_DIRECTORIES) {
    const source = join(userData, name);
    try {
      if ((await stat(source)).isDirectory()) {
        await cp(source, join(destination, "data", name), { recursive: true, errorOnExist: true });
        included.push(name);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), included };
  await writeFile(join(destination, "manifest.json"), JSON.stringify(manifest, null, 2));
  manifest.sha256 = await hashTree(join(destination, "data"));
  await writeFile(join(destination, "manifest.json"), JSON.stringify(manifest, null, 2));
  return destination;
}

export async function validateBackup(backupPath) {
  const manifest = JSON.parse(await readFile(join(backupPath, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.included) || !manifest.sha256) throw new Error("Unsupported backup manifest");
  if (manifest.included.some(name => !STORAGE_DIRECTORIES.includes(name))) throw new Error("Backup contains an unexpected storage directory");
  const actual = await hashTree(join(backupPath, "data"));
  if (actual !== manifest.sha256) throw new Error("Backup checksum verification failed");
  return manifest;
}

export async function restoreBackup(userData, backupPath) {
  const manifest = await validateBackup(backupPath);
  const rollback = join(userData, `.restore-rollback-${Date.now()}`);
  await mkdir(rollback, { recursive: true });
  try {
    for (const name of manifest.included) {
      const current = join(userData, name);
      try { await rename(current, join(rollback, basename(name))); } catch (error) { if (error.code !== "ENOENT") throw error; }
      await cp(join(backupPath, "data", name), current, { recursive: true, errorOnExist: true });
    }
    await rm(rollback, { recursive: true, force: true });
  } catch (error) {
    for (const name of manifest.included) {
      await rm(join(userData, name), { recursive: true, force: true });
      try { await rename(join(rollback, basename(name)), join(userData, name)); } catch (rollbackError) { if (rollbackError.code !== "ENOENT") throw rollbackError; }
    }
    throw error;
  }
}
