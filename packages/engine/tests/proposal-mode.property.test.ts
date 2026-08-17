import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../src/domain/admission/index.js";
import {
  frontierOf,
  admitAuthorityRecordShapes,
  makeFact,
  SEARCH_EXPRESSION_DEFINITION_NODE_ID,
  NODE_VIEWS_DEFINITION_NODE_ID,
  workspaceGenesisMutations,
  type AuthorityRecord,
  type AuthorityReceipt,
  type Fact,
  type FactSnapshot,
  type Mutation,
} from "../src/domain/fact/index.js";
import {
  advanceGeneration,
  CURRENT_PROJECTION_VERSIONS as versions,
  rebuildGeneration,
} from "../src/domain/reconcile/index.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
} from "../src/runtime/materialization/generation-checkpoint.js";
import { baseFixture, HistoryFixture } from "./support/history/history-test-helpers.js";
import {
  supertagApplicationIdentity,
  supertagApplicationMutations,
} from "./support/reconcile/supertag-application-test-helpers.js";
import { queryHistory, validateHistorySelection } from "../src/domain/history/history.js";
import { base, end, generation } from "./support/review/review-test-helpers.js";
import { queryReview, validateReviewSelection } from "../src/domain/review/review.js";
import { compileProjectionPlan } from "../src/domain/reconcile/projection-plan-dag.js";
import { PROJECTION_PLAN } from "../src/domain/reconcile/projection-plan.js";
import { fullSurface } from "./support/reconcile/full-surface-test-fixture.js";
import { historyLifecycleCases, proposalLifecycleCases } from "./support/reconcile/proposal-lifecycle-test-helpers.js";
import { assertGeneratedPathEquivalence, generatedDomainGraph } from "./proposal-mode-property-fixtures.js";
import { withInitialOwnerRelations } from "./support/reconcile/placed-node-test-helpers.js";

const CHECKPOINT_KEY = "property-test-key";

const A = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccc";

