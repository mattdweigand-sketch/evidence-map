import type { ArtifactKind, ArtifactSpec, CalculationRecord, ClaimRecord, FileInspectionRecord } from "../types.ts";

export function buildArtifactSpec(input: {
  runId: string;
  artifactKind: ArtifactKind;
  name: string;
}): Omit<ArtifactSpec, "id"> {
  return {
    runId: input.runId,
    artifactKind: input.artifactKind,
    audience: "Named human reviewer or decision maker.",
    decisionContext: "Artifact will be shared beyond the immediate working context.",
    narrativeSpine: `Review a defensible ${input.artifactKind} for ${input.name} against the approved source packet.`,
    structure: structureFor(input.artifactKind),
    requiredChecks: [
      "Every material claim has a source ID.",
      "Every number has a source date or is labeled as an assumption.",
      "Every chart maps to source data.",
      "Every calculation identifies inputs and expected behavior.",
      "Every unresolved conflict is visible before export."
    ],
    reviewRules: [
      "Do not approve the artifact until the source packet and specification are reviewed.",
      "Preserve source IDs in notes, evidence maps, or check tabs.",
      "Label assumptions as assumptions.",
      "Do not hardcode calculated outputs where formulas are expected.",
      "Run hostile verification before final export."
    ]
  };
}

export function seedClaims(input: {
  runId: string;
  artifactKind: ArtifactKind;
  inspections?: FileInspectionRecord[];
  draftFiles?: string[];
}): Omit<ClaimRecord, "id" | "runId">[] {
  if (input.artifactKind === "workbook") return [];
  const extractedClaims = seedInspectionClaims(input);
  if (extractedClaims.length > 0) return extractedClaims;

  return [
    {
      artifactLocation: input.artifactKind === "deck" ? "slide-map" : "section-map",
      claim: "Primary artifact claim must be supplied by the human owner or source packet.",
      sourceIds: [],
      assumptions: [],
      reviewStatus: "unsupported"
    }
  ];
}

interface PptxSlideSummary {
  slideNumber: number;
  title?: string;
  text?: string;
  notesText?: string;
}

function seedInspectionClaims(input: {
  artifactKind: ArtifactKind;
  inspections?: FileInspectionRecord[];
  draftFiles?: string[];
}): Omit<ClaimRecord, "id" | "runId">[] {
  const claims: Omit<ClaimRecord, "id" | "runId">[] = [];
  const seenClaims = new Set<string>();
  const draftNames = new Set(input.draftFiles ?? []);

  for (const inspection of input.inspections ?? []) {
    if (inspection.status !== "inspected") continue;
    if (draftNames.size > 0 && !draftNames.has(inspection.name)) continue;

    if ((input.artifactKind === "deck" || input.artifactKind === "mixed") && inspection.parser === "pptx-deep-v1") {
      for (const slide of getPptxSlides(inspection.structuredSummary)) {
        const slideLocation = `deck:${inspection.name}:slide:${slide.slideNumber}`;
        for (const candidate of claimCandidates(slide.text ?? "", slide.title)) {
          addClaim(claims, seenClaims, slideLocation, candidate);
        }
        for (const candidate of claimCandidates(slide.notesText ?? "", slide.title)) {
          addClaim(claims, seenClaims, `${slideLocation}:notes`, candidate);
        }
      }
      continue;
    }

    if (inspection.parser === "markdown-text-v1" || inspection.parser === "plain-text-v1") {
      for (const excerpt of getTextExcerpts(inspection.structuredSummary)) {
        for (const candidate of claimCandidates(excerpt.text)) {
          addClaim(claims, seenClaims, `document:${inspection.name}:paragraph:${excerpt.paragraphNumber}`, candidate);
        }
      }
      continue;
    }

    if (inspection.parser === "docx-deep-v1") {
      for (const excerpt of getTextExcerpts(inspection.structuredSummary)) {
        for (const candidate of claimCandidates(excerpt.text)) {
          addClaim(claims, seenClaims, `document:${inspection.name}:paragraph:${excerpt.paragraphNumber}`, candidate);
        }
      }
      for (const row of getDocxTableRows(inspection.structuredSummary)) {
        for (const candidate of claimCandidates(row.text)) {
          addClaim(claims, seenClaims, `document:${inspection.name}:table:${row.tableNumber}:row:${row.rowNumber}`, candidate);
        }
      }
      continue;
    }

    if (inspection.parser === "pdf-text-v1") {
      for (const paragraph of getPdfParagraphs(inspection.structuredSummary)) {
        for (const candidate of claimCandidates(paragraph.text)) {
          addClaim(claims, seenClaims, `document:${inspection.name}:page:${paragraph.pageNumber}:paragraph:${paragraph.paragraphNumber}`, candidate);
        }
      }
    }
  }

  return claims.slice(0, 50);
}

function getPptxSlides(summary: Record<string, unknown>): PptxSlideSummary[] {
  const slides = summary.slides;
  if (!Array.isArray(slides)) return [];

  return slides.flatMap((slide) => {
    if (!slide || typeof slide !== "object") return [];
    const record = slide as Record<string, unknown>;
    const slideNumber = typeof record.slideNumber === "number" && Number.isFinite(record.slideNumber) ? record.slideNumber : undefined;
    if (slideNumber === undefined) return [];
    return [
      {
        slideNumber,
        title: typeof record.title === "string" ? record.title : undefined,
        text: typeof record.text === "string" ? record.text : undefined,
        notesText: typeof record.notesText === "string" ? record.notesText : undefined
      }
    ];
  });
}

