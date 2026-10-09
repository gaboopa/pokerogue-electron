const slug = value => String(value ?? "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";

export function serializeMenuTemplate(template, platform = process.platform) {
  const menuOccurrences = new Map();
  template.forEach(menu => {
    if (!menu.submenu) return;
    const menuName = slug(menu.label);
    const menuOccurrence = menuOccurrences.get(menuName) ?? 0;
    menuOccurrences.set(menuName, menuOccurrence + 1);
    const menuId = `${menuName}-${menuOccurrence}`;
    menu.id = menuId;
    const itemOccurrences = new Map();
    menu.submenu.forEach(item => {
      const name = slug(item.label ?? item.role ?? item.type);
      const occurrence = itemOccurrences.get(name) ?? 0;
      itemOccurrences.set(name, occurrence + 1);
      item.id = `${menuId}.${name}-${occurrence}`;
    });
  });
  const shortcut = item => {
    if (item.role === "quit") return platform === "darwin" ? "⌘Q" : "Alt+F4";
    if (!item.accelerator) return "";
    return item.accelerator
      .replaceAll("CommandOrControl", platform === "darwin" ? "⌘" : "Ctrl")
      .replaceAll("Command", "⌘")
      .replaceAll("Control", platform === "darwin" ? "⌃" : "Ctrl")
      .replaceAll("Alt", platform === "darwin" ? "⌥" : "Alt")
      .replaceAll("Shift", platform === "darwin" ? "⇧" : "Shift")
      .replaceAll("+", platform === "darwin" ? "" : "+");
  };
  return template.filter(menu => menu.submenu).map(menu => ({
    id: menu.id, label: menu.label,
    items: menu.submenu.map(item => ({
      id: item.id,
      label: item.label ?? "", type: item.header ? "header" : item.type ?? "normal",
      checked: item.checked === true, enabled: item.enabled !== false,
      shortcut: shortcut(item),
    })),
  }));
}

export function calculateViewBounds(width, height, fullScreen, menuOpen) {
  if (fullScreen) return { bar: { x: 0, y: 0, width, height: 0 }, game: { x: 0, y: 0, width, height }, barVisible: false };
  const barHeight = menuOpen ? height : 48;
  return {
    bar: { x: 0, y: 0, width, height: barHeight },
    game: { x: 0, y: 48, width, height: Math.max(0, height - 48) },
    barVisible: true,
  };
}

export function activateMenuItem({ template, id, senderId, barId }) {
  if (senderId !== barId) return false;
  for (const menu of template) for (const item of menu.submenu ?? []) {
    if (item.id !== id) continue;
    if (item.enabled === false || item.type === "separator" || item.header) return false;
    if (item.click) { item.click(); return true; }
    else if (item.role) return item.role;
    return false;
  }
  return false;
}

export function trackLoneAlt(pending, input) {
  const modified = input.control || input.meta || input.shift;
  if (input.type === "keyDown" && input.key === "Alt") return { pending: !modified, activate: false };
  if (pending && input.type === "keyUp" && input.key === "Alt") return { pending: false, activate: !modified };
  return { pending: false, activate: false };
}
