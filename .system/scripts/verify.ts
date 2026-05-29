import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { exit } from "node:process";
import { getDefaultBaseDir } from "../src/artifacts/paths.ts";

const runDir = process.argv.includes("--run") ? process.argv[process.argv.indexOf("--run") + 1] : undefined;
if (!runDir) {
  console.error("Usage: npm --prefix .system run verify -- --run deliverables/project");
  exit(1);
}

const reportPath = join(getDefaultBaseDir(), runDir, "03_verification", "trust-report.json");
try {
  await access(reportPath);
  console.log(await readFile(reportPath, "utf8"));
} catch {
  console.error(`No trust report found at ${reportPath}`);
  exit(1);
}
