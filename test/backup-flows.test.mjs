import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearTerminalIntent,
  createIntent,
  getCapturePaths,
  prepareResumeIntent,
  readCurrentIntent,
  revalidateResumingUpdate,
  transitionIntent,
} from "../src/backup-coordinator.mjs";
import { createBackup } from "../src/backup.mjs";

async function withProfile(run) {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-backup-flow-"));
  const userData = join(root, "profile");
  await mkdir(userData, { recursive: true });
  try { await run({ root, userData }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

async function publishCapture(userData, token) {
  const paths = getCapturePaths(userData, token);
  await mkdir(paths.stageRoot, { recursive: true });
  await mkdir(join(userData, "Local Storage"), { recursive: true });
  await writeFile(join(userData, "Local Storage", "save.json"), "normalized save payload");
  const generated = await createBackup(userData, paths.stageRoot);
  await rename(generated, paths.finalBackupPath);
  await rm(paths.stageRoot, { recursive: true, force: true });
  const capturing = await transitionIntent({ userData, expectedToken: token, expectedRevision: 0, nextState: "capturing" });
  return transitionIntent({ userData, expectedToken: token, expectedRevision: capturing.revision, nextState: "captured", capturedBackupPath: paths.finalBackupPath });
}

function updatePayload(bytes) {
  return {
    platform: "windows",
    arch: "x64",
    manifest: {
      schemaVersion: 1,
      version: "1.2.3",
      sourceRevisions: { game: "g", assets: "a", locales: "l" },
      artifacts: [{
        platform: "windows", arch: "x64", fileName: "PokeRogue-Offline-1.2.3-windows-x64.exe",
        size: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex"),
        downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v1.2.3/setup.exe",
      }],
    },
  };
}

test("manual capture resumes once with normalized save data retained and acknowledges only at startup", async () => {
  await withProfile(async ({ userData }) => {
    const requested = await createIntent({ userData, operation: "manual", payload: {} });
    const captured = await publishCapture(userData, requested.token);
    const resumed = await prepareResumeIntent({ userData, expectedToken: captured.token, expectedRevision: captured.revision });
    assert.equal(resumed.intent.state, "resuming");
    assert.equal(resumed.continuation.backupPath, captured.capturedBackupPath);
    const completed = await transitionIntent({ userData, expectedToken: captured.token, expectedRevision: resumed.intent.revision, nextState: "completed" });
    await assert.rejects(prepareResumeIntent({ userData, expectedToken: completed.token, expectedRevision: completed.revision }), /completed|terminal|state/i);
    await clearTerminalIntent({ userData, expectedToken: completed.token, startupConfirmed: true });
    assert.equal(await readCurrentIntent({ userData }), null);
    assert.equal(await import("node:fs/promises").then(fs => fs.readFile(join(captured.capturedBackupPath, "data", "Local Storage", "save.json"), "utf8")), "normalized save payload");
  });
});

test("cancelled manual choice creates no intent and repeated requests hit the shared pending guard", async () => {
  await withProfile(async ({ userData }) => {
    const cancelled = { response: 1 };
    assert.equal(cancelled.response, 1);
    assert.equal(await readCurrentIntent({ userData }), null);
    const first = await createIntent({ userData, operation: "manual", payload: {} });
    await assert.rejects(createIntent({ userData, operation: "manual", payload: {} }), /pending|busy|active/i);
    await transitionIntent({ userData, expectedToken: first.token, expectedRevision: first.revision, nextState: "failed", failure: { code: "quit-vetoed", message: "Shutdown was cancelled; no live Backup was attempted." } });
  });
});

test("Update continuation resolves only to the revalidated app-owned installer", async () => {
  await withProfile(async ({ userData }) => {
    const bytes = "verified installer bytes";
    const payload = updatePayload(bytes);
    const updateRoot = join(userData, "Updates");
    await mkdir(updateRoot);
    await writeFile(join(updateRoot, "setup.exe"), bytes);
    const requested = await createIntent({ userData, operation: "update", payload });
    const captured = await publishCapture(userData, requested.token);
    const resumed = await prepareResumeIntent({ userData, expectedToken: captured.token, expectedRevision: captured.revision });
    const verified = await revalidateResumingUpdate({ userData, expectedToken: captured.token, expectedRevision: resumed.intent.revision });
    assert.equal(verified.installerPath, join(updateRoot, "setup.exe"));
    const completed = await transitionIntent({ userData, expectedToken: captured.token, expectedRevision: resumed.intent.revision, nextState: "completed" });
    await clearTerminalIntent({ userData, expectedToken: completed.token, startupConfirmed: true });
  });
});

test("missing, tampered, stale, and arbitrary Update installer paths fail closed", async () => {
  await withProfile(async ({ userData }) => {
    const bytes = "verified installer bytes";
    const payload = updatePayload(bytes);
    const updateRoot = join(userData, "Updates");
    await mkdir(updateRoot);
    await writeFile(join(updateRoot, "setup.exe"), bytes);
    const requested = await createIntent({ userData, operation: "update", payload });
    const captured = await publishCapture(userData, requested.token);
    const resumed = await prepareResumeIntent({ userData, expectedToken: captured.token, expectedRevision: captured.revision });
    await writeFile(join(updateRoot, "setup.exe"), "changed bytes");
    await assert.rejects(revalidateResumingUpdate({ userData, expectedToken: captured.token, expectedRevision: resumed.intent.revision }), /size|hash/i);
    await assert.rejects(revalidateResumingUpdate({ userData, expectedToken: "a".repeat(64), expectedRevision: resumed.intent.revision }), /mismatch|stale|token/i);
    await assert.rejects(prepareResumeIntent({ userData, expectedToken: captured.token, expectedRevision: captured.revision + 1 }), /revision|state|resuming/i);
    await rm(join(updateRoot, "setup.exe"));
    await assert.rejects(revalidateResumingUpdate({ userData, expectedToken: captured.token, expectedRevision: resumed.intent.revision }), /unavailable/i);
  });
});
