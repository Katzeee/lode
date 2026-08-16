import {
  assertJsonValue,
  assertKeys,
  assertObject,
  assertStringArray,
  requireString,
  requireStringAllowEmpty,
} from "../../shape-validation/index.js";

export function assertTextMutationShape(value: Record<string, unknown>, assertAnchor: (value: unknown) => void): void {
  if (value.kind === "text-splice") {
    requireString(value.nodeId, value.kind);
    assertStringArray(value.deleteAtomIds, "deleted Text Atom identities");
    assertAnchor(value.anchor);
    requireStringAllowEmpty(value.insert, "inserted text");
    if (value.attributes !== undefined) {
      assertAttributes(value.attributes);
    }
    assertDeletedAtoms(value.deletedAtoms);
    return;
  }
  requireString(value.nodeId, "text-mark");
  assertStringArray(value.atomIds, "marked Text Atom identities");
  requireString(value.key, "mark key");
  assertPrevious(value.value, "mark value");
  if (value.previous !== undefined) {
    assertPrevious(value.previous, "previous value");
  }
}

function assertDeletedAtoms(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error("Deleted Text Atom evidence must be an array");
  }
  for (const atom of value) {
    assertObject(atom, "deleted Text Atom");
    assertKeys(atom, ["id", "value", "attributes"], "deleted Text Atom");
    requireString(atom.id, "deleted Text Atom identity");
    requireStringAllowEmpty(atom.value, "deleted Text Atom value");
    assertAttributes(atom.attributes);
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
