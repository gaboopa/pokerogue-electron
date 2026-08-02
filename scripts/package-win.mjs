import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Arch, build, Platform } from "electron-builder";
import { wrapperRoot } from "./lib.mjs";

export const WINDOWS_PACKAGE_MODES = Object.freeze(["release", "smoke", "staged"]);
export const WINDOWS_CACHE_SCHEMA_VERSION = 1;
export const WINDOWS_CACHE_RELATIVE_PATH = "release/cache/win-x64";
const NON_RELEASE_MARKER = "DO-NOT-DISTRIBUTE";
const CACHE_MARKER_NAME = "cache.json";
const PRODUCT_EXECUTABLE = "PokeRogue Offline.exe";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function walkInventory(physicalPath, logicalPath, entries) {
  const info = await stat(physicalPath);
  if (info.isDirectory()) {
    const children = await readdir(physicalPath, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) await walkInventory(join(physicalPath, child.name), join(logicalPath, child.name), entries);
  } else if (info.isFile()) {
    entries.push({ path: logicalPath.replaceAll("\\", "/"), bytes: info.size, mtimeMs: Math.trunc(info.mtimeMs) });
  }
}

async function inventoryMappings(mappings) {
  const entries = [];
  for (const mapping of mappings) await walkInventory(mapping.physicalPath, mapping.logicalPath, entries);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return {
    files: entries.length,
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    layoutDigest: sha256(JSON.stringify(entries.map(({ path, bytes }) => ({ path, bytes })))),
    digest: sha256(JSON.stringify(entries)),
  };
}

export async function createStagingInventory(root = wrapperRoot) {
  const stagingRoot = join(root, "staging");
  return inventoryMappings([{ physicalPath: stagingRoot, logicalPath: "" }]);
}

async function createCachedStagingInventory(prepackagedPath) {
  const resources = join(prepackagedPath, "resources");
  return inventoryMappings([
    { physicalPath: join(resources, "game"), logicalPath: "game" },
    { physicalPath: join(resources, "licenses"), logicalPath: "licenses" },
    { physicalPath: join(resources, "revisions.json"), logicalPath: "revisions.json" },
  ]);
}

async function hashInputPath(hash, root, inputPath) {
  const info = await stat(inputPath);
  const logical = relative(root, inputPath).replaceAll("\\", "/");
  if (info.isDirectory()) {
    const children = await readdir(inputPath, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) await hashInputPath(hash, root, join(inputPath, child.name));
  } else if (info.isFile()) {
    hash.update(logical);
    hash.update("\0");
    hash.update(await readFile(inputPath));
    hash.update("\0");
  }
}

async function createWrapperFingerprint(root) {
  const inputs = ["package.json", "package-lock.json", "README.md", "THIRD_PARTY_NOTICES.md", "src", "build/icon.ico"];
  const hash = createHash("sha256");
  for (const input of inputs) {
    const inputPath = join(root, input);
    if (await exists(inputPath)) await hashInputPath(hash, root, inputPath);
  }
  return hash.digest("hex");
}

export function createWindowsBuildConfig(baseBuild, mode) {
  if (!WINDOWS_PACKAGE_MODES.includes(mode)) throw new Error(`Unknown Windows package mode: ${mode}`);
  const config = structuredClone(baseBuild);
  config.directories = { ...config.directories };
  config.win = { ...config.win };
  config.nsis = { ...config.nsis, warningsAsErrors: true };

  if (mode === "release") return config;

  config.npmRebuild = false;
  if (mode === "smoke") {
    config.extraResources = null;
    config.directories.output = "release/smoke";
    config.win.artifactName = `PokeRogue-Offline-Installer-Smoke-${NON_RELEASE_MARKER}.\${ext}`;
    config.nsis.differentialPackage = false;
    config.nsis.useZip = true;
  } else {
    config.directories.output = "release/dev";
    config.win.artifactName = `PokeRogue-Offline-\${version}-windows-x64-Dev-${NON_RELEASE_MARKER}.\${ext}`;
    config.nsis.differentialPackage = false;
    config.nsis.useZip = true;
  }
  return config;
}

export function assertDistributableArtifactName(artifactPath) {
  const fileName = basename(artifactPath);
  if (/DO-NOT-DISTRIBUTE|(?:^|[-_.])(smoke|dev|benchmark)(?:[-_.]|$)/i.test(fileName)) {
    throw new Error(`Refusing to publish non-release artifact: ${fileName}`);
  }
  return fileName;
}

