import type { SourceExclusion } from "../evidence/select.ts";
import type { EvidenceMapRun, GeneratedClaimRecord, GeneratedOutputRecord, SourceEvidenceRecord, TrustReport } from "../types.ts";
import { buildVerifiedOutputDocument, type VerifiedOutputDocument } from "./document-model.ts";

export type FormattedOutputStyle = "reference";

export interface FormattingInvariantCheck {
  name: string;
  status: "passed";
}

export interface FormattingReceipt {
  runId: string;
  profile: "general";
  status: "formatted";
  readiness: "ready";
  format: "markdown";
  style: FormattedOutputStyle;
  canonicalOutput: "04_export/final-output.md";
  formattedOutput: "04_export/formatted-output.md";
  generatedClaims: "03_verification/generated-claims.json";
  sourceEvidence: "01_source-packet/source-evidence.json";
  evidenceMap: "03_verification/evidence-map.json";
  trustReport: "03_verification/trust-report.json";
  verifiedClaimIds: string[];
  sourceIds: string[];
  evidenceIds: string[];
  sourceDates: string[];
  excludedSources: SourceExclusion[];
  invariantChecks: FormattingInvariantCheck[];
  guardrails: string[];
  formattedAt: string;
}

export interface FormattedOutputResult {
  markdown: string;
  receipt: FormattingReceipt;
  receiptMarkdown: string;
}

export function buildFormattedOutput(input: {
  run: EvidenceMapRun;
  trustReport: TrustReport;
  generatedOutput: GeneratedOutputRecord;
  generatedClaims: GeneratedClaimRecord[];
  sourceEvidence: SourceEvidenceRecord[];
  sourceExclusions: SourceExclusion[];
  style?: FormattedOutputStyle;
}): FormattedOutputResult {
  if (input.trustReport.readiness !== "ready") {
    throw new Error("Formatted output requires a ready trust report.");
  }
  if (input.generatedOutput.status !== "export_ready") {
    throw new Error("Formatted output requires an export_ready generated output.");
  }

  const style = input.style ?? "reference";
  const document = buildVerifiedOutputDocument({
    run: input.run,
    generatedClaims: input.generatedClaims,
    sourceEvidence: input.sourceEvidence,
    sourceExclusions: input.sourceExclusions
  });
  const markdown = renderFormattedMarkdown(document, style);
  const invariantChecks = assertFormattingInvariants({
    document,
    markdown,
    generatedClaims: input.generatedClaims
  });
  const receipt: FormattingReceipt = {
    runId: input.run.id,
    profile: "general",
    status: "formatted",
    readiness: "ready",
    format: "markdown",
    style,
    canonicalOutput: "04_export/final-output.md",
    formattedOutput: "04_export/formatted-output.md",
    generatedClaims: "03_verification/generated-claims.json",
    sourceEvidence: "01_source-packet/source-evidence.json",
    evidenceMap: "03_verification/evidence-map.json",
    trustReport: "03_verification/trust-report.json",
    verifiedClaimIds: document.verifiedClaims.map((claim) => claim.generatedClaimId),
    sourceIds: unique(document.verifiedClaims.flatMap((claim) => claim.sourceIds)),
    evidenceIds: unique(document.verifiedClaims.flatMap((claim) => claim.evidenceIds)),
    sourceDates: unique(document.verifiedClaims.flatMap((claim) => claim.sourceDates)),
    excludedSources: document.excludedSources,
    invariantChecks,
    guardrails: [
      "The formatted output is a deterministic derivative of the verified generated Markdown output.",
      "Formatting does not create claims, select evidence, alter source dates, or change readiness.",
      "The canonical trust target remains 04_export/final-output.md plus the generated claims, evidence map, and trust report."
    ],
    formattedAt: new Date().toISOString()
  };

  return {
    markdown,
    receipt,
    receiptMarkdown: renderFormattingReceipt(receipt)
  };
}

function renderFormattedMarkdown(document: VerifiedOutputDocument, style: FormattedOutputStyle) {
  if (style !== "reference") throw new Error(`Unsupported formatting style: ${style}`);
  const claimSections = document.verifiedClaims.length
    ? document.verifiedClaims.map(renderReferenceClaim)
    : ["No verified generated claims were available for formatting."];
  const excludedRows = document.excludedSources.length
    ? document.excludedSources.map((item) => `- ${item.sourceName}: ${item.reason}`)
    : ["- None"];

  return `# ${document.runName}

This is a deterministic formatted derivative of \`${document.verificationBoundary.canonicalOutput}\`.

## Verified Claims

${claimSections.join("\n\n")}

## Excluded Sources

${excludedRows.join("\n")}

## Verification Boundary

- Canonical output: \`${document.verificationBoundary.canonicalOutput}\`
- Source packet: \`${document.verificationBoundary.sourcePacket}\`
- Source evidence: \`${document.verificationBoundary.sourceEvidence}\`
- Evidence map: \`${document.verificationBoundary.evidenceMap}\`
- Generated claims: \`${document.verificationBoundary.generatedClaims}\`
- Trust report: \`${document.verificationBoundary.trustReport}\`
`;
}

function renderReferenceClaim(claim: VerifiedOutputClaimForRender) {
  const evidenceRefs = claim.evidenceRefs.length
    ? claim.evidenceRefs.map((item) => `- \`${item.id}\` from ${item.sourceName} at ${item.anchor}${item.sourceDate ? ` (${item.sourceDate})` : ""}`)
    : ["- No evidence refs."];
  return `### Claim

${claim.text} [generated claim: ${claim.generatedClaimId}; sources: ${claim.sourceIds.join(", ")}; evidence: ${claim.evidenceIds.join(", ")}; dates: ${claim.sourceDates.join(", ")}]

Evidence anchors:

${evidenceRefs.join("\n")}`;
}

