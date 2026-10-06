import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { CHART_UTILITIES, WEB_UTILITIES, createUtilitiesSubmenu } from "../src/utilities.mjs";


test("web utility URLs use HTTPS", () => {
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
