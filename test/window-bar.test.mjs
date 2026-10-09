import test from "node:test";
import assert from "node:assert/strict";
import { activateMenuItem, calculateViewBounds, serializeMenuTemplate, trackLoneAlt } from "../src/window-bar.mjs";
import { transitionMenu } from "../src/bar-window/menu-state.mjs";

const menus = [
  { id: "one", label: "Game", items: [{ id: "a", enabled: true }, { id: "sep", type: "separator" }, { id: "heading", type: "header" }, { id: "b", enabled: true }, { id: "off", enabled: false }, { id: "d", enabled: true }] },
  { id: "two", label: "View", items: [{ id: "x", enabled: true }] },
];
const closedMenu = { menus, open: null, activeItem: null };
const step = (state, type, details = {}) => transitionMenu(state, { type, ...details });

test("menu serialization keeps stable ids, item kinds, shortcuts, and no functions", () => {
  const template = [
    { label: "Game", submenu: [{ label: "Reload", accelerator: "CommandOrControl+R", click() {} }, { type: "separator" }, { label: "OPENS IN BROWSER", enabled: false, header: true }, { label: "Default", type: "radio", checked: true }] },
    { label: "Other", submenu: [{ role: "quit" }] },
  ];
  const first = serializeMenuTemplate(template, "win32");
  assert.deepEqual(serializeMenuTemplate(template, "win32"), first);
  assert.equal(new Set(first.flatMap(menu => [menu.id, ...menu.items.map(item => item.id)])).size, 7);
  assert.equal(first[0].items[0].shortcut, "Ctrl+R");
  assert.equal(first[1].items[0].shortcut, "Alt+F4");
  assert.equal(serializeMenuTemplate([{ label: "Game", submenu: [{ label: "Web", accelerator: "CommandOrControl+Shift+W" }] }], "darwin")[0].items[0].shortcut, "⌘⇧W");
  assert.deepEqual(first[0].items.slice(1, 4).map(item => item.type), ["separator", "header", "radio"]);
  assert.equal(first[0].items[3].checked, true);
  assert.equal(JSON.stringify(first).includes("click"), false);
  assert.equal(serializeMenuTemplate(template, "darwin")[0].items[0].shortcut, "⌘R");
});

test("menu activation resolves the current item and ignores invalid requests", () => {
  let calls = 0;
  const template = [{ id: "game", submenu: [
    { id: "run", click() { calls++; } }, { id: "off", enabled: false, click() { calls++; } },
    { id: "sep", type: "separator" }, { id: "heading", header: true }, { id: "quit", role: "quit" },
  ] }];
  const activate = (id, senderId = 7) => activateMenuItem({ template, id, senderId, barId: 7 });
  assert.equal(activate("run"), true);
  assert.equal(activate("quit"), "quit");
  assert.equal(activate("missing"), false);
  assert.equal(activate("off"), false);
  assert.equal(activate("sep"), false);
  assert.equal(activate("heading"), false);
  assert.equal(activate("run", 9), false);
  assert.equal(calls, 1);
});

test("view layout covers normal, menu, fullscreen, and minimum windows", () => {
  assert.deepEqual(calculateViewBounds(1280, 800, false, false), { bar: { x: 0, y: 0, width: 1280, height: 48 }, game: { x: 0, y: 48, width: 1280, height: 752 }, barVisible: true });
  assert.deepEqual(calculateViewBounds(1280, 800, false, true), { bar: { x: 0, y: 0, width: 1280, height: 800 }, game: { x: 0, y: 48, width: 1280, height: 752 }, barVisible: true });
  assert.deepEqual(calculateViewBounds(1280, 800, true, true), { bar: { x: 0, y: 0, width: 1280, height: 0 }, game: { x: 0, y: 0, width: 1280, height: 800 }, barVisible: false });
  assert.deepEqual(calculateViewBounds(800, 600, false, false), { bar: { x: 0, y: 0, width: 800, height: 48 }, game: { x: 0, y: 48, width: 800, height: 552 }, barVisible: true });
});

