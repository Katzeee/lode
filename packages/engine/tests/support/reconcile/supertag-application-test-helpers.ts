import {
  detachedSupertagValueNodeId,
  detachedSupertagValueOccurrenceId,
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  type Mutation,
  type SequenceAnchor,
} from "../../../src/domain/fact/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export type SupertagApplicationIdentity = Readonly<{
  hostNodeId: string;
  metanodeId: string;
  supertagId: string;
  applicationNodeId: string;
  applicationOccurrenceId: string;
  relationDefinitionOccurrenceId: string;
  definitionOccurrenceId: string;
}>;

export function supertagApplicationIdentity(
  hostNodeId: string,
  supertagId: string,
  ordinal = 1,
): SupertagApplicationIdentity {
  const stem = `${hostNodeId}-${supertagId}-application-${ordinal}`;
  return {
    hostNodeId,
    metanodeId: `${hostNodeId}-metanode`,
    supertagId,
    applicationNodeId: stem,
    applicationOccurrenceId: `${stem}-occurrence`,
    relationDefinitionOccurrenceId: `${stem}-relation-definition-occurrence`,
    definitionOccurrenceId: `${stem}-definition-occurrence`,
  };
}

export function supertagApplicationMutations(
  identity: SupertagApplicationIdentity,
  anchor: SequenceAnchor = end,
  createMetanode = true,
): readonly Mutation[] {
  return [
    ...(createMetanode
      ? ([
          { kind: "node-create", nodeId: identity.metanodeId },
          { kind: "metanode-attach", hostNodeId: identity.hostNodeId, metanodeId: identity.metanodeId },
        ] as const)
      : []),
    { kind: "node-create", nodeId: identity.applicationNodeId },
    {
      kind: "occurrence-create",
      occurrenceId: identity.applicationOccurrenceId,
      nodeId: identity.applicationNodeId,
      parentNodeId: identity.metanodeId,
      anchor,
    },
    {
      kind: "occurrence-create",
      occurrenceId: identity.relationDefinitionOccurrenceId,
      nodeId: NODE_SUPERTAGS_DEFINITION_NODE_ID,
      parentNodeId: identity.applicationNodeId,
      anchor: end,
    },
    {
      kind: "occurrence-create",
      occurrenceId: identity.definitionOccurrenceId,
      nodeId: identity.supertagId,
      parentNodeId: identity.applicationNodeId,
      anchor: end,
    },
    {
      kind: "supertag-apply",
      hostNodeId: identity.hostNodeId,
      supertagId: identity.supertagId,
      applicationNodeId: identity.applicationNodeId,
      applicationOccurrenceId: identity.applicationOccurrenceId,
      relationDefinitionOccurrenceId: identity.relationDefinitionOccurrenceId,
      definitionOccurrenceId: identity.definitionOccurrenceId,
      anchor,
    },
  ];
}

export function supertagRemovalMutations(
  identity: SupertagApplicationIdentity,
  relationPreviousAnchor: SequenceAnchor = end,
  applicationOccurrencePreviousAnchor: SequenceAnchor = end,
): readonly Mutation[] {
  const detachedValueNodeId = detachedSupertagValueNodeId(identity.applicationNodeId);
  const detachedValueOccurrenceId = detachedSupertagValueOccurrenceId(identity.applicationNodeId);
  return [
    {
      kind: "supertag-remove",
      hostNodeId: identity.hostNodeId,
      supertagId: identity.supertagId,
      applicationNodeId: identity.applicationNodeId,
      applicationOccurrenceId: identity.applicationOccurrenceId,
      relationDefinitionOccurrenceId: identity.relationDefinitionOccurrenceId,
      definitionOccurrenceId: identity.definitionOccurrenceId,
      detachedValueNodeId,
      detachedValueOccurrenceId,
      previousAnchor: relationPreviousAnchor,
    },
    { kind: "node-create", nodeId: detachedValueNodeId },
    {
      kind: "node-owner-set",
      nodeId: detachedValueNodeId,
      ownerNodeId: identity.applicationNodeId,
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-delete",
      occurrenceId: identity.definitionOccurrenceId,
      previousParentNodeId: identity.applicationNodeId,
      previousAnchor: {
        after: identity.relationDefinitionOccurrenceId,
        before: null,
        affinity: "after",
        fallback: "end",
      },
    },
    {
      kind: "occurrence-create",
      occurrenceId: detachedValueOccurrenceId,
      nodeId: detachedValueNodeId,
      parentNodeId: identity.applicationNodeId,
      anchor: end,
    },
    {
      kind: "node-owner-set",
      nodeId: identity.applicationNodeId,
      ownerNodeId: null,
      previousOwnerNodeId: identity.metanodeId,
    },
    {
      kind: "occurrence-delete",
      occurrenceId: identity.applicationOccurrenceId,
      previousParentNodeId: identity.metanodeId,
      previousAnchor: applicationOccurrencePreviousAnchor,
    },
  ];
}
