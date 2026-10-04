import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateBackup } from "./backup.mjs";
import { validateCheatConfig } from "./cheats.mjs";
import { compareVersions, validateReleaseManifest } from "./updater.mjs";

export const BACKUP_INTENT_VERSION = 1;
export const BACKUP_INTENT_OPERATIONS = Object.freeze(["manual", "update", "restore", "cheat"]);
export const BACKUP_INTENT_STATES = Object.freeze(["requested", "capturing", "captured", "resuming", "interrupted", "completed", "cancelled", "failed"]);

const JOURNAL_NAME = "backup-intent.json";
const JOURNAL_KEYS = ["version", "token", "operation", "state", "revision", "createdAt", "updatedAt", "sourceProfile", "backupRoot", "updateRoot", "payload", "capturedBackupPath", "failure"];
const transitions = Object.freeze({
  requested: ["capturing", "cancelled", "failed"],
  capturing: ["captured", "interrupted", "failed"],
  captured: ["cancelled", "failed"],
  resuming: ["completed", "interrupted", "failed"],
  interrupted: ["cancelled", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
});
const tokenPattern = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) fail(`${label} has unsupported keys or shape`);
}

function optionalShape(value, required, allowed, label) {
  if (!isRecord(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.includes(key))) {
    fail(`${label} has unsupported keys or is missing required fields`);
  }
}

function samePath(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US") : a === b;
}

function pathsFor(userData) {
  if (typeof userData !== "string" || !isAbsolute(userData) || userData.trim() !== userData) fail("App-owned userData path must be absolute");
  const sourceProfile = resolve(userData);
  const backupRoot = resolve(sourceProfile, "Save Backups");
  const updateRoot = resolve(sourceProfile, "Updates");
  return {
    userData: sourceProfile,
    sourceProfile,
    backupRoot,
    updateRoot,
    journalPath: join(sourceProfile, JOURNAL_NAME),
  };
}

function assertIntentPaths(intent, paths) {
  if (!samePath(intent.sourceProfile, paths.sourceProfile)) fail("Intent source profile does not match app-owned userData");
  if (!samePath(intent.backupRoot, paths.backupRoot)) fail("Intent Backup root does not match the app-owned Backup directory");
  if (!samePath(intent.updateRoot, paths.updateRoot)) fail("Intent Update root does not match the app-owned Update directory");
}

function assertIsoTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(`Intent ${label} is invalid`);
  if (new Date(value).toISOString() !== value) fail(`Intent ${label} is not canonical`);
}

function assertSafeBasename(value, label) {
  if (typeof value !== "string" || value.length === 0 || value === "." || value === ".." || /[\\/]/.test(value) || basename(value) !== value) {
    fail(`${label} must be an owned basename`);
  }
}

function isDirectChild(root, candidate) {
  const absolute = resolve(candidate);
  if (!isAbsolute(candidate)) return false;
  const rel = relative(root, absolute);
  return Boolean(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) && samePath(dirname(absolute), root);
}

function assertSelectedBackupPath(selectedBackup) {
  if (typeof selectedBackup !== "string" || !isAbsolute(selectedBackup) || selectedBackup.trim() !== selectedBackup) fail("Restore selection must be an absolute Backup path");
  return resolve(selectedBackup);
}

function assertUpdateManifest(payload) {
  exactKeys(payload, ["manifest", "platform", "arch"], "Update payload");
  exactKeys(payload.manifest, ["schemaVersion", "version", "sourceRevisions", "artifacts"], "Release manifest");
  exactKeys(payload.manifest.sourceRevisions, ["game", "assets", "locales"], "Release source revisions");
  if (typeof payload.platform !== "string" || typeof payload.arch !== "string") fail("Update coordinates must be strings");
  const { artifact } = validateReleaseManifest(payload.manifest, payload.platform, payload.arch);
  compareVersions(payload.manifest.version, payload.manifest.version);
  for (const item of payload.manifest.artifacts) exactKeys(item, ["platform", "arch", "fileName", "size", "sha256", "downloadUrl"], "Release artifact");
  const urlName = basename(new URL(artifact.downloadUrl).pathname);
  assertSafeBasename(urlName, "Update download URL basename");
  return { manifest: payload.manifest, platform: payload.platform, arch: payload.arch };
}

async function assertRealDirectory(path, label) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) fail(`${label} must be a real directory`);
}

function assertCheatPayload(payload) {
  exactKeys(payload, ["config"], "Cheat payload");
  const normalized = validateCheatConfig(payload.config);
  if (!isDeepStrictEqual(payload.config, normalized)) fail("Cheat configuration must match the normalized schema before persistence or application");
  return normalized;
}

