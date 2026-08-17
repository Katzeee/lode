import {
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type DefinitionIntrinsicNodeType,
  type Mutation,
  type SupertagMutation,
  type SequenceAnchor,
} from "../fact/index.js";
import {
  definitionNodeState,
  isPresentNodeOutsideTrash,
  sequenceAnchorAt,
  type ScopedProjection,
} from "../reconcile/index.js";
import { completeTemplateFieldEvidence } from "./supertag-template-field.js";

export function completeSupertagMutationEvidence(
  mutation: SupertagMutation,
  previous: ScopedProjection,
  available: ScopedProjection,
): SupertagMutation {
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return completeApplication(mutation, previous, available);
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    return completeExtension(mutation, previous, available);
  }
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    return completeTemplateNodeRelation(mutation, previous, available);
  }
  return completeTemplateFieldEvidence(mutation, previous, available);
}

function completeApplication(
  mutation: Extract<Mutation, { kind: "supertag-apply" | "supertag-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "supertag-apply" | "supertag-remove" }> {
  const removing = mutation.kind === "supertag-remove";
  assertDefinition(available, mutation.supertagId, "Supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE, removing);
  assertNode(available, mutation.hostNodeId, "Supertag Application host");
  if (!removing) {
    assertApplicationStructure(mutation, available);
    const metanodeId = available.metanodes[mutation.hostNodeId];
    if (metanodeId === undefined) {
      throw new Error("Supertag Application host has no Metanode");
    }
    assertRelationAnchor(available.childOccurrences[metanodeId] ?? [], mutation.anchor, "Supertag Application");
    return mutation;
  }
  const application = (previous.supertagApplications[mutation.hostNodeId] ?? []).find(
    (candidate) => candidate.applicationNodeId === mutation.applicationNodeId,
  );
  if (
    application?.supertagId !== mutation.supertagId ||
    application.applicationOccurrenceId !== mutation.applicationOccurrenceId ||
    application.relationDefinitionOccurrenceId !== mutation.relationDefinitionOccurrenceId ||
    application.definitionOccurrenceId !== mutation.definitionOccurrenceId
  ) {
    throw new Error("Supertag Application is absent from the observed projection");
  }
  const metanodeId = previous.metanodes[mutation.hostNodeId];
  if (metanodeId === undefined) {
    throw new Error("Supertag Application host has no Metanode");
  }
  return withPreviousAnchor(
    mutation,
    previous.childOccurrences[metanodeId] ?? [],
    mutation.applicationOccurrenceId,
    "Supertag Application Occurrence",
  );
}

function assertApplicationStructure(
  mutation: Extract<Mutation, { kind: "supertag-apply" }>,
  projection: ScopedProjection,
): void {
  const metanodeId = projection.metanodes[mutation.hostNodeId];
  const applicationOccurrence = projection.occurrences[mutation.applicationOccurrenceId];
  const relationDefinitionOccurrence = projection.occurrences[mutation.relationDefinitionOccurrenceId];
  const definitionOccurrence = projection.occurrences[mutation.definitionOccurrenceId];
  if (
    metanodeId === undefined ||
    applicationOccurrence?.nodeId !== mutation.applicationNodeId ||
    applicationOccurrence.parentNodeId !== metanodeId ||
    relationDefinitionOccurrence?.nodeId !== NODE_SUPERTAGS_DEFINITION_NODE_ID ||
    relationDefinitionOccurrence.parentNodeId !== mutation.applicationNodeId ||
    definitionOccurrence?.nodeId !== mutation.supertagId ||
    definitionOccurrence.parentNodeId !== mutation.applicationNodeId
  ) {
    throw new Error("Supertag Application relation structure is absent from the observed projection");
  }
}

function completeExtension(
  mutation: Extract<Mutation, { kind: "supertag-extension-add" | "supertag-extension-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "supertag-extension-add" | "supertag-extension-remove" }> {
  const removing = mutation.kind === "supertag-extension-remove";
  assertDefinition(available, mutation.supertagId, "Supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE, removing);
  assertDefinition(
    available,
    mutation.baseSupertagId,
    "Base Supertag",
    SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
    removing,
  );
  if (!removing) {
    assertRelationAnchor(
      available.supertagExtensions[mutation.supertagId] ?? [],
      mutation.anchor,
      "Supertag Extension",
    );
    return mutation;
  }
  return withPreviousAnchor(
    mutation,
    previous.supertagExtensions[mutation.supertagId] ?? [],
    mutation.baseSupertagId,
    "Supertag Extension",
  );
}

function completeTemplateNodeRelation(
  mutation: Extract<Mutation, { kind: "supertag-template-node-add" | "supertag-template-node-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "supertag-template-node-add" | "supertag-template-node-remove" }> {
  const removing = mutation.kind === "supertag-template-node-remove";
  assertDefinition(available, mutation.supertagId, "Supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE, removing);
  if (!removing) {
    assertTemplateNodeAddition(mutation, available);
    return mutation;
  }
  const occurrence = previous.occurrences[mutation.templateOccurrenceId];
  if (occurrence?.nodeId !== mutation.templateNodeId || occurrence.parentNodeId !== mutation.supertagId) {
    throw new Error("Supertag Template Node Occurrence is absent from the observed projection");
  }
  return withPreviousAnchor(
    mutation,
    previous.childOccurrences[mutation.supertagId] ?? [],
    mutation.templateOccurrenceId,
    "Supertag Template Node Occurrence",
  );
}

function assertTemplateNodeAddition(
  mutation: Extract<Mutation, { kind: "supertag-template-node-add" }>,
  available: ScopedProjection,
): void {
  assertNode(available, mutation.templateNodeId, "Template");
  const occurrence = available.occurrences[mutation.templateOccurrenceId];
  if (
    occurrence &&
    (occurrence.nodeId !== mutation.templateNodeId || occurrence.parentNodeId !== mutation.supertagId)
  ) {
    throw new Error("Template Node Occurrence identity already exists");
  }
  const existing = templateOccurrenceFor(available, mutation.supertagId, mutation.templateNodeId);
  if (existing && existing !== mutation.templateOccurrenceId) {
    throw new Error("Supertag already contains the Template Node");
  }
  assertRelationAnchor(
    available.childOccurrences[mutation.supertagId] ?? [],
    mutation.anchor,
    "Supertag Template Node Occurrence",
  );
}

function withPreviousAnchor<MutationType extends SupertagMutation>(
  mutation: MutationType,
  identities: readonly string[],
  identity: string,
  label: string,
): MutationType {
  const index = identities.indexOf(identity);
  if (index < 0) {
    throw new Error(`${label} is absent from the observed projection`);
  }
  return { ...mutation, previousAnchor: sequenceAnchorAt(identities, index) };
}

function assertRelationAnchor(identities: readonly string[], anchor: SequenceAnchor, label: string): void {
  if ([anchor.after, anchor.before].some((id) => id !== null && !identities.includes(id))) {
    throw new Error(`${label} anchor is absent from the observed projection`);
  }
}

function assertDefinition(
  projection: ScopedProjection,
  definitionId: string,
  label: string,
  intrinsicNodeType: DefinitionIntrinsicNodeType,
  allowDeleted: boolean,
): void {
  const state = definitionNodeState(projection, definitionId, intrinsicNodeType);
  if (state === "active" || (allowDeleted && state === "deleted")) {
    return;
  }
  throw new Error(`${label} type is absent from the observed projection`);
}

function assertNode(projection: ScopedProjection, nodeId: string, label: string): void {
  if (!isPresentNodeOutsideTrash(projection.identity.workspaceNodeId, projection, nodeId)) {
    throw new Error(`${label} Node is absent from the observed projection`);
  }
}

function templateOccurrenceFor(
  projection: Pick<ScopedProjection, "occurrences">,
  supertagId: string,
  templateNodeId: string,
): string | null {
  return (
    Object.values(projection.occurrences)
      .filter((occurrence) => occurrence.parentNodeId === supertagId && occurrence.nodeId === templateNodeId)
      .map((occurrence) => occurrence.occurrenceId)
      .sort()[0] ?? null
  );
}
