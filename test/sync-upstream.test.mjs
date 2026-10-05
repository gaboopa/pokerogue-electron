import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
let fixtureNumber = 0;

async function run(executable, args, options = {}) {
  return execFileAsync(executable, args, { cwd: options.cwd, env: options.env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

async function git(cwd, ...args) {
  const { stdout } = await run("git", args, { cwd });
  return stdout.trim();
}

async function createFixture(root, { failValidation = false, conflict = false, dirtyRepository = "" } = {}) {
  const name = failValidation ? "failing" : conflict ? "conflicting" : "successful";
  const fixtureRoot = join(root, `${name} fixture ${++fixtureNumber}`);
  const wrapperRoot = join(fixtureRoot, "wrapper repository with spaces");
  const gameRoot = join(fixtureRoot, "upstream game repository with spaces");
  const remoteRoot = join(fixtureRoot, "upstream remote.git");
  const logPath = join(fixtureRoot, "command log.txt");
  const scripts = join(wrapperRoot, "scripts");
  const tests = join(wrapperRoot, "test");

  await mkdir(scripts, { recursive: true });
  await mkdir(tests, { recursive: true });
  await copyFile(join(repositoryRoot, "scripts", "sync-upstream.mjs"), join(scripts, "sync-upstream.mjs"));
  await copyFile(join(repositoryRoot, "scripts", "lib.mjs"), join(scripts, "lib.mjs"));
  await copyFile(join(repositoryRoot, "scripts", "build-game.mjs"), join(scripts, "build-game.mjs"));
  await copyFile(join(repositoryRoot, "scripts", "staging-policy.mjs"), join(scripts, "staging-policy.mjs"));
  await copyFile(join(repositoryRoot, ".gitignore"), join(wrapperRoot, ".gitignore"));
  await writeFile(join(tests, "space-path.test.mjs"), `import assert from "node:assert/strict";\nimport { appendFileSync } from "node:fs";\nassert.ok(process.execPath.includes("Node runtime with spaces"));\nassert.ok(process.cwd().includes("wrapper repository with spaces"));\n${failValidation ? "assert.fail(\"fixture test failure\");\n" : ""}appendFileSync(process.env.SYNC_FIXTURE_LOG, "node-test\\n");\n`);
  await git(wrapperRoot, "init", "-b", "main");
  await git(wrapperRoot, "config", "user.name", "Sync fixture");
  await git(wrapperRoot, "config", "user.email", "sync-fixture@example.invalid");
  await git(wrapperRoot, "add", ".");
  await git(wrapperRoot, "commit", "-m", "create wrapper fixture");

  await mkdir(join(gameRoot, "assets", "logo"), { recursive: true });
  await mkdir(join(gameRoot, "locales", "en"), { recursive: true });
  await mkdir(join(gameRoot, "node_modules", "typescript", "bin"), { recursive: true });
  await mkdir(join(gameRoot, "node_modules", "vitest"), { recursive: true });
  await mkdir(join(gameRoot, "node_modules", "vite", "bin"), { recursive: true });
  await mkdir(join(gameRoot, "dist"), { recursive: true });
  await writeFile(join(gameRoot, ".gitignore"), "node_modules/\ndist/\n");
  await writeFile(join(gameRoot, "package.json"), JSON.stringify({ name: "fixture-game", version: "1.0.0", type: "module" }));
  await writeFile(join(gameRoot, "assets", "service-worker.js"), "self.addEventListener('install', () => {});\n");
  await writeFile(join(gameRoot, "assets", "logo512.png"), "fixture logo\n");
  await writeFile(join(gameRoot, "locales", "en", "fixture.txt"), "fixture locale\n");
  await writeFile(join(gameRoot, "dist", "index.html"), "<!doctype html><title>fixture</title>\n");
  await writeFile(join(gameRoot, "node_modules", "typescript", "bin", "tsc"), `import assert from "node:assert/strict";\nimport { appendFileSync } from "node:fs";\nassert.equal(process.cwd(), process.env.POKEROGUE_GAME_PATH);\nassert.equal(process.argv[2], "--noEmit");\nappendFileSync(process.env.SYNC_FIXTURE_LOG, "tsc\\n");\n`);
  await writeFile(join(gameRoot, "node_modules", "vitest", "vitest.mjs"), `import assert from "node:assert/strict";\nimport { appendFileSync } from "node:fs";\nassert.equal(process.cwd(), process.env.POKEROGUE_GAME_PATH);\nassert.deepEqual(process.argv.slice(2), ["run", "--silent=passed-only"]);\nappendFileSync(process.env.SYNC_FIXTURE_LOG, "vitest\\n");\n`);
  await writeFile(join(gameRoot, "node_modules", "vite", "bin", "vite.js"), `import assert from "node:assert/strict";\nimport { appendFileSync } from "node:fs";\nimport { mkdir, writeFile } from "node:fs/promises";\nimport { join } from "node:path";\nassert.equal(process.cwd(), process.env.POKEROGUE_GAME_PATH);\nassert.deepEqual(process.argv.slice(2), ["build", "--mode", "app"]);\nawait mkdir("dist", { recursive: true });\nawait writeFile(join("dist", "index.html"), "<!doctype html><main>staged fixture</main>\\n");\nawait writeFile(join("dist", "game.js"), "window.fixture = true;\\n");\nappendFileSync(process.env.SYNC_FIXTURE_LOG, "vite\\n");\n`);

  await git(gameRoot, "init", "-b", "main");
  await git(gameRoot, "config", "user.name", "Sync fixture");
  await git(gameRoot, "config", "user.email", "sync-fixture@example.invalid");
  await git(gameRoot, "add", ".");
  await git(gameRoot, "commit", "-m", "create game fixture");
  await git(gameRoot, "checkout", "-b", "beta");
  await writeFile(join(gameRoot, "package.json"), JSON.stringify({ name: "fixture-game", version: "2.0.0", type: "module" }));
  await git(gameRoot, "add", "package.json");
  await git(gameRoot, "commit", "-m", "upstream fixture revision");
  await git(fixtureRoot, "init", "--bare", remoteRoot);
  await git(gameRoot, "remote", "add", "upstream", remoteRoot);
  await git(gameRoot, "push", "upstream", "beta");
  await git(gameRoot, "checkout", "main");
  if (conflict) {
    await writeFile(join(gameRoot, "package.json"), JSON.stringify({ name: "fixture-game", version: "3.0.0", type: "module" }));
    await git(gameRoot, "add", "package.json");
    await git(gameRoot, "commit", "-m", "local fork change");
  }

  if (dirtyRepository === "wrapper") await writeFile(join(wrapperRoot, "local wrapper change.txt"), "uncommitted\n");
  if (dirtyRepository === "game") await writeFile(join(gameRoot, "local game change.txt"), "uncommitted\n");

  await mkdir(join(wrapperRoot, "staging", "old-build"), { recursive: true });
  await writeFile(join(wrapperRoot, "staging", "old-build", "stale.txt"), "must be removed by staging\n");

  const env = { ...process.env, POKEROGUE_GAME_PATH: gameRoot, SYNC_FIXTURE_WRAPPER_PATH: wrapperRoot, SYNC_FIXTURE_LOG: logPath };
  delete env.NODE_TEST_CONTEXT;
  const currentRevision = await git(gameRoot, "rev-parse", "HEAD");
  const upstreamRevision = await git(gameRoot, "rev-parse", "beta");
  return { wrapperRoot, gameRoot, logPath, currentRevision, upstreamRevision, env };
}

async function readReport(wrapperRoot) {
  const reportDirectory = join(wrapperRoot, ".local-build", "upstream-reports");
  const reports = await readdir(reportDirectory);
  assert.equal(reports.length, 1);
  const path = join(reportDirectory, reports[0]);
  return { path, content: await readFile(path, "utf8") };
}

test("upstream synchronization executes final Node validation safely through paths with spaces", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "sync fixture root ")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeDirectory = join(root, "Node runtime with spaces");
  const runtimePath = join(runtimeDirectory, basename(process.execPath));
  await mkdir(runtimeDirectory, { recursive: true });
  await copyFile(process.execPath, runtimePath);
  const version = await run(runtimePath, ["--version"]);
  assert.match(version.stdout, /^v\d+\./);

  const success = await createFixture(root);
  assert.deepEqual(await readdir(join(success.wrapperRoot, "test")), ["space-path.test.mjs"]);
  const directTest = await run(runtimePath, ["--test", join(success.wrapperRoot, "test", "space-path.test.mjs")], { cwd: success.wrapperRoot, env: success.env });
  assert.match(`${directTest.stdout}\n${directTest.stderr}`, /tests 1/);
  assert.equal((await readFile(success.logPath, "utf8")).trim(), "node-test");
  await writeFile(success.logPath, "");
  const syncScript = join(success.wrapperRoot, "scripts", "sync-upstream.mjs");
  const syncResult = await run(runtimePath, [syncScript], { cwd: success.wrapperRoot, env: success.env });
  const successLog = await readFile(success.logPath, "utf8");
  assert.deepEqual(successLog.trim().split(/\r?\n/), ["tsc", "vitest", "vite", "node-test"], syncResult.stdout);
  assert.match(await git(success.gameRoot, "branch", "--show-current"), /^updates\/upstream-/);
  assert.equal((await git(success.gameRoot, "branch", "--list", "backup/pre-upstream-*")) !== "", true);
  const successReport = await readReport(success.wrapperRoot);
  assert.equal(isAbsolute(successReport.path), true);
  assert.ok(syncResult.stdout.includes(successReport.path));
  assert.match(successReport.content, /Upstream synchronization report/);
  assert.ok(successReport.content.includes(success.currentRevision));
  assert.ok(successReport.content.includes(success.upstreamRevision));
  assert.match(successReport.content, /Original branch: `main`/);
  assert.match(successReport.content, /- `M\s+package\.json`/);
  assert.match(successReport.content, /## Watched changes[\s\S]*- `M\s+package\.json`/);
  assert.match(successReport.content, /## All changes[\s\S]*M\s+package\.json/);
  assert.ok((await git(success.wrapperRoot, "check-ignore", `.local-build/upstream-reports/${basename(successReport.path)}`)).length > 0);
  assert.equal(await readFile(join(success.wrapperRoot, "staging", "game", "index.html"), "utf8"), "<!doctype html><main>staged fixture</main>\n");
  assert.equal(await readFile(join(success.wrapperRoot, "staging", "game", "game.js"), "utf8"), "window.fixture = true;\n");
  assert.deepEqual((await readdir(join(success.wrapperRoot, "staging"))).sort(), ["game", "licenses", "revisions.json"]);
  await assert.rejects(readFile(join(success.wrapperRoot, "staging", "old-build", "stale.txt")), { code: "ENOENT" });
  const stagedRevisions = JSON.parse(await readFile(join(success.wrapperRoot, "staging", "revisions.json"), "utf8"));
  assert.equal(stagedRevisions.game, await git(success.gameRoot, "rev-parse", "HEAD"));
  assert.equal(stagedRevisions.assets, stagedRevisions.game);
  assert.equal(stagedRevisions.locales, stagedRevisions.game);

  const failure = await createFixture(root, { failValidation: true });
  const failingScript = join(failure.wrapperRoot, "scripts", "sync-upstream.mjs");
  await assert.rejects(run(runtimePath, [failingScript], { cwd: failure.wrapperRoot, env: failure.env }), error => {
    assert.notEqual(error.code, 0);
    assert.match(`${error.stdout}\n${error.stderr}`, /fixture test failure/);
    assert.ok(`${error.stdout}\n${error.stderr}`.includes(join(failure.wrapperRoot, ".local-build", "upstream-reports")));
    return true;
  });
  assert.deepEqual((await readFile(failure.logPath, "utf8")).trim().split(/\r?\n/), ["tsc", "vitest", "vite"]);
  assert.match(await git(failure.gameRoot, "branch", "--show-current"), /^updates\/upstream-/);
  const failureReport = await readReport(failure.wrapperRoot);
  assert.equal(isAbsolute(failureReport.path), true);
  assert.ok(failureReport.content.includes(failure.currentRevision));
  assert.ok(failureReport.content.includes(failure.upstreamRevision));
  assert.equal(await readFile(join(failure.wrapperRoot, "staging", "game", "game.js"), "utf8"), "window.fixture = true;\n");
  const failedStagedRevisions = JSON.parse(await readFile(join(failure.wrapperRoot, "staging", "revisions.json"), "utf8"));
  assert.equal(failedStagedRevisions.game, await git(failure.gameRoot, "rev-parse", "HEAD"));

  const conflict = await createFixture(root, { conflict: true });
  const conflictScript = join(conflict.wrapperRoot, "scripts", "sync-upstream.mjs");
  await assert.rejects(run(runtimePath, [conflictScript], { cwd: conflict.wrapperRoot, env: conflict.env }), error => {
    assert.match(`${error.stdout}\n${error.stderr}`, /merge has conflicts/);
    assert.ok(`${error.stdout}\n${error.stderr}`.includes(join(conflict.wrapperRoot, ".local-build", "upstream-reports")));
    return true;
  });
  const conflictReport = await readReport(conflict.wrapperRoot);
  assert.ok(conflictReport.content.includes(conflict.currentRevision));
  assert.ok(conflictReport.content.includes(conflict.upstreamRevision));
  assert.match(conflictReport.content, /Original branch: `main`/);
  assert.match(conflictReport.content, /## All changes[\s\S]*M\s+package\.json/);

  for (const repository of ["wrapper", "game"]) {
    const dirty = await createFixture(root, { dirtyRepository: repository });
    const dirtyScript = join(dirty.wrapperRoot, "scripts", "sync-upstream.mjs");
    await assert.rejects(run(runtimePath, [dirtyScript], { cwd: dirty.wrapperRoot, env: dirty.env }), error => {
      assert.match(`${error.stdout}\n${error.stderr}`, new RegExp(`${repository === "wrapper" ? "Wrapper" : "Game"} worktree is not clean`));
      return true;
    });
    assert.equal(await git(dirty.gameRoot, "branch", "--show-current"), "main");
    assert.equal(await git(dirty.gameRoot, "branch", "--list", "backup/pre-upstream-*"), "");
  }
});
