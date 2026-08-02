import { basename } from "node:path";

const NON_RELEASE_MARKER = "DO-NOT-DISTRIBUTE";

export function assertDistributableArtifactName(artifactPath) {
  const fileName = basename(artifactPath);
  if (/DO-NOT-DISTRIBUTE|(?:^|[-_.])(smoke|dev|benchmark)(?:[-_.]|$)/i.test(fileName)) {
    throw new Error(`Refusing to publish non-release artifact: ${fileName}`);
  }
  return fileName;
}

export { NON_RELEASE_MARKER };
