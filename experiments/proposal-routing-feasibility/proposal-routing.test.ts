import { describe, expect, it } from "vitest";
import { LoroDoc, type Delta as LoroDelta } from "loro-crdt";
import {
  Engine,
  deltaToText,
  toJSON,
  type DocSnapshot,
} from "../../packages/engine/src/core/index.js";
import { getSemanticChildren } from "../../packages/engine/src/domain/node/node.js";

const PROPOSAL_ATTRIBUTE = "proposal";

function proposalTextDoc(initial: string): { doc: LoroDoc; text: ReturnType<LoroDoc["getText"]> } {
  const doc = new LoroDoc();
  doc.configTextStyle({ [PROPOSAL_ATTRIBUTE]: { expand: "none" } });
  const text = doc.getText("content");
  text.insert(0, initial);
  return { doc, text };
}

function cloneDoc(source: LoroDoc): LoroDoc {
  const clone = new LoroDoc();
  clone.import(source.export({ mode: "snapshot" }));
  return clone;
}

function cloneProposalDoc(source: LoroDoc): LoroDoc {
  const clone = cloneDoc(source);
  clone.configTextStyle({ [PROPOSAL_ATTRIBUTE]: { expand: "none" } });
  return clone;
}

function syncDocs(left: LoroDoc, right: LoroDoc): void {
  const leftVersion = left.version();
  const rightVersion = right.version();
  left.import(right.export({ mode: "update", from: leftVersion }));
  right.import(left.export({ mode: "update", from: rightVersion }));
}

function originFromAttributedDelta(delta: LoroDelta<string>[]): string {
  return delta
    .filter(
      (span) =>
        typeof span.insert === "string" && span.attributes?.[PROPOSAL_ATTRIBUTE] === undefined,
    )
    .map((span) => span.insert ?? "")
    .join("");
}

function proposalRanges(delta: LoroDelta<string>[], proposalId: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  for (const span of delta) {
    const inserted = typeof span.insert === "string" ? span.insert : "";
    const end = offset + inserted.length;
    if (span.attributes?.[PROPOSAL_ATTRIBUTE] === proposalId) ranges.push([offset, end]);
    offset = end;
  }
  return ranges;
}

function rejectAttributedText(doc: LoroDoc, proposalId: string): void {
  const text = doc.getText("content");
  const ranges = proposalRanges(text.toDelta(), proposalId);
  for (const [start, end] of ranges.reverse()) text.delete(start, end - start);
}

describe("same-document mechanics on real Loro rich text", () => {
  it("Proposal attributes preserve current intent but not whether Direct text pre-existed or interleaved later", () => {
    const preExisting = proposalTextDoc("年度");
    preExisting.text.insert(0, "日");
    preExisting.text.mark({ start: 0, end: 1 }, PROPOSAL_ATTRIBUTE, "p1");
    preExisting.text.insert(3, "本");
    preExisting.text.mark({ start: 3, end: 4 }, PROPOSAL_ATTRIBUTE, "p1");

    const interleaved = proposalTextDoc("");
    interleaved.text.insert(0, "日本");
    interleaved.text.mark({ start: 0, end: 2 }, PROPOSAL_ATTRIBUTE, "p1");
    interleaved.text.insert(1, "年度");

    // Loro formatting inheritance alone misattributes an insertion made inside a Proposal span.
    expect(interleaved.text.toDelta()).toEqual([
      { insert: "日年度本", attributes: { proposal: "p1" } },
    ]);

    // A Direct editor must explicitly clear Proposal attribution on its inserted range.
    interleaved.text.unmark({ start: 1, end: 3 }, PROPOSAL_ATTRIBUTE);

    expect(preExisting.text.toString()).toBe("日年度本");
    expect(interleaved.text.toString()).toBe("日年度本");
    expect(originFromAttributedDelta(preExisting.text.toDelta())).toBe("年度");
    expect(originFromAttributedDelta(interleaved.text.toDelta())).toBe("年度");
    expect(preExisting.text.toDelta()).toEqual([
      { insert: "日", attributes: { proposal: "p1" } },
      { insert: "年度" },
      { insert: "本", attributes: { proposal: "p1" } },
    ]);
    expect(interleaved.text.toDelta()).toEqual(preExisting.text.toDelta());
  });

  it("Reject deletes captured Proposal characters but preserves Direct interleaving and a concurrent later Proposal", () => {
    const seeded = proposalTextDoc("");
    seeded.text.insert(0, "日本");
    seeded.text.mark({ start: 0, end: 2 }, PROPOSAL_ATTRIBUTE, "p1");
    seeded.text.insert(1, "年度");
    seeded.text.unmark({ start: 1, end: 3 }, PROPOSAL_ATTRIBUTE);
    seeded.doc.commit();

    // Text style configuration is replica-local Loro configuration, not synchronized document data.
    const rejectingReplica = cloneProposalDoc(seeded.doc);
    const concurrentReplica = cloneProposalDoc(seeded.doc);

    rejectAttributedText(rejectingReplica, "p1");
    const concurrentText = concurrentReplica.getText("content");
    concurrentText.insert(4, "!");
    concurrentText.mark({ start: 4, end: 5 }, PROPOSAL_ATTRIBUTE, "p2");

    syncDocs(rejectingReplica, concurrentReplica);

    for (const replica of [rejectingReplica, concurrentReplica]) {
      expect(replica.getText("content").toString()).toBe("年度!");
      expect(replica.getText("content").toDelta()).toEqual([
        { insert: "年度" },
        { insert: "!", attributes: { proposal: "p2" } },
      ]);
    }
  });
});

