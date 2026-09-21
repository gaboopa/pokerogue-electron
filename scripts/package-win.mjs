import { readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Arch, build, Platform } from "electron-builder";
import { prepareWindowsCache, WINDOWS_CACHE_RELATIVE_PATH, WINDOWS_CACHE_SCHEMA_VERSION } from "./package-win-cache.mjs";
import { wrapperRoot } from "./lib.mjs";

export const WINDOWS_PACKAGE_MODES = Object.freeze(["release", "smoke", "staged"]);
export { WINDOWS_CACHE_SCHEMA_VERSION, WINDOWS_CACHE_RELATIVE_PATH };
import { assertDistributableArtifactName, NON_RELEASE_MARKER } from "./release-artifact.mjs";
export { assertDistributableArtifactName };

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
    cache = await prepareWindowsCache({
      root,
      baseBuild: sourceBuild,
      npmRebuild: mode === "release",
      force: mode === "release",
      buildFn,
    });
    console.log(`Using staged game ${cache.revisions.game}`);
    console.log(`Assets ${cache.revisions.assets}; locales ${cache.revisions.locales}`);
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