function validatePayloadShape(operation, payload) {
  switch (operation) {
    case "manual":
      exactKeys(payload, [], "Manual payload");
      return {};
    case "update":
      return assertUpdateManifest(payload);
    case "restore": {
      exactKeys(payload, ["selectedBackup"], "Restore payload");
      return { selectedBackup: assertSelectedBackupPath(payload.selectedBackup) };
    }
    case "cheat":
      return { config: assertCheatPayload(payload) };
    default:
      fail(`Unsupported Backup operation: ${operation}`);
  }
}

async function validateSelectedBackup(selectedBackup) {
  let info;
  try { info = await lstat(selectedBackup); }
  catch (error) { throw new Error(`Selected Backup is unavailable: ${error.message}`, { cause: error }); }
  if (!info.isDirectory() || info.isSymbolicLink()) fail("Restore selection must be a real Backup directory");
  const manifestInfo = await lstat(join(selectedBackup, "manifest.json"));
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) fail("Backup manifest must be a regular file");
  await validateBackup(selectedBackup);
}

async function validateOperationPayload(operation, payload) {
  const normalized = validatePayloadShape(operation, payload);
  if (operation === "restore") await validateSelectedBackup(normalized.selectedBackup);
  return normalized;
}

function assertIntentShape(intent) {
  exactKeys(intent, JOURNAL_KEYS, "Backup intent");
  if (intent.version !== BACKUP_INTENT_VERSION) fail("Unsupported Backup intent version");
  if (typeof intent.token !== "string" || !tokenPattern.test(intent.token)) fail("Backup intent token must be 32 random bytes encoded as lowercase hex");
  if (!BACKUP_INTENT_OPERATIONS.includes(intent.operation)) fail("Unsupported Backup intent operation");
  if (!BACKUP_INTENT_STATES.includes(intent.state)) fail("Unsupported Backup intent state");
  if (!Number.isSafeInteger(intent.revision) || intent.revision < 0) fail("Backup intent revision is invalid");
  assertIsoTimestamp(intent.createdAt, "creation time");
  assertIsoTimestamp(intent.updatedAt, "update time");
  if (Date.parse(intent.updatedAt) < Date.parse(intent.createdAt)) fail("Backup intent update time predates creation");
  for (const key of ["sourceProfile", "backupRoot", "updateRoot"]) {
    if (typeof intent[key] !== "string" || !isAbsolute(intent[key])) fail(`Backup intent ${key} must be an absolute path`);
  }
  if (intent.capturedBackupPath !== null && typeof intent.capturedBackupPath !== "string") fail("Captured Backup path must be a string or null");
  if (intent.failure !== null) {
    exactKeys(intent.failure, ["code", "message"], "Backup intent failure");
    if (typeof intent.failure.code !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(intent.failure.code)) fail("Backup intent failure code is invalid");
    if (typeof intent.failure.message !== "string" || intent.failure.message.length === 0 || intent.failure.message.length > 1024) fail("Backup intent failure message is invalid");
  }
  if (["requested", "capturing"].includes(intent.state) && intent.capturedBackupPath !== null) fail("Uncaptured intent cannot name a Backup");
  if (["requested", "capturing", "captured", "resuming", "completed", "cancelled"].includes(intent.state) && intent.failure !== null) fail("Non-failed intent cannot contain a failure");
  if (["failed", "interrupted"].includes(intent.state) && intent.failure === null) fail("Failed or interrupted intent must describe its failure");
  if (["captured", "resuming", "completed"].includes(intent.state) && intent.capturedBackupPath === null) fail("Captured intent state must name its published Backup");
}

function validateIntent(intent, paths) {
  assertIntentShape(intent);
  assertIntentPaths(intent, paths);
  validatePayloadShape(intent.operation, intent.payload);
  if (intent.capturedBackupPath !== null) {
    const expected = getCapturePaths(paths.userData, intent.token).finalBackupPath;
    if (!samePath(intent.capturedBackupPath, expected)) fail("Captured Backup path is not the token-owned publication path");
  }
  return intent;
}

function assertFailure(value) {
  exactKeys(value, ["code", "message"], "Failure details");
  if (typeof value.code !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(value.code)) fail("Failure code is invalid");
  if (typeof value.message !== "string" || value.message.length === 0 || value.message.length > 1024) fail("Failure message is invalid");
  return { code: value.code, message: value.message };
}

