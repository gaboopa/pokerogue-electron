import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMenuTemplate } from "../src/menu.mjs";
import { validateReleaseManifest } from "../src/updater.mjs";
import { createArtifactRecord, createManifest, mergeArtifact } from "../scripts/release-manifest-lib.mjs";
import { assertValidRelease } from "../src/release-contract.mjs";
import { assertSupportedHost, createLocalArtifactName, createLocalPackageArguments, parseAvailableBytes } from "../scripts/package-mac-local.mjs";
import { manifestFixture } from "./helpers/manifest-fixture.mjs";

function callbacks() {
  return {
    onCheckForUpdates() {},
    onBackup() {},
    onRestore() {},
    onOpenSaveFolder() {},
    onReload() {},
    onToggleFullscreen() {},
    onDeveloperTools() {},
    utilities: [],
    keybindings: [],
    cheats: [],
  };
}


test("macOS icon source is validated when the supplied artwork is present", async t => {
  const iconUrl = new URL("../build/icon.png", import.meta.url);
  try {
    await access(iconUrl);
  } catch {
    t.skip("build/icon.png awaits the final 1024px artwork");
    return;
  }
  const icon = await readFile(iconUrl);
  assert.equal(icon.toString("ascii", 1, 4), "PNG");
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
});

test("macOS menu uses native app, window, and keyboard conventions", () => {
  const mac = createMenuTemplate({ isMac: true, productName: "PokeRogue Electron", ...callbacks() });
  const app = mac[0];
  const view = mac.find(item => item.label === "View");
  const file = mac.find(item => item.label === "File");
  const window = mac.find(item => item.label === "Window");
  assert.deepEqual(mac.map(item => item.label), ["PokeRogue Electron", "File", "Saves", "View", "Tools", "Cheats", "Profiles", "Window"]);
  assert.equal(app.submenu[0].role, "about");
  assert.ok(app.submenu.some(item => item.role === "services"));
  assert.ok(app.submenu.some(item => item.role === "hide"));
  assert.ok(app.submenu.some(item => item.role === "hideOthers"));
  assert.ok(app.submenu.some(item => item.role === "unhide"));
  assert.ok(app.submenu.some(item => item.role === "quit"));
  assert.ok(app.submenu.some(item => item.label === "Check for Updates…"));
  assert.ok(app.submenu.some(item => item.label === "Copy Diagnostic Report"));
  assert.equal(file.submenu[0].role, "close");
  assert.equal(view.submenu[0].accelerator, "CommandOrControl+R");
  assert.equal(view.submenu[1].accelerator, "Control+Command+F");
  assert.equal(view.submenu[2].accelerator, "Alt+Command+I");
  assert.equal(window.submenu[0].role, "minimize");
  assert.equal(window.submenu[1].role, "zoom");
});

test("Windows menu conventions remain unchanged", () => {
  const windows = createMenuTemplate({ isMac: false, productName: "PokeRogue Electron", ...callbacks() });
  assert.deepEqual(windows.map(item => item.label), ["Game", "Saves", "View", "Tools", "Cheats", "Profiles"]);
  assert.equal(windows[0].submenu.at(-1).role, "quit");
  assert.equal(windows.some(item => item.label === "File"), false);
  const view = windows.find(item => item.label === "View");
  assert.deepEqual(view.submenu.map(item => item.accelerator), ["CommandOrControl+R", "F11", "F12"]);
});

