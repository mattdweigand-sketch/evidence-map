import ExcelJS from "exceljs";
import type { FileInspectionRecord } from "../types.ts";

type FileInspectionDraft = Omit<FileInspectionRecord, "id" | "runId" | "sourceId">;
type BaseFileInspection = Pick<FileInspectionDraft, "name" | "path" | "fileType" | "sizeBytes" | "modifiedAt">;

interface FormulaCell {
  address: string;
  row: number;
  col: number;
  formula: string;
}

interface HardcodedNumberCell {
  address: string;
  row: number;
  col: number;
  value: number;
  reason: string;
}

interface HeaderCandidates {
  rowNumber?: number;
  values: string[];
}

interface FormulaIssue {
  location: string;
  issueType: string;
  evidence: string;
}

export async function inspectXlsxWorkbook(
  base: BaseFileInspection,
  helpers: {
    inferDateCandidates(value: string): string[];
    inferOwnerCandidates(value: string): string[];
    previewText(value: string): string;
  }
): Promise<FileInspectionDraft> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(base.path);

  const sheetSummaries = workbook.worksheets.map((worksheet) => inspectWorksheet(worksheet));
  const formulaIssues = findFormulaIssues(sheetSummaries.flatMap((sheet) => sheet.formulas));
  const hardcodeIssues = sheetSummaries.flatMap((sheet) => sheet.hardcodedNumbers.slice(0, 25));
  const hardcodeIssueCount = sheetSummaries.reduce((sum, sheet) => sum + sheet.hardcodedNumberCellCount, 0);
  const hardcodeWarningSuffix = sheetSummaries.some((sheet) => sheet.hardcodedNumbers.length > 25) ? " (showing first 25 per sheet)" : "";
  const warnings = [
    ...sheetSummaries.filter((sheet) => sheet.state !== "visible").map((sheet) => `${sheet.name}: sheet is ${sheet.state}.`),
    ...sheetSummaries.filter((sheet) => sheet.headerWarnings.length > 0).flatMap((sheet) => sheet.headerWarnings.map((warning) => `${sheet.name}: ${warning}`)),
    ...formulaIssues.map((issue) => `${issue.location}: ${issue.issueType}.`),
    ...(hardcodeIssueCount > 0 ? [`${hardcodeIssueCount} hardcoded numeric cells found in calculation-like zones.${hardcodeWarningSuffix}`] : []),
    ...(sheetSummaries.some((sheet) => sheet.hasChecksPurpose) ? [] : ["No checks sheet detected."])
  ];
  const textCorpus = sheetSummaries.flatMap((sheet) => [sheet.name, ...sheet.headers]).join("\n");

  return {
    ...base,
    parser: "xlsx-workbook-doctor-v1",
    status: "inspected",
    sourceDateCandidates: helpers.inferDateCandidates(`${base.name}\n${textCorpus}`),
    ownerCandidates: helpers.inferOwnerCandidates(textCorpus),
    structuredSummary: {
      workbook: {
        sheetCount: sheetSummaries.length,
        hiddenSheetCount: sheetSummaries.filter((sheet) => sheet.state !== "visible").length,
        numericCellCount: sheetSummaries.reduce((sum, sheet) => sum + sheet.numericCellCount, 0),
        formulaCellCount: sheetSummaries.reduce((sum, sheet) => sum + sheet.formulaCellCount, 0),
        hardcodedNumberCellCount: sheetSummaries.reduce((sum, sheet) => sum + sheet.hardcodedNumberCellCount, 0),
        checksSheetDetected: sheetSummaries.some((sheet) => sheet.hasChecksPurpose),
        formulaIssueCount: formulaIssues.length
      },
      sheets: sheetSummaries.map((sheet) => ({
        name: sheet.name,
        state: sheet.state,
        apparentPurpose: sheet.apparentPurpose,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        nonEmptyRowCount: sheet.nonEmptyRowCount,
        blankRowCount: sheet.blankRowCount,
        mergedCellCount: sheet.mergedCellCount,
        numericCellCount: sheet.numericCellCount,
        formulaCellCount: sheet.formulaCellCount,
        hardcodedNumberCellCount: sheet.hardcodedNumberCellCount,
        headerWarnings: sheet.headerWarnings,
        headers: sheet.headers
      })),
      formulaIssues,
      hardcodeIssues
    },
    textPreview: helpers.previewText(textCorpus),
    warnings
  };
}

