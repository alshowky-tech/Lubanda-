const digitMap: Readonly<Record<string, string>> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

export const normalizeDigits = (value: string): string =>
  [...value].map((character) => digitMap[character] ?? character).join("");

export const parseStrictInteger = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const normalized = normalizeDigits(value.normalize("NFC").trim());
  if (!/^[+-]?\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export const parseOptionalFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const normalized =
    typeof value === "string" ? normalizeDigits(value.normalize("NFC").trim()) : value;
  const parsed = typeof normalized === "number" ? normalized : Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

