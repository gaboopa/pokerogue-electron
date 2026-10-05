import { app, dialog } from "electron";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { PRODUCT_NAME } from "./constants.mjs";

const require = createRequire(import.meta.url);
const tokenPattern = /^[a-f0-9]{64}$/;
const args = process.argv.slice(1);
let failureReported = false;

function reportFailure(error, code = "bootstrap-failed") {
  if (failureReported) return;
  failureReported = true;
  const record = { code, pid: process.pid, argv: process.argv, error: error?.stack ?? String(error) };
  process.stderr.write(`${JSON.stringify(record)}\n`);
  const root = process.env.POKEROGUE_R17_TEST_ROOT;
  const testRun = root && process.env.POKEROGUE_R17_TEST_SOURCE && !app.isPackaged;
  if (root && !app.isPackaged) {
    try {
      require("node:fs").writeFileSync(join(root, `bootstrap-failure-${process.pid}.json`), JSON.stringify(record));
    } catch {}
  }
  dialog.showErrorBox(`${PRODUCT_NAME} could not start`, String(error?.message ?? error));
  app.exit(1);
}

process.on("uncaughtException", error => reportFailure(error, "bootstrap-uncaught"));
process.on("unhandledRejection", error => reportFailure(error, "bootstrap-rejection"));

if (process.env.POKEROGUE_R17_TEST_ROOT && process.env.POKEROGUE_R17_TEST_SOURCE && !app.isPackaged) {
  dialog.showErrorBox = (title, message) => {
    try { require("node:fs").writeFileSync(join(process.env.POKEROGUE_R17_TEST_ROOT, `failure-dialog-${process.pid}.json`), JSON.stringify({ title, message, intercepted: true })); }
    catch (error) { process.stderr.write(`Could not record intercepted dialog: ${error.message}\n`); }
  };
}

function parseArguments() {
  const appArgs = [...args];
  if (!app.isPackaged) {
    const appPath = app.getAppPath();
    if (!appArgs[0] || resolve(appArgs[0]) !== resolve(appPath)) throw new Error("Development launch is missing its exact application entry path");
    appArgs.shift();
    if (appArgs[0] === "--") appArgs.shift();
  }

  const values = new Map();
  for (const argument of appArgs) {
    const match = /^(--[a-z0-9-]+)(?:=(.*))?$/.exec(argument);
    if (!match || values.has(match[1])) throw new Error(`Unsupported or duplicate application argument: ${argument}`);
    values.set(match[1], match[2] ?? true);
  }

  const worker = values.has("--backup-worker");
  const token = values.get("--backup-token");
  const parentPidText = values.get("--backup-parent-pid");
  const probe = values.get("--r17-probe");
  const allowed = worker
    ? ["--backup-worker", "--backup-token", "--backup-parent-pid", ...(probe ? ["--r17-probe"] : [])]
    : ["--updated", ...(probe ? ["--r17-probe"] : [])];
  for (const key of values.keys()) if (!allowed.includes(key)) throw new Error(`Argument ${key} is not valid for this startup mode`);
  if (values.has("--updated") && values.get("--updated") !== true) throw new Error("Installer notification --updated must be a bare flag");
  if (worker) {
    if (token === true || typeof token !== "string" || !tokenPattern.test(token)) throw new Error("Worker requires one lowercase 64-hex Backup token");
    if (parentPidText === true || typeof parentPidText !== "string" || !/^[1-9]\d{0,9}$/.test(parentPidText)) throw new Error("Worker requires one positive source-process PID");
    const parentPid = Number(parentPidText);
    if (!Number.isSafeInteger(parentPid)) throw new Error("Worker source-process PID is outside the supported range");
    if (probe !== undefined && (!new Set(["worker", "worker-empty", "worker-retain"]).has(probe) || app.isPackaged || !process.env.POKEROGUE_R17_TEST_ROOT)) throw new Error("R17 worker probe arguments are development-test-only");
    return { mode: "worker", token, parentPid, probe };
  }
  if (token !== undefined || parentPidText !== undefined) throw new Error("Worker token and parent PID require --backup-worker");
  if (probe !== undefined && (!new Set(["parent", "verify", "invalid", "sync-main"]).has(probe) || app.isPackaged || !process.env.POKEROGUE_R17_TEST_ROOT)) {
    throw new Error("R17 probe arguments are development-test-only or invalid");
  }
  return { mode: probe ? "probe" : "normal", probe };
}

