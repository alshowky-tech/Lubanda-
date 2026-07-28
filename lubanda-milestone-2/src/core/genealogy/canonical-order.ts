export interface CanonicallyOrderablePerson {
  readonly explicitDisplayOrder: number | null;
  readonly sourceRowNumber: number;
  readonly id: string | null;
}

export const compareCanonicalPersons = (
  left: CanonicallyOrderablePerson,
  right: CanonicallyOrderablePerson,
): number => {
  const leftOrder = left.explicitDisplayOrder ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.explicitDisplayOrder ?? Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (left.sourceRowNumber !== right.sourceRowNumber) {
    return left.sourceRowNumber - right.sourceRowNumber;
  }
  const leftId = left.id ?? "";
  const rightId = right.id ?? "";
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
};

