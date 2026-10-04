import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const probe = join(repositoryRoot, "test/helpers/storage-probe.cjs");
const repeatCount = 8;
const timeoutMs = 120000;

function runProbe(profileRoot, resultPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(electron, [probe, profileRoot, resultPath, String(repeatCount)], {
      cwd: repositoryRoot,
      windowsHide: true,
      env: {
        ...process.env,
        POKEROGUE_STORAGE_PROBE_ROOT: profileRoot,
        POKEROGUE_STORAGE_PROBE_RESULT: resultPath,
        POKEROGUE_STORAGE_PROBE_REPEATS: String(repeatCount),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`Electron storage probe exceeded ${timeoutMs} ms: ${stderr}`));
    }, timeoutMs);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error && child.exitCode === null && child.signalCode === null) child.kill();
      if (error) reject(error);
      else resolvePromise();
    };
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.once("error", error => finish(new Error(`Could not launch Electron storage probe: ${error.message}`)));
    child.once("exit", (code, signal) => {
      child.stdout.destroy();
      child.stderr.destroy();
      if (code !== 0) finish(new Error(`Electron storage probe exited ${code ?? signal}: ${stderr}${stdout}`));
      else finish();
    });
  });
}

test("flushStorageData then copy restores a staged live Chromium storage profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-backup-snapshot-"));
  const profileRoot = join(root, "profiles");
  const resultPath = join(root, "result.json");
  try {
    await runProbe(profileRoot, resultPath);
    const resultJson = await readFile(resultPath, "utf8").catch(async error => {
      const argv = await readFile(`${resultPath}.started`, "utf8").catch(() => "no Electron bootstrap marker");
      throw new Error(`Electron exited without a probe result: ${error.message}; bootstrap=${argv}`);
    });
    const result = JSON.parse(resultJson);
    assert.match(result.electronVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(result.platform, process.platform);
    assert.equal(result.rounds.length, repeatCount);
    for (const round of result.rounds) {
      assert.equal(round.backupSchemaVersion, 2);
      assert.deepEqual(round.included, ["IndexedDB", "Local Storage", "Session Storage"]);
      assert.equal(round.restoredSystemGeneration, 2, `iteration ${round.iteration}: system key captured after its write`);
      assert.equal(round.restoredSessionGeneration, 1, `iteration ${round.iteration}: session key stayed at the pre-write value`);
      assert.equal(round.databaseReopened, true, `iteration ${round.iteration}: IndexedDB reopened`);
      assert.equal(round.upstreamSystemInvariant, true, `iteration ${round.iteration}: starter and Pokédex data remain internally consistent`);
      assert.equal(round.restoredIndexedDbGeneration, 1, `iteration ${round.iteration}: synthetic IndexedDB record stayed at its pre-write value`);
      assert.equal(round.restoredIndexedDbJournalGeneration, 1, `iteration ${round.iteration}: synthetic IndexedDB stores are internally consistent`);
      assert.equal(round.sourceIndexedDbGeneration, 1, `iteration ${round.iteration}: source IndexedDB record was generation 1 at capture`);
      assert.equal(round.sourceIndexedDbJournalGeneration, 1, `iteration ${round.iteration}: source IndexedDB stores agreed at capture`);
      assert.equal(round.restoredMatchesSource, true, `iteration ${round.iteration}: restored bytes represent the staged source state`);
      assert.equal(round.capturedBetweenSaveAllKeys, true, `iteration ${round.iteration}: copy observed the controlled multi-key boundary`);
      assert.equal(round.upstreamSessionShape, true, `iteration ${round.iteration}: the restored session record retains required fields`);
      assert.equal(round.levelDbCurrentFileObserved, true, `iteration ${round.iteration}: copied Local Storage has its LevelDB CURRENT file`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
