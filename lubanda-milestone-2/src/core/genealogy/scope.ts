import type { PersonId } from "../contracts/identifiers.js";
import type { GenealogyGraph } from "./graph.js";

export interface GenealogyScope {
  readonly rootId: PersonId;
  readonly includedPersonIds: readonly PersonId[];
  readonly includedPersonIdSet: ReadonlySet<PersonId>;
}

export const selectGenealogyScope = (
  graph: GenealogyGraph,
  rootId: PersonId,
): GenealogyScope => {
  const includedPersonIds = graph.getSubtree(rootId);
  return {
    rootId,
    includedPersonIds,
    includedPersonIdSet: new Set(includedPersonIds),
  };
};