describe("overlay mechanics on real Loro documents", () => {
  it("a forked overlay merges accepted-base drift and its update can be imported idempotently", () => {
    const accepted = proposalTextDoc("年度");
    accepted.doc.commit();
    const overlay = accepted.doc.fork();
    overlay.configTextStyle({ [PROPOSAL_ATTRIBUTE]: { expand: "none" } });

    const overlayText = overlay.getText("content");
    overlayText.insert(0, "日");
    overlayText.mark({ start: 0, end: 1 }, PROPOSAL_ATTRIBUTE, "p1");
    overlayText.insert(3, "本");
    overlayText.mark({ start: 3, end: 4 }, PROPOSAL_ATTRIBUTE, "p1");
    overlay.commit();

    accepted.text.insert(2, "!");
    accepted.doc.commit();
    overlay.import(accepted.doc.export({ mode: "update", from: overlay.version() }));

    expect(accepted.text.toString()).toBe("年度!");
    // The concurrent Direct insertion follows ordinary Loro ordering; Proposal does not override it.
    // Random replica peer ids may place the concurrent "!" on either side of "本".
    const mergedReview = overlay.getText("content").toString();
    expect(["日年度!本", "日年度本!"]).toContain(mergedReview);

    const proposalUpdate = overlay.export({ mode: "update", from: accepted.doc.version() });
    accepted.doc.import(proposalUpdate);
    accepted.doc.import(proposalUpdate);

    expect(accepted.text.toString()).toBe(mergedReview);
  });

  it("raw overlay updates cannot implement partial Accept; selected contributions need semantic materialization", () => {
    const accepted = proposalTextDoc("年度");
    accepted.doc.commit();
    const overlay = accepted.doc.fork();
    overlay.configTextStyle({ [PROPOSAL_ATTRIBUTE]: { expand: "none" } });
    const overlayText = overlay.getText("content");
    overlayText.insert(0, "日");
    overlayText.mark({ start: 0, end: 1 }, PROPOSAL_ATTRIBUTE, "p1");
    overlayText.insert(3, "本");
    overlayText.mark({ start: 3, end: 4 }, PROPOSAL_ATTRIBUTE, "p2");
    overlay.commit();

    const naivePartialAccept = cloneProposalDoc(accepted.doc);
    naivePartialAccept.import(
      overlay.export({ mode: "update", from: naivePartialAccept.version() }),
    );

    // Importing the overlay's CRDT update accepts both contributions; Loro update bytes are not a
    // product-level "accept p1 only" patch.
    expect(naivePartialAccept.getText("content").toString()).toBe("日年度本");

    const semanticallyMaterialized = cloneProposalDoc(accepted.doc);
    const text = semanticallyMaterialized.getText("content");
    text.insert(0, "日");
    semanticallyMaterialized.getMap("materializations").set("accept:p1", true);
    semanticallyMaterialized.commit();

    expect(text.toString()).toBe("日年度");
    expect(overlayText.toString()).toBe("日年度本");
    expect(proposalRanges(overlayText.toDelta(), "p2")).toEqual([[3, 4]]);
  });

  it("cross-document Accept recovers from a crash using a durable resolution and idempotency fact", () => {
    const accepted = proposalTextDoc("年度");
    const overlay = new LoroDoc();
    const resolutions = overlay.getMap("resolutions");
    resolutions.set("p1", "accepted");
    overlay.commit();

    // Crash boundary: resolution is durable, accepted content is still untouched.
    const restartedAccepted = cloneDoc(accepted.doc);
    const restartedOverlay = cloneDoc(overlay);
    expect(restartedAccepted.getText("content").toString()).toBe("年度");
    expect(restartedOverlay.getMap("resolutions").get("p1")).toBe("accepted");

    const materializations = restartedAccepted.getMap("materializations");
    const materialize = (): void => {
      if (materializations.get("accept:p1") === true) return;
      const text = restartedAccepted.getText("content");
      text.insert(0, "日");
      text.insert(text.length, "本");
      materializations.set("accept:p1", true);
      restartedAccepted.commit();
    };

    materialize();
    materialize();

    expect(restartedAccepted.getText("content").toString()).toBe("日年度本");
    expect(materializations.get("accept:p1")).toBe(true);
  });
});

type StableIds = {
  root: string;
  parentA: string;
  parentB: string;
  sharedA: string;
  sharedB: string;
  child: string;
};

