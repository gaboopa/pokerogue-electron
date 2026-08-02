import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Arch, build, Platform } from "electron-builder";
import { createWindowsBuildConfig, prepareWindowsCache, validateStaging } from "./package-win.mjs";
import { wrapperRoot } from "./lib.mjs";

export const BENCHMARK_KINDS = Object.freeze(["current", "hybrid", "zip"]);
export const HYBRID_PRECOMPRESSED_EXTENSIONS = Object.freeze([
  ".avi", ".mov", ".m4v", ".mp4", ".m4p", ".qt", ".mkv", ".webm", ".vmdk",
  ".mp3", ".m4a", ".png", ".ico", ".ttf",
]);

export function createBenchmarkConfig(baseBuild, kind) {
  if (!BENCHMARK_KINDS.includes(kind)) throw new Error(`Unknown benchmark kind: ${kind}`);
  const config = createWindowsBuildConfig(baseBuild, kind === "zip" ? "staged" : "release");
  config.npmRebuild = false;
  config.extraResources = null;
  config.directories.output = `release/benchmark/${kind}`;
  config.win.artifactName = `PokeRogue-Offline-Benchmark-${kind}-DO-NOT-DISTRIBUTE.\${ext}`;
  if (kind === "current") {
    delete config.nsis.differentialPackage;
    delete config.nsis.useZip;
    delete config.nsis.preCompressedFileExtensions;
  } else if (kind === "hybrid") {
    delete config.nsis.differentialPackage;
    delete config.nsis.useZip;
    config.nsis.preCompressedFileExtensions = [...HYBRID_PRECOMPRESSED_EXTENSIONS];
  }
  return config;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function compareBenchmarkCandidate(baseline, candidate) {
  const timeImprovementPercent = Number((((baseline.installerSeconds - candidate.installerSeconds) / baseline.installerSeconds) * 100).toFixed(1));
  const sizeGrowthPercent = Number((((candidate.bytes - baseline.bytes) / baseline.bytes) * 100).toFixed(1));
  return {
    ...candidate,
    timeImprovementPercent,
    sizeGrowthPercent,
    packagingThresholdsPassed: timeImprovementPercent >= 30 && sizeGrowthPercent <= 10,
  };
}

export function selectBenchmarkCandidate(baseline, candidates) {
  const compared = candidates.map(candidate => compareBenchmarkCandidate(baseline, candidate));
  const eligible = compared.filter(candidate => candidate.packagingThresholdsPassed).sort((left, right) => left.installerSeconds - right.installerSeconds);
  return { candidates: compared, selected: eligible[0]?.kind ?? null };
}

export async function runBenchmarkVariant({ baseBuild, kind, prepackagedPath, cacheSeconds = 0, root = wrapperRoot, buildFn = build }) {
  const config = createBenchmarkConfig(baseBuild, kind);
  await rm(join(root, ...config.directories.output.split("/")), { recursive: true, force: true });
  const startedAt = performance.now();
  const artifacts = await buildFn({
    projectDir: root,
    targets: Platform.WINDOWS.createTarget("nsis", Arch.x64),
    config,
    prepackaged: prepackagedPath,
  });
  const artifact = artifacts.find(path => path.endsWith(".exe") && !path.endsWith(".__uninstaller.exe"));
  if (!artifact) throw new Error(`No ${kind} benchmark installer was produced`);
  const installerSeconds = Number(((performance.now() - startedAt) / 1000).toFixed(1));
  return {
    kind,
    artifact,
    installerSeconds,
    cacheSeconds,
    totalSeconds: Number((installerSeconds + cacheSeconds).toFixed(1)),
    bytes: (await stat(artifact)).size,
    sha256: await sha256File(artifact),
    blockmapPresent: artifacts.some(path => path.endsWith(".blockmap")),
  };
}

export async function runWindowsPackagingBenchmark({ root = wrapperRoot, buildFn = build } = {}) {
  await validateStaging(root);
  const benchmarkRoot = join(root, "release", "benchmark");
  await rm(benchmarkRoot, { recursive: true, force: true });
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const cache = await prepareWindowsCache({ root, baseBuild: packageJson.build, mode: "staged", buildFn });
  const variants = [];
  for (const kind of BENCHMARK_KINDS) {
    variants.push(await runBenchmarkVariant({
      baseBuild: packageJson.build,
      kind,
      prepackagedPath: cache.prepackagedPath,
      cacheSeconds: cache.durationSeconds,
      root,
      buildFn,
    }));
  }
  const baseline = variants[0];
  const selection = selectBenchmarkCandidate(baseline, variants.slice(1));
  const results = {
    generatedAt: new Date().toISOString(),
    cache: {
      reused: cache.reused,
      preparationSeconds: cache.durationSeconds,
      fingerprint: cache.descriptor.fingerprint,
      revisions: cache.descriptor.revisions,
      inventory: cache.descriptor.inventory,
    },
    baseline,
    candidates: selection.candidates,
    selectedCandidate: selection.selected,
    productionConfigurationChanged: false,
    manualAcceptanceStillRequired: [
      "clean install",
      "install-over-install upgrade",
      "cancellation",
      "application launch",
      "shortcuts",
      "Add/Remove Programs identity",
      "checksum verification",
      "save preservation",
      "uninstall",
    ],
  };
  const output = join(benchmarkRoot, "results.json");
  await mkdir(benchmarkRoot, { recursive: true });
  await writeFile(output, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log(`Benchmark results: ${output}`);
  console.log(selection.selected ? `Fastest threshold-qualified candidate: ${selection.selected}; production remains unchanged pending acceptance tests.` : "No candidate met the production thresholds; retaining current production compression.");
  return results;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await runWindowsPackagingBenchmark();
