import type { DisplayNameConfig } from "../config/types.js";

const WHITESPACE = /\s/u;

const comparePrefixes = (left: string, right: string): number =>
  [...right].length - [...left].length || left.localeCompare(right);

const skipWhitespace = (value: string, start: number): number => {
  let index = start;
  while (index < value.length && WHITESPACE.test(value[index] as string)) {
    index += 1;
  }
  return index;
};

const matchesLeadingPrefix = (
  value: string,
  start: number,
  prefix: string,
): number | null => {
  let valueIndex = start;
  let prefixIndex = 0;
  while (prefixIndex < prefix.length) {
    const prefixCharacter = prefix[prefixIndex] as string;
    if (WHITESPACE.test(prefixCharacter)) {
      prefixIndex = skipWhitespace(prefix, prefixIndex);
      const nextValueIndex = skipWhitespace(value, valueIndex);
      if (nextValueIndex === valueIndex) return null;
      valueIndex = nextValueIndex;
      continue;
    }
    if (value[valueIndex] !== prefixCharacter) return null;
    prefixIndex += 1;
    valueIndex += 1;
  }
  return valueIndex;
};

/**
 * Produces rendering-only label text. The source person name is never mutated,
 * normalized, or replaced.
 */
export class DisplayNameFormatter {
  format(name: string, configuration: DisplayNameConfig): string {
    if (!configuration.removeHonorificPrefixes) return name;

    const prefixes = [...configuration.honorificPrefixes]
      .filter((prefix) => prefix.trim().length > 0)
      .sort(comparePrefixes);
    let start = skipWhitespace(name, 0);
    let removedPrefix = false;

    while (start < name.length) {
      const match = prefixes
        .map((prefix) => matchesLeadingPrefix(name, start, prefix))
        .find((end): end is number =>
          end !== null &&
          (end === name.length || WHITESPACE.test(name[end] as string))
        );
      if (match === undefined) break;
      removedPrefix = true;
      start = skipWhitespace(name, match);
    }

    if (!removedPrefix || start >= name.length) return name;
    return name.slice(start);
  }
}

export const formatDisplayName = (
  name: string,
  configuration: DisplayNameConfig,
): string => new DisplayNameFormatter().format(name, configuration);
