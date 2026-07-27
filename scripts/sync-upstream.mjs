import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { gameRoot, git, run, wrapperRoot } from "./lib.mjs";

async function requireClean(cwd, label) {
  const status = await run("git", ["status", "--porcelain"], { cwd });
  if (status) throw new Error(`${label} worktree is not clean. Commit or stash changes before synchronizing.`);
}

if (!existsSync(join(gameRoot, ".git"))) throw new Error(`Game repository not found: ${gameRoot}`);
await requireClean(wrapperRoot, "Wrapper");
await requireClean(gameRoot, "Game");

const remotes = await git(["remote"]);
if (!remotes.split(/\s+/).includes("upstream")) await git(["remote", "add", "upstream", "https://github.com/pagefaultgames/pokerogue.git"]);
await git(["fetch", "upstream", "beta", "--tags"]);

const currentBranch = await git(["branch", "--show-current"]);
if (!currentBranch) throw new Error("Synchronizing from a detached HEAD is not supported");
const currentRevision = await git(["rev-parse", "HEAD"]);
const upstreamRevision = await git(["rev-parse", "upstream/beta"]);
if (currentRevision === upstreamRevision) {
  console.log("The game repository already matches upstream/beta.");
  process.exit(0);
}

const changed = await git(["diff", "--name-status", `${currentRevision}..${upstreamRevision}`]);
const watched = changed.split(/\r?\n/).filter(line => /timed-events|egg|gacha|species|game-data|version-migration|vite|package\.json|api|assets|locales/i.test(line));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupBranch = `backup/pre-upstream-${stamp}`;
const updateBranch = `updates/upstream-${stamp}`;
const reportDir = join(wrapperRoot, "staging", "upstream-reports");
await mkdir(reportDir, { recursive: true });
await writeFile(join(reportDir, `${stamp}.md`), [
  "# Upstream synchronization report", "", `- Previous game revision: \`${currentRevision}\``,
  `- Upstream revision: \`${upstreamRevision}\``, `- Original branch: \`${currentBranch}\``, "",
  "## Watched changes", "", watched.length ? watched.map(line => `- \`${line}\``).join("\n") : "No watched paths changed.",
  "", "## All changes", "", "```text", changed, "```", "",
].join("\n"));

await git(["branch", backupBranch, currentRevision]);
await git(["switch", "-c", updateBranch]);
console.log(`Backup branch created: ${backupBranch}`);
console.log(`Update branch created: ${updateBranch}`);
try {
  await git(["merge", "--no-ff", "--no-edit", "upstream/beta"]);
} catch (error) {
  console.error("The upstream merge has conflicts. Resolve them on the update branch, then run the validation commands documented in README.md.");
  throw error;
}
await git(["submodule", "sync", "--recursive"]);
await git(["submodule", "update", "--init", "--recursive", "--depth", "1"]);

await run(process.execPath, [join(gameRoot, "node_modules", "typescript", "bin", "tsc"), "--noEmit"], { cwd: gameRoot });
await run(process.execPath, [join(gameRoot, "node_modules", "vitest", "vitest.mjs"), "run", "--silent=passed-only"], { cwd: gameRoot });
await run(process.execPath, [join(wrapperRoot, "scripts", "build-game.mjs")], { cwd: wrapperRoot });
await run(process.execPath, ["--test", join(wrapperRoot, "test", "*.test.mjs")], { cwd: wrapperRoot, shell: true });
console.log("Upstream merge and validation completed. Review the report and smoke-test before merging this update branch.");
