import { resolve } from "node:path";
import { exit } from "node:process";
import { getDefaultBaseDir } from "../src/artifacts/paths.ts";
import { buildSourcePacket } from "../src/ingest/source-packet.ts";
import { buildLegalSourcePacketFromDrafts } from "../src/legal/source-packet.ts";
import { workflowProfiles, type WorkflowProfile } from "../src/types.ts";

const args = parseArgs(process.argv.slice(2));
const input = args.input;
const profile = parseProfile(args.profile ?? "general");
if (!input) {
  printUsage();
  exit(1);
}

const baseDir = getDefaultBaseDir();
const packet = await buildSourcePacket([resolve(baseDir, input)], { baseDir });
console.log(JSON.stringify(await withLegalSourcePacket(packet, profile), null, 2));

async function withLegalSourcePacket(packet: Awaited<ReturnType<typeof buildSourcePacket>>, profile: WorkflowProfile) {
  if (profile !== "legal") return packet;
  return {
    ...packet,
    legalSourcePacket: await buildLegalSourcePacketFromDrafts({
      runId: "preview",
      sources: packet.sources,
      inspections: packet.inspections
    })
  };
}

function parseArgs(values: string[]) {
  const output: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    if (key && value) output[key] = value;
  }
  return output;
}

function parseProfile(value: string): WorkflowProfile {
  if (workflowProfiles.includes(value as WorkflowProfile)) return value as WorkflowProfile;
  printUsage(`Invalid --profile: ${value}`);
  exit(1);
}

function printUsage(error?: string) {
  if (error) console.error(error);
  console.error("Usage: npm --prefix .system run inspect -- --profile general --input input/project");
  console.error(`Valid profiles: ${workflowProfiles.join(", ")}`);
}
