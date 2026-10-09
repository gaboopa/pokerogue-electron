import { transitionMenu } from "./menu-state.mjs";

const api = window.windowBar;
const bar = document.getElementById("bar"), nav = document.getElementById("menus"), dropdown = document.getElementById("dropdown");
let state = { menus: [], open: null, activeItem: null }, viewState = { profileName: null, cheatsEnabled: false, mac: false, update: null }, pendingAlt = false;
const widths = { Game: 360, Saves: 320, View: 380, Tools: 460, Cheats: 320, Profiles: 300 };

function menuIndex(id) { return state.menus.findIndex(menu => menu.id === id); }
function labelFor(id) { return [...nav.children].find(button => button.dataset.menuId === id); }
function syncLabels() { for (const button of nav.children) button.setAttribute("aria-expanded", String(button.dataset.menuId === state.open)); }
function syncActiveItem(focus = false) {
  for (const row of dropdown.querySelectorAll(".dropdown-item")) {
    const active = row.dataset.id === state.activeItem;
    if (active) row.setAttribute("aria-current", "true"); else row.removeAttribute("aria-current");
    if (active && focus) row.focus();
  }
}
function renderLabels() {
  nav.replaceChildren();
  for (const menu of state.menus) {
    const button = document.createElement("button"); button.className = "menu-label"; button.dataset.menuId = menu.id; button.setAttribute("role", "menuitem"); button.textContent = menu.label;
    button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-controls", "dropdown");
    button.addEventListener("click", () => apply({ type: "click-label", menuId: menu.id }));
    button.addEventListener("mouseenter", () => apply({ type: "hover-label", menuId: menu.id })); nav.append(button);
  }
  syncLabels();
}
function renderDropdown() {
  const menu = state.menus.find(candidate => candidate.id === state.open);
  if (!menu) { dropdown.hidden = true; dropdown.replaceChildren(); return; }
  const focusedId = dropdown.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  const fragment = document.createDocumentFragment();
  dropdown.setAttribute("role", "menu"); dropdown.setAttribute("aria-label", menu.label);
  dropdown.style.minWidth = `${widths[menu.label] ?? 300}px`; dropdown.hidden = false;
  for (const item of menu.items) {
    if (item.type === "separator") { const sep = document.createElement("div"); sep.className = "separator"; sep.setAttribute("role", "separator"); fragment.append(sep); continue; }
    const row = document.createElement("div"); row.className = "dropdown-item"; row.dataset.id = item.id;
    const header = item.type === "header"; row.setAttribute("role", header ? "presentation" : item.type === "radio" ? "menuitemradio" : "menuitem");
    row.setAttribute("aria-disabled", String(header || !item.enabled)); if (item.type === "radio") row.setAttribute("aria-checked", String(item.checked));
    if (!header && item.enabled) row.tabIndex = -1;
    const leading = document.createElement("span"); leading.className = "leading"; row.append(leading);
    const label = document.createElement("span"); label.textContent = item.label; row.append(label);
    if (item.shortcut) { const shortcut = document.createElement("span"); shortcut.className = "shortcut"; shortcut.textContent = item.shortcut; row.append(shortcut); }
    if (!header && item.enabled) {
      row.addEventListener("click", () => apply({ type: "pick-item", itemId: item.id }));
      row.addEventListener("mouseenter", () => { apply({ type: "hover-item", itemId: item.id }); syncActiveItem(); });
    }
    if (item.type === "radio" && item.checked) row.dataset.activeProfile = "true";
    fragment.append(row);
  }
  dropdown.replaceChildren(fragment);
  syncActiveItem();
  if (focusedId && dropdown.querySelector(`[data-id="${CSS.escape(focusedId)}"]`)) dropdown.querySelector(`[data-id="${CSS.escape(focusedId)}"]`).focus();
  placeMenu(menuIndex(menu.id));
}
function placeMenu(index) { const label = nav.children[index]; if (!label) return; const maxLeft = Math.max(0, window.innerWidth - dropdown.offsetWidth); dropdown.style.left = `${Math.min(nav.offsetLeft + label.offsetLeft, maxLeft)}px`; }
function apply(action) {
  const result = transitionMenu(state, action);
  state = result.state;
  if (result.labelsChanged) renderLabels(); else syncLabels();
  if (result.refreshMenu) renderDropdown();
  if (result.focusMenu) labelFor(result.focusMenu)?.focus();
  for (const call of result.calls) api[call.method](...(call.id === undefined ? [] : [call.id]));
}

api.receiveState(next => {
  viewState = { ...viewState, ...next };
  bar.classList.toggle("mac", viewState.mac);
  document.querySelector('[data-action="maximize"]').classList.toggle("is-maximized", viewState.maximized);
  document.getElementById("profile").hidden = !viewState.profileName;
  document.getElementById("profile").textContent = viewState.profileName ?? "";
  document.getElementById("profile").title = viewState.profileName ?? "";
  document.getElementById("cheats").hidden = !viewState.cheatsEnabled;
  const update = document.getElementById("update");
  update.hidden = !viewState.update;
  if (viewState.update) {
    const percent = Math.round(viewState.update.received / viewState.update.total * 100);
    document.getElementById("update-version").textContent = viewState.update.version;
    document.getElementById("update-fill").style.width = `${percent}%`;
    update.setAttribute("aria-label", `Update ${viewState.update.version}: ${percent}%`);
  }
  document.querySelector(".mac-title")?.remove();
  if (viewState.mac) { const title = document.createElement("div"); title.className = "mac-title"; title.textContent = "PokeRogue Electron"; bar.append(title); }
  if ("menus" in next) apply({ type: "state-push", menus: next.menus });
  if (next.openMenu) { pendingAlt = state.menus.length === 0; if (!pendingAlt) apply({ type: "alt" }); }
  else if (pendingAlt && state.menus.length) { pendingAlt = false; apply({ type: "alt" }); }
});
bar.addEventListener("click", event => { const button = event.target.closest("button"); const action = button?.dataset.action; if (button?.id === "update") api.openUpdate(); if (action === "minimize") api.minimize(); if (action === "maximize") api.toggleMaximize(); if (action === "close") api.close(); });
document.addEventListener("pointerdown", event => { if (state.open !== null && !dropdown.contains(event.target) && !nav.contains(event.target)) apply({ type: "outside" }); });
document.addEventListener("keydown", event => {
  if (event.key === "Alt" && !viewState.mac) { event.preventDefault(); apply({ type: "alt" }); labelFor(state.open)?.focus(); return; }
  if (event.key === "Escape" && state.open !== null && !viewState.mac) api.escape();
  if (state.open === null) return;
  if (event.key === "Escape" || event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") {
    event.preventDefault(); apply({ type: event.key });
    if (event.key === "ArrowDown" || event.key === "ArrowUp") syncActiveItem(true);
  }
});
window.addEventListener("resize", () => { if (state.open !== null) placeMenu(menuIndex(state.open)); });
