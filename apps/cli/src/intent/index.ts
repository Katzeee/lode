import type { EditAction, WriteResult } from "@lode/sdk";

import { CliError, engineWriteFailure, type CommandResult, type HumanView } from "../outcome/index.js";
import type { CommandContext, ParsedArgs, ProductCommandRun } from "../command/index.js";

/**
 * CLI write-intent conventions: one user action is one Engine invocation on
 * the stable `cli` History channel, identified by the invocation's request id
 * so retries with the same request deduplicate engine-side. User-provided
 * Node identities derive from the request id, keeping retries byte-identical;
 * semantic relation identities belong to the Fact authority.
 */

export const CLI_HISTORY_CHANNEL = "cli";

/** The explicitly resolved Workspace for a knowledge-model command. */
export function workspaceIdOf(context: Readonly<{ workspace: unknown }>): string {
  const workspace = context.workspace as { workspaceId: string } | null;
  if (workspace === null) {
    throw new CliError("configuration-missing", "This command needs an explicit Workspace.");
  }
  return workspace.workspaceId;
}

/** The acting Actor for a knowledge-model write: --actor or the workspace's saved selection. */
export function actorIdOf(context: Readonly<{ actor: unknown; workspace: unknown }>): string {
  const actor = context.actor as string | null;
  if (actor === null) {
    throw new CliError(
      "configuration-missing",
      "No Actor selected for this Workspace. Pass --actor <actorId> or set one with `lode workspace use-actor <workspace> <actor>`.",
    );
  }
  return actor;
}

type WriteOutcomeData = Readonly<{
  intent: "direct" | "proposal";
  requestId: string;
  action: string;
}>;

export async function executeWrite(
  context: CommandContext,
  action: string,
  actions: readonly EditAction[],
): Promise<Readonly<{ result: WriteResult; data: WriteOutcomeData }>> {
  const command = {
    kind: "edit",
    workspaceId: workspaceIdOf(context),
    invocationId: invocationId(context.requestId),
    actorId: actorIdOf(context),
    intent: context.intent,
    historyChannelId: CLI_HISTORY_CHANNEL,
    actions,
  } as const;
  const result = await context.session.application.execute(command);
  const data: WriteOutcomeData = { intent: context.intent, requestId: context.requestId, action };
  return { result, data };
}

export function writeResult(
  data: WriteOutcomeData,
  result: WriteResult,
  options: Readonly<{ extra?: Readonly<Record<string, unknown>>; view?: HumanView | null }> = {},
): CommandResult<WriteOutcomeData & Readonly<Record<string, unknown>>> {
  const { extra = {}, view = null } = options;
  switch (result.status) {
    case "published":
      return {
        status: "ok",
        data: { ...data, ...extra, receipt: result.receipt },
        page: null,
        view,
        error: null,
        warnings: [],
      };
    case "committed-projection-pending":
      return {
        status: "committed-pending",
        data: { ...data, ...extra, receipt: result.receipt },
        page: null,
        view,
        error: null,
        warnings: ["Committed; the projection update is still in progress."],
      };
    case "outcome-unknown":
      return {
        status: "outcome-unknown",
        data: { ...data, ...extra, invocationId: result.invocationId },
        page: null,
        view,
        error: null,
        warnings: [],
      };
    case "rejected":
      throw engineWriteFailure(result);
  }
}

export type WritePlan = Readonly<{
  actions: readonly EditAction[];
  extra?: Readonly<Record<string, unknown>>;
  view?: HumanView | null;
}>;

/**
 * The fixed tail of every write command: the plan callback owns the per-command
 * work (resolution, validation, action building) and this wrapper owns the
 * invocation and outcome reporting.
 */
export function runWrite(
  action: string,
  plan: (context: CommandContext, args: ParsedArgs) => Promise<WritePlan>,
): ProductCommandRun {
  return async (context, args) => {
    const { actions, extra, view } = await plan(context, args);
    const { result, data } = await executeWrite(context, action, actions);
    return writeResult(data, result, { extra, view });
  };
}

export function invocationId(requestId: string): string {
  return `cli/${requestId}`;
}

/** Derives a retry-stable identity for a CLI-authored Node. */
export function identity(requestId: string, role: string): string {
  return `${requestId}/${role}`;
}

export {
  cardinalityConfiguration,
  datatypeConfiguration,
  optionalityConfiguration,
  optionalContributionActions,
  requiredEndpoint,
  templateFieldCreateAction,
} from "./field-edit-actions.js";
