import { BrowserWindow, ipcMain, screen } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dialogs = new Map();
const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function getDialog(event) {
  const dialog = dialogs.get(event.sender.id);
  return dialog?.window.webContents === event.sender && !dialog.window.isDestroyed() ? dialog : undefined;
}

ipcMain.handle("dialog:options", event => getDialog(event)?.options);
ipcMain.on("dialog:resize", (event, height) => {
  const dialog = getDialog(event);
  if (!dialog || !Number.isFinite(height) || height <= 0) return;
  const display = dialog.parent && !dialog.parent.isDestroyed()
    ? screen.getDisplayMatching(dialog.parent.getBounds())
    : screen.getDisplayMatching(dialog.window.getBounds());
  const workAreaHeight = display.workAreaSize.height;
  dialog.window.setContentSize(560, Math.min(Math.ceil(height), workAreaHeight));
  dialog.window.show();
});
ipcMain.on("dialog:respond", (event, index) => {
  const dialog = getDialog(event);
  if (!dialog || !Number.isInteger(index) || index < 0 || index >= dialog.options.buttons.length) return;
  dialog.resolve({ response: index });
  dialog.window.close();
});

export function showThemedMessageBox(parent, options) {
  const buttons = options.buttons ?? ["OK"];
  const dialogOptions = { ...options, buttons };
  return new Promise(resolve => {
    const window = new BrowserWindow({
      width: 560,
      height: 96,
      parent,
      modal: true,
      frame: false,
      resizable: false,
      minimizable: false,
      show: false,
      autoHideMenuBar: true,
      title: options.title,
      webPreferences: {
        preload: join(moduleRoot, "src", "dialog-window", "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const contentsId = window.webContents.id;
    const dialog = { window, parent, options: dialogOptions, resolve };
    let fallbackTimer;
    dialogs.set(contentsId, dialog);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.on("did-fail-load", () => window.close());
    window.webContents.on("render-process-gone", () => window.close());
    window.once("ready-to-show", () => {
      fallbackTimer = setTimeout(() => {
        if (!window.isDestroyed() && !window.isVisible()) window.show();
      }, 300);
    });
    window.on("closed", () => {
      clearTimeout(fallbackTimer);
      dialogs.delete(contentsId);
      resolve({ response: options.cancelId ?? 0 });
    });
    void window.loadFile(join(moduleRoot, "src", "dialog-window", "index.html")).catch(() => window.close());
  });
}
