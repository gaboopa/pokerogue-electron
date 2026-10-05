import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  cleanupCaptureStage,
  clearTerminalIntent,
  createIntent,
  getCapturePaths,
  parseBackupName,
  prepareResumeIntent,
  readIntent,
  recoverStaleIntentLock,
  transitionIntent,
} from "../src/backup-coordinator.mjs";
import { createBackup } from "../src/backup.mjs";
import { NEUTRAL_CHEATS, validateCheatConfig } from "../src/cheats.mjs";

async function withProfile(run) {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-backup-coordinator-"));
  const userData = join(root, "profile");
  await mkdir(userData, { recursive: true });
  try {
    return await run({ root, userData });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function makeBackup(userData, backupRoot) {
  await mkdir(join(userData, "Local Storage"), { recursive: true });
  await writeFile(join(userData, "Local Storage", "probe.txt"), "known-good save data");
  return createBackup(userData, backupRoot);
}

async function publishCapture(userData, intent) {
  const paths = getCapturePaths(userData, intent);
  await mkdir(paths.stageRoot, { recursive: true });
  const backupPath = await makeBackup(userData, paths.stageRoot);
  await rename(backupPath, paths.finalBackupPath);
  await rm(paths.stageRoot, { recursive: true, force: true });
  return paths.finalBackupPath;
}

function updatePayload(bytes, overrides = {}) {
  const fileName = "PokeRogue-Offline-1.2.3-windows-x64.exe";
  const artifact = {
    platform: "windows",
    arch: "x64",
    fileName,
    size: Buffer.byteLength(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v1.2.3/windows.exe",
    ...overrides,
  };
  return {
    platform: "windows",
    arch: "x64",
    manifest: {
      schemaVersion: 1,
      version: "1.2.3",
      sourceRevisions: { game: "game-revision", assets: "asset-revision", locales: "locale-revision" },
      artifacts: [artifact],
    },
  };
}

function waitForChildLine(child, expectedLine) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Child did not report ${expectedLine}; output: ${output}`)), 5000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.split(/\r?\n/).includes(expectedLine)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", code => {
      if (!output.split(/\r?\n/).includes(expectedLine)) {
        clearTimeout(timeout);
        reject(new Error(`Child exited ${code} before reporting ${expectedLine}; output: ${output}`));
      }
    });
  });
}

async function waitForChildClose(child, closed, timeoutMs = 1500) {
  let timeout;
  const outcome = await Promise.race([
    closed.then(result => ({ result }), error => ({ error })),
    new Promise(resolve => { timeout = setTimeout(() => resolve({ timeout: true }), timeoutMs); }),
  ]);
  clearTimeout(timeout);
  if (outcome.error) throw outcome.error;
  if (outcome.result) return outcome.result;

  const killSent = child.kill();
  let killTimeout;
  const afterKill = await Promise.race([
    closed.then(result => ({ result }), error => ({ error })),
    new Promise(resolve => { killTimeout = setTimeout(() => resolve({ timeout: true }), 1000); }),
  ]);
  clearTimeout(killTimeout);
  if (afterKill.error) throw afterKill.error;
  if (afterKill.timeout) throw new Error(`Lock-holder child PID ${child.pid} did not exit after bounded cleanup; kill sent: ${killSent}`);
  throw new Error(`Lock-holder child PID ${child.pid} exceeded its graceful-exit deadline and was killed; exit: ${JSON.stringify(afterKill.result)}`);
}

async function captureIntent(userData, intent) {
  const capturing = await transitionIntent({
    userData,
    expectedToken: intent.token,
    expectedRevision: intent.revision,
    nextState: "capturing",
  });
  const capturedBackupPath = await publishCapture(userData, intent);
  return transitionIntent({
    userData,
    expectedToken: intent.token,
    expectedRevision: capturing.revision,
    nextState: "captured",
    capturedBackupPath,
  });
}

test("creates a versioned cryptographic intent with only app-owned paths and a token-owned stage", async () => {
  await withProfile(async ({ userData }) => {
    const intent = await createIntent({ userData, operation: "manual", payload: {} });
    const paths = getCapturePaths(userData, intent);
    assert.equal(intent.version, 1);
    assert.match(intent.token, /^[a-f0-9]{64}$/);
    assert.equal(intent.sourceProfile, userData);
    assert.equal(intent.backupRoot, join(userData, "Save Backups"));
    assert.equal(intent.updateRoot, join(userData, "Updates"));
    assert.equal(paths.stageRoot, join(intent.backupRoot, `.capture-${intent.token}`));
    assert.equal(paths.finalBackupPath, join(intent.backupRoot, `backup-${intent.createdAt.replaceAll(":", "-")}-manual-${intent.token.slice(0, 8)}`));
    assert.equal(intent.state, "requested");
    assert.equal(intent.revision, 0);
    assert.deepEqual(await readIntent({ userData, expectedToken: intent.token }), intent);
    await assert.rejects(createIntent({ userData, operation: "manual", payload: {} }), /active|pending|busy/i);
  });
});

test("state changes use token and revision compare-and-swap and terminal requests cannot replay", async () => {
  await withProfile(async ({ userData }) => {
    const requested = await createIntent({ userData, operation: "manual", payload: {} });
    const captured = await captureIntent(userData, requested);
    await assert.rejects(transitionIntent({
      userData,
      expectedToken: requested.token,
      expectedRevision: requested.revision,
      nextState: "capturing",
    }), /stale|revision/i);

    const resuming = await prepareResumeIntent({ userData, expectedToken: captured.token, expectedRevision: captured.revision });
    assert.equal(resuming.intent.state, "resuming");
    assert.equal(resuming.continuation.backupPath, captured.capturedBackupPath);
    const completed = await transitionIntent({
      userData,
      expectedToken: resuming.intent.token,
      expectedRevision: resuming.intent.revision,
      nextState: "completed",
    });
    assert.equal(completed.state, "completed");
    await assert.rejects(prepareResumeIntent({ userData, expectedToken: completed.token, expectedRevision: completed.revision }), /terminal|completed|state/i);
    await assert.rejects(transitionIntent({
      userData,
      expectedToken: completed.token,
      expectedRevision: completed.revision,
      nextState: "capturing",
    }), /terminal|transition|state/i);
    await assert.rejects(clearTerminalIntent({ userData, expectedToken: completed.token }), /startup/i);
    await clearTerminalIntent({ userData, expectedToken: completed.token, startupConfirmed: true });
    await assert.rejects(readIntent({ userData, expectedToken: completed.token }), /missing|not found|ENOENT/i);
  });
});

test("corrupt published Backup blocks resume but terminal failure and private-stage cleanup still work", async () => {
  await withProfile(async ({ userData }) => {
    const requested = await createIntent({ userData, operation: "manual", payload: {} });
    const captured = await captureIntent(userData, requested);
    const paths = getCapturePaths(userData, captured);
    const savedData = join(captured.capturedBackupPath, "data", "Local Storage", "probe.txt");
    await writeFile(savedData, "corrupted after publication");
    await mkdir(paths.stageRoot, { recursive: true });
    await writeFile(join(paths.stageRoot, "private-partial"), "owned by this token");

    await assert.rejects(prepareResumeIntent({ userData, expectedToken: captured.token, expectedRevision: captured.revision }), /checksum|integrity/i);
    const failed = await transitionIntent({
      userData,
      expectedToken: captured.token,
      expectedRevision: captured.revision,
      nextState: "failed",
      failure: { code: "backup-invalid", message: "Published Backup failed resume validation." },
    });
    assert.equal(await cleanupCaptureStage({ userData, expectedToken: failed.token }), true);
    await assert.rejects(readFile(join(paths.stageRoot, "private-partial")), { code: "ENOENT" });
    await clearTerminalIntent({ userData, expectedToken: failed.token, startupConfirmed: true });
    assert.equal(await readFile(savedData, "utf8"), "corrupted after publication");
  });
});

test("a vetoed cancelled intent keeps new requests busy until startup acknowledges it", async () => {
  await withProfile(async ({ userData }) => {
    const cancelled = await createIntent({ userData, operation: "manual", payload: {} });
    const state = await transitionIntent({
      userData,
      expectedToken: cancelled.token,
      expectedRevision: cancelled.revision,
      nextState: "cancelled",
    });
    await assert.rejects(createIntent({ userData, operation: "manual", payload: {} }), /active|pending|busy|startup/i);

    await clearTerminalIntent({ userData, expectedToken: state.token, startupConfirmed: true });
    const next = await createIntent({ userData, operation: "manual", payload: {} });
    const nextStage = getCapturePaths(userData, next).stageRoot;
    const oldStage = getCapturePaths(userData, state).stageRoot;
    await mkdir(nextStage, { recursive: true });
    await writeFile(join(nextStage, "keep.txt"), "new intent owns this");
    await mkdir(oldStage, { recursive: true });
    await writeFile(join(oldStage, "old.txt"), "old stage");

    await assert.rejects(readIntent({ userData, expectedToken: state.token }), /token|mismatch/i);
    await assert.rejects(transitionIntent({
      userData,
      expectedToken: state.token,
      expectedRevision: state.revision,
      nextState: "capturing",
    }), /token|mismatch/i);
    await assert.rejects(cleanupCaptureStage({ userData, expectedToken: state.token }), /token|mismatch/i);
    assert.equal(await readFile(join(nextStage, "keep.txt"), "utf8"), "new intent owns this");
  });
});

test("an old in-flight Update resume cannot replace a newer intent after terminal acknowledgement", async () => {
  await withProfile(async ({ userData }) => {
    const bytes = Buffer.alloc(128 * 1024 * 1024, 0x5a);
    const old = await createIntent({ userData, operation: "update", payload: updatePayload(bytes) });
    const paths = getCapturePaths(userData, old);
    await mkdir(paths.updateRoot, { recursive: true });
    await writeFile(join(paths.updateRoot, "windows.exe"), bytes);
    const captured = await captureIntent(userData, old);
    const oldResume = prepareResumeIntent({ userData, expectedToken: old.token, expectedRevision: captured.revision })
      .then(value => ({ fulfilled: true, value }), error => ({ fulfilled: false, error }));

    await new Promise(resolve => setTimeout(resolve, 20));
    const failed = await transitionIntent({
      userData,
      expectedToken: old.token,
      expectedRevision: captured.revision,
      nextState: "failed",
      failure: { code: "cancelled", message: "The old continuation was invalidated." },
    });
    await clearTerminalIntent({ userData, expectedToken: failed.token, startupConfirmed: true });
    const fresh = await createIntent({ userData, operation: "manual", payload: {} });
    const resumeOutcome = await oldResume;
    assert.equal(resumeOutcome.fulfilled, false, "in-flight stale resume must be rejected");
    assert.match(resumeOutcome.error.message, /token|stale|intent|journal/i);
    assert.deepEqual(await readIntent({ userData, expectedToken: fresh.token }), fresh);
  });
});

test("cross-process lock contention fails closed and fresh startup only recovers a proven-dead owner", async () => {
  await withProfile(async ({ userData }) => {
    const intent = await createIntent({ userData, operation: "manual", payload: {} });
    const lockPath = join(userData, ".backup-intent.lock");
    await writeFile(join(userData, `.backup-intent-lock-${"b".repeat(64)}.tmp`), "incomplete owner metadata before atomic publication");
    assert.equal(await recoverStaleIntentLock({ userData, startupConfirmed: true }), false);
    assert.deepEqual(await readIntent({ userData, expectedToken: intent.token }), intent);
    const holderScript = `
      import { open } from 'node:fs/promises';
      const path = process.env.R16_TEST_LOCK_PATH;
      const handle = await open(path, 'wx');
      await handle.writeFile(JSON.stringify({ version: 1, pid: process.pid, token: 'a'.repeat(64), createdAt: new Date().toISOString() }));
      await handle.sync();
      await handle.close();
      console.log('lock-held');
      await new Promise(resolve => process.stdin.once('data', resolve));
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", holderScript], {
      env: { ...process.env, R16_TEST_LOCK_PATH: lockPath },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    try {
      await waitForChildLine(child, "lock-held");
      await assert.rejects(readIntent({ userData, expectedToken: intent.token }), /lock|busy|transaction/i);
      await assert.rejects(recoverStaleIntentLock({ userData, startupConfirmed: true }), /live|running|owner/i);
    } finally {
      child.stdin.end("exit");
      const result = await waitForChildClose(child, closed);
      assert.equal(result.code, 0, `lock holder failed: ${stderr}`);
    }

    await assert.rejects(recoverStaleIntentLock({ userData, startupConfirmed: false }), /startup/i);
    assert.equal(await recoverStaleIntentLock({ userData, startupConfirmed: true }), true);
    assert.deepEqual(await readIntent({ userData, expectedToken: intent.token }), intent);
  });
});

