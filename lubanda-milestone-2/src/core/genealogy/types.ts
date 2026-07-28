import type {
  PersonId,
  ProjectId,
  RevisionId,
} from "../contracts/identifiers.js";

export type SourceScalar = string | number | boolean | null;

export interface NormalizedPersonRow {
  readonly id: string | null;
  readonly name: string | null;
  readonly parentId: string | null;
  readonly generation: number | null;
  readonly explicitDisplayOrder: number | null;
  readonly sourceRowNumber: number;
  readonly title: string | null;
  readonly branchName: string | null;
  readonly birthPlace: string | null;
  readonly birthYear: string | null;
  readonly deathYear: string | null;
  readonly notes: string | null;
  readonly sourceRef: string | null;
  readonly aliases: readonly string[];
  readonly original: Readonly<Record<string, SourceScalar>>;
}

export interface Person {
  readonly id: PersonId;
  readonly name: string;
  readonly parentId: PersonId | null;
  readonly generation: number;
  readonly sourceRowNumber: number;
  readonly explicitDisplayOrder: number | null;
  readonly title?: string;
  readonly branchName?: string;
  readonly birthPlace?: string;
  readonly birthYear?: string;
  readonly deathYear?: string;
  readonly notes?: string;
  readonly aliases?: readonly string[];
  readonly source?: {
    readonly original: Readonly<Record<string, SourceScalar>>;
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AcceptedGenealogy {
  readonly persons: readonly Person[];
  readonly roots: readonly PersonId[];
  readonly sourceChecksum: string;
}

export interface GenealogySnapshot {
  readonly schemaVersion: "1.0";
  readonly projectId: ProjectId;
  readonly revisionId: RevisionId;
  readonly persons: readonly Person[];
  readonly sourceChecksum: string;
  readonly createdAt: string;
  readonly validationVersion: "1.0";
}

export interface SnapshotBuildInput {
  readonly projectId: ProjectId;
  readonly revisionId: RevisionId;
  readonly createdAt: string;
}

export interface GenealogyRevisionCommitter {
  commit(snapshot: GenealogySnapshot): Promise<RevisionId>;
}

