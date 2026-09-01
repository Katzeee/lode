import {
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type DefinitionIntrinsicNodeType,
  type AuthoredAction,
  type SupertagAction,
  type SequenceAnchor,
} from "../fact/index.js";
import { definitionNodeState, isActiveNode, type InterpretedProjection } from "../reconcile/index.js";
import { AuthoredIntentViolation } from "./contract.js";
import { assertTemplateFieldIntent } from "./supertag-template-field.js";

export function assertSupertagAuthoredIntent(
  action: SupertagAction,
  previous: InterpretedProjection,
  available: InterpretedProjection,
): void {
  if (action.kind === "supertag-application-add" || action.kind === "supertag-membership-remove") {
    assertApplication(action, previous, available);
    return;
  }
  if (action.kind === "supertag-extension-add" || action.kind === "supertag-extension-remove") {
    assertExtension(action, previous, available);
    return;
  }
  if (action.kind === "template-member-add" || action.kind === "template-member-remove") {
    assertTemplateNodeRelation(action, previous, available);
    return;
  }
  assertTemplateFieldIntent(action, previous, available);
}

function assertApplication(
  action: Extract<AuthoredAction, { kind: "supertag-application-add" | "supertag-membership-remove" }>,
  previous: InterpretedProjection,
  available: InterpretedProjection,
): void {
  const removing = action.kind === "supertag-membership-remove";
  assertDefinition(available, action.supertagId, "Supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE, removing);
  assertNode(available, action.hostNodeId, "Supertag Application host");
  if (!removing) {
    if (
      (available.supertagApplications[action.hostNodeId] ?? []).some((item) => item.supertagId === action.supertagId)
    ) {
      throw new AuthoredIntentViolation("Node already has this Supertag Application");
    }
    const metanodeId = available.metanodes[action.hostNodeId];
    assertRelationAnchor(
      metanodeId === undefined ? [] : (available.childOccurrences[metanodeId] ?? []),
      action.anchor,
      "Supertag Application",
    );
    return;
  }
  const application = (previous.supertagApplications[action.hostNodeId] ?? []).find(
    (candidate) => candidate.supertagId === action.supertagId,
  );
  if (application === undefined) {
    throw new AuthoredIntentViolation("Supertag Application is absent from the observed projection");
  }
}

function assertExtension(
  action: Extract<AuthoredAction, { kind: "supertag-extension-add" | "supertag-extension-remove" }>,
  previous: InterpretedProjection,
  available: InterpretedProjection,
): void {
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
    return;
  }
  assertPreviousIdentity(
    previous.supertagExtensions[action.supertagId] ?? [],
    action.baseSupertagId,
    "Supertag Extension",
  );
}

function assertTemplateNodeRelation(
  action: Extract<AuthoredAction, { kind: "template-member-add" | "template-member-remove" }>,
  previous: InterpretedProjection,
  available: InterpretedProjection,
): void {
  const removing = action.kind === "template-member-remove";
  assertDefinition(available, action.supertagId, "Supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE, removing);
  if (!removing) {
    assertTemplateNodeAddition(action, available);
    return;
  }
  if (!(previous.supertagTemplateNodes[action.supertagId] ?? []).includes(action.templateNodeId)) {
    throw new AuthoredIntentViolation("Supertag Template member is absent from the observed projection");
  }
}

function assertTemplateNodeAddition(
  action: Extract<AuthoredAction, { kind: "template-member-add" }>,
  available: InterpretedProjection,
): void {
  assertNode(available, action.templateNodeId, "Template");
  const existing = templateOccurrenceFor(available, action.supertagId, action.templateNodeId);
  if (existing) {
    throw new AuthoredIntentViolation("Supertag already contains the Template Node");
  }
  assertRelationAnchor(
    available.childOccurrences[action.supertagId] ?? [],
    action.anchor,
    "Supertag Template Node Occurrence",
  );
}

function assertPreviousIdentity(identities: readonly string[], identity: string, label: string): void {
  const index = identities.indexOf(identity);
  if (index < 0) {
    throw new AuthoredIntentViolation(`${label} is absent from the observed projection`);
  }
}

function assertRelationAnchor(identities: readonly string[], anchor: SequenceAnchor, label: string): void {
  if ([anchor.after, anchor.before].some((id) => id !== null && !identities.includes(id))) {
    throw new AuthoredIntentViolation(`${label} anchor is absent from the observed projection`);
  }
}

function assertDefinition(
  projection: InterpretedProjection,
  definitionId: string,
  label: string,
  intrinsicNodeType: DefinitionIntrinsicNodeType,
  allowDeleted: boolean,
): void {
  const state = definitionNodeState(projection, definitionId, intrinsicNodeType);
  if (state === "active" || (allowDeleted && state === "deleted")) {
    return;
  }
  throw new AuthoredIntentViolation(`${label} type is absent from the observed projection`);
}

function assertNode(projection: InterpretedProjection, nodeId: string, label: string): void {
  if (!isActiveNode(projection.identity.workspaceNodeId, projection, nodeId)) {
    throw new AuthoredIntentViolation(`${label} Node is absent from the observed projection`);
  }
}

function templateOccurrenceFor(
  projection: Pick<InterpretedProjection, "occurrences">,
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
