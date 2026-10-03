const { app, BrowserWindow } = require("electron");
const { writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");

const [profilePath, resultPath] = process.argv.slice(2);
app.setPath("userData", resolve(profilePath));
let window;
const observations = {};

function fail(error) {
  writeFile(resultPath, JSON.stringify({ error: error?.stack ?? String(error), observations })).finally(() => app.exit(1));
}

async function pause() {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function reset(name, mappings) {
  observations[name] = [];
  await window.webContents.executeJavaScript("window.keyboardProbe.events.length = 0; window.keyboardProbe.pressed = [];");
  window.webContents.send("keybindings:update", mappings);
  await pause();
}

async function capture(name) {
  observations[name] = await window.webContents.executeJavaScript("window.keyboardProbe.events.slice()");
  observations[`${name}Pressed`] = await window.webContents.executeJavaScript("window.keyboardProbe.pressed.slice()");
}

function key(type, keyCode, extra = {}) {
  window.webContents.sendInputEvent({ type, keyCode, ...extra });
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
  key("keyDown", "W");
  key("keyUp", "W");
  await capture("named");

  await reset("letter", { Q: "A" });
  key("keyDown", "Q");
  key("keyUp", "Q");
  await capture("letter");

  await reset("digit", { "1": "Space" });
  key("keyDown", "1");
  key("keyUp", "1");
  await capture("digit");

  await reset("repeat", { W: "ArrowUp" });
  key("keyDown", "W");
  await pause();
  key("keyDown", "W", { modifiers: ["isautorepeat"] });
  key("keyUp", "W");
  await capture("repeat");

  await reset("mappingChange", { W: "ArrowUp" });
  key("keyDown", "W");
  await pause();
  window.webContents.send("keybindings:update", { W: "Enter" });
  await pause();
  key("keyUp", "W");
  await capture("mappingChange");

  await reset("sharedTarget", { W: "ArrowUp", A: "ArrowUp" });
  key("keyDown", "W");
  key("keyDown", "A");
  key("keyUp", "W");
  key("keyUp", "A");
  await capture("sharedTarget");

  await reset("identity", { W: "W" });
  key("keyDown", "W");
  key("keyUp", "W");
  await capture("identity");

  await reset("modifier", { A: "ArrowUp" });
  key("keyDown", "Control");
  key("keyDown", "A", { modifiers: ["control"] });
  key("keyUp", "A", { modifiers: ["control"] });
  key("keyUp", "Control");
  await capture("modifier");

  await reset("blur", { W: "ArrowUp" });
  key("keyDown", "W");
  await pause();
  await window.webContents.executeJavaScript("window.dispatchEvent(new Event('blur'))");
  await capture("blur");
  observations.blurPressed = await window.webContents.executeJavaScript("window.keyboardProbe.pressed.slice()");

  await writeFile(resultPath, JSON.stringify({ observations }));
  app.exit(0);
}

const timeout = setTimeout(() => fail(new Error("Keyboard preload probe timed out")), 15000);
app.whenReady().then(run).then(() => clearTimeout(timeout), fail);
