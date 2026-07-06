import type { FileInspectionRecord, SourceEvidenceRecord, SourceRecord, SourceStatus } from "../types.ts";
import { workbookInspectionFindings } from "../verify/workbook-findings.ts";

export interface SourceExclusion {
  sourceId: string;
  sourceName: string;
  reason: string;
}

export interface EvidenceSelectionResult {
  evidence: SourceEvidenceRecord[];
  selectedEvidence: SourceEvidenceRecord[];
  excludedEvidence: SourceEvidenceRecord[];
  sourceExclusions: SourceExclusion[];
  blockers: string[];
  warnings: string[];
}

interface SourceAssessment {
  source: SourceRecord;
  effectiveStatus: SourceStatus;
  inspection?: FileInspectionRecord;
  sourceExclusionReason?: string;
}

export function selectSourceEvidence(input: {
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
  evidence: SourceEvidenceRecord[];
}): EvidenceSelectionResult {
  const inspectionBySourceId = new Map(input.inspections.filter((inspection) => inspection.sourceId).map((inspection) => [inspection.sourceId, inspection]));
  const assessments = new Map(
    input.sources.map((source) => [
      source.id,
      assessSource({
        source,
        inspection: inspectionBySourceId.get(source.id)
      })
    ])
  );

  let evidence = input.evidence.map((item) => applyEvidenceSelectionRules(item, assessments.get(item.sourceId)));
  let selectedEvidence = evidence.filter((item) => item.useStatus === "selected");

  if (selectedEvidence.length === 0) {
    const fallbackIds = fallbackEvidenceIds(evidence, assessments);
    if (fallbackIds.size > 0) {
      evidence = evidence.map((item) =>
        fallbackIds.has(item.id)
          ? {
              ...item,
              useStatus: "selected",
              exclusionReason: undefined
            }
          : item
      );
      selectedEvidence = evidence.filter((item) => item.useStatus === "selected");
    }
  }

  const excludedEvidence = evidence.filter((item) => item.useStatus === "excluded");
  const sourceExclusions = sourceExclusionsFor(evidence, assessments);
  const blockers = [
    ...blockingSelectionIssues({ evidence, selectedEvidence, assessments }),
    ...currentMetricConflictBlockers({ selectedEvidence, assessments })
  ];
  const warnings = sourceExclusions.map((exclusion) => `${exclusion.sourceName}: ${exclusion.reason}`);

  return {
    evidence,
    selectedEvidence,
    excludedEvidence,
    sourceExclusions,
    blockers: unique(blockers),
    warnings: unique(warnings)
  };
}

function assessSource(input: { source: SourceRecord; inspection?: FileInspectionRecord }): SourceAssessment {
  const effectiveStatus = effectiveSourceStatus(input.source);
  const sourceExclusionReason = sourceLevelExclusionReason(input.source, effectiveStatus, input.inspection);
  return {
    source: input.source,
    effectiveStatus,
    inspection: input.inspection,
    sourceExclusionReason
  };
}

function applyEvidenceSelectionRules(item: SourceEvidenceRecord, assessment: SourceAssessment | undefined): SourceEvidenceRecord {
  if (!assessment) return excludeEvidence(item, "Source record is missing.");
  if (assessment.sourceExclusionReason) return excludeEvidence(item, assessment.sourceExclusionReason);
  if (item.numberCandidates.length > 0 && !item.sourceDate) {
    return excludeEvidence(item, "Number-bearing evidence has no source date and cannot support numeric output claims.");
  }
  if (isPreferredStatus(assessment.effectiveStatus)) {
    return {
      ...item,
      useStatus: "selected",
      exclusionReason: undefined
    };
  }
  return excludeEvidence(item, `Source status ${assessment.effectiveStatus} is not selected for generated output.`);
}

function sourceLevelExclusionReason(source: SourceRecord, effectiveStatus: SourceStatus, inspection: FileInspectionRecord | undefined) {
  if (effectiveStatus === "superseded") return "Superseded or archived source excluded from generated output.";
  if (source.fileType === "xlsx" || source.fileType === "xlsm") {
    if (!inspection) return "Workbook has no inspection and is excluded from generated output.";
    const workbookFindings = workbookInspectionFindings(inspection);
    const hardFindings = workbookFindings.filter((finding) => finding.severity === "must_fix");
    if (hardFindings.length > 0) {
      return `Workbook has unresolved calculation risks: ${hardFindings.map((finding) => trimSentencePunctuation(finding.issue)).join("; ")}.`;
    }
  }
  if (!inspection) return "Source has no inspection and is excluded from generated output.";
  if (inspection.status === "failed") return `Source inspection failed: ${inspection.warnings.join(" ") || "No parser output."}`;
  if (inspection.status === "unsupported") return `Source type is not inspectable yet: ${inspection.warnings.join(" ") || "Unsupported source."}`;
  if (inspection.status === "metadata_only") return `Source has metadata only: ${inspection.warnings.join(" ") || "No extractable evidence."}`;
  if (effectiveStatus === "background") return "Background-only source excluded from generated output.";
  if (effectiveStatus === "estimate") return "Estimate source excluded from generated output unless explicitly reviewed.";
  return undefined;
}

