import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DocStore, LoadedDocBytes } from "../../packages/engine/src/core/store/doc-store.js";
import { InMemoryDocStore } from "../../packages/engine/src/core/store/in-memory-doc-store.js";
import { WorkspaceStore } from "../../packages/engine/src/persistence/workspace-store.js";
import { WorkspaceDocStore } from "../../packages/engine/src/runtime/workspace/doc-store.js";
import {
  AuthorityFaultError,
  deriveSupportEdges,
  factRecord,
  InvocationConflictError,
  makeFact,
  ProjectionUnavailableError,
  receiptRecord,
  winningResolution,
  WorkspaceAuthoritySpike,
  type CommandRequest,
  type Fact,
  type FactBody,
  type InvocationReceipt,
} from "./admission-model.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function contribution(
  mutation: Extract<FactBody, { kind: "contribution" }>["mutation"],
  intent: "direct" | "proposal" = "direct",
): CommandRequest {
  return { body: { kind: "contribution", actorId: "actor", intent, mutation } };
}

function resolution(
  decision: "accept" | "reject",
  proposalContributionIds: readonly string[],
): CommandRequest {
  return { body: { kind: "resolution", actorId: "reviewer", decision, proposalContributionIds } };
}

function rawFact(input: {
  workspaceId?: string;
  replicaId: string;
  sequence: number;
  observed?: Readonly<Record<string, number>>;
  lamport?: number;
  body: FactBody;
}): Fact {
  return makeFact({
    workspaceId: input.workspaceId ?? "ws",
    replicaId: input.replicaId,
    sequence: input.sequence,
    observed: input.observed ?? {},
    lamport: input.lamport ?? 1,
    body: input.body,
  });
}

async function openMemory(replicaId = "a", peerId: `${number}` = "1") {
  return WorkspaceAuthoritySpike.open({
    workspaceId: "ws",
    replicaId,
    peerId,
    store: new InMemoryDocStore(),
  });
}

describe("durable record admission", () => {
  it("keeps a sequence gap pending, advances only the contiguous admitted frontier, and heals later", async () => {
    const authority = await openMemory();
    const second = rawFact({
      replicaId: "remote",
      sequence: 2,
      observed: { remote: 1 },
      lamport: 2,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "second" },
      },
    });
    await authority.appendTestRecords([factRecord(second)]);

    expect(authority.admission()).toMatchObject({
      kind: "pending",
      frontier: {},
      pendingFactIds: [second.id],
    });
    expect(authority.authorityAdvancedCount()).toBe(0);

    const first = rawFact({
      replicaId: "remote",
      sequence: 1,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "first" },
      },
    });
    await authority.appendTestRecords([factRecord(first)]);

    expect(authority.admission()).toMatchObject({
      kind: "ready",
      frontier: { remote: 2 },
      pendingFactIds: [],
    });
    expect(authority.authorityAdvancedCount()).toBe(1);
  });

  it("persists pending records and admitted receipts through the real SQLite WorkspaceStore", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lode-fact-admission-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "workspace.sqlite");
    let sqlite = await WorkspaceStore.open(filePath);
    let authority = await WorkspaceAuthoritySpike.open({
      workspaceId: "ws",
      replicaId: "local",
      peerId: "10",
      store: new WorkspaceDocStore(sqlite),
    });
    const request = contribution({ kind: "node-create", nodeId: "durable" });
    const receipt = await authority.commitCommand("create", request);
    await sqlite.close();

    sqlite = await WorkspaceStore.open(filePath);
    authority = await WorkspaceAuthoritySpike.open({
      workspaceId: "ws",
      replicaId: "local",
      peerId: "10",
      store: new WorkspaceDocStore(sqlite),
    });
    expect(authority.outcome("create")).toEqual(receipt);
    expect(authority.projection().nodeIds).toEqual(["durable"]);

    const gap = rawFact({
      replicaId: "remote",
      sequence: 2,
      observed: { remote: 1 },
      lamport: 2,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "pending" },
      },
    });
    await authority.appendTestRecords([factRecord(gap)]);
    await sqlite.close();

    sqlite = await WorkspaceStore.open(filePath);
    authority = await WorkspaceAuthoritySpike.open({
      workspaceId: "ws",
      replicaId: "local",
      peerId: "10",
      store: new WorkspaceDocStore(sqlite),
    });
    expect(authority.admission().pendingFactIds).toEqual([gap.id]);
    await sqlite.close();
  });

  it("does not adopt an in-memory authority commit when durable append fails", async () => {
    const store = new FailingDocStore();
    const authority = await WorkspaceAuthoritySpike.open({
      workspaceId: "ws",
      replicaId: "local",
      peerId: "11",
      store,
    });
    store.failNextAppend = true;

    await expect(
      authority.commitCommand("lost", contribution({ kind: "node-create", nodeId: "lost" })),
    ).rejects.toThrow("injected durable append failure");
    expect(authority.outcome("lost")).toBeNull();
    expect(authority.admission().frontier).toEqual({});
  });

  it("does not advance the logical frontier for a receipt-only physical update", async () => {
    const authority = await openMemory();
    const receipt: InvocationReceipt = {
      workspaceId: "ws",
      replicaId: "a",
      invocationId: "receipt-only",
      requestDigest: "known-request",
      factIds: [],
      committedFrontier: {},
    };
    await authority.appendTestRecords([receiptRecord(receipt)]);

    expect(authority.admission()).toMatchObject({ kind: "ready", frontier: {} });
    expect(authority.outcome("receipt-only")).toEqual(receipt);
    expect(authority.authorityAdvancedCount()).toBe(0);
  });

  it("fails the workspace closed on corrupt admitted input instead of silently discarding it", async () => {
    const authority = await openMemory();
    await authority.commitCommand("safe", contribution({ kind: "node-create", nodeId: "safe" }));
    authority.publishCurrent();
    const valid = rawFact({
      replicaId: "remote",
      sequence: 1,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "n" },
      },
    });
    const corrupt = { ...valid, contentDigest: "0".repeat(64) };
    await authority.appendTestRecords([factRecord(corrupt)]);

    expect(authority.admission()).toMatchObject({ kind: "fault" });
    expect(authority.admission().fault).toContain("Fact digest mismatch");
    expect(() => authority.projection()).toThrow(AuthorityFaultError);
    expect(authority.publishedView()).toEqual({ nodeIds: ["safe"], occurrenceIds: [] });
    await expect(
      authority.commitCommand("blocked", contribution({ kind: "node-create", nodeId: "x" })),
    ).rejects.toThrow(AuthorityFaultError);
  });
});

