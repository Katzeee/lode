import type { OptionalFieldContribution, TemplateField } from "@lode/sdk";

import type { ProductCommandRun } from "../command/index.js";
import { workspaceIdOf } from "../intent/index.js";

export async function readTemplateFields(
  context: Parameters<ProductCommandRun>[0],
  supertagId: string,
): Promise<readonly TemplateField[]> {
  const fields = await context.session.readProjection(workspaceIdOf(context), context.perspective, "templateFields");
  return fields[supertagId] ?? [];
}

export async function readOptionalContributions(
  context: Parameters<ProductCommandRun>[0],
  supertagId: string,
): Promise<readonly OptionalFieldContribution[]> {
  const contributions = await context.session.readProjection(
    workspaceIdOf(context),
    context.perspective,
    "optionalFieldContributions",
  );
  return contributions[supertagId] ?? [];
}
