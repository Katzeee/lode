import type { DesktopClient } from "@lode/desktop-client";
import type { HistoryQuery, ReviewQuery } from "@lode/sdk";

import {
  actor,
  channel,
  integerFlag,
  invocation,
  mutationCommand,
  perspective,
  projection,
  required,
} from "./domain-command-support.js";
import { dataDomainMutations } from "./domain-data-mutations.js";
import { structureDomainMutations } from "./domain-structure-mutations.js";

export async function runDomainCommand(
  client: DesktopClient,
  workspaceId: string,
  argv: readonly string[],
): Promise<unknown> {
  const action = required(argv[0], "domain action");
  if (action === "help") {
    return help();
  }
  if (action === "workspace-show") {
    return client.query({
      kind: "outline",
      workspaceId,
      perspective: perspective(argv),
      rootNodeId: workspaceId,
      maxDepth: 20,
    });
  }
  if (action === "outline") {
    return client.query({
      kind: "outline",
      workspaceId,
      perspective: perspective(argv),
      rootNodeId: required(argv[1], "root Node identity"),
      maxDepth: integerFlag(argv, "--depth") ?? 20,
    });
  }
  if (action === "node-show") {
    return client.query({
      kind: "debug-node",
      workspaceId,
      perspective: perspective(argv),
      nodeId: required(argv[1], "Node identity"),
    });
  }
  if (action === "search-results") {
    return client.query({
      kind: "search-results",
      workspaceId,
      perspective: perspective(argv),
      searchNodeId: required(argv[1], "Search Node identity"),
      limit: integerFlag(argv, "--limit") ?? 50,
    });
  }
  if (action === "view-rows") {
    return client.query({
      kind: "view-rows",
      workspaceId,
      perspective: perspective(argv),
      hostNodeId: required(argv[1], "View host Node identity"),
      limit: integerFlag(argv, "--limit") ?? 50,
    });
  }
  if (action === "supertag-instances") {
    return client.query({
      kind: "supertag-instances",
      workspaceId,
      perspective: perspective(argv),
      supertagId: required(argv[1], "Supertag identity"),
      limit: integerFlag(argv, "--limit") ?? 50,
    });
  }
  if (action === "field-show") {
    return fieldResult(client, workspaceId, required(argv[1], "Field owner Node identity"));
  }
  if (action === "review-list") {
    return client.query({ kind: "review", workspaceId });
  }
  if (action === "review-accept" || action === "review-reject") {
    return resolveReview(client, workspaceId, argv, action);
  }
  if (action === "history-show") {
    return client.query({ kind: "history", workspaceId, channelId: channel(argv) });
  }
  if (action === "history-undo" || action === "history-redo") {
    return resolveHistory(client, workspaceId, argv, action);
  }
  const structural = await structureDomainMutations(client, workspaceId, argv);
  const mutations = structural ?? (await dataDomainMutations(client, workspaceId, argv));
  return client.execute(mutationCommand(workspaceId, argv, action, mutations));
}

async function fieldResult(client: DesktopClient, workspaceId: string, ownerNodeId: string): Promise<unknown> {
  const [materialized, effective, typed] = await Promise.all([
    projection(client, workspaceId, "materializedFields"),
    projection(client, workspaceId, "effectiveFields"),
    projection(client, workspaceId, "typedFieldValues"),
  ]);
  return {
    status: "ok",
    value: {
      ownerNodeId,
      materialized: materialized[ownerNodeId] ?? [],
      effective: effective[ownerNodeId] ?? [],
      typed: typed[ownerNodeId] ?? [],
    },
  };
}

async function resolveReview(
  client: DesktopClient,
  workspaceId: string,
  argv: readonly string[],
  action: "review-accept" | "review-reject",
): Promise<unknown> {
  const review = await client.query({ kind: "review", workspaceId });
  if (review.status !== "ok") {
    return review;
  }
  const requested = required(argv[1], "Review diff kind");
  const diffKind = requested === "structure" ? "child-sequence" : requested === "content" ? "node-content" : requested;
  const hunks = (review.value as ReviewQuery).hunks;
  const hunk = hunks.find((candidate) => candidate.diffSpace.kind === diffKind);
  if (hunk === undefined) {
    const available = hunks.map((candidate) => candidate.diffSpace.kind).join(", ");
    throw new Error(`No pending Review hunk has diff kind ${diffKind}; available kinds: ${available || "none"}`);
  }
  return client.execute({
    kind: "resolve-review",
    workspaceId,
    invocationId: invocation(argv, action),
    actorId: actor(argv),
    decision: action === "review-accept" ? "accept" : "reject",
    selection: hunk.selection,
  });
}

async function resolveHistory(
  client: DesktopClient,
  workspaceId: string,
  argv: readonly string[],
  action: "history-undo" | "history-redo",
): Promise<unknown> {
  const history = await client.query({ kind: "history", workspaceId, channelId: channel(argv) });
  if (history.status !== "ok") {
    return history;
  }
  const historyValue = history.value as HistoryQuery;
  const selection = action === "history-undo" ? historyValue.undo : historyValue.redo;
  if (selection === null) {
    throw new Error(`History channel ${channel(argv)} has nothing to ${action.slice(8)}`);
  }
  return client.execute({
    kind: action === "history-undo" ? "undo" : "redo",
    workspaceId,
    invocationId: invocation(argv, action),
    actorId: actor(argv),
    selection,
  });
}

function help(): unknown {
  return {
    status: "ok",
    value: {
      commands: [
        "workspace-show | outline <root> [--depth N] | node-show <node>",
        "node-create <node> <parent> [--text TEXT] [--type TYPE] | node-trash <node> | node-restore <node> --deletion-fact FACT --occurrence OCC --owner OWNER --parent PARENT",
        "occurrence-move <occurrence> <parent> | reference-create <target> <parent> <occurrence>",
        "supertag-create <tag> <parent> | supertag-apply <node> <tag> | supertag-remove <node> <tag> | supertag-extend <tag> <base> | supertag-unextend <tag> <base>",
        "template-field-create <tag> <use> <definition> [--text TEXT] | template-field-discover <tag> <use> <definition> | template-field-add-existing <tag> <use> <definition> | template-field-remove <tag> <use>",
        "template-field-visibility <tag> <use> <normal|pinned> | template-field-default <tag> <use> <value> | optional-field-add <tag> <definition>",
        "field-definition-create <definition> <parent> | field-configure <definition> <plain|options|options-from-supertag|number|checkbox|date> | field-show <node>",
        "field-plain-set <node> <definition> <value> | field-option-set <node> <definition> <target> | field-number-set <node> <definition> <number> | field-checkbox-set <node> <definition> <boolean> | field-date-set <node> <definition> <YYYY-MM-DD>",
        "search-create <search> [clauses] | search-update <search> [clauses] | search-results <search>",
        "view-create <host> <definition> <outline|table> | view-options <host> <definition> [options] | view-rows <host>",
        "review-list | review-accept <diff-kind> | review-reject <diff-kind> | history-show | history-undo | history-redo",
      ],
      commonFlags: ["--proposal", "--actor ID", "--channel ID", "--invocation ID", "--perspective origin|review"],
    },
  };
}
