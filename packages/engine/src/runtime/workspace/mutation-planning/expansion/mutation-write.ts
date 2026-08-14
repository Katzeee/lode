import { atomicMutationWrite, type MutationWrite } from "../../../../domain/edit/index.js";
import type { Mutation } from "../../../../domain/fact/index.js";

export function atomicExpansion(mutations: readonly Mutation[]): MutationWrite {
  const [first, ...rest] = mutations;
  if (!first) {
    throw new Error("Atomic mutation expansion requires at least one mutation");
  }
  return atomicMutationWrite([first, ...rest]);
}
