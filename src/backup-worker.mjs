import { app } from "electron";
import { lstat, mkdir, rename, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { createBackup, isDirectChild, validateBackup } from "./backup.mjs";
import { BACKUP_TOKEN_PATTERN } from "./constants.mjs";
import { cleanupCaptureStage, getCapturePaths, readIntent, recoverStaleIntentLock, transitionIntent } from "./backup-coordinator.mjs";

const contextKey = Symbol.for("pokerogue.backup-worker-context");
async function assertParentExited(pid) {
  try {
    process.kill(pid, 0);
    throw new Error(`Source process ${pid} is still alive; live-profile capture is forbidden`);
  } catch (error) {
    if (error.code === "ESRCH") return;
    if (error.message.includes("still alive")) throw error;
    throw new Error(`Cannot prove source process ${pid} exited: ${error.message}`, { cause: error });
  }
}

function normalRelaunchArgs(testProbe) {
  const args = app.isPackaged ? [] : [app.getAppPath(), "--"];
  if (testProbe) args.push("--r17-probe=verify");
  return args;
}

async function runTestWorkerProbe(context, capture) {
  const helper = await import("../test/helpers/backup-worker-probe.cjs");
  if (context.testProbe === "worker-empty" || context.testProbe === "worker-retain") return helper.runColdWorkerProbe(context, capture);
  await app.whenReady();
  await helper.runWorkerProbe(context, capture);
}

async function removeEmptyWorkerProfile(workerProfile, testProbe) {
  try { await rmdir(workerProfile); }
  catch (error) {
    if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
    const record = { code: "worker-profile-retained", pid: process.pid, workerProfile, reason: "runtime profile is not empty" };
    process.stderr.write(`${JSON.stringify(record)}\n`);
    if (testProbe) {
      const root = process.env.POKEROGUE_R17_TEST_ROOT;
      if (root) await (await import("node:fs/promises")).writeFile(join(root, `worker-profile-retained-${process.pid}.json`), JSON.stringify(record));
    }
  }
}

async function ensureSafeBackupRoot(userData, backupRoot) {
  const sourceInfo = await lstat(userData);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error("Source profile must be a real directory before capture");
  try {
    const rootInfo = await lstat(backupRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("App-owned Backup root must be a real directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(backupRoot, { recursive: false });
    const createdInfo = await lstat(backupRoot);
    if (!createdInfo.isDirectory() || createdInfo.isSymbolicLink()) throw new Error("New Backup root is not a real directory");
  }
}

export async function runBackupWorker() {
  const context = globalThis[contextKey];
  if (!context || context.lockAcquired !== true || typeof context.sourceUserData !== "string" || !BACKUP_TOKEN_PATTERN.test(context.token)) {
    throw new Error("Backup worker bootstrap context is invalid");
  }
  let intent;
  let captureStarted = false;
  try {
    await assertParentExited(context.parentPid);
    await recoverStaleIntentLock({ userData: context.sourceUserData, startupConfirmed: true });
    intent = await readIntent({ userData: context.sourceUserData, expectedToken: context.token });
    if (intent.state !== "requested") throw new Error(`Worker requires a requested capture intent; found ${intent.state}`);
    intent = await transitionIntent({ userData: context.sourceUserData, expectedToken: context.token, expectedRevision: intent.revision, nextState: "capturing" });
    captureStarted = true;

    const paths = getCapturePaths(context.sourceUserData, intent);
    if (!isDirectChild(paths.backupRoot, paths.stageRoot)) throw new Error("Token-owned capture container escaped the app Backup root");
    await ensureSafeBackupRoot(context.sourceUserData, paths.backupRoot);
    await mkdir(paths.stageRoot, { recursive: false });
    try { await lstat(paths.finalBackupPath); throw new Error("Token-owned final Backup path already exists"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }

    const generatedPath = await createBackup(context.sourceUserData, paths.stageRoot);
    if (!isDirectChild(paths.stageRoot, generatedPath)) throw new Error("Backup publisher returned a path outside the private token container");
    await validateBackup(generatedPath);
    await rename(generatedPath, paths.finalBackupPath);
    await rmdir(paths.stageRoot);
    intent = await transitionIntent({
      userData: context.sourceUserData,
      expectedToken: context.token,
      expectedRevision: intent.revision,
      nextState: "captured",
      capturedBackupPath: paths.finalBackupPath,
    });
    const capture = { backupPath: paths.finalBackupPath, manifest: await validateBackup(paths.finalBackupPath), intent };

    if (context.testProbe) await runTestWorkerProbe(context, capture);
    if (context.testProbe !== "worker") await removeEmptyWorkerProfile(context.workerProfile, context.testProbe);
    app.relaunch({ args: normalRelaunchArgs(context.testProbe) });
    app.quit();
    return capture;
  } catch (error) {
    if (intent && captureStarted && intent.state === "capturing") {
      await transitionIntent({
        userData: context.sourceUserData,
        expectedToken: context.token,
        expectedRevision: intent.revision,
        nextState: "failed",
        failure: { code: "capture-failed", message: String(error.message ?? error).slice(0, 1024) },
      }).catch(transitionError => process.stderr.write(`${JSON.stringify({ code: "failure-record-failed", pid: process.pid, error: transitionError.stack ?? String(transitionError) })}\n`));
      await cleanupCaptureStage({ userData: context.sourceUserData, expectedToken: context.token }).catch(cleanupError => process.stderr.write(`${JSON.stringify({ code: "capture-cleanup-failed", pid: process.pid, error: cleanupError.stack ?? String(cleanupError) })}\n`));
    } else if (intent && !captureStarted && intent.state === "requested") {
      await transitionIntent({
        userData: context.sourceUserData,
        expectedToken: context.token,
        expectedRevision: intent.revision,
        nextState: "failed",
        failure: { code: "capture-failed", message: String(error.message ?? error).slice(0, 1024) },
      }).catch(() => {});
    }
    throw error;
  }
}
