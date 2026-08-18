import type { EditMutation, TextAtomId } from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition, ProductCommandRun } from "../catalog/index.js";
import { descriptor, resolveNodeTarget } from "../target/index.js";
import { executeWrite, writeResult, workspaceIdOf } from "../intent/index.js";
import { parseFieldValue } from "../value/field-values.js";
import { readFieldState, slotId, type FieldState } from "./field-values.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const VALUE_OPTION = {
  name: "--value",
  description: "Field value (repeatable)",
  value: { kind: "string" as const },
  repeatable: true,
} as const;
const ON_OPTION = {
  name: "--on",
  description: "Node owning the instance field",
  value: { kind: "string" as const },
  required: true,
} as const;

const fieldSet: CommandDefinition = {
  path: ["field", "set"],
  summary: "Set the value of a Single field.",
  positionals: [["field", "Field Definition target"]],
  options: [ON_OPTION, { ...VALUE_OPTION, required: true }],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const state = await readFieldState(context, args.positional("field"), args.requiredOption("--on"));
    if (state.cardinality === "list") {
      throw new CliError("usage", "field set is for Single fields; use field add for List fields.");
    }
    const values = args.many("--value");
    if (values.length !== 1) {
      throw new CliError("usage", "field set takes exactly one --value.");
    }
    const raw = values.at(0);
    if (raw === undefined) {
      throw new CliError("usage", "field set takes exactly one --value.");
    }
    const mutations = await setValueMutations(context, state, raw);
    const { result, data } = await executeWrite(context, "field.set", mutations);
    return writeResult(data, result, {
      extra: {
        target: state.fieldDescriptor,
        on: descriptor(workspaceIdOf(context), "node", state.ownerNodeId, state.ownerLabel),
      },
      view: writeView("Set", state.fieldDescriptor, `on ${state.ownerLabel}`),
    });
  },
};

async function setValueMutations(
  context: Parameters<ProductCommandRun>[0],
  state: FieldState,
  raw: string,
): Promise<readonly EditMutation[]> {
  const workspaceId = workspaceIdOf(context);
  const parsed = parseFieldValue(state.datatype, raw);
  const fieldNodeId = state.materialized?.fieldNodeId ?? slotId(state, "field");
  const base = {
    ownerNodeId: state.ownerNodeId,
    fieldDefinitionId: state.fieldDefinitionId,
    fieldNodeId,
    fieldOccurrenceId: state.materialized?.fieldOccurrenceId ?? `${fieldNodeId}-occurrence`,
    valueOccurrenceId: slotId(state, "value-occurrence"),
  };
  if (parsed.kind === "plain") {
    if (state.materialized !== undefined) {
      const valueOccurrenceId = state.materialized.valueOccurrenceIds.at(0);
      const occurrences = (await context.session.readProjection(
        workspaceId,
        context.perspective,
        "occurrences",
      )) as Record<string, { occurrenceId: string; nodeId: string }>;
      const valueNodeId = valueOccurrenceId === undefined ? undefined : occurrences[valueOccurrenceId]?.nodeId;
      if (valueNodeId === undefined) {
        throw new CliError("unsupported", "The materialized field has no plain value to replace.");
      }
      const nodes = (await context.session.readProjection(workspaceId, context.perspective, "nodes")) as Record<
        string,
        { content: readonly { kind: string; id?: string }[] }
      >;
      const deleteAtomIds = (nodes[valueNodeId]?.content ?? []).flatMap((item) =>
        item.kind === "text" && item.id !== undefined ? [item.id as TextAtomId] : [],
      );
      return [{ kind: "text-splice", nodeId: valueNodeId, deleteAtomIds, anchor: end, insert: parsed.text }];
    }
    return [
      {
        kind: "node-create",
        nodeId: fieldNodeId,
        occurrenceId: `${fieldNodeId}-occurrence`,
        parentNodeId: state.ownerNodeId,
        anchor: end,
      },
      {
        kind: "node-create",
        nodeId: slotId(state, "value"),
        occurrenceId: slotId(state, "value-occurrence"),
        parentNodeId: fieldNodeId,
        anchor: end,
        seed: { text: [{ value: parsed.text, attributes: {} }] },
      },
      {
        kind: "field-materialize",
        ownerNodeId: state.ownerNodeId,
        fieldDefinitionId: state.fieldDefinitionId,
        fieldNodeId,
        fieldOccurrenceId: `${fieldNodeId}-occurrence`,
      },
    ];
  }
  if (parsed.kind === "options-from-supertag") {
    const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, parsed.targetToken, [
      "node",
      "supertag",
    ]);
    return [{ kind: "field-options-from-supertag-value-set", ...base, targetNodeId: target.nodeId }];
  }
  if (parsed.kind === "number") {
    return [{ kind: "field-number-value-set", ...base, valueNodeId: slotId(state, "value"), value: parsed.value }];
  }
  if (parsed.kind === "date") {
    return [{ kind: "field-date-value-set", ...base, valueNodeId: slotId(state, "value"), value: parsed.value }];
  }
  return [{ kind: "field-checkbox-value-set", ...base, value: parsed.value }];
}

