import { spawn } from "node:child_process";
import { join } from "node:path";
import { run, wrapperRoot } from "./lib.mjs";

await run(process.execPath, [join(wrapperRoot, "scripts", "build-game.mjs")]);
const electron = process.platform === "win32"
  ? join(wrapperRoot, "node_modules", "electron", "dist", "electron.exe")
  : join(wrapperRoot, "node_modules", ".bin", "electron");
const child = spawn(electron, ["."], { cwd: wrapperRoot, stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 0));
