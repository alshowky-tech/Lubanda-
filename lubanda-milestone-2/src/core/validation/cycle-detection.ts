export interface ParentRow {
  readonly id: string;
  readonly parentId: string | null;
}

export const detectCyclePaths = (
  rows: readonly ParentRow[],
): readonly (readonly string[])[] => {
  const parentById = new Map(rows.map((row) => [row.id, row.parentId] as const));
  const globallyComplete = new Set<string>();
  const reported = new Set<string>();
  const cycles: string[][] = [];

  for (const start of [...parentById.keys()].sort()) {
    if (globallyComplete.has(start)) continue;
    const localIndex = new Map<string, number>();
    const path: string[] = [];
    let current: string | null | undefined = start;

    while (current !== null && current !== undefined && parentById.has(current)) {
      const seenAt = localIndex.get(current);
      if (seenAt !== undefined) {
        const cycle = [...path.slice(seenAt), current];
        const members = cycle.slice(0, -1);
        const canonicalStart = [...members].sort()[0];
        if (canonicalStart) {
          const offset = members.indexOf(canonicalStart);
          const canonical = [
            ...members.slice(offset),
            ...members.slice(0, offset),
            canonicalStart,
          ];
          const key = canonical.join("\u0000");
          if (!reported.has(key)) {
            reported.add(key);
            cycles.push(canonical);
          }
        }
        break;
      }
      if (globallyComplete.has(current)) break;
      localIndex.set(current, path.length);
      path.push(current);
      current = parentById.get(current);
    }
    for (const id of path) globallyComplete.add(id);
  }

  return cycles.sort((left, right) => left.join().localeCompare(right.join()));
};

