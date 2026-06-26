import type { NodeId, OutlineApi } from "./types.js";

/**
 * DOMAIN layer (sits on top of the engine's OutlineApi; engine-agnostic — runs
 * identically on the single-doc oracle and the multi-shard engine).
 *
 * The engine guarantees the tree is always STRUCTURALLY valid. It does NOT
 * guarantee DOMAIN correctness: e.g. if two replicas concurrently create a
 * field slot for the same schema field, the merged tree has TWO slots — both
 * perfectly valid structurally, but semantically wrong. Domain reconcile is the
 * `f` that collapses such duplicates deterministically so all replicas converge
 * to the same domain-correct state.
 *
 * Model: a "schema" node carries a `fields` prop (comma-separated field ids).
 * A "field slot" is a child node (under the schema's canonical occurrence) with
 * a `fieldDef` prop naming which field it realizes.
 */

export function isSchema(e: OutlineApi, nodeId: NodeId): boolean {
  return typeof e.snapshot().nodes[nodeId]?.props.fields === "string";
}

export function schemaFields(e: OutlineApi, nodeId: NodeId): string[] {
  const raw = e.snapshot().nodes[nodeId]?.props.fields;
  return typeof raw === "string" ? raw.split(",").filter(Boolean) : [];
}

export type Slot = { nodeId: NodeId; fieldDef: string };

/** Field slots currently realized under the schema node's canonical occurrence. */
export function fieldSlots(e: OutlineApi, schemaNodeId: NodeId): Slot[] {
  const snap = e.snapshot();
  const canon = snap.nodes[schemaNodeId]?.canonicalOccurrenceId;
  if (!canon) return [];
  const childOccs = snap.occurrences[canon]?.childOccurrenceIds ?? [];
  const out: Slot[] = [];
  for (const c of childOccs) {
    const childNodeId = snap.occurrences[c]?.nodeId;
    const fd = childNodeId ? snap.nodes[childNodeId]?.props.fieldDef : undefined;
    if (childNodeId && typeof fd === "string") out.push({ nodeId: childNodeId, fieldDef: fd });
  }
  return out;
}

/**
 * Reconcile a schema node to domain-correctness:
 *  - remove slots whose fieldDef is no longer in the schema (stale);
 *  - for each field with multiple slots, keep one and remove the rest.
 *
 * The survivor is the lexicographically-smallest slot nodeId, so every replica
 * that has the same set of slots picks the SAME survivor → reconcile converges
 * across replicas without any further sync of "the choice."
 */
export function reconcileSchema(e: OutlineApi, schemaNodeId: NodeId): void {
  if (!isSchema(e, schemaNodeId)) return;
  const fields = new Set(schemaFields(e, schemaNodeId));
  const byField = new Map<string, NodeId[]>();
  for (const s of fieldSlots(e, schemaNodeId)) {
    if (!fields.has(s.fieldDef)) {
      e.hardDeleteNode(s.nodeId); // stale slot for a removed field
      continue;
    }
    const arr = byField.get(s.fieldDef) ?? [];
    arr.push(s.nodeId);
    byField.set(s.fieldDef, arr);
  }
  for (const ids of byField.values()) {
    ids.sort();
    for (let i = 1; i < ids.length; i++) e.hardDeleteNode(ids[i]!); // keep min, drop dups
  }
  e.commit();
}

/** Count slots realizing a given field under a schema (the duplicated-state probe). */
export function slotCountForField(e: OutlineApi, schemaNodeId: NodeId, fieldDef: string): number {
  return fieldSlots(e, schemaNodeId).filter((s) => s.fieldDef === fieldDef).length;
}

/**
 * DOMAIN invariants — the semantic truth a correct domain layer must satisfy,
 * checked DIRECTLY over the observable snapshot. These do NOT derive from
 * `reconcileSchema`'s implementation; they are the independent check that the
 * engine's structural validator (which only knows "valid tree") cannot supply.
 * After reconcile, for every schema node:
 *   - every realized field has AT MOST ONE slot;
 *   - every slot's fieldDef is one of the schema's declared fields (no stale slots).
 *
 * Throws on the first violation with a precise message.
 */
export function validateDomainInvariants(e: OutlineApi): void {
  const snap = e.snapshot();
  for (const nodeId of Object.keys(snap.nodes)) {
    const raw = snap.nodes[nodeId]?.props.fields;
    if (typeof raw !== "string") continue; // not a schema node
    const fields = new Set(
      raw
        .split(",")
        .filter(Boolean)
        .map((f) => f.trim()),
    );
    const seen = new Map<string, number>();
    for (const s of fieldSlots(e, nodeId)) {
      if (!fields.has(s.fieldDef)) {
        throw new Error(`Schema ${nodeId} has stale slot for unknown field "${s.fieldDef}"`);
      }
      seen.set(s.fieldDef, (seen.get(s.fieldDef) ?? 0) + 1);
    }
    for (const [field, count] of seen) {
      if (count > 1) {
        throw new Error(
          `Schema ${nodeId} field "${field}" realized by ${count} slots (expected ≤ 1)`,
        );
      }
    }
  }
}

/**
 * Policy: schema nodes are protected from hard-delete (their slots are managed).
 * The engine allows the structural op; the DOMAIN forbids it.
 */
export function assertHardDeleteAllowed(e: OutlineApi, nodeId: NodeId): void {
  if (isSchema(e, nodeId)) {
    throw new Error(`Cannot hard-delete protected schema node: ${nodeId}`);
  }
}