test("restore payloads accept external valid Backups and revalidate bytes only when resuming", async () => {
  await withProfile(async ({ root, userData }) => {
    const backupRoot = join(userData, "Save Backups");
    await mkdir(backupRoot, { recursive: true });
    const selectedBackup = await makeBackup(join(root, "source"), backupRoot);
    const valid = await createIntent({ userData, operation: "restore", payload: { selectedBackup } });
    const externalRoot = join(root, "exported-backups");
    await mkdir(externalRoot, { recursive: true });
    const exportedBackup = await makeBackup(join(root, "export-source"), externalRoot);
    const externalProfile = join(root, "external-profile");
    await mkdir(externalProfile, { recursive: true });
    const externalIntent = await createIntent({ userData: externalProfile, operation: "restore", payload: { selectedBackup: exportedBackup } });
    assert.equal(externalIntent.payload.selectedBackup, exportedBackup);

    const selectedData = join(selectedBackup, "data", "Local Storage", "probe.txt");
    await writeFile(selectedData, "tampered");
    const captured = await captureIntent(userData, valid);
    await assert.rejects(prepareResumeIntent({ userData, expectedToken: captured.token, expectedRevision: captured.revision }), /checksum|integrity/i);
    assert.equal((await readIntent({ userData, expectedToken: captured.token })).state, "captured");
    const failed = await transitionIntent({
      userData,
      expectedToken: captured.token,
      expectedRevision: captured.revision,
      nextState: "failed",
      failure: { code: "restore-unavailable", message: "Selected Backup failed revalidation." },
    });
    await clearTerminalIntent({ userData, expectedToken: failed.token, startupConfirmed: true });
  });
});

