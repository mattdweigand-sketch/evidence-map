import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { firstDateCandidate } from "../date-candidates.ts";
import type { SourceConflict, SourceRecord, SourceStatus } from "../types.ts";
import { inspectFiles, type InspectableFile } from "../inspect/index.ts";
import { expandInputPaths } from "./expand-input-paths.ts";

type SourceConflictDraft = Omit<SourceConflict, "id" | "runId"> & { sourcePaths: string[] };

export async function buildSourcePacket(inputPaths: string[]) {
  const filePaths = await expandInputPaths(inputPaths);
  const files = await Promise.all(filePaths.map(async (path) => ({ path, stat: await stat(path) })));
  const [sources, inspections] = await Promise.all([Promise.all(files.map(toSourceRecord)), inspectFiles(files)]);
  const conflicts = inferSourceConflicts(sources);
  return { sources, conflicts, inspections };
}

async function toSourceRecord(file: InspectableFile): Promise<Omit<SourceRecord, "id" | "runId">> {
  const { path } = file;
  const name = basename(path);
  return {
    name,
    path,
    fileType: extname(path).replace(".", "").toLowerCase() || "unknown",
    status: inferStatus(name),
    sourceDate: firstDateCandidate(name),
    intendedUse: inferIntendedUse(name),
    notes: `Imported ${file.stat.size} bytes from source folder.`
  };
}

function inferStatus(name: string): SourceStatus {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hasToken = (...values: string[]) => values.some((value) => tokens.includes(value));
  if (hasToken("superseded", "old", "archive", "archived")) return "superseded";
  if (hasToken("transcript", "call")) return "transcript";
  if (hasToken("estimate", "forecast", "plan")) return "estimate";
  if (hasToken("raw", "export")) return "raw_data";
  if (hasToken("background", "reference")) return "background";
  return "unclear";
}

function inferIntendedUse(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".csv")) return "Data, workbook checks, calculations, or chart backing.";
  if (lower.endsWith(".pptx")) return "Prior deck, template, narrative reference, or brand source.";
  if (lower.endsWith(".docx") || lower.endsWith(".pdf") || lower.endsWith(".md")) return "Narrative source, policy, memo, transcript, or supporting evidence.";
  return "Source material requiring human classification.";
}

function inferSourceConflicts(sources: Omit<SourceRecord, "id" | "runId">[]): SourceConflictDraft[] {
  const conflicts: SourceConflictDraft[] = [];
  const byStem = new Map<string, Omit<SourceRecord, "id" | "runId">[]>();
  for (const source of sources) {
    const stem = source.name
      .toLowerCase()
      .replace(/\.(xlsx|xlsm|csv|tsv|pptx|docx|pdf|md|txt)$/i, "")
      .split(/[^a-z0-9]+/)
      .filter((token) => token && !["old", "final", "draft", "copy"].includes(token) && !/^v\d+$/.test(token))
      .join("-");
    byStem.set(stem, [...(byStem.get(stem) ?? []), source]);
  }

  for (const group of byStem.values()) {
    const statuses = new Set(group.map((source) => source.status));
    if (group.length > 1 && statuses.size > 1) {
      conflicts.push({
        sourceIds: [],
        sourcePaths: group.map((source) => source.path),
        description: `Potential version/status conflict across: ${group.map((source) => source.name).join(", ")}`,
        severity: "warning",
        status: "open"
      });
    }
  }

  return conflicts;
}