describe("seeded Proposal Mode property and permutation contracts", () => {
  it("arrival order and duplicate delivery preserve one admitted snapshot", () => {
    const facts = causalFixture();
    const expected = admitAuthorityRecordShapes("workspace", records(facts));
    expect(expected.kind).toBe("ready");
    for (let seed = 1; seed <= 64; seed += 1) {
      const delivered = shuffle([...records(facts), ...records(facts.filter((_, index) => index % 2 === 0))], seed);
      expect(admitAuthorityRecordShapes("workspace", delivered)).toEqual(expected);
    }
  });

  it("checkpoint tails and stage registration order are permutation invariant", () => {
    const facts = causalFixture();
    const beforeFacts = facts.slice(0, 3);
    const before = { facts: beforeFacts, frontier: frontierOf(beforeFacts) };
    const checkpoint = createGenerationCheckpoint(
      "workspace",
      before,
      rebuildGeneration("workspace", before, versions).generation,
      CHECKPOINT_KEY,
    );
    const expected = rebuildGeneration("workspace", { facts, frontier: frontierOf(facts) }, versions).generation;
    for (let seed = 1; seed <= 32; seed += 1) {
      const shuffled = { facts: shuffle(facts, seed), frontier: frontierOf(facts) };
      expect(reconcileFromCheckpoint(checkpoint, "workspace", shuffled, versions, CHECKPOINT_KEY)?.generation).toEqual(
        expected,
      );
    }

    for (let seed = 1; seed <= 32; seed += 1) {
      const compiled = compileProjectionPlan(shuffle([...PROJECTION_PLAN.ordered], seed));
      expect(compiled.ordered.map((stage) => stage.key)).toEqual(PROJECTION_PLAN.ordered.map((stage) => stage.key));
    }
  });

  it("Supertag Extension cycle and search projections converge across seeded arrival and checkpoints", () => {
    const facts = extensionCycleFixture();
    const prefixFacts = facts.slice(0, 6);
    const prefix = { facts: prefixFacts, frontier: frontierOf(prefixFacts) };
    const checkpoint = createGenerationCheckpoint(
      "workspace",
      prefix,
      rebuildGeneration("workspace", prefix, versions).generation,
      CHECKPOINT_KEY,
    );
    const expected = rebuildGeneration("workspace", { facts, frontier: frontierOf(facts) }, versions).generation;
    expect(expected.origin.supertagExtensionConflicts).toEqual({
      "supertag-a": ["supertag-a", "supertag-b"],
      "supertag-b": ["supertag-a", "supertag-b"],
    });
    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = { facts: shuffle(facts, seed), frontier: frontierOf(facts) };
      expect(rebuildGeneration("workspace", snapshot, versions).generation).toEqual(expected);
      expect(reconcileFromCheckpoint(checkpoint, "workspace", snapshot, versions, CHECKPOINT_KEY)?.generation).toEqual(
        expected,
      );
    }
  });

  it("concurrent Search Expression reorder and update converge across three replicas and all Reconcile paths", () => {
    const { prefix, facts } = concurrentSearchExpressionFixture();
    const before = { facts: prefix, frontier: frontierOf(prefix) };
    const finalSnapshot = { facts, frontier: frontierOf(facts) };
    const beforeGeneration = rebuildGeneration("workspace", before, versions).generation;
    const expected = rebuildGeneration("workspace", finalSnapshot, versions).generation;
    const checkpoint = createGenerationCheckpoint("workspace", before, beforeGeneration, CHECKPOINT_KEY);
    expect(expected.origin.searchExpressions.search).toBeUndefined();
    expect(advanceGeneration("workspace", before, finalSnapshot, versions, beforeGeneration).generation).toEqual(
      expected,
    );
    expect(
      reconcileFromCheckpoint(checkpoint, "workspace", finalSnapshot, versions, CHECKPOINT_KEY)?.generation,
    ).toEqual(expected);
    for (let seed = 1; seed <= 32; seed += 1) {
      const shuffled = { facts: shuffle(facts, seed), frontier: frontierOf(facts) };
      expect(rebuildGeneration("workspace", shuffled, versions).generation).toEqual(expected);
      expect(reconcileFromCheckpoint(checkpoint, "workspace", shuffled, versions, CHECKPOINT_KEY)?.generation).toEqual(
        expected,
      );
    }
  });

  it("concurrent View column reorder and Filter update converge across three replicas and all Reconcile paths", () => {
    const { prefix, facts } = concurrentViewOptionsFixture();
    const before = { facts: prefix, frontier: frontierOf(prefix) };
    const finalSnapshot = { facts, frontier: frontierOf(facts) };
    const beforeGeneration = rebuildGeneration("workspace", before, versions).generation;
    const expected = rebuildGeneration("workspace", finalSnapshot, versions).generation;
    const checkpoint = createGenerationCheckpoint("workspace", before, beforeGeneration, CHECKPOINT_KEY);
    const definition = expected.origin.sharedDefaultViewDefinitions.host?.[0];
    expect(definition?.optionsConflicted).toBe(true);
    expect(definition?.optionsContributionIds).toHaveLength(2);
    expect(advanceGeneration("workspace", before, finalSnapshot, versions, beforeGeneration).generation).toEqual(
      expected,
    );
    expect(
      reconcileFromCheckpoint(checkpoint, "workspace", finalSnapshot, versions, CHECKPOINT_KEY)?.generation,
    ).toEqual(expected);
    for (let seed = 1; seed <= 32; seed += 1) {
      const shuffled = { facts: shuffle(facts, seed), frontier: frontierOf(facts) };
      expect(rebuildGeneration("workspace", shuffled, versions).generation).toEqual(expected);
      expect(reconcileFromCheckpoint(checkpoint, "workspace", shuffled, versions, CHECKPOINT_KEY)?.generation).toEqual(
        expected,
      );
    }
  });

  it("Review and History selections distinguish seeded unrelated and related interleavings", () => {
    for (let seed = 1; seed <= 32; seed += 1) {
      const reviewFacts = base();
      const proposal = reviewFacts.add(
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: end,
          insert: "selected",
        },
        "proposal",
      );
      const selectedSnapshot = reviewFacts.snapshot();
      const reviewSelection = queryReview("workspace", selectedSnapshot, generation(selectedSnapshot)).hunks[0]
        ?.selection;
      if (!reviewSelection) {
        throw new Error("Expected a Review selection");
      }
      for (const key of shuffle(["a", "b", "c", "d"], seed)) {
        reviewFacts.add({ kind: "node-create", nodeId: `unrelated-${key}` });
      }
      let current = reviewFacts.snapshot();
      expect(
        validateReviewSelection("workspace", reviewSelection, "accept", "reviewer", current, generation(current)).kind,
      ).toBe("valid");
      reviewFacts.addBody({
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "other-reviewer",
        decision: "reject",
        proposalContributionIds: [proposal.id],
      });
      current = reviewFacts.snapshot();
      expect(
        validateReviewSelection("workspace", reviewSelection, "accept", "reviewer", current, generation(current)).kind,
      ).toBe("stale");

      const history = baseFixture();
      const historyStep = history.step({
        invocationId: "selected",
        mutations: [
          {
            kind: "text-splice",
            nodeId: "node",
            deleteAtomIds: [],
            anchor: end,
            insert: "S",
          },
        ],
      });
      const historySelection = queryHistory("channel", history.receipts, history.snapshot(), history.generation()).undo;
      if (!historySelection) {
        throw new Error("Expected a History selection");
      }
      for (const key of shuffle(["a", "b", "c", "d"], seed)) {
        history.fact({ kind: "node-create", nodeId: `unrelated-${key}` });
      }
      expect(
        validateHistorySelection(historySelection, "actor", history.receipts, history.snapshot(), history.generation())
          .kind,
      ).toBe("ready");
      history.fact({
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [`${historyStep.factIds[0]}#0`],
        deletedAtoms: [{ id: `${historyStep.factIds[0]}#0`, value: "S", attributes: {} }],
        anchor: end,
        insert: "R",
      });
      expect(
        validateHistorySelection(historySelection, "actor", history.receipts, history.snapshot(), history.generation())
          .kind,
      ).not.toBe("ready");
    }
  });

  it("complete Direct and Proposal mutation surfaces survive seeded delivery checkpoint and resolution permutations", () => {
    for (const intent of ["direct", "proposal"] as const) {
      for (const decision of ["accept", "reject"] as const) {
        const fixture = fullSurface(intent);
        if (intent === "proposal") {
          fixture.resolve(
            fixture.values.map((fact) => fact.id),
            decision,
          );
        }
        const expectedSnapshot = {
          facts: [...fixture.values],
          frontier: frontierOf(fixture.values),
        };
        const expectedAdmission = admitAuthorityRecords("workspace", records(fixture.values));
        const expectedGeneration = rebuildGeneration("workspace", expectedSnapshot, versions).generation;
        for (let seed = 1; seed <= 16; seed += 1) {
          const delivered = shuffle(
            [...records(fixture.values), ...records(fixture.values.filter((_, index) => (index + seed) % 3 === 0))],
            seed,
          );
          expect(admitAuthorityRecords("workspace", delivered)).toEqual(expectedAdmission);

          const cut = seed % fixture.values.length;
          const prefixFacts = fixture.values.slice(0, cut);
          const prefix = { facts: prefixFacts, frontier: frontierOf(prefixFacts) };
          const checkpoint = createGenerationCheckpoint(
            "workspace",
            prefix,
            rebuildGeneration("workspace", prefix, versions).generation,
            CHECKPOINT_KEY,
          );
          expect(
            reconcileFromCheckpoint(
              checkpoint,
              "workspace",
              { facts: shuffle(fixture.values, seed), frontier: expectedSnapshot.frontier },
              versions,
              CHECKPOINT_KEY,
            )?.generation,
          ).toEqual(expectedGeneration);
        }
      }
    }
  });

  it("seeded History programs cover every mutation owner through Undo and Redo", () => {
    for (let seed = 1; seed <= 4; seed += 1) {
      for (const [index, ownerCase] of shuffle([...historyLifecycleCases()], seed).entries()) {
        for (const intent of ["direct", "proposal"] as const) {
          const history = historyFor(caseSetupFacts(ownerCase));
          const targetInvocationId = `seed-${seed}-${intent}-${ownerCase.kind}`;
          const channelId = `channel-${(seed + index) % 3}`;
          history.step({
            invocationId: targetInvocationId,
            mutations: caseMutations(ownerCase),
            intent,
            channelId,
          });
          const targetProjection = generationFingerprint(history.generation());

          // A restart cut and an outcome-unknown transport both recover from the
          // durable Fact/receipt program rather than replaying the command.
          const restarted = clonedHistoryState(history);
          const undo = queryHistory(channelId, restarted.receipts, restarted.snapshot, restarted.generation).undo;
          if (!undo) {
            throw new Error(`Generated ${intent} ${ownerCase.kind} program has no Undo`);
          }
          expect(
            validateHistorySelection(undo, "actor", restarted.receipts, restarted.snapshot, restarted.generation).kind,
          ).toBe("ready");
          expect(restarted.receipts.some((receipt) => receipt.invocationId === targetInvocationId)).toBe(true);

          const undoReceipt = history.step({
            invocationId: `undo-${targetInvocationId}`,
            mutations: undo.evidence.compensations,
            intent,
            channelId,
            operation: "undo",
            targetStepId: targetInvocationId,
          });
          expect(undoReceipt.factIds).toHaveLength(undo.evidence.compensations.length);
          const redo = queryHistory(
            channelId,
            structuredClone(history.receipts),
            history.snapshot(),
            history.generation(),
          ).redo;
          if (!redo) {
            throw new Error(`Generated ${intent} ${ownerCase.kind} program has no Redo`);
          }
          expect(
            validateHistorySelection(redo, "actor", history.receipts, history.snapshot(), history.generation()).kind,
          ).toBe("ready");
          history.step({
            invocationId: `redo-${targetInvocationId}`,
            mutations: redo.evidence.compensations,
            intent,
            channelId,
            operation: "redo",
            targetStepId: redo.targetInvocationId,
          });
          expect(
            generationFingerprint(history.generation()),
            `${intent} ${ownerCase.kind} must round-trip through History`,
          ).toBe(targetProjection);
        }
      }
    }
  });

  it("generated Review evidence for every mutation owner survives only unrelated advances", () => {
    for (const [index, ownerCase] of proposalLifecycleCases().entries()) {
      const pending = ownerCase.facts.snapshot();
      const selection = queryReview("workspace", pending, generation(pending)).hunks.find((hunk) =>
        hunk.proposalContributionIds.includes(ownerCase.proposal.id),
      )?.selection;
      if (!selection) {
        throw new Error(`Generated ${ownerCase.kind} Review program has no selection`);
      }
      ownerCase.facts.add({ kind: "node-create", nodeId: `unrelated-${index}` });
      const unrelated = ownerCase.facts.snapshot();
      expect(
        validateReviewSelection("workspace", selection, "accept", "reviewer", unrelated, generation(unrelated)).kind,
      ).toBe("valid");
      ownerCase.facts.resolve(selection.evidence.supportClosure, "reject");
      const related = ownerCase.facts.snapshot();
      expect(
        validateReviewSelection("workspace", selection, "accept", "reviewer", related, generation(related)).kind,
      ).toBe("stale");
    }
  });

  it("generated bounded domain graphs shrink and preserve full incremental and checkpoint semantics", () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      assertGeneratedPathEquivalence(generatedDomainGraph(seed), seed);
    }
  });

  it("every Proposal mutation kind preserves all rebuild paths through Accept and Reject", () => {
    for (const decision of ["accept", "reject"] as const) {
      for (const [index, entry] of proposalLifecycleCases().entries()) {
        const snapshot = entry.facts.snapshot();
        const hunk = queryReview("workspace", snapshot, generation(snapshot)).hunks.find((candidate) =>
          candidate.proposalContributionIds.includes(entry.proposal.id),
        );
        if (!hunk) {
          throw new Error(`Generated ${entry.kind} program has no Review Hunk`);
        }
        entry.facts.resolve(hunk.selection.evidence.supportClosure, decision);
        assertGeneratedPathEquivalence(entry.facts.values, 100 + index);
      }
    }
  });
});