test("release manifests preserve Windows while adding macOS", async () => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-manifest-"));
  try {
    const artifactPath = join(root, "PokeRogue-Offline-0.1.3-macos-arm64.dmg");
    await writeFile(artifactPath, "dmg fixture");
    const revisions = { game: "game", assets: "assets", locales: "locales" };
    const windows = {
      platform: "windows", arch: "x64", fileName: "PokeRogue-Offline-0.1.3-windows-x64.exe", size: 10, sha256: "a".repeat(64),
      downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/windows.exe",
    };
    const mac = await createArtifactRecord({ artifactPath, platform: "macos", arch: "arm64", downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/macos.dmg" });
    const merged = mergeArtifact(createManifest({ version: "0.1.3", revisions, artifact: windows }), mac);
    assert.deepEqual(merged.artifacts.map(item => `${item.platform}/${item.arch}`), ["macos/arm64", "windows/x64"]);
    assert.equal(assertValidRelease(merged, { version: "0.1.3", revisions, allowDuplicateArtifacts: false }), merged);
    assert.throws(() => mergeArtifact(merged, mac), /already contains macos\/arm64/);
    assert.throws(() => assertValidRelease(merged, { version: "0.1.4", revisions, allowDuplicateArtifacts: false }), /does not match package version/);
    assert.throws(() => assertValidRelease(merged, { version: "0.1.3", revisions: { ...revisions, assets: "wrong" }, allowDuplicateArtifacts: false }), /source revision assets/);
    const duplicate = { ...merged, artifacts: [...merged.artifacts, { ...merged.artifacts.find(item => item.platform === "windows") }] };
    assert.throws(() => assertValidRelease(duplicate, { version: "0.1.3", revisions, allowDuplicateArtifacts: false }), /duplicate artifact coordinates/);
    assert.doesNotThrow(() => assertValidRelease(duplicate, { version: "0.1.3", revisions, allowDuplicateArtifacts: true }));
    const replaced = mergeArtifact(duplicate, { ...mac, sha256: "b".repeat(64) }, { replaceExisting: true });
    assert.equal(replaced.artifacts.find(item => item.platform === "macos").sha256, "b".repeat(64));
    assert.equal(replaced.artifacts.filter(item => item.platform === "macos" && item.arch === "arm64").length, 1);
    const staleUrl = { ...merged, artifacts: merged.artifacts.map(item => item.platform === "windows" ? { ...item, downloadUrl: "http://github.com/evil.exe" } : item) };
    assert.throws(() => assertValidRelease(staleUrl, { version: "0.1.3", revisions, allowDuplicateArtifacts: false }), /not allowed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact records preserve file metadata, SHA-256, coordinates, and URL validation", async t => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-artifact-record-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactPath = join(root, "PokeRogue-Offline-0.1.4-windows-x64.exe");
  const content = Buffer.from("known release artifact bytes");
  const downloadUrl = "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.4/windows.exe";
  await writeFile(artifactPath, content);

  const record = await createArtifactRecord({ artifactPath, downloadUrl, platform: "windows", arch: "x64" });
  assert.deepEqual(record, {
    platform: "windows",
    arch: "x64",
    fileName: "PokeRogue-Offline-0.1.4-windows-x64.exe",
    size: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    downloadUrl,
  });
  await assert.rejects(
    createArtifactRecord({ artifactPath, downloadUrl: "http://github.com/gaboopa/pokerogue-electron/windows.exe", platform: "windows", arch: "x64" }),
    /Update URL is not allowed/,
  );
});

test("artifact records reject empty, non-file, and unreadable paths", async t => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-artifact-errors-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const emptyPath = join(root, "PokeRogue-Offline-0.1.4-windows-x64.exe");
  const directoryPath = join(root, "PokeRogue-Offline-0.1.4-macos-arm64.dmg");
  const missingPath = join(root, "PokeRogue-Offline-0.1.4-missing.exe");
  await writeFile(emptyPath, "");
  await fs.promises.mkdir(directoryPath);
  const options = { downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.4/artifact", platform: "windows", arch: "x64" };

  await assert.rejects(createArtifactRecord({ ...options, artifactPath: emptyPath }), /not a non-empty file/);
  await assert.rejects(createArtifactRecord({ ...options, artifactPath: directoryPath }));
  await assert.rejects(createArtifactRecord({ ...options, artifactPath: missingPath }), error => error.code === "ENOENT");
});

test("artifact hashing closes its stream after a read error", async t => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-artifact-stream-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactPath = join(root, "PokeRogue-Offline-0.1.4-windows-x64.exe");
  await writeFile(artifactPath, "stream failure fixture");
  let stream;
  t.mock.method(fs, "createReadStream", () => {
    stream = new PassThrough();
    queueMicrotask(() => stream.destroy(new Error("fixture read failure")));
    return stream;
  });

  await assert.rejects(
    createArtifactRecord({
      artifactPath,
      downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.4/windows.exe",
      platform: "windows",
      arch: "x64",
    }),
    /fixture read failure/,
  );
  assert.equal(stream.closed, true);
});

test("adding a platform sorts artifacts without mutating the manifest", () => {
  const windows = { platform: "windows", arch: "x64", fileName: "PokeRogue-Offline-0.1.3-windows-x64.exe", size: 10, sha256: "a".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/windows.exe" };
  const mac = { platform: "macos", arch: "arm64", fileName: "PokeRogue-Offline-0.1.3-macos-arm64.dmg", size: 12, sha256: "b".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/macos.dmg" };
  const manifest = manifestFixture({ artifacts: [windows] });
  const original = structuredClone(manifest);
  const merged = mergeArtifact(manifest, mac);
  assert.deepEqual(merged.artifacts, [mac, windows]);
  assert.deepEqual(manifest, original);
});

test("adding an existing platform without replacement reports the exact error", () => {
  const mac = { platform: "macos", arch: "arm64", fileName: "PokeRogue-Offline-0.1.3-macos-arm64.dmg", size: 12, sha256: "b".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/macos.dmg" };
  assert.throws(() => mergeArtifact(manifestFixture({ artifacts: [mac] }), mac), error => error.message === "Manifest already contains macos/arm64; pass --replace to replace it");
});

test("replacing an existing platform replaces its artifact", () => {
  const previous = { platform: "macos", arch: "arm64", fileName: "PokeRogue-Offline-0.1.3-macos-arm64.dmg", size: 12, sha256: "b".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/macos.dmg" };
  const replacement = { ...previous, size: 13, sha256: "c".repeat(64) };
  const merged = mergeArtifact(manifestFixture({ artifacts: [previous] }), replacement, { replaceExisting: true });
  assert.deepEqual(merged.artifacts, [replacement]);
});

test("merging rejects unsupported artifact coordinates without mutating the manifest", () => {
  const windows = { platform: "windows", arch: "x64", fileName: "PokeRogue-Offline-0.1.3-windows-x64.exe", size: 10, sha256: "a".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/windows.exe" };
  const invalid = { platform: "linux", arch: "arm64", fileName: "PokeRogue-Offline-0.1.3-linux-arm64.dmg", size: 10, sha256: "a".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/linux.dmg" };
  const manifest = manifestFixture({ artifacts: [windows] });
  const originalArtifacts = manifest.artifacts;
  assert.throws(() => mergeArtifact(manifest, invalid, { replaceExisting: true }), /Unsupported release artifact coordinates: linux\/arm64/);
  assert.strictEqual(manifest.artifacts, originalArtifacts);
  assert.deepEqual(manifest.artifacts, [windows]);
});

test("a malformed non-selected artifact invalidates the whole release", () => {
  const manifest = manifestFixture({
    artifacts: [
      { platform: "windows", arch: "x64", fileName: "PokeRogue-Offline-0.1.3-windows-x64.exe", size: 10, sha256: "a".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/windows.exe" },
      { platform: "macos", arch: "arm64", size: 12, sha256: "b".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/macos.dmg" },
    ],
  });
  for (const [broken, pattern] of [
    [{ ...manifest.artifacts[0], sha256: "nothex" }, /sha256/],
    [{ ...manifest.artifacts[0], size: 0 }, /size/],
    [{ ...manifest.artifacts[0], downloadUrl: "https://github.com.evil.example/app.exe" }, /not allowed/],
    [{ ...manifest.artifacts[0], fileName: "Dev-DO-NOT-DISTRIBUTE.exe" }, /fileName/],
  ]) {
    assert.throws(() => validateReleaseManifest({ ...manifest, artifacts: [broken, manifest.artifacts[1]] }, "macos", "arm64"), pattern);
  }
});
test("updater selects a macOS arm64 artifact from a combined manifest", () => {
  const manifest = manifestFixture({
    artifacts: [{ platform: "windows", arch: "x64", fileName: "PokeRogue-Offline-0.1.3-windows-x64.exe", size: 10, sha256: "a".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/windows.exe" }, { platform: "macos", arch: "arm64", fileName: "PokeRogue-Offline-0.1.3-macos-arm64.dmg", size: 12, sha256: "b".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/macos.dmg" }],
  });
  assert.equal(validateReleaseManifest(manifest, "macos", "arm64").artifact.size, 12);
});

test("local macOS builder is isolated, pinned, and ad-hoc only", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const config = JSON.parse(await readFile(new URL("../build/local-macos-build.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["package:mac:local"], "node scripts/package-mac-local.mjs");
  assert.equal(config.wrapperVersion, packageJson.version);
  assert.match(createLocalArtifactName(packageJson.version), /LOCAL-ONLY-DO-NOT-DISTRIBUTE\.dmg$/);
  const args = createLocalPackageArguments(packageJson.version);
  assert.ok(args.includes("-c.mac.identity=-"));
  assert.ok(args.includes("-c.mac.hardenedRuntime=false"));
  assert.ok(args.includes("-c.dmg.sign=false"));
  assert.ok(args.includes("-c.directories.output=release/local"));
  assert.ok(args.some(arg => arg.endsWith(".${ext}")));
});

test("local macOS builder rejects non-Apple-Silicon hosts and parses disk space", () => {
  assert.doesNotThrow(() => assertSupportedHost({ platform: "darwin", arch: "arm64", nodeVersion: "24.0.0" }));
  assert.throws(() => assertSupportedHost({ platform: "darwin", arch: "x64", nodeVersion: "24.0.0" }), /Apple Silicon/);
  assert.throws(() => assertSupportedHost({ platform: "win32", arch: "arm64", nodeVersion: "24.0.0" }), /must be run on macOS/);
  assert.throws(() => assertSupportedHost({ platform: "darwin", arch: "arm64", nodeVersion: "23.0.0" }), /Node.js 24/);
  assert.equal(parseAvailableBytes("Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk1 100 20 80 20% /"), 80 * 1024);
});