function fallbackEvidenceIds(evidence: SourceEvidenceRecord[], assessments: Map<string, SourceAssessment>) {
  const fallback = new Set<string>();
  for (const item of evidence) {
    const assessment = assessments.get(item.sourceId);
    if (!assessment || assessment.sourceExclusionReason) continue;
    if (item.numberCandidates.length > 0 && !item.sourceDate) continue;
    if (item.useStatus !== "excluded" || !item.exclusionReason?.startsWith("Source status unclear")) continue;
    fallback.add(item.id);
  }
  return fallback;
}

function blockingSelectionIssues(input: {
  evidence: SourceEvidenceRecord[];
  selectedEvidence: SourceEvidenceRecord[];
  assessments: Map<string, SourceAssessment>;
}) {
  const blockers: string[] = [];
  const hasSelectedEvidence = input.selectedEvidence.length > 0;
  const excluded = input.evidence.filter((item) => item.useStatus === "excluded");

  if (!hasSelectedEvidence && input.evidence.length === 0) {
    blockers.push("No source evidence snippets were available for generation.");
  }

  if (!hasSelectedEvidence) {
    for (const item of excluded) {
      const reason = item.exclusionReason ?? "Evidence was excluded.";
      if (/inspection failed|no source date|metadata only|not inspectable/i.test(reason)) {
        blockers.push(`${item.sourceName}: ${reason}`);
      }
    }
  }

  for (const item of input.selectedEvidence) {
    const assessment = input.assessments.get(item.sourceId);
    if (assessment?.inspection?.status === "failed") {
      blockers.push(`${item.sourceName}: selected evidence comes from a failed inspection.`);
    }
    if (item.numberCandidates.length > 0 && !item.sourceDate) {
      blockers.push(`${item.sourceName} ${item.anchor}: selected numeric evidence has no source date.`);
    }
  }

  return blockers;
}

function currentMetricConflictBlockers(input: {
  selectedEvidence: SourceEvidenceRecord[];
  assessments: Map<string, SourceAssessment>;
}) {
  const byMetric = new Map<string, Array<{ sourceName: string; sourceId: string; value: string; date?: string }>>();
  for (const item of input.selectedEvidence) {
    if (item.kind !== "table_row") continue;
    const assessment = input.assessments.get(item.sourceId);
    if (!assessment || assessment.effectiveStatus !== "current") continue;
    const fields = parseLabeledFields(item.text);
    const metric = fields.get("metric")?.toLowerCase();
    const value = fields.get("value");
    if (!metric || !value) continue;
    byMetric.set(metric, [...(byMetric.get(metric) ?? []), { sourceName: item.sourceName, sourceId: item.sourceId, value, date: item.sourceDate }]);
  }

  const blockers: string[] = [];
  for (const [metric, rows] of byMetric) {
    const values = new Set(rows.map((row) => row.value));
    const sourceIds = new Set(rows.map((row) => row.sourceId));
    if (values.size <= 1 || sourceIds.size <= 1) continue;
    blockers.push(
      `Unresolved current-source conflict for ${metric}: ${rows
        .map((row) => `${row.sourceName}=${row.value}${row.date ? ` as of ${row.date}` : ""}`)
        .join("; ")}.`
    );
  }
  return blockers;
}

function sourceExclusionsFor(evidence: SourceEvidenceRecord[], assessments: Map<string, SourceAssessment>) {
  const bySource = new Map<string, SourceExclusion>();
  for (const assessment of assessments.values()) {
    if (!assessment.sourceExclusionReason) continue;
    bySource.set(assessment.source.id, {
      sourceId: assessment.source.id,
      sourceName: assessment.source.name,
      reason: assessment.sourceExclusionReason
    });
  }
  for (const item of evidence) {
    if (item.useStatus !== "excluded" || !item.exclusionReason) continue;
    bySource.set(item.sourceId, {
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      reason: item.exclusionReason
    });
  }
  return [...bySource.values()];
}

function effectiveSourceStatus(source: SourceRecord): SourceStatus {
  const tokens = source.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hasToken = (...values: string[]) => values.some((value) => tokens.includes(value));
  if (hasToken("old", "archive", "archived", "superseded")) return "superseded";
  if (hasToken("interview", "notes", "transcript", "call")) return "transcript";
  if (hasToken("final", "current", "approved", "latest")) return "current";
  return source.status;
}

function isPreferredStatus(status: SourceStatus) {
  return status === "current" || status === "raw_data" || status === "transcript";
}

function excludeEvidence(item: SourceEvidenceRecord, reason: string): SourceEvidenceRecord {
  return {
    ...item,
    useStatus: "excluded",
    exclusionReason: reason
  };
}

function parseLabeledFields(value: string) {
  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const [rawKey, ...rawValue] = part.split(":");
    const key = rawKey?.trim().toLowerCase();
    const fieldValue = rawValue.join(":").trim();
    if (key && fieldValue) fields.set(key, fieldValue);
  }
  return fields;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function trimSentencePunctuation(value: string) {
  return value.replace(/[.。]+$/g, "");
}
