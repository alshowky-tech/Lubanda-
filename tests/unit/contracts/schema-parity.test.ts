import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import engineSchema from "../../../schemas/engine-configuration.schema.json";
import errorSchema from "../../../schemas/error-codes.schema.json";
import personSchema from "../../../schemas/person.schema.json";
import snapshotSchema from "../../../schemas/genealogy-snapshot.schema.json";
import demandSchema from "../../../schemas/demand-plan.schema.json";
import territorySchema from "../../../schemas/territory-plan.schema.json";
import skeletonSchema from "../../../schemas/skeleton-plan.schema.json";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/defaults.js";
import { DeterministicDemandEngine } from "../../../src/core/demand/index.js";
import { buildGenealogyGraph } from "../../../src/core/genealogy/index.js";
import { DeterministicTerritoryPlanner } from "../../../src/core/territory/index.js";
import { acceptedSnapshot } from "../../helpers/genealogy-builders.js";
import { rectangularTemplate } from "../../helpers/territory-builders.js";
import {
  ENGINE_ISSUE_CODES,
  ISSUE_SEVERITIES,
} from "../../../src/core/contracts/issues.js";

describe("schema parity", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(personSchema);

  it("accepts the typed default configuration including demand", () => {
    expect(ajv.validate(engineSchema, DEFAULT_ENGINE_CONFIGURATION)).toBe(true);
    expect(DEFAULT_ENGINE_CONFIGURATION.demand.minimumDemand).toBeGreaterThan(0);
  });

  it("keeps the distributable JSON default identical to the typed default", () => {
    const jsonDefault = JSON.parse(
      fs.readFileSync("configs/default-engine-configuration.json", "utf8"),
    ) as unknown;
    expect(jsonDefault).toEqual(DEFAULT_ENGINE_CONFIGURATION);
    expect(ajv.validate(engineSchema, jsonDefault)).toBe(true);
  });

  it("requires demand and display-name settings and rejects unknown keys", () => {
    const withoutDemand = structuredClone(
      DEFAULT_ENGINE_CONFIGURATION,
    ) as unknown as Record<string, unknown>;
    delete withoutDemand.demand;
    expect(ajv.validate(engineSchema, withoutDemand)).toBe(false);
    const withoutDisplayNames = structuredClone(
      DEFAULT_ENGINE_CONFIGURATION,
    ) as unknown as Record<string, unknown>;
    delete withoutDisplayNames.displayNames;
    expect(ajv.validate(engineSchema, withoutDisplayNames)).toBe(false);
    expect(
      ajv.validate(engineSchema, {
        ...DEFAULT_ENGINE_CONFIGURATION,
        hiddenSolverConstant: 1,
      }),
    ).toBe(false);
  });

  it("keeps issue code and severity enums aligned", () => {
    const codeEnum = errorSchema.properties.code.enum;
    const severityEnum = errorSchema.properties.severity.enum;
    expect([...codeEnum].sort()).toEqual([...ENGINE_ISSUE_CODES].sort());
    expect(severityEnum).toEqual(ISSUE_SEVERITIES);
  });

  it("validates serializable person and snapshot DTOs", () => {
    const person = {
      id: "1",
      name: "محمد",
      parentId: null,
      generation: 1,
      sourceRowNumber: 2,
      explicitDisplayOrder: null,
      source: { original: { id: "1", name: "محمد", parentId: null, generation: 1 } },
    };
    expect(ajv.validate(personSchema, person)).toBe(true);
    expect(
      ajv.validate(snapshotSchema, {
        schemaVersion: "1.0",
        projectId: "project",
        revisionId: "revision",
        persons: [person],
        sourceChecksum: "a".repeat(64),
        createdAt: "2026-07-27T00:00:00.000Z",
        validationVersion: "1.0",
      }),
    ).toBe(true);
  });

  it("compiles the Milestone 2 demand and territory DTO schemas", () => {
    expect(() => ajv.compile(demandSchema)).not.toThrow();
    expect(() => ajv.compile(territorySchema)).not.toThrow();
  });

  it("compiles the Milestone 3 skeleton DTO schema", () => {
    expect(() => ajv.compile(skeletonSchema)).not.toThrow();
  });

  it("validates emitted Milestone 2 DTOs against their schemas", async () => {
    const snapshot = acceptedSnapshot();
    const graph = buildGenealogyGraph(snapshot);
    const demand = await new DeterministicDemandEngine().compute({
      graph,
      selectedRootId: graph.roots[0]!,
      sourceChecksum: snapshot.sourceChecksum,
      configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
    });
    expect(ajv.validate(demandSchema, demand), ajv.errorsText()).toBe(true);
    const territory = await new DeterministicTerritoryPlanner().plan({
      graph,
      demandPlan: demand,
      selectedRootId: graph.roots[0]!,
      sourceChecksum: snapshot.sourceChecksum,
      templateBoundary: rectangularTemplate(),
      configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
      seed: 42,
    });
    expect(territory.ok).toBe(true);
    if (!territory.ok) return;
    expect(
      ajv.validate(territorySchema, territory.value),
      ajv.errorsText(),
    ).toBe(true);
  });
});
