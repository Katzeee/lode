import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";

import {
  advance,
  checkpoint,
  LoroFactStoreSpike,
  makeContribution,
  materializeWithLoro,
  rebuild,
  type ContributionFact,
  type FactFrontier,
  type InvocationReceipt,
  type Mutation,
  type SequenceAnchor,
} from "./fact-model.js";

const end: SequenceAnchor = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
};

function receipt(
  replicaId: string,
  invocationId: string,
  facts: readonly ContributionFact[],
  committedFrontier: FactFrontier,
): InvocationReceipt {
  return { replicaId, invocationId, factIds: facts.map((fact) => fact.id), committedFrontier };
}

function fact(input: {
  replicaId: string;
  sequence: number;
  observed?: FactFrontier;
  lamport?: number;
  mutation: Mutation;
}): ContributionFact {
  return makeContribution({
    ...input,
    observed: input.observed ?? {},
    lamport: input.lamport ?? 1,
  });
}

describe("append-only Loro authority records", () => {
  it("demonstrates why a LoroMap keyed only by FactId cannot expose an identity conflict", () => {
    const left = new LoroDoc();
    left.setPeerId("901");
    left.getMap("facts").set("g1/device-a/1", "body-a");
    left.commit();
    const right = new LoroDoc();
    right.setPeerId("902");
    right.getMap("facts").set("g1/device-a/1", "body-b");
    right.commit();

    left.import(right.export({ mode: "update" }));
    right.import(left.export({ mode: "update" }));

    expect(left.getMap("facts").toJSON()).toEqual(right.getMap("facts").toJSON());
    expect(Object.keys(left.getMap("facts").toJSON() as Record<string, unknown>)).toEqual([
      "g1/device-a/1",
    ]);
  });

  it("keeps both concurrent bodies visible and fails closed on a FactId conflict", () => {
    const left = new LoroFactStoreSpike("1");
    const right = new LoroFactStoreSpike("2");
    const a = fact({
      replicaId: "device-a",
      sequence: 1,
      mutation: { kind: "node-create", nodeId: "a" },
    });
    const corruptTwin = fact({
      replicaId: "device-a",
      sequence: 1,
      mutation: { kind: "node-create", nodeId: "b" },
    });
    left.appendAuthorityCommit([a], receipt("device-a", "one", [a], { "device-a": 1 }));
    right.appendAuthorityCommit(
      [corruptTwin],
      receipt("device-a", "two", [corruptTwin], { "device-a": 1 }),
    );

    left.importAll(right.doc);
    right.importAll(left.doc);

    expect(() => left.snapshot()).toThrow("FactId content conflict");
    expect(() => right.snapshot()).toThrow("FactId content conflict");
  });

  it("deduplicates equal logical facts without relying on Loro list order", () => {
    const left = new LoroFactStoreSpike("11");
    const right = new LoroFactStoreSpike("12");
    const shared = fact({
      replicaId: "device-a",
      sequence: 1,
      mutation: { kind: "node-create", nodeId: "a" },
    });
    left.appendAuthorityCommit([shared], receipt("device-a", "one", [shared], { "device-a": 1 }));
    right.appendAuthorityCommit([shared], receipt("device-a", "one", [shared], { "device-a": 1 }));

    left.importAll(right.doc);
    expect(left.snapshot().facts).toEqual([shared]);
  });

  it("separates the logical FactFrontier from Loro physical version changes caused by receipts", () => {
    const store = new LoroFactStoreSpike("21");
    const created = fact({
      replicaId: "device-a",
      sequence: 1,
      mutation: { kind: "node-create", nodeId: "a" },
    });
    store.appendAuthorityCommit(
      [created],
      receipt("device-a", "one", [created], { "device-a": 1 }),
    );
    const beforePhysical = store.doc.opCount();
    const beforeFrontiers = store.doc.oplogFrontiers();

    store.appendReceiptOnly(receipt("device-a", "retry-only", [], { "device-a": 1 }));

    expect(store.doc.opCount()).toBeGreaterThan(beforePhysical);
    expect(store.doc.oplogFrontiers()).not.toEqual(beforeFrontiers);
    expect(store.snapshot().frontier).toEqual({ "device-a": 1 });
  });
});