describe("command admission and invocation identity", () => {
  it("binds InvocationId to a canonical request and permits the exact retry during projection lag", async () => {
    const authority = await openMemory();
    const original = contribution({ kind: "node-create", nodeId: "one" });
    const receipt = await authority.commitCommand("same", original);

    await expect(authority.commitCommand("same", original)).resolves.toEqual(receipt);
    await expect(
      authority.commitCommand("same", contribution({ kind: "node-create", nodeId: "other" })),
    ).rejects.toThrow(InvocationConflictError);
    await expect(
      authority.commitCommand("new", contribution({ kind: "node-create", nodeId: "two" })),
    ).rejects.toThrow(ProjectionUnavailableError);

    authority.publishCurrent();
    await expect(
      authority.commitCommand("new", contribution({ kind: "node-create", nodeId: "two" })),
    ).resolves.toMatchObject({ invocationId: "new" });
  });

  it("names Facts by Workspace + Replica + sequence and rejects a foreign-workspace record", async () => {
    const left = rawFact({
      workspaceId: "left",
      replicaId: "replica",
      sequence: 1,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "n" },
      },
    });
    const right = rawFact({
      workspaceId: "right",
      replicaId: "replica",
      sequence: 1,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "n" },
      },
    });
    expect(left.id).not.toBe(right.id);

    const authority = await openMemory();
    await authority.appendTestRecords([factRecord(left)]);
    expect(authority.admission().fault).toContain("Foreign workspace Fact");
  });

  it("derives support from typed identities instead of trusting a stored dependency list", async () => {
    const authority = await openMemory();
    const createReceipt = await authority.commitCommand(
      "node",
      contribution({ kind: "node-create", nodeId: "n" }, "proposal"),
    );
    authority.publishCurrent();
    const occurrenceReceipt = await authority.commitCommand(
      "occurrence",
      contribution({ kind: "occurrence-create", occurrenceId: "o", nodeId: "n" }, "direct"),
    );
    const facts = authority.admission().facts;
    const occurrence = facts.find(({ id }) => id === occurrenceReceipt.factIds[0]);

    expect(occurrence).toBeDefined();
    expect("dependencies" in occurrence!.body).toBe(false);
    expect(deriveSupportEdges(facts).get(occurrenceReceipt.factIds[0]!)).toEqual([
      createReceipt.factIds[0],
    ]);
  });
});

describe("terminal Resolution arbitration", () => {
  it("chooses the maximum neutral causal order for concurrent decisions on each Contribution", async () => {
    const authority = await openMemory();
    const proposal = rawFact({
      replicaId: "a",
      sequence: 1,
      body: {
        kind: "contribution",
        actorId: "author",
        intent: "proposal",
        mutation: { kind: "node-create", nodeId: "n" },
      },
    });
    const accept = rawFact({
      replicaId: "b",
      sequence: 1,
      observed: { a: 1 },
      lamport: 2,
      body: {
        kind: "resolution",
        actorId: "left",
        decision: "accept",
        proposalContributionIds: [proposal.id],
      },
    });
    const reject = rawFact({
      replicaId: "c",
      sequence: 1,
      observed: { a: 1 },
      lamport: 2,
      body: {
        kind: "resolution",
        actorId: "right",
        decision: "reject",
        proposalContributionIds: [proposal.id],
      },
    });
    await authority.appendTestRecords([
      factRecord(reject),
      factRecord(proposal),
      factRecord(accept),
    ]);

    expect(winningResolution(authority.admission().facts, proposal.id)?.decision).toBe("reject");
  });

  it("treats a causally later second decision as invalid rather than a decision override", async () => {
    const authority = await openMemory();
    const proposal = rawFact({
      replicaId: "a",
      sequence: 1,
      body: {
        kind: "contribution",
        actorId: "author",
        intent: "proposal",
        mutation: { kind: "node-create", nodeId: "n" },
      },
    });
    const first = rawFact({
      replicaId: "b",
      sequence: 1,
      observed: { a: 1 },
      lamport: 2,
      body: {
        kind: "resolution",
        actorId: "reviewer",
        decision: "accept",
        proposalContributionIds: [proposal.id],
      },
    });
    const later = rawFact({
      replicaId: "b",
      sequence: 2,
      observed: { a: 1, b: 1 },
      lamport: 3,
      body: {
        kind: "resolution",
        actorId: "reviewer",
        decision: "reject",
        proposalContributionIds: [proposal.id],
      },
    });
    await authority.appendTestRecords([factRecord(proposal), factRecord(first), factRecord(later)]);

    expect(authority.admission().kind).toBe("fault");
    expect(authority.admission().fault).toContain("observes a terminal decision");
  });
});

