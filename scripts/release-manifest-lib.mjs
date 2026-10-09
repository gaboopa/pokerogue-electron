import { stat } from "node:fs/promises";
import { assertDistributableArtifactName, assertSourceRevisions, assertValidArtifact } from "../src/release-contract.mjs";
import { sha256File } from "../src/updater.mjs";

function artifactKey(artifact) {
  return `${artifact.platform}/${artifact.arch}`;
}

export async function createArtifactRecord({ artifactPath, downloadUrl, platform, arch }) {
  const bytes = await stat(artifactPath);
  if (!bytes.isFile() || bytes.size <= 0) throw new Error(`Release artifact is not a non-empty file: ${artifactPath}`);
  const record = {
    platform,
    arch,
    fileName: assertDistributableArtifactName(artifactPath),
    size: bytes.size,
    sha256: await sha256File(artifactPath),
    downloadUrl,
  };
  assertValidArtifact(record);
  return record;
}

export function mergeArtifact(manifest, artifact, { replaceExisting = false } = {}) {
  assertValidArtifact(artifact);
  const matches = item => item.platform === artifact.platform && item.arch === artifact.arch;
  if (manifest.artifacts.some(matches) && !replaceExisting) throw new Error(`Manifest already contains ${artifactKey(artifact)}; pass --replace to replace it`);
  const artifacts = manifest.artifacts.filter(item => !matches(item)).map(item => ({ ...item }));
  artifacts.push(artifact);
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