async function seedEngine(): Promise<{ engine: Engine; ids: StableIds }> {
  const engine = new Engine();
  const root = await engine.createNode(null, undefined, undefined, "n-root", "o-root");
  const parentA = await engine.createNode(
    root.occurrenceId,
    undefined,
    undefined,
    "n-parent-a",
    "o-parent-a",
  );
  const parentB = await engine.createNode(
    root.occurrenceId,
    undefined,
    undefined,
    "n-parent-b",
    "o-parent-b",
  );
  const sharedA = await engine.createNode(
    parentA.occurrenceId,
    undefined,
    undefined,
    "n-shared",
    "o-shared-a",
  );
  const sharedB = await engine.createOccurrence(
    sharedA.nodeId,
    parentB.occurrenceId,
    undefined,
    "o-shared-b",
  );
  const child = await engine.createNode(
    sharedA.occurrenceId,
    undefined,
    undefined,
    "n-child",
    "o-child",
  );
  await engine.replaceDeltas(root.occurrenceId, [{ insert: "Workspace" }]);
  await engine.replaceDeltas(parentA.occurrenceId, [{ insert: "Parent A" }]);
  await engine.replaceDeltas(parentB.occurrenceId, [{ insert: "Parent B" }]);
  await engine.replaceDeltas(sharedA.occurrenceId, [{ insert: "年度" }]);
  await engine.replaceDeltas(child.occurrenceId, [{ insert: "shared child" }]);
  await engine.setProp(sharedA.occurrenceId, "color", "blue");
  return {
    engine,
    ids: {
      root: root.occurrenceId,
      parentA: parentA.occurrenceId,
      parentB: parentB.occurrenceId,
      sharedA: sharedA.occurrenceId,
      sharedB: sharedB.occurrenceId,
      child: child.occurrenceId,
    },
  };
}

function normalizeSnapshot(snapshot: DocSnapshot): unknown {
  const occurrenceByLiveId = new Map(snapshot.occurrences.map((item) => [item.occurrenceId, item]));
  const stableOccurrenceId = (liveId: string | null): string | null =>
    liveId === null ? null : (occurrenceByLiveId.get(liveId)?.occId ?? liveId);
  return {
    entities: snapshot.entities
      .map((item) => ({
        nodeId: item.nodeId,
        canonicalOccId: stableOccurrenceId(item.canonicalOccurrenceId),
        text: deltaToText(item.deltas),
        props: item.props,
      }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    occurrences: snapshot.occurrences
      .map((item) => ({
        occId: item.occId,
        nodeId: item.nodeId,
        parentOccId: stableOccurrenceId(item.parentOccurrenceId),
      }))
      .sort((left, right) => left.occId.localeCompare(right.occId)),
  };
}

async function applyFullTypeScript(engine: Engine, ids: StableIds): Promise<void> {
  const created = await engine.createNode(ids.parentA, undefined, undefined, "n-new", "o-new");
  await engine.replaceDeltas(created.occurrenceId, [{ insert: "Direct dependent content" }]);
  await engine.moveOccurrence(ids.sharedA, ids.parentB);
  await engine.removeOccurrence(ids.sharedB);
  await engine.setProp(ids.sharedA, "color", "green");
}

describe("typed domain replay on the real Engine", () => {
  it("replays create/edit/move/delete/property facts deterministically by stable domain identity", async () => {
    const left = await seedEngine();
    const right = await seedEngine();

    await applyFullTypeScript(left.engine, left.ids);
    await applyFullTypeScript(right.engine, right.ids);

    expect(normalizeSnapshot(await toJSON(left.engine))).toEqual(
      normalizeSnapshot(await toJSON(right.engine)),
    );
  });

  it("stores semantic children once under the canonical occurrence but exposes them from every ref", async () => {
    const { engine, ids } = await seedEngine();

    expect(
      (await engine.getOccurrenceChildren(ids.sharedA)).map((item) => deltaToText(item.deltas)),
    ).toEqual(["shared child"]);
    expect(await engine.getOccurrenceChildren(ids.sharedB)).toEqual([]);
    expect(
      (await getSemanticChildren(engine, ids.sharedA)).map((item) => deltaToText(item.deltas)),
    ).toEqual(["shared child"]);
    expect(
      (await getSemanticChildren(engine, ids.sharedB)).map((item) => deltaToText(item.deltas)),
    ).toEqual(["shared child"]);
  });

  it("shows why Same-doc Reject cannot replay a fixed inverse over later Direct state", async () => {
    const { engine, ids } = await seedEngine();

    await engine.setProp(ids.sharedA, "color", "green"); // Proposal: blue → green
    await engine.setProp(ids.sharedA, "color", "red"); // later Direct edit
    await engine.setProp(ids.sharedA, "color", "blue"); // naive stored inverse for Reject

    // The mechanically stored inverse destroys the later Direct value. A correct Reject must
    // Reconcile current facts with the Proposal excluded, which would retain red.
    expect(await engine.getProp(ids.sharedA, "color")).toBe("blue");
    expect(await engine.getProp(ids.sharedA, "color")).not.toBe("red");
  });
});
