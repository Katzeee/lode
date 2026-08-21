import type { Mutation } from "../../../domain/fact/index.js";

export function assertNoBatchCreatedAtomReference(mutation: Mutation, batchCreatedAtomIds: ReadonlySet<string>): void {
  const references =
    mutation.kind === "text-splice"
      ? [...mutation.deleteAtomIds, mutation.anchor.after, mutation.anchor.before]
      : mutation.kind === "text-mark"
        ? mutation.atomIds
        : [];
  if (references.some((reference) => reference !== null && batchCreatedAtomIds.has(reference))) {
    throw new Error("Text mutations may only address Atoms observed before the command batch");
  }
}

export function rememberCreatedAtomIds(mutation: Mutation, factId: string, createdAtomIds: Set<string>): void {
  if (mutation.kind === "text-splice") {
    [...mutation.insert].forEach((_, atomIndex) => {
      createdAtomIds.add(`${factId}#${atomIndex}`);
    });
  }
}
