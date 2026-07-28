export type Brand<T, B extends string> = T & { readonly __brand: B };

export type PersonId = Brand<string, "PersonId">;
export type ProjectId = Brand<string, "ProjectId">;
export type RevisionId = Brand<string, "RevisionId">;
export type DemandPlanId = Brand<string, "DemandPlanId">;
export type TerritoryId = Brand<string, "TerritoryId">;
export type TerritoryPlanId = Brand<string, "TerritoryPlanId">;
export type CorridorId = Brand<string, "CorridorId">;
export type SkeletonBranchId = Brand<string, "SkeletonBranchId">;
export type SkeletonPlanId = Brand<string, "SkeletonPlanId">;

const asNonEmptyId = <T extends string>(value: string, label: string): T => {
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return normalized as T;
};

export const asPersonId = (value: string): PersonId =>
  asNonEmptyId<PersonId>(value, "PersonId");

export const asProjectId = (value: string): ProjectId =>
  asNonEmptyId<ProjectId>(value, "ProjectId");

export const asRevisionId = (value: string): RevisionId =>
  asNonEmptyId<RevisionId>(value, "RevisionId");

export const asDemandPlanId = (value: string): DemandPlanId =>
  asNonEmptyId<DemandPlanId>(value, "DemandPlanId");

export const asTerritoryId = (value: string): TerritoryId =>
  asNonEmptyId<TerritoryId>(value, "TerritoryId");

export const asTerritoryPlanId = (value: string): TerritoryPlanId =>
  asNonEmptyId<TerritoryPlanId>(value, "TerritoryPlanId");

export const asCorridorId = (value: string): CorridorId =>
  asNonEmptyId<CorridorId>(value, "CorridorId");

export const asSkeletonBranchId = (value: string): SkeletonBranchId =>
  asNonEmptyId<SkeletonBranchId>(value, "SkeletonBranchId");

export const asSkeletonPlanId = (value: string): SkeletonPlanId =>
  asNonEmptyId<SkeletonPlanId>(value, "SkeletonPlanId");