function assertTransition(from, to) {
  if (typeof to !== "string" || !BACKUP_INTENT_STATES.includes(to)) fail("Unsupported Backup intent transition");
  if (!transitions[from]?.includes(to)) fail(`Invalid Backup intent transition from ${from} to ${to}`);
}

function assertRevision(intent, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== intent.revision) fail("Stale Backup intent revision");
}

function assertToken(intent, expectedToken) {
  if (typeof expectedToken !== "string" || !tokenPattern.test(expectedToken)) fail("Expected Backup intent token is invalid");
  if (intent.token !== expectedToken) fail("Backup intent token mismatch; stale worker rejected");
}

async function readIntentFile(paths, expectedToken) {
  const info = await lstat(paths.journalPath);
  if (!info.isFile() || info.isSymbolicLink()) fail("Backup intent journal must be a regular app-owned file");
  const intent = JSON.parse(await readFile(paths.journalPath, "utf8"));
  assertIntentShape(intent);
  assertIntentPaths(intent, paths);
  assertToken(intent, expectedToken);
  validateIntent(intent, paths);
  return intent;
}

async function writeInitialJournal(paths, intent) {
  const handle = await open(paths.journalPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(intent, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceJournal(paths, intent) {
  const temporary = join(paths.userData, `.backup-intent-${intent.token}-${intent.revision}.tmp`);
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(intent, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, paths.journalPath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function getCapturePaths(userData, token) {
  const paths = pathsFor(userData);
  if (typeof token !== "string" || !tokenPattern.test(token)) fail("Capture token is invalid");
  return {
    backupRoot: paths.backupRoot,
    updateRoot: paths.updateRoot,
    journalPath: paths.journalPath,
    stageRoot: join(paths.backupRoot, `.capture-${token}`),
    finalBackupPath: join(paths.backupRoot, `backup-capture-${token}`),
  };
}

export async function createIntent(input) {
  exactKeys(input, ["userData", "operation", "payload"], "New Backup intent input");
  const { userData, operation, payload } = input;
  const paths = pathsFor(userData);
  if (!BACKUP_INTENT_OPERATIONS.includes(operation)) fail(`Unsupported Backup operation: ${operation}`);
  const normalizedPayload = await validateOperationPayload(operation, payload);
  const now = new Date().toISOString();
  const intent = {
    version: BACKUP_INTENT_VERSION,
    token: randomBytes(32).toString("hex"),
    operation,
    state: "requested",
    revision: 0,
    createdAt: now,
    updatedAt: now,
    sourceProfile: paths.sourceProfile,
    backupRoot: paths.backupRoot,
    updateRoot: paths.updateRoot,
    payload: normalizedPayload,
    capturedBackupPath: null,
    failure: null,
  };
  validateIntent(intent, paths);
  try {
    await writeInitialJournal(paths, intent);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("A Backup intent is already pending; startup must acknowledge it before another request", { cause: error });
    throw error;
  }
  return intent;
}

export async function readIntent(input) {
  exactKeys(input, ["userData", "expectedToken"], "Read Backup intent input");
  const { userData, expectedToken } = input;
  return readIntentFile(pathsFor(userData), expectedToken);
}

export async function transitionIntent(input) {
  optionalShape(input, ["userData", "expectedToken", "expectedRevision", "nextState"], ["userData", "expectedToken", "expectedRevision", "nextState", "capturedBackupPath", "failure", "ownerExited"], "Backup transition input");
  const { userData, expectedToken, expectedRevision, nextState, capturedBackupPath, failure, ownerExited } = input;
  const paths = pathsFor(userData);
  const current = await readIntentFile(paths, expectedToken);
  assertRevision(current, expectedRevision);
  assertTransition(current.state, nextState);
  if (nextState === "interrupted" && ownerExited !== true) fail("Interrupted transition requires confirmation that the owner process exited");

  let nextCapturedBackupPath = current.capturedBackupPath;
  if (nextState === "captured") {
    const expected = getCapturePaths(paths.userData, current.token).finalBackupPath;
    if (typeof capturedBackupPath !== "string" || !samePath(capturedBackupPath, expected)) fail("Capture completion must use the token-owned published Backup path");
    await assertRealDirectory(paths.backupRoot, "App-owned Backup root");
    const info = await lstat(expected);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("Published Backup must be a real directory");
    const manifestInfo = await lstat(join(expected, "manifest.json"));
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) fail("Published Backup manifest must be a regular file");
    await validateBackup(expected);
    nextCapturedBackupPath = expected;
  } else if (capturedBackupPath !== undefined) {
    fail("Only capture completion may set the published Backup path");
  }

  let nextFailure = null;
  if (nextState === "failed") nextFailure = assertFailure(failure);
  else if (nextState === "interrupted") nextFailure = { code: "interrupted", message: "The operation owner exited before recording completion; replay is blocked." };
  else if (failure !== undefined) fail("Only a failed transition may include failure details");
  if (ownerExited !== undefined && nextState !== "interrupted") fail("Owner-exit confirmation is valid only for an interrupted transition");

  const next = {
    ...current,
    state: nextState,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    capturedBackupPath: nextCapturedBackupPath,
    failure: nextFailure,
  };
  assertIntentShape(next);
  await replaceJournal(paths, next);
  return next;
}

async function validateInstaller(path, artifact) {
  let info;
  try { info = await lstat(path); }
  catch (error) { throw new Error(`Verified Update installer is unavailable: ${error.message}`, { cause: error }); }
  if (!info.isFile() || info.isSymbolicLink()) fail("Verified Update installer must be a regular file in the app-owned Update directory");
  if (info.size !== artifact.size) fail("Verified Update installer size changed after download");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest("hex").toLowerCase() !== artifact.sha256.toLowerCase()) fail("Verified Update installer hash changed after download");
  return path;
}

export async function prepareResumeIntent(input) {
  exactKeys(input, ["userData", "expectedToken", "expectedRevision"], "Resume Backup intent input");
  const { userData, expectedToken, expectedRevision } = input;
  const paths = pathsFor(userData);
  const current = await readIntentFile(paths, expectedToken);
  assertRevision(current, expectedRevision);
  if (current.state !== "captured") {
    if (["capturing", "resuming", "interrupted"].includes(current.state)) fail(`Backup intent is ${current.state}; automatic replay is blocked`);
    fail(`Backup intent in state ${current.state} cannot resume`);
  }
  const payload = await validateOperationPayload(current.operation, current.payload);
  if (current.capturedBackupPath !== null) await validateSelectedBackup(current.capturedBackupPath);
  let continuation;
  if (current.operation === "update") {
    const artifact = validateReleaseManifest(payload.manifest, payload.platform, payload.arch).artifact;
    const installerFileName = basename(new URL(artifact.downloadUrl).pathname);
    assertSafeBasename(installerFileName, "Update download URL basename");
    await assertRealDirectory(paths.updateRoot, "App-owned Update root");
    const installerPath = resolve(paths.updateRoot, installerFileName);
    if (!isDirectChild(paths.updateRoot, installerPath)) fail("Update installer path is not an app-owned basename");
    await validateInstaller(installerPath, artifact);
    continuation = { artifact, installerPath };
  } else if (current.operation === "restore") {
    continuation = { selectedBackup: payload.selectedBackup };
  } else if (current.operation === "cheat") {
    continuation = { config: payload.config };
  } else {
    continuation = { backupPath: current.capturedBackupPath };
  }

  const next = {
    ...current,
    state: "resuming",
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  assertIntentShape(next);
  await replaceJournal(paths, next);
  return { intent: next, continuation };
}

export async function clearTerminalIntent(input) {
  optionalShape(input, ["userData", "expectedToken"], ["userData", "expectedToken", "startupConfirmed"], "Clear Backup intent input");
  const { userData, expectedToken, startupConfirmed } = input;
  if (startupConfirmed !== true) fail("Only a fresh primary startup may acknowledge a terminal Backup intent");
  const paths = pathsFor(userData);
  const current = await readIntentFile(paths, expectedToken);
  if (!["completed", "cancelled", "failed"].includes(current.state)) fail("Only a terminal Backup intent can be acknowledged at startup");
  await rm(paths.journalPath);
  return current;
}

export async function cleanupCaptureStage(input) {
  exactKeys(input, ["userData", "expectedToken"], "Capture cleanup input");
  const { userData, expectedToken } = input;
  const paths = pathsFor(userData);
  const intent = await readIntentFile(paths, expectedToken);
  if (!["interrupted", "completed", "cancelled", "failed"].includes(intent.state)) fail("Capture stage cleanup requires a terminal or interrupted intent");
  const stagePath = getCapturePaths(paths.userData, intent.token).stageRoot;
  let rootInfo;
  try { rootInfo = await lstat(paths.backupRoot); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail("App-owned Backup root is not a real directory");
  if (!isDirectChild(paths.backupRoot, stagePath)) fail("Derived capture stage escaped the app-owned Backup root");
  let info;
  try { info = await lstat(stagePath); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (!info.isDirectory() || info.isSymbolicLink()) fail("Token-owned capture stage is not a real directory");
  await rm(stagePath, { recursive: true });
  return true;
}