describe("stable-identity lifecycle compensation", () => {
  it("keeps late offline Occurrences suppressed by a global delete and restores the same identities explicitly", async () => {
    const authority = await openMemory();
    const node = rawFact({
      replicaId: "a",
      sequence: 1,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "n" },
      },
    });
    const firstOccurrence = rawFact({
      replicaId: "b",
      sequence: 1,
      observed: { a: 1 },
      lamport: 2,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "occurrence-create", occurrenceId: "o1", nodeId: "n" },
      },
    });
    const deletion = rawFact({
      replicaId: "a",
      sequence: 2,
      observed: { a: 1, b: 1 },
      lamport: 3,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-delete", nodeId: "n" },
      },
    });
    const lateOfflineOccurrence = rawFact({
      replicaId: "c",
      sequence: 1,
      observed: { a: 1 },
      lamport: 2,
      body: {
        kind: "contribution",
        actorId: "offline",
        intent: "direct",
        mutation: { kind: "occurrence-create", occurrenceId: "o2", nodeId: "n" },
      },
    });
    await authority.appendTestRecords([
      factRecord(deletion),
      factRecord(node),
      factRecord(firstOccurrence),
      factRecord(lateOfflineOccurrence),
    ]);
    expect(authority.projection()).toEqual({ nodeIds: [], occurrenceIds: [] });

    const restore = rawFact({
      replicaId: "a",
      sequence: 3,
      observed: { a: 2, b: 1, c: 1 },
      lamport: 4,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-restore", nodeId: "n", deletionFactId: deletion.id },
      },
    });
    await authority.appendTestRecords([factRecord(restore)]);
    expect(authority.projection()).toEqual({ nodeIds: ["n"], occurrenceIds: ["o1", "o2"] });
  });

  it("rejects an unobserved restore and never treats create as an implicit resurrection", async () => {
    const authority = await openMemory();
    const deletion = rawFact({
      replicaId: "a",
      sequence: 1,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-delete", nodeId: "n" },
      },
    });
    const invalidRestore = rawFact({
      replicaId: "b",
      sequence: 1,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-restore", nodeId: "n", deletionFactId: deletion.id },
      },
    });
    await authority.appendTestRecords([factRecord(deletion), factRecord(invalidRestore)]);
    expect(authority.admission().kind).toBe("fault");
    expect(authority.admission().fault).toContain("Restore does not observe its deletion");
  });
});

describe("two-replica convergence", () => {
  it("persists, merges, and converges concurrent opposite Resolutions without syncing projections", async () => {
    const left = await openMemory("b", "201");
    const right = await openMemory("c", "202");
    const proposalRequest = contribution({ kind: "node-create", nodeId: "proposal" }, "proposal");
    const proposalReceipt = await left.commitCommand("proposal", proposalRequest);
    left.publishCurrent();
    await right.importFrom(left);
    right.publishCurrent();

    await left.commitCommand("accept", resolution("accept", proposalReceipt.factIds));
    await right.commitCommand("reject", resolution("reject", proposalReceipt.factIds));
    await left.importFrom(right);
    await right.importFrom(left);

    expect(left.admission().frontier).toEqual(right.admission().frontier);
    expect(winningResolution(left.admission().facts, proposalReceipt.factIds[0]!)?.decision).toBe(
      "reject",
    );
    expect(winningResolution(right.admission().facts, proposalReceipt.factIds[0]!)?.decision).toBe(
      "reject",
    );
    expect(left.exportAll()).not.toHaveLength(0);
  });
});

class FailingDocStore implements DocStore {
  private readonly inner = new InMemoryDocStore();
  failNextAppend = false;

  load(id: string): Promise<LoadedDocBytes | null> {
    return this.inner.load(id);
  }

  listIds(): Promise<string[]> {
    return this.inner.listIds();
  }

  appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      return Promise.reject(new Error("injected durable append failure"));
    }
    return this.inner.appendUpdate(id, bytes);
  }

  writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    return this.inner.writeSnapshot(id, bytes);
  }
}
