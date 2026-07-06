import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { firstDateCandidate } from "../date-candidates.ts";
import type { SourceConflict, SourceRecord, SourceStatus } from "../types.ts";
import { inspectFiles, type InspectableFile } from "../inspect/index.ts";
import { expandInputPaths } from "./expand-input-paths.ts";

type SourceConflictDraft = Omit<SourceConflict, "id" | "runId"> & { sourcePaths: string[] };
type SourceRecordDraft = Omit<SourceRecord, "id" | "runId">;

const versionOrStatusTokens = new Set(["old", "final", "draft", "copy", "raw", "export", "exports"]);
const dataFileTypes = new Set(["csv", "tsv", "xls", "xlsx", "xlsm"]);

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

function inferSourceConflicts(sources: SourceRecordDraft[]): SourceConflictDraft[] {
  const conflicts: SourceConflictDraft[] = [];
  const byStem = new Map<string, SourceRecordDraft[]>();
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

  const existingConflictKeys = new Set(conflicts.map((conflict) => conflictKey(conflict.sourcePaths)));
  const byMetric = new Map<string, SourceRecordDraft[]>();
  for (const source of sources) {
    const key = sameMetricKey(source);
    if (!key) continue;
    byMetric.set(key, [...(byMetric.get(key) ?? []), source]);
  }

  for (const group of byMetric.values()) {
    const dates = new Set(group.map((source) => source.sourceDate).filter(Boolean));
    const sourcePaths = group.map((source) => source.path);
    if (group.length < 2 || dates.size < 2 || !hasRelatedFileTypes(group) || existingConflictKeys.has(conflictKey(sourcePaths))) {
      continue;
    }
    conflicts.push({
      sourceIds: [],
      sourcePaths,
      description: `Potential same-metric dated conflict across: ${group.map((source) => source.name).join(", ")}`,
      severity: "warning",
      status: "open"
    });
  }

  return conflicts;
}

function sameMetricKey(source: SourceRecordDraft) {
  if (!dataFileTypes.has(source.fileType)) return undefined;
  if (!source.sourceDate) return undefined;
  const stem = stripSourceDate(
    source.name.toLowerCase().replace(/\.(xlsx|xlsm|csv|tsv|pptx|docx|pdf|md|txt)$/i, ""),
    source.sourceDate
  );
  const tokens = stem
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !versionOrStatusTokens.has(token) && !/^v\d+$/.test(token) && /[a-z]/.test(token));
  if (tokens.length < 2) return undefined;
  return tokens.join("-");
}

function stripSourceDate(value: string, sourceDate: string) {
  const [year, month, day] = sourceDate.split("-");
  const monthNumber = String(Number(month));
  const dayNumber = String(Number(day));
  const patterns = [
    `${year}[-_/]?${month}${day}`,
    `${year}[-_/]${month}[-_/]${day}`,
    `0?${monthNumber}[-_/]0?${dayNumber}[-_/]${year}`
  ];
  return patterns.reduce((current, pattern) => current.replace(new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "g"), "$1$2"), value);
}

function hasRelatedFileTypes(group: SourceRecordDraft[]) {
  const fileTypes = [...new Set(group.map((source) => source.fileType))];
  return fileTypes.every((fileType) => dataFileTypes.has(fileType));
}

function conflictKey(sourcePaths: string[]) {
  return [...sourcePaths].sort().join("\0");
}
