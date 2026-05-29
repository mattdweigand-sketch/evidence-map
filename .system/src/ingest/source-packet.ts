import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { SourceConflict, SourceRecord, SourceStatus } from "../types.ts";
import { buildFileInspections } from "../inspect/index.ts";
import { expandInputPaths } from "./expand-input-paths.ts";

export async function buildSourcePacket(inputPaths: string[]) {
  const filePaths = await expandInputPaths(inputPaths);
  const [sources, inspections] = await Promise.all([Promise.all(filePaths.map(toSourceRecord)), buildFileInspections(filePaths)]);
  const conflicts = inferSourceConflicts(sources);
  return { sources, conflicts, inspections };
}

async function toSourceRecord(path: string): Promise<Omit<SourceRecord, "id" | "runId">> {
  const info = await stat(path);
  const name = basename(path);
  return {
    name,
    path,
    fileType: extname(path).replace(".", "").toLowerCase() || "unknown",
    status: inferStatus(name),
    sourceDate: inferDate(name),
    intendedUse: inferIntendedUse(name),
    notes: `Imported ${info.size} bytes from source folder.`
  };
}

function inferStatus(name: string): SourceStatus {
  const lower = name.toLowerCase();
  if (lower.includes("superseded") || lower.includes("old") || lower.includes("archive")) return "superseded";
  if (lower.includes("transcript") || lower.includes("call")) return "transcript";
  if (lower.includes("estimate") || lower.includes("forecast") || lower.includes("plan")) return "estimate";
  if (lower.includes("raw") || lower.includes("export")) return "raw_data";
  if (lower.includes("background") || lower.includes("reference")) return "background";
  return "unclear";
}

function inferDate(name: string) {
  const match = name.match(/(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function inferIntendedUse(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".csv")) return "Data, workbook checks, calculations, or chart backing.";
  if (lower.endsWith(".pptx")) return "Prior deck, template, narrative reference, or brand source.";
  if (lower.endsWith(".docx") || lower.endsWith(".pdf") || lower.endsWith(".md")) return "Narrative source, policy, memo, transcript, or supporting evidence.";
  return "Source material requiring human classification.";
}

function inferSourceConflicts(sources: Omit<SourceRecord, "id" | "runId">[]): Omit<SourceConflict, "id" | "runId">[] {
  const conflicts: Omit<SourceConflict, "id" | "runId">[] = [];
  const byStem = new Map<string, Omit<SourceRecord, "id" | "runId">[]>();
  for (const source of sources) {
    const stem = source.name.toLowerCase().replace(/\.(xlsx|csv|pptx|docx|pdf|md|txt)$/i, "").replace(/(old|final|v\d+|draft|copy)/g, "").trim();
    byStem.set(stem, [...(byStem.get(stem) ?? []), source]);
  }

  for (const group of byStem.values()) {
    const statuses = new Set(group.map((source) => source.status));
    if (group.length > 1 && statuses.size > 1) {
      conflicts.push({
        sourceIds: [],
        description: `Potential version/status conflict across: ${group.map((source) => source.name).join(", ")}`,
        severity: "warning",
        status: "open"
      });
    }
  }

  return conflicts;
}
