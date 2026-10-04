const { app, BrowserWindow, session } = require("electron");
const { createServer } = require("node:http");
const { mkdir, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const bootstrapResult = process.env.POKEROGUE_STORAGE_PROBE_RESULT ?? process.argv.at(-2);
if (bootstrapResult) {
  try { require("node:fs").writeFileSync(`${bootstrapResult}.started`, JSON.stringify(process.argv)); } catch {}
}

const [rootArg, resultArg, repeatArg] = process.argv.slice(2);
const root = resolve(process.env.POKEROGUE_STORAGE_PROBE_ROOT ?? rootArg ?? "");
const resultPath = resolve(process.env.POKEROGUE_STORAGE_PROBE_RESULT ?? resultArg ?? "");
const repeatCount = Number(process.env.POKEROGUE_STORAGE_PROBE_REPEATS ?? repeatArg);
const timeoutMs = 90000;
let failureReported = false;

function reportFailure(error) {
  if (failureReported) return;
  failureReported = true;
  const message = error?.stack ?? String(error);
  console.error(message);
  if (resultPath) {
    try {
      require("node:fs").writeFileSync(resultPath, JSON.stringify({ error: message }));
    } catch {}
  }
  app.exit(1);
}

process.on("uncaughtException", reportFailure);
process.on("unhandledRejection", reportFailure);
const page = `<!doctype html><meta charset="utf-8"><script>
let db;
const request = indexedDB.open("pokerogue-backup-probe", 1);
request.onupgradeneeded = () => {
  db = request.result;
  db.createObjectStore("save", { keyPath: "id" });
  db.createObjectStore("journal", { keyPath: "id" });
};
request.onsuccess = () => { db = request.result; window.storageReady = true; };
request.onerror = () => { window.storageError = request.error?.message ?? "IndexedDB open failed"; };
window.writeIdbPair = (generation) => new Promise((resolve, reject) => {
  const tx = db.transaction(["save", "journal"], "readwrite");
  tx.objectStore("save").put({ id: "system", generation, data: { trainerId: 42 } });
  tx.objectStore("journal").put({ id: "system", generation, checksum: ` + "`generation-${generation}`" + ` });
  tx.oncomplete = resolve;
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
});
window.seed = async (generation) => {
  const system = {
    dexData: { 25: { caughtCount: generation, hatchedCount: 0, caughtAttr: 1 } },
    starterData: { 25: { abilityAttr: generation, eggMoves: 0, moveset: null, passiveAttr: 0, valueReduction: 0 } },
    generation,
  };
  localStorage.setItem("data_Guest", JSON.stringify(system));
  localStorage.setItem("sessionData0_Guest", JSON.stringify({ generation, party: [], enemyParty: [], timestamp: 123 }));
  await window.writeIdbPair(generation);
};
window.beginSplitWrite = (generation) => {
  window.phase = "writing-local-storage";
  const system = {
    dexData: { 25: { caughtCount: generation, hatchedCount: 0, caughtAttr: 1 } },
    starterData: { 25: { abilityAttr: generation, eggMoves: 0, moveset: null, passiveAttr: 0, valueReduction: 0 } },
    generation,
  };
  // Upstream saveAll writes the system and current session to separate Local Storage keys.
  localStorage.setItem("data_Guest", JSON.stringify(system));
  window.phase = "system-key-updated";
  window.updatePromise = new Promise((resolve, reject) => {
    window.continueUpdate = async () => {
      try {
        await window.writeIdbPair(generation);
        localStorage.setItem("sessionData0_Guest", JSON.stringify({ generation, party: [], enemyParty: [], timestamp: 123 + generation }));
        window.phase = "all-stores-updated";
        resolve();
      } catch (error) {
        reject(error);
      }
    };
  });
};
window.readSnapshot = async () => {
  const local = {
    system: JSON.parse(localStorage.getItem("data_Guest")),
    session: JSON.parse(localStorage.getItem("sessionData0_Guest")),
  };
  const readStore = name => new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readonly");
    const request = tx.objectStore(name).get("system");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return { local, idb: { save: await readStore("save"), journal: await readStore("journal") } };
};
</script>`;

function timeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

async function waitFor(win, expression, label) {
  await timeout((async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await win.webContents.executeJavaScript(expression);
      if (state === true) return;
      if (typeof state === "string" && state.startsWith("ERROR:")) throw new Error(state.slice(6));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`${label} timed out after ${timeoutMs} ms`);
  })(), label);
}

async function openPage(ses, url) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await timeout(win.loadURL(url), "loading probe page");
  await waitFor(win, "window.storageReady === true ? true : window.storageError ? `ERROR:${window.storageError}` : false", "opening IndexedDB");
  return win;
}

