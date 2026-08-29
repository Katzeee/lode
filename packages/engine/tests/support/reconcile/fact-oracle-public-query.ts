import type { EngineQueryKind } from "@lode/sdk";

import { canonicalJson, stableStringCompare, type ProjectionPerspective } from "../../../src/domain/fact/index.js";
import { PROJECTION_SECTION_NAMES, type ProjectionSectionName } from "../../../src/domain/reconcile/index.js";
import type { Workspace } from "../../../src/subsystems/workspace/workspace.js";

export const PUBLIC_DOMAIN_QUERY_KINDS = [
  "projection",
  "review",
  "history",
  "conflicts",
  "supertag-instances",
  "backlinks",
  "search-results",
  "view-rows",
  "outline",
  "debug-node",
  "trash-evidence",
] as const satisfies readonly EngineQueryKind[];

type AssertNever<Value extends never> = Value;
export type PublicDomainQueryCoverage = AssertNever<
  Exclude<Exclude<EngineQueryKind, "invocation">, (typeof PUBLIC_DOMAIN_QUERY_KINDS)[number]>
>;

export async function canonicalPublicDomainState(
  workspace: Workspace,
  limit: number,
  historyChannelIds: readonly string[],
  queryNodeIds: readonly string[] = [],
): Promise<string> {
  const nodeIds = [...new Set([...(await allNodeIds(workspace, limit)), ...queryNodeIds])].sort(stableStringCompare);
  const result: unknown[] = [];
  for (const perspective of ["origin", "review"] as const) {
    for (const section of PROJECTION_SECTION_NAMES) {
      result.push(await allProjectionPages(workspace, perspective, section, limit));
    }
    for (const nodeId of nodeIds) {
      result.push({
        kind: "supertag-instances",
        perspective,
        nodeId,
        value: await allSupertagInstances(workspace, perspective, nodeId, limit),
      });
      result.push({
        kind: "backlinks",
        perspective,
        nodeId,
        value: await allBacklinks(workspace, perspective, nodeId, limit),
      });
      result.push({
        kind: "search-results",
        perspective,
        nodeId,
        value: await allSearchResults(workspace, perspective, nodeId, limit),
      });
      result.push({
        kind: "view-rows",
        perspective,
        nodeId,
        value: await allViewRows(workspace, perspective, nodeId, limit),
      });
      result.push({
        kind: "outline",
        perspective,
        nodeId,
        value: await allOutlineRows(workspace, perspective, nodeId, limit),
      });
      result.push({
        kind: "debug-node",
        perspective,
        nodeId,
        value: await workspace.query({ kind: "debug-node", workspaceId: "workspace", perspective, nodeId }),
      });
      result.push({
        kind: "trash-evidence",
        perspective,
        nodeId,
        value: await workspace.query({ kind: "trash-evidence", workspaceId: "workspace", perspective, nodeId }),
      });
    }
  }
  result.push({ kind: "review", value: await allReviewHunks(workspace, limit) });
  result.push({ kind: "conflicts", value: await allConflicts(workspace, limit) });
  for (const channelId of historyChannelIds) {
    result.push({
      kind: "history",
      channelId,
      value: await workspace.query({ kind: "history", workspaceId: "workspace", channelId }),
    });
  }
  return canonicalJson(result);
}

async function allProjectionPages(
  workspace: Workspace,
  perspective: ProjectionPerspective,
  section: ProjectionSectionName,
  limit: number,
): Promise<unknown> {
  const values: unknown[] = [];
  let after: string | undefined;
  do {
    const page = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective,
      section,
      ...(after === undefined ? {} : { after }),
      limit,
    });
    const sectionValue = (page as unknown as Readonly<Record<string, unknown>>)[section];
    if (Array.isArray(sectionValue)) {
      const entries: readonly unknown[] = sectionValue;
      values.push(...entries);
    } else if (typeof sectionValue === "object" && sectionValue !== null) {
      values.push(...Object.entries(sectionValue));
    } else {
      throw new Error(`Projection section ${section} has no collection value`);
    }
    after = page.next ?? undefined;
  } while (after !== undefined);
  return { perspective, section, values };
}

async function allNodeIds(workspace: Workspace, limit: number): Promise<readonly string[]> {
  const nodes = (await allProjectionPages(workspace, "review", "nodes", limit)) as Readonly<{
    values: readonly [string, unknown][];
  }>;
  return nodes.values.map(([nodeId]) => nodeId);
}

