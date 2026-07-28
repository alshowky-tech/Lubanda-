import { strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export type XlsxCellValue = string | number | boolean | null;

export interface ParsedWorksheet {
  readonly name: string;
  readonly rows: readonly (readonly XlsxCellValue[])[];
  readonly mergeRanges: readonly string[];
  readonly hasExternalFormula: boolean;
  readonly formulaWithoutCachedValueRow: number | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
});

const asArray = <T>(value: T | readonly T[] | undefined): readonly T[] =>
  value === undefined
    ? []
    : Array.isArray(value)
      ? (value as readonly T[])
      : [value as T];

const parseXml = (bytes: Uint8Array, label: string): Record<string, unknown> => {
  const xml = strFromU8(bytes);
  if (/<!DOCTYPE/iu.test(xml)) {
    throw new TypeError(`${label} contains a prohibited DOCTYPE declaration`);
  }
  return parser.parse(xml) as Record<string, unknown>;
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an XML object`);
  }
  return value as Record<string, unknown>;
};

const attribute = (node: Record<string, unknown>, name: string): string | undefined => {
  const value = node[`@_${name}`];
  return value === undefined ? undefined : String(value);
};

const normalizeZipPath = (target: string): string => {
  const targetWithoutRoot = target.replace(/^\/+/u, "");
  const workbookRelativePath = targetWithoutRoot.startsWith("xl/")
    ? targetWithoutRoot
    : `xl/${targetWithoutRoot}`;
  const parts: string[] = [];
  for (const part of workbookRelativePath.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new TypeError(`Worksheet target escapes the workbook root: ${target}`);
      }
      parts.pop();
    }
    else parts.push(part);
  }
  if (parts[0] !== "xl") {
    throw new TypeError(`Worksheet target escapes the workbook root: ${target}`);
  }
  return parts.join("/");
};

const extractText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(extractText).join("");
  const record = asRecord(value, "text node");
  if ("#text" in record) return extractText(record["#text"]);
  if ("t" in record) return extractText(record.t);
  if ("r" in record) return extractText(record.r);
  return "";
};

const columnIndex = (cellReference: string): number => {
  const letters = /^([A-Z]+)\d+$/u.exec(cellReference)?.[1];
  if (!letters) throw new TypeError(`Invalid cell reference: ${cellReference}`);
  let value = 0;
  for (const character of letters) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value - 1;
};

const parseSharedStrings = (
  archive: Readonly<Record<string, Uint8Array>>,
): readonly string[] => {
  const bytes = archive["xl/sharedStrings.xml"];
  if (!bytes) return [];
  const root = asRecord(parseXml(bytes, "shared strings").sst, "sst");
  return asArray(root.si).map((item) => extractText(item));
};

const cellValue = (
  cell: Record<string, unknown>,
  sharedStrings: readonly string[],
): XlsxCellValue => {
  const type = attribute(cell, "t");
  if (type === "inlineStr") return extractText(cell.is);
  const raw = extractText(cell.v);
  if (raw === "") return null;
  if (type === "s") {
    const index = Number(raw);
    if (!Number.isSafeInteger(index) || sharedStrings[index] === undefined) {
      throw new TypeError(`Invalid shared-string index: ${raw}`);
    }
    return sharedStrings[index];
  }
  if (type === "b") return raw === "1" || raw.toLocaleLowerCase("en-US") === "true";
  if (type === "str" || type === "d" || type === "e") return raw;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
};

const readSheet = (
  name: string,
  path: string,
  archive: Readonly<Record<string, Uint8Array>>,
  sharedStrings: readonly string[],
): ParsedWorksheet => {
  const bytes = archive[path];
  if (!bytes) throw new TypeError(`Worksheet XML is missing: ${path}`);
  const worksheet = asRecord(parseXml(bytes, `worksheet ${name}`).worksheet, "worksheet");
  const sheetData = asRecord(worksheet.sheetData ?? {}, "sheetData");
  const parsedRows = new Map<number, readonly XlsxCellValue[]>();
  let maximumRow = 0;
  let hasExternalFormula = false;
  let formulaWithoutCachedValueRow: number | null = null;

  for (const rowValue of asArray(sheetData.row)) {
    const row = asRecord(rowValue, "row");
    const rowNumber = Number(attribute(row, "r"));
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) {
      throw new TypeError("Worksheet row has an invalid row number");
    }
    const values: XlsxCellValue[] = [];
    for (const cellValueNode of asArray(row.c)) {
      const cell = asRecord(cellValueNode, "cell");
      const reference = attribute(cell, "r");
      if (!reference) throw new TypeError("Worksheet cell is missing its reference");
      if (cell.f !== undefined) {
        const formula = extractText(cell.f);
        if (/\[[^\]]+\]/u.test(formula)) hasExternalFormula = true;
        if (cell.v === undefined) formulaWithoutCachedValueRow ??= rowNumber;
      }
      values[columnIndex(reference)] = cellValue(cell, sharedStrings);
    }
    parsedRows.set(rowNumber, values);
    maximumRow = Math.max(maximumRow, rowNumber);
  }

  const rows = Array.from({ length: maximumRow }, (_, index) => parsedRows.get(index + 1) ?? []);
  const mergeCells =
    typeof worksheet.mergeCells === "object" && worksheet.mergeCells !== null
      ? asRecord(worksheet.mergeCells, "mergeCells")
      : {};
  const mergeRanges = asArray(mergeCells.mergeCell)
    .map((item) => attribute(asRecord(item, "mergeCell"), "ref"))
    .filter((value): value is string => Boolean(value));

  return {
    name,
    rows,
    mergeRanges,
    hasExternalFormula,
    formulaWithoutCachedValueRow,
  };
};

export const parseXlsxArchive = (
  archive: Readonly<Record<string, Uint8Array>>,
): readonly ParsedWorksheet[] => {
  const workbookBytes = archive["xl/workbook.xml"];
  const relationshipBytes = archive["xl/_rels/workbook.xml.rels"];
  if (!workbookBytes || !relationshipBytes) {
    throw new TypeError("Workbook relationship metadata is missing");
  }
  const workbook = asRecord(parseXml(workbookBytes, "workbook").workbook, "workbook");
  const sheets = asRecord(workbook.sheets, "sheets");
  const relationshipsRoot = asRecord(
    parseXml(relationshipBytes, "workbook relationships").Relationships,
    "Relationships",
  );
  const relationships = new Map(
    asArray(relationshipsRoot.Relationship).map((value) => {
      const relationship = asRecord(value, "Relationship");
      const id = attribute(relationship, "Id");
      const target = attribute(relationship, "Target");
      if (!id || !target) throw new TypeError("Workbook relationship is incomplete");
      return [id, normalizeZipPath(target)] as const;
    }),
  );
  const sharedStrings = parseSharedStrings(archive);

  return asArray(sheets.sheet).map((value) => {
    const sheet = asRecord(value, "sheet");
    const name = attribute(sheet, "name");
    const relationshipId = attribute(sheet, "r:id");
    if (!name || !relationshipId) throw new TypeError("Workbook sheet metadata is incomplete");
    const path = relationships.get(relationshipId);
    if (!path) throw new TypeError(`Worksheet relationship not found: ${relationshipId}`);
    return readSheet(name, path, archive, sharedStrings);
  });
};
