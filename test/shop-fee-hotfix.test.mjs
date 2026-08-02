import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixShopFeeOverrides } from "../scripts/fix-shop-fee-overrides.mjs";

test("staged shop display and purchased moves do not inherit free rerolls", async t => {
  const root = await mkdtemp(join(tmpdir(), "shop-fee-fix-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "assets"));
  const path = join(root, "assets", "battle-scene-test.js");
  await writeFile(path, "S.WAIVE_ROLL_FEE_OVERRIDE||(z.money-=this.cost);updateCostText(){let e=S.WAIVE_ROLL_FEE_OVERRIDE?0:this.modifierTypeOption.cost}S.WAIVE_ROLL_FEE_OVERRIDE||(z.money-=e);if(S.WAIVE_ROLL_FEE_OVERRIDE)return t");
  const result = await fixShopFeeOverrides(root);
  assert.deepEqual({ learnMoveRepairs: result.learnMoveRepairs, costDisplayRepairs: result.costDisplayRepairs }, { learnMoveRepairs: 1, costDisplayRepairs: 1 });
  const fixed = await readFile(path, "utf8");
  assert.equal((fixed.match(/WAIVE_SHOP_FEES_OVERRIDE/g) ?? []).length, 2);
  assert.equal((fixed.match(/WAIVE_ROLL_FEE_OVERRIDE/g) ?? []).length, 2);
});
