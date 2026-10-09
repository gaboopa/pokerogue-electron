import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { isDirectChild } from "./backup.mjs";
import { parseBackupName } from "./backup-coordinator.mjs";

export async function listBackups(backupRoot, fs = { readdir, readFile }) {
  let entries;
  try { entries = await fs.readdir(backupRoot, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const backups = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
    const parsed = parseBackupName(entry.name);
    let createdAt = parsed ? parsed.stamp.replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3") : "";
    let reason = parsed ? parsed.operation : "unknown";
    if (!parsed) {
      try {
        const manifest = JSON.parse(await fs.readFile(join(backupRoot, entry.name, "manifest.json"), "utf8"));
        if (typeof manifest.createdAt === "string" && Number.isFinite(Date.parse(manifest.createdAt))) createdAt = manifest.createdAt;
      } catch { /* An unreadable manifest has no fallback time. */ }
    }
    backups.push({ name: entry.name, createdAt, reason });
  }
  return backups.sort((left, right) => (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0));
}

export function resolveBackupName(backupRoot, name, listedNames) {
  if (typeof name !== "string" || name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\\") || isAbsolute(name) || !listedNames.includes(name)) {
    throw new Error("Backup name is not in the current Backup list.");
  }
  const candidate = resolve(backupRoot, name);
  if (!isDirectChild(backupRoot, candidate)) throw new Error("Backup name is not a direct child of the Backup folder.");
  return candidate;
}
