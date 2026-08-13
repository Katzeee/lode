import { describe, expect, it } from "vitest";

import {
  createEngineTransportServer,
  createTransportEngineContract,
  type EngineTransport,
} from "../src/application/transport.js";
import { admitAuthorityRecords } from "../src/domain/admission/index.js";
import type { EditMutation } from "../src/domain/edit/index.js";
import {
  frontierOf,
  admitAuthorityRecordShapes,
  factTransactionId,
  makeFact,
  type AuthorityRecord,
  type AuthorityReceipt,
  type ContributionFact,
  type Fact,
  type FactSnapshot,
  type Mutation,
} from "../src/domain/fact/index.js";
import { rebuildGeneration } from "../src/domain/reconcile/index.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
} from "../src/runtime/workspace/generation-checkpoint.js";
import { baseFixture, HistoryFixture } from "../src/domain/history/history-test-helpers.js";
import { queryHistory, validateHistorySelection } from "../src/domain/history/history.js";
import { base, generation } from "../src/domain/review/review-test-helpers.js";
import { queryReview, validateReviewSelection } from "../src/domain/review/review.js";
import { compileProjectionPlan } from "../src/domain/reconcile/projection-plan-dag.js";
import { PROJECTION_PLAN } from "../src/domain/reconcile/projection-plan.js";
import { fullSurface } from "../src/domain/reconcile/reconcile-test-helpers.js";
import {
  historyLifecycleCases,
  proposalLifecycleCases,
} from "../src/domain/reconcile/proposal-lifecycle-test-helpers.js";
import { InMemoryDocumentStore } from "../src/persistence/in-memory-document-store.js";
import { FactAuthorityStore } from "../src/runtime/authority/fact-authority-store.js";
import { ProposalWorkspace } from "../src/runtime/workspace/proposal-workspace.js";
import {
  assertGeneratedPathEquivalence,
  generatedDomainGraph,
} from "./proposal-mode-property-fixtures.js";

const CHECKPOINT_KEY = "property-test-key";

const A = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccc";
const versions = { rulesVersion: "proposal-rules-3", schemaVersion: "lode-schema-16" } as const;

