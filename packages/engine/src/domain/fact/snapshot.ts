import { compareCausalOrder, frontierOf, normalizeFrontier } from "./frontier.js";
import { validateStaticFact } from "./static-validation.js";
import { type Fact, type FactSnapshot, type WorkspaceId } from "./types.js";

export function buildFactSnapshot(
  workspaceId: WorkspaceId,
  source: readonly Fact[],
  authorityFrontier?: FactSnapshot["frontier"],
): FactSnapshot {
  const facts = [...source];
  facts.forEach((fact) => validateStaticFact(workspaceId, fact));
  facts.sort(compareCausalOrder);
  return {
    facts,
    frontier: normalizeFrontier(authorityFrontier ?? frontierOf(facts)),
  };
}
