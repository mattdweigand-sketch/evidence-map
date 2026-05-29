import { exit } from "node:process";
import { getDefaultBaseDir } from "../src/artifacts/paths.ts";
import { MemoryTruthLayerStore } from "../src/db/memory-store.ts";
import { runTruthLayerWorkflow } from "../src/chains/truth-layer/workflow.ts";
import type { ArtifactKind } from "../src/types.ts";

const args = parseArgs(process.argv.slice(2));
const name = args.name ?? "truth-layer-run";
const kind = (args.kind ?? "mixed") as ArtifactKind;
const input = args.input;

if (!input) {
  console.error("Usage: npm --prefix .system run run -- --name board-qbr --kind deck --input input/board-qbr");
  exit(1);
}

const result = await runTruthLayerWorkflow(new MemoryTruthLayerStore(), {
  baseDir: getDefaultBaseDir(),
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