describe("seeded Proposal Mode property and permutation contracts", () => {
  it("arrival order and duplicate delivery preserve one admitted snapshot", () => {
    const facts = causalFixture();
    const expected = admitAuthorityRecordShapes("workspace", records(facts));
    expect(expected.kind).toBe("ready");
    for (let seed = 1; seed <= 64; seed += 1) {
      const delivered = shuffle(
        [...records(facts), ...records(facts.filter((_, index) => index % 2 === 0))],
        seed,
      );
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
    const expected = rebuildGeneration(
      "workspace",
      { facts, frontier: frontierOf(facts) },
      versions,
    ).generation;
    for (let seed = 1; seed <= 32; seed += 1) {
      const shuffled = { facts: shuffle(facts, seed), frontier: frontierOf(facts) };
      expect(
        reconcileFromCheckpoint(checkpoint, "workspace", shuffled, versions, CHECKPOINT_KEY)
          ?.generation,
      ).toEqual(expected);
    }

    for (let seed = 1; seed <= 32; seed += 1) {
      const compiled = compileProjectionPlan(shuffle([...PROJECTION_PLAN.ordered], seed));
      expect(compiled.ordered.map((stage) => stage.key)).toEqual(
        PROJECTION_PLAN.ordered.map((stage) => stage.key),
      );
    }
  });

  it("Schema Extension cycle and search projections converge across seeded arrival and checkpoints", () => {
    const facts = extensionCycleFixture();
    const prefixFacts = facts.slice(0, 6);
    const prefix = { facts: prefixFacts, frontier: frontierOf(prefixFacts) };
    const checkpoint = createGenerationCheckpoint(
      "workspace",
      prefix,
      rebuildGeneration("workspace", prefix, versions).generation,
      CHECKPOINT_KEY,
    );
    const expected = rebuildGeneration(
      "workspace",
      { facts, frontier: frontierOf(facts) },
      versions,
    ).generation;
    expect(expected.origin.schemaExtensionConflicts).toEqual({
      "schema-a": ["schema-a", "schema-b"],
      "schema-b": ["schema-a", "schema-b"],
    });
    expect(expected.origin.effectiveFields.task?.map((field) => field.fieldDefinitionId)).toEqual([
      "field-a",
    ]);
    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = { facts: shuffle(facts, seed), frontier: frontierOf(facts) };
      expect(rebuildGeneration("workspace", snapshot, versions).generation).toEqual(expected);
      expect(
        reconcileFromCheckpoint(checkpoint, "workspace", snapshot, versions, CHECKPOINT_KEY)
          ?.generation,
      ).toEqual(expected);
    }
  });

  it("three replicas converge without choosing divergent Field initialization results", () => {
    for (let seed = 1; seed <= 32; seed += 1) {
      const { prefix, concurrent, resolved } = initializationFixture(seed);
      const concurrentSnapshot = { facts: concurrent, frontier: frontierOf(concurrent) };
      const concurrentGeneration = rebuildGeneration(
        "workspace",
        concurrentSnapshot,
        versions,
      ).generation;
      const divergent = seed % 2 === 0;
      expect(
        Object.values(concurrentGeneration.origin.conflictIssues).some(
          (issue) => issue.kind === "field-initialization-conflict",
        ),
      ).toBe(divergent);
      expect(concurrentGeneration.origin.materializedFields.task ?? []).toHaveLength(
        divergent ? 0 : 1,
      );
      expect(admitAuthorityRecords("workspace", records(concurrent)).kind).toBe("ready");

      const snapshot = { facts: resolved, frontier: frontierOf(resolved) };
      const expected = rebuildGeneration("workspace", snapshot, versions).generation;
      expect(expected.origin.conflictIssues).toEqual({});
      expect(expected.origin.materializedFields.task ?? []).toHaveLength(1);
      const checkpointSnapshot = { facts: prefix, frontier: frontierOf(prefix) };
      const checkpoint = createGenerationCheckpoint(
        "workspace",
        checkpointSnapshot,
        rebuildGeneration("workspace", checkpointSnapshot, versions).generation,
        CHECKPOINT_KEY,
      );
      for (const topology of [seed, seed + 101, seed + 997]) {
        const delivered = { facts: shuffle(resolved, topology), frontier: snapshot.frontier };
        expect(rebuildGeneration("workspace", delivered, versions).generation).toEqual(expected);
        expect(
          reconcileFromCheckpoint(checkpoint, "workspace", delivered, versions, CHECKPOINT_KEY)
            ?.generation,
        ).toEqual(expected);
      }
    }
  });

  it("Review and History selections distinguish seeded unrelated and related interleavings", () => {
    for (let seed = 1; seed <= 32; seed += 1) {
      const reviewFacts = base();
      const proposal = reviewFacts.add(
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "selected",
          value: true,
          previous: { kind: "unset" },
        },
        "proposal",
      );
      const selectedSnapshot = reviewFacts.snapshot();
      const reviewSelection = queryReview(
        "workspace",
        selectedSnapshot,
        generation(selectedSnapshot),
      ).hunks[0]?.selection;
      if (!reviewSelection) {
        throw new Error("Expected a Review selection");
      }
      for (const key of shuffle(["a", "b", "c", "d"], seed)) {
        reviewFacts.add({ kind: "node-create", nodeId: `unrelated-${key}` });
      }
      let current = reviewFacts.snapshot();
      expect(
        validateReviewSelection(
          "workspace",
          reviewSelection,
          "accept",
          "reviewer",
          current,
          generation(current),
        ).kind,
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
        validateReviewSelection(
          "workspace",
          reviewSelection,
          "accept",
          "reviewer",
          current,
          generation(current),
        ).kind,
      ).toBe("stale");

      const history = baseFixture();
      history.step({
        invocationId: "selected",
        mutations: [
          {
            kind: "value-set",
            target: { kind: "node", id: "node" },
            namespace: "property",
            key: "selected",
            value: true,
            previous: { kind: "unset" },
          },
        ],
      });
      const historySelection = queryHistory(
        "channel",
        history.receipts,
        history.snapshot(),
        history.generation(),
      ).undo;
      if (!historySelection) {
        throw new Error("Expected a History selection");
      }
      for (const key of shuffle(["a", "b", "c", "d"], seed)) {
        history.fact({
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key,
          value: seed,
          previous: { kind: "unset" },
        });
      }
      expect(
        validateHistorySelection(
          historySelection,
          "actor",
          history.receipts,
          history.snapshot(),
          history.generation(),
        ).kind,
      ).toBe("ready");
      history.fact({
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "selected",
        value: false,
        previous: { kind: "set", value: true },
      });
      expect(
        validateHistorySelection(
          historySelection,
          "actor",
          history.receipts,
          history.snapshot(),
          history.generation(),
        ).kind,
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
        const expectedGeneration = rebuildGeneration(
          "workspace",
          expectedSnapshot,
          versions,
        ).generation;
        for (let seed = 1; seed <= 16; seed += 1) {
          const delivered = shuffle(
            [
              ...records(fixture.values),
              ...records(fixture.values.filter((_, index) => (index + seed) % 3 === 0)),
            ],
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
          const undo = queryHistory(
            channelId,
            restarted.receipts,
            restarted.snapshot,
            restarted.generation,
          ).undo;
          if (!undo) {
            throw new Error(`Generated ${intent} ${ownerCase.kind} program has no Undo`);
          }
          expect(
            validateHistorySelection(
              undo,
              "actor",
              restarted.receipts,
              restarted.snapshot,
              restarted.generation,
            ).kind,
          ).toBe("ready");
          expect(
            restarted.receipts.some((receipt) => receipt.invocationId === targetInvocationId),
          ).toBe(true);

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
            validateHistorySelection(
              redo,
              "actor",
              history.receipts,
              history.snapshot(),
              history.generation(),
            ).kind,
          ).toBe("ready");
          history.step({
            invocationId: `redo-${targetInvocationId}`,
            mutations: redo.evidence.compensations,
            intent,
            channelId,
            operation: "redo",
            targetStepId: redo.targetInvocationId,
          });
          expect(generationFingerprint(history.generation())).toBe(targetProjection);
        }
      }
    }
  });

  it("generated History command matrix covers partial no-effect stale and atomic outcomes", () => {
    for (const [index, ownerCase] of historyLifecycleCases().entries()) {
      for (const intent of ["direct", "proposal"] as const) {
        const mutations = caseMutations(ownerCase);
        const channelId = `matrix-${index}-${intent}`;

        const partial = historyFor(caseSetupFacts(ownerCase));
        const extra = matrixValueMutation(ownerCase.kind, 1);
        partial.step({
          invocationId: "target",
          mutations: [...mutations, extra],
          intent,
          channelId,
        });
        partial.fact(matrixValueMutation(ownerCase.kind, 2), intent);
        const partialUndo = queryHistory(
          channelId,
          partial.receipts,
          partial.snapshot(),
          partial.generation(),
        ).undo;
        if (!partialUndo) {
          throw new Error(`Generated partial ${intent} ${ownerCase.kind} has no Undo`);
        }
        expect(partialUndo.evidence.compensations.length).toBeGreaterThan(0);
        expect(partialUndo.evidence.compensations.length).toBeLessThan(mutations.length + 1);
        const atomic = partial.step({
          invocationId: "partial-undo",
          mutations: partialUndo.evidence.compensations,
          intent,
          channelId,
          operation: "undo",
          targetStepId: "target",
        });
        expect(atomic.factIds).toHaveLength(partialUndo.evidence.compensations.length);

        const noEffect = historyFor(caseSetupFacts(ownerCase));
        noEffect.step({ invocationId: "target", mutations, intent, channelId });
        const compensation = requiredUndo(noEffect, channelId, `${intent}/${ownerCase.kind}`);
        for (const compensatingMutation of compensation.evidence.compensations) {
          noEffect.fact(compensatingMutation, intent);
        }
        expect(
          queryHistory(channelId, noEffect.receipts, noEffect.snapshot(), noEffect.generation())
            .undo,
        ).toBeNull();

        const stale = historyFor(caseSetupFacts(ownerCase));
        stale.step({ invocationId: "target", mutations, intent, channelId });
        const selection = requiredUndo(stale, channelId, `${intent}/${ownerCase.kind}`);
        stale.step({
          invocationId: "new-head",
          mutations: [matrixValueMutation(ownerCase.kind, 3)],
          intent,
          channelId,
        });
        expect(
          validateHistorySelection(
            selection,
            "actor",
            stale.receipts,
            stale.snapshot(),
            stale.generation(),
          ).kind,
        ).toBe("stale");
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
        validateReviewSelection(
          "workspace",
          selection,
          "accept",
          "reviewer",
          unrelated,
          generation(unrelated),
        ).kind,
      ).toBe("valid");
      ownerCase.facts.resolve(selection.evidence.supportClosure, "reject");
      const related = ownerCase.facts.snapshot();
      expect(
        validateReviewSelection(
          "workspace",
          selection,
          "accept",
          "reviewer",
          related,
          generation(related),
        ).kind,
      ).toBe("stale");
    }
  });

  it("generated transport loss recovers every mutation owner by Invocation query", async () => {
    for (const [index, ownerCase] of proposalLifecycleCases().entries()) {
      if (ownerCase.kind === "field-initialize") {
        continue;
      }
      for (const intent of ["direct", "proposal"] as const) {
        const invocationId = `unknown-${index}-${intent}`;
        const workspace = await realWorkspace(caseSetupFacts(ownerCase), index, intent);
        const contract = {
          execute: workspace.execute.bind(workspace),
          query: async (query: Parameters<typeof workspace.query>[0]) => ({
            status: "ok" as const,
            value: await workspace.query(query),
          }),
          subscribe: workspace.subscribe.bind(workspace),
        };
        const server = createEngineTransportServer(contract);
        let loseResponse = true;
        const lossy: EngineTransport = {
          async request(bytes) {
            const response = await server.request(bytes);
            if (loseResponse) {
              loseResponse = false;
              throw new Error("generated response loss after durable command");
            }
            return response;
          },
          subscribe: server.subscribe,
        };
        const adapter = createTransportEngineContract(lossy);
        expect(
          await adapter.execute({
            kind: "mutate",
            workspaceId: "workspace",
            invocationId,
            actorId: "actor",
            intent,
            historyChannelId: `channel-${index}`,
            mutations: publicCaseMutations(ownerCase),
          }),
        ).toEqual({ status: "outcome-unknown", invocationId });
        expect(
          await adapter.query({
            kind: "invocation",
            workspaceId: "workspace",
            invocationId,
          }),
        ).toMatchObject({
          status: "ok",
          value: { status: "published", receipt: { invocationId } },
        });
        if (!historyLifecycleCases().some((entry) => entry.kind === ownerCase.kind)) {
          await workspace.close();
          continue;
        }
        const channelId = `channel-${index}`;
        const history = await workspace.query({
          kind: "history",
          workspaceId: "workspace",
          channelId,
        });
        if (!("undo" in history) || !history.undo) {
          throw new Error(`Real ${intent} ${ownerCase.kind} program has no Undo`);
        }
        expect(
          await workspace.execute({
            kind: "undo",
            workspaceId: "workspace",
            invocationId: `real-undo-${index}-${intent}`,
            actorId: "actor",
            selection: history.undo,
          }),
        ).toMatchObject({ status: "published" });
        const afterUndo = await workspace.query({
          kind: "history",
          workspaceId: "workspace",
          channelId,
        });
        if (!("redo" in afterUndo) || !afterUndo.redo) {
          throw new Error(`Real ${intent} ${ownerCase.kind} program has no Redo`);
        }
        expect(
          await workspace.execute({
            kind: "redo",
            workspaceId: "workspace",
            invocationId: `real-redo-${index}-${intent}`,
            actorId: "actor",
            selection: afterUndo.redo,
          }),
        ).toMatchObject({ status: "published" });
        await workspace.close();
      }
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
        const hunk = queryReview("workspace", snapshot, generation(snapshot)).hunks.find(
          (candidate) => candidate.proposalContributionIds.includes(entry.proposal.id),
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

function caseSetupFacts(
  ownerCase: ReturnType<typeof proposalLifecycleCases>[number],
): readonly Fact[] {
  return ownerCase.facts.values.filter(
    (fact) => fact.body.kind !== "contribution" || fact.body.intent !== "proposal",
  );
}

function caseMutation(fact: Fact): Mutation {
  if (fact.body.kind !== "contribution") {
    throw new Error("Proposal lifecycle fixture unexpectedly contains a Resolution");
  }
  return fact.body.mutation;
}

function caseMutations(
  ownerCase: ReturnType<typeof proposalLifecycleCases>[number],
): readonly Mutation[] {
  return ownerCase.facts.values.flatMap((fact) =>
    fact.body.kind === "contribution" && fact.body.intent === "proposal"
      ? [fact.body.mutation]
      : [],
  );
}

function publicCaseMutations(
  ownerCase: ReturnType<typeof proposalLifecycleCases>[number],
): readonly EditMutation[] {
  const identity = caseMutation(ownerCase.proposal);
  if (identity.kind === "node-owner-set") {
    const placement = Object.values(generation(ownerCase.facts.snapshot()).review.occurrences).find(
      (occurrence) =>
        occurrence.nodeId === identity.nodeId && occurrence.parentNodeId === identity.ownerNodeId,
    );
    if (!placement) {
      throw new Error("Owner fixture has no Reference Occurrence to promote");
    }
    return [{ kind: "reference-promote", occurrenceId: placement.occurrenceId }];
  }
  if (identity.kind !== "node-create") {
    return [unpreparedEdit(identity)];
  }
  const placement = caseMutations(ownerCase).find(
    (mutation) => mutation.kind === "occurrence-create" && mutation.nodeId === "created",
  );
  if (identity.kind !== "node-create" || placement?.kind !== "occurrence-create") {
    throw new Error("Node creation fixture has no Original Occurrence");
  }
  return [
    {
      ...identity,
      occurrenceId: placement.occurrenceId,
      parentNodeId: placement.parentNodeId,
      anchor: placement.anchor,
    },
  ];
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

function matrixValueMutation(_kind: Mutation["kind"], value: number): Mutation {
  return {
    kind: "value-set",
    target: { kind: "node", id: "workspace" },
    namespace: "metadata",
    key: "winner",
    value,
    previous: value === 1 ? { kind: "unset" } : { kind: "set", value: value - 1 },
  };
}

function requiredUndo(history: HistoryFixture, channelId: string, label: string) {
  const undo = queryHistory(
    channelId,
    history.receipts,
    history.snapshot(),
    history.generation(),
  ).undo;
  if (!undo) {
    throw new Error(`Generated ${label} program has no Undo`);
  }
  return undo;
}

async function realWorkspace(
  prefix: readonly Fact[],
  index: number,
  intent: "direct" | "proposal",
): Promise<ProposalWorkspace> {
  const documents = new InMemoryDocumentStore();
  const store = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: A,
    loroPeerId: `${10_000 + index * 2 + (intent === "proposal" ? 1 : 0)}`,
    documents,
    admitRecords: admitAuthorityRecords,
  });
  const workspace = await ProposalWorkspace.open({
    workspaceId: "workspace",
    facts: store,
    versions,
  });
  const contributions = prefix.filter(
    (fact): fact is ContributionFact => fact.body.kind === "contribution",
  );
  const consumedOccurrenceIds = new Set<string>();
  const mutations = contributions.flatMap((fact): readonly EditMutation[] => {
    const mutation = fact.body.mutation;
    if (mutation.kind === "node-create" && mutation.nodeId === "workspace") {
      return [];
    }
    if (mutation.kind === "occurrence-create" && consumedOccurrenceIds.has(mutation.occurrenceId)) {
      return [];
    }
    if (mutation.kind === "field-initialize") {
      return [];
    }
    if (mutation.kind === "node-owner-set") {
      const placement = contributions
        .map((candidate) => candidate.body.mutation)
        .find(
          (candidate) =>
            candidate.kind === "occurrence-create" &&
            candidate.nodeId === mutation.nodeId &&
            candidate.parentNodeId === mutation.ownerNodeId,
        );
      if (placement?.kind !== "occurrence-create") {
        throw new Error("Generated Owner setup has no Reference Occurrence");
      }
      return [{ kind: "reference-promote", occurrenceId: placement.occurrenceId }];
    }
    if (mutation.kind !== "node-create") {
      return [unpreparedEdit(mutation)];
    }
    const placement = contributions
      .map((candidate) => candidate.body.mutation)
      .find(
        (candidate) =>
          candidate.kind === "occurrence-create" &&
          candidate.nodeId === mutation.nodeId &&
          !consumedOccurrenceIds.has(candidate.occurrenceId),
      );
    if (placement?.kind !== "occurrence-create") {
      throw new Error(`Generated prefix Node has no placement: ${mutation.nodeId}`);
    }
    consumedOccurrenceIds.add(placement.occurrenceId);
    return [
      {
        ...mutation,
        occurrenceId: placement.occurrenceId,
        parentNodeId: placement.parentNodeId,
        anchor: placement.anchor,
      },
    ];
  });
  if (mutations.length > 0) {
    const result = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: `prefix-${index}-${intent}`,
      actorId: "setup",
      intent: "direct",
      historyChannelId: "setup",
      mutations,
    });
    if (result.status !== "published") {
      throw new Error(`Generated prefix ${index}/${intent} failed: ${JSON.stringify(result)}`);
    }
  }
  return workspace;
}

const PREPARED_EVIDENCE = new Set([
  "deletedAtoms",
  "observedConfigFactIds",
  "observedInitializationFactIds",
  "previous",
  "previousAnchor",
  "previousConfig",
  "previousOwnerNodeId",
  "previousParentNodeId",
  "sourceApplicationSchemaIds",
  "sourceSchemaIds",
  "sourceTemplateOccurrenceIds",
]);

function unpreparedEdit(mutation: Mutation): EditMutation {
  return Object.fromEntries(
    Object.entries(mutation).filter(([key]) => !PREPARED_EVIDENCE.has(key)),
  ) as EditMutation;
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
    reviewScopes: _reviewScopes,
    supportByContribution: _supportByContribution,
    nodes,
    ...rest
  } = projection;
  const semantic = {
    ...rest,
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([id, node]) => [
        id,
        {
          ...node,
          text: node.text.map((atom) => ({ value: atom.value, attributes: atom.attributes })),
        },
      ]),
    ),
  };
  return JSON.stringify(semantic, omitSemanticProvenance);
}

