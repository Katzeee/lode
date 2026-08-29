import { END_SEQUENCE_ANCHOR as end, type SequenceAnchor } from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { descriptor, resolveOccurrenceTarget } from "../target/index.js";
import { executeWrite, writeResult, workspaceIdOf } from "../intent/index.js";
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

const ON_OPTION = {
  name: "--on",
  description: "Node owning the instance field",
  value: { kind: "string" as const },
  required: true,
} as const;

const fieldRemove: CommandDefinition = {
  path: ["field", "remove"],
  summary: "Remove one value from a List field.",
  positionals: [["field", "Field Definition target"]],
  options: [
    ON_OPTION,
    { name: "--value", description: "Value occurrence target", value: { kind: "string" as const }, required: true },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const state = await readFieldState(context, args.positional("field"), args.requiredOption("--on"));
    if (state.cardinality !== "list") {
      throw new CliError("usage", "field remove is for List fields; use field clear for Single fields.");
    }
    if (state.materialized === undefined) {
      throw new CliError("target-not-found", "This field has no materialized values.");
    }
    const value = await resolveOccurrenceTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--value"),
      {
        nodeKinds: ["node"],
        fromParentIds: [state.materialized.fieldNodeId],
      },
    );
    const { result, data } = await executeWrite(context, "field.remove", [
      {
        kind: "field-value-remove",
        valuePlacementId: value.occurrenceId,
      },
    ]);
    return writeResult(data, result, {
      extra: {
        target: state.fieldDescriptor,
        on: descriptor(workspaceId, "node", state.ownerNodeId, state.ownerLabel),
      },
      view: writeView("Removed value", state.fieldDescriptor, `from ${state.ownerLabel}`),
    });
  },
};

const fieldMove: CommandDefinition = {
  path: ["field", "move"],
  summary: "Reorder one value inside a List field.",
  positionals: [["field", "Field Definition target"]],
  options: [
    ON_OPTION,
    { name: "--value", description: "Value occurrence target", value: { kind: "string" as const }, required: true },
    {
      name: "--before",
      description: "Move before this value occurrence",
      value: { kind: "string" as const },
      conflicts: ["--after"],
    },
    {
      name: "--after",
      description: "Move after this value occurrence",
      value: { kind: "string" as const },
      conflicts: ["--before"],
    },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const state = await readFieldState(context, args.positional("field"), args.requiredOption("--on"));
    if (state.materialized === undefined) {
      throw new CliError("target-not-found", "This field has no materialized values.");
    }
    const fieldNodeId = state.materialized.fieldNodeId;
    const value = await resolveOccurrenceTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--value"),
      {
        nodeKinds: ["node"],
        fromParentIds: [fieldNodeId],
      },
    );
    const anchorToken = args.option("--before") ?? args.option("--after");
    let anchor: SequenceAnchor = end;
    if (anchorToken !== undefined) {
      const anchorTarget = await resolveOccurrenceTarget(
        context.session,
        workspaceId,
        context.perspective,
        anchorToken,
        {
          nodeKinds: ["node"],
          fromParentIds: [fieldNodeId],
        },
      );
      anchor =
        args.option("--before") !== undefined
          ? { after: null, before: anchorTarget.occurrenceId, affinity: "before", fallback: "start" }
          : { after: anchorTarget.occurrenceId, before: null, affinity: "after", fallback: "end" };
    }
    const { result, data } = await executeWrite(context, "field.move", [
      { kind: "occurrence-move", occurrenceId: value.occurrenceId, parentNodeId: fieldNodeId, anchor },
    ]);
    return writeResult(data, result, {
      extra: {
        target: state.fieldDescriptor,
        on: descriptor(workspaceId, "node", state.ownerNodeId, state.ownerLabel),
      },
      view: writeView("Moved value", state.fieldDescriptor, `within ${state.ownerLabel}`),
    });
  },
};
