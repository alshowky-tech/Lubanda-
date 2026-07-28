import { strToU8, zipSync } from "fflate";

export const REQUIRED_HEADERS = [
  "كود الفرد الفريد (MANDATORY ID)",
  "الاسم الكامل للأبناء",
  "كود الأب المباشر (Parent ID)",
  "الجيل الموسوي المتسلسل",
];

const escapeXml = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");

const columnName = (index: number): string => {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
};

const cellXml = (value: unknown, row: number, column: number): string => {
  const reference = `${columnName(column)}${row}`;
  if (value === null || value === undefined) return `<c r="${reference}"/>`;
  if (typeof value === "number") return `<c r="${reference}"><v>${value}</v></c>`;
  if (typeof value === "boolean") {
    return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
};

export const workbookBuffer = (
  rows: readonly (readonly unknown[])[],
  sheetName = "Genealogy",
): ArrayBuffer => {
  const sheetRows = rows
    .map(
      (values, rowIndex) =>
        `<row r="${rowIndex + 1}">${values
          .map((value, columnIndex) => cellXml(value, rowIndex + 1, columnIndex))
          .join("")}</row>`,
    )
    .join("");
  const files = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheetRows}</sheetData>
</worksheet>`,
    ),
  };
  const bytes = zipSync(files);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

export const validWorkbookBuffer = (): ArrayBuffer =>
  workbookBuffer([
    REQUIRED_HEADERS,
    ["001", "محمد", null, 1],
    ["002", "مهدي", "001", 2],
    ["003", "حيدر", "001", 2],
  ]);
