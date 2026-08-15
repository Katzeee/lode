import type { Mutation, NodeType, NodeSeed, SequenceAnchor } from "../fact/index.js";

const MUTATION_EDIT_ACCESS = {
  "node-create": "composite",
  "node-delete": "direct",
  "node-restore": "direct",
  "occurrence-create": "direct",
  "occurrence-delete": "direct",
  "occurrence-restore": "direct",
  "occurrence-move": "direct",
  "node-owner-set": "internal",
  "node-type-declare": "direct",
  "schema-apply": "direct",
  "schema-remove": "direct",
  "schema-field-add": "direct",
  "schema-field-remove": "direct",
  "schema-field-configure": "direct",
  "schema-extension-add": "direct",
  "schema-extension-remove": "direct",
  "schema-template-node-add": "direct",
  "schema-template-node-remove": "direct",
  "template-node-detach": "direct",
  "field-materialize": "direct",
  "field-value-delete": "direct",
  "materialized-field-delete": "direct",
  "field-initialize": "internal",
  "text-splice": "direct",
  "text-mark": "direct",
  "value-set": "direct",
  "value-unset": "direct",
} as const satisfies Readonly<Record<Mutation["kind"], "direct" | "composite" | "internal">>;

export const PREPARED_MUTATION_EVIDENCE_KEYS = [
  "deletedAtoms",
  "observedConfigFactIds",
  "observedInitializationFactIds",
  "previous",
  "previousAnchor",
  "previousConfig",
  "previousOwnerNodeId",
  "previousParentNodeId",
  "sourceApplicationSchemaIds",
  "sourceSchemaIds",
  "sourceTemplateOccurrenceIds",
] as const;

export type CreateNodeEdit = Readonly<{
  kind: "node-create";
  nodeId: string;
  occurrenceId: string;
  parentNodeId: string;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
  nodeType?: NodeType;
}>;

export type PromoteReferenceEdit = Readonly<{
  kind: "reference-promote";
  occurrenceId: string;
}>;

type PreparedEvidence = (typeof PREPARED_MUTATION_EVIDENCE_KEYS)[number];
type DirectEditMutationKind = {
  [Kind in Mutation["kind"]]: (typeof MUTATION_EDIT_ACCESS)[Kind] extends "direct" ? Kind : never;
}[Mutation["kind"]];

type UnpreparedMutation<M extends Mutation> = M extends Mutation ? Readonly<Omit<M, PreparedEvidence>> : never;

type UnpreparedMutations<M extends Mutation> = M extends Mutation ? UnpreparedMutation<M> : never;

type FactMutationEdit = UnpreparedMutations<Extract<Mutation, { kind: DirectEditMutationKind }>>;

export type EditMutation = FactMutationEdit | CreateNodeEdit | PromoteReferenceEdit;
type ExpandableEdit = Exclude<EditMutation, PromoteReferenceEdit>;

export function isFactMutationEdit(mutation: Mutation): mutation is FactMutationEdit {
  return MUTATION_EDIT_ACCESS[mutation.kind] === "direct";
}

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

export function expandEditMutation(edit: ExpandableEdit): MutationWrite {
  if (edit.kind !== "node-create") {
    return singleMutationWrite(edit);
  }
  const { occurrenceId, parentNodeId, anchor, nodeType, ...identity } = edit;
  return atomicMutationWrite([
    identity,
    {
      kind: "occurrence-create",
      occurrenceId,
      nodeId: edit.nodeId,
      parentNodeId,
      anchor,
    },
    ...(nodeType === undefined ? [] : ([{ kind: "node-type-declare", nodeId: edit.nodeId, nodeType }] as const)),
  ]);
}
