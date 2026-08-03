import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMenuTemplate } from "../src/menu.mjs";
import { validateReleaseManifest } from "../src/updater.mjs";
import { assertManifestCompatibility, createArtifactRecord, createManifest, mergeArtifact } from "../scripts/release-manifest-lib.mjs";
import { assertSupportedHost, createLocalArtifactName, createLocalPackageArguments, parseAvailableBytes } from "../scripts/package-mac-local.mjs";

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

test("macOS packaging keeps the arm64 unsigned DMG contract", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const mac = packageJson.build.mac;
  assert.deepEqual(mac.target, [{ target: "dmg", arch: ["arm64"] }]);
  assert.equal(mac.artifactName, "PokeRogue-Offline-${version}-macos-arm64.${ext}");
  assert.equal(mac.identity, null);
  assert.equal(mac.icon, "build/icon.png");
  assert.equal(mac.hardenedRuntime, false);
  assert.equal(mac.notarize, false);
  assert.equal(packageJson.build.dmg.sign, false);
  assert.equal(packageJson.build.dmg.filesystem, "HFS+");
  assert.deepEqual(packageJson.build.dmg.contents[1], { x: 410, y: 220, type: "link", path: "/Applications" });
});

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
  const mac = createMenuTemplate({ isMac: true, productName: "PokeRogue Offline", ...callbacks() });
  const app = mac[0];
  const view = mac.find(item => item.label === "View");
  const file = mac.find(item => item.label === "File");
  const window = mac.find(item => item.label === "Window");
  assert.equal(app.submenu[0].role, "about");
  assert.ok(app.submenu.some(item => item.role === "services"));
  assert.ok(app.submenu.some(item => item.role === "hide"));
  assert.ok(app.submenu.some(item => item.role === "quit"));
  assert.equal(file.submenu[0].role, "close");
  assert.equal(view.submenu[0].accelerator, "Command+R");
  assert.equal(view.submenu[1].accelerator, "Control+Command+F");
  assert.equal(view.submenu[2].accelerator, "Alt+Command+I");
  assert.equal(window.submenu[0].role, "minimize");
  assert.equal(window.submenu[1].role, "zoom");
});

test("Windows menu conventions remain unchanged", () => {
  const windows = createMenuTemplate({ isMac: false, productName: "PokeRogue Offline", ...callbacks() });
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
    assert.equal(assertManifestCompatibility(merged, { version: "0.1.3", revisions }), merged);
    assert.throws(() => mergeArtifact(merged, mac), /already contains macos\/arm64/);
    assert.throws(() => assertManifestCompatibility(merged, { version: "0.1.4", revisions }), /does not match package version/);
    assert.throws(() => assertManifestCompatibility(merged, { version: "0.1.3", revisions: { ...revisions, assets: "wrong" } }), /source revision assets/);
    const duplicate = { ...merged, artifacts: [...merged.artifacts, { ...merged.artifacts.find(item => item.platform === "windows") }] };
    assert.throws(() => assertManifestCompatibility(duplicate, { version: "0.1.3", revisions }), /duplicate artifact coordinates/);
    assert.doesNotThrow(() => assertManifestCompatibility(duplicate, { version: "0.1.3", revisions, allowDuplicateArtifacts: true }));
    const replaced = mergeArtifact(duplicate, { ...mac, sha256: "b".repeat(64) }, { replaceExisting: true });
    assert.equal(replaced.artifacts.find(item => item.platform === "macos").sha256, "b".repeat(64));
    assert.equal(replaced.artifacts.filter(item => item.platform === "macos" && item.arch === "arm64").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("updater selects a macOS arm64 artifact from a combined manifest", () => {
  const manifest = {
    schemaVersion: 1,
    version: "0.1.3",
    sourceRevisions: { game: "game", assets: "assets", locales: "locales" },
    artifacts: [{ platform: "windows", arch: "x64", size: 10, sha256: "a".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/windows.exe" }, { platform: "macos", arch: "arm64", size: 12, sha256: "b".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/macos.dmg" }],
  };
  assert.equal(validateReleaseManifest(manifest, "macos", "arm64").artifact.size, 12);
});

test("local macOS builder is isolated, pinned, and ad-hoc only", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const config = JSON.parse(await readFile(new URL("../build/local-macos-build.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["package:mac:local"], "node scripts/package-mac-local.mjs");
  assert.equal(config.wrapperVersion, packageJson.version);
  assert.equal(config.gameRevision, "ae6a29a0755743a72f928ac8e3adfd00ec6e01f0");
  assert.equal(config.assetsRevision, "909b43612324622608023b3beb2f24f4ef159c1d");
  assert.equal(config.localesRevision, "c2f9c794ce17f1445d14357a4995353447e9df55");
  assert.equal(config.pnpmVersion, "10.34.5");
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

test("local macOS preflight validates the codesign executable without a signing identity", async () => {
  const builder = await readFile(new URL("../scripts/package-mac-local.mjs", import.meta.url), "utf8");
  assert.ok(builder.includes('checkCommand("codesign", ["--verify", "/usr/bin/codesign"]'));
  assert.doesNotMatch(builder, /checkCommand\("codesign", \["-h"\]/);
  assert.ok(builder.includes('Details: ${detail}'));
});
test("local DMG verifier keeps release and ad-hoc checks distinct", async () => {
  const verifier = await readFile(new URL("../scripts/verify-mac-package.mjs", import.meta.url), "utf8");
  assert.match(verifier, /mode === "local"/);
  assert.match(verifier, /DO-NOT-DISTRIBUTE/);
  assert.match(verifier, /Signature=adhoc/);
  assert.match(verifier, /xcrun.*stapler.*validate/);
  assert.match(verifier, /finally/);
  assert.match(verifier, /runExpectedFailure\("codesign", \["--verify", "--deep", "--strict", appPath\]/);
});
