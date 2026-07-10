import { create } from "@bufbuild/protobuf";
import {
  CanonicalChangedSchema,
  EntityAddedSchema,
  EntityDeletedSchema,
  EntityUpdatedField,
  EntityUpdatedSchema,
  NodeUpdatedPayloadSchema,
  OccurrenceAddedSchema,
  OccurrenceDeletedSchema,
  OccurrenceMovedSchema,
  OccurrenceUpdatedSchema,
  type NodeUpdatedPayload as ProtoNodeUpdatedPayload,
} from "@lode/protocol/proto";
import type {
  Engine,
  NodeId,
  NodeUpdatedPayload as CoreNodeUpdatedPayload,
} from "../../core/index.js";
import type { ResolvedCaller } from "../../runtime/identity/caller.js";
import { getEngine, type CommandDeps } from "./context.js";

// Runs a mutating engine operation within the persist/broadcast envelope:
// [caller gated at the boundary] → load engine → [pin working set] → capture nodeUpdated payloads →
// run → persist → broadcast → [release working set]. DomainInvalidInputError thrown by `fn`
// propagates (the daemon maps it to InvalidArgument).
//
// `workingSet`, when supplied, pins the shards the mutation touches resident for the op's duration
// (operation-internal consistency + no fault/evict thrash under capacity pressure). Supply it only
// when the set is COMPLETELY knowable tree-only from the request — the residency assertion throws
// if `fn` later touches a shard not in the set. Omit for discovery ops (working set not statically
// knowable — createPlainNode's new id, the cascade, paste, schema reconcile): they fall back to the
// Phase 1 per-read async fault path. Single-shard ops are also covered by shardForWrite's dirty-pin;
// the working-set pin here is the upfront, declared variant.
export async function runMutation<T>(
  ctx: CommandDeps,
  caller: ResolvedCaller,
  workspaceId: string,
  fn: (engine: Engine) => T | Promise<T>,
  workingSet?: (engine: Engine) => readonly NodeId[],
): Promise<T> {
  // Serialize same-workspace mutations: one completes before the next starts (CRDT paradigm —
  // same-replica operations are serial; cross-replica concurrency is expressed via sync + merge, not
  // parallel mutation). This keeps the residentSession working-set gate reliably single-operation +
  // ActionHistory begin/end grouping non-interleaving, so concurrent multi-client writes to one
  // workspace QUEUE (ms, invisible) instead of erroring ("session already active") or tearing a
  // read-modify-write. Different workspaces run in parallel (per-workspace chain).
  return ctx.workspaces.runWorkspaceSerialized(workspaceId, async () => {
    const origin = caller.origin;
    const engine = await getEngine(ctx, workspaceId);
    const outliner = engine.asOutliner();
    const resident = workingSet?.(engine) ?? [];
    let pinned = false;
    if (resident.length > 0) {
      await outliner.ensureResident(resident);
      pinned = true;
    }
    const payloads: ProtoNodeUpdatedPayload[] = [];
    const sub = engine.slots.nodeUpdated.subscribe((payload) => {
      payloads.push(payloadToProto(payload));
    });
    try {
      const result = await fn(engine);
      // Persist what changed (tree + dirty shards) through the single flushDirty entry point — each
      // engine exports its own delta from the persister's cursor, no external version capture needed.
      await ctx.workspaces.flushDirty(workspaceId);
      ctx.notify.broadcastNodeUpdated(workspaceId, payloads, origin);
      return result;
    } finally {
      sub.unsubscribe();
      if (pinned) {
        outliner.release();
      }
    }
  });
}

export function payloadToProto(payload: CoreNodeUpdatedPayload): ProtoNodeUpdatedPayload {
  switch (payload.type) {
    case "entityAdded":
      return create(NodeUpdatedPayloadSchema, {
        variant: {
          case: "entityAdded",
          value: create(EntityAddedSchema, {
            nodeId: payload.nodeId,
            occurrenceId: payload.occurrenceId,
          }),
        },
      });
    case "entityDeleted":
      return create(NodeUpdatedPayloadSchema, {
        variant: {
          case: "entityDeleted",
          value: create(EntityDeletedSchema, { nodeId: payload.nodeId }),
        },
      });
    case "entityUpdated":
      return create(NodeUpdatedPayloadSchema, {
        variant: {
          case: "entityUpdated",
          value: create(EntityUpdatedSchema, {
            nodeId: payload.nodeId,
            field: payload.field === "text" ? EntityUpdatedField.TEXT : EntityUpdatedField.PROPS,
            ...(payload.key === undefined ? {} : { key: payload.key }),
          }),
        },
      });
    case "occurrenceUpdated":
      return create(NodeUpdatedPayloadSchema, {
        variant: {
          case: "occurrenceUpdated",
          value: create(OccurrenceUpdatedSchema, {
            occurrenceId: payload.occurrenceId,
            nodeId: payload.nodeId,
            ...(payload.key === undefined ? {} : { key: payload.key }),
          }),
        },
      });
    case "occurrenceAdded":
      return create(NodeUpdatedPayloadSchema, {
        variant: {
          case: "occurrenceAdded",
          value: create(OccurrenceAddedSchema, {
            occurrenceId: payload.occurrenceId,
            nodeId: payload.nodeId,
            parentOccurrenceId: payload.parentOccurrenceId ?? undefined,
          }),
        },
      });
    case "occurrenceMoved":
      return create(NodeUpdatedPayloadSchema, {
        variant: {
          case: "occurrenceMoved",
          value: create(OccurrenceMovedSchema, {
            occurrenceId: payload.occurrenceId,
            nodeId: payload.nodeId,
            parentOccurrenceId: payload.parentOccurrenceId ?? undefined,
          }),
        },
      });
    case "occurrenceDeleted":
      return create(NodeUpdatedPayloadSchema, {
        variant: {
          case: "occurrenceDeleted",
          value: create(OccurrenceDeletedSchema, {
            occurrenceId: payload.occurrenceId,
            nodeId: payload.nodeId,
            parentOccurrenceId: payload.parentOccurrenceId ?? undefined,
          }),
        },
      });
    case "canonicalChanged":
      return create(NodeUpdatedPayloadSchema, {
        variant: {
          case: "canonicalChanged",
          value: create(CanonicalChangedSchema, {
            nodeId: payload.nodeId,
            occurrenceId: payload.occurrenceId,
          }),
        },
      });
  }
}
