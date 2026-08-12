import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../src/domain/admission/index.js";
import {
  canonicalJson,
  makeFact,
  type Fact,
  type FactFrontier,
  type Mutation,
} from "../src/domain/fact/index.js";
import {
  advanceGeneration,
  rebuildGeneration,
  templateInstanceNodeId,
} from "../src/domain/reconcile/index.js";
import { end, Facts } from "../src/domain/reconcile/reconcile-test-helpers.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
} from "../src/runtime/workspace/generation-checkpoint.js";

const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "lode-schema-12" } as const;
const removeReplica = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const addReplica = "cccccccccccccccccccccccccc";
const detachReplica = "dddddddddddddddddddddddddd";
const checkpointKey = "template-node-property";

describe("Template Node convergence", () => {
  it("preserves concurrent observed-remove support and detached content across 32 arrival topologies", () => {
    const base = fixture();
    const baseSnapshot = admitted(base.values);
    const frontier = baseSnapshot.frontier;
    const remove = remoteFact(removeReplica, frontier, base.values.length + 1, {
      kind: "schema-template-node-remove",
      schemaId: "schema",
      templateNodeId: "guidance",
      previousAnchor: { after: null, before: null, affinity: "before", fallback: "start" },
    });
    const add = remoteFact(addReplica, frontier, base.values.length + 1, {
      kind: "schema-template-node-add",
      schemaId: "schema",
      templateNodeId: "guidance",
      anchor: end,
    });
    const merged = admitted([...base.values, remove, add]);
    const detach = remoteFact(detachReplica, merged.frontier, base.values.length + 2, {
      kind: "template-node-detach",
      ownerNodeId: "note",
      templateNodeId: "guidance",
      sourceSchemaIds: ["schema"],
      sourceApplicationSchemaIds: ["schema"],
      sourceTemplateItemIds: ["node-template:v1:schema:guidance"],
    });
    const expected = summary(
      rebuildGeneration("workspace", admitted([...merged.facts, detach]), versions),
    );

    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = admitted(shuffle([...base.values, remove, add, detach, add], seed));
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toEqual(expected);
      expect(full.generation.origin.schemaTemplateNodes.schema).toEqual(["guidance"]);
      expect(full.generation.origin.templateNodeInstances[0]).toMatchObject({
        state: "detached",
        instanceNodeId: templateInstanceNodeId("note", "guidance"),
        detachmentContributionIds: [detach.id],
      });
      expect(
        full.generation.origin.nodes[templateInstanceNodeId("note", "guidance")]?.text
          .map((atom) => atom.value)
          .join(""),
      ).toBe("Guidance");
    }

    const before = rebuildGeneration("workspace", baseSnapshot, versions).generation;
    const checkpoint = createGenerationCheckpoint("workspace", baseSnapshot, before, checkpointKey);
    const finalSnapshot = admitted([...base.values, remove, add, detach]);
    const incremental = advanceGeneration(
      "workspace",
      baseSnapshot,
      finalSnapshot,
      versions,
      before,
    );
    const checkpointTail = reconcileFromCheckpoint(
      checkpoint,
      "workspace",
      finalSnapshot,
      versions,
      checkpointKey,
    );
    expect(summary(incremental)).toEqual(expected);
    expect(summary(checkpointTail)).toEqual(expected);
  });
});

function fixture(): Facts {
  const facts = new Facts();
  for (const nodeId of ["schema", "guidance", "note"]) {
    facts.add({ kind: "node-create", nodeId });
  }
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "note-occurrence",
    nodeId: "note",
    parentOccurrenceId: null,
    parentPolicy: "cascade",
    anchor: end,
  });
  facts.add({
    kind: "text-splice",
    nodeId: "guidance",
    deleteAtomIds: [],
    deletedAtoms: [],
    anchor: end,
    insert: "Guidance",
  });
  facts.add({
    kind: "schema-template-node-add",
    schemaId: "schema",
    templateNodeId: "guidance",
    anchor: end,
  });
  facts.add({ kind: "schema-apply", nodeId: "note", schemaId: "schema", anchor: end });
  return facts;
}

function remoteFact(
  replicaId: string,
  observed: FactFrontier,
  lamport: number,
  mutation: Mutation,
): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence: 1,
    observed,
    lamport,
    body: { kind: "contribution", actorId: replicaId, intent: "direct", mutation },
  });
}

function admitted(facts: readonly Fact[]) {
  const admission = admitAuthorityRecords(
    "workspace",
    facts.map((fact) => ({ recordKind: "fact" as const, fact })),
  );
  if (admission.kind === "fault") {
    throw new Error(admission.fault ?? "Template Node admission failed");
  }
  return admission.snapshot;
}

function summary(result: ReturnType<typeof rebuildGeneration> | null): string {
  if (result === null) {
    throw new Error("Expected checkpoint-tail Reconcile result");
  }
  return canonicalJson({ origin: result.generation.origin, review: result.generation.review });
}

function shuffle(values: Fact[], seed: number): Fact[] {
  let state = seed >>> 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const selected = state % (index + 1);
    const current = values[index];
    const replacement = values[selected];
    if (!current || !replacement) {
      throw new Error("Shuffle selected an absent Fact");
    }
    values[index] = replacement;
    values[selected] = current;
  }
  return values;
}
