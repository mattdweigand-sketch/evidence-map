import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import JSZip from "jszip";
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

interface WorkbookSheet {
  name: string;
  state: string;
  path: string;
}

interface WorksheetCell {
  address: string;
  row: number;
  col: number;
  text: string;
  formula?: string;
  number?: number;
}

interface ParsedWorksheet {
  name: string;
  state: string;
  cells: WorksheetCell[];
  rowCount: number;
  columnCount: number;
  mergedCellCount: number;
}

export async function inspectXlsxWorkbook(
  base: BaseFileInspection,
  helpers: {
    inferDateCandidates(value: string): string[];
    inferOwnerCandidates(value: string): string[];
    previewText(value: string): string;
  }
): Promise<FileInspectionDraft> {
  const zip = await JSZip.loadAsync(await readFile(base.path));
  const workbookXml = await readXml(zip, "xl/workbook.xml");
  const workbookRelsXml = await readXml(zip, "xl/_rels/workbook.xml.rels");
  const sharedStrings = await readSharedStrings(zip);
  const sheets = parseWorkbookSheets(workbookXml, workbookRelsXml);

  const worksheets = await Promise.all(
    sheets.map(async (sheet) =>
      parseWorksheetXml({
        name: sheet.name,
        state: sheet.state,
        xml: await readXml(zip, sheet.path),
        sharedStrings
      })
    )
  );

  const sheetSummaries = worksheets.map((worksheet) => inspectWorksheet(worksheet));
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

function inspectWorksheet(worksheet: ParsedWorksheet) {
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

  for (const cell of worksheet.cells) {
    if (cell.text || cell.formula || typeof cell.number === "number") {
      rowsWithValues.add(cell.row);
      columnsWithValues.add(cell.col);
    }

    if (cell.formula) {
      const formulaCell = { address: cell.address, row: cell.row, col: cell.col, formula: cell.formula };
      formulas.push(formulaCell);
      formulasByRow.set(cell.row, [...(formulasByRow.get(cell.row) ?? []), formulaCell]);
    }
    if (typeof cell.number === "number") {
      numericCellCount += 1;
      numericCellsByRow.set(cell.row, [
        ...(numericCellsByRow.get(cell.row) ?? []),
        {
          address: cell.address,
          row: cell.row,
          col: cell.col,
          value: cell.number,
          reason: ""
        }
      ]);
    }
  }

  for (const [rowNumber, numericCells] of numericCellsByRow) {
    if (rowNumber === headerCandidates.rowNumber) continue;
    const rowHasFormula = (formulasByRow.get(rowNumber) ?? []).length > 0;
    if (!hasCalculationPurpose && !rowHasFormula) continue;
    const reason = hasCalculationPurpose ? "numeric constant on calculation-like sheet" : "numeric constant in formula row";
    hardcodedNumbers.push(...numericCells.map((cell) => ({ ...cell, reason })));
  }

  return {
    name: worksheet.name,
    state: worksheet.state,
    apparentPurpose,
    hasChecksPurpose: apparentPurpose === "checks",
    rowCount: worksheet.rowCount,
    columnCount: worksheet.columnCount,
    nonEmptyRowCount: rowsWithValues.size,
    blankRowCount: Math.max(0, worksheet.rowCount - rowsWithValues.size),
    mergedCellCount: worksheet.mergedCellCount,
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

function getHeaderCandidates(worksheet: ParsedWorksheet): HeaderCandidates {
  const cellsByRow = new Map<number, WorksheetCell[]>();
  for (const cell of worksheet.cells) {
    cellsByRow.set(cell.row, [...(cellsByRow.get(cell.row) ?? []), cell]);
  }
  for (let rowNumber = 1; rowNumber <= Math.min(10, worksheet.rowCount); rowNumber += 1) {
    const values = (cellsByRow.get(rowNumber) ?? [])
      .sort((a, b) => a.col - b.col)
      .map((cell) => cell.text.trim())
      .filter(Boolean);
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

async function readXml(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) throw new Error(`XLSX package is missing ${path}.`);
  return file.async("text");
}

async function readSharedStrings(zip: JSZip) {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = await file.async("text");
  return matchElements(xml, "si").map((element) => extractTextRuns(element.inner));
}

function parseWorkbookSheets(workbookXml: string, workbookRelsXml: string): WorkbookSheet[] {
  const relationships = new Map(
    matchElements(workbookRelsXml, "Relationship").map((element) => {
      const attrs = parseAttributes(element.attributes);
      return [attrs.Id, attrs.Target] as const;
    })
  );

  return matchElements(workbookXml, "sheet").map((element) => {
    const attrs = parseAttributes(element.attributes);
    const relationshipId = attrs["r:id"];
    const target = relationshipId ? relationships.get(relationshipId) : undefined;
    if (!attrs.name || !target) throw new Error("XLSX workbook has a sheet without a worksheet relationship.");
    return {
      name: attrs.name,
      state: attrs.state ?? "visible",
      path: resolveWorkbookTarget(target)
    };
  });
}

function parseWorksheetXml(input: { name: string; state: string; xml: string; sharedStrings: string[] }): ParsedWorksheet {
  const cells: WorksheetCell[] = [];
  let maxRow = 0;
  let maxCol = 0;

  for (const rowElement of matchElements(input.xml, "row")) {
    const rowAttrs = parseAttributes(rowElement.attributes);
    const rowNumber = toPositiveInteger(rowAttrs.r) ?? maxRow + 1;
    let fallbackColumn = 0;

    for (const cellElement of matchElements(rowElement.inner, "c")) {
      fallbackColumn += 1;
      const cellAttrs = parseAttributes(cellElement.attributes);
      const fallbackAddress = `${columnName(fallbackColumn)}${rowNumber}`;
      const address = cellAttrs.r ?? fallbackAddress;
      const addressParts = parseCellAddress(address);
      const col = addressParts?.col ?? fallbackColumn;
      const row = addressParts?.row ?? rowNumber;
      const formula = extractFirstElement(cellElement.inner, "f");
      const rawValue = extractFirstElement(cellElement.inner, "v");
      const text = renderCellText({ type: cellAttrs.t, formula, rawValue, inner: cellElement.inner, sharedStrings: input.sharedStrings });
      const number = getCellNumber({ type: cellAttrs.t, formula, rawValue });

      cells.push({
        address,
        row,
        col,
        text,
        formula: formula ? decodeXml(formula) : undefined,
        number
      });
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
    }
    maxRow = Math.max(maxRow, rowNumber);
  }

  return {
    name: input.name,
    state: input.state,
    cells,
    rowCount: maxRow,
    columnCount: maxCol,
    mergedCellCount: matchElements(input.xml, "mergeCell").length
  };
}

function renderCellText(input: { type?: string; formula?: string; rawValue?: string; inner: string; sharedStrings: string[] }) {
  if (input.formula) return decodeXml(input.formula);
  if (input.type === "s") {
    const index = toPositiveInteger(input.rawValue);
    return typeof index === "number" ? input.sharedStrings[index] ?? "" : "";
  }
  if (input.type === "inlineStr") return extractTextRuns(input.inner);
  if (input.rawValue === undefined) return "";
  return decodeXml(input.rawValue);
}

function getCellNumber(input: { type?: string; formula?: string; rawValue?: string }) {
  if (input.formula || input.rawValue === undefined) return undefined;
  if (input.type && input.type !== "n") return undefined;
  const value = Number(input.rawValue);
  return Number.isFinite(value) ? value : undefined;
}

function extractTextRuns(xml: string) {
  return matchElements(xml, "t")
    .map((element) => decodeXml(element.inner))
    .join("");
}

function extractFirstElement(xml: string, tagName: string) {
  return matchElements(xml, tagName)[0]?.inner;
}

function matchElements(xml: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tagName}>)`, "g");
  const elements: Array<{ attributes: string; inner: string }> = [];
  for (const match of xml.matchAll(pattern)) {
    elements.push({ attributes: match[1] ?? "", inner: match[2] ?? "" });
  }
  return elements;
}

function parseAttributes(value: string) {
  const attrs: Record<string, string> = {};
  for (const match of value.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attrs[match[1] ?? ""] = decodeXml(match[2] ?? "");
  }
  return attrs;
}

function parseCellAddress(address: string) {
  const match = address.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return undefined;
  return {
    col: columnNumber(match[1] ?? ""),
    row: Number(match[2])
  };
}

function columnNumber(name: string) {
  let value = 0;
  for (const char of name.toUpperCase()) {
    value = value * 26 + char.charCodeAt(0) - 64;
  }
  return value;
}

function columnName(value: number) {
  let name = "";
  let remaining = value;
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return name || "A";
}

function toPositiveInteger(value?: string) {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function resolveWorkbookTarget(target: string) {
  if (target.startsWith("/")) return target.slice(1);
  return posix.normalize(posix.join("xl", target));
}

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => decodeCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => decodeCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function decodeCodePoint(value: number) {
  return Number.isFinite(value) ? String.fromCodePoint(value) : "";
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
