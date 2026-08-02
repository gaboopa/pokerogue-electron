const booleanIds = ["enabled", "disableLevelCap", "freeShopPurchases", "freeRerolls", "forceRetries", "guaranteedEscape", "perfectIvs", "playerShiny", "enemyShiny", "instantEggHatch", "freeGacha", "guaranteedCriticals"];
const numericIds = ["minimumMoney", "xpMultiplier", "extraCandy"];
const ballIds = ["poke", "great", "ultra", "rogue", "master"];
const byId = id => document.getElementById(id);
const bridge = window.cheatControl;

function render(config) {
  for (const id of booleanIds) byId(id).checked = config[id];
  for (const id of numericIds) byId(id).value = config[id];
  for (const id of ballIds) byId(id).value = config.pokeballs[id];
  byId("state").textContent = config.enabled ? "CHEATS ACTIVE" : "VANILLA";
  byId("state").classList.toggle("active", config.enabled);
}

function collect() {
  return {
    ...Object.fromEntries(booleanIds.map(id => [id, byId(id).checked])),
    ...Object.fromEntries(numericIds.map(id => [id, Number(byId(id).value)])),
    pokeballs: Object.fromEntries(ballIds.map(id => [id, Number(byId(id).value)])),
  };
}

async function run(action) {
  document.body.classList.add("busy"); byId("message").textContent = "";
  try { const result = await action(); if (result?.config) render(result.config); if (result?.reason === "cancelled") byId("message").textContent = "No changes were applied."; }
  catch (error) { byId("message").textContent = error.message; }
  finally { document.body.classList.remove("busy"); }
}

byId("maximum").addEventListener("click", () => run(async () => bridge.load().then(value => (render(value.maximum), value.maximum))));
byId("reset").addEventListener("click", () => run(() => bridge.reset()));
byId("apply").addEventListener("click", () => run(() => bridge.applyConfig(collect())));
byId("cancel").addEventListener("click", () => bridge.close());
byId("enabled").addEventListener("change", () => render({ ...collect(), enabled: byId("enabled").checked }));
if (bridge) run(() => bridge.load());
else {
  byId("message").textContent = "Cheat controls failed to initialize. Close this window and reopen it from the Cheats menu.";
  document.body.classList.add("busy");
}
