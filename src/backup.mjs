import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const STORAGE_DIRECTORIES = ["Local Storage", "IndexedDB", "Session Storage"];

const filesystem = { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile };
const CURRENT_SCHEMA_VERSION = 2;

export function isDirectChild(root, candidate) {
  const absolute = resolve(candidate);
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, absolute);
  const samePath = (left, right) => process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
  return isAbsolute(candidate) && Boolean(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) && samePath(dirname(absolute), resolvedRoot);
}

export class BackupRestoreError extends Error {
  constructor(message, { cause, recoveryRequired = false, recoveryPath, recoveryErrors = [], restored = false } = {}) {
    super(message, { cause });
    this.name = "BackupRestoreError";
    this.recoveryRequired = recoveryRequired;
    this.recoveryPath = recoveryPath;
    this.recoveryErrors = recoveryErrors;
    this.restored = restored;
  }
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedNames(names) {
  return [...names].sort(compareNames);
}

function updateFrame(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

async function hashTree(root, fs = filesystem) {
  const hash = createHash("sha256");
  async function visit(dir, prefix = "") {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = join(prefix, entry.name);
      if (entry.isDirectory()) await visit(join(dir, entry.name), rel);
      else {
        hash.update(rel.replaceAll("\\", "/"));
        hash.update(await fs.readFile(join(dir, entry.name)));
      }
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function hashTreeV2(root, fs = filesystem) {
  const hash = createHash("sha256");
  async function visit(dir, prefix = "") {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => compareNames(a.name, b.name))) {
      const relativePath = (prefix ? `${prefix}/${entry.name}` : entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        updateFrame(hash, "directory");
        updateFrame(hash, relativePath);
        await visit(join(dir, entry.name), relativePath);
        updateFrame(hash, "end-directory");
      } else if (entry.isFile()) {
        updateFrame(hash, "file");
        updateFrame(hash, relativePath);
        updateFrame(hash, await fs.readFile(join(dir, entry.name)));
      } else {
        throw new Error("Backup data contains a symbolic link or unsupported entry");
      }
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function assertSafeTree(root, fs = filesystem) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Backup data contains a symbolic link or unsupported entry");
    if (entry.isDirectory()) await assertSafeTree(join(root, entry.name), fs);
    else if (!entry.isFile()) throw new Error("Backup data contains a symbolic link or unsupported entry");
  }
}

async function assertInventory(backupPath, included, fs = filesystem) {
  const dataRoot = join(backupPath, "data");
  let rootInfo;
  try {
    rootInfo = await fs.lstat(dataRoot);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Backup data directory is missing");
    throw error;
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Backup data root must be a directory");

  const entries = await fs.readdir(dataRoot, { withFileTypes: true });
  if (entries.some(entry => !entry.isDirectory() || !STORAGE_DIRECTORIES.includes(entry.name))) {
    throw new Error("Backup data contains an unexpected storage directory or entry");
  }
  const actual = sortedNames(entries.map(entry => entry.name));
  const expected = sortedNames(included);
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error("Backup inventory does not match its data directories");
  }
  await assertSafeTree(dataRoot, fs);
}

async function hashBackupV2(dataRoot, metadata, fs = filesystem) {
  const hash = createHash("sha256");
  updateFrame(hash, "pokerogue-offline-backup");
  updateFrame(hash, String(metadata.schemaVersion));
  updateFrame(hash, metadata.createdAt);
  updateFrame(hash, JSON.stringify(metadata.included));
  updateFrame(hash, Buffer.from(await hashTreeV2(dataRoot, fs), "hex"));
  return hash.digest("hex");
}

function validateManifestShape(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Unsupported backup manifest");
  const expectedKeys = ["schemaVersion", "createdAt", "included", "sha256"];
  const keys = Object.keys(manifest);
  if (keys.length !== expectedKeys.length || keys.some(key => !expectedKeys.includes(key))) throw new Error("Unsupported backup manifest");
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new Error("Unsupported backup manifest version");
  if (typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt)) || new Date(manifest.createdAt).toISOString() !== manifest.createdAt) {
    throw new Error("Backup manifest has an invalid creation time");
  }
  if (!Array.isArray(manifest.included) || manifest.included.some(name => typeof name !== "string" || !STORAGE_DIRECTORIES.includes(name))) {
    throw new Error("Backup contains an unexpected storage directory");
  }
  if (new Set(manifest.included).size !== manifest.included.length) throw new Error("Backup inventory contains duplicate directories");
  if (manifest.schemaVersion === CURRENT_SCHEMA_VERSION && sortedNames(manifest.included).some((name, index) => name !== manifest.included[index])) {
    throw new Error("Backup inventory is not in canonical order");
  }
  if (typeof manifest.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error("Backup manifest has an invalid checksum");
}

function assertOwnedStage(backupRoot, stagePath) {
  const resolvedStage = resolve(stagePath);
  if (!isDirectChild(backupRoot, stagePath)) {
    throw new Error(`Refusing to remove Backup stage outside its root: ${stagePath}`);
  }
  return resolvedStage;
}

export async function createBackup(userData, backupRoot, fs = filesystem) {
  const operations = { ...filesystem, ...fs };
  const stamp = new Date().toISOString().replaceAll(":", "-");
  await operations.mkdir(backupRoot, { recursive: true });
  let stage;
  try {
    const candidate = join(backupRoot, `.backup-${stamp}-${randomUUID()}.tmp`);
    await operations.mkdir(candidate);
    stage = candidate;
    await operations.mkdir(join(stage, "data"));
    const included = [];
    for (const name of STORAGE_DIRECTORIES) {
      const source = join(userData, name);
      let info;
      try {
        info = await operations.lstat(source);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        continue;
      }
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Save storage path is not a directory: ${name}`);
      await operations.cp(source, join(stage, "data", name), { recursive: true, errorOnExist: true });
      included.push(name);
    }
    const manifest = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      included: sortedNames(included)
    };
    manifest.sha256 = await hashBackupV2(join(stage, "data"), manifest, operations);
    await operations.writeFile(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));
    await validateBackup(stage, operations);

    const destination = join(backupRoot, `backup-${stamp}-${randomUUID()}`);
    try {
      await operations.lstat(destination);
      throw new Error("Could not allocate a unique published Backup directory");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await operations.rename(stage, destination);
    stage = undefined;
    return destination;
  } catch (error) {
    if (!stage) throw error;
    try {
      await operations.rm(assertOwnedStage(backupRoot, stage), { recursive: true, force: true });
    } catch (cleanupError) {
      throw new Error(`Backup creation failed: ${error.message}. Temporary Backup stage retained at ${stage}; cleanup failed: ${cleanupError.message}`, { cause: error });
    }
    throw error;
  }
}

export async function validateBackup(backupPath, fs = filesystem) {
  const operations = { ...filesystem, ...fs };
  const manifest = JSON.parse(await operations.readFile(join(backupPath, "manifest.json"), "utf8"));
  validateManifestShape(manifest);
  await assertInventory(backupPath, manifest.included, operations);
  const actual = manifest.schemaVersion === 1
    ? await hashTree(join(backupPath, "data"), operations)
    : await hashBackupV2(join(backupPath, "data"), manifest, operations);
  if (actual !== manifest.sha256) throw new Error("Backup checksum verification failed");
  return manifest;
}

export async function restoreBackup(userData, backupPath, fs = filesystem) {
  const operations = { ...filesystem, ...fs };
  let manifest;
  try {
    manifest = await validateBackup(backupPath);
  } catch (error) {
    throw new BackupRestoreError(error.message, { cause: error });
  }
  const rollback = fs.rollbackPath ?? join(userData, `.restore-rollback-${Date.now()}`);
  const movedOriginals = new Set();
  const attemptedCopies = new Set();
  try {
    await operations.mkdir(rollback, { recursive: true });
  } catch (error) {
    throw new BackupRestoreError(error.message, { cause: error });
  }
  try {
    for (const name of manifest.included) {
      const current = join(userData, name);
      try {
        await operations.rename(current, join(rollback, basename(name)));
        movedOriginals.add(name);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      attemptedCopies.add(name);
      await operations.cp(join(backupPath, "data", name), current, { recursive: true, errorOnExist: true });
    }
  } catch (error) {
    const recoveryErrors = [];
    let cleanupError;
    for (const name of [...manifest.included].reverse()) {
      if (attemptedCopies.has(name)) {
        try {
          await operations.rm(join(userData, name), { recursive: true, force: true });
        } catch (rollbackError) {
          recoveryErrors.push(`${name}: ${rollbackError.message}`);
          continue;
        }
      }
      if (movedOriginals.has(name)) {
        try {
          await operations.rename(join(rollback, basename(name)), join(userData, name));
        } catch (rollbackError) {
          recoveryErrors.push(`${name}: ${rollbackError.message}`);
        }
      }
    }
    if (!recoveryErrors.length) {
      try {
        await operations.rm(rollback, { recursive: true, force: true });
      } catch (rollbackError) {
        cleanupError = rollbackError;
      }
    }
    if (recoveryErrors.length) {
      throw new BackupRestoreError(`Restore failed: ${error.message}. Rollback also failed: ${recoveryErrors.join("; ")}. Recovery data retained at ${rollback}`, {
        cause: error,
        recoveryRequired: true,
        recoveryPath: rollback,
        recoveryErrors
      });
    }
    if (cleanupError) {
      throw new BackupRestoreError(`Restore failed: ${error.message}. Rollback completed, but recovery cleanup failed: ${cleanupError.message}. Recovery data retained at ${rollback}`, {
        cause: error,
        recoveryPath: rollback,
        recoveryErrors: [cleanupError.message]
      });
    }
    throw new BackupRestoreError(error.message, { cause: error });
  }
  try {
    await operations.rm(rollback, { recursive: true, force: true });
  } catch (error) {
    throw new BackupRestoreError(`Restore completed, but recovery cleanup failed at ${rollback}: ${error.message}`, {
      cause: error,
      recoveryPath: rollback,
      restored: true
    });
  }
}
