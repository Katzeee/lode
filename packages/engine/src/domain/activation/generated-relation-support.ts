import { factObserves, type FactAction, type AuthoredAction } from "../fact/index.js";
import { addTemplateDetachmentSupport, type SupertagSupportContext } from "./supertag-support.js";
import { addIfPresent, effectiveCandidate } from "./support-candidate.js";

type ExistenceSupport = Readonly<{
  nodes: Map<string, string[]>;
  occurrences: Map<string, string[]>;
  viable: Set<string>;
}>;

type OccurrenceLifecycleFacts = ReadonlyMap<string, readonly FactAction[]>;

export function addTemplateNodeSupport(
  support: Set<string>,
  authoredAction: Extract<AuthoredAction, { kind: "template-node-detach" }>,
  fact: FactAction,
  supertagSupport: SupertagSupportContext,
  existence: ExistenceSupport,
): void {
  addTemplateDetachmentSupport(support, authoredAction, fact, supertagSupport);
  addIfPresent(support, effectiveCandidate(existence.nodes, authoredAction.instanceNodeId, existence.viable));
}

export function addGeneratedOccurrenceSupport(
  support: Set<string>,
  authoredAction: AuthoredAction,
  fact: FactAction,
  lifecycleFacts: OccurrenceLifecycleFacts,
): void {
  const expected = generatedOccurrenceEffect(authoredAction);
  if (expected === null) {
    return;
  }
  const candidate = lifecycleFacts
    .get(`${expected.kind}/${expected.placementId}`)
    ?.find((lifecycle) => factObserves(lifecycle, fact));
  if (candidate !== undefined) {
    support.add(candidate.id);
  }
}

function generatedOccurrenceEffect(
  authoredAction: AuthoredAction,
): Readonly<{ kind: "placement-create" | "placement-remove"; placementId: string }> | null {
  return authoredAction.kind === "template-node-detach"
    ? { kind: "placement-create", placementId: authoredAction.instanceOccurrenceId }
    : null;
}
