import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../admission/index.js";
import {
  canonicalDigest,
  canonicalJson,
  factId,
  makeFact,
  requestDigest,
  unsignedFact,
  type AuthorityRecord,
  type Fact,
} from "./index.js";

const REPLICA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const REPLICA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";

function contribution(sequence: number, overrides: Partial<Parameters<typeof makeFact>[0]> = {}) {
  return makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA_A,
    sequence,
    observed: sequence === 1 ? {} : { [REPLICA_A]: sequence - 1 },
    lamport: sequence,
    body: {
      kind: "contribution",
      actorId: "actor",
      intent: "proposal",
      mutation: { kind: "node-create", nodeId: `node-${sequence}` },
    },
    ...overrides,
  });
}

describe("production Fact contracts", () => {
  it("AUTH-1 facts are the only domain authority", () => {
    const fact = contribution(1);
    const receipt = {
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      invocationId: "invocation",
      requestDigest: requestDigest({ command: "create" }),
      factIds: [fact.id],
      committedFrontier: { [REPLICA_A]: 1 },
      lineage: null,
    } as const;
    const admission = admitAuthorityRecords("workspace", [
      { recordKind: "fact", fact },
      { recordKind: "receipt", receipt },
    ]);

    expect(admission.snapshot).toEqual({
      facts: [fact],
      frontier: { [REPLICA_A]: 1 },
    });
    expect(admission.snapshot).not.toHaveProperty("receipt");
    expect(admission.snapshot).not.toHaveProperty("projection");
  });

  it("AUTH-3 contribution intent and attribution remain immutable", () => {
    const proposal = contribution(1);
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
        proposalContributionIds: [proposal.id],
      },
    });
    const admission = admitAuthorityRecords("workspace", [
      { recordKind: "fact", fact: proposal },
      { recordKind: "fact", fact: resolution },
    ]);

    expect(admission.kind).toBe("ready");
    expect(admission.snapshot.facts[0]?.body).toEqual(proposal.body);
    expect(admission.snapshot.facts[0]?.body).toMatchObject({
      intent: "proposal",
      actorId: "actor",
    });
  });

  it("VER-1 unsupported format schema rules and checkpoints fail closed", () => {
    const supported = contribution(1);
    const unsupported = { ...supported, schemaVersion: 2 } as unknown as Fact;
    const admission = admitAuthorityRecords("workspace", [
      { recordKind: "fact", fact: unsupported },
    ]);

    expect(admission.kind).toBe("fault");
    expect(admission.fault).toContain("Unsupported Fact version");
  });

  it("untrusted authority JSON rejects unknown variants enums and malformed receipts", () => {
    const base = contribution(1);
    const bodies: unknown[] = [
      {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "totally-unknown" },
      },
      {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: {
          kind: "value-set",
          owner: { kind: "bogus", id: "owner" },
          namespace: "bogus",
          key: "key",
          value: true,
          previous: { kind: "unset" },
        },
      },
      {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          deletedAtoms: [],
          anchor: { after: null, before: null, affinity: "sideways", fallback: "middle" },
          insert: "x",
        },
      },
    ];
    for (const body of bodies) {
      const unsigned = { ...unsignedFact(base), body };
      const fact = { ...unsigned, contentDigest: canonicalDigest(unsigned) };
      expect(admitAuthorityRecords("workspace", [{ recordKind: "fact", fact }]).kind).toBe("fault");
    }

    expect(
      admitAuthorityRecords("workspace", [
        {
          recordKind: "receipt",
          receipt: {
            workspaceId: "workspace",
            replicaId: REPLICA_A,
            invocationId: "invocation",
            requestDigest: "digest",
            factIds: [7],
            committedFrontier: { [REPLICA_A]: "future" },
            lineage: { operation: "maybe" },
          },
        },
      ]).kind,
    ).toBe("fault");
  });

  it("closed schemas reject forward fields forged text evidence and invalid numeric ledgers", () => {
    const base = contribution(1);
    const forwardUnsigned = {
      ...unsignedFact(base),
      body: {
        ...base.body,
        futureSemantic: true,
      },
    };
    const forward = {
      ...forwardUnsigned,
      contentDigest: canonicalDigest(forwardUnsigned),
    };
    expect(admitAuthorityRecords("workspace", [{ recordKind: "fact", fact: forward }]).kind).toBe(
      "fault",
    );

    const forgedUnsigned = {
      ...unsignedFact(base),
      body: {
        kind: "contribution" as const,
        actorId: "actor",
        intent: "direct" as const,
        mutation: {
          kind: "text-splice" as const,
          nodeId: "node",
          deleteAtomIds: ["atom-a"],
          deletedAtoms: [{ id: "atom-b", value: "forged", attributes: {} }],
          anchor: {
            after: null,
            before: null,
            affinity: "after" as const,
            fallback: "end" as const,
          },
          insert: "",
        },
      },
    };
    const forged = { ...forgedUnsigned, contentDigest: canonicalDigest(forgedUnsigned) };
    expect(admitAuthorityRecords("workspace", [{ recordKind: "fact", fact: forged }]).kind).toBe(
      "fault",
    );

    expect(
      admitAuthorityRecords("workspace", [
        {
          recordKind: "receipt",
          receipt: {
            workspaceId: "workspace",
            replicaId: REPLICA_A,
            invocationId: "bad-number",
            requestDigest: "digest",
            factIds: [],
            committedFrontier: { [REPLICA_A]: Number.NaN },
            lineage: null,
          },
        },
      ]).kind,
    ).toBe("fault");
  });

  it("Admission validates semantic evidence against the observed projection", () => {
    const node = contribution(1, {
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "node" },
      },
    });
    const inserted = contribution(2, {
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          deletedAtoms: [],
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          insert: "A",
        },
      },
    });
    const invalidMark = contribution(3, {
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: {
          kind: "text-mark",
          nodeId: "node",
          atomIds: [`${inserted.id}#999`],
          key: "bold",
          value: { kind: "set", value: true },
          previous: { kind: "unset" },
        },
      },
    });
    expect(
      admitAuthorityRecords("workspace", [
        { recordKind: "fact", fact: node },
        { recordKind: "fact", fact: inserted },
        { recordKind: "fact", fact: invalidMark },
      ]).kind,
    ).toBe("fault");
  });

  it("receipt batches and History lineage are exact non-empty authority ledger units", () => {
    const first = contribution(1);
    const baseReceipt = {
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      invocationId: "first",
      requestDigest: "digest",
      factIds: [first.id],
      committedFrontier: { [REPLICA_A]: 1 },
      lineage: null,
    } as const;
    const factRecord = { recordKind: "fact", fact: first } as const;
    expect(
      admitAuthorityRecords("workspace", [
        factRecord,
        {
          recordKind: "receipt",
          receipt: {
            ...baseReceipt,
            committedFrontier: { [REPLICA_A]: 1, [REPLICA_B]: 999 },
          },
        },
      ]).kind,
    ).toBe("fault");
    expect(
      admitAuthorityRecords("workspace", [
        {
          recordKind: "receipt",
          receipt: { ...baseReceipt, factIds: [], committedFrontier: {} },
        },
      ]).kind,
    ).toBe("fault");
    expect(
      admitAuthorityRecords("workspace", [
        {
          recordKind: "receipt",
          receipt: {
            ...baseReceipt,
            factIds: [first.id, factId("workspace", REPLICA_A, 3)],
            committedFrontier: { [REPLICA_A]: 3 },
          },
        },
      ]).kind,
    ).toBe("fault");
    expect(
      admitAuthorityRecords("workspace", [
        factRecord,
        {
          recordKind: "receipt",
          receipt: {
            ...baseReceipt,
            lineage: {
              channelId: "desktop",
              ordinal: 2,
              parentStepId: "missing",
              operation: "normal",
              targetStepId: null,
            },
          },
        },
      ]).kind,
    ).toBe("fault");
    expect(
      admitAuthorityRecords("workspace", [
        factRecord,
        { recordKind: "receipt", receipt: baseReceipt },
        {
          recordKind: "receipt",
          receipt: {
            ...baseReceipt,
            invocationId: "overlap",
            requestDigest: "another-digest",
          },
        },
      ]).kind,
    ).toBe("fault");
  });

  it("canonical request bytes and Fact identities are deterministic", () => {
    expect(canonicalJson({ z: 1, a: { y: true, x: false } })).toBe(
      '{"a":{"x":false,"y":true},"z":1}',
    );
    expect(canonicalDigest({ b: 2, a: 1 })).toBe(canonicalDigest({ a: 1, b: 2 }));
    expect(factId("workspace", REPLICA_A, 7)).toBe(`g1/workspace/${REPLICA_A}/7`);
  });

  it("duplicate records are idempotent and conflicting content faults", () => {
    const original = contribution(1);
    const duplicate: AuthorityRecord = { recordKind: "fact", fact: original };
    expect(admitAuthorityRecords("workspace", [duplicate, duplicate]).snapshot.facts).toEqual([
      original,
    ]);

    const alteredUnsigned = {
      ...unsignedFact(original),
      body: {
        kind: "contribution" as const,
        actorId: "actor",
        intent: "proposal" as const,
        mutation: { kind: "node-create" as const, nodeId: "different" },
      },
    };
    const altered = { ...alteredUnsigned, contentDigest: canonicalDigest(alteredUnsigned) };
    const conflicted = admitAuthorityRecords("workspace", [
      duplicate,
      { recordKind: "fact", fact: altered },
    ]);
    expect(conflicted.kind).toBe("fault");
    expect(conflicted.fault).toContain("FactId content conflict");
  });

  it("causal references require actual observation rather than lexical admission order", () => {
    const proposal = contribution(1);
    const unseenResolution = makeFact({
      workspaceId: "workspace",
      replicaId: "bbbbbbbbbbbbbbbbbbbbbbbbbb",
      sequence: 1,
      observed: {},
      lamport: 1,
      body: {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "reviewer",
        decision: "accept",
        proposalContributionIds: [proposal.id],
      },
    });
    expect(
      admitAuthorityRecords("workspace", [
        { recordKind: "fact", fact: proposal },
        { recordKind: "fact", fact: unseenResolution },
      ]).kind,
    ).toBe("fault");

    const invalidSecond = contribution(2, { observed: {}, lamport: 1 });
    expect(
      admitAuthorityRecords("workspace", [
        { recordKind: "fact", fact: proposal },
        { recordKind: "fact", fact: invalidSecond },
      ]).kind,
    ).toBe("fault");
  });
});
