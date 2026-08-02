import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const CHEAT_SCHEMA_VERSION = 1;
export const NEUTRAL_CHEATS = Object.freeze({
  enabled: false,
  minimumMoney: 0,
  xpMultiplier: 1,
  disableLevelCap: false,
  freeShopPurchases: false,
  freeRerolls: false,
  pokeballs: Object.freeze({ poke: 0, great: 0, ultra: 0, rogue: 0, master: 0 }),
  forceRetries: false,
  guaranteedEscape: false,
  perfectIvs: false,
  playerShiny: false,
  enemyShiny: false,
  instantEggHatch: false,
  freeGacha: false,
  extraCandy: 0,
  guaranteedCriticals: false,
});

export const MAXIMUM_FUN_CHEATS = Object.freeze({
  ...NEUTRAL_CHEATS,
  enabled: true,
  minimumMoney: 1_000_000,
  xpMultiplier: 10,
  disableLevelCap: true,
  freeShopPurchases: true,
  freeRerolls: true,
  pokeballs: Object.freeze({ poke: 99, great: 99, ultra: 99, rogue: 99, master: 10 }),
  forceRetries: true,
  guaranteedEscape: true,
  perfectIvs: true,
  playerShiny: true,
  enemyShiny: true,
  instantEggHatch: true,
  freeGacha: true,
  extraCandy: 10,
  guaranteedCriticals: true,
});

const booleanKeys = ["enabled", "disableLevelCap", "freeShopPurchases", "freeRerolls", "forceRetries", "guaranteedEscape", "perfectIvs", "playerShiny", "enemyShiny", "instantEggHatch", "freeGacha", "guaranteedCriticals"];
const integer = (value, fallback, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;

export function validateCheatConfig(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = structuredClone(NEUTRAL_CHEATS);
  for (const key of booleanKeys) result[key] = typeof input[key] === "boolean" ? input[key] : NEUTRAL_CHEATS[key];
  result.minimumMoney = integer(input.minimumMoney, 0, 0, 999_999_999);
  result.xpMultiplier = integer(input.xpMultiplier, 1, 1, 100);
  result.extraCandy = integer(input.extraCandy, 0, 0, 100);
  const balls = input.pokeballs && typeof input.pokeballs === "object" && !Array.isArray(input.pokeballs) ? input.pokeballs : {};
  for (const key of Object.keys(result.pokeballs)) result.pokeballs[key] = integer(balls[key], 0, 0, 999);
  return result;
}

export function emptyCheatDocument() {
  return { schemaVersion: CHEAT_SCHEMA_VERSION, config: structuredClone(NEUTRAL_CHEATS), usage: { everEnabled: false, lastEnabledAt: null, lastAppliedAt: null, applyCount: 0 } };
}

export async function loadCheatDocument(path) {
  try {
    const stored = JSON.parse(await readFile(path, "utf8"));
    const base = emptyCheatDocument();
    return {
      schemaVersion: CHEAT_SCHEMA_VERSION,
      config: validateCheatConfig(stored.config),
      usage: {
        everEnabled: stored.usage?.everEnabled === true,
        lastEnabledAt: typeof stored.usage?.lastEnabledAt === "string" ? stored.usage.lastEnabledAt : null,
        lastAppliedAt: typeof stored.usage?.lastAppliedAt === "string" ? stored.usage.lastAppliedAt : null,
        applyCount: integer(stored.usage?.applyCount, base.usage.applyCount, 0, Number.MAX_SAFE_INTEGER),
      },
    };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return emptyCheatDocument();
    throw error;
  }
}

export async function writeCheatDocument(path, document) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function applyCheatConfiguration({ path, requested, confirm, backup, relaunch, now = () => new Date() }) {
  const current = await loadCheatDocument(path);
  const config = validateCheatConfig(requested);
  if (current.config.enabled || config.enabled) {
    if (!await confirm(current.config, config)) return { applied: false, reason: "cancelled" };
    await backup();
  }
  const timestamp = now().toISOString();
  const document = {
    schemaVersion: CHEAT_SCHEMA_VERSION,
    config,
    usage: {
      everEnabled: current.usage.everEnabled || config.enabled,
      lastEnabledAt: config.enabled ? timestamp : current.usage.lastEnabledAt,
      lastAppliedAt: timestamp,
      applyCount: current.usage.applyCount + 1,
    },
  };
  await writeCheatDocument(path, document);
  await relaunch();
  return { applied: true, document };
}
