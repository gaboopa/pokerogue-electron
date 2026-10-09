import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { CHART_UTILITIES, WEB_UTILITIES, createUtilitiesSubmenu } from "../src/utilities.mjs";
import { createMenuTemplate } from "../src/menu.mjs";


test("web utility URLs use HTTPS", () => {
  for (const utility of WEB_UTILITIES) assert.equal(new URL(utility.url).protocol, "https:");
});

test("utility menu delegates web links and chart windows separately", () => {
  const calls = []; const menu = createUtilitiesSubmenu({ openExternal: url => calls.push(["external", url]), openChart: chart => calls.push(["chart", chart.id]) });
  menu[0].click(); menu.at(-1).click(); assert.deepEqual(calls, [["external", WEB_UTILITIES[0].url], ["chart", "horizontal-type-chart"]]);
});

test("Tools groups web utilities, charts, and keybindings under disabled headers", () => {
  const utilities = createUtilitiesSubmenu({ openExternal() {}, openChart() {} });
  const keybindings = [
    { label: "Open Keybindings File…", click() {} },
    { label: "Reload Keybindings", click() {} },
    { label: "Reset to Defaults", click() {} },
  ];
  const menu = createMenuTemplate({
    isMac: false, productName: "PokeRogue Electron", utilities, keybindings,
    cheats: [{ label: "Configure Cheats…" }],
  });
  const tools = menu.find(item => item.label === "Tools").submenu;
  const headers = tools.filter(item => item.header);
  assert.deepEqual(headers.map(item => item.label), ["OPENS IN BROWSER", "OFFLINE", "KEYBINDINGS"]);
  assert.ok(headers.every(item => item.enabled === false));
  const sections = [
    tools.slice(1, tools.indexOf(headers[1]) - 1),
    tools.slice(tools.indexOf(headers[1]) + 1, tools.indexOf(headers[2]) - 1),
    tools.slice(tools.indexOf(headers[2]) + 1),
  ];
  assert.deepEqual(sections[0].map(item => item.label), WEB_UTILITIES.map(item => item.label));
  assert.deepEqual(sections[1].map(item => item.label), CHART_UTILITIES.map(item => item.label));
  assert.deepEqual(sections[2].map(item => item.label), keybindings.map(item => item.label));
  assert.deepEqual(tools.filter(item => item.accelerator).map(item => item.accelerator), [...WEB_UTILITIES, ...CHART_UTILITIES].map(item => item.accelerator));
});

test("both type charts and their packaged notice exist", async () => {
  for (const chart of CHART_UTILITIES) await access(new URL(`../src/assets/${chart.asset}`, import.meta.url));
  assert.match(await readFile(new URL("../src/assets/NOTICE.md", import.meta.url), "utf8"), /MIT License/);
});