function addClaim(
  claims: Omit<ClaimRecord, "id" | "runId">[],
  seenClaims: Set<string>,
  artifactLocation: string,
  claim: string
) {
  const key = claim.toLowerCase();
  if (seenClaims.has(key)) return;
  seenClaims.add(key);
  claims.push({
    artifactLocation,
    claim,
    sourceIds: [],
    assumptions: [],
    reviewStatus: "unsupported"
  });
}

interface TextExcerpt {
  paragraphNumber: number;
  text: string;
}

function getTextExcerpts(summary: Record<string, unknown>): TextExcerpt[] {
  const excerpts = summary.excerpts;
  if (!Array.isArray(excerpts)) return [];
  return excerpts.flatMap((excerpt) => {
    if (!excerpt || typeof excerpt !== "object") return [];
    const record = excerpt as Record<string, unknown>;
    const paragraphNumber = typeof record.paragraphNumber === "number" ? record.paragraphNumber : undefined;
    const text = typeof record.text === "string" ? record.text : undefined;
    return paragraphNumber !== undefined && text ? [{ paragraphNumber, text }] : [];
  });
}

function getDocxTableRows(summary: Record<string, unknown>) {
  const tables = summary.tables;
  if (!Array.isArray(tables)) return [];
  return tables.flatMap((table) => {
    if (!table || typeof table !== "object") return [];
    const record = table as Record<string, unknown>;
    const tableNumber = typeof record.tableNumber === "number" ? record.tableNumber : undefined;
    const rows = Array.isArray(record.previewRows) ? record.previewRows : [];
    if (tableNumber === undefined) return [];
    return rows.flatMap((row, index) => {
      if (!Array.isArray(row)) return [];
      const text = row.map((cell) => String(cell ?? "").trim()).filter(Boolean).join("; ");
      return text ? [{ tableNumber, rowNumber: index + 1, text }] : [];
    });
  });
}

function getPdfParagraphs(summary: Record<string, unknown>) {
  const pages = summary.pages;
  if (!Array.isArray(pages)) return [];
  return pages.flatMap((page) => {
    if (!page || typeof page !== "object") return [];
    const record = page as Record<string, unknown>;
    const pageNumber = typeof record.pageNumber === "number" ? record.pageNumber : undefined;
    const paragraphs = Array.isArray(record.paragraphs) ? record.paragraphs : [];
    if (pageNumber === undefined) return [];
    return paragraphs.flatMap((paragraph, index) => {
      const text = typeof paragraph === "string" ? paragraph : undefined;
      return text ? [{ pageNumber, paragraphNumber: index + 1, text }] : [];
    });
  });
}

function claimCandidates(value: string, title?: string) {
  const titleKey = title ? normalizeClaimText(title).toLowerCase() : undefined;
  return value
    .split(/\r?\n+|(?<=[.!?])\s+/g)
    .map(normalizeClaimText)
    .filter((candidate) => candidate && candidate.toLowerCase() !== titleKey)
    .filter(isClaimCandidate);
}

function normalizeClaimText(value: string) {
  return value.replace(/^[\s*-]+/, "").replace(/\s+/g, " ").trim();
}

function isClaimCandidate(value: string) {
  if (value.length < 25 || value.length > 280) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (/^(owner|prepared by|author|reviewer|date|source|sources|note|notes|todo|draft|confidential)\b\s*:?/i.test(value)) return false;
  if (/^use the\b/i.test(value)) return false;
  return hasClaimSignal(value);
}

function hasClaimSignal(value: string) {
  if (/[$%]|\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/.test(value)) return true;
  return /\b(is|are|was|were|has|have|had|will|would|should|can|could|must|may|increased|decreased|grew|declined|rose|fell|reduced|improved|worsened|exceeds|trails|supports|shows|indicates|requires|creates|demonstrates|drives|depends|remains|became|becomes|totaled|reached)\b/i.test(value);
}

export function seedCalculations(input: { artifactKind: ArtifactKind }): Omit<CalculationRecord, "id" | "runId">[] {
  if (input.artifactKind !== "workbook" && input.artifactKind !== "mixed") return [];
  return [
    {
      artifactLocation: "workbook/checks",
      inputs: [],
      logic: "Calculation flow must be mapped from raw data to assumptions to outputs.",
      expectedBehavior: "Outputs change when linked assumptions change.",
      riskFlags: ["formula_map_missing", "checks_tab_required"],
      reviewStatus: "needs_review"
    }
  ];
}

function structureFor(kind: ArtifactKind) {
  if (kind === "deck") {
    return [
      "Audience and decision context.",
      "One-sentence narrative spine.",
      "Slide map with claim headlines.",
      "Evidence map for every slide claim.",
      "Speaker notes with source IDs, calculations, assumptions, and review status."
    ];
  }

  if (kind === "workbook") {
    return [
      "Raw data tab.",
      "Assumptions tab.",
      "Calculation tabs.",
      "Output views.",
      "Checks tab.",
      "Documentation tab."
    ];
  }

  return [
    "Audience and decision context.",
    "Section map.",
    "Claim and evidence map.",
    "Assumptions and open questions.",
    "Verification checklist."
  ];
}
