import { exit } from "node:process";
import { join } from "node:path";
import { getDefaultBaseDir } from "../src/artifacts/paths.ts";
import { JsonFileEvidenceMapStore } from "../src/db/json-file-store.ts";
import { runEvidenceMapWorkflow } from "../src/chains/evidence-map/workflow.ts";
import { artifactKinds, workflowProfiles, type ArtifactKind, type WorkflowProfile } from "../src/types.ts";

const args = parseArgs(process.argv.slice(2));
const name = args.name ?? "evidence-map-run";
const kind = parseKind(args.kind ?? "mixed");
const profile = parseProfile(args.profile ?? "general");
const input = args.input;

if (!input) {
  printUsage();
  exit(1);
}

const baseDir = getDefaultBaseDir();
const result = await runEvidenceMapWorkflow(new JsonFileEvidenceMapStore(join(baseDir, "deliverables", "evidence-map-store.json")), {
  baseDir,
  name,
  artifactKind: kind,
  profile,
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

function parseKind(value: string): ArtifactKind {
  if (artifactKinds.includes(value as ArtifactKind)) return value as ArtifactKind;
  printUsage(`Invalid --kind: ${value}`);
  exit(1);
}

function parseProfile(value: string): WorkflowProfile {
  if (workflowProfiles.includes(value as WorkflowProfile)) return value as WorkflowProfile;
  printUsage(`Invalid --profile: ${value}`);
  exit(1);
}

function printUsage(error?: string) {
  if (error) console.error(error);
  console.error("Usage: npm --prefix .system run run -- --name capstone-report --kind document --profile general --input input/examples/capstone-report");
  console.error(`Valid kinds: ${artifactKinds.join(", ")}`);
  console.error(`Valid profiles: ${workflowProfiles.join(", ")}`);
}
