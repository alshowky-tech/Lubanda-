import {
  asDemandPlanId,
  type PersonId,
} from "../contracts/identifiers.js";
import { sha256Canonical } from "../determinism/canonical-json.js";
import { roundDeterministic } from "../determinism/numeric.js";
import type { Person } from "../genealogy/types.js";
import type {
  DemandComputationInput,
  DemandEngine as DemandEngineContract,
  DemandPlan,
  DerivedSpatialDemand,
  PersonDemand,
  RawSubtreeStatistics,
} from "./types.js";

const normalizedEntropy = (values: readonly number[]): number => {
  if (values.length <= 1) return 0;
  const sum = values.reduce((total, value) => total + value, 0);
  if (sum <= 0) return 0;
  const entropy = values.reduce((total, value) => {
    const probability = value / sum;
    return probability <= 0 ? total : total - probability * Math.log2(probability);
  }, 0);
  return entropy / Math.log2(values.length);
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

export class DeterministicDemandEngine implements DemandEngineContract {
  async compute(input: DemandComputationInput): Promise<DemandPlan> {
    if (!input.graph.personsById.has(input.selectedRootId)) {
      throw new RangeError(`Unknown demand root: ${input.selectedRootId}`);
    }
    const config = input.configuration;
    const decimalPlaces = config.roundingDecimalPlaces;
    input.diagnostics?.emit({
      stage: "COMPUTE_DEMAND",
      eventType: "STAGE_START",
      entityId: input.selectedRootId,
    });

    const canonicalScope = input.graph.getSubtree(input.selectedRootId);
    const canonicalIndex = new Map(
      canonicalScope.map((id, index) => [id, index] as const),
    );
    const postorder: PersonId[] = [];
    const stack: Array<{ readonly id: PersonId; readonly expanded: boolean }> = [
      { id: input.selectedRootId, expanded: false },
    ];
    let maximumStackSize = 1;
    while (stack.length > 0) {
      maximumStackSize = Math.max(maximumStackSize, stack.length);
      const current = stack.pop() as {
        readonly id: PersonId;
        readonly expanded: boolean;
      };
      if (current.expanded) {
        postorder.push(current.id);
        continue;
      }
      stack.push({ id: current.id, expanded: true });
      const children = input.graph.childrenByParentId.get(current.id) ?? [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ id: children[index] as PersonId, expanded: false });
      }
    }

    const computed = new Map<PersonId, PersonDemand>();
    for (let postorderIndex = 0; postorderIndex < postorder.length; postorderIndex += 1) {
      const personId = postorder[postorderIndex] as PersonId;
      const person = input.graph.personsById.get(personId) as Person;
      const children = input.graph.childrenByParentId.get(personId) ?? [];
      const childResults = children.map((id) => computed.get(id) as PersonDemand);
      const ownLabelWidth =
        Array.from(person.name).length * config.estimatedCharacterWidth +
        config.personPadding * 2;
      const ownLabelHeight =
        config.estimatedLabelHeight + config.personPadding * 2;
      const ownLabelFootprint = ownLabelWidth * ownLabelHeight;
      const descendantCount = childResults.reduce(
        (total, child) => total + child.raw.descendantCount + 1,
        0,
      );
      const terminalPersonCount =
        children.length === 0
          ? 1
          : childResults.reduce(
              (total, child) => total + child.raw.terminalPersonCount,
              0,
            );
      const subtreeDepth =
        children.length === 0
          ? 0
          : 1 +
            Math.max(...childResults.map((child) => child.raw.subtreeDepth));
      const subtreeLabelFootprint =
        ownLabelFootprint +
        childResults.reduce(
          (total, child) => total + child.raw.subtreeLabelFootprint,
          0,
        );
      const branchingEntropy = normalizedEntropy(
        childResults.map((child) => child.spatial.requiredArea),
      );
      const branchingComplexity =
        children.length === 0
          ? 0
          : children.length * (1 + branchingEntropy);
      const raw: RawSubtreeStatistics = {
        descendantCount,
        directChildCount: children.length,
        subtreeDepth,
        terminalPersonCount,
        ownLabelFootprint: roundDeterministic(
          ownLabelFootprint,
          decimalPlaces,
        ),
        subtreeLabelFootprint: roundDeterministic(
          subtreeLabelFootprint,
          decimalPlaces,
        ),
        branchingEntropy: roundDeterministic(
          branchingEntropy,
          decimalPlaces,
        ),
        branchingComplexity: roundDeterministic(
          branchingComplexity,
          decimalPlaces,
        ),
      };
      const demandScore = clamp(
        config.subtreeSizeWeight * Math.sqrt(descendantCount + 1) +
          config.directChildCountWeight * children.length +
          config.terminalCountWeight * terminalPersonCount +
          config.maxDepthWeight * subtreeDepth +
          config.branchEntropyWeight * branchingComplexity,
        config.minimumDemand,
        config.maximumDemand,
      );
      const labelArea = subtreeLabelFootprint * config.labelWeight;
      const clearanceSpan =
        config.woodClearance + config.safetyMargin * 2;
      const woodAndRoutingArea =
        (terminalPersonCount + children.length + 1) *
        clearanceSpan *
        clearanceSpan *
        config.routingClearanceWeight;
      const paddingAndSafetyArea =
        (descendantCount + 1) *
        (config.personPadding + config.safetyMargin) ** 2;
      const appliedLineageWeight = config.lineageWeights[personId] ?? 1;
      const requiredArea =
        clamp(
          Math.max(
            config.minimumArea,
            labelArea +
              woodAndRoutingArea +
              paddingAndSafetyArea +
              demandScore * config.personPadding ** 2,
          ),
          config.minimumArea,
          config.maximumArea,
        ) * appliedLineageWeight;
      const spatial: DerivedSpatialDemand = {
        demandScore: roundDeterministic(demandScore, decimalPlaces),
        labelArea: roundDeterministic(labelArea, decimalPlaces),
        woodAndRoutingArea: roundDeterministic(
          woodAndRoutingArea,
          decimalPlaces,
        ),
        paddingAndSafetyArea: roundDeterministic(
          paddingAndSafetyArea,
          decimalPlaces,
        ),
        minimumArea: config.minimumArea,
        requiredArea: roundDeterministic(requiredArea, decimalPlaces),
        appliedLineageWeight,
      };
      computed.set(
        personId,
        Object.freeze({
          personId,
          raw: Object.freeze(raw),
          spatial: Object.freeze(spatial),
          metadata: Object.freeze({
            postorderIndex,
            canonicalScopeIndex: canonicalIndex.get(personId) as number,
            algorithmVersion: "1.0" as const,
          }),
        }),
      );
    }

    const results = canonicalScope.map((id) => computed.get(id) as PersonDemand);
    const configurationUsed = {
      ...config,
      lineageWeights: Object.freeze(
        Object.fromEntries(
          Object.entries(config.lineageWeights).sort(([left], [right]) =>
            left.localeCompare(right, "en"),
          ),
        ),
      ),
    };
    const totalRequiredArea = roundDeterministic(
      (computed.get(input.selectedRootId) as PersonDemand).spatial.requiredArea,
      decimalPlaces,
    );
    const fingerprintInput = {
      selectedRootId: input.selectedRootId,
      sourceChecksum: input.sourceChecksum,
      configurationUsed,
      results,
      totalRequiredArea,
      algorithm: "ITERATIVE_BOTTOM_UP",
    };
    const deterministicFingerprint = await sha256Canonical(fingerprintInput);
    const plan: DemandPlan = Object.freeze({
      schemaVersion: "1.0",
      engineVersion: "0.2.0",
      demandPlanId: asDemandPlanId(
        `demand:${deterministicFingerprint.slice(0, 24)}`,
      ),
      selectedRootId: input.selectedRootId,
      sourceChecksum: input.sourceChecksum,
      configurationUsed: Object.freeze(configurationUsed),
      results: Object.freeze(results),
      totalRequiredArea,
      computationMetadata: Object.freeze({
        algorithm: "ITERATIVE_BOTTOM_UP" as const,
        personCount: results.length,
        maximumStackSize,
        roundingDecimalPlaces: decimalPlaces,
        deterministicFingerprint,
      }),
    });
    input.diagnostics?.emit({
      stage: "COMPUTE_DEMAND",
      eventType: "STAGE_END",
      entityId: input.selectedRootId,
      metrics: {
        personCount: results.length,
        totalRequiredArea,
        maximumStackSize,
      },
    });
    return plan;
  }
}

