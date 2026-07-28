import type { CanonicalColumn } from "./types.js";

const aliases: Readonly<Record<CanonicalColumn, readonly string[]>> = {
  id: [
    "كود الفرد الفريد (MANDATORY ID)",
    "كود الفرد الفريد",
    "mandatory id",
    "id",
    "person id",
  ],
  name: ["الاسم الكامل للأبناء", "الاسم الكامل", "الاسم", "name", "full name"],
  parentId: [
    "كود الأب المباشر (Parent ID)",
    "كود الأب المباشر",
    "parent id",
    "father id",
  ],
  generation: [
    "الجيل الموسوي المتسلسل",
    "الجيل",
    "generation",
    "generation index",
  ],
  title: ["اللقب المعتمد (مثلاً السيد/الشيخ)", "اللقب المعتمد", "اللقب", "title"],
  branchName: ["اسم الفرع", "الفرع", "branch name"],
  birthPlace: ["مكان ولادة الفرد", "مكان الولادة", "birth place"],
  birthYear: ["سنة الولادة التقديرية", "سنة الولادة", "birth year"],
  deathYear: ["سنة الوفاة (أو فارغ)", "سنة الوفاة", "death year"],
  notes: ["ملاحظات وهوامش النسب", "ملاحظات", "notes"],
  sourceRef: ["مرجع المصدر", "المصدر", "source reference", "source ref"],
  explicitDisplayOrder: ["ترتيب العرض", "display order", "order"],
  aliases: ["الأسماء البديلة", "اسماء بديلة", "aliases"],
};

export const REQUIRED_COLUMNS = [
  "id",
  "name",
  "parentId",
  "generation",
] as const satisfies readonly CanonicalColumn[];

export const normalizeHeader = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");

const reverseAliases = new Map<string, CanonicalColumn>();
for (const [field, values] of Object.entries(aliases) as [
  CanonicalColumn,
  readonly string[],
][]) {
  for (const value of values) {
    reverseAliases.set(normalizeHeader(value), field);
  }
}

export const resolveHeader = (value: unknown): CanonicalColumn | undefined =>
  reverseAliases.get(normalizeHeader(value));

