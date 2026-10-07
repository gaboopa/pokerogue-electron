import { BACKUP_INTENT_OPERATIONS, BACKUP_INTENT_STATES, parseBackupName } from "./backup-coordinator.mjs";

const unavailable = "unavailable";
const revision = value => typeof value === "string" && /^[a-f\d]{40,64}$/i.test(value) ? value : unavailable;
const version = value => typeof value === "string" && /^\d+(?:\.\d+){2,}(?:[-+][a-z\d.-]+)?$/i.test(value) ? value : unavailable;

export function summarizeBackups(names) {
  const backups = names.map(parseBackupName).filter(Boolean).sort((left, right) => left.stamp.localeCompare(right.stamp));
  return backups.length ? { count: backups.length, latest: backups.at(-1).stamp, operation: backups.at(-1).operation } : { count: 0 };
}

export function formatDiagnosticReport(facts) {
  const profile = facts.profileName === null ? "default"
    : typeof facts.profileName === "string" && facts.profileName !== unavailable ? "named" : unavailable;
  const profileCount = Number.isSafeInteger(facts.profileCount) && facts.profileCount > 0 ? facts.profileCount : unavailable;
  const backupCount = Number.isSafeInteger(facts.backups?.count) && facts.backups.count >= 0 ? facts.backups.count : unavailable;
  const backupStamp = typeof facts.backups?.latest === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/.test(facts.backups.latest)
    ? facts.backups.latest : unavailable;
  const backupOperation = BACKUP_INTENT_OPERATIONS.includes(facts.backups?.operation) ? facts.backups.operation : unavailable;
  const backups = backupCount === 0
    ? "Backups: 0"
    : backupCount === unavailable
      ? "Backups: unavailable"
      : `Backups: ${backupCount}, latest ${backupStamp} (${backupOperation})`;
  const pending = facts.pending === null ? "none"
    : facts.pending === unavailable || !facts.pending
      ? unavailable
      : `${BACKUP_INTENT_OPERATIONS.includes(facts.pending.operation) ? facts.pending.operation : unavailable} (${BACKUP_INTENT_STATES.includes(facts.pending.state) ? facts.pending.state : unavailable})`;

  return [
    "PokeRogue Offline diagnostic report",
    `Version: ${version(facts.version)} (${facts.packaged === true ? "packaged" : facts.packaged === false ? "development" : unavailable})`,
    `Platform: ${["win32", "darwin", "linux", "freebsd", "openbsd", "sunos", "aix"].includes(facts.platform) ? facts.platform : unavailable} ${["x64", "arm64", "ia32", "arm", "ppc64", "s390x", "riscv64"].includes(facts.arch) ? facts.arch : unavailable}, ${typeof facts.osVersion === "string" && /^[A-Za-z][A-Za-z0-9 ._-]{0,80}$/.test(facts.osVersion) ? facts.osVersion : unavailable}`,
    `Electron ${version(facts.electron)}, Chrome ${version(facts.chrome)}, Node ${version(facts.node)}`,
    `Game revision: ${revision(facts.revisions?.game)}`,
    `Assets revision: ${revision(facts.revisions?.assets)}`,
    `Locales revision: ${revision(facts.revisions?.locales)}`,
    `Profile: ${profile} (${profileCount} ${profileCount === 1 ? "profile" : "profiles"})`,
    backups,
    `Pending operation: ${pending}`,
  ].join("\n");
}