test("only an unmodified Alt press and release activates the bar", () => {
  let result = trackLoneAlt(false, { type: "keyDown", key: "Alt" });
  assert.deepEqual(result, { pending: true, activate: false });
  result = trackLoneAlt(result.pending, { type: "keyUp", key: "Alt" });
  assert.deepEqual(result, { pending: false, activate: true });

  result = trackLoneAlt(false, { type: "keyDown", key: "Alt" });
  result = trackLoneAlt(result.pending, { type: "keyDown", key: "F4", alt: true });
  assert.deepEqual(result, { pending: false, activate: false });
  assert.deepEqual(trackLoneAlt(false, { type: "keyDown", key: "Alt", shift: true }), { pending: false, activate: false });
});

test("menu clicks and outside dismissal have one open or close transition", () => {
  let result = step(closedMenu, "click-label", { menuId: "one" });
  assert.equal(result.state.open, "one");
  assert.deepEqual(result.calls, [{ method: "menuOpened" }]);
  result = step(result.state, "click-label", { menuId: "one" });
  assert.equal(result.state.open, null);
  assert.deepEqual(result.calls, [{ method: "menuClosed" }]);

  result = step(closedMenu, "click-label", { menuId: "one" });
  result = step(result.state, "click-label", { menuId: "two" });
  assert.equal(result.state.open, "two");
  assert.deepEqual(result.calls, []);
  result = step(result.state, "hover-label", { menuId: "one" });
  assert.equal(result.state.open, "one");
  assert.deepEqual(result.calls, []);
  result = step(result.state, "outside");
  assert.equal(result.state.open, null);
  assert.deepEqual(result.calls, [{ method: "menuClosed" }]);
  assert.deepEqual(step(result.state, "escape").calls, []);
});

test("Escape, item selection, and menu state pushes preserve bridge state", () => {
  let result = step(closedMenu, "click-label", { menuId: "one" });
  const pushedMenus = menus.map(menu => menu.id === "one" ? { ...menu, items: menu.items.map(item => item.id === "b" ? { ...item, label: "Updated" } : item) } : menu);
  result = step(result.state, "state-push", { menus: pushedMenus });
  assert.equal(result.state.open, "one");
  assert.equal(result.state.activeItem, "a");
  assert.equal(result.refreshMenu, true);
  assert.equal(result.labelsChanged, false);
  assert.deepEqual(result.calls, []);

  result = step(result.state, "pick-item", { itemId: "off" });
  assert.equal(result.state.open, "one");
  assert.deepEqual(result.calls, []);
  result = step(result.state, "pick-item", { itemId: "b" });
  assert.equal(result.state.open, null);
  assert.deepEqual(result.calls, [{ method: "activateItem", id: "b" }, { method: "menuClosed" }]);
  result = step(closedMenu, "click-label", { menuId: "one" });
  result = step(result.state, "escape");
  assert.equal(result.state.open, null);
  assert.deepEqual(result.calls, [{ method: "menuClosed" }]);
});

test("Alt and keyboard navigation focus menus and skip separators and headers", () => {
  let result = step(closedMenu, "alt");
  assert.equal(result.state.open, "one");
  assert.equal(result.state.activeItem, "a");
  assert.equal(result.focusMenu, "one");
  assert.deepEqual(result.calls, [{ method: "menuOpened" }]);

  result = step(result.state, "ArrowDown");
  assert.equal(result.state.activeItem, "b");
  result = step(result.state, "ArrowDown");
  assert.equal(result.state.activeItem, "d");
  result = step(result.state, "ArrowDown");
  assert.equal(result.state.activeItem, "a");
  result = step(result.state, "ArrowUp");
  assert.equal(result.state.activeItem, "d");
  result = step(result.state, "ArrowRight");
  assert.equal(result.state.open, "two");
  assert.equal(result.state.activeItem, "x");
  assert.equal(result.focusMenu, "two");
  result = step(result.state, "ArrowLeft");
  assert.equal(result.state.open, "one");
  result = step(result.state, "Enter");
  assert.equal(result.state.open, null);
  assert.deepEqual(result.calls, [{ method: "activateItem", id: "a" }, { method: "menuClosed" }]);
});