function caseSetupFacts(ownerCase: ReturnType<typeof proposalLifecycleCases>[number]): readonly Fact[] {
  return ownerCase.facts.values.filter((fact) => fact.body.kind !== "contribution" || fact.body.intent !== "proposal");
}

function caseMutations(ownerCase: ReturnType<typeof proposalLifecycleCases>[number]): readonly Mutation[] {
  return ownerCase.facts.values.flatMap((fact) =>
    fact.body.kind === "contribution" && fact.body.intent === "proposal" ? [fact.body.mutation] : [],
  );
}

function historyFor(prefix: readonly Fact[]): HistoryFixture {
  const history = new HistoryFixture();
  history.facts.push(...structuredClone(prefix));
  return history;
}

function clonedHistoryState(history: HistoryFixture): Readonly<{
  receipts: readonly AuthorityReceipt[];
  snapshot: FactSnapshot;
  generation: ReturnType<typeof rebuildGeneration>["generation"];
}> {
  const facts = structuredClone(history.facts);
  const snapshot = { facts, frontier: frontierOf(facts) };
  return {
    receipts: structuredClone(history.receipts),
    snapshot,
    generation: rebuildGeneration("workspace", snapshot, versions).generation,
  };
}

function generationFingerprint(value: ReturnType<HistoryFixture["generation"]>): string {
  return JSON.stringify({
    origin: semanticProjection(value.origin),
    review: semanticProjection(value.review),
  });
}

