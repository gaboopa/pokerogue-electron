import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerGameProtocol, resolveGameRequest } from "../src/protocol.mjs";

test("app protocol resolves files but rejects traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-protocol-"));
  await writeFile(join(root, "index.html"), "ok");
  assert.equal(resolveGameRequest(root, "app://game/"), join(root, "index.html"));
  assert.equal(resolveGameRequest(root, "app://game/../../secret"), null);
});

test("app protocol permits same-origin asset fetches without permitting web origins", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-protocol-csp-"));
  await writeFile(join(root, "asset.json"), "{}");
  let handler;
  registerGameProtocol({ handle(scheme, value) { assert.equal(scheme, "app"); handler = value; } }, root);

  const response = await handler(new Request("app://game/asset.json"));
  const policy = response.headers.get("content-security-policy");
  assert.match(policy, /connect-src 'self'/);
  assert.doesNotMatch(policy, /connect-src[^;]*https?:/);
  assert.equal(await response.text(), "{}");
});