test("Update resume revalidates the owned basename, release descriptor, exact bytes, size, and hash", async () => {
  await withProfile(async ({ userData }) => {
    const bytes = Buffer.from("verified installer bytes");
    const payload = updatePayload(bytes);
    const artifact = payload.manifest.artifacts[0];
    const intent = await createIntent({ userData, operation: "update", payload });
    const paths = getCapturePaths(userData, intent);
    const installerPath = join(paths.updateRoot, "windows.exe");
    await mkdir(paths.updateRoot, { recursive: true });
    await writeFile(installerPath, bytes);
    const captured = await captureIntent(userData, intent);
    const resume = await prepareResumeIntent({ userData, expectedToken: captured.token, expectedRevision: captured.revision });
    assert.equal(resume.continuation.installerPath, installerPath);
    assert.equal(resume.continuation.artifact.sha256, artifact.sha256);

    const changed = Buffer.from("different installer bytes");
    const secondProfile = join(userData, "second-profile");
    await mkdir(secondProfile, { recursive: true });
    const secondIntent = await createIntent({ userData: secondProfile, operation: "update", payload: updatePayload(changed) });
    const secondPaths = getCapturePaths(secondProfile, secondIntent);
    await mkdir(secondPaths.updateRoot, { recursive: true });
    await writeFile(join(secondPaths.updateRoot, "windows.exe"), changed);
    const secondCaptured = await captureIntent(secondProfile, secondIntent);
    const secondInstaller = join(secondPaths.updateRoot, "windows.exe");
    await writeFile(secondInstaller, "tampered installer");
    await assert.rejects(prepareResumeIntent({ userData: secondProfile, expectedToken: secondCaptured.token, expectedRevision: secondCaptured.revision }), /size|hash|verification/i);
    await assert.rejects(createIntent({
      userData: join(userData, "third-profile"),
      operation: "update",
      payload: updatePayload(bytes, { downloadUrl: "http://example.invalid/outside.exe" }),
    }), /not allowed|https|Update URL/i);
    await assert.rejects(createIntent({
      userData: join(userData, "fourth-profile"),
      operation: "update",
      payload: updatePayload(bytes, { metadataAlias: "unexpected" }),
    }), /key|shape/i);
  });
});

