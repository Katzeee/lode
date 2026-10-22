import { canonicalJson, workspaceGenesisActions, type Fact } from "../../../domain/fact/index.js";

export function workspaceGenesisFact(workspaceId: string, facts: readonly Fact[]): Fact {
  const matches = facts.flatMap((fact) => {
    if (fact.body.kind !== "action" || fact.body.intent !== "direct") {
      return [];
    }
    const bootstrapCount = fact.body.actions.filter(
      (action) => action.kind === "workspace-bootstrap" && action.workspaceNodeId === workspaceId,
    ).length;
    return bootstrapCount === 0 ? [] : [{ fact, bootstrapCount }];
  });
  if (matches.length !== 1 || matches[0]?.bootstrapCount !== 1) {
    throw new Error("Workspace authority must contain exactly one Workspace bootstrap action");
  }

  const genesis = matches[0].fact;
  if (genesis.body.kind !== "action") {
    throw new Error("Workspace bootstrap Fact does not establish the complete Workspace system structure");
  }
  const actual = new Set(genesis.body.actions.map((action) => canonicalJson(action)));
  const required = workspaceGenesisActions(workspaceId);
  if (required.some((action) => !actual.has(canonicalJson(action)))) {
    throw new Error("Workspace bootstrap Fact does not establish the complete Workspace system structure");
  }
  return genesis;
}
