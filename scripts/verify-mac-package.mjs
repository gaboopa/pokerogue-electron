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

async function runExpectedFailure(command, args) {
  try {
    await run(command, args);
  } catch (error) {
    return error;
  }
  throw new Error(`${command} unexpectedly accepted the unsigned app`);
}

export async function verifyMacPackage(dmgPath) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("macOS package verification must run on an Apple Silicon macOS runner");
  const artifact = resolve(dmgPath);
  if (!(await exists(artifact))) throw new Error(`DMG not found: ${artifact}`);
  await run("hdiutil", ["verify", artifact]);
  const mountpoint = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "pokerogue-dmg-"));
  let mounted = false;
  try {
    await run("hdiutil", ["attach", "-nobrowse", "-readonly", "-noverify", "-mountpoint", mountpoint, artifact]);
    mounted = true;
    const entries = await readdir(mountpoint, { withFileTypes: true });
    const appEntry = entries.find(entry => entry.name.endsWith(".app") && entry.isDirectory());
    if (!appEntry) throw new Error("DMG does not contain an application bundle");
    const applications = entries.find(entry => entry.name === "Applications");
    if (!applications || !applications.isSymbolicLink()) throw new Error("DMG is missing its Applications link");

    const appPath = join(mountpoint, appEntry.name);
    const resourcesPath = join(appPath, "Contents", "Resources");
    const plistPath = join(appPath, "Contents", "Info.plist");
    const { stdout: bundleIdentifier } = await run("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plistPath]);
    const { stdout: bundleName } = await run("plutil", ["-extract", "CFBundleName", "raw", "-o", "-", plistPath]);
    const { stdout: bundleVersion } = await run("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plistPath]);
    const { stdout: minimumSystemVersion } = await run("plutil", ["-extract", "LSMinimumSystemVersion", "raw", "-o", "-", plistPath]);
    const { stdout: executableName } = await run("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", plistPath]);
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
    const { stdout: architectures } = await run("lipo", ["-archs", executablePath]);
    const archList = architectures.trim().split(/\s+/);
    if (archList.length !== 1 || archList[0] !== "arm64") throw new Error(`Expected arm64-only executable, got: ${architectures.trim()}`);
    if (!iconName || !(await exists(join(resourcesPath, iconName)))) throw new Error("Bundle icon file is missing");
    for (const required of [
      join(resourcesPath, "app.asar"),
      join(resourcesPath, "game", "index.html"),
      join(resourcesPath, "revisions.json"),
      join(resourcesPath, "licenses"),
    ]) if (!(await exists(required))) throw new Error(`Packaged app is missing ${required.slice(dirname(appPath).length + 1)}`);
    await runExpectedFailure("codesign", ["--verify", "--deep", "--strict", appPath]);
    await runExpectedFailure("spctl", ["-a", "-vv", appPath]);
    return { artifact, appPath, architectures: archList, iconFile: iconName, minimumSystemVersion: minimumSystemVersion.trim() };
  } finally {
    if (mounted) await run("hdiutil", ["detach", mountpoint, "-force"]).catch(() => {});
    await rm(mountpoint, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const artifact = process.argv[2] ?? join(wrapperRoot, "release", "PokeRogue-Offline-macos-arm64.dmg");
  const result = await verifyMacPackage(artifact);
  console.log(`Verified unsigned arm64 DMG ${basename(result.artifact)} (minimum macOS ${result.minimumSystemVersion})`);
}