test("cheat intents accept only the exact normalized configuration before persistence", async () => {
  await withProfile(async ({ root, userData }) => {
    const config = validateCheatConfig({ ...NEUTRAL_CHEATS, enabled: true, xpMultiplier: 3 });
    const intent = await createIntent({ userData, operation: "cheat", payload: { config } });
    assert.deepEqual((await readIntent({ userData, expectedToken: intent.token })).payload.config, config);

    const nextUserData = join(root, "rejected-profile");
    await mkdir(nextUserData, { recursive: true });
    await assert.rejects(createIntent({
      userData: nextUserData,
      operation: "cheat",
      payload: { config: { ...config, xpMultiplier: 101 } },
    }), /normalized|schema|configuration/i);
    await assert.rejects(readFile(join(nextUserData, "backup-intent.json"), "utf8"), { code: "ENOENT" });
  });
});

test("interrupted capture is never replayed and cleanup deletes only its derived token stage", async () => {
  await withProfile(async ({ root, userData }) => {
    const intent = await createIntent({ userData, operation: "manual", payload: {} });
    const capturing = await transitionIntent({
      userData,
      expectedToken: intent.token,
      expectedRevision: intent.revision,
      nextState: "capturing",
    });
    const paths = getCapturePaths(userData, intent);
    await mkdir(paths.stageRoot, { recursive: true });
    await writeFile(join(paths.stageRoot, "partial.txt"), "partial capture");
    const foreign = join(root, "foreign-stage");
    await mkdir(foreign, { recursive: true });
    await writeFile(join(foreign, "keep.txt"), "outside trusted root");

    await assert.rejects(cleanupCaptureStage({ userData, expectedToken: intent.token }), /interrupted|terminal|state/i);
    await assert.rejects(transitionIntent({
      userData,
      expectedToken: intent.token,
      expectedRevision: capturing.revision,
      nextState: "interrupted",
      ownerExited: false,
    }), /exit|stopped|owner/i);
    const interrupted = await transitionIntent({
      userData,
      expectedToken: intent.token,
      expectedRevision: capturing.revision,
      nextState: "interrupted",
      ownerExited: true,
    });
    await assert.rejects(prepareResumeIntent({ userData, expectedToken: intent.token, expectedRevision: interrupted.revision }), /interrupted|replay|state/i);
    await cleanupCaptureStage({ userData, expectedToken: intent.token });
    await assert.rejects(readFile(paths.stageRoot), { code: "ENOENT" });
    assert.equal(await readFile(join(foreign, "keep.txt"), "utf8"), "outside trusted root");
  });
});

