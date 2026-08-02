import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WINDOWS_CACHE_RELATIVE_PATH,
  assertDistributableArtifactName,
  createRobocopyArguments,
  createWindowsBuildConfig,
  createWindowsCacheDescriptor,
  isSuccessfulRobocopyExitCode,
  prepareWindowsCache,
} from "../scripts/package-win.mjs";
import { createBenchmarkConfig, selectBenchmarkCandidate } from "../scripts/benchmark-win-packaging.mjs";
import { shouldStageGamePath } from "../scripts/staging-policy.mjs";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

async function writeFixtureFile(root, relativePath, contents = "fixture") {
  const path = join(root, ...relativePath.split("/"));
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents);
}

async function createCacheFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-win-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const buildConfig = {
    appId: "com.example.fixture",
    productName: "PokeRogue Offline",
    asar: true,
    files: ["src/**/*", "package.json", "build/icon.ico"],
    extraResources: [
      { from: "staging/game", to: "game" },
      { from: "staging/revisions.json", to: "revisions.json" },
      { from: "staging/licenses", to: "licenses" },
    ],
    directories: { output: "release" },
    win: { artifactName: "Fixture-${version}.${ext}" },
    nsis: {},
  };
  await writeFixtureFile(root, "package.json", JSON.stringify({ version: "1.0.0", build: buildConfig }));
  await writeFixtureFile(root, "package-lock.json", "lock");
  await writeFixtureFile(root, "README.md", "readme");
  await writeFixtureFile(root, "THIRD_PARTY_NOTICES.md", "notices");
  await writeFixtureFile(root, "src/main.mjs", "export const fixture = 1;");
  await writeFixtureFile(root, "build/icon.ico", "icon");
  await writeFixtureFile(root, "node_modules/electron/package.json", JSON.stringify({ version: "42.7.1" }));
  await writeFixtureFile(root, "staging/game/index.html", "<html></html>");
  await writeFixtureFile(root, "staging/game/data.json", "{\"ok\":true}");
  await writeFixtureFile(root, "staging/revisions.json", JSON.stringify({ builtAt: "2026-01-01T00:00:00Z", game: "game", assets: "assets", locales: "locales" }));
  await writeFixtureFile(root, "staging/licenses/LICENSE", "license");
  return { root, buildConfig };
}

function createMockCacheBuilder(root, calls) {
  return async options => {
    calls.push(options);
    const prepackaged = join(options.config.directories.output, "win-unpacked");
    await writeFixtureFile(prepackaged, "PokeRogue Offline.exe", "exe");
    await writeFixtureFile(prepackaged, "resources/app.asar", "asar");
    return [];
  };
}

async function mockStagingCopy(source, destination) {
  await cp(source, destination, { recursive: true, preserveTimestamps: true });
  return { exitCode: 1, retries: 2 };
}

test("release packaging preserves the distributable configuration", () => {
  const config = createWindowsBuildConfig(packageJson.build, "release");
  assert.equal(config.directories.output, "release");
  assert.equal(config.win.artifactName, "PokeRogue-Offline-${version}-windows-x64.${ext}");
  assert.equal(config.extraResources.length, 3);
  assert.equal(Object.hasOwn(config, "npmRebuild"), false);
  assert.equal(Object.hasOwn(config.nsis, "differentialPackage"), false);
  assert.equal(Object.hasOwn(config.nsis, "useZip"), false);
  assert.equal(config.nsis.warningsAsErrors, true);
});

test("smoke packaging compiles the real installer without game resources", () => {
  const config = createWindowsBuildConfig(packageJson.build, "smoke");
  assert.equal(config.extraResources, null);
  assert.equal(config.directories.output, "release/smoke");
  assert.match(config.win.artifactName, /Installer-Smoke-DO-NOT-DISTRIBUTE/);
  assert.equal(config.npmRebuild, false);
  assert.equal(config.nsis.differentialPackage, false);
  assert.equal(config.nsis.useZip, true);
  assert.equal(config.nsis.include, "build/installer.nsh");
  assert.equal(config.nsis.warningsAsErrors, true);
});

test("staged packaging retains resources and uses fast ZIP settings", () => {
  const config = createWindowsBuildConfig(packageJson.build, "staged");
  assert.equal(config.extraResources.length, 3);
  assert.equal(config.directories.output, "release/dev");
  assert.match(config.win.artifactName, /Dev-DO-NOT-DISTRIBUTE/);
  assert.equal(config.npmRebuild, false);
  assert.equal(config.nsis.differentialPackage, false);
  assert.equal(config.nsis.useZip, true);
  assert.equal(config.nsis.warningsAsErrors, true);
});

test("benchmark configurations compare current, hybrid, and ZIP from prepackaged content", () => {
  const current = createBenchmarkConfig(packageJson.build, "current");
  const hybrid = createBenchmarkConfig(packageJson.build, "hybrid");
  const zip = createBenchmarkConfig(packageJson.build, "zip");
  assert.equal(current.extraResources, null);
  assert.equal(Object.hasOwn(current.nsis, "useZip"), false);
  assert.equal(Object.hasOwn(current.nsis, "preCompressedFileExtensions"), false);
  assert.ok(hybrid.nsis.preCompressedFileExtensions.includes(".mp3"));
  assert.ok(hybrid.nsis.preCompressedFileExtensions.includes(".png"));
  assert.equal(zip.nsis.differentialPackage, false);
  assert.equal(zip.nsis.useZip, true);
  for (const config of [current, hybrid, zip]) assert.match(config.win.artifactName, /DO-NOT-DISTRIBUTE/);
});

