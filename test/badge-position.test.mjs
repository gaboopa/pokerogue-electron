import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const preload = await readFile(new URL("../src/preload-cheats.cjs", import.meta.url), "utf8");

test("the active-cheats badge stays clear of the top-right game UI", () => {
  assert.match(preload, /getElementById\("desktop-cheats-active"\)/);
  assert.match(preload, /badge\.style\.left = "8px"/);
  assert.match(preload, /badge\.style\.right = "auto"/);
});
