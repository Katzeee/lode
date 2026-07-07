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
import type { Engine, NodeUpdatedPayload as CoreNodeUpdatedPayload } from "../core/index.js";
import { getEngine, type AppContext } from "./context.js";

// Runs a mutating doc operation within the session/persist/broadcast envelope:
// requireOrigin → load doc → capture nodeUpdated payloads → run → persist → broadcast.
// DomainInvalidInputError thrown by `fn` propagates (the daemon maps it to InvalidArgument).
export async function runMutation<T>(
  ctx: AppContext,
  connectionId: string,
  workspaceId: string,
  fn: (doc: Engine) => T,
): Promise<T> {
  const origin = ctx.sessions.requireOrigin(connectionId);
  const doc = await getEngine(ctx, workspaceId);
  // Capture the tree's pre-mutation version so persistMutation can export just this mutation's delta.
  const beforeVersion = doc.asOutliner().treeSyncDoc().version();
  const payloads: ProtoNodeUpdatedPayload[] = [];
  const sub = doc.slots.nodeUpdated.subscribe((payload) => {
    payloads.push(payloadToProto(payload));
  });
  try {
    const result = fn(doc);
    await ctx.workspaces.persistMutation(workspaceId, beforeVersion);
    ctx.sessions.broadcastNodeUpdated(workspaceId, payloads, origin);
    return result;
  } finally {
    sub.unsubscribe();
  }
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
