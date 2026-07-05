import { exit } from "node:process";
import { join } from "node:path";
import { getDefaultBaseDir } from "../src/artifacts/paths.ts";
import { JsonFileEvidenceMapStore } from "../src/db/json-file-store.ts";
import { runEvidenceMapWorkflow } from "../src/chains/evidence-map/workflow.ts";
import type { ArtifactKind } from "../src/types.ts";

const args = parseArgs(process.argv.slice(2));
const name = args.name ?? "evidence-map-run";
const kind = (args.kind ?? "mixed") as ArtifactKind;
const input = args.input;

if (!input) {
  console.error("Usage: npm --prefix .system run run -- --name capstone-report --kind document --input input/examples/capstone-report");
  exit(1);
}

const baseDir = getDefaultBaseDir();
const result = await runEvidenceMapWorkflow(new JsonFileEvidenceMapStore(join(baseDir, "deliverables", "evidence-map-store.json")), {
  baseDir,
  name,
  artifactKind: kind,
  inputPaths: [input]
});

console.log(`Run: ${result.run.name}`);
console.log(`Status: ${result.run.status}`);
console.log(`Readiness: ${result.trustReport.readiness}`);
console.log(`Artifacts: ${result.artifacts.runDir}`);

function parseArgs(values: string[]) {
  const output: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    if (key && value) output[key] = value;
  }
  return output;
}