function semanticProjection(projection: ReturnType<HistoryFixture["generation"]>["origin"]) {
  const { identity: _identity, nodes, ...rest } = projection;
  const semantic = {
    ...rest,
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([id, node]) => [
        id,
        {
          ...node,
          content: node.content.map((item) =>
            item.kind === "text"
              ? { kind: item.kind, value: item.value, attributes: { ...item.attributes } }
              : {
                  kind: item.kind,
                  id: item.id,
                  targetNodeId: item.targetNodeId,
                  aliasNodeId: item.aliasNodeId,
                  targetStatus: item.targetStatus,
                },
          ),
        },
      ]),
    ),
  };
  return JSON.stringify(semantic, omitSemanticProvenance);
}

function omitSemanticProvenance(key: string, value: unknown): unknown {
  return key === "contributionIds" ||
    key === "contributionId" ||
    key === "modeContributionIds" ||
    key === "detachmentContributionIds" ||
    key === "initializationId" ||
    key === "deletionFactIds"
    ? undefined
    : value;
}

function causalFixture(): Fact[] {
  const a1 = fact(A, 1, {}, 1, "direct-a");
  const b1 = fact(B, 1, {}, 1, "direct-b");
  const proposal = fact(C, 1, {}, 1, "proposal", "proposal");
  const a2 = fact(A, 2, { [A]: 1 }, 2, "direct-a-tail");
  const resolution = makeFact({
    workspaceId: "workspace",
    replicaId: B,
    sequence: 2,
    observed: { [B]: 1, [C]: 1 },
    lamport: 2,
    body: {
      kind: "resolution",
      adjudicatesResolutionIds: [],
      actorId: "reviewer",
      decision: "accept",
      proposalContributionIds: [proposal.id],
    },
  });
  return [a1, b1, proposal, a2, resolution];
}

