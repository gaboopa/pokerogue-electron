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
  const appSubmenu = isMac
    ? [
        { role: "about" },
        { type: "separator" },
        { label: "Check for Updates…", click: onCheckForUpdates },
        { type: "separator" },
        { label: "Copy Diagnostic Report", click: onCopyDiagnosticReport },
        { type: "separator" },
        { role: "services", submenu: [] },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ]
    : [
        { label: "Check for Updates…", click: onCheckForUpdates },
        { type: "separator" },
        { label: "Copy Diagnostic Report", click: onCopyDiagnosticReport },
        { type: "separator" },
        { role: "quit" },
      ];

  const savesSubmenu = [
    { label: "Back Up Saves…", click: onBackup },
    { label: "Restore Backup…", click: onRestore },
    { type: "separator" },
    { label: "Open Save Folder", click: onOpenSaveFolder },
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

  const chartSeparator = utilities.findIndex(item => item.type === "separator");
  const webUtilities = chartSeparator === -1 ? utilities : utilities.slice(0, chartSeparator);
  const charts = chartSeparator === -1 ? [] : utilities.slice(chartSeparator + 1);
  const toolsSubmenu = [
    { label: "OPENS IN BROWSER", enabled: false, header: true },
    ...webUtilities,
    { type: "separator" },
    { label: "OFFLINE", enabled: false, header: true },
    ...charts,
    { type: "separator" },
    { label: "KEYBINDINGS", enabled: false, header: true },
    ...keybindings,
  ];

  const template = [
    ...(isMac ? [{ label: productName, submenu: appSubmenu }] : [{ label: "Game", submenu: appSubmenu }]),
    ...(isMac ? [{ label: "File", submenu: [{ role: "close" }] }] : []),
    { label: "Saves", submenu: savesSubmenu },
    { label: "View", submenu: viewSubmenu },
    { label: "Tools", submenu: toolsSubmenu },
    { label: "Cheats", submenu: cheats },
    { label: "Profiles", submenu: profiles },
    ...(isMac
      ? [{ label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] }]
      : []),
  ];

  return template;
}
