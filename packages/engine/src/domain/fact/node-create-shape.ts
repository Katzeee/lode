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
    assertObject(atom, "Node seed Text Atom");
    assertKeys(atom, ["value", "attributes"], "Node seed Text Atom");
    requireStringAllowEmpty(atom.value, "Node seed Text Atom value");
    assertObject(atom.attributes, "Node seed Text Atom attributes");
    for (const item of Object.values(atom.attributes)) {
      assertJsonValue(item, "Node seed Text Atom attribute");
    }
  }
}