function extensionCycleFixture(): Fact[] {
  const mutations: readonly Mutation[] = [
    ...workspaceGenesisMutations("workspace"),
    ...["base", "supertag-a", "supertag-b", "task", "field-a"].flatMap((nodeId): readonly Mutation[] => [
      { kind: "node-create", nodeId },
      {
        kind: "occurrence-create",
        occurrenceId: `${nodeId}-original`,
        nodeId,
        parentNodeId: "workspace",
        anchor: end,
      },
    ]),
    { kind: "intrinsic-node-type-declare", nodeId: "supertag-a", intrinsicNodeType: "supertag-definition" },
    { kind: "intrinsic-node-type-declare", nodeId: "supertag-b", intrinsicNodeType: "supertag-definition" },
    { kind: "intrinsic-node-type-declare", nodeId: "field-a", intrinsicNodeType: "field-definition" },
    ...supertagApplicationMutations(supertagApplicationIdentity("task", "supertag-a"), end),
  ];
  const ownedMutations = withInitialOwnerRelations(mutations);
  const prefix = ownedMutations.map((mutation, index) =>
    mutationFact(A, index + 1, index === 0 ? {} : { [A]: index }, index + 1, mutation),
  );
  const observed = { [A]: prefix.length };
  return [
    ...prefix,
    mutationFact(B, 1, observed, prefix.length + 1, {
      kind: "supertag-extension-add",
      supertagId: "supertag-a",
      baseSupertagId: "supertag-b",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    }),
    mutationFact(C, 1, observed, prefix.length + 1, {
      kind: "supertag-extension-add",
      supertagId: "supertag-b",
      baseSupertagId: "supertag-a",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    }),
  ];
}

