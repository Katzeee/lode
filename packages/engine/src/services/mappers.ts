import { create } from "@bufbuild/protobuf";
import {
  DomainChangeKind as ProtoChangeKind,
  DomainChangeReason as ProtoChangeReason,
  DomainChangeSchema,
  FieldMode as ProtoFieldMode,
  FieldPresence as ProtoFieldPresence,
  FieldType as ProtoFieldType,
  NodeOccurrenceRefSchema,
  NodeRefSchema,
  type DomainChange as ProtoDomainChange,
  type FieldValueInput as ProtoFieldValueInput,
  type NodeOccurrenceRef,
  type NodeRef,
} from "@lode/protocol/proto";
import { DomainInvalidInputError } from "../domain/errors.js";
import type { DomainChange } from "../domain/model/changes.js";
import type {
  FieldAddMode,
  FieldValueInput as DomainFieldValueInput,
} from "../domain/model/field.js";
import type { FieldPresence, FieldType } from "../bundle/system-schema.js";

export function identityToProto(identity: {
  nodeId: string;
  occurrenceId: string;
}): NodeOccurrenceRef {
  return create(NodeOccurrenceRefSchema, {
    nodeId: identity.nodeId,
    occurrenceId: identity.occurrenceId,
  });
}

export function nodeRefToProto(nodeId: string): NodeRef {
  return create(NodeRefSchema, { nodeId });
}

export function changeToProto(change: DomainChange): ProtoDomainChange {
  return create(DomainChangeSchema, {
    kind: changeKindToProto(change.kind),
    reason: changeReasonToProto(change.reason),
    nodeId: change.nodeId,
    occurrenceId: change.occurrenceId,
  });
}

function changeKindToProto(kind: DomainChange["kind"]): ProtoChangeKind {
  switch (kind) {
    case "fieldSlot":
      return ProtoChangeKind.FIELD_SLOT;
    case "templateRef":
      return ProtoChangeKind.TEMPLATE_REF;
    case "fieldValue":
      return ProtoChangeKind.FIELD_VALUE;
  }
}

function changeReasonToProto(reason: DomainChange["reason"]): ProtoChangeReason {
  switch (reason) {
    case "created":
      return ProtoChangeReason.CREATED;
    case "reused":
      return ProtoChangeReason.REUSED;
    case "moved":
      return ProtoChangeReason.MOVED;
    case "deleted":
      return ProtoChangeReason.DELETED;
    case "kept":
      return ProtoChangeReason.KEPT;
    case "provenanceUpdated":
      return ProtoChangeReason.PROVENANCE_UPDATED;
  }
}

export function fieldTypeFromProto(fieldType: ProtoFieldType | undefined): FieldType | undefined {
  switch (fieldType) {
    case ProtoFieldType.PLAIN:
      return "plain";
    case ProtoFieldType.REFERENCE:
      return "reference";
    case ProtoFieldType.OPTION:
      return "option";
    case ProtoFieldType.DATE:
      return "date";
    case ProtoFieldType.CHECKBOX:
      return "checkbox";
    case undefined:
      return undefined;
  }
}

export function fieldPresenceFromProto(
  presence: ProtoFieldPresence | undefined,
): FieldPresence | undefined {
  switch (presence) {
    case ProtoFieldPresence.NORMAL:
      return "normal";
    case ProtoFieldPresence.OPTIONAL_PRESENCE:
      return "optional";
    case undefined:
      return undefined;
  }
}

export function fieldModeFromProto(mode: ProtoFieldMode | undefined): FieldAddMode | undefined {
  switch (mode) {
    case ProtoFieldMode.REUSE_EXISTING:
      return "reuseExisting";
    case ProtoFieldMode.CREATE_ONLY:
      return "createOnly";
    case undefined:
      return undefined;
  }
}

export function fieldValueInputFromProto(value: ProtoFieldValueInput): DomainFieldValueInput {
  switch (value.value.case) {
    case "text":
      return { type: "text", text: value.value.value.text };
    case "ref":
      return { type: "ref", targetNodeId: value.value.value.targetNodeId };
    case "move":
      return { type: "move", occurrenceId: value.value.value.occurrenceId };
    case undefined:
      throw new DomainInvalidInputError("FieldValueInput variant not set");
  }
}
