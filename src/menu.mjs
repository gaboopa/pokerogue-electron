export function createMenuTemplate({
  isMac,
  productName,
  onCheckForUpdates,
  onBackup,
  onRestore,
  onOpenSaveFolder,
  onReload,
  onToggleFullscreen,
  onDeveloperTools,
  utilities,
  keybindings,
  cheats,
}) {
  const appSubmenu = [
    ...(isMac ? [{ role: "about" }, { type: "separator" }] : []),
    { label: "Check for Updates…", click: onCheckForUpdates },
    { type: "separator" },
    { label: "Back Up Saves…", click: onBackup },
    { label: "Restore Backup…", click: onRestore },
    { label: "Open Save Folder", click: onOpenSaveFolder },
    ...(isMac
      ? [
          { type: "separator" },
          { role: "services", submenu: [] },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ]
      : [{ type: "separator" }, { role: "quit" }]),
  ];

  const viewSubmenu = [
    { label: "Reload", accelerator: isMac ? "Command+R" : "CommandOrControl+R", click: onReload },
    { label: "Toggle Full Screen", accelerator: isMac ? "Control+Command+F" : "F11", click: onToggleFullscreen },
    { label: "Developer Tools", accelerator: isMac ? "Alt+Command+I" : "F12", click: onDeveloperTools },
  ];

  const template = [
    { label: productName, submenu: appSubmenu },
    ...(isMac ? [{ label: "File", submenu: [{ role: "close" }] }] : []),
    { label: "View", submenu: viewSubmenu },
    { label: "Utilities", submenu: utilities },
    { label: "Keybindings", submenu: keybindings },
    { label: "Cheats", submenu: cheats },
    ...(isMac
      ? [{ label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] }]
      : []),
  ];

  return template;
}
