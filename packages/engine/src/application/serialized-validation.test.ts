import { describe, expect, it } from "vitest";

import type { EngineQuery } from "./contract.js";
import { createTransportEngineContract, type EngineTransport } from "./transport.js";

const selection = {
  token: "token",
  workspaceId: "workspace",
  frontier: {},
  generationId: "generation",
  evidence: {
    proposalTargets: ["proposal"],
    supportClosure: ["proposal"],
    effects: [
      {
        kind: "lifecycle",
        identity: "node",
        origin: false,
        review: true,
      },
    ],
    associatedImpactIds: [],
    rulesVersion: "proposal-rules-1",
    schemaVersion: "lode-schema-12",
  },
} as const;

describe("serialized contract deep validation", () => {
  it("rejects malformed nested Review selections and every Decision Effect family", async () => {
    const malformedSelections: readonly unknown[] = [
      {
        ...selection,
        evidence: { ...selection.evidence, proposalTargets: "not-an-array" },
      },
      {
        ...selection,
        evidence: {
          ...selection.evidence,
          effects: [
            {
              kind: "text",
              nodeId: "node",
              addedAtomIds: ["not-an-atom"],
              deletedAtomIds: [],
              markChanges: [],
            },
          ],
        },
      },
      {
        ...selection,
        evidence: {
          ...selection.evidence,
          effects: [
            {
              kind: "structure",
              occurrenceId: "occurrence",
              originPresent: true,
              reviewPresent: true,
              originParentId: null,
              reviewParentId: null,
              anchor: { after: null, before: null, affinity: "sideways", fallback: "end" },
              originRelation: null,
              reviewRelation: null,
            },
          ],
        },
      },
      {
        ...selection,
        evidence: {
          ...selection.evidence,
          effects: [
            {
              kind: "value",
              ownerKind: "future-owner",
              ownerId: "node",
              namespace: "property",
              key: "color",
              origin: { kind: "unset" },
              review: { kind: "set" },
            },
          ],
        },
      },
      {
        ...selection,
        evidence: {
          ...selection.evidence,
          effects: [{ kind: "canonical", identity: "node", origin: [], review: null }],
        },
      },
    ];

    for (const malformed of malformedSelections) {
      expect(
        await queryResponse(reviewResult(malformed), {
          kind: "review",
          workspaceId: "workspace",
        }),
      ).toMatchObject({
        status: "rejected",
        error: { code: "projection-unavailable" },
      });
    }
  });

  it("rejects malformed nested History selections and compensation Mutations", async () => {
    const history = {
      token: "history-token",
      channelId: "channel",
      operation: "undo",
      targetInvocationId: "target",
      headInvocationId: "target",
      headOrdinal: 1,
      frontier: {},
      evidence: {
        targetInvocationId: "target",
        targetFactIds: ["fact"],
        compensations: [{ kind: "node-delete", nodeId: "node" }],
      },
    } as const;
    const malformed = [
      { ...history, headOrdinal: "one" },
      { ...history, evidence: { ...history.evidence, targetFactIds: "fact" } },
      {
        ...history,
        evidence: {
          ...history.evidence,
          compensations: [{ kind: "future-mutation", nodeId: "node" }],
        },
      },
    ];
    for (const undo of malformed) {
      expect(
        await queryResponse(
          {
            status: "ok",
            value: { channelId: "channel", undo, redo: null },
          },
          {
            kind: "history",
            workspaceId: "workspace",
            channelId: "channel",
          },
        ),
      ).toMatchObject({
        status: "rejected",
        error: { code: "projection-unavailable" },
      });
    }
  });

  it("rejects malformed nested Projection atoms", async () => {
    const node = {
      nodeId: "node",
      text: [{ id: "not-an-atom", value: "X", attributes: {}, contributionId: "fact" }],
      properties: {},
      metadata: {},
    };
    expect(
      await queryResponse(
        {
          status: "ok",
          value: {
            identity: {
              generationId: "generation",
              frontier: {},
              rulesVersion: "proposal-rules-1",
              schemaVersion: "lode-schema-12",
            },
            view: "origin",
            section: "nodes",
            entries: [{ identity: "node", value: node }],
            next: null,
            nodes: { node },
            occurrences: {},
            children: {},
            canonicalOccurrences: {},
            addressedValues: {},
          },
        },
        {
          kind: "projection",
          workspaceId: "workspace",
          view: "origin",
        },
      ),
    ).toMatchObject({
      status: "rejected",
      error: { code: "projection-unavailable" },
    });
  });

  it("accepts typed Conflict queries and rejects malformed candidate provenance", async () => {
    const replicaId = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const issue = {
      kind: "resolution-conflict",
      identity: "conflict",
      proposalContributionIds: ["proposal"],
      candidates: [
        {
          resolutionId: "resolution",
          decision: "accept",
          actorId: "reviewer",
          replicaId,
          observedFrontier: { [replicaId]: 1 },
        },
      ],
    } as const;
    const query = { kind: "conflicts", workspaceId: "workspace" } as const;
    const result = {
      status: "ok",
      value: {
        generationId: "generation",
        frontier: { [replicaId]: 2 },
        issues: [issue],
        next: null,
      },
    };
    expect(await queryResponse(result, query)).toEqual(result);

    for (const candidate of [
      { ...issue.candidates[0], decision: "defer" },
      { ...issue.candidates[0], observedFrontier: { malformed: 1 } },
      { ...issue.candidates[0], futureProvenance: true },
    ]) {
      expect(
        await queryResponse(
          {
            ...result,
            value: { ...result.value, issues: [{ ...issue, candidates: [candidate] }] },
          },
          query,
        ),
      ).toMatchObject({
        status: "rejected",
        error: { code: "projection-unavailable" },
      });
    }
  });

  it("validates serialized Placement Conflict provenance and candidate anchors", async () => {
    const replicaId = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const issue = {
      kind: "placement-conflict",
      identity: "placement-conflict",
      occurrenceId: "value-occurrence",
      canonicalParentOccurrenceId: "parent-a",
      candidates: [
        {
          contributionId: "move-a",
          parentOccurrenceId: "parent-a",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          actorId: "mover",
          replicaId,
          observedFrontier: { [replicaId]: 1 },
        },
      ],
    } as const;
    const query = { kind: "conflicts", workspaceId: "workspace" } as const;
    const result = {
      status: "ok",
      value: {
        generationId: "generation",
        frontier: { [replicaId]: 2 },
        issues: [issue],
        next: null,
      },
    } as const;
    expect(await queryResponse(result, query)).toEqual(result);
    expect(
      await queryResponse(
        {
          ...result,
          value: {
            ...result.value,
            issues: [
              {
                ...issue,
                candidates: [
                  {
                    ...issue.candidates[0],
                    anchor: { ...issue.candidates[0].anchor, affinity: "near" },
                  },
                ],
              },
            ],
          },
        },
        query,
      ),
    ).toMatchObject({ status: "rejected", error: { code: "projection-unavailable" } });
  });

  it("validates serialized unsupported Direct intent provenance and recovery actions", async () => {
    const replicaId = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const issue = {
      kind: "unsupported-direct-intent",
      identity: "unsupported-direct",
      contributionId: "direct-edit",
      mutationKind: "text-splice",
      actorId: "author",
      replicaId,
      observedFrontier: { [replicaId]: 2 },
      missingSupportContributionIds: ["rejected-provider"],
      requiredNodeIds: ["proposal-node"],
      recoveryActions: ["restore-support"],
    } as const;
    const query = { kind: "conflicts", workspaceId: "workspace" } as const;
    const result = {
      status: "ok",
      value: {
        generationId: "generation",
        frontier: { [replicaId]: 3 },
        issues: [issue],
        next: null,
      },
    } as const;
    expect(await queryResponse(result, query)).toEqual(result);
    expect(
      await queryResponse(
        {
          ...result,
          value: {
            ...result.value,
            issues: [{ ...issue, recoveryActions: ["discard"] }],
          },
        },
        query,
      ),
    ).toMatchObject({ status: "rejected", error: { code: "projection-unavailable" } });
  });

  it("accepts typed Schema Search results and rejects unbounded or malformed pages", async () => {
    const query = {
      kind: "schema-search",
      workspaceId: "workspace",
      view: "origin",
      schemaId: "anime",
      limit: 2,
    } as const;
    const result = {
      status: "ok",
      value: {
        generationId: "generation",
        frontier: {},
        view: "origin",
        schemaId: "anime",
        nodeIds: ["a", "b"],
        next: "b",
      },
    } as const;
    expect(await queryResponse(result, query)).toEqual(result);
    expect(
      await queryResponse({ ...result, value: { ...result.value, nodeIds: ["a", 1] } }, query),
    ).toMatchObject({ status: "rejected", error: { code: "projection-unavailable" } });
    expect(await queryResponse(result, { ...query, limit: 100 })).toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });
  });

  it("validates the bounded Hard Delete History impact summary exactly", async () => {
    const replicaId = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const query = {
      kind: "hard-delete-preview",
      workspaceId: "workspace",
      nodeId: "node",
    } as const;
    const result = {
      status: "ok",
      value: {
        generationId: "generation",
        selection: {
          workspaceId: "workspace",
          frontier: { [replicaId]: 2 },
          nodeId: "node",
          deletionFactIds: ["deletion"],
          acknowledgementFactIds: [],
          retiredReplicaIds: [],
        },
        referenceOccurrenceIds: [],
        schemaApplicationNodeIds: [],
        materializedFieldNodeIds: [],
        pendingProposalContributionIds: [],
        knownReplicaIds: [replicaId],
        acknowledgedReplicaIds: [],
        outcomeUnknownInvocationIds: [],
        historyImpact: {
          affectedInvocationIds: ["edit-node"],
          affectedChannelIds: ["desktop"],
          totalAffectedInvocations: 1,
          truncated: false,
        },
        blockers: ["replica-unconfirmed"],
        canExecute: false,
      },
    } as const;
    expect(await queryResponse(result, query)).toEqual(result);
    expect(
      await queryResponse(
        {
          ...result,
          value: {
            ...result.value,
            historyImpact: { ...result.value.historyImpact, futureScope: true },
          },
        },
        query,
      ),
    ).toMatchObject({ status: "rejected", error: { code: "projection-unavailable" } });
  });

  it("rejects malformed Review, Adjudication, and History capabilities before sending", async () => {
    let sends = 0;
    const adapter = createTransportEngineContract({
      request() {
        sends += 1;
        return Promise.reject(new Error("must not send"));
      },
    });
    const malformedReview = {
      ...selection,
      evidence: { ...selection.evidence, effects: [{ kind: "future-effect" }] },
    };
    expect(
      await adapter.execute({
        kind: "adjudicate-resolution",
        workspaceId: "workspace",
        invocationId: "adjudication",
        actorId: "actor",
        decision: "accept",
        proposalContributionIds: ["proposal"],
        resolutionIds: ["resolution", "resolution"],
      } as never),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    expect(
      await adapter.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "review",
        actorId: "actor",
        decision: "accept",
        selection: malformedReview,
      } as never),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    expect(
      await adapter.execute({
        kind: "undo",
        workspaceId: "workspace",
        invocationId: "undo",
        actorId: "actor",
        selection: { operation: "undo", evidence: { compensations: "not-an-array" } },
      } as never),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    expect(sends).toBe(0);
  });
});

function reviewResult(reviewSelection: unknown) {
  return {
    status: "ok",
    value: {
      generationId: "generation",
      frontier: {},
      hunks: [
        {
          id: "hunk",
          diffSpace: { kind: "lifecycle", identity: "node" },
          proposalContributionIds: ["proposal"],
          neutralBridgeAtomIds: [],
          linkedHunkIds: [],
          selection: reviewSelection,
        },
      ],
      next: null,
    },
  };
}

async function queryResponse(value: unknown, query: EngineQuery) {
  const transport: EngineTransport = {
    request: () =>
      Promise.resolve(
        new TextEncoder().encode(
          JSON.stringify({
            kind: "query-result",
            result: value,
          }),
        ),
      ),
  };
  return createTransportEngineContract(transport).query(query);
}
