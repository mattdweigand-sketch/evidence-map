import type { FileInspectionRecord, VerificationFinding } from "../types.ts";

type FindingDraft = Omit<VerificationFinding, "id" | "runId">;

interface WorkbookDoctorSummary {
  workbook?: {
    hiddenSheetCount?: number;
    hardcodedNumberCellCount?: number;
    checksSheetDetected?: boolean;
    formulaIssueCount?: number;
  };
  sheets?: Array<{
    name?: string;
    state?: string;
    headerWarnings?: string[];
  }>;
  formulaIssues?: Array<{
    location?: string;
    issueType?: string;
    evidence?: string;
  }>;
  hardcodeIssues?: Array<{
    address?: string;
    reason?: string;
    value?: number;
  }>;
}

export function workbookInspectionFindings(inspection: FileInspectionRecord): FindingDraft[] {
  if (inspection.parser !== "xlsx-workbook-doctor-v1") return [];

  const summary = inspection.structuredSummary as WorkbookDoctorSummary;
  const findings: FindingDraft[] = [];

  for (const issue of summary.formulaIssues ?? []) {
    if (issue.issueType !== "repeated_formula_static_references") continue;
    findings.push({
      location: `workbook:${inspection.name}:${issue.location ?? "formula map"}`,
      issue: "Formula is copied with static relative references.",
      severity: "must_fix",
      evidence: issue.evidence ?? "Formula pattern did not move across adjacent cells.",
      recommendedRepair: "Inspect the formula pattern and update references so each period or comparable row points to the intended cells.",
      humanReviewRequired: true
    });
  }

  if ((summary.hardcodeIssues ?? []).length > 0) {
    findings.push({
      location: `workbook:${inspection.name}`,
      issue: "Hardcoded numbers appear in calculation-like zones.",
      severity: "must_fix",
      evidence: (summary.hardcodeIssues ?? [])
        .slice(0, 10)
        .map((issue) => `${issue.address ?? "unknown cell"} (${issue.reason ?? "numeric constant"})`)
        .join("; "),
      recommendedRepair: "Replace calculated hardcodes with formulas or document each hardcode as a sourced assumption.",
      humanReviewRequired: true
    });
  }

  const hiddenSheets = (summary.sheets ?? []).filter((sheet) => sheet.state && sheet.state !== "visible");
  for (const sheet of hiddenSheets) {
    findings.push({
      location: `workbook:${inspection.name}:${sheet.name ?? "hidden sheet"}`,
      issue: "Workbook contains a hidden sheet.",
      severity: "should_fix",
      evidence: `Sheet state is ${sheet.state}.`,
      recommendedRepair: "Confirm whether the hidden sheet is active, stale, duplicate, or irrelevant before relying on workbook outputs.",
      humanReviewRequired: true
    });
  }

  if (summary.workbook?.checksSheetDetected === false) {
    findings.push({
      location: `workbook:${inspection.name}`,
      issue: "No checks sheet detected.",
      severity: "should_fix",
      evidence: "Workbook Doctor did not find a sheet whose name or headers indicate checks, tie-outs, or validation.",
      recommendedRepair: "Add a checks tab or verification memo covering tie-outs, formula consistency, hardcodes, stale dates, and output sensitivity.",
      humanReviewRequired: true
    });
  }

  for (const sheet of summary.sheets ?? []) {
    for (const warning of sheet.headerWarnings ?? []) {
      findings.push({
        location: `workbook:${inspection.name}:${sheet.name ?? "worksheet"}`,
        issue: "Worksheet header quality issue.",
        severity: "should_fix",
        evidence: warning,
        recommendedRepair: "Clean or document the worksheet header structure before extracting claims, calculations, or charts from it.",
        humanReviewRequired: true
      });
    }
  }

  return findings;
}
