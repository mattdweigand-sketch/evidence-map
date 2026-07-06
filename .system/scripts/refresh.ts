import { exit } from "node:process";
import { join } from "node:path";
import { getDefaultBaseDir } from "../src/artifacts/paths.ts";
import { JsonFileEvidenceMapStore } from "../src/db/json-file-store.ts";
import { runEvidenceMapRefresh } from "../src/refresh/workflow.ts";
import { artifactKinds, workflowProfiles, type ArtifactKind, type WorkflowProfile } from "../src/types.ts";

const args = parseArgs(process.argv.slice(2));
const priorRunId = typeof args["from-run"] === "string" ? args["from-run"] : undefined;
const name = String(args.name ?? "evidence-map-refresh");
const kind = parseKind(String(args.kind ?? "mixed"));
const profile = parseProfile(String(args.profile ?? "general"));
const input = typeof args.input === "string" ? args.input : undefined;
const generate = args.generate === true || args.generate === "true";
const draftFiles =
  typeof args.draft === "string"
    ? args.draft
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined;

if (!priorRunId || !input) {
  printUsage();
  exit(1);
}

const baseDir = getDefaultBaseDir();
const result = await runEvidenceMapRefresh(new JsonFileEvidenceMapStore(join(baseDir, "deliverables", "evidence-map-store.json")), {
  baseDir,
  priorRunId,
  name,
  artifactKind: kind,
  profile,
  inputPaths: [input],
  draftFiles,
  generate
});

console.log(`Refresh from: ${result.refreshReceipt.priorRunId}`);
console.log(`Run: ${result.run.name}`);
console.log(`Status: ${result.run.status}`);
console.log(`Readiness: ${result.trustReport.readiness}`);
console.log(`Artifacts: ${result.artifacts.runDir}`);
console.log("Refresh receipt: 00_refresh/refresh-receipt.json");

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
  console.error(
    "Usage: npm --prefix .system run refresh -- --from-run <run-id> --name capstone-report-refresh --kind report --profile general --input input/examples/capstone-report [--draft file1.md,file2.md] [--generate]"
  );
  console.error(`Valid kinds: ${artifactKinds.join(", ")}`);
  console.error(`Valid profiles: ${workflowProfiles.join(", ")}`);
}
