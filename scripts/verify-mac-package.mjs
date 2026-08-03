import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { wrapperRoot } from "./lib.mjs";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

async function run(command, args) {
  return execFileAsync(command, args, { cwd: wrapperRoot, maxBuffer: 8 * 1024 * 1024 });
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function runExpectedFailure(command, args, description) {
  try {
    await run(command, args);
  } catch {
    return;
  }
  throw new Error(`${command} unexpectedly accepted the ${description}`);
}

async function runExpectedSuccess(command, args, description) {
  try {
    return await run(command, args);
  } catch (error) {
    throw new Error(`${command} failed while validating ${description}: ${error.stderr?.trim() ?? error.message}`, { cause: error });
  }
}

export async function verifyMacPackage(dmgPath, { mode = "release" } = {}) {
  if (!(process.platform === "darwin" && process.arch === "arm64")) throw new Error("macOS package verification must run on an Apple Silicon macOS runner");
  if (!(mode === "release" || mode === "local")) throw new Error(`Unknown macOS package verification mode: ${mode}`);
  const artifact = resolve(dmgPath);
  if (mode === "local" && !basename(artifact).includes("DO-NOT-DISTRIBUTE")) throw new Error("Local DMG must include DO-NOT-DISTRIBUTE in its filename");
  if (!(await exists(artifact))) throw new Error(`DMG not found: ${artifact}`);
  await runExpectedSuccess("hdiutil", ["verify", artifact], "the DMG image");
  const mountpoint = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "pokerogue-dmg-"));
  let mounted = false;
  try {
    await runExpectedSuccess("hdiutil", ["attach", "-nobrowse", "-readonly", "-noverify", "-mountpoint", mountpoint, artifact], "DMG mounting");
    mounted = true;
    const entries = await readdir(mountpoint, { withFileTypes: true });
    const appEntries = entries.filter(entry => entry.name.endsWith(".app") && entry.isDirectory());
    if (appEntries.length !== 1) throw new Error(`DMG must contain exactly one application bundle; found ${appEntries.length}`);
    const applications = entries.find(entry => entry.name === "Applications");
    if (!applications || !applications.isSymbolicLink()) throw new Error("DMG is missing its Applications link");

    const appPath = join(mountpoint, appEntries[0].name);
    const resourcesPath = join(appPath, "Contents", "Resources");
    const plistPath = join(appPath, "Contents", "Info.plist");
    const { stdout: bundleIdentifier } = await runExpectedSuccess("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plistPath], "bundle identifier");
    const { stdout: bundleName } = await runExpectedSuccess("plutil", ["-extract", "CFBundleName", "raw", "-o", "-", plistPath], "bundle name");
    const { stdout: bundleVersion } = await runExpectedSuccess("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plistPath], "bundle version");
    const { stdout: minimumSystemVersion } = await runExpectedSuccess("plutil", ["-extract", "LSMinimumSystemVersion", "raw", "-o", "-", plistPath], "minimum macOS version");
    const { stdout: executableName } = await runExpectedSuccess("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", plistPath], "executable name");
    const { stdout: iconFile } = await run("plutil", ["-extract", "CFBundleIconFile", "raw", "-o", "-", plistPath]).catch(() => ({ stdout: "" }));
    const resourceEntries = await readdir(resourcesPath, { withFileTypes: true });
    const iconName = iconFile.trim() || resourceEntries.find(entry => entry.name.toLowerCase().endsWith(".icns"))?.name || "";
    if (bundleIdentifier.trim() !== "com.gaboopa.pokerogueoffline") throw new Error(`Unexpected bundle identifier: ${bundleIdentifier.trim()}`);
    if (bundleName.trim() !== "PokeRogue Offline") throw new Error(`Unexpected bundle name: ${bundleName.trim()}`);
    const expectedVersion = JSON.parse(await readFile(join(wrapperRoot, "package.json"), "utf8")).version;
    if (bundleVersion.trim() !== expectedVersion) throw new Error(`Unexpected bundle version: ${bundleVersion.trim()}`);
    if (!minimumSystemVersion.trim()) throw new Error("Bundle is missing LSMinimumSystemVersion");
    if (!executableName.trim()) throw new Error("Bundle is missing its executable name");
    const executablePath = join(appPath, "Contents", "MacOS", executableName.trim());
    const { stdout: architectures } = await runExpectedSuccess("lipo", ["-archs", executablePath], "executable architecture");
    const archList = architectures.trim().split(/\s+/);
    if (archList.length !== 1 || archList[0] !== "arm64") throw new Error(`Expected arm64-only executable, got: ${architectures.trim()}`);
    if (!iconName || !(await exists(join(resourcesPath, iconName)))) throw new Error("Bundle icon file is missing");
    for (const required of [
      join(resourcesPath, "app.asar"),
      join(resourcesPath, "game", "index.html"),
      join(resourcesPath, "revisions.json"),
      join(resourcesPath, "licenses"),
    ]) if (!(await exists(required))) throw new Error(`Packaged app is missing ${required.slice(dirname(appPath).length + 1)}`);

    if (mode === "release") {
      await runExpectedFailure("codesign", ["--verify", "--deep", "--strict", appPath], "unsigned app");
    } else {
      await runExpectedSuccess("codesign", ["--verify", "--deep", "--strict", appPath], "ad-hoc app signature");
      const details = await runExpectedSuccess("codesign", ["-dv", "--verbose=4", appPath], "ad-hoc signature details");
      const signatureDetails = `${details.stdout}\n${details.stderr}`;
      if (!/Signature=adhoc/.test(signatureDetails)) throw new Error("Local app is not ad-hoc signed");
      if (/Developer ID|Authority=Apple/.test(signatureDetails)) throw new Error("Local app unexpectedly has a Developer ID or Apple-trusted signature");
      await runExpectedFailure("xcrun", ["stapler", "validate", appPath], "notarization ticket");
    }
    await runExpectedFailure("spctl", ["-a", "-vv", appPath], mode === "local" ? "untrusted local app" : "unsigned app");
    return { artifact, appPath, architectures: archList, iconFile: iconName, minimumSystemVersion: minimumSystemVersion.trim(), mode };
  } finally {
    if (mounted) await run("hdiutil", ["detach", mountpoint, "-force"]).catch(() => {});
    await rm(mountpoint, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const mode = args.includes("--local") ? "local" : "release";
  const positional = args.filter(arg => arg !== "--local");
  const artifact = positional[0] ?? join(wrapperRoot, "release", "PokeRogue-Offline-macos-arm64.dmg");
  const result = await verifyMacPackage(artifact, { mode });
  console.log(`Verified ${mode === "local" ? "local ad-hoc" : "unsigned"} arm64 DMG ${basename(result.artifact)} (minimum macOS ${result.minimumSystemVersion})`);
}
