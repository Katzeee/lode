import type { EditAction } from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { descriptor } from "../target/index.js";
import { executeWrite, writeResult, workspaceIdOf } from "../intent/index.js";
import { readFieldState } from "./field-values.js";

const fieldClear: CommandDefinition = {
  path: ["field", "clear"],
  summary: "Clear a field's content, keeping the Definition and revealing the Effective placeholder.",
  positionals: [["field", "Field Definition target"]],
  options: [
    { name: "--on", description: "Node owning the instance field", value: { kind: "string" as const }, required: true },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const state = await readFieldState(context, args.positional("field"), args.requiredOption("--on"));
    if (state.materialized === undefined) {
      throw new CliError("target-not-found", "This field has no materialized content.");
    }
    const typed = ["number", "date", "checkbox", "options", "options-from-supertag"].includes(state.datatype);
    const requestId = context.requestId;
    const actions: readonly EditAction[] = typed
      ? [
          {
            kind: "typed-field-value-clear",
            ownerNodeId: state.ownerNodeId,
            fieldDefinitionId: state.fieldDefinitionId,
            emptyValueNodeId: `field:v1:${state.ownerNodeId}/${state.fieldDefinitionId}/empty-${requestId}`,
            emptyValueOccurrenceId: `field:v1:${state.ownerNodeId}/${state.fieldDefinitionId}/empty-occ-${requestId}`,
          },
        ]
      : [
          {
            kind: "materialized-field-clear",
            ownerNodeId: state.ownerNodeId,
            fieldDefinitionId: state.fieldDefinitionId,
          },
        ];
    const { result, data } = await executeWrite(context, "field.clear", actions);
    return writeResult(data, result, {
      extra: {
        target: state.fieldDescriptor,
        on: descriptor(workspaceId, "node", state.ownerNodeId, state.ownerLabel),
      },
      view: writeView("Cleared", state.fieldDescriptor, `on ${state.ownerLabel}`),
    });
  },
};

export function registerFieldClearCommands(catalog: CommandCatalog): void {
  catalog.register(fieldClear);
}