async function allReviewHunks(workspace: Workspace, limit: number): Promise<readonly unknown[]> {
  const hunks: unknown[] = [];
  let after: string | undefined;
  do {
    const page = await workspace.query({
      kind: "review",
      workspaceId: "workspace",
      ...(after === undefined ? {} : { after }),
      limit,
    });
    hunks.push(...page.hunks);
    after = page.next ?? undefined;
  } while (after !== undefined);
  return hunks;
}

async function allConflicts(workspace: Workspace, limit: number): Promise<readonly unknown[]> {
  const issues: unknown[] = [];
  let after: string | undefined;
  do {
    const page = await workspace.query({
      kind: "conflicts",
      workspaceId: "workspace",
      ...(after === undefined ? {} : { after }),
      limit,
    });
    issues.push(...page.issues);
    after = page.next ?? undefined;
  } while (after !== undefined);
  return issues;
}

async function allSupertagInstances(
  workspace: Workspace,
  perspective: ProjectionPerspective,
  supertagId: string,
  limit: number,
): Promise<readonly string[]> {
  const nodeIds: string[] = [];
  let after: string | undefined;
  do {
    const page = await workspace.query({
      kind: "supertag-instances",
      workspaceId: "workspace",
      perspective,
      supertagId,
      ...(after === undefined ? {} : { after }),
      limit,
    });
    nodeIds.push(...page.nodeIds);
    after = page.next ?? undefined;
  } while (after !== undefined);
  return nodeIds;
}

async function allBacklinks(
  workspace: Workspace,
  perspective: ProjectionPerspective,
  targetNodeId: string,
  limit: number,
): Promise<readonly unknown[]> {
  const backlinks: unknown[] = [];
  let after: string | undefined;
  do {
    const page = await workspace.query({
      kind: "backlinks",
      workspaceId: "workspace",
      perspective,
      targetNodeId,
      ...(after === undefined ? {} : { after }),
      limit,
    });
    backlinks.push(...page.backlinks);
    after = page.next ?? undefined;
  } while (after !== undefined);
  return backlinks;
}

async function allSearchResults(
  workspace: Workspace,
  perspective: ProjectionPerspective,
  searchNodeId: string,
  limit: number,
): Promise<unknown> {
  const results: unknown[] = [];
  let available: boolean | undefined;
  let after: string | undefined;
  do {
    const page = await workspace.query({
      kind: "search-results",
      workspaceId: "workspace",
      perspective,
      searchNodeId,
      ...(after === undefined ? {} : { after }),
      limit,
    });
    available ??= page.available;
    results.push(...page.results);
    after = page.next ?? undefined;
  } while (after !== undefined);
  return { available: available ?? false, results };
}

async function allViewRows(
  workspace: Workspace,
  perspective: ProjectionPerspective,
  hostNodeId: string,
  limit: number,
): Promise<unknown> {
  const rows: unknown[] = [];
  let shape: unknown;
  let after: string | undefined;
  do {
    const page = await workspace.query({
      kind: "view-rows",
      workspaceId: "workspace",
      perspective,
      hostNodeId,
      ...(after === undefined ? {} : { after }),
      limit,
    });
    shape ??= {
      available: page.available,
      viewDefinitionNodeId: page.viewDefinitionNodeId,
      viewType: page.viewType,
      options: page.options,
      optionsConflicted: page.optionsConflicted,
    };
    rows.push(...page.rows);
    after = page.next ?? undefined;
  } while (after !== undefined);
  return { shape: shape ?? null, rows };
}

async function allOutlineRows(
  workspace: Workspace,
  perspective: ProjectionPerspective,
  rootNodeId: string,
  limit: number,
): Promise<unknown> {
  const rows: unknown[] = [];
  let available: boolean | undefined;
  let after: string | undefined;
  do {
    const page = await workspace.query({
      kind: "outline",
      workspaceId: "workspace",
      perspective,
      rootNodeId,
      maxDepth: 8,
      ...(after === undefined ? {} : { after }),
      limit,
    });
    available ??= page.available;
    rows.push(...page.rows);
    after = page.next ?? undefined;
  } while (after !== undefined);
  return { available: available ?? false, rows };
}
