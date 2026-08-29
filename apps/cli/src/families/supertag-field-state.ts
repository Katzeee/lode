import type { TemplateField } from "@lode/sdk";

import type { ProductCommandRun } from "../catalog/index.js";
import { workspaceIdOf } from "../intent/index.js";

export async function readTemplateFields(
  context: Parameters<ProductCommandRun>[0],
  supertagId: string,
): Promise<readonly TemplateField[]> {
  const fields = (await context.session.readProjection(
    workspaceIdOf(context),
    context.perspective,
    "templateFields",
  )) as Record<string, TemplateField[]>;
  return fields[supertagId] ?? [];
}

export async function readOptionalContributions(
  context: Parameters<ProductCommandRun>[0],
  supertagId: string,
): Promise<readonly { contributionNodeId: string; fieldDefinitionId: string }[]> {
  const contributions = (await context.session.readProjection(
    workspaceIdOf(context),
    context.perspective,
    "optionalFieldContributions",
  )) as Record<string, readonly { contributionNodeId: string; fieldDefinitionId: string }[]>;
  return contributions[supertagId] ?? [];
}
