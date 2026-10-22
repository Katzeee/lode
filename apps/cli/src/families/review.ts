import { RESOLUTION_DECISIONS, type ConflictIssue, type ConflictQuery, type ReviewQuery } from "@lode/sdk";

import { CliError, okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { enumOption, readCommand, writeCommand, type ProductCommandRun } from "../command/index.js";
import { actorIdOf, invocationId, writeResult, workspaceIdOf } from "../intent/index.js";

/**
 * Review and Conflict families: opaque semantic refs produced by list/show,
 * evidence re-read before every decision, and one typed resolution path per
 * conflict kind — no generic resolve action.
 */

export function registerReviewCommands(catalog: CommandCatalog): void {
  catalog.register(reviewList);
  catalog.register(reviewShow);
  catalog.register(reviewAccept);
  catalog.register(reviewReject);
  catalog.register(conflictList);
  catalog.register(conflictShow);
  catalog.register(conflictResolve);
}

async function readReview(
  context: Parameters<ProductCommandRun>[0],
  cursor: string | undefined,
  limit: number,
): Promise<ReviewQuery> {
  const result = await context.session.application.query({
    kind: "review",
    workspaceId: workspaceIdOf(context),
    after: cursor,
    limit,
  });
  if (result.status !== "ok") {
    throw new CliError("unavailable", `Review is unavailable: ${result.error.message}`);
  }
  return result.value;
}

const reviewList = readCommand({
  path: ["review", "list"],
  summary: "List pending Review hunks as opaque review: refs.",
  paginated: true,
  run: async (context) => {
    const review = await readReview(context, context.cursor, context.limit);
    return okOutcome(
      {
        items: review.hunks.map((hunk) => ({
          ref: `review:${hunk.id}`,
          diffSpace: hunk.diffSpace,
        })),
      },
      {
        view: {
          kind: "table",
          columns: ["ref", "diff space"],
          rows: review.hunks.map((hunk) => [`review:${hunk.id}`, `${hunk.diffSpace.kind} ${hunk.diffSpace.identity}`]),
        },
        page: { count: review.hunks.length, next: review.next },
      },
    );
  },
});

const reviewShow = readCommand({
  path: ["review", "show"],
  summary: "Show one pending Review hunk with fresh evidence.",
  positionals: [["review", "review: ref from review list"]],
  run: async (context, args) => {
    const hunk = await hunkByRef(context, args.positional("review"));
    return okOutcome(
      {
        resource: {
          kind: "review",
          id: hunk.id,
          ref: `review:${hunk.id}`,
          label: `${hunk.diffSpace.kind} ${hunk.diffSpace.identity}`,
        },
        diffSpace: hunk.diffSpace,
        proposals: hunk.selection.proposalActionIds,
      },
      {
        view: {
          kind: "text",
          lines: [
            `Review hunk ${hunk.id}`,
            `Diff space: ${hunk.diffSpace.kind} (${hunk.diffSpace.identity})`,
            `Proposals: ${hunk.selection.proposalActionIds.join(", ") || "(none)"}`,
            `Accept with: lode review accept review:${hunk.id}`,
          ],
        },
      },
    );
  },
});

async function hunkByRef(context: Parameters<ProductCommandRun>[0], reference: string) {
  if (!reference.startsWith("review:")) {
    throw new CliError("usage", "Review targets use the review:<id> refs printed by `review list`.");
  }
  const id = reference.slice("review:".length);
  const review = await readReview(context, undefined, 100);
  const hunk = review.hunks.find((candidate) => candidate.id === id);
  if (hunk === undefined) {
    throw new CliError(
      "stale-selection",
      `Review item ${reference} is no longer pending. Re-run review list for fresh refs.`,
    );
  }
  return hunk;
}

const reviewAccept = writeCommand({
  path: ["review", "accept"],
  summary: "Accept a pending Review hunk with its current evidence.",
  positionals: [["review", "review: ref from review list"]],
  run: (context, args) => resolve(context, args.positional("review"), "accept"),
});

const reviewReject = writeCommand({
  path: ["review", "reject"],
  summary: "Reject a pending Review hunk with its current evidence.",
  positionals: [["review", "review: ref from review list"]],
  run: (context, args) => resolve(context, args.positional("review"), "reject"),
});

async function resolve(context: Parameters<ProductCommandRun>[0], token: string, decision: "accept" | "reject") {
  const hunk = await hunkByRef(context, token);
  const command = {
    kind: "resolve-review",
    workspaceId: workspaceIdOf(context),
    invocationId: invocationId(context.requestId),
    actorId: actorIdOf(context),
    decision,
    selection: hunk.selection,
  } as const;
  const result = await context.session.application.execute(command);
  const data = { intent: "direct" as const, requestId: context.requestId, action: `review.${decision}` };
  return writeResult(data, result, {
    extra: { review: `review:${hunk.id}`, diffSpace: hunk.diffSpace },
    view: writeView(decision === "accept" ? "Accepted" : "Rejected", {
      label: `${hunk.diffSpace.kind} ${hunk.diffSpace.identity}`,
      ref: `review:${hunk.id}`,
      link: hunk.id,
    }),
  });
}

async function readConflicts(
  context: Parameters<ProductCommandRun>[0],
  cursor: string | undefined,
  limit: number,
): Promise<ConflictQuery> {
  const result = await context.session.application.query({
    kind: "conflicts",
    workspaceId: workspaceIdOf(context),
    after: cursor,
    limit,
  });
  if (result.status !== "ok") {
    throw new CliError("unavailable", `Conflicts are unavailable: ${result.error.message}`);
  }
  return result.value;
}

const conflictList = readCommand({
  path: ["conflict", "list"],
  summary: "List open Engine conflicts as opaque conflict: refs.",
  paginated: true,
  run: async (context) => {
    const conflicts = await readConflicts(context, context.cursor, context.limit);
    return okOutcome(
      { items: conflicts.issues.map((issue) => ({ ref: `conflict:${issue.identity}`, kind: issue.kind })) },
      {
        view: {
          kind: "table",
          columns: ["ref", "kind"],
          rows: conflicts.issues.map((issue) => [`conflict:${issue.identity}`, issue.kind]),
        },
        page: { count: conflicts.issues.length, next: conflicts.next },
      },
    );
  },
});

const conflictShow = readCommand({
  path: ["conflict", "show"],
  summary: "Show one open conflict with its typed candidates.",
  positionals: [["conflict", "conflict: ref from conflict list"]],
  run: async (context, args) => {
    const issue = await issueByRef(context, args.positional("conflict"));
    return okOutcome(
      { issue },
      {
        view: {
          kind: "text",
          lines: [`Conflict ${issue.kind}`, `Ref: conflict:${issue.identity}`, describeResolution(issue)],
        },
      },
    );
  },
});

function describeResolution(issue: ConflictIssue): string {
  switch (issue.kind) {
    case "resolution-conflict":
      return "Resolve with: lode conflict resolve conflict:<identity> --decision accept|reject";
    case "unsupported-direct-intent":
      return "Recovery: restore the missing proposal support, then retry the dependent work.";
    case "intrinsic-node-type-conflict":
      return "The same Node identity was created with incompatible intrinsic types; use a distinct Node identity.";
    case "placement-conflict":
      return "Resolve by moving the occurrence to the intended parent (node move).";
    case "original-conflict":
      return "Resolve by promoting the intended occurrence to Original (node promote).";
    case "supertag-extension-cycle":
      return "Resolve by removing an extension edge (supertag unextend) to break the cycle.";
  }
}

async function issueByRef(context: Parameters<ProductCommandRun>[0], token: string): Promise<ConflictIssue> {
  if (!token.startsWith("conflict:")) {
    throw new CliError("usage", "Conflict targets use the conflict:<identity> refs printed by `conflict list`.");
  }
  const identity = token.slice("conflict:".length);
  const conflicts = await readConflicts(context, undefined, 100);
  const issue = conflicts.issues.find((candidate) => candidate.identity === identity);
  if (issue === undefined) {
    throw new CliError("stale-selection", `Conflict ${token} is no longer open. Re-run conflict list for fresh refs.`);
  }
  return issue;
}

const conflictResolve = writeCommand({
  path: ["conflict", "resolve"],
  summary: "Resolve a conflict through its typed resolution path.",
  positionals: [["conflict", "conflict: ref from conflict list"]],
  options: [enumOption("--decision", RESOLUTION_DECISIONS, "Terminal decision for a Resolution conflict")],
  run: async (context, args) => {
    const issue = await issueByRef(context, args.positional("conflict"));
    if (issue.kind !== "resolution-conflict") {
      throw new CliError(
        "unsupported",
        `Conflicts of kind ${issue.kind} resolve through their domain action. ${describeResolution(issue)}`,
      );
    }
    const decision = args.option("--decision");
    if (decision !== "accept" && decision !== "reject") {
      throw new CliError("usage", "Resolution conflicts need --decision accept or --decision reject.");
    }
    const command = {
      kind: "adjudicate-resolution",
      workspaceId: workspaceIdOf(context),
      invocationId: invocationId(context.requestId),
      actorId: actorIdOf(context),
      decision,
      proposalFactIds: issue.proposalFactIds,
      resolutionIds: issue.candidates.map((candidate) => candidate.resolutionId),
    } as const;
    const result = await context.session.application.execute(command);
    const data = { intent: "direct" as const, requestId: context.requestId, action: "conflict.resolve" };
    return writeResult(data, result, {
      extra: { conflict: `conflict:${issue.identity}`, decision },
      view: writeView("Adjudicated", {
        label: `${issue.kind} ${issue.identity}`,
        ref: `conflict:${issue.identity}`,
        link: issue.identity,
      }),
    });
  },
});