export async function validateStaging(root = wrapperRoot) {
  const required = [
    join(root, "staging", "game", "index.html"),
    join(root, "staging", "revisions.json"),
    join(root, "staging", "licenses"),
  ];
  await Promise.all(required.map(path => access(path)));
  const [indexInfo, revisionsInfo, licensesInfo] = await Promise.all(required.map(path => stat(path)));
  if (!indexInfo.isFile() || !revisionsInfo.isFile() || !licensesInfo.isDirectory()) {
    throw new Error("Staging is incomplete; run npm run build:game before packaging.");
  }
  const revisions = JSON.parse(await readFile(required[1], "utf8"));
  for (const key of ["game", "assets", "locales"]) {
    if (typeof revisions[key] !== "string" || revisions[key].length === 0) throw new Error(`staging/revisions.json is missing ${key}`);
  }
  return {
    revisions,
    timestamps: {
      game: indexInfo.mtime.toISOString(),
      revisions: revisionsInfo.mtime.toISOString(),
      licenses: licensesInfo.mtime.toISOString(),
    },
  };
}

export async function createWindowsCacheDescriptor(root = wrapperRoot, { npmRebuild = false } = {}) {
  const staging = await validateStaging(root);
  const [inventory, wrapperFingerprint, electronPackage] = await Promise.all([
    createStagingInventory(root),
    createWrapperFingerprint(root),
    readFile(join(root, "node_modules", "electron", "package.json"), "utf8").then(JSON.parse),
  ]);
  const identity = {
    schemaVersion: WINDOWS_CACHE_SCHEMA_VERSION,
    platform: "win32",
    arch: "x64",
    electronVersion: electronPackage.version,
    npmRebuild,
    wrapperFingerprint,
    revisions: staging.revisions,
    inventory,
  };
  return { ...identity, fingerprint: sha256(JSON.stringify(identity)) };
}

export async function validateWindowsCache(cacheRoot, descriptor) {
  const markerPath = join(cacheRoot, CACHE_MARKER_NAME);
  const prepackagedPath = join(cacheRoot, "win-unpacked");
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    return { valid: false, reason: "cache marker is missing or malformed" };
  }
  if (marker.fingerprint !== descriptor.fingerprint) return { valid: false, reason: "cache fingerprint does not match" };
  const required = [
    join(prepackagedPath, PRODUCT_EXECUTABLE),
    join(prepackagedPath, "resources", "app.asar"),
    join(prepackagedPath, "resources", "game", "index.html"),
    join(prepackagedPath, "resources", "revisions.json"),
    join(prepackagedPath, "resources", "licenses"),
  ];
  if (!(await Promise.all(required.map(exists))).every(Boolean)) return { valid: false, reason: "cached application is incomplete" };
  try {
    const inventory = await createCachedStagingInventory(prepackagedPath);
    if (inventory.files !== descriptor.inventory.files || inventory.bytes !== descriptor.inventory.bytes || inventory.layoutDigest !== descriptor.inventory.layoutDigest) return { valid: false, reason: "cached staged-file inventory does not match" };
  } catch {
    return { valid: false, reason: "cached staged-file inventory cannot be read" };
  }
  return { valid: true, marker, prepackagedPath };
}

export function createRobocopyArguments(source, destination) {
  return [source, destination, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:5", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"];
}

export function isSuccessfulRobocopyExitCode(code) {
  return Number.isInteger(code) && code >= 0 && code <= 7;
}

