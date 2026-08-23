import { describe, expect, it } from "vitest";

import {
  canonicalDigest,
  canonicalJson,
  buildFactSnapshot,
  factId,
  makeFact,
  parseFactBody,
  validateReceipts,
  type AuthorityReceipt,
} from "./index.js";
import { uniqueFacts } from "../../../tests/support/facts.js";

const REPLICA_A = "101";
const REPLICA_B = "202";

function editFact(sequence: number, overrides: Partial<Parameters<typeof makeFact>[0]> = {}) {
  return makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA_A,
    sequence,
    observed: sequence === 1 ? {} : { [REPLICA_A]: sequence - 1 },
    lamport: sequence,
    body: {
      kind: "edit",
      actorId: "actor",
      intent: "proposal",
      actions: [
        {
          kind: "node-create",
          nodeId: `node-${sequence}`,
          ownerNodeId: "workspace",
          originalPlacement: null,
        },
      ],
    },
    ...overrides,
  });
}

describe("production Fact contracts", () => {
  it("AUTH-1 facts are the only domain authority", () => {
    const fact = editFact(1);
    const interpretation = buildFactSnapshot("workspace", uniqueFacts([fact]));

    expect(interpretation).toEqual({
      facts: [fact],
      frontier: { [REPLICA_A]: 1 },
    });
    expect(interpretation).not.toHaveProperty("receipt");
    expect(interpretation).not.toHaveProperty("projection");
  });

  it("AUTH-3 editFact intent and Actor identity remain immutable", () => {
    const proposal = editFact(1);
    const resolution = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      sequence: 2,
      observed: { [REPLICA_A]: 1 },
      lamport: 2,
      body: {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "reviewer",
        decision: "accept",
        proposalFactIds: [proposal.id],
      },
    });
    const interpretation = buildFactSnapshot("workspace", uniqueFacts([proposal, resolution]));
    expect(interpretation.facts[0]?.body).toEqual(proposal.body);
    expect(interpretation.facts[0]?.body).toMatchObject({
      intent: "proposal",
      actorId: "actor",
    });
  });

  it("receipt batches and History lineage are exact non-empty authority ledger units", () => {
    const first = editFact(1);
    const baseReceipt = {
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      invocationId: "first",
      requestDigest: "digest",
      factIds: [first.id],
      committedFrontier: { [REPLICA_A]: 1 },
      lineage: null,
      inverse: [],
    } as const;
    const invalidReceipts: readonly (readonly AuthorityReceipt[])[] = [
      [{ ...baseReceipt, committedFrontier: { [REPLICA_A]: 1, [REPLICA_B]: 999 } }],
      [{ ...baseReceipt, factIds: [], committedFrontier: {} }],
      [
        {
          ...baseReceipt,
          factIds: [first.id, factId("workspace", REPLICA_A, 3)],
          committedFrontier: { [REPLICA_A]: 3 },
        },
      ],
      [
        {
          ...baseReceipt,
          lineage: {
            channelId: "desktop",
            ordinal: 2,
            parentStepId: "missing",
            operation: "normal",
            targetStepId: null,
          },
        },
      ],
      [baseReceipt, { ...baseReceipt, invocationId: "overlap", requestDigest: "another-digest" }],
    ];
    for (const receipts of invalidReceipts) {
      expect(() => validateReceipts("workspace", receipts, [first])).toThrow();
    }
    expect(() => validateReceipts("workspace", [baseReceipt], [])).toThrow("missing Fact");
  });

  it("canonical request bytes and Fact identities are deterministic", () => {
    expect(canonicalJson({ z: 1, a: { y: true, x: false } })).toBe('{"a":{"x":false,"y":true},"z":1}');
    expect(canonicalDigest({ b: 2, a: 1 })).toBe(canonicalDigest({ a: 1, b: 2 }));
    expect(factId("workspace", REPLICA_A, 7)).toBe(`g1/workspace/${REPLICA_A}/7`);
  });

  it("decodes the exact authority body and provenance identities at the Fact boundary", () => {
    const body = {
      kind: "edit",
      actorId: "actor",
      intent: "direct",
      actions: [{ kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null }],
    };
    expect(parseFactBody(body)).toEqual(body);
    expect(() => parseFactBody({ ...body, workspaceId: "workspace" })).toThrow("unknown field");
    expect(() =>
      parseFactBody({
        kind: "resolution",
        actorId: "reviewer",
        decision: "accept",
        proposalFactIds: ["g1/workspace/101/1"],
        adjudicatesResolutionIds: ["not-a-fact-id"],
      }),
    ).toThrow("Fact identity");
    expect(() =>
      parseFactBody({
        ...body,
        actions: [
          {
            kind: "rich-text-splice",
            nodeId: "node",
            deleteAtomIds: ["arbitrary#0"],
            anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            insert: "",
          },
        ],
      }),
    ).toThrow("Atom identity is invalid");
  });
});
