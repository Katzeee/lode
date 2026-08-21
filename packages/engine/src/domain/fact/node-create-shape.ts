import { assertJsonValue, assertKeys, assertObject, requireStringAllowEmpty } from "../../decoding/index.js";

export function assertOptionalNodeSeed(value: unknown): void {
  if (value === undefined) {
    return;
  }
  assertObject(value, "Node seed");
  assertKeys(value, ["text"], "Node seed");
  if (!Array.isArray(value.text)) {
    throw new Error("Node seed text must be an array");
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
