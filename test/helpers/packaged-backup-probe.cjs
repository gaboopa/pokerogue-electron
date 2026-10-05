const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

const timeoutMs = 45_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function requestJson(port, route) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: route }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (error) { reject(error); }
      });
    });
    request.setTimeout(5_000, () => request.destroy(new Error(`HTTP probe ${route} timed out`)));
    request.once("error", reject);
  });
}

async function waitForInspector(port, timeout = timeoutMs) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const [target] = await requestJson(port, "/json/list");
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch (error) { lastError = error; }
    await sleep(50);
  }
  throw new Error(`Packaged Electron inspector ${port} did not start: ${lastError?.message ?? "no target"}`);
}

class Debugger {
  constructor(socket) {
    this.socket = socket;
    this.closed = false;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
        }
      } else this.events.push(message);
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Debugger socket closed during command ${id}`));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Debugger WebSocket connect timed out")), 5_000);
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
      socket.addEventListener("open", () => clearTimeout(timer), { once: true });
      socket.addEventListener("error", () => clearTimeout(timer), { once: true });
    });
    return new Debugger(socket);
  }

  call(method, params = {}) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`Debugger socket is closed before ${method}`));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Debugger command ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression, awaitPromise = false) {
    const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  async waitForEvent(predicate, timeout = timeoutMs) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const index = this.events.findIndex(predicate);
      if (index >= 0) return this.events.splice(index, 1)[0];
      await sleep(10);
    }
    const tail = this.events.slice(-12).map(value => `${value.method}:${JSON.stringify(value.params ?? {})}`).join("\n");
    throw new Error(`Timed out waiting for debugger event${tail ? `; recent events:\n${tail}` : ""}`);
  }

  close() { if (!this.closed) this.socket.close(); }
}

function appendRecord(root, value) {
  fs.appendFileSync(path.join(root, "events.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
}

function installPackagedProbe(config) {
  const moduleApi = process.getBuiltinModule("node:module");
  const appPath = process.getBuiltinModule("node:path");
  const packageRequire = moduleApi.createRequire(config.bootstrapPath);
  const { app, dialog, BrowserWindow, Menu } = packageRequire("electron");
  const { shell } = packageRequire("electron");
  const fs = process.getBuiltinModule("node:fs");
  const root = process.env.POKEROGUE_R20_RESULTS;
  if (typeof root !== "string" || appPath.resolve(root) !== appPath.resolve(config.resultsRoot)) throw new Error("Probe results root differs from the spawned process environment");
  const userData = config.userData;
  const sessionData = config.sessionData;
  const inspectorArgument = process.argv.find(argument => argument.startsWith("--inspect-brk="));
  const inspectorPort = Number(inspectorArgument?.split(":").at(-1));
  if (app.isReady()) throw new Error("Profile injection occurred after Electron readiness");
  app.setPath("userData", userData);
  app.setPath("sessionData", sessionData);
  if (app.getPath("userData") !== userData || app.getPath("sessionData") !== sessionData) throw new Error("Electron did not retain both isolated profile paths");
  process.argv = process.argv.filter(argument => !argument.startsWith("--inspect"));
  app.commandLine.appendSwitch("remote-debugging-port", String(config.remotePort));

  const write = record => fs.appendFileSync(appPath.join(root, "events.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...record })}\n`);
  write({ event: "pre-bootstrap", inspectorPort, packaged: app.isPackaged, ready: app.isReady(), argv: process.argv, userData, sessionData, electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node });

  const originalSetPath = app.setPath.bind(app);
  app.setPath = (name, value) => {
    const result = originalSetPath(name, value);
    if (name === "userData" || name === "sessionData") write({ event: "profile-path", name, value });
    return result;
  };
  BrowserWindow.prototype.show = function hidePackagedProbeWindow() { this.hide(); return this; };
  dialog.showMessageBox = async (...args) => {
    const options = args.at(-1);
    const response = options.title === "Update downloaded" ? 1 : config.dialogResponse;
    write({ event: "dialog-message", title: options.title, message: options.message, detail: options.detail, buttons: options.buttons, response, actualApi: "dialog.showMessageBox" });
    return { response, checkboxChecked: false };
  };
  dialog.showOpenDialog = async (...args) => {
    const options = args.at(-1);
    write({ event: "dialog-open", title: options.title, actualApi: "dialog.showOpenDialog", selected: config.restorePath ?? null });
    return config.restorePath ? { canceled: false, filePaths: [config.restorePath] } : { canceled: true, filePaths: [] };
  };
  dialog.showErrorBox = (title, message) => write({ event: "dialog-error", title, message, actualApi: "dialog.showErrorBox" });
  const originalOpenPath = shell.openPath.bind(shell);
  shell.openPath = async value => {
    write({ event: "shell-open-path", value });
    return config.blockInstallerOpen ? "Packaged probe does not open inert Update fixture bytes" : originalOpenPath(value);
  };

  if (config.vetoQuit) app.on("will-quit", event => { write({ event: "quit-veto" }); event.preventDefault(); });

  const originalRelaunch = app.relaunch.bind(app);
  app.relaunch = options => {
    const nextPort = Number(process.env.POKEROGUE_R20_NEXT_PORT);
    if (!Number.isInteger(nextPort) || nextPort < 1) throw new Error("Missing owned child inspector port");
    process.env.POKEROGUE_R20_NEXT_PORT = String(nextPort + 1);
    write({ event: "relaunch", args: options?.args ?? [], port: nextPort });
    const args = [...(options?.args ?? [])];
    const startsWorker = args.includes("--backup-worker");
    if (config.failWorker && startsWorker) {
      const backupRoot = appPath.join(userData, "Save Backups");
      const moved = `${backupRoot}.probe-original`;
      fs.renameSync(backupRoot, moved);
      fs.writeFileSync(backupRoot, "probe worker failure");
      write({ event: "worker-failure-fixture", preservedRoot: moved });
    }
    if (config.updateTamper && startsWorker) {
      const updateRoot = appPath.join(userData, "Updates");
      const artifact = fs.readdirSync(updateRoot).find(name => name.endsWith(".exe"));
      if (artifact) {
        const file = appPath.join(updateRoot, artifact);
        if (config.updateTamper === "missing") fs.rmSync(file);
        else fs.writeFileSync(file, "tampered test installer bytes");
        write({ event: "installer-fixture", mode: config.updateTamper, file });
      }
    }
    return originalRelaunch({ ...options, args: [...args, `--inspect-brk=127.0.0.1:${nextPort}`] });
  };

  const originalLock = app.requestSingleInstanceLock.bind(app);
  app.requestSingleInstanceLock = (...args) => {
    const acquired = originalLock(...args);
    write({ event: "source-lock", acquired, args: args[0] });
    return acquired;
  };

  globalThis.__r20SetRestorePath = value => { config.restorePath = value; };
  globalThis.__r20Quit = () => app.quit();
  globalThis.__r20ClickMenu = (topLabel, itemLabel) => {
    const top = Menu.getApplicationMenu()?.items.find(item => item.label === topLabel);
    const item = top?.submenu?.items.find(value => value.label === itemLabel);
    if (!item || typeof item.click !== "function") throw new Error(`Packaged menu item unavailable: ${topLabel} / ${itemLabel}`);
    return item.click();
  };

  if (config.update !== undefined) {
    const bytes = Buffer.from("R20 inert, verified Update fixture; never executable");
    const digest = process.getBuiltinModule("node:crypto").createHash("sha256").update(bytes).digest("hex");
    const fileName = "PokeRogue-Offline-99.0.0-windows-x64.exe";
    const manifest = {
      schemaVersion: 1,
      version: "99.0.0",
      sourceRevisions: { game: "fixture-game", assets: "fixture-assets", locales: "fixture-locales" },
      artifacts: [{ platform: "windows", arch: "x64", fileName, size: bytes.length, sha256: digest, downloadUrl: `https://github.com/gaboopa/pokerogue-electron/releases/download/v99.0.0/${fileName}` }],
    };
    globalThis.fetch = async url => {
      const value = String(url);
      write({ event: "fixture-fetch", url: value });
      if (value.endsWith("/releases/latest")) return new Response(JSON.stringify({ assets: [{ name: "release-manifest.json", browser_download_url: "https://github.com/gaboopa/pokerogue-electron/releases/download/v99.0.0/release-manifest.json" }] }), { headers: { "content-type": "application/json" } });
      if (value.endsWith("/release-manifest.json")) return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } });
      if (value.endsWith(fileName)) return new Response(bytes);
      throw new Error(`Unexpected Update fixture URL: ${value}`);
    };
  }

  if (config.identity) {
    const modulePath = appPath.join(app.getAppPath(), "src", "bootstrap.mjs");
    write({ event: "packaged-identity", executable: process.execPath, appPath: app.getAppPath(), bootstrapPath: modulePath });
  }
  return { ok: true, pid: process.pid, argv: process.argv, packaged: app.isPackaged, ready: app.isReady(), userData: app.getPath("userData"), sessionData: app.getPath("sessionData"), electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node };
}

