import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { assertAllowedUrl } from "../src/updater.mjs";
import { assertDistributableArtifactName } from "./release-artifact.mjs";

export const RELEASE_PLATFORMS = Object.freeze(["windows", "macos"]);
export const RELEASE_ARCHITECTURES = Object.freeze(["x64", "arm64"]);

function sourceRevisionShape(value) {
  if (!value || typeof value !== "object") throw new Error("Manifest is missing source revisions");
  const revisions = {};
  for (const key of ["game", "assets", "locales"]) {
    if (typeof value[key] !== "string" || value[key].length === 0) throw new Error(`Manifest is missing source revision ${key}`);
    revisions[key] = value[key];
  }
  return revisions;
}

function assertArtifactList(artifacts, { allowDuplicates = false } = {}) {
  const seen = new Set();
  for (const artifact of artifacts) {
    assertArtifactCoordinates(artifact?.platform, artifact?.arch);
    const key = artifactKey(artifact);
    if (seen.has(key) && !allowDuplicates) throw new Error(`Manifest contains duplicate artifact coordinates: ${key}`);
    seen.add(key);
  }
}

export function assertManifestCompatibility(manifest, { version, revisions, allowDuplicateArtifacts = false }) {
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.version !== "string" || !Array.isArray(manifest.artifacts)) throw new Error("Malformed release manifest");
  if (manifest.version !== version) throw new Error(`Manifest version ${manifest.version} does not match package version ${version}`);
  const expected = sourceRevisionShape(revisions);
  const actual = sourceRevisionShape(manifest.sourceRevisions);
  for (const key of Object.keys(expected)) if (actual[key] !== expected[key]) throw new Error(`Manifest source revision ${key} does not match staged content`);
  assertArtifactList(manifest.artifacts, { allowDuplicates: allowDuplicateArtifacts });
  return manifest;
}

export function assertArtifactCoordinates(platform, arch) {
  if (!RELEASE_PLATFORMS.includes(platform) || !RELEASE_ARCHITECTURES.includes(arch)) throw new Error(`Unsupported release artifact coordinates: ${platform}/${arch}`);
}

export async function createArtifactRecord({ artifactPath, downloadUrl, platform, arch }) {
  assertArtifactCoordinates(platform, arch);
  const artifact = artifactPath;
  const fileName = assertDistributableArtifactName(artifact);
  assertAllowedUrl(downloadUrl);
  const [bytes, content] = await Promise.all([stat(artifact), readFile(artifact)]);
  if (!bytes.isFile() || bytes.size <= 0) throw new Error(`Release artifact is not a non-empty file: ${artifact}`);
  return {
    platform,
    arch,
    fileName: basename(fileName),
    size: bytes.size,
    sha256: createHash("sha256").update(content).digest("hex"),
    downloadUrl,
  };
}

function artifactKey(artifact) {
  return `${artifact.platform}/${artifact.arch}`;
}

export function mergeArtifact(manifest, artifact, { replaceExisting = false } = {}) {
  assertArtifactCoordinates(artifact.platform, artifact.arch);
  const artifacts = manifest.artifacts.map(item => ({ ...item }));
  const matches = artifacts.filter(item => item.platform === artifact.platform && item.arch === artifact.arch);
  if (matches.length > 0 && !replaceExisting) throw new Error(`Manifest already contains ${artifactKey(artifact)}; pass --replace to replace it`);
  if (matches.length > 0) {
    const remaining = artifacts.filter(item => item.platform !== artifact.platform || item.arch !== artifact.arch);
    remaining.push(artifact);
    artifacts.length = 0;
    artifacts.push(...remaining);
  } else artifacts.push(artifact);
  artifacts.sort((left, right) => artifactKey(left).localeCompare(artifactKey(right)));
  return { ...manifest, artifacts };
}

export function createManifest({ version, revisions, artifact }) {
  assertArtifactCoordinates(artifact.platform, artifact.arch);
  return {
    schemaVersion: 1,
    version,
    sourceRevisions: sourceRevisionShape(revisions),
    artifacts: [artifact],
  };
}
