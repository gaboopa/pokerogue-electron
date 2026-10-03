const { app, BrowserWindow } = require("electron");
const { writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");

const [profilePath, resultPath] = process.argv.slice(2);
app.setPath("userData", resolve(profilePath));
let window;
let observedEventCount = 0;
const observations = {};

function fail(error) {
  writeFile(resultPath, JSON.stringify({ error: error?.stack ?? String(error), observations })).finally(() => app.exit(1));
}

async function updateMappings(mappings) {
  window.webContents.send("keybindings:update", mappings);
  await window.webContents.executeJavaScript("0");
}

async function reset(name, mappings) {
  observations[name] = [];
  await window.webContents.executeJavaScript("window.keyboardProbe.events.length = 0; window.keyboardProbe.pressed = [];");
  observedEventCount = 0;
  await updateMappings(mappings);
}

async function capture(name) {
  observations[name] = await window.webContents.executeJavaScript("window.keyboardProbe.events.slice()");
  observations[`${name}Pressed`] = await window.webContents.executeJavaScript("window.keyboardProbe.pressed.slice()");
}

async function waitForEvents(count) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const received = await window.webContents.executeJavaScript("window.keyboardProbe.events.length");
    if (received >= count) { observedEventCount = received; return; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${count} keyboard events`);
}

async function key(type, keyCode, eventCount, extra = {}) {
  window.webContents.sendInputEvent({ type, keyCode, ...extra });
  if (eventCount > observedEventCount) await waitForEvents(eventCount);
}

async function run() {
  window = new BrowserWindow({
    show: true,
    opacity: 0,
    skipTaskbar: true,
    webPreferences: {
      preload: resolve(__dirname, "../../src/preload-cheats.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset="utf-8"><script>
    window.keyboardProbe = { events: [], pressed: [] };
    for (const type of ["keydown", "keyup"]) {
      window.addEventListener(type, event => {
        const record = {
          type: event.type,
          key: event.key,
          code: event.code,
          keyCode: event.keyCode,
          repeat: event.repeat,
          trusted: event.isTrusted,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey
        };
        window.keyboardProbe.events.push(record);
        const index = window.keyboardProbe.pressed.indexOf(event.keyCode);
        if (event.type === "keydown" && index < 0) window.keyboardProbe.pressed.push(event.keyCode);
        if (event.type === "keyup" && index >= 0) window.keyboardProbe.pressed.splice(index, 1);
      }, true);
    }
  </script>`));
  window.webContents.focus();

  await reset("named", { W: "ArrowUp" });
  await key("keyDown", "W", 1);
  await key("keyUp", "W", 2);
  await capture("named");

  await reset("letter", { Q: "A" });
  await key("keyDown", "Q", 1);
  await key("keyUp", "Q", 2);
  await capture("letter");

  await reset("digit", { "1": "Space" });
  await key("keyDown", "1", 1);
  await key("keyUp", "1", 2);
  await capture("digit");

  await reset("digitTarget", { Q: "1" });
  await key("keyDown", "Q", 1);
  await key("keyUp", "Q", 2);
  await capture("digitTarget");

  await reset("repeat", { W: "ArrowUp" });
  await key("keyDown", "W", 1);
  await key("keyDown", "W", 2, { modifiers: ["isautorepeat"] });
  await key("keyUp", "W", 3);
  await capture("repeat");

  await reset("mappingChange", { W: "ArrowUp" });
  await key("keyDown", "W", 1);
  await updateMappings({ W: "Enter" });
  await waitForEvents(2);
  await key("keyUp", "W", 2);
  await capture("mappingChange");

  await reset("sharedTarget", { W: "ArrowUp", A: "ArrowUp" });
  await key("keyDown", "W", 1);
  await key("keyDown", "A", 1);
  await key("keyUp", "W", 1);
  await key("keyUp", "A", 2);
  await capture("sharedTarget");

  await reset("identity", { W: "W" });
  await key("keyDown", "W", 1);
  await key("keyUp", "W", 2);
  await capture("identity");

  await reset("modifier", { A: "ArrowUp" });
  await key("keyDown", "Control", 1);
  await key("keyDown", "A", 2, { modifiers: ["control"] });
  await key("keyUp", "A", 3, { modifiers: ["control"] });
  await key("keyUp", "Control", 4);
  await capture("modifier");

  await reset("altModifier", { A: "ArrowUp" });
  await key("keyDown", "Alt", 1);
  await key("keyDown", "A", 2, { modifiers: ["alt"] });
  await key("keyUp", "A", 3, { modifiers: ["alt"] });
  await key("keyUp", "Alt", 4);
  await capture("altModifier");

  await reset("metaModifier", { A: "ArrowUp" });
  await key("keyDown", "Meta", 1);
  await key("keyDown", "A", 2, { modifiers: ["meta"] });
  await key("keyUp", "A", 3, { modifiers: ["meta"] });
  await key("keyUp", "Meta", 4);
  await capture("metaModifier");

  await reset("blur", { W: "ArrowUp" });
  await key("keyDown", "W", 1);
  await window.webContents.executeJavaScript("window.dispatchEvent(new Event('blur'))");
  await waitForEvents(2);
  await capture("blur");
  observations.blurPressed = await window.webContents.executeJavaScript("window.keyboardProbe.pressed.slice()");

  await writeFile(resultPath, JSON.stringify({ observations }));
  app.exit(0);
}

const timeout = setTimeout(() => fail(new Error("Keyboard preload probe timed out")), 15000);
app.whenReady().then(run).then(() => clearTimeout(timeout), fail);
