import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { release as osRelease, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import electron from "electron";
import { createIntent } from "../src/backup-coordinator.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const execFileAsync = promisify(execFile);
const childTimeoutMs = 60_000;
const waitTimeoutMs = 50_000;

function startServer() {
  const page = `<!doctype html><meta charset="utf-8"><script>
(async () => {
  const params = new URL(location.href).searchParams;
  const mode = params.get("mode");
  const round = params.get("round");
  const dbName = "r17-worker-proof";
  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const writeRecord = (db, record) => new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
  });
  if (mode === "seed") {
    localStorage.setItem("r17-save", JSON.stringify({ round, value: "source-local-" + round }));
    sessionStorage.setItem("r17-context", "context-" + round);
    const db = await open();
    await writeRecord(db, { id: "save", round, value: "source-indexed-" + round });
    db.close();
  } else if (mode === "worker") {
    localStorage.setItem("r17-worker-only", "worker-local-" + round);
    const db = await open();
    await writeRecord(db, { id: "worker", round, value: "worker-indexed-" + round });
    db.close();
  } else if (mode === "read") {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("records", "readonly");
      const save = tx.objectStore("records").get("save");
      const worker = tx.objectStore("records").get("worker");
      tx.oncomplete = () => {
        window.probeResult = {
          local: JSON.parse(localStorage.getItem("r17-save")),
          workerLocal: localStorage.getItem("r17-worker-only"),
          save: save.result,
          worker: worker.result ?? null,
          sessionStorageObserved: sessionStorage.getItem("r17-context"),
        };
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB read aborted"));
    });
    db.close();
  }
  window.probeReady = true;
})().catch(error => { window.probeError = error.stack ?? String(error); });
</script>`;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(page);
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

function launchElectron(args, { root, source, origin, round = "1", workerMode = "worker" }) {
  const child = spawn(electron, [repositoryRoot, "--", ...args], {
    cwd: repositoryRoot,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      POKEROGUE_R17_TEST_ROOT: root,
      POKEROGUE_R17_TEST_SOURCE: source,
      POKEROGUE_R17_TEST_ORIGIN: origin,
      POKEROGUE_R17_ROUND: round,
      POKEROGUE_R17_WORKER_MODE: workerMode,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const done = new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Electron child exceeded ${childTimeoutMs} ms; argv=${JSON.stringify(child.spawnargs)}; stderr=${stderr}; stdout=${stdout}`));
    }, childTimeoutMs);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr, pid: child.pid, argv: child.spawnargs });
    });
  });
  return { child, done, pid: child.pid, stdout: () => stdout, stderr: () => stderr, argv: child.spawnargs };
}

async function waitJson(file, timeoutMs = waitTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  const names = await readdir(dirname(file)).catch(() => []);
  throw new Error(`Timed out waiting for ${file}; siblings=${names.join(", ")}`);
}

async function waitNamedJson(directory, pattern, timeoutMs = waitTimeoutMs, predicate = () => true) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const name of await readdir(directory).catch(() => [])) {
      if (!pattern.test(name)) continue;
      try {
        const value = JSON.parse(await readFile(join(directory, name), "utf8"));
        if (predicate(value)) return value;
      }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Timed out waiting for ${pattern} in ${directory}`);
}

async function waitForPidExit(pid, timeoutMs = waitTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") return; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Electron PID ${pid} did not exit within ${timeoutMs} ms`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5_000 }).catch(error => {
      if (error.code !== "ESRCH" && error.code !== 128) throw error;
    });
  } else child.kill("SIGTERM");
  await Promise.race([new Promise(resolvePromise => child.once("close", resolvePromise)), new Promise(resolvePromise => setTimeout(resolvePromise, 6_000))]);
}

