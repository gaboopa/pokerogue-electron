import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
export const wrapperRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const localBuildRoot = join(wrapperRoot, ".local-build");
export const managedGamePath = join(localBuildRoot, "pokerogue");
export const localOutputRoot = join(wrapperRoot, "release", "local");
const localBuildConfigPath = join(wrapperRoot, "build", "local-macos-build.json");
const minimumFreeBytes = 4 * 1024 ** 3;

function log(message) {
  console.log(`[macOS local build] ${message}`);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function run(command, args, { cwd = wrapperRoot, env = process.env, quiet = false } = {}) {
  try {
    const result = await execFileAsync(command, args, { cwd, env, maxBuffer: 64 * 1024 * 1024 });
    if (!quiet) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    return result.stdout.trim();
  } catch (error) {
    if (!quiet && error.stderr) process.stderr.write(error.stderr);
    throw new Error(`${command} ${args.join(" ")} failed${error.stderr ? `: ${error.stderr.trim()}` : ""}`, { cause: error });
  }
}

export function assertSupportedHost({ platform = process.platform, arch = process.arch, nodeVersion = process.versions.node } = {}) {
  if (platform !== "darwin") throw new Error("The local macOS builder must be run on macOS.");
  if (arch !== "arm64") throw new Error("The local macOS builder requires an Apple Silicon Mac and an ARM64 Node.js installation. Install the ARM64 Node.js package, not the Intel package under Rosetta.");
  const major = Number.parseInt(nodeVersion.split(".")[0], 10);
  if (!Number.isFinite(major) || major < 24) throw new Error(`Node.js 24 or newer is required; found ${nodeVersion}.`);
}

export function parseAvailableBytes(dfOutput) {
  const line = dfOutput.trim().split(/\r?\n/).at(-1) ?? "";
  const columns = line.trim().split(/\s+/);
  const availableKiB = Number(columns[3]);
  if (!Number.isFinite(availableKiB)) throw new Error("Could not determine available disk space from df output.");
  return availableKiB * 1024;
}

async function checkCommand(command, args, message) {
  try {
    await run(command, args, { quiet: true });
  } catch {
    throw new Error(`${message} The command '${command}' was not available or did not run.`);
  }
}

export async function checkPrerequisites() {
  assertSupportedHost();
  await checkCommand("git", ["--version"], "Install Git with Apple's Command Line Tools.");
  await checkCommand("npm", ["--version"], "Install Node.js 24 or newer from https://nodejs.org/en/download/archive/v24.");
  await checkCommand("xcode-select", ["-p"], "Install Apple's Command Line Tools with: xcode-select --install");
  await checkCommand("hdiutil", ["help"], "Apple's disk image tools are missing; install Apple's Command Line Tools.");
  await checkCommand("codesign", ["-h"], "Apple's code-signing tools are missing; install Apple's Command Line Tools.");
  const availableBytes = parseAvailableBytes(await run("df", ["-Pk", wrapperRoot], { quiet: true }));
  if (availableBytes < minimumFreeBytes) throw new Error("At least 4 GB of free disk space is required for the local game and Electron build.");
}

export async function loadBuildConfig() {
  const config = JSON.parse(await readFile(localBuildConfigPath, "utf8"));
  const packageJson = JSON.parse(await readFile(join(wrapperRoot, "package.json"), "utf8"));
  if (config.schemaVersion !== 1) throw new Error(`Unsupported local macOS build config schema: ${config.schemaVersion}`);
  if (config.wrapperVersion !== packageJson.version) throw new Error(`Local macOS source pins are for ${config.wrapperVersion}, but this wrapper is ${packageJson.version}.`);
  for (const key of ["gameRepository", "gameRevision", "assetsRevision", "localesRevision", "pnpmVersion"]) {
    if (typeof config[key] !== "string" || !config[key]) throw new Error(`Local macOS build config is missing ${key}.`);
  }
  return { config, version: packageJson.version };
}

function normalizeRepository(url) {
  return url.trim().replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
}

async function git(args, cwd, options = {}) {
  return run("git", args, { cwd, ...options });
}

async function ensureManagedCheckout(config) {
  await mkdir(localBuildRoot, { recursive: true });
  if (!(await exists(join(managedGamePath, ".git")))) {
    if (await exists(managedGamePath)) throw new Error(`${managedGamePath} exists but is not a Git checkout. Move it aside and run the command again.`);
    log("Cloning the pinned game repository and submodules...");
    await run("git", ["clone", "--recurse-submodules", config.gameRepository, managedGamePath], { cwd: localBuildRoot });
  } else {
    const origin = await git(["remote", "get-url", "origin"], managedGamePath, { quiet: true });
    if (normalizeRepository(origin) !== normalizeRepository(config.gameRepository)) throw new Error(`Managed game checkout has the wrong origin: ${origin}`);
    const status = await git(["status", "--porcelain", "--ignore-submodules=none"], managedGamePath, { quiet: true });
    if (status) throw new Error(`Managed game checkout has local changes. Commit or remove them from ${managedGamePath}, then retry.`);
    log("Refreshing the pinned game checkout...");
    await git(["fetch", "origin", "--tags", "--prune"], managedGamePath);
  }

  try {
    await git(["checkout", "--detach", config.gameRevision], managedGamePath);
  } catch {
    await git(["fetch", "origin", config.gameRevision], managedGamePath);
    await git(["checkout", "--detach", config.gameRevision], managedGamePath);
  }
  await git(["submodule", "sync", "--recursive"], managedGamePath);
  await git(["submodule", "update", "--init", "--recursive"], managedGamePath);

  const revisions = {
    game: await git(["rev-parse", "HEAD"], managedGamePath, { quiet: true }),
    assets: await git(["-C", "assets", "rev-parse", "HEAD"], managedGamePath, { quiet: true }),
    locales: await git(["-C", "locales", "rev-parse", "HEAD"], managedGamePath, { quiet: true }),
  };
  for (const key of Object.keys(revisions)) if (revisions[key] !== config[`${key}Revision`]) throw new Error(`Pinned ${key} revision mismatch: expected ${config[`${key}Revision`]}, got ${revisions[key]}.`);
  return revisions;
}

export function createLocalArtifactName(version) {
  return `PokeRogue-Offline-${version}-macos-arm64-LOCAL-ONLY-DO-NOT-DISTRIBUTE.dmg`;
}

export function createLocalPackageArguments(version) {
  return [
    "run",
    "package:mac",
    "--",
    "--publish",
    "never",
    "-c.mac.identity=-",
    "-c.mac.hardenedRuntime=false",
    "-c.dmg.sign=false",
    "-c.directories.output=release/local",
    `-c.mac.artifactName=PokeRogue-Offline-${version}-macos-arm64-LOCAL-ONLY-DO-NOT-DISTRIBUTE.\${ext}`,
  ];
}

async function installDependencies(gamePath, pnpmVersion) {
  log("Installing wrapper dependencies...");
  await run("npm", ["ci"], { cwd: wrapperRoot });
  log(`Installing game dependencies with pnpm ${pnpmVersion}...`);
  await run("npx", ["--yes", `pnpm@${pnpmVersion}`, "install", "--frozen-lockfile"], { cwd: gamePath });
}

async function findArtifact(version) {
  const expected = join(localOutputRoot, createLocalArtifactName(version));
  if (!(await exists(expected))) throw new Error(`Local DMG was not produced at ${expected}.`);
  return expected;
}

async function main() {
  const noOpen = process.argv.slice(2).includes("--no-open");
  const unexpected = process.argv.slice(2).filter(arg => arg !== "--no-open");
  if (unexpected.length) throw new Error(`Unknown option: ${unexpected.join(" ")}`);
  assertSupportedHost();
  await checkPrerequisites();
  const { config, version } = await loadBuildConfig();
  const revisions = await ensureManagedCheckout(config);
  log(`Using game ${revisions.game}, assets ${revisions.assets}, locales ${revisions.locales}.`);
  await installDependencies(managedGamePath, config.pnpmVersion);
  const env = { ...process.env, POKEROGUE_GAME_PATH: managedGamePath };
  log("Running wrapper tests...");
  await run("npm", ["test"], { cwd: wrapperRoot, env });
  log("Building the local ad-hoc signed Apple Silicon DMG...");
  await run("npm", createLocalPackageArguments(version), { cwd: wrapperRoot, env });
  const artifact = await findArtifact(version);
  log("Verifying the local DMG and ad-hoc signature...");
  await run(process.execPath, ["scripts/verify-mac-package.mjs", "--local", artifact], { cwd: wrapperRoot, env });
  if (!noOpen) {
    try {
      await run("open", [artifact], { cwd: wrapperRoot });
    } catch (error) {
      console.warn(`Could not open Finder automatically. Open this file manually: ${artifact}`);
    }
  }
  console.log(`\nLocal DMG ready: ${artifact}`);
  console.log("This ad-hoc build is intended for the Mac that built it and must not be distributed.");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
