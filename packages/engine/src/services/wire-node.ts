import { create } from "@bufbuild/protobuf";
import {
  DeltaSchema,
  NodeOccurrenceWireSchema,
  type Delta as ProtoDelta,
  type NodeOccurrenceWire,
} from "@lode/protocol/proto";
import type { Delta, NodeOccurrence } from "../core/index.js";
import { asJsonObject } from "./struct.js";

export function nodeToProto(node: NodeOccurrence): NodeOccurrenceWire {
  return create(NodeOccurrenceWireSchema, {
    nodeId: node.nodeId,
    occurrenceId: node.occurrenceId,
    parentOccurrenceId: node.parentOccurrenceId ?? undefined,
    canonicalOccurrenceId: node.canonicalOccurrenceId,
    canonicalChildOccurrenceIds: [...node.canonicalChildOccurrenceIds],
    props: asJsonObject(node.props),
    entityMeta: asJsonObject(node.entityMeta),
    occurrenceProps: asJsonObject(node.occurrenceProps),
    occurrenceMeta: asJsonObject(node.occurrenceMeta),
    deltas: deltasToProto(node.deltas),
  });
}

function deltasToProto(deltas: Delta): ProtoDelta[] {
  return deltas.map((delta) =>
    create(DeltaSchema, { insert: delta.insert, attributes: asJsonObject(delta.attributes) }),
  );
}

export function deltasFromProto(deltas: ProtoDelta[]): Delta {
  return deltas.map((delta) => ({
    insert: delta.insert,
    ...(delta.attributes === undefined ? {} : { attributes: delta.attributes }),
  }));
}