test("unknown journal fields and mismatched app-owned roots fail closed", async () => {
  await withProfile(async ({ userData }) => {
    const intent = await createIntent({ userData, operation: "manual", payload: {} });
    const journalPath = join(userData, "backup-intent.json");
    const stored = JSON.parse(await readFile(journalPath, "utf8"));
    stored.captureStage = join(userData, "arbitrary-delete-me");
    await writeFile(journalPath, JSON.stringify(stored));
    await assert.rejects(readIntent({ userData, expectedToken: intent.token }), /key|shape|malformed/i);
    assert.throws(() => getCapturePaths(userData, { ...intent, token: "..\\outside" }), /token/i);

    const otherProfile = join(userData, "other");
    await mkdir(otherProfile, { recursive: true });
    await assert.rejects(createIntent({ userData: otherProfile, operation: "manual", payload: {}, ignored: true }), /key|shape/i);
    const mismatched = await createIntent({ userData: otherProfile, operation: "manual", payload: {} });
    const otherJournal = join(otherProfile, "backup-intent.json");
    const otherStored = JSON.parse(await readFile(otherJournal, "utf8"));
    otherStored.backupRoot = join(otherProfile, "outside");
    await writeFile(otherJournal, JSON.stringify(otherStored));
    await assert.rejects(readIntent({ userData: otherProfile, expectedToken: mismatched.token }), /Backup root|app-owned/i);
  });
});

