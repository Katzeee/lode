import {
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type DefinitionIntrinsicNodeType,
  type AuthoredAction,
  type SupertagAction,
  type SequenceAnchor,
} from "../fact/index.js";
import { definitionNodeState, isPresentNodeOutsideTrash, type ScopedProjection } from "../reconcile/index.js";
import { validateTemplateFieldIntent } from "./supertag-template-field.js";

export function validateSupertagAuthoredIntent(
  action: SupertagAction,
  previous: ScopedProjection,
  available: ScopedProjection,
): SupertagAction {
  if (action.kind === "supertag-application-add" || action.kind === "supertag-membership-remove") {
    return completeApplication(action, previous, available);
  }
  if (action.kind === "supertag-extension-add" || action.kind === "supertag-extension-remove") {
    return completeExtension(action, previous, available);
  }
  if (action.kind === "template-member-add" || action.kind === "template-member-remove") {
    return completeTemplateNodeRelation(action, previous, available);
  }
  return validateTemplateFieldIntent(action, previous, available);
}

function completeApplication(
  action: Extract<AuthoredAction, { kind: "supertag-application-add" | "supertag-membership-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<AuthoredAction, { kind: "supertag-application-add" | "supertag-membership-remove" }> {
  const removing = action.kind === "supertag-membership-remove";
  assertDefinition(available, action.supertagId, "Supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE, removing);
  assertNode(available, action.hostNodeId, "Supertag Application host");
  if (!removing) {
    const metanodeId = available.metanodes[action.hostNodeId];
    assertRelationAnchor(
      metanodeId === undefined ? [] : (available.childOccurrences[metanodeId] ?? []),
      action.anchor,
      "Supertag Application",
    );
    return action;
  }
  const application = (previous.supertagApplications[action.hostNodeId] ?? []).find(
    (candidate) => candidate.supertagId === action.supertagId,
  );
  if (application === undefined) {
    throw new Error("Supertag Application is absent from the observed projection");
  }
  return action;
}

function completeExtension(
  action: Extract<AuthoredAction, { kind: "supertag-extension-add" | "supertag-extension-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<AuthoredAction, { kind: "supertag-extension-add" | "supertag-extension-remove" }> {
  const removing = action.kind === "supertag-extension-remove";
  assertDefinition(available, action.supertagId, "Supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE, removing);
  assertDefinition(
    available,
    action.baseSupertagId,
    "Base Supertag",
    SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
    removing,
  );
  if (!removing) {
    assertRelationAnchor(available.supertagExtensions[action.supertagId] ?? [], action.anchor, "Supertag Extension");
    return action;
  }
  return withPreviousAnchor(
    action,
    previous.supertagExtensions[action.supertagId] ?? [],
    action.baseSupertagId,
    "Supertag Extension",
  );
}

function completeTemplateNodeRelation(
  action: Extract<AuthoredAction, { kind: "template-member-add" | "template-member-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<AuthoredAction, { kind: "template-member-add" | "template-member-remove" }> {
  const removing = action.kind === "template-member-remove";
  assertDefinition(available, action.supertagId, "Supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE, removing);
  if (!removing) {
    assertTemplateNodeAddition(action, available);
    return action;
  }
  if (!(previous.supertagTemplateNodes[action.supertagId] ?? []).includes(action.templateNodeId)) {
    throw new Error("Supertag Template member is absent from the observed projection");
  }
  return action;
}

function assertTemplateNodeAddition(
  action: Extract<AuthoredAction, { kind: "template-member-add" }>,
  available: ScopedProjection,
): void {
  assertNode(available, action.templateNodeId, "Template");
  const existing = templateOccurrenceFor(available, action.supertagId, action.templateNodeId);
  if (existing) {
    throw new Error("Supertag already contains the Template Node");
  }
  assertRelationAnchor(
    available.childOccurrences[action.supertagId] ?? [],
    action.anchor,
    "Supertag Template Node Occurrence",
  );
}

function withPreviousAnchor<ActionType extends SupertagAction>(
  action: ActionType,
  identities: readonly string[],
  identity: string,
  label: string,
): ActionType {
  const index = identities.indexOf(identity);
  if (index < 0) {
    throw new Error(`${label} is absent from the observed projection`);
  }
  return action;
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