function renderFormattingReceipt(receipt: FormattingReceipt) {
  return `# Formatting Receipt

Status: ${receipt.status}

Readiness: ${receipt.readiness}

Format: ${receipt.format}

Style: ${receipt.style}

Canonical output: \`${receipt.canonicalOutput}\`

Formatted output: \`${receipt.formattedOutput}\`

Generated claims: \`${receipt.generatedClaims}\`

Source evidence: \`${receipt.sourceEvidence}\`

Evidence map: \`${receipt.evidenceMap}\`

Trust report: \`${receipt.trustReport}\`

Formatted at: ${receipt.formattedAt}

## Preserved IDs

- Generated claims: ${receipt.verifiedClaimIds.join(", ") || "none"}
- Sources: ${receipt.sourceIds.join(", ") || "none"}
- Evidence: ${receipt.evidenceIds.join(", ") || "none"}
- Source dates: ${receipt.sourceDates.join(", ") || "none"}

## Invariant Checks

${receipt.invariantChecks.map((check) => `- ${check.name}: ${check.status}`).join("\n")}

## Guardrails

${receipt.guardrails.map((item) => `- ${item}`).join("\n")}
`;
}

function assertFormattingInvariants(input: {
  document: VerifiedOutputDocument;
  markdown: string;
  generatedClaims: GeneratedClaimRecord[];
}): FormattingInvariantCheck[] {
  const checks: FormattingInvariantCheck[] = [];
  const failures: string[] = [];

  const verifiedClaimIds = new Set(input.document.verifiedClaims.map((claim) => claim.generatedClaimId));
  const unverifiedClaims = input.generatedClaims.filter((claim) => !verifiedClaimIds.has(claim.id));
  for (const claim of input.document.verifiedClaims) {
    requirePresence(failures, input.markdown, claim.generatedClaimId, `generated claim ${claim.generatedClaimId}`);
    requirePresence(failures, input.markdown, claim.text, `claim text ${claim.generatedClaimId}`);
    requireAllPresent(failures, input.markdown, claim.sourceIds, `source IDs for ${claim.generatedClaimId}`);
    requireAllPresent(failures, input.markdown, claim.evidenceIds, `evidence IDs for ${claim.generatedClaimId}`);
    requireAllPresent(failures, input.markdown, claim.sourceDates, `source dates for ${claim.generatedClaimId}`);
    if (hasNumericToken(claim.text) && claim.sourceDates.length === 0) {
      failures.push(`numeric claim lacks source dates: ${claim.generatedClaimId}`);
    }
  }
  for (const claim of unverifiedClaims) {
    if (input.markdown.includes(claim.claim)) failures.push(`unverified generated claim appears in formatted output: ${claim.id}`);
  }
  for (const exclusion of input.document.excludedSources) {
    requirePresence(failures, input.markdown, exclusion.sourceName, `excluded source ${exclusion.sourceName}`);
    requirePresence(failures, input.markdown, exclusion.reason, `excluded source reason for ${exclusion.sourceName}`);
  }
  for (const token of collectNumericTokens(input.markdown)) {
    if (!allowedNumericTokens(input.document).has(token)) failures.push(`formatted output introduced numeric token ${token}`);
  }

  if (failures.length > 0) {
    throw new Error(`Formatted output failed invariant checks: ${failures.join("; ")}`);
  }

  checks.push({ name: "all verified generated claim IDs are present", status: "passed" });
  checks.push({ name: "all verified claim text is present", status: "passed" });
  checks.push({ name: "all source IDs, evidence IDs, and source dates are present", status: "passed" });
  checks.push({ name: "unverified generated claims are absent", status: "passed" });
  checks.push({ name: "excluded sources and reasons are present", status: "passed" });
  checks.push({ name: "no unmodeled numeric tokens were introduced", status: "passed" });
  return checks;
}

type VerifiedOutputClaimForRender = VerifiedOutputDocument["verifiedClaims"][number];

function requireAllPresent(failures: string[], markdown: string, values: string[], label: string) {
  for (const value of values) requirePresence(failures, markdown, value, label);
}

function requirePresence(failures: string[], markdown: string, value: string, label: string) {
  if (!value || markdown.includes(value)) return;
  failures.push(`missing ${label}: ${value}`);
}

function hasNumericToken(value: string) {
  return collectNumericTokens(value).size > 0;
}

function collectNumericTokens(value: string) {
  return new Set(value.match(/\b-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b|\b-?\d+(?:\.\d+)?%?\b/g) ?? []);
}

function allowedNumericTokens(document: VerifiedOutputDocument) {
  const allowed = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    for (const token of collectNumericTokens(value)) allowed.add(token);
  };
  add(document.runName);
  for (const value of Object.values(document.verificationBoundary)) add(value);
  for (const claim of document.verifiedClaims) {
    add(claim.generatedClaimId);
    add(claim.text);
    for (const sourceId of claim.sourceIds) add(sourceId);
    for (const evidenceId of claim.evidenceIds) add(evidenceId);
    for (const sourceDate of claim.sourceDates) add(sourceDate);
    for (const ref of claim.evidenceRefs) {
      add(ref.id);
      add(ref.sourceId);
      add(ref.sourceName);
      add(ref.anchor);
      add(ref.sourceDate);
    }
  }
  for (const exclusion of document.excludedSources) {
    add(exclusion.sourceName);
    add(exclusion.reason);
  }
  return allowed;
}

function unique(values: string[]) {
  return [...new Set(values)];
}
