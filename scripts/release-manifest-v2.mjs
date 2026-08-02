import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { wrapperRoot } from "./lib.mjs";
import { assertManifestCompatibility, createArtifactRecord, createManifest, mergeArtifact } from "./release-manifest-lib.mjs";

function usage() {
  throw new Error("Usage: npm run release:manifest -- [--base <manifest>] [--replace] <artifact> <https-download-url> <windows|macos> <x64|arm64>");
}

const args = process.argv.slice(2);
let basePath;
let replaceExisting = false;
const positional = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--base") {
    basePath = args[++index];
    if (!basePath) usage();
  } else if (arg === "--replace") {
    replaceExisting = true;
  } else {
    positional.push(arg);
  }
}
if (positional.length !== 4) usage();

const [artifactArg, downloadUrl, platform, arch] = positional;
const packageJson = JSON.parse(await readFile(resolve(wrapperRoot, "package.json"), "utf8"));
const revisions = JSON.parse(await readFile(resolve(wrapperRoot, "staging", "revisions.json"), "utf8"));
const artifact = await createArtifactRecord({ artifactPath: resolve(artifactArg), downloadUrl, platform, arch });
let manifest;
if (basePath) {
  const base = JSON.parse(await readFile(resolve(basePath), "utf8"));
  manifest = mergeArtifact(assertManifestCompatibility(base, { version: packageJson.version, revisions, allowDuplicateArtifacts: replaceExisting }), artifact, { replaceExisting });
} else {
  manifest = createManifest({ version: packageJson.version, revisions, artifact });
}

const output = resolve(wrapperRoot, "release", "release-manifest.json");
await mkdir(resolve(wrapperRoot, "release"), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${basename(output)}: ${output}`);
