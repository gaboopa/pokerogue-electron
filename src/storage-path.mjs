import { join } from "node:path";
import { STORAGE_DIRECTORY_NAME } from "./constants.mjs";

export function getUserDataPath(appDataPath) {
  return join(appDataPath, STORAGE_DIRECTORY_NAME);
}
