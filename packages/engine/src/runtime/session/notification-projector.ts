import { create } from "@bufbuild/protobuf";
import {
  CanonicalChangedSchema,
  EntityAddedSchema,
  EntityDeletedSchema,
  EntityUpdatedField,
  EntityUpdatedSchema,
  NodeUpdatedPayloadSchema,
  NotificationSchema,
  OccurrenceAddedSchema,
  OccurrenceDeletedSchema,
  OccurrenceMovedSchema,
  OccurrenceUpdatedSchema,
  OriginSchema,
  type NodeUpdatedPayload as ProtoNodeUpdatedPayload,
  type Notification,
} from "@lode/protocol/proto";
import type { NodeUpdatedPayload } from "../../core/index.js";
import type { Committed } from "../workspace/workspace-facts.js";

export function projectNotification(event: Committed): Notification | null {
  if (event.changes.length === 0) {
    return null;
  }
  return create(NotificationSchema, {
    workspaceId: event.workspaceId,
    origin: create(OriginSchema, event.origin),
    payloads: event.changes.map(payloadToProto),
  });
}

function payloadToProto(payload: NodeUpdatedPayload): ProtoNodeUpdatedPayload {
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