test("benchmark selects the fastest candidate that passes time and size thresholds", () => {
  const baseline = { kind: "current", installerSeconds: 100, bytes: 1000 };
  const selection = selectBenchmarkCandidate(baseline, [
    { kind: "hybrid", installerSeconds: 69, bytes: 1100 },
    { kind: "zip", installerSeconds: 50, bytes: 1110 },
  ]);
  assert.equal(selection.candidates[0].packagingThresholdsPassed, true);
  assert.equal(selection.candidates[1].packagingThresholdsPassed, false);
  assert.equal(selection.selected, "hybrid");
});

test("source maps are omitted from staged game content", () => {
  assert.equal(shouldStageGamePath("dist/assets/app.js.map"), false);
  assert.equal(shouldStageGamePath("dist/assets/APP.MAP"), false);
  assert.equal(shouldStageGamePath("dist/assets/app.js"), true);
});

test("Windows cache fingerprints are stable and invalidate on wrapper and staging changes", async t => {
  const { root } = await createCacheFixture(t);
  const first = await createWindowsCacheDescriptor(root);
  const second = await createWindowsCacheDescriptor(root);
  assert.equal(first.fingerprint, second.fingerprint);
  await writeFixtureFile(root, "src/main.mjs", "export const fixture = 2;");
  const wrapperChanged = await createWindowsCacheDescriptor(root);
  assert.notEqual(wrapperChanged.fingerprint, first.fingerprint);
  await writeFixtureFile(root, "staging/game/data.json", "{\"changed\":true}");
  const stagingChanged = await createWindowsCacheDescriptor(root);
  assert.notEqual(stagingChanged.fingerprint, wrapperChanged.fingerprint);
});

test("staged cache is reused, forced refresh rebuilds, and incomplete cache is rejected", async t => {
  const { root, buildConfig } = await createCacheFixture(t);
  const calls = [];
  const buildFn = createMockCacheBuilder(root, calls);
  const first = await prepareWindowsCache({ root, baseBuild: buildConfig, buildFn, copyFn: mockStagingCopy });
  assert.equal(first.reused, false);
  assert.equal(first.marker.copyRetries, 2);
  const second = await prepareWindowsCache({ root, baseBuild: buildConfig, buildFn, copyFn: mockStagingCopy });
  assert.equal(second.reused, true);
  assert.equal(calls.length, 1);
  await unlink(join(root, ...WINDOWS_CACHE_RELATIVE_PATH.split("/"), "win-unpacked", "resources", "app.asar"));
  const repaired = await prepareWindowsCache({ root, baseBuild: buildConfig, buildFn, copyFn: mockStagingCopy });
  assert.equal(repaired.reused, false);
  assert.equal(calls.length, 2);
  await prepareWindowsCache({ root, baseBuild: buildConfig, mode: "release", force: true, buildFn, copyFn: mockStagingCopy });
  assert.equal(calls.length, 3);
  assert.equal(Object.hasOwn(calls[2].config, "npmRebuild"), false);
});

test("failed cache preparation leaves no valid marker", async t => {
  const { root, buildConfig } = await createCacheFixture(t);
  const calls = [];
  await assert.rejects(
    prepareWindowsCache({
      root,
      baseBuild: buildConfig,
      buildFn: createMockCacheBuilder(root, calls),
      copyFn: async () => { throw new Error("locked"); },
    }),
    /locked/,
  );
  await assert.rejects(readFile(join(root, ...WINDOWS_CACHE_RELATIVE_PATH.split("/"), "cache.json")));
});

test("Robocopy policy retries locks and accepts documented success exit codes", () => {
  const args = createRobocopyArguments("source", "destination");
  assert.ok(args.includes("/R:5"));
  assert.ok(args.includes("/W:1"));
  for (let code = 0; code <= 7; code++) assert.equal(isSuccessfulRobocopyExitCode(code), true);
  for (const code of [-1, 8, 16, null]) assert.equal(isSuccessfulRobocopyExitCode(code), false);
});

test("non-release Windows artifacts cannot be published", () => {
  assert.equal(assertDistributableArtifactName("PokeRogue-Offline-0.1.2-windows-x64.exe"), "PokeRogue-Offline-0.1.2-windows-x64.exe");
  for (const file of [
    "PokeRogue-Offline-Installer-Smoke-DO-NOT-DISTRIBUTE.exe",
    "PokeRogue-Offline-0.1.2-windows-x64-Dev-DO-NOT-DISTRIBUTE.exe",
    "PokeRogue-Offline-Benchmark-zip-DO-NOT-DISTRIBUTE.exe",
  ]) assert.throws(() => assertDistributableArtifactName(file), /Refusing to publish non-release artifact/);
});

test("unknown Windows package modes and benchmark kinds fail closed", () => {
  assert.throws(() => createWindowsBuildConfig(packageJson.build, "quick"), /Unknown Windows package mode/);
  assert.throws(() => createBenchmarkConfig(packageJson.build, "quick"), /Unknown benchmark kind/);
});
