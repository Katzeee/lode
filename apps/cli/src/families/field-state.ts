import {
  FIELD_CARDINALITY_NODE_IDS,
  type FieldCardinality,
  type FieldDatatype,
  type FieldDefinitionConfiguration,
  type MaterializedField,
} from "@lode/sdk";

import type { ProductCommandRun } from "../catalog/index.js";
import { workspaceIdOf } from "../intent/index.js";
import { resolveNodeTarget } from "../target/index.js";
import type { descriptor } from "../target/index.js";
import { datatypeOfEndpoint } from "../value/field-values.js";

export type FieldState = Readonly<{
  fieldDefinitionId: string;
  fieldLabel: string;
  fieldDescriptor: ReturnType<typeof descriptor>;
  ownerNodeId: string;
  ownerLabel: string;
  datatype: FieldDatatype;
  cardinality: FieldCardinality;
  materialized: MaterializedField | undefined;
}>;

export async function readFieldState(
  context: Parameters<ProductCommandRun>[0],
  fieldToken: string,
  ownerToken: string,
): Promise<FieldState> {
  const workspaceId = workspaceIdOf(context);
  const field = await resolveNodeTarget(context.session, workspaceId, context.perspective, fieldToken, ["field"]);
  const owner = await resolveNodeTarget(context.session, workspaceId, context.perspective, ownerToken, ["node"]);
  const configurations = (await context.session.readProjection(
    workspaceId,
    context.perspective,
    "fieldDefinitionConfigurations",
  )) as Record<string, readonly FieldDefinitionConfiguration[]>;
  const entries = configurations[field.nodeId] ?? [];
  const datatype =
    datatypeOfEndpoint(entries.find((entry) => entry.kind === "datatype")?.datatypeNodeId ?? null) ?? "plain";
  const cardinality =
    entries.find((entry) => entry.kind === "cardinality")?.cardinalityNodeId === FIELD_CARDINALITY_NODE_IDS.list
      ? "list"
      : "single";
  const materializedFields = (await context.session.readProjection(
    workspaceId,
    context.perspective,
    "materializedFields",
  )) as Record<string, readonly MaterializedField[]>;
  const materialized = (materializedFields[owner.nodeId] ?? []).find(
    (entry) => entry.fieldDefinitionId === field.nodeId,
  );
  return {
    fieldDefinitionId: field.nodeId,
    fieldLabel: field.label,
    fieldDescriptor: field.descriptor,
    ownerNodeId: owner.nodeId,
    ownerLabel: owner.label,
    datatype,
    cardinality,
    materialized,
  };
}

/** Semantic slot identity: concurrent first writes on one slot merge. */
export function slotId(state: FieldState, role: string): string {
  return `field:v1:${state.ownerNodeId}/${state.fieldDefinitionId}/${role}`;
}