async function main() {
  if ((!process.env.POKEROGUE_STORAGE_PROBE_ROOT && !rootArg)
    || (!process.env.POKEROGUE_STORAGE_PROBE_RESULT && !resultArg)
    || !Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 20) {
    throw new Error("Set POKEROGUE_STORAGE_PROBE_ROOT, POKEROGUE_STORAGE_PROBE_RESULT, and a repeat count from 1-20.");
  }
  await require("node:fs/promises").mkdir(root, { recursive: true });
  app.setPath("userData", root);
  app.commandLine.appendSwitch("disable-gpu");
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page);
  });
  await timeout(new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  }), "starting local probe server");
  await app.whenReady();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const { createBackup, restoreBackup, validateBackup } = await import(pathToFileURL(join(__dirname, "../../src/backup.mjs")));
  const keepAliveWindow = new BrowserWindow({ show: false });
  const rounds = [];

  try {
    for (let index = 0; index < repeatCount; index++) {
      const sourceProfile = join(root, `source-${index}`);
      const freshProfile = join(root, `restored-${index}`);
      const backupRoot = join(root, `backups-${index}`);
      await Promise.all([mkdir(sourceProfile, { recursive: true }), mkdir(backupRoot, { recursive: true })]);
      const sourceSession = await session.fromPath(sourceProfile);
      const sourceWindow = await openPage(sourceSession, url);
      await sourceWindow.webContents.executeJavaScript("window.seed(1)");
      await sourceSession.flushStorageData();
      await sourceWindow.webContents.executeJavaScript("window.beginSplitWrite(2)");
      await waitFor(sourceWindow, "window.phase === 'system-key-updated'", "waiting for controlled Local Storage save boundary");
      const sourceBeforeBackup = await sourceWindow.webContents.executeJavaScript("window.readSnapshot()");

      // This is the production capture order: flush DOMStorage, then copy the profile tree.
      await sourceSession.flushStorageData();
      const backup = await timeout(createBackup(sourceProfile, backupRoot), "copying Chromium storage profile");
      const manifest = await validateBackup(backup);
      const captured = await (await import("node:fs/promises")).readFile(join(backup, "data", "Local Storage", "leveldb", "CURRENT"), "utf8").catch(() => "");

      await sourceWindow.webContents.executeJavaScript("window.continueUpdate()");
      await waitFor(sourceWindow, "window.phase === 'all-stores-updated'", "finishing controlled cross-store write");
      await sourceSession.flushStorageData();
      await sourceWindow.close();

      await restoreBackup(freshProfile, backup);
      const restoredSession = await session.fromPath(freshProfile);
      const restoredWindow = await openPage(restoredSession, url);
      const restored = await timeout(restoredWindow.webContents.executeJavaScript("window.readSnapshot()"), "reopening restored IndexedDB");
      await restoredWindow.close();

      const system = restored.local.system;
      const starter = system?.starterData?.[25];
      const dex = system?.dexData?.[25];
      const sessionData = restored.local.session;
      const upstreamSystemInvariant = !!starter && !!dex
        && (starter.abilityAttr > 0 || starter.eggMoves > 0 || starter.moveset != null || starter.passiveAttr > 0 || starter.valueReduction > 0)
        && !(dex.caughtCount === 0 && dex.hatchedCount === 0 && dex.caughtAttr === 0);
      rounds.push({
        iteration: index + 1,
        backupSchemaVersion: manifest.schemaVersion,
        included: manifest.included,
        restoredSystemGeneration: system?.generation,
        restoredSessionGeneration: sessionData?.generation,
        restoredIndexedDbGeneration: restored.idb.save?.generation,
        restoredIndexedDbJournalGeneration: Number(restored.idb.journal?.checksum?.replace("generation-", "")),
        sourceIndexedDbGeneration: sourceBeforeBackup.idb.save?.generation,
        sourceIndexedDbJournalGeneration: Number(sourceBeforeBackup.idb.journal?.checksum?.replace("generation-", "")),
        databaseReopened: restored.idb.save?.id === "system" && restored.idb.journal?.id === "system",
        restoredMatchesSource: JSON.stringify(restored) === JSON.stringify(sourceBeforeBackup),
        upstreamSystemInvariant,
        capturedBetweenSaveAllKeys: sourceBeforeBackup.local.system?.generation === 2 && sourceBeforeBackup.local.session?.generation === 1
          && system?.generation === sourceBeforeBackup.local.system?.generation
          && sessionData?.generation === sourceBeforeBackup.local.session?.generation,
        upstreamSessionShape: Array.isArray(sessionData?.party) && Array.isArray(sessionData?.enemyParty) && Number.isFinite(sessionData?.timestamp),
        levelDbCurrentFileObserved: captured.trim().length > 0,
      });
      await restoredSession.closeAllConnections();
      await sourceSession.closeAllConnections();
    }
    await writeFile(resultPath, JSON.stringify({ electronVersion: process.versions.electron, chromeVersion: process.versions.chrome, platform: process.platform, arch: process.arch, rounds }, null, 2));
    console.log(`Wrote storage probe result to ${resultPath}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    keepAliveWindow.destroy();
    app.quit();
  }
}

main().catch(reportFailure);
