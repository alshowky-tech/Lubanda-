import { asPersonId } from "../../../src/core/contracts/identifiers.js";
import { buildGenealogyGraph } from "../../../src/core/genealogy/graph.js";
import { acceptedSnapshot } from "../../helpers/genealogy-builders.js";

describe("GenealogyGraph", () => {
  it("builds runtime maps with canonical child ordering", () => {
    const graph = buildGenealogyGraph(acceptedSnapshot());
    expect(graph.personsById).toBeInstanceOf(Map);
    expect(graph.childrenByParentId.get(asPersonId("1"))).toEqual([
      asPersonId("3"),
      asPersonId("2"),
    ]);
  });

  it("queries ancestors, descendants, subtree and terminal state", () => {
    const graph = buildGenealogyGraph(acceptedSnapshot());
    expect(graph.getAncestors(asPersonId("4"))).toEqual([
      asPersonId("2"),
      asPersonId("1"),
    ]);
    expect(graph.getDescendants(asPersonId("1"))).toEqual([
      asPersonId("3"),
      asPersonId("2"),
      asPersonId("4"),
    ]);
    expect(graph.getSubtree(asPersonId("2"))).toEqual([
      asPersonId("2"),
      asPersonId("4"),
    ]);
    expect(graph.isTerminal(asPersonId("4"))).toBe(true);
    expect(graph.isTerminal(asPersonId("1"))).toBe(false);
  });

  it("does not serialize runtime maps into the snapshot", () => {
    const snapshot = acceptedSnapshot();
    buildGenealogyGraph(snapshot);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("personsById");
    expect(JSON.parse(serialized).persons).toHaveLength(4);
  });
});

