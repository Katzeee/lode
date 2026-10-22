import type { EditAction } from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { stringOption, writeCommand } from "../command/index.js";
import { resource } from "../target/index.js";
import { runWrite } from "../intent/index.js";
import { readFieldState } from "./field-state.js";

const fieldClear = writeCommand({
  path: ["field", "clear"],
  summary: "Clear a field's content, keeping the Definition and revealing the Effective placeholder.",
  positionals: [["field", "Field Definition target"]],
  options: [stringOption("--on", "Node owning the instance field", { required: true })],
  run: runWrite("field.clear", async (context, args) => {
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
    return {
      actions,
      extra: {
        target: state.fieldDescriptor,
        on: resource(context, "node", state.ownerNodeId, state.ownerLabel),
      },
      view: writeView("Cleared", state.fieldDescriptor, `on ${state.ownerLabel}`),
    };
  }),
});

export function registerFieldClearCommands(catalog: CommandCatalog): void {
  catalog.register(fieldClear);
}
