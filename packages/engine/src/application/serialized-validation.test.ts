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
    schemaVersion: "proposal-schema-1",
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
              schemaVersion: "proposal-schema-1",
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
            managedChildren: [],
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

  it("rejects malformed Review and History capabilities before sending", async () => {
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
