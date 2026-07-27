import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gameRoot, git, run, wrapperRoot } from "./lib.mjs";

if (!existsSync(join(gameRoot, "package.json"))) throw new Error(`Game repository not found: ${gameRoot}`);
for (const path of ["assets/service-worker.js", "assets/logo512.png", "locales/en"]) if (!existsSync(join(gameRoot, path))) throw new Error(`Required game content is missing: ${path}`);

const vite = join(gameRoot, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(vite)) throw new Error("Game dependencies are not installed; run pnpm install in the game repository first");
const stageOnly = process.argv.includes("--stage-only");
if (!stageOnly) await run(process.execPath, [vite, "build", "--mode", "app"], { cwd: gameRoot });
if (!existsSync(join(gameRoot, "dist", "index.html"))) throw new Error("The game dist directory is missing; run without --stage-only first");

const staging = join(wrapperRoot, "staging");
await rm(staging, { recursive: true, force: true });
await mkdir(join(staging, "game"), { recursive: true });
await cp(join(gameRoot, "dist"), join(staging, "game"), { recursive: true });

const indexPath = join(staging, "game", "index.html");
let html = await readFile(indexPath, "utf8");
html = html.replace(/<script>\s*if \("serviceWorker" in navigator\)[\s\S]*?<\/script>/, "<!-- Service worker disabled by the Electron wrapper. -->");
await writeFile(indexPath, html);

const revisions = {
  builtAt: new Date().toISOString(),
  game: await git(["rev-parse", "HEAD"]),
  assets: await git(["-C", "assets", "rev-parse", "HEAD"]),
  locales: await git(["-C", "locales", "rev-parse", "HEAD"]),
};
await writeFile(join(staging, "revisions.json"), JSON.stringify(revisions, null, 2));
await mkdir(join(staging, "licenses"), { recursive: true });
for (const source of ["LICENSE", "CREDITS.md", "REUSE.toml"]) if (existsSync(join(gameRoot, source))) await cp(join(gameRoot, source), join(staging, "licenses", source));
for (const submodule of ["assets", "locales"]) {
  const target = join(staging, "licenses", submodule);
  await mkdir(target, { recursive: true });
  for (const source of ["LICENSE", "LICENSES", "README.md", "REUSE.toml"]) if (existsSync(join(gameRoot, submodule, source))) await cp(join(gameRoot, submodule, source), join(target, source), { recursive: true });
}
console.log(`Staged game ${revisions.game} at ${join(staging, "game")}`);
