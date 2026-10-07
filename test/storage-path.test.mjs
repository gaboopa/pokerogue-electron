import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCT_NAME, STORAGE_DIRECTORY_NAME } from "../src/constants.mjs";
import { getUserDataPath } from "../src/storage-path.mjs";

test("userData stays in the legacy storage folder independently of the product name", () => {
  const appDataPath = join("temporary", "application-data");
  assert.equal(getUserDataPath(appDataPath), join(appDataPath, "PokeRogue Offline"));
  assert.equal(PRODUCT_NAME, "PokeRogue Electron");
  assert.equal(STORAGE_DIRECTORY_NAME, "PokeRogue Offline");
  assert.notEqual(PRODUCT_NAME, STORAGE_DIRECTORY_NAME);
});

test("release identity and artifact names remain unchanged", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.build.appId, "com.gaboopa.pokerogueoffline");
  assert.equal(packageJson.build.win.artifactName, "PokeRogue-Offline-${version}-windows-x64.${ext}");
  assert.equal(packageJson.build.mac.artifactName, "PokeRogue-Offline-${version}-macos-arm64.${ext}");
});
