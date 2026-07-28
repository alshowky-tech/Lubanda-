const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
      Object.keys(source)
        .sort((left, right) => left.localeCompare(right, "en"))
        .map((key) => [key, canonicalize(source[key])]),
    );
  }
  return value;
};

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

export const sha256Canonical = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

