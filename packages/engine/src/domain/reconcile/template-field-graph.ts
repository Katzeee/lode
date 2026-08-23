import {
  causalMaxima,
  factObserves,
  workspaceSchemaNodeId,
  workspaceTrashNodeId,
  type FactAction,
  type FactActionId,
  type FactActionOf,
  type SequenceAnchor,
} from "../fact/index.js";

type TemplateFieldProjectionIdentity = Readonly<{
  templateFieldNodeId: string;
  templateFieldOccurrenceId: string;
  definitionOccurrenceId: string;
  staticDefaultValueNodeId: string;
  staticDefaultValueOccurrenceId: string;
}>;

type TemplateFieldState = Readonly<{
  addition: FactActionOf<"template-field-add">;
  removed: boolean;
  fieldDefinitionOwner: "template-field" | "workspace-schema";
  identity: TemplateFieldProjectionIdentity;
}>;

function templateFieldProjectionIdentity(actionId: FactActionId): TemplateFieldProjectionIdentity {
  const root = `${actionId}/projection/template-field`;
  return {
    templateFieldNodeId: `${root}/node`,
    templateFieldOccurrenceId: `${root}/occurrence`,
    definitionOccurrenceId: `${root}/definition-occurrence`,
    staticDefaultValueNodeId: `${root}/static-default/node`,
    staticDefaultValueOccurrenceId: `${root}/static-default/occurrence`,
  };
}

export function templateFieldStates(active: readonly FactAction[]): readonly TemplateFieldState[] {
  const additions = active.filter(
    (action): action is FactActionOf<"template-field-add"> => action.action.kind === "template-field-add",
  );
  const removals = active.filter(
    (action): action is FactActionOf<"template-field-remove"> => action.action.kind === "template-field-remove",
  );
  const restores = active.filter(
    (action): action is FactActionOf<"template-field-restore"> => action.action.kind === "template-field-restore",
  );
  const lifecycle = active.filter(
    (
      action,
    ): action is FactActionOf<"field-definition-make-discoverable" | "field-definition-return-to-template-field"> =>
      action.action.kind === "field-definition-make-discoverable" ||
      action.action.kind === "field-definition-return-to-template-field",
  );

  return additions.map((addition) => {
    const supports: readonly FactAction[] = [
      addition,
      ...restores.filter((restore) => restore.action.templateFieldId === addition.id),
    ];
    const removed = supports.every((support) =>
      removals.some(
        (removal) =>
          removal.action.supertagId === addition.action.supertagId &&
          removal.action.fieldDefinitionId === addition.action.fieldDefinition.fieldDefinitionId &&
          actionObserves(removal, support),
      ),
    );
    const identity = templateFieldProjectionIdentity(addition.id);
    return {
      addition,
      removed,
      identity,
      fieldDefinitionOwner: fieldDefinitionOwner(addition, lifecycle),
    };
  });
}

export function templateFieldStateByAction(
  active: readonly FactAction[],
): ReadonlyMap<FactActionId, TemplateFieldState> {
  return new Map(templateFieldStates(active).map((state) => [state.addition.id, state]));
}

export function templateFieldPlacementIds(
  action: FactAction,
  states: ReadonlyMap<FactActionId, TemplateFieldState>,
): readonly string[] {
  const state = states.get(action.id);
  if (state === undefined) {
    return [];
  }
  const root = !state.removed || state.fieldDefinitionOwner === "workspace-schema";
  return [
    ...(root ? [state.identity.templateFieldOccurrenceId] : []),
    state.identity.definitionOccurrenceId,
    state.identity.staticDefaultValueOccurrenceId,
  ];
}

export function templateFieldPlacement(
  workspaceNodeId: string,
  state: TemplateFieldState,
  placementId: string,
): Readonly<{ nodeId: string; parentNodeId: string; anchor: SequenceAnchor; derived: true }> | null {
  const { addition, identity } = state;
  if (placementId === identity.templateFieldOccurrenceId) {
    return {
      nodeId: identity.templateFieldNodeId,
      parentNodeId: state.removed ? workspaceTrashNodeId(workspaceNodeId) : addition.action.supertagId,
      anchor: state.removed ? end : addition.action.anchor,
      derived: true,
    };
  }
  if (placementId === identity.definitionOccurrenceId) {
    return {
      nodeId: addition.action.fieldDefinition.fieldDefinitionId,
      parentNodeId: identity.templateFieldNodeId,
      anchor: start,
      derived: true,
    };
  }
  return placementId === identity.staticDefaultValueOccurrenceId
    ? {
        nodeId: identity.staticDefaultValueNodeId,
        parentNodeId: identity.templateFieldNodeId,
        anchor: after(identity.definitionOccurrenceId),
        derived: true,
      }
    : null;
}

function fieldDefinitionOwner(
  addition: FactActionOf<"template-field-add">,
  lifecycle: readonly FactActionOf<
    "field-definition-make-discoverable" | "field-definition-return-to-template-field"
  >[],
): "template-field" | "workspace-schema" {
  const candidates = causalMaxima(
    lifecycle.filter(
      (action) =>
        action.action.fieldDefinitionId === addition.action.fieldDefinition.fieldDefinitionId &&
        actionObserves(action, addition),
    ),
    (left, right) => left.action.fieldDefinitionId === right.action.fieldDefinitionId,
  );
  if (candidates.some((candidate) => candidate.action.kind === "field-definition-make-discoverable")) {
    return "workspace-schema";
  }
  if (
    candidates.some(
      (candidate) =>
        candidate.action.kind === "field-definition-return-to-template-field" &&
        candidate.action.templateFieldId === addition.id,
    )
  ) {
    return "template-field";
  }
  return addition.action.fieldDefinition.kind === "new" ? "template-field" : "workspace-schema";
}

export function templateFieldDefinitionOwnerNodeId(workspaceNodeId: string, state: TemplateFieldState): string {
  return state.fieldDefinitionOwner === "workspace-schema"
    ? workspaceSchemaNodeId(workspaceNodeId)
    : state.identity.templateFieldNodeId;
}

export function templateFieldStaticDefaultCandidates(
  active: readonly FactAction[],
  templateFieldId: FactActionId,
): readonly FactActionOf<"template-field-static-default-set">[] {
  return causalMaxima(
    active.filter(
      (action): action is FactActionOf<"template-field-static-default-set"> =>
        action.action.kind === "template-field-static-default-set" && action.action.templateFieldId === templateFieldId,
    ),
    (left, right) => left.action.templateFieldId === right.action.templateFieldId,
  );
}

function actionObserves(observer: FactAction, observed: FactAction): boolean {
  return observer.factId === observed.factId ? observer.index > observed.index : factObserves(observer, observed);
}

const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

function after(occurrenceId: string): SequenceAnchor {
  return { after: occurrenceId, before: null, affinity: "after", fallback: "end" };
}
