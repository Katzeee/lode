import {
  assertJsonValue,
  assertKeys,
  assertObject,
  requireStringAllowEmpty,
  ShapeValidationError,
} from "../../decoding/index.js";
import type { NodeSeed } from "./node-create-types.js";

export function parseNodeSeed(value: unknown): NodeSeed {
  assertOptionalNodeSeed(value);
  if (value === undefined) {
    throw new ShapeValidationError("Node seed is required");
  }
  return value as NodeSeed;
}

/** Seeds are formatting fragments; content identities always address codepoints. */
export function nodeSeedCodepoints(text: NodeSeed["text"]): NodeSeed["text"] {
  return text.flatMap((fragment) => [...fragment.value].map((value) => ({ value, attributes: fragment.attributes })));
}

function assertOptionalNodeSeed(value: unknown): void {
  if (value === undefined) {
    return;
  }
  assertObject(value, "Node seed");
  assertKeys(value, ["text"], "Node seed");
  if (!Array.isArray(value.text)) {
    throw new ShapeValidationError("Node seed text must be an array");
  }
  for (const atom of value.text) {
    assertObject(atom, "Node seed text fragment");
    assertKeys(atom, ["value", "attributes"], "Node seed text fragment");
    requireStringAllowEmpty(atom.value, "Node seed text fragment value");
    assertObject(atom.attributes, "Node seed text fragment attributes");
    for (const item of Object.values(atom.attributes)) {
      assertJsonValue(item, "Node seed text fragment attribute");
    }
  }
}
