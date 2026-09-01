import type { EditAction } from "../../../src/domain/edit/index.js";
import {
  END_SEQUENCE_ANCHOR as end,
  type IntrinsicNodeType,
  type SequenceAnchor,
} from "../../../src/domain/fact/index.js";

type NodeCreateOptions = Readonly<{
  anchor?: SequenceAnchor;
  intrinsicNodeType?: IntrinsicNodeType;
  text?: string;
}>;

export function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string = `${nodeId}-original`,
  options: NodeCreateOptions = {},
): EditAction {
  return {
    kind: "node-create",
    nodeId,
    occurrenceId,
    parentNodeId,
    anchor: options.anchor ?? end,
    ...(options.intrinsicNodeType === undefined ? {} : { intrinsicNodeType: options.intrinsicNodeType }),
    ...(options.text === undefined ? {} : { seed: { text: [{ value: options.text, attributes: {} }] } }),
  };
}

export function createSupertagApplication(hostNodeId: string, supertagId: string): EditAction {
  return {
    kind: "supertag-application-create",
    hostNodeId,
    supertagId,
    anchor: end,
  };
}

export function removeSupertagApplication(hostNodeId: string, supertagId: string): EditAction {
  return {
    kind: "supertag-remove",
    hostNodeId,
    supertagId,
  };
}
