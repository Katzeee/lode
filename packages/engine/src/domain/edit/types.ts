import type { Mutation, NodeSeed, SequenceAnchor } from "../fact/index.js";

export type CreateNodeEdit = Readonly<{
  kind: "node-create";
  nodeId: string;
  occurrenceId: string;
  parentNodeId: string;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
}>;

export type PromoteReferenceEdit = Readonly<{
  kind: "reference-promote";
  occurrenceId: string;
}>;

type PreparedEvidence =
  | "deletedAtoms"
  | "observedConfigFactIds"
  | "observedInitializationFactIds"
  | "previous"
  | "previousAnchor"
  | "previousConfig"
  | "previousOwnerNodeId"
  | "previousParentNodeId"
  | "sourceApplicationSchemaIds"
  | "sourceSchemaIds"
  | "sourceTemplateOccurrenceIds";

type UnpreparedMutation<M extends Mutation> =
  M extends Readonly<{
    kind: "node-create" | "node-owner-set" | "field-initialize";
  }>
    ? never
    : Readonly<Omit<M, PreparedEvidence>>;

type UnpreparedMutations<M extends Mutation> = M extends Mutation ? UnpreparedMutation<M> : never;

export type EditMutation = UnpreparedMutations<Mutation> | CreateNodeEdit | PromoteReferenceEdit;
export type FactReadyEdit = Exclude<EditMutation, PromoteReferenceEdit>;

export type MutationWrite =
  | Readonly<{ kind: "single"; mutation: Mutation }>
  | Readonly<{ kind: "atomic"; mutations: readonly [Mutation, ...Mutation[]] }>;

export function singleMutationWrite(mutation: Mutation): MutationWrite {
  return { kind: "single", mutation };
}

export function atomicMutationWrite(mutations: readonly [Mutation, ...Mutation[]]): MutationWrite {
  return { kind: "atomic", mutations };
}

export function mutationWriteMembers(write: MutationWrite): readonly [Mutation, ...Mutation[]] {
  return write.kind === "single" ? [write.mutation] : write.mutations;
}

export function createNodeAt(
  input: Readonly<{
    nodeId: string;
    occurrenceId: string;
    parentNodeId: string;
    anchor: SequenceAnchor;
    seed?: NodeSeed;
  }>,
): CreateNodeEdit {
  return { kind: "node-create", ...input };
}

export function expandEditMutation(edit: FactReadyEdit): MutationWrite {
  if (edit.kind !== "node-create") {
    return singleMutationWrite(edit);
  }
  const { occurrenceId, parentNodeId, anchor, ...identity } = edit;
  return atomicMutationWrite([
    identity,
    {
      kind: "occurrence-create",
      occurrenceId,
      nodeId: edit.nodeId,
      parentNodeId,
      anchor,
    },
  ]);
}