const fieldAdd: CommandDefinition = {
  path: ["field", "add"],
  summary: "Append values to a List field atomically.",
  positionals: [["field", "Field Definition target"]],
  options: [ON_OPTION, { ...VALUE_OPTION, required: true }],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const state = await readFieldState(context, args.positional("field"), args.requiredOption("--on"));
    if (state.cardinality !== "list") {
      throw new CliError("usage", "field add is for List fields; use field set for Single fields.");
    }
    const values = args.many("--value");
    const duplicates = new Set(values);
    if (duplicates.size !== values.length) {
      throw new CliError("invalid-value", "Duplicate --value entries in one invocation.");
    }
    const mutations: EditMutation[] = [];
    const fieldNodeId = state.materialized?.fieldNodeId ?? slotId(state, "field");
    if (state.materialized === undefined) {
      mutations.push(
        {
          kind: "node-create",
          nodeId: fieldNodeId,
          occurrenceId: `${fieldNodeId}-occurrence`,
          parentNodeId: state.ownerNodeId,
          anchor: end,
        },
        {
          kind: "field-materialize",
          ownerNodeId: state.ownerNodeId,
          fieldDefinitionId: state.fieldDefinitionId,
          fieldNodeId,
          fieldOccurrenceId: `${fieldNodeId}-occurrence`,
        },
      );
    }
    for (const [index, raw] of values.entries()) {
      const parsed = parseFieldValue(state.datatype, raw);
      if (parsed.kind !== "plain") {
        throw new CliError(
          "unsupported",
          "List adds with typed datatypes are single-slot in this MVP; only Plain list values are supported.",
        );
      }
      mutations.push({
        kind: "field-value-create",
        ownerNodeId: state.ownerNodeId,
        fieldDefinitionId: state.fieldDefinitionId,
        fieldNodeId,
        fieldOccurrenceId: state.materialized?.fieldOccurrenceId ?? `${fieldNodeId}-occurrence`,
        valueNodeId: `${slotId(state, "value")}-${values.length > 1 ? index : "1"}`,
        valueOccurrenceId: `${slotId(state, "value-occurrence")}-${values.length > 1 ? index : "1"}`,
        anchor: end,
        seed: { text: [{ value: parsed.text, attributes: {} }] },
      });
    }
    const { result, data } = await executeWrite(context, "field.add", mutations);
    return writeResult(data, result, {
      extra: {
        target: state.fieldDescriptor,
        on: descriptor(workspaceIdOf(context), "node", state.ownerNodeId, state.ownerLabel),
      },
      view: writeView("Added", state.fieldDescriptor, `to ${state.ownerLabel}`),
    });
  },
};

export function registerFieldValueWriteCommands(catalog: CommandCatalog): void {
  catalog.register(fieldSet);
  catalog.register(fieldAdd);
}