function concurrentSearchExpressionFixture(): Readonly<{ prefix: readonly Fact[]; facts: readonly Fact[] }> {
  const mutations: readonly Mutation[] = [
    ...workspaceGenesisMutations("workspace"),
    { kind: "node-create", nodeId: "search" },
    {
      kind: "occurrence-create",
      occurrenceId: "search-original",
      nodeId: "search",
      parentNodeId: "workspace",
      anchor: end,
    },
    { kind: "node-owner-set", nodeId: "search", ownerNodeId: "workspace", previousOwnerNodeId: null },
    { kind: "intrinsic-node-type-declare", nodeId: "search", intrinsicNodeType: "search" },
    { kind: "node-create", nodeId: "tag" },
    {
      kind: "occurrence-create",
      occurrenceId: "tag-original",
      nodeId: "tag",
      parentNodeId: "workspace",
      anchor: end,
    },
    { kind: "node-owner-set", nodeId: "tag", ownerNodeId: "workspace", previousOwnerNodeId: null },
    { kind: "intrinsic-node-type-declare", nodeId: "tag", intrinsicNodeType: "supertag-definition" },
    { kind: "node-create", nodeId: "search-configuration" },
    {
      kind: "node-owner-set",
      nodeId: "search-configuration",
      ownerNodeId: "search",
      previousOwnerNodeId: null,
    },
    { kind: "metanode-attach", hostNodeId: "search", metanodeId: "search-configuration" },
    { kind: "node-create", nodeId: "search-expression" },
    {
      kind: "node-owner-set",
      nodeId: "search-expression",
      ownerNodeId: "search-configuration",
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-create",
      occurrenceId: "search-expression-occurrence",
      nodeId: "search-expression",
      parentNodeId: "search-configuration",
      anchor: end,
    },
    {
      kind: "occurrence-create",
      occurrenceId: "search-expression-definition",
      nodeId: SEARCH_EXPRESSION_DEFINITION_NODE_ID,
      parentNodeId: "search-expression",
      anchor: end,
    },
    {
      kind: "search-expression-attach",
      searchNodeId: "search",
      expressionNodeId: "search-expression",
      expressionOccurrenceId: "search-expression-occurrence",
      definitionOccurrenceId: "search-expression-definition",
      expression: {
        expressionNodeId: "search-expression",
        kind: "and",
        operands: [
          { expressionNodeId: "tag-clause", kind: "supertag", supertagId: "tag" },
          { expressionNodeId: "text-clause", kind: "text", text: "current" },
        ],
      },
    },
  ];
  const prefix = mutations.map((mutation, index) =>
    mutationFact(A, index + 1, index === 0 ? {} : { [A]: index }, index + 1, mutation),
  );
  const observed = { [A]: prefix.length };
  const common = {
    searchNodeId: "search",
    expressionNodeId: "search-expression",
    expressionOccurrenceId: "search-expression-occurrence",
    definitionOccurrenceId: "search-expression-definition",
    previousExpression: {
      expressionNodeId: "search-expression",
      kind: "and" as const,
      operands: [
        { expressionNodeId: "tag-clause", kind: "supertag" as const, supertagId: "tag" },
        { expressionNodeId: "text-clause", kind: "text" as const, text: "current" },
      ],
    },
  };
  return {
    prefix,
    facts: [
      ...prefix,
      mutationFact(B, 1, observed, prefix.length + 1, {
        kind: "search-expression-attach",
        ...common,
        expression: {
          expressionNodeId: "search-expression",
          kind: "and",
          operands: [
            { expressionNodeId: "text-clause", kind: "text", text: "current" },
            { expressionNodeId: "tag-clause", kind: "supertag", supertagId: "tag" },
          ],
        },
      }),
      mutationFact(C, 1, observed, prefix.length + 1, {
        kind: "search-expression-attach",
        ...common,
        expression: {
          expressionNodeId: "search-expression",
          kind: "and",
          operands: [
            { expressionNodeId: "tag-clause", kind: "supertag", supertagId: "tag" },
            {
              expressionNodeId: "not-clause",
              kind: "not",
              operand: { expressionNodeId: "old", kind: "text", text: "old" },
            },
          ],
        },
      }),
    ],
  };
}

