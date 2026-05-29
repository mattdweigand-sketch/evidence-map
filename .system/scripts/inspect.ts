import { resolve } from "node:path";
import { exit } from "node:process";
import { getDefaultBaseDir } from "../src/artifacts/paths.ts";
import { buildSourcePacket } from "../src/ingest/source-packet.ts";

const input = process.argv.includes("--input") ? process.argv[process.argv.indexOf("--input") + 1] : undefined;
if (!input) {
  console.error("Usage: npm --prefix .system run inspect -- --input input/project");
  exit(1);
}

const packet = await buildSourcePacket([resolve(getDefaultBaseDir(), input)]);
console.log(JSON.stringify(packet, null, 2));
