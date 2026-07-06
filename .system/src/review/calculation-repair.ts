import type { CalculationRecord, FileInspectionRecord, VerificationFinding } from "../types.ts";
import { workbookInspectionFindings } from "../verify/workbook-findings.ts";

export interface CalculationRepairItem {
  id: string;
  location: string;
  severity: VerificationFinding["severity"];
  issue: string;
  evidence: string;
  calculationId?: string;
  riskFlags: string[];
  suggestedInputs: string[];
  repairChecklist: string[];
  suggestedDecision?: {
    tool: "evidencemap_resolve_general_calculation_risk";
    calculationId: string;
    riskFlags: string[];
    inputs: string[];
    resolution: string;
    reviewStatus: "needs_review" | "verified";
  };
}

export interface CalculationRepairPacket {
  runId: string;
  profile: "general";
  itemCount: number;
  items: CalculationRepairItem[];
  notes: string[];
}

export function buildCalculationRepairPacket(input: {
  runId: string;
  calculations: CalculationRecord[];
  inspections: FileInspectionRecord[];
}): CalculationRepairPacket {
  const calculationItems = input.calculations.flatMap((calculation) => repairItemsForCalculation(calculation));
  const workbookItems = input.inspections.flatMap((inspection) => repairItemsForWorkbook(inspection));
  const items = [...calculationItems, ...workbookItems];
  return {
    runId: input.runId,
    profile: "general",
    itemCount: items.length,
    items,
    notes: [
      "This packet suggests repairs only; it does not resolve calculation risks.",
      "Use the approval-gated general review tool to record calculation risk decisions.",
      "Workbook findings without a calculation id require workbook edits or a new mapped calculation before they can be resolved."
    ]
  };
}

export function renderCalculationRepairPacket(packet: CalculationRepairPacket) {
  const rows = packet.items.length
    ? packet.items
        .map(
          (item) =>
            `| ${escapeCell(item.id)} | ${escapeCell(item.severity)} | ${escapeCell(item.location)} | ${escapeCell(item.issue)} | ${escapeCell(item.riskFlags.join(", "))} | ${escapeCell(item.suggestedInputs.join(", "))} |`
        )
        .join("\n")
    : "| none |  |  |  |  |  |";
  const checklists = packet.items.length
    ? packet.items
        .map(
          (item) => `## ${item.id}

Location: ${item.location}

Issue: ${item.issue}

${item.repairChecklist.map((step) => `- ${step}`).join("\n")}

Suggested decision: ${item.suggestedDecision ? `\`${JSON.stringify(item.suggestedDecision)}\`` : "not available until a mapped calculation exists."}`
        )
        .join("\n\n")
    : "No calculation repair items.";

  return `# Calculation Repair Packet

Items: ${packet.itemCount}

| Item ID | Severity | Location | Issue | Risk flags | Suggested inputs |
|---|---|---|---|---|---|
${rows}

${checklists}

## Notes

${packet.notes.map((note) => `- ${note}`).join("\n")}
`;
}

function repairItemsForCalculation(calculation: CalculationRecord): CalculationRepairItem[] {
  const items: CalculationRepairItem[] = [];
  if (calculation.inputs.length === 0) {
    const activeRiskFlags = calculation.riskFlags.length > 0 ? calculation.riskFlags : [];
    items.push({
      id: `${calculation.id}-mapped-inputs`,
      location: calculation.artifactLocation,
      severity: "must_fix",
      issue: "Calculation has no mapped inputs.",
      evidence: calculation.logic,
      calculationId: calculation.id,
      riskFlags: activeRiskFlags,
      suggestedInputs: suggestedInputsFor(calculation),
      repairChecklist: [
        "Identify raw data, assumptions, and source IDs used by this calculation.",
        "Add or document the input map before relying on the output.",
        "Record the reviewed inputs through the calculation-risk decision tool."
      ],
      suggestedDecision:
        activeRiskFlags.length > 0
          ? {
              tool: "evidencemap_resolve_general_calculation_risk",
              calculationId: calculation.id,
              riskFlags: activeRiskFlags,
              inputs: suggestedInputsFor(calculation),
              resolution: "Mapped calculation inputs and confirmed they drive the expected output behavior.",
              reviewStatus: "needs_review"
            }
          : undefined
    });
  }

  for (const flag of calculation.riskFlags) {
    items.push({
      id: `${calculation.id}-${flag}`,
      location: calculation.artifactLocation,
      severity: "must_fix",
      issue: `Calculation risk: ${flag}.`,
      evidence: calculation.expectedBehavior,
      calculationId: calculation.id,
      riskFlags: [flag],
      suggestedInputs: suggestedInputsFor(calculation),
      repairChecklist: repairChecklistForFlag(flag),
      suggestedDecision: {
        tool: "evidencemap_resolve_general_calculation_risk",
        calculationId: calculation.id,
        riskFlags: [flag],
        inputs: suggestedInputsFor(calculation),
        resolution: resolutionForFlag(flag),
        reviewStatus: "needs_review"
      }
    });
  }

  return items;
}

function repairItemsForWorkbook(inspection: FileInspectionRecord): CalculationRepairItem[] {
  return workbookInspectionFindings(inspection).map((finding, index) => ({
    id: `workbook-${inspection.name}-${index + 1}`.replace(/[^A-Za-z0-9._-]+/g, "-"),
    location: finding.location,
    severity: finding.severity,
    issue: finding.issue,
    evidence: finding.evidence,
    riskFlags: riskFlagsForWorkbookFinding(finding),
    suggestedInputs: [],
    repairChecklist: [
      finding.recommendedRepair,
      "Document whether the workbook output can be relied on after the repair.",
      "Rerun verification after replacing hardcodes, adding checks, or documenting sourced assumptions."
    ]
  }));
}

function suggestedInputsFor(calculation: CalculationRecord) {
  if (calculation.inputs.length > 0) return calculation.inputs;
  return ["raw_data_source_id", "assumption_source_id", "output_cell_or_section"];
}

function repairChecklistForFlag(flag: string) {
  if (flag === "formula_map_missing") {
    return [
      "Create a formula map from source data and assumptions to output cells or reported values.",
      "Confirm formulas move correctly across periods, rows, and comparable outputs.",
      "Attach source IDs or workbook cell anchors for each material input."
    ];
  }
  if (flag === "checks_tab_required") {
    return [
      "Add a checks tab or verification memo.",
      "Include tie-outs, stale-date checks, hardcode checks, and output sensitivity checks.",
      "Record the checks artifact as a reviewed input."
    ];
  }
  return [
    "Identify the exact calculation risk and affected output.",
    "Repair or document the risk with source IDs and reviewer notes.",
    "Rerun hostile verification after the repair."
  ];
}

function resolutionForFlag(flag: string) {
  if (flag === "formula_map_missing") return "Added a formula map from raw inputs and assumptions to output values.";
  if (flag === "checks_tab_required") return "Added or reviewed checks covering tie-outs, hardcodes, stale dates, and output sensitivity.";
  return `Resolved calculation risk ${flag} with documented inputs and review notes.`;
}

function riskFlagsForWorkbookFinding(finding: Omit<VerificationFinding, "id" | "runId">) {
  if (finding.issue.includes("Hardcoded")) return ["hardcoded_calculation_zone"];
  if (finding.issue.includes("No checks")) return ["checks_tab_required"];
  if (finding.issue.includes("Formula")) return ["formula_map_missing"];
  if (finding.issue.includes("hidden")) return ["hidden_sheet_review"];
  return ["workbook_review_required"];
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}
