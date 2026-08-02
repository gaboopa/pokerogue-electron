import { extname } from "node:path";

export function shouldStageGamePath(path) {
  return extname(path).toLowerCase() !== ".map";
}
