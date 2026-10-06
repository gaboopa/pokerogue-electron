import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBackup } from "../../src/backup.mjs";
import { getCapturePaths, transitionIntent } from "../../src/backup-coordinator.mjs";

export async function captureIntent(userData, intent, { seedFileName = "probe.txt", seedContent = "known-good save data" } = {}) {
  if (seedFileName) {
    await mkdir(join(userData, "Local Storage"), { recursive: true });
    await writeFile(join(userData, "Local Storage", seedFileName), seedContent);
  }
  const capturing = await transitionIntent({
    userData,
    expectedToken: intent.token,
    expectedRevision: intent.revision,
    nextState: "capturing",
  });
  const paths = getCapturePaths(userData, intent);
  await mkdir(paths.stageRoot, { recursive: true });
  const generated = await createBackup(userData, paths.stageRoot);
  await rename(generated, paths.finalBackupPath);
  await rm(paths.stageRoot, { recursive: true, force: true });
  return transitionIntent({
    userData,
    expectedToken: intent.token,
    expectedRevision: capturing.revision,
    nextState: "captured",
    capturedBackupPath: paths.finalBackupPath,
  });
}
