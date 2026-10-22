import { END_SEQUENCE_ANCHOR as end, type SequenceAnchor } from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { stringOption, writeCommand } from "../command/index.js";
import { resolveOccurrence, resource } from "../target/index.js";
import { runWrite } from "../intent/index.js";
import { registerFieldClearCommands } from "./field-clear.js";
import { registerFieldValueWriteCommands } from "./field-value-write.js";
import { readFieldState } from "./field-state.js";

/**
 * Field value commands: `set` serves Single fields, `add`/`remove`/`move`
 * serve List fields atomically, and `clear` keeps Field Content Deletion
 * semantics (typed clear vs materialized-subtree trash).
 */

export function registerFieldValueCommands(catalog: CommandCatalog): void {
  registerFieldValueWriteCommands(catalog);
  catalog.register(fieldRemove);
  catalog.register(fieldMove);
  registerFieldClearCommands(catalog);
}

const ON_OPTION = stringOption("--on", "Node owning the instance field", { required: true });

const fieldRemove = writeCommand({
  path: ["field", "remove"],
  summary: "Remove one value from a List field.",
  positionals: [["field", "Field Definition target"]],
  options: [ON_OPTION, stringOption("--value", "Value occurrence target", { required: true })],
  run: runWrite("field.remove", async (context, args) => {
    const state = await readFieldState(context, args.positional("field"), args.requiredOption("--on"));
    if (state.cardinality !== "list") {
      throw new CliError("usage", "field remove is for List fields; use field clear for Single fields.");
    }
    if (state.materialized === undefined) {
      throw new CliError("target-not-found", "This field has no materialized values.");
    }
    const value = await resolveOccurrence(context, args.requiredOption("--value"), {
      nodeKinds: ["node"],
      fromParentIds: [state.materialized.fieldNodeId],
    });
    return {
      actions: [
        {
          kind: "field-value-remove",
          valuePlacementId: value.occurrenceId,
        },
      ],
      extra: {
        target: state.fieldDescriptor,
        on: resource(context, "node", state.ownerNodeId, state.ownerLabel),
      },
      view: writeView("Removed value", state.fieldDescriptor, `from ${state.ownerLabel}`),
    };
  }),
});

const fieldMove = writeCommand({
  path: ["field", "move"],
  summary: "Reorder one value inside a List field.",
  positionals: [["field", "Field Definition target"]],
  options: [
    ON_OPTION,
    stringOption("--value", "Value occurrence target", { required: true }),
    stringOption("--before", "Move before this value occurrence", { conflicts: ["--after"] }),
    stringOption("--after", "Move after this value occurrence", { conflicts: ["--before"] }),
  ],
  run: runWrite("field.move", async (context, args) => {
    const state = await readFieldState(context, args.positional("field"), args.requiredOption("--on"));
    if (state.materialized === undefined) {
      throw new CliError("target-not-found", "This field has no materialized values.");
    }
    const fieldNodeId = state.materialized.fieldNodeId;
    const value = await resolveOccurrence(context, args.requiredOption("--value"), {
      nodeKinds: ["node"],
      fromParentIds: [fieldNodeId],
    });
    const anchorToken = args.option("--before") ?? args.option("--after");
    let anchor: SequenceAnchor = end;
    if (anchorToken !== undefined) {
      const anchorTarget = await resolveOccurrence(context, anchorToken, {
        nodeKinds: ["node"],
        fromParentIds: [fieldNodeId],
      });
      anchor =
        args.option("--before") !== undefined
          ? { after: null, before: anchorTarget.occurrenceId, affinity: "before", fallback: "start" }
          : { after: anchorTarget.occurrenceId, before: null, affinity: "after", fallback: "end" };
    }
    return {
      actions: [{ kind: "occurrence-move", occurrenceId: value.occurrenceId, parentNodeId: fieldNodeId, anchor }],
      extra: {
        target: state.fieldDescriptor,
        on: resource(context, "node", state.ownerNodeId, state.ownerLabel),
      },
      view: writeView("Moved value", state.fieldDescriptor, `within ${state.ownerLabel}`),
    };
  }),
});