export async function copyStagingWithRobocopy(source, destination) {
  if (process.platform !== "win32") throw new Error("The Windows packaging cache requires Robocopy on Windows.");
  await mkdir(destination, { recursive: true });
  const args = createRobocopyArguments(source, destination);
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn("robocopy.exe", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolveResult({ code, stdout, stderr }));
  });
  const retries = (result.stdout.match(/Retrying/gi) ?? []).length;
  if (!isSuccessfulRobocopyExitCode(result.code)) {
    throw new Error(`Robocopy failed with exit code ${result.code}${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
  console.log(`Staging copy completed with Robocopy exit code ${result.code}; retries: ${retries}`);
  return { exitCode: result.code, retries };
}

async function swapCache(tempRoot, cacheRoot) {
  const backupRoot = `${cacheRoot}.old`;
  await rm(backupRoot, { recursive: true, force: true });
  const hadCache = await exists(cacheRoot);
  if (hadCache) await rename(cacheRoot, backupRoot);
  try {
    await rename(tempRoot, cacheRoot);
  } catch (error) {
    if (hadCache && !(await exists(cacheRoot))) await rename(backupRoot, cacheRoot);
    throw error;
  }
  await rm(backupRoot, { recursive: true, force: true });
}

export async function prepareWindowsCache({
  root = wrapperRoot,
  baseBuild,
  mode = "staged",
  force = false,
  buildFn = build,
  copyFn = copyStagingWithRobocopy,
} = {}) {
  if (!baseBuild) baseBuild = JSON.parse(await readFile(join(root, "package.json"), "utf8")).build;
  const npmRebuild = mode === "release";
  const descriptor = await createWindowsCacheDescriptor(root, { npmRebuild });
  const cacheRoot = join(root, ...WINDOWS_CACHE_RELATIVE_PATH.split("/"));
  if (!force) {
    const validation = await validateWindowsCache(cacheRoot, descriptor);
    if (validation.valid) {
      console.log(`Reusing Windows package cache ${descriptor.fingerprint.slice(0, 12)} for game ${descriptor.revisions.game}`);
      return { ...validation, reused: true, descriptor, durationSeconds: 0 };
    }
    console.log(`Rebuilding Windows package cache: ${validation.reason}`);
  } else {
    console.log(`Refreshing Windows package cache for release ${descriptor.fingerprint.slice(0, 12)}`);
  }

  const startedAt = performance.now();
  const cacheParent = join(root, "release", "cache");
  const tempRoot = join(cacheParent, `.win-x64.tmp-${process.pid}-${Date.now()}`);
  await mkdir(cacheParent, { recursive: true });
  await rm(tempRoot, { recursive: true, force: true });
  try {
    const config = createWindowsBuildConfig(baseBuild, mode);
    config.extraResources = null;
    config.directories.output = tempRoot;
    await buildFn({
      projectDir: root,
      targets: Platform.WINDOWS.createTarget("dir", Arch.x64),
      config,
    });
    const prepackagedPath = join(tempRoot, "win-unpacked");
    const copyResult = await copyFn(join(root, "staging"), join(prepackagedPath, "resources"));
    const cachedInventory = await createCachedStagingInventory(prepackagedPath);
    if (cachedInventory.files !== descriptor.inventory.files || cachedInventory.bytes !== descriptor.inventory.bytes || cachedInventory.layoutDigest !== descriptor.inventory.layoutDigest) throw new Error("Prepared Windows cache does not match the staged-file inventory.");
    const marker = { ...descriptor, generatedAt: new Date().toISOString(), copyRetries: copyResult?.retries ?? 0 };
    await writeFile(join(tempRoot, CACHE_MARKER_NAME), JSON.stringify(marker, null, 2));
    await swapCache(tempRoot, cacheRoot);
    const durationSeconds = Number(((performance.now() - startedAt) / 1000).toFixed(1));
    console.log(`Windows package cache prepared in ${durationSeconds}s; files ${descriptor.inventory.files}; bytes ${descriptor.inventory.bytes}`);
    return { valid: true, reused: false, marker, descriptor, prepackagedPath: join(cacheRoot, "win-unpacked"), durationSeconds };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function cleanWindowsOutput(root, mode, output) {
  const outputPath = resolve(root, output);
  if (mode !== "release") {
    await rm(outputPath, { recursive: true, force: true });
    return;
  }
  const preservedDirectories = new Set(["smoke", "dev", "benchmark", "cache"]);
  for (const entry of await readdir(outputPath, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && preservedDirectories.has(entry.name)) continue;
    await rm(join(outputPath, entry.name), { recursive: true, force: true });
  }
}

export async function packageWindows(mode, { baseBuild, root = wrapperRoot, buildFn = build } = {}) {
  const packageJson = baseBuild ? null : JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const sourceBuild = baseBuild ?? packageJson.build;
  const config = createWindowsBuildConfig(sourceBuild, mode);
  await cleanWindowsOutput(root, mode, config.directories.output);
  const totalStartedAt = performance.now();

  let cache = null;
  if (mode !== "smoke") {
    const staging = await validateStaging(root);
    console.log(`Using staged game ${staging.revisions.game}`);
    console.log(`Assets ${staging.revisions.assets}; locales ${staging.revisions.locales}`);
    console.log(`Staging timestamps: game ${staging.timestamps.game}; revisions ${staging.timestamps.revisions}; licenses ${staging.timestamps.licenses}`);
    cache = await prepareWindowsCache({ root, baseBuild: sourceBuild, mode, force: mode === "release", buildFn });
    config.extraResources = null;
  }

  const installerStartedAt = performance.now();
  const artifacts = await buildFn({
    projectDir: root,
    targets: Platform.WINDOWS.createTarget("nsis", Arch.x64),
    config,
    ...(cache ? { prepackaged: cache.prepackagedPath } : {}),
  });
  const installerSeconds = Number(((performance.now() - installerStartedAt) / 1000).toFixed(1));
  const totalSeconds = Number(((performance.now() - totalStartedAt) / 1000).toFixed(1));
  console.log(`Windows ${mode} installer phase completed in ${installerSeconds}s; total ${totalSeconds}s${cache ? `; cache ${cache.reused ? "reused" : "rebuilt"}` : ""}`);
  return artifacts;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = process.argv[2];
  if (!WINDOWS_PACKAGE_MODES.includes(mode)) {
    throw new Error(`Usage: node scripts/package-win.mjs <${WINDOWS_PACKAGE_MODES.join("|")}>`);
  }
  await packageWindows(mode);
}
