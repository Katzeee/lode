import { workspaceTrashNodeId, type FactAction } from "../fact/index.js";
import { activeFieldConfigurationActions } from "./field-configuration-actions.js";
import { optionalFieldStates } from "./optional-field-graph.js";
import { fieldConfigurationProjectionIdentity, metanodeHostNodeId, metanodeNodeId } from "./projection-identity.js";
import type { MutableNode } from "./projection-state.js";
import {
  expressionHostParent,
  searchExpressionProjectionIdentity,
  searchExpressionStates,
} from "./search-expression-graph.js";
import { supertagApplicationStates } from "./supertag-application-graph.js";
import { templateFieldDefinitionOwnerNodeId, templateFieldStates } from "./template-field-graph.js";
import { viewFilterStates, viewStates } from "./view-definition-graph.js";

export function projectSemanticNodeOwners(
  workspaceNodeId: string,
  active: readonly FactAction[],
  nodes: ReadonlyMap<string, MutableNode>,
): Map<string, string | null> {
  const owners = new Map<string, string | null>([[workspaceNodeId, null]]);
  for (const nodeId of nodes.keys()) {
    const hostNodeId = metanodeHostNodeId(nodeId);
    if (hostNodeId !== null && nodes.has(hostNodeId)) {
      owners.set(nodeId, hostNodeId);
    }
  }
  addFieldConfigurationOwners(owners, active, nodes);
  addSupertagOwners(owners, workspaceNodeId, active, nodes);
  addSearchOwners(owners, active);
  addViewOwners(owners, active);
  return owners;
}

function addFieldConfigurationOwners(
  owners: Map<string, string | null>,
  active: readonly FactAction[],
  nodes: ReadonlyMap<string, MutableNode>,
): void {
  for (const action of activeFieldConfigurationActions(active)) {
    const identity = fieldConfigurationProjectionIdentity(action.id);
    if (nodes.has(identity.configurationNodeId)) {
      owners.set(identity.configurationNodeId, action.action.fieldDefinitionId);
    }
    if (action.action.configuration.kind !== "initialization-expression") {
      continue;
    }
    if (nodes.has(identity.expressionNodeId)) {
      owners.set(identity.expressionNodeId, identity.configurationNodeId);
    }
    if (nodes.has(identity.contextNodeId)) {
      owners.set(identity.contextNodeId, identity.expressionNodeId);
    }
  }
}

function addSupertagOwners(
  owners: Map<string, string | null>,
  workspaceNodeId: string,
  active: readonly FactAction[],
  nodes: ReadonlyMap<string, MutableNode>,
): void {
  for (const application of supertagApplicationStates(active)) {
    const { identity } = application;
    if (nodes.has(identity.applicationNodeId)) {
      owners.set(
        identity.applicationNodeId,
        application.removed ? null : metanodeNodeId(application.addition.action.hostNodeId),
      );
    }
    if (application.removed && nodes.has(identity.detachedValueNodeId)) {
      owners.set(identity.detachedValueNodeId, identity.applicationNodeId);
    }
  }
  for (const field of templateFieldStates(active)) {
    const { identity } = field;
    owners.set(
      identity.templateFieldNodeId,
      field.removed
        ? field.fieldDefinitionOwner === "workspace-schema"
          ? workspaceTrashNodeId(workspaceNodeId)
          : null
        : field.addition.action.supertagId,
    );
    owners.set(identity.staticDefaultValueNodeId, identity.templateFieldNodeId);
    owners.set(
      field.addition.action.fieldDefinition.fieldDefinitionId,
      templateFieldDefinitionOwnerNodeId(workspaceNodeId, field),
    );
  }
  for (const field of optionalFieldStates(active)) {
    if (field.removed) {
      continue;
    }
    const { identity } = field;
    owners.set(identity.fieldNurseryNodeId, metanodeNodeId(field.addition.action.supertagId));
    owners.set(identity.nurseryValueNodeId, identity.fieldNurseryNodeId);
    owners.set(identity.contributionNodeId, identity.nurseryValueNodeId);
    owners.set(identity.valueNodeId, identity.contributionNodeId);
  }
}

function addSearchOwners(owners: Map<string, string | null>, active: readonly FactAction[]): void {
  for (const expression of searchExpressionStates(active)) {
    owners.set(
      expression.identity.expressionNodeId,
      expression.removed || expression.positionConflicted
        ? null
        : expression.parentExpressionId
          ? searchExpressionProjectionIdentity(expression.parentExpressionId).expressionNodeId
          : expressionHostParent(expression.addition.action.expressionHostId),
    );
  }
}

function addViewOwners(owners: Map<string, string | null>, active: readonly FactAction[]): void {
  for (const view of viewStates(active)) {
    const { identity } = view;
    owners.set(identity.attachmentNodeId, view.removed ? null : metanodeNodeId(view.addition.action.hostNodeId));
    owners.set(identity.viewDefinitionNodeId, identity.attachmentNodeId);
    if (view.removed) {
      owners.set(identity.detachedValueNodeId, identity.attachmentNodeId);
    }
    for (const filter of viewFilterStates(active, view.addition.id)) {
      owners.set(filter.filterNodeId, filter.removed || view.removed ? null : identity.viewDefinitionNodeId);
    }
  }
}
