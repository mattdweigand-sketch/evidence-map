import type { ArtifactKind, FileInspectionRecord, SourceRecord } from "../types.ts";
import type { LegalOutputKind, LegalOutputSpec } from "./types.ts";

export function buildLegalOutputSpec(input: {
  runId: string;
  name: string;
  artifactKind: ArtifactKind;
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
}): LegalOutputSpec {
  const context = `${input.name}\n${input.sources.map((source) => source.name).join("\n")}\n${input.inspections
    .map((inspection) => inspection.textPreview ?? "")
    .join("\n")}`;
  const outputKind = inferLegalOutputKind(context);

  return {
    id: `legal_output_spec_${input.runId}`,
    runId: input.runId,
    outputKind,
    audience: "Human legal reviewer, course reviewer, or operator.",
    assignmentOrUseCase: "Reviewable legal work product from the supplied packet.",
    jurisdiction: inferJurisdiction(context),
    courseOrMatter: inferCourseOrMatter(context),
    questionPresented: inferQuestionPresented(context),
    requiredSections: requiredSectionsFor(outputKind),
    citationStyle: inferCitationStyle(context),
    allowedSourceScope: inferAllowedSourceScope(context),
    reviewOwner: undefined,
    reviewRules: [
      "Treat this as a legal reliability artifact, not legal advice.",
      "Use only supplied or explicitly approved sources.",
      "Every material legal proposition must appear in the legal evidence map.",
      "Every rule, holding, quote, citation, and record fact needs passage or pinpoint support.",
      "Do not approve final export until legal hostile-review findings are resolved or carried for human review."
    ]
  };
}

export function renderLegalOutputSpec(spec: LegalOutputSpec) {
  return `# Legal Output Spec

Output kind: ${spec.outputKind}

Audience: ${spec.audience}

Assignment or use case: ${spec.assignmentOrUseCase}

Jurisdiction: ${spec.jurisdiction ?? ""}

Question presented: ${spec.questionPresented ?? ""}

Citation style: ${spec.citationStyle}

Allowed source scope: ${spec.allowedSourceScope}

## Required Sections

${spec.requiredSections.map((section) => `- ${section}`).join("\n")}

## Review Rules

${spec.reviewRules.map((rule) => `- ${rule}`).join("\n")}
`;
}

function inferLegalOutputKind(value: string): LegalOutputKind {
  const lower = value.toLowerCase();
  if (/\bcase\s+brief\b/.test(lower)) return "case_brief";
  if (/\brule\s+synthesis\b/.test(lower)) return "rule_synthesis";
  if (/\bissue\s+outline\b/.test(lower)) return "issue_outline";
  if (/\bargument\s+outline\b/.test(lower)) return "argument_outline";
  if (/\bcitation\s+table\b/.test(lower)) return "citation_table";
  if (/\blegal\s+memo\b|\bmemorandum\b|\bmemo\b/.test(lower)) return "legal_memo";
  if (/\bcase\s+comparison\b/.test(lower)) return "case_comparison";
  return "other";
}

function requiredSectionsFor(outputKind: LegalOutputKind) {
  if (outputKind === "case_brief") {
    return ["Facts", "Procedural history", "Issue", "Rule", "Holding", "Reasoning", "Disposition", "Notes or class questions"];
  }
  if (outputKind === "rule_synthesis") {
    return ["Issue or doctrine", "Authorities", "Synthesized rule propositions", "Conflicts or limits", "Open review questions"];
  }
  if (outputKind === "issue_outline") {
    return ["Issues", "Governing authorities", "Record facts", "Application notes", "Open questions"];
  }
  if (outputKind === "argument_outline") {
    return ["Position", "Rules", "Record support", "Counterarguments", "Risks"];
  }
  if (outputKind === "citation_table") {
    return ["Authority", "Citation", "Jurisdiction", "Key proposition", "Treatment status", "Review status"];
  }
  if (outputKind === "case_comparison") {
    return ["Cases", "Rules", "Facts", "Holdings", "Distinctions", "Conflicts"];
  }
  return ["Question presented", "Brief answer placeholder", "Facts", "Rules", "Analysis", "Counterauthority", "Conclusion"];
}

function inferCitationStyle(value: string): LegalOutputSpec["citationStyle"] {
  if (/\bbluebook\b/i.test(value)) return "bluebook";
  if (/\balwd\b/i.test(value)) return "alwd";
  if (/\bprofessor(?:'s)?\s+specific\s+citation\b|\bprofessor[- ]specific\b/i.test(value)) return "professor_specific";
  if (/\bplain\s+citation\b|\bplain[- ]language\s+citation\b/i.test(value)) return "plain";
  return "unknown";
}

function inferAllowedSourceScope(value: string): LegalOutputSpec["allowedSourceScope"] {
  if (/\bapproved\s+research\b|\boutside\s+research\b|\badditional\s+research\b/i.test(value)) {
    return "provided_plus_user_approved_research";
  }
  return "provided_packet_only";
}

function inferQuestionPresented(value: string) {
  const match = value.match(/\bquestion presented\s*:\s*([^\n\r]+)/i);
  return match?.[1]?.trim();
}

function inferCourseOrMatter(value: string) {
  const match = value.match(/\b(?:course|class|matter|course or matter)\s*:\s*([^\n\r]+)/i);
  return match?.[1]?.trim();
}

function inferJurisdiction(value: string) {
  const match = value.match(/\bjurisdiction\s*:\s*([^\n\r]+)/i);
  return match?.[1]?.trim();
}