async function getCommandLine(pid) {
  if (process.platform === "win32") {
    try {
      const result = await execFileAsync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}').CommandLine`,
      ], { windowsHide: true, timeout: 5_000 });
      return result.stdout;
    } catch (error) { if (error.code === "ESRCH") return ""; throw error; }
  }
  if (process.platform === "linux") {
    try { return (await readFile(`/proc/${Number(pid)}/cmdline`, "utf8")).replaceAll("\0", " "); }
    catch (error) { if (error.code === "ENOENT") return ""; throw error; }
  }
  try {
    return (await execFileAsync("ps", ["-o", "command=", "-p", String(Number(pid))], { timeout: 5_000 })).stdout;
  } catch (error) { if (error.code === "ESRCH") return ""; throw error; }
}

async function stopRelaunchedProcess(pid, { mode, token }) {
  if (!pid) return;
  const commandLine = await getCommandLine(pid);
  if (!commandLine.includes(`--r17-probe=${mode}`)) return;
  if (mode.startsWith("worker") && !commandLine.includes(`--backup-token=${token}`)) return;
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5_000 }).catch(error => {
      if (error.code !== "ESRCH" && error.code !== 128) throw error;
    });
    return;
  }
  try { process.kill(pid, "SIGTERM"); }
  catch (error) { if (error.code === "ESRCH") return; throw error; }
  try { await waitForPidExit(pid, 5_000); }
  catch {
    try { process.kill(pid, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    await waitForPidExit(pid, 5_000);
  }
}

async function sweepRelaunchMarkers(root, owned) {
  for (const name of await readdir(root).catch(() => [])) {
    if (/^worker-started-\d+\.json$/.test(name)) {
      try {
        const marker = JSON.parse(await readFile(join(root, name), "utf8"));
        const mode = marker.argv.find(argument => argument.startsWith("--r17-probe="))?.split("=")[1] ?? "worker";
        const token = marker.argv.find(argument => argument.startsWith("--backup-token="))?.split("=")[1];
        owned.set(marker.pid, { mode, token });
      } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    } else if (name === "verified.json") {
      try {
        const marker = JSON.parse(await readFile(join(root, name), "utf8"));
        owned.set(marker.pid, { mode: "verify" });
      } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    } else if (/^probe-started-\d+\.json$/.test(name)) {
      try {
        const marker = JSON.parse(await readFile(join(root, name), "utf8"));
        if (marker.probe === "verify") owned.set(marker.pid, { mode: "verify" });
      } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
  }
}

async function stopRelaunches(owned) {
  for (const [pid, identity] of owned) await stopRelaunchedProcess(pid, identity).catch(() => {});
}

async function runRound(parentRoot, origin, round, workerMode = "worker") {
  const root = join(parentRoot, `round-${round}`);
  const source = join(root, "source-profile");
  await (await import("node:fs/promises")).mkdir(root, { recursive: true });
  const children = new Set();
  const ownedRelaunches = new Map();
  let token;
  let relaunchArmed = false;
  try {
    const parent = launchElectron(["--r17-probe=parent"], { root, source, origin, round: String(round), workerMode });
    children.add(parent.child);
    const parentReady = await waitJson(join(root, "parent-ready.json"));
    token = parentReady.token;
    assert.equal(parentReady.lockAcquired, true);
    assert.equal(parentReady.userData, source);
    assert.equal(parentReady.sessionData, source);
    assert.ok(parentReady.defaultSessionPath.startsWith(source));

    const normalCompetitor = launchElectron(["--r17-probe=verify"], { root, source, origin, round: String(round) });
    children.add(normalCompetitor.child);
    const normalRefusal = await normalCompetitor.done;
    assert.notEqual(normalRefusal.code, 0);
    assert.match(normalRefusal.stderr, /already owns the source profile/);
    assert.equal((await waitJson(join(root, `failure-dialog-${normalCompetitor.pid}.json`))).intercepted, true);
    assert.equal(existsSync(join(root, "verified.json")), false, "refused normal launch must stop before its test continuation");

    await writeFile(join(root, "continue-parent"), "go");
    relaunchArmed = true;
    const parentExit = await parent.done;
    assert.equal(parentExit.code, 0, `source app failed: ${parentExit.stderr}`);
    const workerStarted = await waitNamedJson(root, /^worker-started-\d+\.json$/);
    const workerPid = workerStarted.pid;
    token = parentReady.token;
    const launchedWorkerMode = workerStarted.argv.find(argument => argument.startsWith("--r17-probe="))?.split("=")[1] ?? "worker";
    assert.equal(launchedWorkerMode, workerMode);
    ownedRelaunches.set(workerPid, { mode: launchedWorkerMode, token });
    assert.equal(workerStarted.lockAcquired, true);
    assert.equal(workerStarted.sourceUserData, source);
    assert.equal(workerStarted.userData, join(source, `.backup-worker-${token}`));
    assert.equal(workerStarted.sessionData, workerStarted.userData);
    assert.match(workerStarted.argv.join(" "), /--backup-worker/);
    assert.match(workerStarted.argv.join(" "), new RegExp(`--backup-token=${token}`));

    const workerReady = await waitJson(join(root, `worker-ready-${workerPid}.json`));
    assert.equal(workerReady.parentExited, true, "worker must observe source process exit before capture");
    assert.equal(workerReady.sourceLockAcquired, true);
    assert.deepEqual(workerReady.included, ["IndexedDB", "Local Storage", "Session Storage"]);
    if (workerMode === "worker") {
      assert.equal(workerReady.workerPaths.userData, workerStarted.userData);
      assert.equal(workerReady.workerPaths.sessionData, workerStarted.sessionData);
      assert.ok(workerReady.workerPaths.defaultSession.startsWith(workerStarted.userData));
      assert.deepEqual(workerReady.restoredLocalStorage, { round: String(round), value: `source-local-${round}` });
      assert.deepEqual(workerReady.restoredIndexedDb, { id: "save", round: String(round), value: `source-indexed-${round}` });
      assert.equal(workerReady.workerOnlyLocalStorage, null, "worker-only Local Storage must not be in the cold source copy");
      assert.equal(workerReady.workerOnlyIndexedDb, null, "worker-only IndexedDB must not be in the cold source copy");
    } else {
      assert.ok(["worker-empty", "worker-retain"].includes(workerMode));
      assert.equal(workerReady.outcome, "captured-without-session");
      assert.equal(workerReady.userData, workerStarted.userData);
      assert.equal(workerReady.sessionData, workerStarted.sessionData);
      if (workerMode === "worker-empty") assert.deepEqual(workerReady.runtimeEntries, []);
      if (workerMode === "worker-retain") assert.ok(workerReady.runtimeEntries.includes("r17-worker-retain.marker"));
    }
    assert.match(workerReady.versions.electron, /^42\.11\.10$/);
    assert.match(workerReady.versions.node, /^24\.19\.0$/);
    assert.equal(workerReady.platform, process.platform);
    assert.equal(workerReady.arch, process.arch);
    assert.equal(workerReady.osRelease, osRelease());
    assert.equal(workerReady.sessionStorageClaim, "observation only; copying Session Storage does not promise hydration in a new browsing context");

    const normalDuringWorker = launchElectron(["--r17-probe=verify"], { root, source, origin, round: String(round) });
    children.add(normalDuringWorker.child);
    const normalDuringWorkerResult = await normalDuringWorker.done;
    assert.notEqual(normalDuringWorkerResult.code, 0);
    assert.match(normalDuringWorkerResult.stderr, /already owns the source profile/);
    assert.equal((await waitJson(join(root, `failure-dialog-${normalDuringWorker.pid}.json`))).intercepted, true);

    const duplicateWorker = launchElectron([
      "--backup-worker", `--backup-token=${token}`, `--backup-parent-pid=${process.pid}`, "--r17-probe=worker",
    ], { root, source, origin, round: String(round) });
    children.add(duplicateWorker.child);
    const duplicateWorkerResult = await duplicateWorker.done;
    assert.notEqual(duplicateWorkerResult.code, 0);
    assert.match(duplicateWorkerResult.stderr, /already owns the source profile/);
    assert.equal((await waitJson(join(root, `failure-dialog-${duplicateWorker.pid}.json`))).intercepted, true);
    assert.equal((await readFile(join(source, "backup-intent.json"), "utf8")).includes('"state": "captured"'), true);

    await writeFile(join(root, "continue-worker"), "relaunch normal mode after capture");
    const verifyStarted = await waitNamedJson(root, /^probe-started-\d+\.json$/, waitTimeoutMs, marker => marker.probe === "verify");
    ownedRelaunches.set(verifyStarted.pid, { mode: "verify" });
    const verified = await waitJson(join(root, "verified.json"));
    assert.equal(verified.pid, verifyStarted.pid);
    assert.equal(verified.lockAcquired, true);
    assert.equal(verified.workerPid, workerPid);
    assert.equal(verified.workerExitedBeforeNormalStartup, true);
    assert.equal(verified.intentState, "captured");
    await waitForPidExit(workerPid);
    await waitForPidExit(verified.pid);
    if (workerMode === "worker-empty") {
      assert.equal(verified.workerProfileExistsAfterExit, workerReady.runtimeEntries.length > 0, "only an empty owned worker profile may be removed");
      if (workerReady.runtimeEntries.length > 0) assert.equal((await waitJson(join(root, `worker-profile-retained-${workerPid}.json`))).code, "worker-profile-retained");
    } else if (workerMode === "worker-retain") {
      assert.equal(verified.workerProfileExistsAfterExit, true, "nonempty worker profile must be retained without blocking relaunch");
      assert.equal(verified.retainedMarker, "test-owned nonempty worker profile");
      const retained = await waitJson(join(root, `worker-profile-retained-${workerPid}.json`));
      assert.equal(retained.code, "worker-profile-retained");
    }
    assert.equal(parentReady.token, workerReady.token);
    return { parentReady, workerStarted, workerReady, verified, parentExit };
  } catch (error) {
    for (const child of children) await stopChild(child).catch(() => {});
    throw error;
  } finally {
    for (const child of children) await stopChild(child).catch(() => {});
    if (relaunchArmed) {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        await sweepRelaunchMarkers(root, ownedRelaunches).catch(() => {});
        if ([...ownedRelaunches.values()].some(identity => identity.mode.startsWith("worker"))) break;
        await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
      }
    }
    await stopRelaunches(ownedRelaunches);
  }
}

test("R17 cold worker holds source ownership, captures after exit and relaunches normally", { timeout: 240_000 }, async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "pokerogue-r17-worker-"));
  const { server, origin } = await startServer();
  try {
    const first = await runRound(tempRoot, origin, 1, "worker");
    const second = await runRound(tempRoot, origin, 2, "worker-empty");
    const third = await runRound(tempRoot, origin, 3, "worker-retain");
    assert.equal(first.workerReady.outcome, "captured");
    assert.equal(second.workerReady.outcome, "captured-without-session");
    assert.equal(third.workerReady.outcome, "captured-without-session");
    process.stdout.write(`${JSON.stringify({
      rounds: 3,
      executable: electron,
      electron: first.workerReady.versions.electron,
      chromium: first.workerReady.versions.chromium,
      embeddedNode: first.workerReady.versions.node,
      platform: first.workerReady.platform,
      arch: first.workerReady.arch,
      osRelease: first.workerReady.osRelease,
      sourcePid: third.parentReady.pid,
      workerPid: third.workerReady.workerPid,
      sourceLockHeldBeforeAndDuringWorker: third.parentReady.lockAcquired && third.workerReady.sourceLockAcquired,
      parentExitedBeforeCapture: third.workerReady.parentExited,
      workerExitedBeforeNormalRelaunch: third.verified.workerExitedBeforeNormalStartup,
      helperProfile: first.workerReady.workerPaths,
      emptyWorkerProfileRemoved: !second.verified.workerProfileExistsAfterExit,
      nonemptyWorkerProfileRetainedAndReported: third.verified.workerProfileExistsAfterExit && third.verified.retainedMarker !== null,
      capture: third.workerReady.backupPath,
      intentState: third.verified.intentState,
    })}\n`);
  } catch (error) {
    const entries = await (await import("node:fs/promises")).readdir(tempRoot, { recursive: true, withFileTypes: true }).catch(() => []);
    const evidence = await Promise.all(entries.filter(entry => entry.isFile() && /^(?:bootstrap-failure|failure-dialog|probe-failure|worker-started|worker-ready|parent-ready|result|verified)/.test(entry.name)).map(async entry => {
      const file = join(entry.parentPath ?? tempRoot, entry.name);
      return `${file}: ${(await readFile(file, "utf8").catch(readError => readError.message)).slice(0, 4000)}`;
    }));
    throw new Error(`${error.message}\nNative probe evidence:\n${evidence.join("\n")}`, { cause: error });
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("R17 synchronously imports normal main before Electron readiness with disposable profiles", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-r17-sync-main-"));
  const source = join(root, "source-profile");
  const { server, origin } = await startServer();
  try {
    const main = launchElectron(["--r17-probe=sync-main"], { root, source, origin });
    const result = await main.done;
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /sync-main-required-before-ready/);
    assert.match(result.stderr, /"electron":"42\.11\.10"/);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
    await rm(root, { recursive: true, force: true });
  }
});

