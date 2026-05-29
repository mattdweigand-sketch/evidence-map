import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function getProjectRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function getDefaultBaseDir() {
  return getProjectRoot();
}
