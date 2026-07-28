export const roundDeterministic = (
  value: number,
  decimalPlaces: number,
): number => {
  if (!Number.isFinite(value)) throw new TypeError("Value must be finite");
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 12) {
    throw new RangeError("decimalPlaces must be an integer from 0 through 12");
  }
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const stableUnit = (key: string, seed: number): number => {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const character of key.normalize("NFC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash / 0xffffffff;
};

