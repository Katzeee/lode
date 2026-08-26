import { describe, expect, it } from "vitest";

import {
  frontierOf,
  factActionId,
  factActionsFromFacts,
  buildFactSnapshot,
  graphActionBody,
  makeFact,
  workspaceGenesisActions,
  type AuthorityReceipt,
  type Fact,
  type FactSnapshot,
  type GraphAction,
} from "../src/domain/fact/index.js";
import { uniqueFacts } from "./support/facts.js";
import {
  advanceGeneration,
  CURRENT_PROJECTION_VERSIONS as versions,
  rebuildGeneration,
} from "../src/domain/reconcile/index.js";
import { baseFixture, HistoryFixture } from "./support/history/history-test-helpers.js";
import { supertagApplicationActions } from "./support/reconcile/supertag-application-test-helpers.js";
import { queryHistory, validateHistorySelection } from "../src/domain/history/history.js";
import { base, end, generation } from "./support/review/review-test-helpers.js";
import { queryReview, validateReviewSelection } from "../src/domain/review/review.js";
import { compileProjectionPlan } from "../src/domain/reconcile/projection-plan-dag.js";
import { PROJECTION_PLAN } from "../src/domain/reconcile/projection-plan.js";
import { fullSurface } from "./support/reconcile/full-surface-test-fixture.js";
import { historyLifecycleCases, proposalLifecycleCases } from "./support/reconcile/proposal-lifecycle-test-helpers.js";
import { assertGeneratedPathEquivalence, generatedDomainGraph } from "./proposal-mode-property-fixtures.js";

const A = "101";
const B = "202";
const C = "303";

