export function createMenuTemplate({
  isMac,
  productName,
  onCheckForUpdates,
  onBackup,
  onRestore,
  onOpenSaveFolder,
  onCopyDiagnosticReport,
  onReload,
  onToggleFullscreen,
  onDeveloperTools,
  utilities,
  keybindings,
  cheats,
  profileNames = [],
  activeProfile = null,
  onSelectProfile = () => {},
  onNewProfile = () => {},
}) {
  const appSubmenu = [
    ...(isMac ? [{ role: "about" }, { type: "separator" }] : []),
    { label: "Check for Updates…", click: onCheckForUpdates },
    { type: "separator" },
    { label: "Back Up Saves…", click: onBackup },
    { label: "Restore Backup…", click: onRestore },
    { label: "Open Save Folder", click: onOpenSaveFolder },
    { label: "Copy Diagnostic Report", click: onCopyDiagnosticReport },
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
    { label: "Reload", accelerator: "CommandOrControl+R", click: onReload },
    { label: "Toggle Full Screen", accelerator: isMac ? "Control+Command+F" : "F11", click: onToggleFullscreen },
    { label: "Developer Tools", accelerator: isMac ? "Alt+Command+I" : "F12", click: onDeveloperTools },
  ];

  const profiles = [
    { label: "Default", type: "radio", checked: activeProfile === null, click: () => onSelectProfile(null) },
    ...profileNames.map(name => ({ label: name, type: "radio", checked: activeProfile === name, click: () => onSelectProfile(name) })),
    { type: "separator" },
    { label: "New Profile…", click: onNewProfile },
  ];

  const template = [
    { label: productName, submenu: appSubmenu },
    ...(isMac ? [{ label: "File", submenu: [{ role: "close" }] }] : []),
    { label: "View", submenu: viewSubmenu },
    { label: "Utilities", submenu: utilities },
    { label: "Keybindings", submenu: keybindings },
    { label: "Cheats", submenu: cheats },
    { label: "Profiles", submenu: profiles },
    ...(isMac
      ? [{ label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] }]
      : []),
  ];

  return template;
}
