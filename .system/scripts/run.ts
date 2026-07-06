import { exit } from "node:process";
import { join } from "node:path";
import { getDefaultBaseDir } from "../src/artifacts/paths.ts";
import { JsonFileEvidenceMapStore } from "../src/db/json-file-store.ts";
import { runEvidenceMapWorkflow } from "../src/chains/evidence-map/workflow.ts";
import { artifactKinds, workflowProfiles, type ArtifactKind, type WorkflowProfile } from "../src/types.ts";

const args = parseArgs(process.argv.slice(2));
const name = String(args.name ?? "evidence-map-run");
const kind = parseKind(String(args.kind ?? "mixed"));
const profile = parseProfile(String(args.profile ?? "general"));
const input = typeof args.input === "string" ? args.input : undefined;
const generate = args.generate === true || args.generate === "true";

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
  inputPaths: [input],
  generate
});

console.log(`Run: ${result.run.name}`);
console.log(`Status: ${result.run.status}`);
console.log(`Readiness: ${result.trustReport.readiness}`);
console.log(`Artifacts: ${result.artifacts.runDir}`);
if (result.generatedOutput?.pathRelativeToRun) {
  console.log(`Generated output: ${result.generatedOutput.pathRelativeToRun}`);
}

function parseArgs(values: string[]) {
  const output: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index]?.replace(/^--/, "");
    if (!key) continue;
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      output[key] = true;
    } else {
      output[key] = next;
      index += 1;
    }
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
  console.error("Usage: npm --prefix .system run run -- --name capstone-report --kind report --profile general --input input/examples/capstone-report [--generate]");
  console.error(`Valid kinds: ${artifactKinds.join(", ")}`);
  console.error(`Valid profiles: ${workflowProfiles.join(", ")}`);
}
