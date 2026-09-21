import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { assertAllowedUrl, assertDistributableArtifactName, assertSourceRevisions, assertValidArtifact, assertValidRelease } from "../src/release-contract.mjs";

export { assertAllowedUrl, assertDistributableArtifactName };

export function assertManifestCompatibility(manifest, { version, revisions, allowDuplicateArtifacts = false }) {
  return assertValidRelease(manifest, { version, revisions, allowDuplicateArtifacts });
}

function artifactKey(artifact) {
  return `${artifact.platform}/${artifact.arch}`;
}

export async function createArtifactRecord({ artifactPath, downloadUrl, platform, arch }) {
  const [bytes, content] = await Promise.all([stat(artifactPath), readFile(artifactPath)]);
  if (!bytes.isFile() || bytes.size <= 0) throw new Error(`Release artifact is not a non-empty file: ${artifactPath}`);
  const record = {
    platform,
    arch,
    fileName: assertDistributableArtifactName(artifactPath),
    size: bytes.size,
    sha256: createHash("sha256").update(content).digest("hex"),
    downloadUrl,
  };
  assertValidArtifact(record);
  return record;
}

export function mergeArtifact(manifest, artifact, { replaceExisting = false } = {}) {
  assertValidArtifact(artifact);
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
  assertValidArtifact(artifact);
  return {
    schemaVersion: 1,
    version,
    sourceRevisions: assertSourceRevisions(revisions),
    artifacts: [artifact],
  };
}