async function attachPackaged(exe, port, config, ownedPids, ownedPorts) {
  const owner = await waitForOwnedPackageProcess(exe, port, ownedPids, ownedPorts);
  const wsUrl = await waitForInspector(port);
  if (path.resolve(owner.executable) !== path.resolve(exe) || !owner.commandLine.includes(`--inspect-brk=127.0.0.1:${port}`)) {
    throw new Error(`Inspector process identity mismatch: ${JSON.stringify({ owner, exe, port })}`);
  }
  const debuggerClient = await Debugger.connect(wsUrl);
  try {
    await debuggerClient.call("Debugger.enable");
    await debuggerClient.call("Runtime.runIfWaitingForDebugger");
    const paused = await debuggerClient.waitForEvent(message => message.method === "Debugger.paused" && (message.params.reason === "Break on start" || message.params.hitBreakpoints?.length > 0));
    if (paused.params.reason !== "Break on start" && !paused.params.hitBreakpoints?.length) throw new Error("Packaged bootstrap did not stop before its first statement");
    const result = await debuggerClient.evaluate(`(${installPackagedProbe.toString()})(${JSON.stringify(config)})`);
    const processId = result.pid;
    if (owner.pid !== processId) throw new Error(`Debugger and inspector disagree on packaged PID ${port}: ${JSON.stringify({ owner, processId })}`);
    if (!result?.ok || result.ready || !result.packaged || result.userData !== config.userData || result.sessionData !== config.sessionData) throw new Error(`Pre-bootstrap isolation failed: ${JSON.stringify(result)}`);
    const holdWorker = config.holdWorker && result.argv.includes("--backup-worker");
    if (!holdWorker) await debuggerClient.call("Debugger.resume");
    result.heldAtBootstrap = holdWorker;
    return { debuggerClient, pid: processId, marker: result };
  } catch (error) {
    debuggerClient.close();
    throw error;
  }
}