test("public transition inputs reject unknown fields and malformed tokens", async () => {
  await withProfile(async ({ userData }) => {
    const intent = await createIntent({ userData, operation: "manual", payload: {} });
    await assert.rejects(readIntent({ userData, expectedToken: intent.token, stageRoot: join(userData, "arbitrary") }), /key|shape/i);
    await assert.rejects(transitionIntent({
      userData,
      expectedToken: intent.token,
      expectedRevision: intent.revision,
      nextState: "capturing",
      cleanupPath: join(userData, "arbitrary"),
    }), /key|shape/i);
    await assert.rejects(readIntent({ userData, expectedToken: "../bad" }), /token/i);
  });
});

test("published Backup names carry the request time, operation and short token and round-trip through the parser", async () => {
  await withProfile(async ({ userData }) => {
    const intent = await createIntent({ userData, operation: "manual", payload: {} });
    const { finalBackupPath, stageRoot } = getCapturePaths(userData, intent);
    const name = basename(finalBackupPath);
    assert.match(name, /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-manual-[a-f0-9]{8}$/);
    assert.deepEqual(parseBackupName(name), { stamp: intent.createdAt.replaceAll(":", "-"), operation: "manual", token8: intent.token.slice(0, 8) });
    for (const operation of ["update", "restore", "cheat"]) assert.equal(parseBackupName(basename(getCapturePaths(userData, { ...intent, operation }).finalBackupPath)).operation, operation);
    for (const other of ["backup-2026-10-05T16-19-07.123Z-1a2b3c4d-1111-4111-8111-111111111111", `backup-capture-${intent.token}`, basename(stageRoot), ".backup-2026-10-05T16-19-07.123Z-manual-1a2b3c4d", `${name}x`, "backup-2026-10-05T16-19-07.123Z-other-1a2b3c4d", 42]) {
      assert.equal(parseBackupName(other), null, String(other));
    }
    assert.throws(() => getCapturePaths(userData, { ...intent, createdAt: "2026-10-05" }), /creation time/i);
    assert.throws(() => getCapturePaths(userData, { ...intent, operation: "other" }), /operation/i);
  });
});

test("a journal or completion naming any directory other than the derived Backup path is rejected", async () => {
  await withProfile(async ({ userData }) => {
    const intent = await createIntent({ userData, operation: "manual", payload: {} });
    const capturing = await transitionIntent({ userData, expectedToken: intent.token, expectedRevision: 0, nextState: "capturing" });
    const derived = await publishCapture(userData, intent);
    const bad = [
      join(intent.backupRoot, `backup-capture-${intent.token}`),
      join(intent.backupRoot, basename(derived).replace("-manual-", "-update-")),
      join(intent.backupRoot, basename(derived).replace(intent.createdAt.replaceAll(":", "-"), "2000-01-01T00-00-00.000Z")),
      join(intent.backupRoot, basename(derived).replace(intent.token.slice(0, 8), "00000000")),
      join(userData, "elsewhere"),
    ];
    for (const path of bad) {
      await assert.rejects(transitionIntent({ userData, expectedToken: intent.token, expectedRevision: capturing.revision, nextState: "captured", capturedBackupPath: path }), /published Backup path/i, path);
    }
    const captured = await transitionIntent({ userData, expectedToken: intent.token, expectedRevision: capturing.revision, nextState: "captured", capturedBackupPath: derived });
    const journalPath = join(userData, "backup-intent.json");
    const stored = JSON.parse(await readFile(journalPath, "utf8"));
    for (const path of bad) {
      await writeFile(journalPath, JSON.stringify({ ...stored, capturedBackupPath: path }));
      await assert.rejects(readIntent({ userData, expectedToken: intent.token }), /publication path/i, path);
    }
    await writeFile(journalPath, JSON.stringify(stored));
    assert.equal((await readIntent({ userData, expectedToken: intent.token })).capturedBackupPath, captured.capturedBackupPath);
  });
});
