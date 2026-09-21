import { basename } from "node:path";
import { ALLOWED_UPDATE_HOSTS } from "./constants.mjs";

export const RELEASE_PLATFORMS = Object.freeze(["windows", "macos"]);
export const RELEASE_ARCHITECTURES = Object.freeze(["x64", "arm64"]);
export const NON_RELEASE_MARKER = "DO-NOT-DISTRIBUTE";

const NON_DISTRIBUTABLE_PATTERN = /DO-NOT-DISTRIBUTE|(?:^|[-_.])(smoke|dev|benchmark)(?:[-_.]|$)/i;

export function assertAllowedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_UPDATE_HOSTS.has(url.hostname)) throw new Error(`Update URL is not allowed: ${url.origin}`);
  return url;
}

export function assertDistributableArtifactName(artifactPath) {
  const fileName = basename(artifactPath);
  if (NON_DISTRIBUTABLE_PATTERN.test(fileName)) throw new Error(`Refusing to publish non-release artifact: ${fileName}`);
  return fileName;
}

export function assertArtifactCoordinates(platform, arch) {
  if (!RELEASE_PLATFORMS.includes(platform) || !RELEASE_ARCHITECTURES.includes(arch)) throw new Error(`Unsupported release artifact coordinates: ${platform}/${arch}`);
}

function assertDistributableFileName(fileName, coordinates) {
  if (typeof fileName !== "string" || fileName.length === 0 || NON_DISTRIBUTABLE_PATTERN.test(fileName)) throw new Error(`Release artifact ${coordinates} has a non-distributable fileName`);
}

export function assertSourceRevisions(value) {
  if (!value || typeof value !== "object") throw new Error("Manifest is missing source revisions");
  const revisions = {};
  for (const key of ["game", "assets", "locales"]) {
    if (typeof value[key] !== "string" || value[key].length === 0) throw new Error(`Manifest is missing source revision ${key}`);
    revisions[key] = value[key];
  }
  return revisions;
}

export function assertValidRelease(manifest, { version, revisions, allowDuplicateArtifacts = false } = {}) {
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.version !== "string" || manifest.version.length === 0 || !Array.isArray(manifest.artifacts)) throw new Error("Malformed release manifest");
  if (version !== undefined && manifest.version !== version) throw new Error(`Manifest version ${manifest.version} does not match package version ${version}`);
  const manifestRevisions = assertSourceRevisions(manifest.sourceRevisions);
  if (revisions !== undefined) {
    const expected = assertSourceRevisions(revisions);
    for (const key of Object.keys(expected)) if (manifestRevisions[key] !== expected[key]) throw new Error(`Manifest source revision ${key} does not match staged content`);
  }
  for (const artifact of manifest.artifacts) assertValidArtifact(artifact);
  const seen = new Set();
  for (const artifact of manifest.artifacts) {
    const key = `${artifact.platform}/${artifact.arch}`;
    if (seen.has(key) && !allowDuplicateArtifacts) throw new Error(`Manifest contains duplicate artifact coordinates: ${key}`);
    seen.add(key);
  }
  return manifest;
}

export function assertValidArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") throw new Error("Release manifest contains a malformed artifact");
  const coordinates = `${artifact.platform}/${artifact.arch}`;
  assertArtifactCoordinates(artifact.platform, artifact.arch);
  assertDistributableFileName(artifact.fileName, coordinates);
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) throw new Error(`Release artifact ${coordinates} size is not a positive safe integer`);
  if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) throw new Error(`Release artifact ${coordinates} sha256 is not a 64-character hex digest`);
  assertAllowedUrl(artifact.downloadUrl);
  return artifact;
}