function inspectWorksheet(worksheet: ExcelJS.Worksheet) {
  const formulas: FormulaCell[] = [];
  const hardcodedNumbers: HardcodedNumberCell[] = [];
  const rowsWithValues = new Set<number>();
  const columnsWithValues = new Set<number>();
  const formulasByRow = new Map<number, FormulaCell[]>();
  const numericCellsByRow = new Map<number, HardcodedNumberCell[]>();
  let numericCellCount = 0;
  const headerCandidates = getHeaderCandidates(worksheet);
  const headers = headerCandidates.values;
  const apparentPurpose = inferWorksheetPurpose(worksheet.name, headers);
  const hasCalculationPurpose = ["calculations", "outputs"].includes(apparentPurpose);

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    rowsWithValues.add(rowNumber);
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      columnsWithValues.add(colNumber);
      const formula = getFormula(cell.value);
      const number = getNumber(cell.value);
      if (formula) {
        const formulaCell = { address: cell.address, row: rowNumber, col: colNumber, formula };
        formulas.push(formulaCell);
        formulasByRow.set(rowNumber, [...(formulasByRow.get(rowNumber) ?? []), formulaCell]);
      }
      if (typeof number === "number") {
        numericCellCount += 1;
        numericCellsByRow.set(rowNumber, [
          ...(numericCellsByRow.get(rowNumber) ?? []),
          {
            address: cell.address,
            row: rowNumber,
            col: colNumber,
            value: number,
            reason: ""
          }
        ]);
      }
    });
  });

  for (const [rowNumber, numericCells] of numericCellsByRow) {
    if (rowNumber === headerCandidates.rowNumber) continue;
    const rowHasFormula = (formulasByRow.get(rowNumber) ?? []).length > 0;
    if (!hasCalculationPurpose && !rowHasFormula) continue;
    const reason = hasCalculationPurpose ? "numeric constant on calculation-like sheet" : "numeric constant in formula row";
    hardcodedNumbers.push(...numericCells.map((cell) => ({ ...cell, reason })));
  }

  return {
    name: worksheet.name,
    state: worksheet.state ?? "visible",
    apparentPurpose,
    hasChecksPurpose: apparentPurpose === "checks",
    rowCount: worksheet.rowCount,
    columnCount: worksheet.columnCount,
    nonEmptyRowCount: rowsWithValues.size,
    blankRowCount: Math.max(0, worksheet.rowCount - rowsWithValues.size),
    mergedCellCount: getMergedCellCount(worksheet),
    headers,
    headerWarnings: getHeaderWarnings(headers),
    numericCellCount,
    formulaCellCount: formulas.length,
    hardcodedNumberCellCount: hardcodedNumbers.length,
    formulas,
    hardcodedNumbers
  };
}

function findFormulaIssues(formulas: FormulaCell[]): FormulaIssue[] {
  const issues: FormulaIssue[] = [];
  for (const group of groupBy(formulas, (formula) => `row:${formula.row}`)) {
    issues.push(...findRepeatedFormulaIssues(group));
  }
  for (const group of groupBy(formulas, (formula) => `col:${formula.col}`)) {
    issues.push(...findRepeatedFormulaIssues(group));
  }
  return dedupeIssues(issues);
}

function findRepeatedFormulaIssues(formulas: FormulaCell[]) {
  const issues: FormulaIssue[] = [];
  const byFormula = groupBy(formulas, (formula) => formula.formula);
  for (const group of byFormula) {
    if (group.length < 2) continue;
    if (!group[0]?.formula.match(/[A-Z]{1,3}\$?\d+/i)) continue;
    if (group[0].formula.includes("$")) continue;
    const sorted = [...group].sort((a, b) => a.row - b.row || a.col - b.col);
    const hasAdjacentCells = sorted.some((formula, index) => {
      const next = sorted[index + 1];
      return next && Math.abs(next.row - formula.row) + Math.abs(next.col - formula.col) === 1;
    });
    if (!hasAdjacentCells) continue;
    issues.push({
      location: sorted.map((formula) => formula.address).join(", "),
      issueType: "repeated_formula_static_references",
      evidence: `Same relative formula copied without reference movement: ${group[0].formula}`
    });
  }
  return issues;
}

function getHeaderCandidates(worksheet: ExcelJS.Worksheet): HeaderCandidates {
  for (let rowNumber = 1; rowNumber <= Math.min(10, worksheet.rowCount); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = renderCellValue(cell.value).trim();
      if (value) values.push(value);
    });
    if (values.length >= 2) return { rowNumber, values: values.slice(0, 50) };
  }
  return { values: [] };
}

function getHeaderWarnings(headers: string[]) {
  const warnings: string[] = [];
  if (headers.length === 0) warnings.push("No header row detected.");
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicates.length > 0) warnings.push(`Duplicate headers detected: ${[...new Set(duplicates)].join(", ")}.`);
  return warnings;
}

function inferWorksheetPurpose(name: string, headers: string[]) {
  const lower = `${name} ${headers.join(" ")}`.toLowerCase();
  if (lower.includes("check") || lower.includes("tie-out") || lower.includes("tieout")) return "checks";
  if (lower.includes("assumption") || lower.includes("input")) return "assumptions";
  if (lower.includes("calc") || lower.includes("model") || lower.includes("formula")) return "calculations";
  if (lower.includes("output") || lower.includes("summary") || lower.includes("dashboard")) return "outputs";
  if (lower.includes("raw") || lower.includes("export") || lower.includes("data")) return "raw_data";
  if (lower.includes("doc") || lower.includes("readme")) return "documentation";
  return "unclear";
}

function getFormula(value: ExcelJS.CellValue) {
  if (value && typeof value === "object" && "formula" in value && typeof value.formula === "string") return value.formula;
  if (typeof value === "string" && value.startsWith("=")) return value.slice(1);
  return undefined;
}

function getNumber(value: ExcelJS.CellValue) {
  if (typeof value === "number") return value;
  // Formula-result objects are deliberately not treated as numeric constants.
  return undefined;
}

function renderCellValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return String(value.result ?? "");
    if ("formula" in value && typeof value.formula === "string") return value.formula;
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part: { text?: string }) => part.text ?? "").join("");
    return "";
  }
  return String(value);
}

function getMergedCellCount(worksheet: ExcelJS.Worksheet) {
  const model = worksheet.model as { merges?: string[] };
  return model.merges?.length ?? 0;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

function dedupeIssues(values: FormulaIssue[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.location}:${value.issueType}:${value.evidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