describe("causal identity and deterministic owner replay", () => {
  it("uses a Loro cursor only inside one projection history, not as a durable Fact coordinate", () => {
    const live = new LoroDoc();
    live.setPeerId("100");
    live.getText("text").insert(0, "abc");
    live.commit();
    const cursor = live.getText("text").getCursor(1, 0);
    expect(cursor).toBeDefined();

    const concurrent = live.fork();
    concurrent.setPeerId("200");
    concurrent.getText("text").insert(0, "X");
    concurrent.commit();
    live.import(concurrent.export({ mode: "update" }));

    expect(live.getCursorPos(cursor!)?.offset).toBe(2);

    const rebuilt = new LoroDoc();
    rebuilt.setPeerId("300");
    rebuilt.getText("text").insert(0, "Xabc");
    rebuilt.commit();
    expect(rebuilt.getCursorPos(cursor!)).toBeUndefined();
  });

  it("orders causal facts before descendants and concurrent facts by a neutral replica tie-break", () => {
    const root = fact({
      replicaId: "a",
      sequence: 1,
      mutation: { kind: "node-create", nodeId: "root" },
    });
    const left = fact({
      replicaId: "a",
      sequence: 2,
      observed: { a: 1 },
      lamport: 2,
      mutation: { kind: "node-create", nodeId: "left" },
    });
    const right = fact({
      replicaId: "b",
      sequence: 1,
      observed: { a: 1 },
      lamport: 2,
      mutation: { kind: "node-create", nodeId: "right" },
    });
    const store = new LoroFactStoreSpike("31");
    store.appendAuthorityCommit(
      [right, left, root],
      receipt("a", "batch", [right, left, root], { a: 2, b: 1 }),
    );

    expect(store.snapshot().facts.map(({ id }) => id)).toEqual([root.id, left.id, right.id]);
  });

  it("uses stable atom identities so concurrent insertion does not expand an observed deletion", () => {
    const create = fact({
      replicaId: "a",
      sequence: 1,
      mutation: { kind: "node-create", nodeId: "n" },
    });
    const initial = fact({
      replicaId: "a",
      sequence: 2,
      observed: { a: 1 },
      lamport: 2,
      mutation: { kind: "text-splice", nodeId: "n", deleteAtomIds: [], anchor: end, insert: "abc" },
    });
    const insert = fact({
      replicaId: "b",
      sequence: 1,
      observed: { a: 2 },
      lamport: 3,
      mutation: {
        kind: "text-splice",
        nodeId: "n",
        deleteAtomIds: [],
        anchor: {
          after: `${initial.id}#0`,
          before: `${initial.id}#1`,
          affinity: "after",
          fallback: "end",
        },
        insert: "X",
      },
    });
    const removeObservedB = fact({
      replicaId: "c",
      sequence: 1,
      observed: { a: 2 },
      lamport: 3,
      mutation: {
        kind: "text-splice",
        nodeId: "n",
        deleteAtomIds: [`${initial.id}#1`],
        anchor: {
          after: `${initial.id}#0`,
          before: `${initial.id}#2`,
          affinity: "after",
          fallback: "end",
        },
        insert: "",
      },
    });

    const projection = rebuild([removeObservedB, insert, initial, create]);
    expect(projection.text.n?.map(({ value }) => value).join("")).toBe("aXc");
  });

  it("replays structural anchors deterministically and rejects a concurrent cycle", () => {
    const facts = [
      fact({ replicaId: "a", sequence: 1, mutation: { kind: "node-create", nodeId: "n1" } }),
      fact({
        replicaId: "a",
        sequence: 2,
        observed: { a: 1 },
        lamport: 2,
        mutation: {
          kind: "occurrence-create",
          occurrenceId: "one",
          nodeId: "n1",
          parentOccurrenceId: null,
          anchor: end,
        },
      }),
      fact({
        replicaId: "b",
        sequence: 1,
        observed: { a: 2 },
        lamport: 3,
        mutation: { kind: "node-create", nodeId: "n2" },
      }),
      fact({
        replicaId: "b",
        sequence: 2,
        observed: { a: 2, b: 1 },
        lamport: 4,
        mutation: {
          kind: "occurrence-create",
          occurrenceId: "two",
          nodeId: "n2",
          parentOccurrenceId: "one",
          anchor: end,
        },
      }),
      fact({
        replicaId: "c",
        sequence: 1,
        observed: { a: 2, b: 2 },
        lamport: 5,
        mutation: {
          kind: "occurrence-move",
          occurrenceId: "one",
          parentOccurrenceId: "two",
          anchor: end,
        },
      }),
    ];

    const projection = rebuild(facts.reverse());
    expect(projection.occurrences.one?.parentOccurrenceId).toBeNull();
    expect(projection.children.one).toEqual(["two"]);
  });

  it("makes checkpoint plus tail equal a full rebuild even when a new concurrent fact interleaves", () => {
    const create = fact({
      replicaId: "a",
      sequence: 1,
      mutation: { kind: "node-create", nodeId: "n" },
    });
    const baseText = fact({
      replicaId: "b",
      sequence: 1,
      observed: { a: 1 },
      lamport: 2,
      mutation: { kind: "text-splice", nodeId: "n", deleteAtomIds: [], anchor: end, insert: "B" },
    });
    const concurrentEarlierByTieBreak = fact({
      replicaId: "a",
      sequence: 2,
      observed: { a: 1 },
      lamport: 2,
      mutation: { kind: "text-splice", nodeId: "n", deleteAtomIds: [], anchor: end, insert: "A" },
    });
    const baseStore = new LoroFactStoreSpike("41");
    baseStore.appendAuthorityCommit(
      [create, baseText],
      receipt("b", "base", [create, baseText], { a: 1, b: 1 }),
    );
    const baseCheckpoint = checkpoint(baseStore.snapshot());

    const mergedStore = new LoroFactStoreSpike("42");
    mergedStore.appendAuthorityCommit(
      [create, baseText, concurrentEarlierByTieBreak],
      receipt("a", "merged", [create, baseText, concurrentEarlierByTieBreak], { a: 2, b: 1 }),
    );
    const next = mergedStore.snapshot();

    expect(advance(baseCheckpoint, next).projection).toEqual(rebuild(next.facts));
    expect(
      advance(baseCheckpoint, next)
        .projection.text.n?.map(({ value }) => value)
        .join(""),
    ).toBe("AB");
  });

  it("materializes the same rich text, tree, and map projection through real Loro containers", () => {
    const createNode = fact({
      replicaId: "a",
      sequence: 1,
      mutation: { kind: "node-create", nodeId: "n" },
    });
    const insert = fact({
      replicaId: "a",
      sequence: 2,
      observed: { a: 1 },
      lamport: 2,
      mutation: {
        kind: "text-splice",
        nodeId: "n",
        deleteAtomIds: [],
        anchor: end,
        insert: "Hi",
        attributes: { bold: true },
      },
    });
    const createOccurrence = fact({
      replicaId: "a",
      sequence: 3,
      observed: { a: 2 },
      lamport: 3,
      mutation: {
        kind: "occurrence-create",
        occurrenceId: "o",
        nodeId: "n",
        parentOccurrenceId: null,
        anchor: end,
      },
    });
    const property = fact({
      replicaId: "a",
      sequence: 4,
      observed: { a: 3 },
      lamport: 4,
      mutation: {
        kind: "value-set",
        owner: { kind: "node", id: "n" },
        namespace: "property",
        key: "status",
        value: "open",
      },
    });

    const json = materializeWithLoro(
      rebuild([property, createOccurrence, insert, createNode]),
    ) as Record<string, unknown>;
    expect(json["text:n"]).toBe("Hi");
    expect(json.values).toEqual({ "node/n/property/status": "open" });
    expect(JSON.stringify(json.occurrences)).toContain('"occurrenceId":"o"');
  });
});
