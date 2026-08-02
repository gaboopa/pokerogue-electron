import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { wrapperRoot } from "./lib.mjs";
import { assertDistributableArtifactName } from "./package-win.mjs";

const [artifactArg, downloadUrl, platform, arch] = process.argv.slice(2);
if (!artifactArg || !downloadUrl || !["windows", "macos"].includes(platform) || !["x64", "arm64"].includes(arch)) {
  throw new Error("Usage: npm run release:manifest -- <artifact> <https-download-url> <windows|macos> <x64|arm64>");
}
const artifact = resolve(artifactArg);
assertDistributableArtifactName(artifact);
const packageJson = JSON.parse(await readFile(resolve(wrapperRoot, "package.json"), "utf8"));
const revisions = JSON.parse(await readFile(resolve(wrapperRoot, "staging", "revisions.json"), "utf8"));
const manifest = {
  schemaVersion: 1,
  version: packageJson.version,
  sourceRevisions: { game: revisions.game, assets: revisions.assets, locales: revisions.locales },
  artifacts: [{ platform, arch, fileName: basename(artifact), size: (await stat(artifact)).size, sha256: createHash("sha256").update(await readFile(artifact)).digest("hex"), downloadUrl }],
};
const output = resolve(wrapperRoot, "release", "release-manifest.json");
await writeFile(output, JSON.stringify(manifest, null, 2));
console.log(output);