describe("seeded Proposal Mode property and permutation contracts", () => {
  it("arrival order and duplicate delivery preserve one authoritative snapshot", () => {
    const facts = causalFixture();
    const expected = buildFactSnapshot("workspace", uniqueFacts(records(facts)));
    for (let seed = 1; seed <= 64; seed += 1) {
      const delivered = shuffle([...records(facts), ...records(facts.filter((_, index) => index % 2 === 0))], seed);
      expect(buildFactSnapshot("workspace", uniqueFacts(delivered))).toEqual(expected);
    }
  });

  it("incremental tails and stage registration order are permutation invariant", () => {
    const facts = causalFixture();
    const beforeFacts = facts.slice(0, 3);
    const before = { facts: beforeFacts, frontier: frontierOf(beforeFacts) };
    const beforeGeneration = rebuildGeneration("workspace", before, versions);
    const expected = rebuildGeneration("workspace", { facts, frontier: frontierOf(facts) }, versions);
    for (let seed = 1; seed <= 32; seed += 1) {
      const shuffled = { facts: shuffle(facts, seed), frontier: frontierOf(facts) };
      expect(advanceGeneration("workspace", before, shuffled, versions, beforeGeneration)).toEqual(expected);
    }

    for (let seed = 1; seed <= 32; seed += 1) {
      const compiled = compileProjectionPlan(shuffle([...PROJECTION_PLAN.ordered], seed));
      expect(compiled.ordered.map((stage) => stage.key)).toEqual(PROJECTION_PLAN.ordered.map((stage) => stage.key));
    }
  });

  it("Supertag Extension cycle and search projections converge across seeded arrival and incremental tails", () => {
    const facts = extensionCycleFixture();
    const prefixFacts = facts.slice(0, 6);
    const prefix = { facts: prefixFacts, frontier: frontierOf(prefixFacts) };
    const prefixGeneration = rebuildGeneration("workspace", prefix, versions);
    const expected = rebuildGeneration("workspace", { facts, frontier: frontierOf(facts) }, versions);
    expect(expected.origin.supertagExtensionConflicts).toEqual({
      "supertag-a": ["supertag-a", "supertag-b"],
      "supertag-b": ["supertag-a", "supertag-b"],
    });
    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = { facts: shuffle(facts, seed), frontier: frontierOf(facts) };
      expect(rebuildGeneration("workspace", snapshot, versions)).toEqual(expected);
      expect(advanceGeneration("workspace", prefix, snapshot, versions, prefixGeneration)).toEqual(expected);
    }
  });

  it("concurrent Search Expression move and configure converge across three replicas and all Reconcile paths", () => {
    const { prefix, facts } = concurrentSearchExpressionFixture();
    const before = { facts: prefix, frontier: frontierOf(prefix) };
    const finalSnapshot = { facts, frontier: frontierOf(facts) };
    const beforeGeneration = rebuildGeneration("workspace", before, versions);
    const expected = rebuildGeneration("workspace", finalSnapshot, versions);
    expect(expected.origin.searchExpressions.search).toBeDefined();
    expect(advanceGeneration("workspace", before, finalSnapshot, versions, beforeGeneration)).toEqual(expected);
    for (let seed = 1; seed <= 32; seed += 1) {
      const shuffled = { facts: shuffle(facts, seed), frontier: frontierOf(facts) };
      expect(rebuildGeneration("workspace", shuffled, versions)).toEqual(expected);
      expect(advanceGeneration("workspace", before, shuffled, versions, beforeGeneration)).toEqual(expected);
    }
  });

  it("concurrent View column move and Sort addition converge across three replicas and all Reconcile paths", () => {
    const { prefix, facts } = concurrentViewOptionsFixture();
    const before = { facts: prefix, frontier: frontierOf(prefix) };
    const finalSnapshot = { facts, frontier: frontierOf(facts) };
    const beforeGeneration = rebuildGeneration("workspace", before, versions);
    const expected = rebuildGeneration("workspace", finalSnapshot, versions);
    const definition = expected.origin.sharedDefaultViewDefinitions.host?.[0];
    expect(definition?.optionsConflicted).toBe(false);
    expect(definition?.options.columns.map((column) => column.fieldDefinitionId)).toEqual(["field-b", "field-a"]);
    expect(definition?.options.sort).toMatchObject({ fieldDefinitionId: "field-a", direction: "ascending" });
    expect(advanceGeneration("workspace", before, finalSnapshot, versions, beforeGeneration)).toEqual(expected);
    for (let seed = 1; seed <= 32; seed += 1) {
      const shuffled = { facts: shuffle(facts, seed), frontier: frontierOf(facts) };
      expect(rebuildGeneration("workspace", shuffled, versions)).toEqual(expected);
      expect(advanceGeneration("workspace", before, shuffled, versions, beforeGeneration)).toEqual(expected);
    }
  });

  it("Review and History selections distinguish seeded unrelated and related interleavings", () => {
    for (let seed = 1; seed <= 32; seed += 1) {
      const reviewFacts = base();
      const proposal = reviewFacts.add(
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: end,
          insert: "selected",
        },
        "proposal",
      );
      const selectedSnapshot = reviewFacts.snapshot();
      const reviewSelection = queryReview(selectedSnapshot, generation(selectedSnapshot)).hunks[0]?.selection;
      if (!reviewSelection) {
        throw new Error("Expected a Review selection");
      }
      for (const key of shuffle(["a", "b", "c", "d"], seed)) {
        reviewFacts.add({
          kind: "node-create",
          nodeId: `unrelated-${key}`,
          ownerNodeId: "workspace",
          originalPlacement: null,
        });
      }
      let current = reviewFacts.snapshot();
      expect(validateReviewSelection(reviewSelection, "accept", "reviewer", current, generation(current)).kind).toBe(
        "valid",
      );
      reviewFacts.addBody({
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "other-reviewer",
        decision: "reject",
        proposalFactIds: [proposal.factId],
      });
      current = reviewFacts.snapshot();
      expect(validateReviewSelection(reviewSelection, "accept", "reviewer", current, generation(current)).kind).toBe(
        "stale",
      );

      const history = baseFixture();
      const historyStep = history.step({
        invocationId: "selected",
        actions: [
          {
            kind: "rich-text-splice",
            nodeId: "node",
            deleteAtomIds: [],
            anchor: end,
            insert: "S",
          },
        ],
      });
      const historySelection = queryHistory("channel", history.receipts).undo;
      if (!historySelection) {
        throw new Error("Expected a History selection");
      }
      for (const key of shuffle(["a", "b", "c", "d"], seed)) {
        history.fact({
          kind: "node-create",
          nodeId: `unrelated-${key}`,
          ownerNodeId: "workspace",
          originalPlacement: null,
        });
      }
      expect(
        validateHistorySelection("undo", historySelection, history.receipts, history.snapshot(), history.generation())
          .kind,
      ).toBe("ready");
      history.fact({
        kind: "rich-text-splice",
        nodeId: "node",
        deleteAtomIds: [`${factActionId(required(historyStep.factIds[0], "history Fact"), 0)}#0`],
        anchor: end,
        insert: "R",
      });
      expect(
        validateHistorySelection("undo", historySelection, history.receipts, history.snapshot(), history.generation())
          .kind,
      ).not.toBe("ready");
    }
  });

  it("complete Direct and Proposal action surfaces survive seeded delivery, incremental, and resolution permutations", () => {
    for (const intent of ["direct", "proposal"] as const) {
      for (const decision of ["accept", "reject"] as const) {
        const fixture = fullSurface(intent);
        if (intent === "proposal") {
          fixture.resolve(
            factActionsFromFacts(fixture.values).map((action) => action.id),
            decision,
          );
        }
        const expectedSnapshot = {
          facts: [...fixture.values],
          frontier: frontierOf(fixture.values),
        };
        const expectedFactSnapshot = buildFactSnapshot("workspace", uniqueFacts(records(fixture.values)));
        const expectedGeneration = rebuildGeneration("workspace", expectedSnapshot, versions);
        for (let seed = 1; seed <= 16; seed += 1) {
          const delivered = shuffle(
            [...records(fixture.values), ...records(fixture.values.filter((_, index) => (index + seed) % 3 === 0))],
            seed,
          );
          expect(buildFactSnapshot("workspace", uniqueFacts(delivered))).toEqual(expectedFactSnapshot);

          const cut = seed % fixture.values.length;
          const prefixFacts = fixture.values.slice(0, cut);
          const prefix = { facts: prefixFacts, frontier: frontierOf(prefixFacts) };
          const prefixGeneration = rebuildGeneration("workspace", prefix, versions);
          const deliveredSnapshot = {
            facts: shuffle(fixture.values, seed),
            frontier: expectedSnapshot.frontier,
          };
          expect(advanceGeneration("workspace", prefix, deliveredSnapshot, versions, prefixGeneration)).toEqual(
            expectedGeneration,
          );
        }
      }
    }
  });

  it("seeded History programs cover representative action owners through Undo and Redo", () => {
    for (let seed = 1; seed <= 4; seed += 1) {
      for (const [index, ownerCase] of shuffle([...historyLifecycleCases()], seed).entries()) {
        for (const intent of ["direct", "proposal"] as const) {
          const history = historyFor(caseSetupFacts(ownerCase));
          const targetInvocationId = `seed-${seed}-${intent}-${ownerCase.kind}`;
          const channelId = `channel-${(seed + index) % 3}`;
          history.step({
            invocationId: targetInvocationId,
            actions: caseActions(ownerCase),
            intent,
            channelId,
          });
          const targetProjection = generationFingerprint(history.generation());

          // A restart cut and an outcome-unknown transport both recover from the
          // durable Fact/receipt program rather than replaying the command.
          const restarted = clonedHistoryState(history);
          const undo = queryHistory(channelId, restarted.receipts).undo;
          if (!undo) {
            throw new Error(`Generated ${intent} ${ownerCase.kind} program has no Undo`);
          }
          expect(
            validateHistorySelection("undo", undo, restarted.receipts, restarted.snapshot, restarted.generation).kind,
          ).toBe("ready");
          expect(restarted.receipts.some((receipt) => receipt.invocationId === targetInvocationId)).toBe(true);

          const undoReceipt = history.step({
            invocationId: `undo-${targetInvocationId}`,
            actions: history.compensationActions(targetInvocationId),
            intent,
            channelId,
            operation: "undo",
            targetStepId: targetInvocationId,
          });
          expect(undoReceipt.factIds).toHaveLength(1);
          const redo = queryHistory(channelId, structuredClone(history.receipts)).redo;
          if (!redo) {
            throw new Error(`Generated ${intent} ${ownerCase.kind} program has no Redo`);
          }
          expect(
            validateHistorySelection("redo", redo, history.receipts, history.snapshot(), history.generation()).kind,
          ).toBe("ready");
          history.step({
            invocationId: `redo-${targetInvocationId}`,
            actions: history.compensationActions(undoReceipt.invocationId),
            intent,
            channelId,
            operation: "redo",
            targetStepId: undoReceipt.invocationId,
          });
          expect(
            generationFingerprint(history.generation()),
            `${intent} ${ownerCase.kind} must round-trip through History`,
          ).toBe(targetProjection);
        }
      }
    }
  });

  it("generated Review evidence for representative action owners survives only unrelated advances", () => {
    for (const [index, ownerCase] of proposalLifecycleCases().entries()) {
      const pending = ownerCase.facts.snapshot();
      const selection = queryReview(pending, generation(pending)).hunks.find((hunk) =>
        hunk.selection.proposalActionIds.includes(ownerCase.proposal.id),
      )?.selection;
      if (!selection) {
        throw new Error(`Generated ${ownerCase.kind} Review program has no selection`);
      }
      ownerCase.facts.add({
        kind: "node-create",
        nodeId: `unrelated-${index}`,
        ownerNodeId: "workspace",
        originalPlacement: null,
      });
      const unrelated = ownerCase.facts.snapshot();
      expect(validateReviewSelection(selection, "accept", "reviewer", unrelated, generation(unrelated)).kind).toBe(
        "valid",
      );
      ownerCase.facts.resolve(selection.proposalActionIds, "reject");
      const related = ownerCase.facts.snapshot();
      expect(validateReviewSelection(selection, "accept", "reviewer", related, generation(related)).kind).toBe("stale");
    }
  });

  it("generated bounded domain graphs shrink and preserve full and incremental semantics", () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      assertGeneratedPathEquivalence(generatedDomainGraph(seed), seed);
    }
  });

  it("representative Proposal actions preserve all rebuild paths through Accept and Reject", () => {
    for (const decision of ["accept", "reject"] as const) {
      for (const [index, entry] of proposalLifecycleCases().entries()) {
        const snapshot = entry.facts.snapshot();
        const hunk = queryReview(snapshot, generation(snapshot)).hunks.find((candidate) =>
          candidate.selection.proposalActionIds.includes(entry.proposal.id),
        );
        if (!hunk) {
          throw new Error(`Generated ${entry.kind} program has no Review Hunk`);
        }
        entry.facts.resolve(hunk.selection.proposalActionIds, decision);
        assertGeneratedPathEquivalence(entry.facts.values, 100 + index);
      }
    }
  });
});
function caseSetupFacts(ownerCase: ReturnType<typeof proposalLifecycleCases>[number]): readonly Fact[] {
  return ownerCase.facts.values.filter((fact) => fact.body.kind !== "action" || fact.body.intent !== "proposal");
}
function caseActions(ownerCase: ReturnType<typeof proposalLifecycleCases>[number]): readonly GraphAction[] {
  return ownerCase.facts.values.flatMap((fact) =>
    fact.body.kind === "action" && fact.body.intent === "proposal" ? fact.body.actions : [],
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
  generation: ReturnType<typeof rebuildGeneration>;
}> {
  const facts = structuredClone(history.facts);
  const snapshot = { facts, frontier: frontierOf(facts) };
  return {
    receipts: structuredClone(history.receipts),
    snapshot,
    generation: rebuildGeneration("workspace", snapshot, versions),
  };
}

function generationFingerprint(value: ReturnType<HistoryFixture["generation"]>): string {
  return JSON.stringify({
    origin: semanticProjection(value.origin),
    review: semanticProjection(value.review),
  });
}

function semanticProjection(projection: ReturnType<HistoryFixture["generation"]>["origin"]) {
  const {
    identity: _identity,
    nodes,
    occurrences,
    childOccurrences,
    nodeOwners,
    templateNodeInstances,
    ...rest
  } = projection;
  const fieldConfigurationRoots = Object.entries(projection.fieldDefinitionConfigurations).flatMap(
    ([fieldDefinitionId, configurations]) =>
      configurations.map((configuration) => {
        const root = configuration.configurationNodeId.slice(0, -"/node".length);
        return [root, `field-configuration:${encodeURIComponent(fieldDefinitionId)}:${configuration.kind}`] as const;
      }),
  );
  const applicationIds = new Map<string, string>();
  for (const [hostNodeId, applications] of Object.entries(projection.supertagApplications)) {
    for (const application of applications) {
      const root = `supertag-application:${encodeURIComponent(hostNodeId)}:${encodeURIComponent(application.supertagId)}`;
      applicationIds.set(application.applicationNodeId, `${root}/node`);
      applicationIds.set(application.applicationOccurrenceId, `${root}/occurrence`);
      applicationIds.set(application.relationDefinitionOccurrenceId, `${root}/relation-definition-occurrence`);
      applicationIds.set(application.definitionOccurrenceId, `${root}/definition-occurrence`);
    }
  }
  const semanticNodeId = (id: string): string => {
    const applicationId = applicationIds.get(id);
    if (applicationId !== undefined) {
      return applicationId;
    }
    const entry = fieldConfigurationRoots.find(([root]) => id === root || id.startsWith(`${root}/`));
    return entry === undefined ? id : `${entry[1]}${id.slice(entry[0].length)}`;
  };
  const semanticOccurrenceIds = new Map(
    Object.values(occurrences).flatMap((occurrence) =>
      occurrence.derived && occurrence.occurrenceId.endsWith("/projection/template-member-occurrence")
        ? [
            [
              occurrence.occurrenceId,
              `template-member:${encodeURIComponent(occurrence.parentNodeId)}:${encodeURIComponent(occurrence.nodeId)}`,
            ] as const,
          ]
        : [],
    ),
  );
  const occurrenceId = (id: string) => semanticNodeId(semanticOccurrenceIds.get(id) ?? id);
  const semantic = {
    ...rest,
    occurrences: Object.fromEntries(
      Object.entries(occurrences)
        .filter(([id]) => !isHistoricalSupertagApplicationId(id, applicationIds))
        .map(([id, occurrence]) => [
          occurrenceId(id),
          {
            ...occurrence,
            occurrenceId: occurrenceId(occurrence.occurrenceId),
            nodeId: semanticNodeId(occurrence.nodeId),
            parentNodeId: semanticNodeId(occurrence.parentNodeId),
          },
        ]),
    ),
    childOccurrences: Object.fromEntries(
      Object.entries(childOccurrences)
        .filter(([nodeId]) => !isHistoricalSupertagApplicationId(nodeId, applicationIds))
        .map(([nodeId, ids]) => [
          semanticNodeId(nodeId),
          ids.filter((id) => !isHistoricalSupertagApplicationId(id, applicationIds)).map(occurrenceId),
        ]),
    ),
    nodeOwners: Object.fromEntries(
      Object.entries(nodeOwners)
        .filter(([nodeId]) => !isHistoricalSupertagApplicationId(nodeId, applicationIds))
        .map(([nodeId, ownerNodeId]) => [
          semanticNodeId(nodeId),
          ownerNodeId === null ? null : semanticNodeId(ownerNodeId),
        ]),
    ),
    templateNodeInstances: templateNodeInstances.map((instance) => ({
      ...instance,
      sources: instance.sources.map((source) => ({
        ...source,
        templateOccurrenceId: occurrenceId(source.templateOccurrenceId),
      })),
    })),
    nodes: Object.fromEntries(
      Object.entries(nodes)
        .filter(([id]) => !isHistoricalSupertagApplicationId(id, applicationIds))
        .map(([id, node]) => [
          semanticNodeId(id),
          {
            ...node,
            nodeId: semanticNodeId(node.nodeId),
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
  return JSON.stringify(semantic, (key, value) => {
    const retained = omitSemanticProvenance(key, value);
    return typeof retained === "string" ? semanticNodeId(retained) : retained;
  });
}

function isHistoricalSupertagApplicationId(id: string, activeIds: ReadonlyMap<string, string>): boolean {
  return id.includes("/projection/supertag-application/") && !activeIds.has(id);
}

function omitSemanticProvenance(key: string, value: unknown): unknown {
  return key === "factActionIds" ||
    key === "factActionId" ||
    key === "modeActionIds" ||
    key === "detachmentActionIds" ||
    key === "initializationId" ||
    key === "deletionActionIds"
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
      proposalFactIds: [proposal.id],
    },
  });
  return [a1, b1, proposal, a2, resolution];
}

function extensionCycleFixture(): Fact[] {
  const actions: readonly GraphAction[] = [
    ...workspaceGenesisActions("workspace"),
    ...["base", "supertag-a", "supertag-b", "task", "field-a"].map((nodeId): GraphAction => ({
      kind: "node-create",
      nodeId,
      ownerNodeId: "workspace",
      originalPlacement: { placementId: `${nodeId}-original`, anchor: end },
      ...(nodeId === "supertag-a" || nodeId === "supertag-b"
        ? { intrinsicNodeType: "supertag-definition" as const }
        : nodeId === "field-a"
          ? { intrinsicNodeType: "field-definition" as const }
          : {}),
    })),
    ...supertagApplicationActions("task", "supertag-a", end),
  ];
  const prefix = actions.map((authoredAction, index) =>
    authoredFact(A, index + 1, index === 0 ? {} : { [A]: index }, index + 1, authoredAction),
  );
  const observed = { [A]: prefix.length };
  return [
    ...prefix,
    authoredFact(B, 1, observed, prefix.length + 1, {
      kind: "supertag-extension-add",
      supertagId: "supertag-a",
      baseSupertagId: "supertag-b",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    }),
    authoredFact(C, 1, observed, prefix.length + 1, {
      kind: "supertag-extension-add",
      supertagId: "supertag-b",
      baseSupertagId: "supertag-a",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    }),
  ];
}

function concurrentSearchExpressionFixture(): Readonly<{ prefix: readonly Fact[]; facts: readonly Fact[] }> {
  const prefix: Fact[] = [];
  const add = (authoredAction: GraphAction): Fact => {
    const sequence = prefix.length + 1;
    const fact = authoredFact(A, sequence, sequence === 1 ? {} : { [A]: sequence - 1 }, sequence, authoredAction);
    prefix.push(fact);
    return fact;
  };
  for (const authoredAction of workspaceGenesisActions("workspace")) {
    add(authoredAction);
  }
  add({
    kind: "node-create",
    nodeId: "search",
    ownerNodeId: "workspace",
    originalPlacement: { placementId: "search-original", anchor: end },
    intrinsicNodeType: "search",
  });
  add({
    kind: "node-create",
    nodeId: "tag",
    ownerNodeId: "workspace",
    originalPlacement: { placementId: "tag-original", anchor: end },
    intrinsicNodeType: "supertag-definition",
  });
  const root = add({
    kind: "search-expression-add",
    expressionHostId: "search",
    parentExpressionId: null,
    clause: { kind: "and" },
    anchor: end,
  });
  const rootId = factActionId(root.id, 0);
  const tag = add({
    kind: "search-expression-add",
    expressionHostId: "search",
    parentExpressionId: rootId,
    clause: { kind: "supertag", supertagId: "tag" },
    anchor: end,
  });
  const tagId = factActionId(tag.id, 0);
  const text = add({
    kind: "search-expression-add",
    expressionHostId: "search",
    parentExpressionId: rootId,
    clause: { kind: "text", text: "current" },
    anchor: end,
  });
  const textId = factActionId(text.id, 0);
  const observed = { [A]: prefix.length };
  return {
    prefix,
    facts: [
      ...prefix,
      authoredFact(B, 1, observed, prefix.length + 1, {
        kind: "search-expression-move",
        expressionId: textId,
        parentExpressionId: rootId,
        anchor: { after: null, before: tagId, affinity: "before", fallback: "start" },
      }),
      authoredFact(C, 1, observed, prefix.length + 1, {
        kind: "search-expression-configure",
        expressionId: textId,
        clause: { kind: "text", text: "updated" },
      }),
    ],
  };
}

function concurrentViewOptionsFixture(): Readonly<{ prefix: readonly Fact[]; facts: readonly Fact[] }> {
  const prefix: Fact[] = [];
  const add = (authoredAction: GraphAction): Fact => {
    const sequence = prefix.length + 1;
    const fact = authoredFact(A, sequence, sequence === 1 ? {} : { [A]: sequence - 1 }, sequence, authoredAction);
    prefix.push(fact);
    return fact;
  };
  for (const authoredAction of workspaceGenesisActions("workspace")) {
    add(authoredAction);
  }
  for (const nodeId of ["host", "field-a", "field-b"]) {
    add({
      kind: "node-create",
      nodeId,
      ownerNodeId: "workspace",
      originalPlacement: { placementId: `${nodeId}-original`, anchor: end },
      ...(nodeId.startsWith("field-") ? { intrinsicNodeType: "field-definition" as const } : {}),
    });
  }
  const view = add({ kind: "shared-default-view-add", hostNodeId: "host", viewType: "table", anchor: end });
  const viewId = factActionId(view.id, 0);
  const columnA = add({ kind: "view-column-add", viewId, fieldDefinitionId: "field-a", anchor: end });
  const columnAId = factActionId(columnA.id, 0);
  const columnB = add({ kind: "view-column-add", viewId, fieldDefinitionId: "field-b", anchor: end });
  const columnBId = factActionId(columnB.id, 0);
  const observed = { [A]: prefix.length };
  return {
    prefix,
    facts: [
      ...prefix,
      authoredFact(B, 1, observed, prefix.length + 1, {
        kind: "view-column-move",
        columnId: columnBId,
        anchor: { after: null, before: columnAId, affinity: "before", fallback: "start" },
      }),
      authoredFact(C, 1, observed, prefix.length + 1, {
        kind: "view-sort-add",
        viewId,
        fieldDefinitionId: "field-a",
        direction: "ascending",
      }),
    ],
  };
}

function authoredFact(
  replicaId: string,
  sequence: number,
  observed: Readonly<Record<string, number>>,
  lamport: number,
  authoredAction: GraphAction,
): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence,
    observed,
    lamport,
    body: { kind: "action", actorId: replicaId, intent: "direct", actions: [authoredAction] },
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
    body: graphActionBody("actor", intent, [
      { kind: "node-create", nodeId, ownerNodeId: "workspace", originalPlacement: null },
    ]),
  });
}

function records(facts: readonly Fact[]): readonly Fact[] {
  return facts;
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