function omitSemanticProvenance(key: string, value: unknown): unknown {
  return key === "contributionIds" ||
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
    { kind: "node-create", nodeId: "workspace" },
    { kind: "node-create", nodeId: "base" },
    { kind: "node-create", nodeId: "schema-a" },
    { kind: "node-create", nodeId: "schema-b" },
    { kind: "node-create", nodeId: "task" },
    { kind: "node-create", nodeId: "field-a" },
    { kind: "node-create", nodeId: "schema-a-field-a-template-field" },
    {
      kind: "occurrence-create",
      occurrenceId: "schema-a-field-a-template-field-occurrence",
      nodeId: "schema-a-field-a-template-field",
      parentNodeId: "schema-a",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
    {
      kind: "schema-field-add",
      schemaId: "schema-a",
      fieldDefinitionId: "field-a",
      fieldNodeId: "schema-a-field-a-template-field",
      fieldOccurrenceId: "schema-a-field-a-template-field-occurrence",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
  ];
  const prefix = mutations.map((mutation, index) =>
    mutationFact(A, index + 1, index === 0 ? {} : { [A]: index }, index + 1, mutation),
  );
  const observed = { [A]: prefix.length };
  return [
    ...prefix,
    mutationFact(B, 1, observed, prefix.length + 1, {
      kind: "schema-extension-add",
      schemaId: "schema-a",
      baseSchemaId: "schema-b",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    }),
    mutationFact(C, 1, observed, prefix.length + 1, {
      kind: "schema-extension-add",
      schemaId: "schema-b",
      baseSchemaId: "schema-a",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    }),
    mutationFact(A, prefix.length + 1, observed, prefix.length + 1, {
      kind: "schema-apply",
      nodeId: "task",
      schemaId: "schema-a",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    }),
  ];
}

function initializationFixture(seed: number): Readonly<{
  prefix: readonly Fact[];
  concurrent: readonly Fact[];
  resolved: readonly Fact[];
}> {
  const mutations: readonly Mutation[] = [
    { kind: "node-create", nodeId: "workspace" },
    { kind: "node-create", nodeId: "task" },
    {
      kind: "occurrence-create",
      occurrenceId: "task-occurrence",
      nodeId: "task",
      parentNodeId: "workspace",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
    { kind: "node-create", nodeId: "task-schema" },
    {
      kind: "occurrence-create",
      occurrenceId: "task-schema-original",
      nodeId: "task-schema",
      parentNodeId: "workspace",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
    { kind: "node-create", nodeId: "status-field" },
    {
      kind: "occurrence-create",
      occurrenceId: "status-field-original",
      nodeId: "status-field",
      parentNodeId: "workspace",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
    { kind: "node-create", nodeId: "task-schema-status-field-template-field" },
    {
      kind: "occurrence-create",
      occurrenceId: "task-schema-status-field-template-field-occurrence",
      nodeId: "task-schema-status-field-template-field",
      parentNodeId: "task-schema",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
    {
      kind: "schema-field-add",
      schemaId: "task-schema",
      fieldDefinitionId: "status-field",
      fieldNodeId: "task-schema-status-field-template-field",
      fieldOccurrenceId: "task-schema-status-field-template-field-occurrence",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
    {
      kind: "schema-field-configure",
      schemaId: "task-schema",
      fieldDefinitionId: "status-field",
      fieldNodeId: "task-schema-status-field-template-field",

      config: {
        visibility: "normal",
        staticDefault: null,
        initializer: { kind: "literal", values: [] },
      },
      previousConfig: { visibility: "normal", staticDefault: null, initializer: null },
      observedConfigFactIds: [],
    },
    {
      kind: "schema-apply",
      nodeId: "task",
      schemaId: "task-schema",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
  ];
  const prefix = transactionFacts(A, {}, 1, mutations);
  const observed = { [A]: prefix.length };
  const firstBundle = initializationFacts(B, observed, prefix.length + 1, "Alpha");
  const first = firstBundle.at(-1)!;
  const secondValue = seed % 2 === 0 ? "Beta" : "Alpha";
  const secondBundle = initializationFacts(C, observed, prefix.length + 1, secondValue);
  const second = secondBundle.at(-1)!;
  const concurrent = [...prefix, ...firstBundle, ...secondBundle];
  const choice = mutationFact(
    A,
    prefix.length + 1,
    { [A]: prefix.length, [B]: firstBundle.length, [C]: secondBundle.length },
    prefix.length + firstBundle.length + 1,
    {
      ...initialization("Alpha"),
      observedInitializationFactIds: [first.id, second.id],
    },
  );
  return { prefix, concurrent, resolved: [...concurrent, choice] };
}

function initializationFacts(
  replicaId: string,
  observed: Readonly<Record<string, number>>,
  lamport: number,
  value: string,
): readonly Fact[] {
  const mutations: readonly Mutation[] = [
    {
      kind: "node-create",
      nodeId: "initialized-field:v1:task:status-field",
      seed: {
        text: [],
        properties: { fieldDefinitionId: "status-field" },
        metadata: { initializedBy: "auto-initialize" },
      },
    },
    {
      kind: "occurrence-create",
      occurrenceId: "initialized-field-occ:v1:task:status-field",
      nodeId: "initialized-field:v1:task:status-field",
      parentNodeId: "task",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
    {
      kind: "node-create",
      nodeId: "initialized-field:v1:task:status-field:value:0",
      seed: {
        text: [...value].map((character) => ({ value: character, attributes: {} })),
        properties: {},
        metadata: { initializedBy: "auto-initialize" },
      },
    },
    {
      kind: "occurrence-create",
      occurrenceId: "initialized-field-occ:v1:task:status-field:value:0",
      nodeId: "initialized-field:v1:task:status-field:value:0",
      parentNodeId: "initialized-field:v1:task:status-field",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
    initialization(value),
  ];
  return transactionFacts(replicaId, observed, lamport, mutations);
}

function transactionFacts(
  replicaId: string,
  observed: Readonly<Record<string, number>>,
  lamport: number,
  mutations: readonly Mutation[],
): readonly Fact[] {
  const firstSequence = (observed[replicaId] ?? 0) + 1;
  const transactionId = factTransactionId("workspace", replicaId, firstSequence);
  return mutations.map((mutation, index) =>
    makeFact({
      workspaceId: "workspace",
      replicaId,
      sequence: firstSequence + index,
      observed: {
        ...observed,
        ...(index > 0 ? { [replicaId]: firstSequence + index - 1 } : {}),
      },
      lamport: lamport + index,
      transaction: { transactionId, index, size: mutations.length },
      body: { kind: "contribution", actorId: replicaId, intent: "direct", mutation },
    }),
  );
}

function initialization(value: string): Extract<Mutation, { kind: "field-initialize" }> {
  return {
    kind: "field-initialize",
    ownerNodeId: "task",
    schemaId: "task-schema",
    fieldDefinitionId: "status-field",
    fieldNodeId: "initialized-field:v1:task:status-field",
    fieldOccurrenceId: "initialized-field-occ:v1:task:status-field",
    source: "auto-initialize",
    values: [
      {
        kind: "text",
        nodeId: "initialized-field:v1:task:status-field:value:0",
        occurrenceId: "initialized-field-occ:v1:task:status-field:value:0",
        value,
      },
    ],
    observedInitializationFactIds: [],
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
