import {
  assertJsonValue,
  assertKeys,
  assertObject,
  requireString,
  requireStringAllowEmpty,
} from "../../decoding/index.js";
import { parseTextAtomId } from "./serialized-shape.js";

export function assertTextActionShape(value: Record<string, unknown>, assertAnchor: (value: unknown) => void): void {
  if (value.kind === "rich-text-splice") {
    requireString(value.nodeId, value.kind);
    assertTextAtomIds(value.deleteAtomIds, "deleted Text Atom identities");
    assertAnchor(value.anchor);
    assertTextAnchor(value.anchor);
    requireStringAllowEmpty(value.insert, "inserted text");
    if (value.attributes !== undefined) {
      assertAttributes(value.attributes);
    }
    return;
  }
  requireString(value.nodeId, "rich-text-mark");
  assertTextAtomIds(value.atomIds, "marked Text Atom identities");
  requireString(value.key, "mark key");
  assertPrevious(value.value, "mark value");
}

function assertTextAtomIds(value: unknown, label: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  value.forEach(parseTextAtomId);
}

function assertTextAnchor(value: unknown): void {
  assertObject(value, "Text anchor");
  if (value.after !== null) {
    parseTextAtomId(value.after);
  }
  if (value.before !== null) {
    parseTextAtomId(value.before);
  }
}

function assertAttributes(value: unknown): void {
  assertObject(value, "Text attributes");
  for (const attribute of Object.values(value)) {
    assertJsonValue(attribute, "Text attribute");
  }
}

function assertPrevious(value: unknown, label: string): void {
  assertObject(value, label);
  assertKeys(value, value.kind === "set" ? ["kind", "value"] : ["kind"], label);
  if (value.kind === "unset") {
    return;
  }
  if (value.kind === "set") {
    assertJsonValue(value.value, label);
    return;
  }
  throw new Error(`Unknown ${label} kind`);
}
