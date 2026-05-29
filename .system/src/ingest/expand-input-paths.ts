import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function expandInputPaths(inputPaths: string[]) {
  const output: string[] = [];
  for (const inputPath of inputPaths) {
    const resolved = resolve(inputPath);
    const info = await stat(resolved);
    if (info.isDirectory()) {
      const entries = await readdir(resolved);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const child = join(resolved, entry);
        const childInfo = await stat(child);
        if (childInfo.isFile()) output.push(child);
      }
    } else {
      output.push(resolved);
    }
  }
  return output.sort();
}
