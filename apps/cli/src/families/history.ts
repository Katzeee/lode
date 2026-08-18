import type { HistoryQuery } from "@lode/sdk";

import { CliError, okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition, ProductCommandRun } from "../catalog/index.js";
import { actorIdOf, CLI_HISTORY_CHANNEL, invocationId, writeResult, workspaceIdOf } from "../intent/index.js";

/**
 * History family: undo/redo on the stable `cli` channel. The CLI picks the
 * current evidence itself — users never pass a channel or selection token.
 */

export function registerHistoryCommands(catalog: CommandCatalog): void {
  catalog.register(historyShow);
  catalog.register(historyUndo);
  catalog.register(historyRedo);
}

async function readHistory(context: Parameters<ProductCommandRun>[0]): Promise<HistoryQuery> {
  const result = await context.session.application.query({
    kind: "history",
    workspaceId: workspaceIdOf(context),
    channelId: CLI_HISTORY_CHANNEL,
  });
  if (result.status !== "ok") {
    throw new CliError("unavailable", `History is unavailable: ${result.error.message}`);
  }
  return result.value as unknown as HistoryQuery;
}

function selectionView(side: "undo" | "redo", history: HistoryQuery): ReturnType<typeof view> {
  const selection = side === "undo" ? history.undo : history.redo;
  if (selection === null) {
    return view(`Nothing to ${side} on channel ${CLI_HISTORY_CHANNEL}.`);
  }
  return view(
    `${side === "undo" ? "Undo" : "Redo"} target: ${selection.targetInvocationId} (ordinal ${selection.headOrdinal})`,
  );
}

function view(...lines: readonly string[]) {
  return { kind: "text" as const, lines };
}

const historyShow: CommandDefinition = {
  path: ["history", "show"],
  summary: "Show the CLI history channel's current undo/redo evidence.",
  positionals: [],
  options: [],
  kind: "read",
  paginated: false,
  needsWorkspace: true,
  run: async (context) => {
    const history = await readHistory(context);
    return okOutcome(
      {
        channel: CLI_HISTORY_CHANNEL,
        undo:
          history.undo === null
            ? null
            : { targetInvocationId: history.undo.targetInvocationId, headOrdinal: history.undo.headOrdinal },
        redo:
          history.redo === null
            ? null
            : { targetInvocationId: history.redo.targetInvocationId, headOrdinal: history.redo.headOrdinal },
      },
      {
        view: {
          kind: "text",
          lines: [...selectionView("undo", history).lines, ...selectionView("redo", history).lines],
        },
      },
    );
  },
};

const historyUndo: CommandDefinition = {
  path: ["history", "undo"],
  summary: "Compensate the CLI channel's most recent safely-undoable write.",
  positionals: [],
  options: [],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: (context) => compensate(context, "undo"),
};

const historyRedo: CommandDefinition = {
  path: ["history", "redo"],
  summary: "Restore the CLI channel's most recent undone write.",
  positionals: [],
  options: [],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: (context) => compensate(context, "redo"),
};

async function compensate(context: Parameters<ProductCommandRun>[0], side: "undo" | "redo") {
  const history = await readHistory(context);
  const selection = side === "undo" ? history.undo : history.redo;
  if (selection === null) {
    throw new CliError("unsupported", `Nothing to ${side} on channel ${CLI_HISTORY_CHANNEL}.`);
  }
  const command = {
    kind: side,
    workspaceId: workspaceIdOf(context),
    invocationId: invocationId(context.requestId),
    actorId: actorIdOf(context),
    selection,
  } as const;
  const result = await context.session.application.execute(command);
  const data = { intent: "direct" as const, requestId: context.requestId, action: `history.${side}` };
  return writeResult(data, result, {
    view: writeView(side === "undo" ? "Undid" : "Redid", {
      label: selection.targetInvocationId,
      ref: `invocation:${selection.targetInvocationId}`,
      link: selection.targetInvocationId,
    }),
  });
}
