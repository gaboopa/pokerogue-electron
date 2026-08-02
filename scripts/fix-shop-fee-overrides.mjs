import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function fixShopFeeOverrides(gameRoot) {
  const assets = resolve(gameRoot, "assets");
  const battleFiles = (await readdir(assets)).filter(name => /^battle-scene-.*\.js$/.test(name));
  if (battleFiles.length !== 1) throw new Error(`Expected one battle-scene bundle, found ${battleFiles.length}.`);
  const path = resolve(assets, battleFiles[0]);
  const original = await readFile(path, "utf8");

  const learnMovePattern = /([A-Za-z_$][\w$]*\.WAIVE_ROLL_FEE_OVERRIDE)(\|\|\([^)]*\.money-=this\.cost)/g;
  const costDisplayPattern = /(updateCostText\(\)\{let [A-Za-z_$][\w$]*=)([A-Za-z_$][\w$]*\.WAIVE_ROLL_FEE_OVERRIDE)(\?0:this\.modifierTypeOption\.cost)/g;
  let learnMoveRepairs = 0;
  let costDisplayRepairs = 0;
  let fixed = original.replace(learnMovePattern, (_match, override, suffix) => {
    learnMoveRepairs++;
    return `${override.replace("WAIVE_ROLL_FEE_OVERRIDE", "WAIVE_SHOP_FEES_OVERRIDE")}${suffix}`;
  });
  fixed = fixed.replace(costDisplayPattern, (_match, prefix, override, suffix) => {
    costDisplayRepairs++;
    return `${prefix}${override.replace("WAIVE_ROLL_FEE_OVERRIDE", "WAIVE_SHOP_FEES_OVERRIDE")}${suffix}`;
  });
  if (learnMoveRepairs !== 1 || costDisplayRepairs !== 1) {
    throw new Error(`Refusing unexpected bundle: repaired ${learnMoveRepairs} move deductions and ${costDisplayRepairs} price displays.`);
  }
  await writeFile(path, fixed, "utf8");
  return { path, learnMoveRepairs, costDisplayRepairs };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  const gameRoot = process.argv[2];
  if (!gameRoot) throw new Error("Usage: node scripts/fix-shop-fee-overrides.mjs <game-root>");
  console.log(await fixShopFeeOverrides(gameRoot));
}
