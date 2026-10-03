import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const electron = resolve(root, "node_modules/electron/dist/electron.exe");
const probe = join(root, "test/helpers/keyboard-probe.cjs");

function runProbe(profile, resultPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(electron, [probe, profile, resultPath], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => child.kill(), 18000);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Electron probe exited ${code ?? signal}: ${stderr}`));
      else resolvePromise();
    });
  });
}

test("the sandboxed shipped preload sends numeric keyCode values for native remaps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pokerogue-keyboard-"));
  const profile = join(directory, "profile");
  const resultPath = join(directory, "result.json");
  try {
    await runProbe(profile, resultPath);
    const { observations } = JSON.parse(await readFile(resultPath, "utf8"));
    assert.deepEqual(observations.named.map(({ key, keyCode, type, trusted }) => ({ key, keyCode, type, trusted })), [
      { key: "ArrowUp", keyCode: 38, type: "keydown", trusted: false },
      { key: "ArrowUp", keyCode: 38, type: "keyup", trusted: false },
    ]);
    assert.deepEqual(observations.letter.map(({ keyCode, type }) => ({ keyCode, type })), [
      { keyCode: 65, type: "keydown" }, { keyCode: 65, type: "keyup" },
    ]);
    assert.deepEqual(observations.digit.map(({ keyCode, type }) => ({ keyCode, type })), [
      { keyCode: 32, type: "keydown" }, { keyCode: 32, type: "keyup" },
    ]);
    assert.equal(observations.repeat.filter((event) => event.type === "keydown").length, 2);
    assert.equal(observations.repeat.find((event) => event.repeat)?.keyCode, 38);
    assert.deepEqual(observations.mappingChange.map(({ type, keyCode }) => ({ type, keyCode })), [
      { type: "keydown", keyCode: 38 }, { type: "keyup", keyCode: 38 },
    ]);
    assert.deepEqual(observations.sharedTarget.map(({ type, keyCode }) => ({ type, keyCode })), [
      { type: "keydown", keyCode: 38 }, { type: "keyup", keyCode: 38 },
    ]);
    assert.ok(observations.identity.every((event) => event.trusted && event.keyCode === 87));
    assert.ok(observations.modifier.some((event) => event.trusted && event.key === "a" && event.ctrlKey));
    assert.equal(observations.modifier.some((event) => event.keyCode === 38), false);
    assert.deepEqual(observations.blur.map(({ type, keyCode }) => ({ type, keyCode })), [
      { type: "keydown", keyCode: 38 }, { type: "keyup", keyCode: 38 },
    ]);
    for (const name of ["named", "letter", "digit", "repeat", "mappingChange", "sharedTarget", "identity", "modifier", "blur"]) {
      assert.deepEqual(observations[`${name}Pressed`], [], `${name} leaves no pressed keys`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
