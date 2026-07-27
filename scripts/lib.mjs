import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const exec = promisify(execFile);
export const wrapperRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const candidates = [resolve(wrapperRoot, "..", "PokeRogue-Offline", "pokerogue"), resolve(wrapperRoot, "..", "pokerogue")];
export const defaultGameRoot = candidates.find(path => existsSync(path)) ?? candidates[0];
export const gameRoot = resolve(process.env.POKEROGUE_GAME_PATH ?? defaultGameRoot);

export async function run(command, args, options = {}) {
  const result = await exec(command, args, { cwd: options.cwd ?? wrapperRoot, maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...options });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout.trim();
}

export async function git(args, cwd = gameRoot) {
  const trusted = [gameRoot, resolve(gameRoot, "assets"), resolve(gameRoot, "locales")]
    .flatMap(path => ["-c", `safe.directory=${path.replaceAll("\\", "/")}`]);
  return run("git", [...trusted, ...args], { cwd });
}