function concurrentViewOptionsFixture(): Readonly<{ prefix: readonly Fact[]; facts: readonly Fact[] }> {
  const mutations: readonly Mutation[] = [
    ...workspaceGenesisMutations("workspace"),
    { kind: "node-create", nodeId: "host" },
    {
      kind: "occurrence-create",
      occurrenceId: "host-original",
      nodeId: "host",
      parentNodeId: "workspace",
      anchor: end,
    },
    { kind: "node-owner-set", nodeId: "host", ownerNodeId: "workspace", previousOwnerNodeId: null },
    { kind: "node-create", nodeId: "field-a" },
    {
      kind: "occurrence-create",
      occurrenceId: "field-a-original",
      nodeId: "field-a",
      parentNodeId: "workspace",
      anchor: end,
    },
    { kind: "node-owner-set", nodeId: "field-a", ownerNodeId: "workspace", previousOwnerNodeId: null },
    { kind: "intrinsic-node-type-declare", nodeId: "field-a", intrinsicNodeType: "field-definition" },
    { kind: "node-create", nodeId: "field-b" },
    {
      kind: "occurrence-create",
      occurrenceId: "field-b-original",
      nodeId: "field-b",
      parentNodeId: "workspace",
      anchor: end,
    },
    { kind: "node-owner-set", nodeId: "field-b", ownerNodeId: "workspace", previousOwnerNodeId: null },
    { kind: "intrinsic-node-type-declare", nodeId: "field-b", intrinsicNodeType: "field-definition" },
    { kind: "node-create", nodeId: "host-metanode" },
    { kind: "node-owner-set", nodeId: "host-metanode", ownerNodeId: "host", previousOwnerNodeId: null },
    { kind: "metanode-attach", hostNodeId: "host", metanodeId: "host-metanode" },
    { kind: "node-create", nodeId: "view-attachment" },
    { kind: "node-owner-set", nodeId: "view-attachment", ownerNodeId: "host-metanode", previousOwnerNodeId: null },
    {
      kind: "occurrence-create",
      occurrenceId: "view-attachment-occurrence",
      nodeId: "view-attachment",
      parentNodeId: "host-metanode",
      anchor: end,
    },
    { kind: "node-create", nodeId: "view" },
    { kind: "node-owner-set", nodeId: "view", ownerNodeId: "view-attachment", previousOwnerNodeId: null },
    {
      kind: "occurrence-create",
      occurrenceId: "view-definition-endpoint",
      nodeId: NODE_VIEWS_DEFINITION_NODE_ID,
      parentNodeId: "view-attachment",
      anchor: end,
    },
    {
      kind: "occurrence-create",
      occurrenceId: "view-occurrence",
      nodeId: "view",
      parentNodeId: "view-attachment",
      anchor: end,
    },
    {
      kind: "shared-default-view-definition-attach",
      hostNodeId: "host",
      attachmentNodeId: "view-attachment",
      attachmentOccurrenceId: "view-attachment-occurrence",
      relationDefinitionOccurrenceId: "view-definition-endpoint",
      viewDefinitionNodeId: "view",
      viewDefinitionOccurrenceId: "view-occurrence",
    },
    {
      kind: "shared-default-view-definition-mode-set",
      viewDefinitionNodeId: "view",
      viewType: "table",
      previousViewType: null,
      observedModeFactIds: [],
    },
  ];
  const prefix = mutations.map((mutation, index) =>
    mutationFact(A, index + 1, index === 0 ? {} : { [A]: index }, index + 1, mutation),
  );
  const observed = { [A]: prefix.length };
  const previousOptions = { columns: [], filter: null, sort: null, group: null } as const;
  return {
    prefix,
    facts: [
      ...prefix,
      mutationFact(B, 1, observed, prefix.length + 1, {
        kind: "shared-default-view-definition-options-set",
        hostNodeId: "host",
        viewDefinitionNodeId: "view",
        options: {
          columns: [
            { columnNodeId: "column-b", fieldDefinitionId: "field-b" },
            { columnNodeId: "column-a", fieldDefinitionId: "field-a" },
          ],
          filter: null,
          sort: { sortNodeId: "sort-a", fieldDefinitionId: "field-a", direction: "ascending" },
          group: null,
        },
        previousOptions,
        observedOptionsFactIds: [],
      }),
      mutationFact(C, 1, observed, prefix.length + 1, {
        kind: "shared-default-view-definition-options-set",
        hostNodeId: "host",
        viewDefinitionNodeId: "view",
        options: {
          columns: [
            { columnNodeId: "column-a", fieldDefinitionId: "field-a" },
            { columnNodeId: "column-b", fieldDefinitionId: "field-b" },
          ],
          filter: {
            filterNodeId: "filter",
            expression: { expressionNodeId: "filter-text", kind: "text", text: "current" },
          },
          sort: null,
          group: { groupNodeId: "group-b", fieldDefinitionId: "field-b" },
        },
        previousOptions,
        observedOptionsFactIds: [],
      }),
    ],
  };
}

function mutationFact(
  replicaId: string,
  sequence: number,
  observed: Readonly<Record<string, number>>,
  lamport: number,
  mutation: Mutation,
): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence,
    observed,
    lamport,
    body: { kind: "contribution", actorId: replicaId, intent: "direct", mutation },
  });
}

function fact(
  replicaId: string,
  sequence: number,
  observed: Readonly<Record<string, number>>,
  lamport: number,
  nodeId: string,
  intent: "direct" | "proposal" = "direct",
): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence,
    observed,
    lamport,
    body: {
      kind: "contribution",
      actorId: "actor",
      intent,
      mutation: { kind: "node-create", nodeId },
    },
  });
}

function records(facts: readonly Fact[]): AuthorityRecord[] {
  return facts.map((fact) => ({ recordKind: "fact", fact }));
}

function shuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const target = state % (index + 1);
    [result[index], result[target]] = [
      required(result[target], "shuffle target"),
      required(result[index], "shuffle source"),
    ];
  }
  return result;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