test("R17 rejects malformed worker arguments and stale tokens visibly before copy", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-r17-reject-"));
  const source = join(root, "source-profile");
  const { server, origin } = await startServer();
  const children = new Set();
  try {
    const malformed = launchElectron(["--backup-worker", "--backup-token=not-a-token", "--backup-parent-pid=1", "--r17-probe=worker"], { root, source, origin });
    children.add(malformed.child);
    const malformedResult = await malformed.done;
    assert.notEqual(malformedResult.code, 0);
    assert.match(malformedResult.stderr, /64-hex Backup token/);
    const malformedDialog = await waitJson(join(root, `failure-dialog-${malformed.pid}.json`));
    assert.equal(malformedDialog.intercepted, true);
    assert.equal(malformedDialog.title, "PokeRogue Offline could not start");
    assert.equal(existsSync(join(source, "Save Backups")), false);

    await (await import("node:fs/promises")).mkdir(source, { recursive: true });
    const intent = await createIntent({ userData: source, operation: "manual", payload: {} });
    const exited = spawn(process.execPath, ["-e", "process.exit(0)"], { windowsHide: true, stdio: "ignore" });
    const parentPid = exited.pid;
    await new Promise((resolvePromise, reject) => { exited.once("error", reject); exited.once("exit", resolvePromise); });
    const stale = launchElectron([
      "--backup-worker", `--backup-token=${randomBytes(32).toString("hex")}`,
      `--backup-parent-pid=${parentPid}`, "--r17-probe=worker",
    ], { root, source, origin });
    children.add(stale.child);
    const started = await waitJson(join(root, `worker-started-${stale.pid}.json`));
    assert.equal(started.lockAcquired, true);
    const staleResult = await stale.done;
    assert.notEqual(staleResult.code, 0);
    assert.match(staleResult.stderr, /token mismatch/);
    const staleDialog = await waitJson(join(root, `failure-dialog-${stale.pid}.json`));
    assert.equal(staleDialog.intercepted, true);
    assert.equal(staleDialog.title, "PokeRogue Offline could not start");
    assert.equal(existsSync(join(source, "Save Backups")), false, "stale token must be rejected before stage or Backup creation");
    assert.equal((await (await import("../src/backup-coordinator.mjs")).readIntent({ userData: source, expectedToken: intent.token })).state, "requested");
  } finally {
    for (const child of children) await stopChild(child).catch(() => {});
    await new Promise(resolvePromise => server.close(resolvePromise));
    await rm(root, { recursive: true, force: true });
  }
});
