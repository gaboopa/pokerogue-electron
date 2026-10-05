import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseBackupName } from "./backup-coordinator.mjs";
import { compareVersions } from "./updater.mjs";

const defaultFs = { lstat, readdir, rm };
// ponytail: the two targets in package.json artifactName; add a pair here when a target is added
const INSTALLER = /^PokeRogue-Offline-(\d+\.\d+\.\d+)-(?:windows-x64\.exe|macos-arm64\.dmg)$/;
const PARTIAL = /^(PokeRogue-Offline-\d+\.\d+\.\d+-(?:windows-x64\.exe|macos-arm64\.dmg))\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.partial$/;

async function list(root, fs, result) {
  try { return await fs.readdir(root); }
  catch (error) {
    if (error.code !== "ENOENT") result.errors.push({ path: root, message: error.message });
    return [];
  }
}

async function removeEntry(path, kind, fs, result) {
  try {
    const info = await fs.lstat(path);
    if (kind === "directory" ? !info.isDirectory() : !info.isFile()) return;
    await fs.rm(path, { recursive: kind === "directory", force: true });
    result.removed.push(path);
  } catch (error) { result.errors.push({ path, message: error.message }); }
}

export async function pruneAutomaticBackups(backupRoot, keep, fs = defaultFs) {
  const result = { removed: [], errors: [] };
  const candidates = [];
  for (const name of await list(backupRoot, fs, result)) {
    const parsed = parseBackupName(name);
    if (!parsed || parsed.operation === "manual") continue;
    try { if ((await fs.lstat(join(backupRoot, name))).isDirectory()) candidates.push({ name, stamp: parsed.stamp }); }
    catch (error) { result.errors.push({ path: join(backupRoot, name), message: error.message }); }
  }
  candidates.sort((a, b) => (a.stamp === b.stamp ? (a.name < b.name ? 1 : -1) : a.stamp < b.stamp ? 1 : -1));
  for (const { name } of candidates.slice(keep)) await removeEntry(join(backupRoot, name), "directory", fs, result);
  return result;
}

export async function pruneUpdateDownloads(updateRoot, currentVersion, fs = defaultFs) {
  const result = { removed: [], errors: [] };
  for (const name of await list(updateRoot, fs, result)) {
    const path = join(updateRoot, name);
    try {
      const installer = INSTALLER.exec(name);
      if (installer ? compareVersions(installer[1], currentVersion) > 0 : !PARTIAL.test(name)) continue;
    } catch (error) { result.errors.push({ path, message: error.message }); continue; }
    await removeEntry(path, "file", fs, result);
  }
  return result;
}
