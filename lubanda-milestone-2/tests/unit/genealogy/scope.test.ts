import { asPersonId } from "../../../src/core/contracts/identifiers.js";
import { buildGenealogyGraph } from "../../../src/core/genealogy/graph.js";
import { selectGenealogyScope } from "../../../src/core/genealogy/scope.js";
import { acceptedSnapshot } from "../../helpers/genealogy-builders.js";

describe("genealogy scope", () => {
  it("includes only the selected root subtree", () => {
    const graph = buildGenealogyGraph(acceptedSnapshot());
    const scope = selectGenealogyScope(graph, asPersonId("2"));
    expect(scope.includedPersonIds).toEqual([asPersonId("2"), asPersonId("4")]);
    expect(scope.includedPersonIdSet.has(asPersonId("3"))).toBe(false);
  });
});

