import { canonicalJson } from "./canonical.js";
import type { Mutation } from "./types.js";

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function validateStaticTextSpliceEvidence(
  mutation: Extract<Mutation, { kind: "text-splice" }>,
  factIdentity: string,
): void {
  if (!isWellFormedUnicode(mutation.insert)) {
    throw new Error(`Text mutation contains an unpaired surrogate: ${factIdentity}`);
  }
  if (mutation.deletedAtoms === undefined) {
    throw new Error(`Text splice lacks semantic evidence: ${factIdentity}`);
  }
  if (
    new Set(mutation.deleteAtomIds).size !== mutation.deleteAtomIds.length ||
    new Set(mutation.deletedAtoms.map((atom) => atom.id)).size !== mutation.deletedAtoms.length ||
    canonicalJson([...mutation.deleteAtomIds].sort()) !==
      canonicalJson(mutation.deletedAtoms.map((atom) => atom.id).sort())
  ) {
    throw new Error(`Text splice deletion evidence does not match targets: ${factIdentity}`);
  }
}
