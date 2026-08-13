import { stableStringCompare, type ContributionFact, type JsonValue } from "../fact/index.js";
import type { TextAtom } from "./projection-types.js";
import type { MutableNode } from "./projection-state.js";
import { insertManyAtAnchor } from "./sequence.js";
import { valueTargetAddress } from "./value-address.js";

export function applyText(
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
): void {
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "text-splice") {
      const node = nodes.get(mutation.nodeId);
      if (!node) {
        continue;
      }
      const deleted = new Set(mutation.deleteAtomIds);
      node.text = node.text.filter((atom) => !deleted.has(atom.id));
      const inserted = [...mutation.insert].map((value, index): TextAtom => ({
        id: `${fact.id}#${index}`,
        value,
        attributes: mutation.attributes ?? {},
        contributionId: fact.id,
      }));
      insertManyAtAnchor(node.text, inserted, mutation.anchor, (atom) => atom.id);
    } else if (mutation.kind === "text-mark") {
      const node = nodes.get(mutation.nodeId);
      if (!node) {
        continue;
      }
      const targets = new Set(mutation.atomIds);
      node.text = node.text.map((atom) => {
        if (!targets.has(atom.id)) {
          return atom;
        }
        const attributes = { ...atom.attributes };
        if (mutation.value.kind === "unset") {
          delete attributes[mutation.key];
        } else {
          attributes[mutation.key] = mutation.value.value;
        }
        return { ...atom, attributes };
      });
    }
  }
}
export function applyValues(
  active: readonly ContributionFact[],
  initial: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {},
): Readonly<Record<string, Readonly<Record<string, JsonValue>>>> {
  const standalone = new Map(
    Object.entries(initial).map(([address, values]) => [address, { ...values }]),
  );
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "value-set" && mutation.kind !== "value-unset") {
      continue;
    }
    const address = valueTargetAddress(mutation.target, mutation.namespace);
    const namespace = standalone.get(address) ?? {};
    standalone.set(address, namespace);
    if (mutation.kind === "value-set") {
      namespace[mutation.key] = mutation.value;
    } else {
      delete namespace[mutation.key];
    }
  }
  return Object.fromEntries(
    [...standalone].sort(([left], [right]) => stableStringCompare(left, right)),
  );
}
