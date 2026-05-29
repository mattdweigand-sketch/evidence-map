import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function expandInputPaths(inputPaths: string[]) {
  const output: string[] = [];
  for (const inputPath of inputPaths) {
    const resolved = resolve(inputPath);
    const info = await stat(resolved);
    if (info.isDirectory()) {
      output.push(...(await expandDirectory(resolved)));
    } else {
      output.push(resolved);
    }
  }
  return output.sort();
}

async function expandDirectory(dir: string): Promise<string[]> {
  const output: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const child = join(dir, entry);
    const childInfo = await stat(child);
    if (childInfo.isDirectory()) {
      output.push(...(await expandDirectory(child)));
    } else if (childInfo.isFile()) {
      output.push(child);
    }
  }
  return output;
}
