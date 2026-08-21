import { atomicMutationWrite, singleMutationWrite, type MutationWrite } from "../../../domain/edit/index.js";
import type { Mutation } from "../../../domain/fact/index.js";

export type EditWriteAccumulator = {
  atomic: boolean;
  mutations: Mutation[];
};

export function editWriteAccumulators(count: number): EditWriteAccumulator[] {
  return Array.from({ length: count }, (): EditWriteAccumulator => ({
    atomic: false,
    mutations: [],
  }));
}

export function editWriteAt(accumulators: readonly EditWriteAccumulator[], index: number): EditWriteAccumulator {
  const accumulator = accumulators[index];
  if (!accumulator) {
    throw new Error("Prepared mutation lost its Edit group");
  }
  return accumulator;
}

export function absorbWriteBoundary(accumulator: EditWriteAccumulator, expansion: MutationWrite): void {
  if (expansion.kind === "atomic") {
    accumulator.atomic = true;
  }
}

export function appendEditMutation(
  accumulator: EditWriteAccumulator,
  mutation: Mutation,
): readonly [Mutation, ...Mutation[]] {
  accumulator.mutations.push(mutation);
  return accumulator.mutations as [Mutation, ...Mutation[]];
}

export function finishEditWrite(accumulator: EditWriteAccumulator): MutationWrite {
  const [first, ...rest] = accumulator.mutations;
  if (!first) {
    throw new Error("Prepared Edit contains no mutations");
  }
  if (accumulator.atomic) {
    return atomicMutationWrite([first, ...rest]);
  }
  if (rest.length > 0) {
    throw new Error("Single Edit expanded without declaring an atomic boundary");
  }
  return singleMutationWrite(first);
}