function setProfilePaths(userData, sessionData) {
  app.setPath("userData", userData);
  app.setPath("sessionData", sessionData);
}

function start() {
  app.setName(PRODUCT_NAME);
  const mode = parseArguments();
  const testSource = process.env.POKEROGUE_R17_TEST_SOURCE;
  if (testSource && (!mode.probe || app.isPackaged)) throw new Error("Disposable R17 source profile is only valid in a development probe launch");
  const sourceUserData = resolve(testSource || app.getPath("userData"));
  const sourceSessionData = testSource ? sourceUserData : resolve(app.getPath("sessionData"));
  setProfilePaths(sourceUserData, sourceSessionData);

  const lockAcquired = app.requestSingleInstanceLock({ mode: mode.mode, token: mode.token ?? null });
  if (!lockAcquired) throw new Error("Another process already owns the source profile; startup refused before opening a session");

  if (mode.mode === "worker") {
    const workerProfile = join(sourceUserData, `.backup-worker-${mode.token}`);
    if (mode.probe) {
      const root = process.env.POKEROGUE_R17_TEST_ROOT;
      require("node:fs").writeFileSync(join(root, `worker-started-${process.pid}.json`), JSON.stringify({
        pid: process.pid,
        argv: process.argv,
        appPath: app.getAppPath(),
        execPath: process.execPath,
        electron: process.versions.electron,
        node: process.versions.node,
        lockAcquired,
        userData: workerProfile,
        sessionData: workerProfile,
        sourceUserData,
      }));
    }
    require("node:fs").mkdirSync(workerProfile, { recursive: false });
    setProfilePaths(workerProfile, workerProfile);
    globalThis[Symbol.for("pokerogue.backup-worker-context")] = Object.freeze({
      sourceUserData,
      sourceSessionData,
      workerProfile,
      token: mode.token,
      parentPid: mode.parentPid,
      lockAcquired,
      testProbe: mode.probe,
    });
    void import("./backup-worker.mjs").then(module => module.runBackupWorker()).catch(error => reportFailure(error, "worker-failed"));
    return;
  }

  if (mode.mode === "probe") {
    if (mode.probe === "invalid") throw new Error("Intentional invalid-argument probe should be rejected before application startup");
    if (mode.probe === "sync-main") {
      app.once("ready", () => {
        process.stderr.write(`${JSON.stringify({ code: "sync-main-required-before-ready", pid: process.pid, electron: process.versions.electron, node: process.versions.node })}\n`);
        app.exit(0);
      });
      require("./main.mjs");
      return;
    }
    const root = process.env.POKEROGUE_R17_TEST_ROOT;
    require("node:fs").writeFileSync(join(root, `probe-started-${process.pid}.json`), JSON.stringify({ pid: process.pid, argv: process.argv, probe: mode.probe, lockAcquired }));
    globalThis[Symbol.for("pokerogue.backup-worker-context")] = Object.freeze({ sourceUserData, sourceSessionData, lockAcquired, probe: mode.probe });
    require("../test/helpers/backup-worker-probe.cjs").runProbe(mode.probe);
    return;
  }

  // require(ESM) is synchronous for a graph without top-level await. This preserves
  // main.mjs's module-scope protocol registration before Electron emits ready.
  require("./main.mjs");
}

try { start(); }
catch (error) { reportFailure(error); }
