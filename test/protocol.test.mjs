import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveGameRequest } from "../src/protocol.mjs";

test("app protocol resolves files but rejects traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-protocol-"));
  await writeFile(join(root, "index.html"), "ok");
  assert.equal(resolveGameRequest(root, "app://game/"), join(root, "index.html"));
  assert.equal(resolveGameRequest(root, "app://game/../../secret"), null);
});
