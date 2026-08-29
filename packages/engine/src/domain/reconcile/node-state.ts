import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  FIELD_INTRINSIC_NODE_TYPE,
  WORKSPACE_INTRINSIC_NODE_TYPE,
  type FactAction,
  type NodeSeed,
} from "../fact/index.js";
import type { MutableNode } from "./projection-state.js";
import type { TextAtom } from "./projection-types.js";
import { activeIntrinsicNodeTypes } from "./intrinsic-node-types.js";
import { activeFieldConfigurationActions } from "./field-configuration-actions.js";
import { fieldConfigurationProjectionIdentity, metanodeHostNodeId, metanodeNodeId } from "./projection-identity.js";
import { supertagApplicationStates } from "./supertag-application-graph.js";
import { templateFieldStates, templateFieldStaticDefaultCandidates } from "./template-field-graph.js";
import { optionalFieldStates } from "./optional-field-graph.js";
import { searchExpressionStates } from "./search-expression-graph.js";
import { viewFilterStates, viewStates } from "./view-definition-graph.js";

export function createNodes(active: readonly FactAction[]): Map<string, MutableNode> {
  const created = new Map<string, MutableNode>();

  for (const fact of active) {
    const authoredAction = fact.action;
    if (authoredAction.kind === "workspace-bootstrap") {
      addNode(created, authoredAction.workspaceNodeId, { intrinsicNodeType: WORKSPACE_INTRINSIC_NODE_TYPE });
    } else if (authoredAction.kind === "node-create") {
      addNode(created, authoredAction.nodeId, {
        intrinsicNodeType: authoredAction.intrinsicNodeType ?? null,
        content: seededTextAtoms(fact, authoredAction.seed?.text ?? []),
      });
    }
  }
  for (const action of activeFieldConfigurationActions(active)) {
    const identity = fieldConfigurationProjectionIdentity(action.action.fieldDefinitionId, action.action.configuration);
    addNode(created, identity.configurationNodeId);
    if (action.action.configuration.kind === "initialization-expression") {
      addNode(created, identity.expressionNodeId, {
        content: [derivedTextAtom(action, 0, "findFieldValues")],
      });
      addNode(created, identity.contextNodeId, {
        content: [derivedTextAtom(action, 1, "ABOVE")],
      });
    }
  }
  for (const application of supertagApplicationStates(active)) {
    addNode(created, application.identity.applicationNodeId);
    if (application.removed) {
      addNode(created, application.identity.detachedValueNodeId);
    }
  }
  for (const field of templateFieldStates(active)) {
    addNode(created, field.identity.templateFieldNodeId, { intrinsicNodeType: FIELD_INTRINSIC_NODE_TYPE });
    const defaults = templateFieldStaticDefaultCandidates(active, field.addition.id);
    const values = new Set(defaults.map((candidate) => candidate.action.value));
    const selected = values.size === 1 ? defaults[0] : undefined;
    addNode(created, field.identity.staticDefaultValueNodeId, {
      content: selected ? [derivedTextAtom(selected, 0, selected.action.value)] : [],
    });
    if (field.addition.action.fieldDefinition.kind === "new") {
      addNode(created, field.addition.action.fieldDefinition.fieldDefinitionId, {
        intrinsicNodeType: FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
        content: seededTextAtoms(field.addition, field.addition.action.fieldDefinition.seed?.text ?? []),
      });
    }
  }
  for (const field of optionalFieldStates(active)) {
    if (field.removed) {
      continue;
    }
    addNode(created, field.identity.fieldNurseryNodeId);
    addNode(created, field.identity.nurseryValueNodeId);
    addNode(created, field.identity.contributionNodeId);
    addNode(created, field.identity.valueNodeId);
  }
  for (const expression of searchExpressionStates(active)) {
    addNode(created, expression.identity.expressionNodeId);
  }
  for (const view of viewStates(active)) {
    addNode(created, view.identity.attachmentNodeId);
    addNode(created, view.identity.viewDefinitionNodeId);
    if (view.removed) {
      addNode(created, view.identity.detachedValueNodeId);
    }
    for (const filter of viewFilterStates(active, view.addition.id)) {
      addNode(created, filter.filterNodeId);
    }
  }
  for (const metanodeId of requiredMetanodeIds(active, created)) {
    addNode(created, metanodeId);
  }
  for (const [nodeId, intrinsicNodeType] of activeIntrinsicNodeTypes(active)) {
    const node = created.get(nodeId);
    if (node) {
      node.intrinsicNodeType = intrinsicNodeType;
    }
  }
  return created;
}

function requiredMetanodeIds(
  active: readonly FactAction[],
  nodes: ReadonlyMap<string, MutableNode>,
): ReadonlySet<string> {
  const required = new Set<string>();
  for (const fact of active) {
    const action = fact.action;
    if (action.kind === "supertag-application-add") {
      const hostNodeId = action.hostNodeId;
      if (nodes.has(hostNodeId)) {
        required.add(metanodeNodeId(hostNodeId));
      }
    }
    if (action.kind === "optional-field-contribution-add") {
      if (nodes.has(action.supertagId)) {
        required.add(metanodeNodeId(action.supertagId));
      }
    }
    if (action.kind === "search-expression-add" && action.parentExpressionId === null) {
      if (nodes.has(action.expressionHostId)) {
        required.add(metanodeNodeId(action.expressionHostId));
      }
    }
    if (action.kind === "shared-default-view-add" && nodes.has(action.hostNodeId)) {
      required.add(metanodeNodeId(action.hostNodeId));
    }
    const parentNodeIds =
      action.kind === "node-create"
        ? [action.ownerNodeId]
        : action.kind === "node-restore"
          ? [action.parentNodeId]
          : action.kind === "placement-create" || action.kind === "placement-move"
            ? [action.parentNodeId]
            : [];
    for (const parentNodeId of parentNodeIds) {
      const hostNodeId = metanodeHostNodeId(parentNodeId);
      if (hostNodeId !== null && nodes.has(hostNodeId)) {
        required.add(metanodeNodeId(hostNodeId));
      }
    }
  }
  return required;
}

function derivedTextAtom(fact: FactAction, index: number, value: string): TextAtom {
  return {
    kind: "text",
    id: `${fact.id}#${index}`,
    value,
    attributes: {},
    factActionId: fact.id,
  };
}

export function cloneNodes(nodes: ReadonlyMap<string, MutableNode>): Map<string, MutableNode> {
  return new Map(
    [...nodes].map(([nodeId, node]) => [
      nodeId,
      {
        ...node,
        content: [...node.content],
      },
    ]),
  );
}

function addNode(
  created: Map<string, MutableNode>,
  nodeId: string,
  content: Partial<Omit<MutableNode, "nodeId">> = {},
): void {
  if (created.has(nodeId)) {
    return;
  }
  created.set(nodeId, {
    nodeId,
    intrinsicNodeType: content.intrinsicNodeType ?? null,
    content: content.content ?? [],
  });
}

function seededTextAtoms(fact: FactAction, seeds: NodeSeed["text"]): TextAtom[] {
  return seeds.map((atom, index) => ({
    kind: "text",
    id: `${fact.id}#${index}`,
    value: atom.value,
    attributes: { ...atom.attributes },
    factActionId: fact.id,
  }));
}