async function waitForPidExit(pid, timeout = timeoutMs) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") return; }
    await sleep(50);
  }
  throw new Error(`Packaged Electron PID ${pid} did not exit within ${timeout} ms`);
}

async function waitForOwnedPackageProcess(exe, port, ownedPids, ownedPorts, timeout = timeoutMs) {
  const escapedExe = exe.replaceAll("'", "''");
  const script = `$p=Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${escapedExe}' -and $_.CommandLine -like '*--inspect-brk=127.0.0.1:${port}*' } | Select-Object -First 1; if ($p) { [Console]::WriteLine($p.ProcessId); [Console]::WriteLine($p.ExecutablePath); [Console]::WriteLine($p.CommandLine) }`;
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 5_000 });
      const [pidText, executable, ...tail] = stdout.trim().split(/\r?\n/);
      if (pidText && Number(pidText) > 0) {
        const owner = { pid: Number(pidText), executable, commandLine: tail.join("\n") };
        if (path.resolve(owner.executable) !== path.resolve(exe) || !owner.commandLine.includes(`--inspect-brk=127.0.0.1:${port}`)) throw new Error(`Inspector process identity mismatch: ${JSON.stringify({ owner, exe, port })}`);
        ownedPids.add(owner.pid);
        ownedPorts.set(owner.pid, port);
        return owner;
      }
    } catch (error) { lastError = error; }
    await sleep(50);
  }
  throw new Error(`Packaged process for inspector port ${port} did not start: ${lastError?.message ?? "no matching executable command line"}`);
}

