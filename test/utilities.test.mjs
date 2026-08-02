import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { CHART_UTILITIES, WEB_UTILITIES, createUtilitiesSubmenu } from "../src/utilities.mjs";

test("utility destinations and safer accelerators remain fixed", () => {
  assert.deepEqual(WEB_UTILITIES.map(({ label, accelerator, url }) => [label, accelerator, url]), [
    ["Wiki", "CommandOrControl+Shift+W", "https://wiki.pokerogue.net/"], ["Pokédex", "CommandOrControl+Shift+D", "https://wiki.pokerogue.net/dex:pokedex"],
    ["SearchDex", "CommandOrControl+Shift+E", "https://sandstormer.github.io/PokeRogue-Dex/"], ["Type Calculator", "CommandOrControl+Shift+T", "https://www.pkmn.help/"],
    ["Team Builder", "CommandOrControl+Shift+B", "https://marriland.com/tools/team-builder/"], ["Smogon", "CommandOrControl+Shift+S", "https://www.smogon.com/dex/sv/pokemon/"],
  ]);
  assert.deepEqual(CHART_UTILITIES.map(({ accelerator }) => accelerator), ["CommandOrControl+Shift+Y", "CommandOrControl+Shift+H"]);
  for (const utility of WEB_UTILITIES) assert.equal(new URL(utility.url).protocol, "https:");
});

test("utility menu delegates web links and chart windows separately", () => {
  const calls = []; const menu = createUtilitiesSubmenu({ openExternal: url => calls.push(["external", url]), openChart: chart => calls.push(["chart", chart.id]) });
  menu[0].click(); menu.at(-1).click(); assert.deepEqual(calls, [["external", WEB_UTILITIES[0].url], ["chart", "horizontal-type-chart"]]);
});

test("both type charts and their packaged notice exist", async () => {
  for (const chart of CHART_UTILITIES) await access(new URL(`../src/assets/${chart.asset}`, import.meta.url));
  assert.match(await readFile(new URL("../src/assets/NOTICE.md", import.meta.url), "utf8"), /MIT License/);
});

test("main process keeps chart windows sandboxed and web utilities external", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(main, /shell\.openExternal\(url\)/);
  assert.match(main, /webPreferences: \{ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true \}/);
  assert.match(main, /scheme === "http:" \|\| scheme === "https:" \|\| scheme === "ws:" \|\| scheme === "wss:"/);
  assert.doesNotMatch(main, /loadURL\(['"]https:/);
});
