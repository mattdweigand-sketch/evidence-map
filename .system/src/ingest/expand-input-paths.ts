import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export async function expandInputPaths(inputPaths: string[], options: { baseDir?: string } = {}) {
  const realBaseDir = options.baseDir ? await realpath(resolve(options.baseDir)) : undefined;
  const output: string[] = [];
  for (const inputPath of inputPaths) {
    const resolved = resolve(inputPath);
    const realInputPath = await realpath(resolved);
    assertInsideBaseDir({ originalPath: inputPath, realPath: realInputPath, realBaseDir });
    const linkInfo = await lstat(resolved);
    const info = linkInfo.isSymbolicLink() ? await stat(resolved) : linkInfo;
    if (info.isDirectory()) {
      output.push(...(await expandDirectory(resolved, realBaseDir)));
    } else {
      output.push(resolved);
    }
  }
  return output.sort();
}

async function expandDirectory(dir: string, realBaseDir: string | undefined): Promise<string[]> {
  const output: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const child = join(dir, entry);
    const realChild = await realpath(child);
    assertInsideBaseDir({ originalPath: child, realPath: realChild, realBaseDir });
    const linkInfo = await lstat(child);
    const childInfo = linkInfo.isSymbolicLink() ? await stat(child) : linkInfo;
    if (childInfo.isDirectory()) {
      output.push(...(await expandDirectory(child, realBaseDir)));
    } else if (childInfo.isFile()) {
      output.push(child);
    }
  }
  return output;
}

function assertInsideBaseDir(input: {
  originalPath: string;
  realPath: string;
  realBaseDir: string | undefined;
}) {
  if (!input.realBaseDir) return;
  const relativePath = relative(input.realBaseDir, input.realPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Input path ${input.originalPath} real path escapes baseDir: ${input.realPath}`);
  }
}
