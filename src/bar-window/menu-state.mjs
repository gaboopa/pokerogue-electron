const menuById = (menus, id) => menus.find(menu => menu.id === id);
const selectable = menu => (menu?.items ?? []).filter(item => item.type !== "separator" && item.type !== "header" && item.enabled !== false);
const sameLabels = (left, right) => left.length === right.length && left.every((menu, index) => menu.id === right[index].id && menu.label === right[index].label);
const firstItem = menu => selectable(menu)[0]?.id ?? null;

export function transitionMenu(state, action) {
  const result = { state, calls: [], labelsChanged: false, refreshMenu: false, focusMenu: null };
  const menus = state.menus;
  const close = () => {
    if (state.open === null) return;
    result.state = { ...result.state, open: null, activeItem: null };
    result.calls.push({ method: "menuClosed" });
    result.refreshMenu = true;
  };
  const open = id => {
    const menu = menuById(result.state.menus, id);
    if (!menu) return;
    const changed = result.state.open !== id;
    result.state = { ...result.state, open: id, activeItem: changed ? firstItem(menu) : result.state.activeItem };
    if (changed && state.open === null) result.calls.push({ method: "menuOpened" });
    result.refreshMenu ||= changed;
  };

  if (action.type === "state-push") {
    const nextMenus = action.menus ?? menus;
    result.labelsChanged = !sameLabels(menus, nextMenus);
    const wasOpen = state.open !== null;
    const nextMenu = menuById(nextMenus, state.open);
    if (wasOpen && !nextMenu) {
      close();
      result.state = { ...result.state, menus: nextMenus };
      result.labelsChanged = !sameLabels(menus, nextMenus);
    } else {
      let activeItem = state.activeItem;
      if (nextMenu && !selectable(nextMenu).some(item => item.id === activeItem)) activeItem = firstItem(nextMenu);
      result.state = { ...state, menus: nextMenus, activeItem };
      result.refreshMenu = wasOpen;
    }
    return result;
  }

  if (action.type === "alt") {
    const first = menus[0];
    if (first) { open(first.id); result.focusMenu = first.id; if (state.open === null) result.calls = [{ method: "menuOpened" }]; }
  } else if (action.type === "click-label") {
    if (state.open === action.menuId) close();
    else { open(action.menuId); result.focusMenu = action.menuId; }
  } else if (action.type === "hover-label") {
    if (state.open !== null && state.open !== action.menuId) open(action.menuId);
  } else if (action.type === "outside" || action.type === "escape") {
    close();
  } else if (action.type === "pick-item") {
    const item = selectable(menuById(menus, state.open)).find(candidate => candidate.id === action.itemId);
    if (item) { result.calls.push({ method: "activateItem", id: item.id }); close(); }
  } else if (action.type === "hover-item") {
    if (selectable(menuById(menus, state.open)).some(item => item.id === action.itemId)) result.state = { ...state, activeItem: action.itemId };
  } else if (state.open !== null && (action.type === "ArrowLeft" || action.type === "ArrowRight")) {
    const index = menus.findIndex(menu => menu.id === state.open);
    const next = menus[(index + (action.type === "ArrowRight" ? 1 : menus.length - 1)) % menus.length];
    if (next) { open(next.id); result.focusMenu = next.id; }
  } else if (state.open !== null && (action.type === "ArrowUp" || action.type === "ArrowDown")) {
    const items = selectable(menuById(menus, state.open));
    if (items.length) {
      const index = items.findIndex(item => item.id === state.activeItem);
      const next = (index + (action.type === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      result.state = { ...state, activeItem: items[next].id };
    }
  } else if (state.open !== null && action.type === "Enter") {
    if (state.activeItem) {
      result.calls.push({ method: "activateItem", id: state.activeItem });
      close();
    }
  }
  return result;
}