async function cleanupOwned(ownedPids, ownedPorts, exe, resultsRoot) {
  const knownPorts = new Set(ownedPorts.values());
  const relaunches = () => {
    if (!resultsRoot || !fs.existsSync(path.join(resultsRoot, "events.jsonl"))) return [];
    const events = fs.readFileSync(path.join(resultsRoot, "events.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    return events.filter(value => value.event === "relaunch" && ownedPids.has(value.pid) && Number.isInteger(value.port) && !knownPorts.has(value.port) && !events.some(child => child.event === "pre-bootstrap" && child.inspectorPort === value.port));
  };
  const terminateOwned = async () => {
    for (const pid of [...ownedPids]) {
      try { process.kill(pid, 0); }
      catch (error) { if (error.code === "ESRCH") { ownedPorts.delete(pid); continue; } }
      const port = ownedPorts.get(pid);
      if (!port) continue;
      const script = `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p -and $p.ExecutablePath -eq '${exe.replaceAll("'", "''")}' -and $p.CommandLine -like '*--inspect-brk=127.0.0.1:${port}') { Stop-Process -Id ${pid} -Force }`;
      await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10_000 });
      await waitForPidExit(pid, 10_000);
      if (resultsRoot) appendRecord(resultsRoot, { event: "cleanup-terminated-pid", pid, port, executable: exe });
      ownedPorts.delete(pid);
    }
  };
  await terminateOwned();
  for (const relaunch of relaunches()) {
    try {
      const child = await waitForOwnedPackageProcess(exe, relaunch.port, ownedPids, ownedPorts, 4_000);
      appendRecord(resultsRoot, { event: "cleanup-registered-relaunch-child", parentPid: relaunch.pid, pid: child.pid, port: relaunch.port, executable: child.executable });
    } catch (error) {
      appendRecord(resultsRoot, { event: "cleanup-relaunch-child-absent", parentPid: relaunch.pid, port: relaunch.port, message: error.message });
    }
  }
  await terminateOwned();
  ownedPids.clear();
  ownedPorts.clear();
}

async function connectGame(remotePort, expression) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await requestJson(remotePort, "/json/list");
      const target = targets.find(value => value.type === "page" && value.url.startsWith("app://"));
      if (target) {
        const debuggerClient = await Debugger.connect(target.webSocketDebuggerUrl);
        const bridge = await debuggerClient.evaluate("typeof window.pokerogueDesktop !== 'undefined'");
        if (bridge) return { debuggerClient, target };
        debuggerClient.close();
      }
    } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw new Error(`Packaged game renderer did not become ready: ${lastError?.message ?? "no app:// page"}`);
}

async function connectCheat(remotePort) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await requestJson(remotePort, "/json/list");
      const target = targets.find(value => value.type === "page" && /cheat-window\/index\.html/i.test(value.url));
      if (target) {
        const debuggerClient = await Debugger.connect(target.webSocketDebuggerUrl);
        if (await debuggerClient.evaluate("document.readyState === 'complete' && !!document.getElementById('enabled')")) return { debuggerClient, target };
        debuggerClient.close();
      }
    } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw new Error(`Packaged Cheat editor did not become ready: ${lastError?.message ?? "no editor page"}`);
}

async function evalRenderer(remotePort, expression, awaitPromise = false) {
  const { debuggerClient } = await connectGame(remotePort);
  try { return await debuggerClient.evaluate(expression, awaitPromise); }
  finally { debuggerClient.close(); }
}

async function waitForEvent(root, predicate, timeout = timeoutMs) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const file = path.join(root, "events.jsonl");
    const events = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
    const match = events.findLast(predicate);
    if (match) return match;
    await sleep(100);
  }
  throw new Error("Timed out waiting for packaged event");
}

module.exports = {
  attachPackaged,
  cleanupOwned,
  connectGame,
  connectCheat,
  evalRenderer,
  waitForEvent,
  waitForInspector,
  waitForPidExit,
  sleep,
};
