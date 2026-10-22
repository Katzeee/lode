import { factActionsFromFacts } from "./fact-actions.js";
import { factObserves } from "./frontier.js";
import { nodeSeedCodepoints } from "./node-create-shape.js";
import type { ActionFact, FactAction, FactId, FactSnapshot, HistoryBody, HistoryContentSource } from "./types.js";

export type HistoryFactStep = Readonly<{ id: FactId; body: HistoryBody; actionFacts: readonly ActionFact[] }>;

/** Validate immutable restoration claims before they influence History attribution. */
export function validateContentRestorations(steps: readonly HistoryFactStep[], snapshot: FactSnapshot): void {
  const actions = new Map(factActionsFromFacts(snapshot.facts).map((action) => [action.id, action]));
  const facts = new Map(snapshot.facts.map((fact) => [fact.id, fact]));
  const seenSteps = new Map<FactId, HistoryFactStep>();
  const restoredAtoms = new Map<string, string>();
  for (const step of steps) {
    const target = step.body.targetStepId === null ? undefined : seenSteps.get(step.body.targetStepId);
    const outputs = factActionsFromFacts(step.actionFacts);
    const claimed = new Set<string>();
    const sourcesUsed = new Set<string>();
    if (step.body.restorations.length > 0 && (!target || target.body.channelId !== step.body.channelId)) {
      throw new Error("History restoration target must precede it in the same channel");
    }
    const targetActions = target ? factActionsFromFacts(target.actionFacts) : [];
    const allowedAtoms = new Set<string>(
      targetActions.flatMap(({ action }) => (action.kind === "rich-text-splice" ? action.deleteAtomIds : [])),
    );
    for (const id of [...allowedAtoms]) {
      let source = restoredAtoms.get(id);
      while (source !== undefined && !allowedAtoms.has(source)) {
        allowedAtoms.add(source);
        source = restoredAtoms.get(source);
      }
    }
    for (const restoration of step.body.restorations) {
      const fact = step.actionFacts[restoration.factIndex];
      const output = fact && factActionsFromFacts([fact])[restoration.actionIndex];
      if (!output || claimed.has(output.id)) {
        throw new Error("History restoration output is absent or repeated");
      }
      const targetFact = target && facts.get(target.id);
      if (!targetFact || !factObserves(output, targetFact)) {
        throw new Error("History restoration must observe its target Step");
      }
      claimed.add(output.id);
      const action = output.action;
      if (
        (action.kind === "rich-text-splice" && [...action.insert].length !== restoration.sources.length) ||
        (action.kind === "inline-reference-create" && restoration.sources.length !== 1) ||
        (action.kind !== "rich-text-splice" && action.kind !== "inline-reference-create")
      ) {
        throw new Error("History restoration sources do not match output identities");
      }
      restoration.sources.forEach((source, index) => {
        const producer = actions.get(source.factActionId);
        const key = `${source.factActionId}|${source.id}`;
        if (!producer || !factObserves(output, producer) || sourcesUsed.has(key)) {
          throw new Error("History restoration source is unobserved or repeated");
        }
        sourcesUsed.add(key);
        if (action.kind === "rich-text-splice") {
          const origin = textSource(producer, source);
          if (
            !allowedAtoms.has(source.id) ||
            !origin ||
            origin.nodeId !== action.nodeId ||
            origin.value !== [...action.insert][index]
          ) {
            throw new Error("History text restoration must identify content removed by its target");
          }
          restoredAtoms.set(`${output.id}#${index}`, source.id);
        } else if (action.kind === "inline-reference-create") {
          const origin = producer.action;
          if (
            origin.kind !== "inline-reference-create" ||
            origin.inlineReferenceId !== source.id ||
            action.inlineReferenceId !== source.id ||
            origin.hostNodeId !== action.hostNodeId ||
            origin.targetNodeId !== action.targetNodeId ||
            !targetActions.some(
              ({ action: targetAction }) =>
                targetAction.kind === "inline-reference-remove" && targetAction.inlineReferenceId === source.id,
            )
          ) {
            throw new Error("History Reference restoration must identify the removed Reference");
          }
        }
      });
    }
    if (
      step.body.operation !== "normal" &&
      outputs.some(
        ({ id, action }) =>
          ((action.kind === "rich-text-splice" && action.insert.length > 0) ||
            action.kind === "inline-reference-create") &&
          !claimed.has(id),
      )
    ) {
      throw new Error("History content restoration requires explicit provenance");
    }
    seenSteps.set(step.id, step);
  }
}

function textSource(producer: FactAction, source: HistoryContentSource): { nodeId: string; value: string } | undefined {
  const prefix = `${producer.id}#`;
  if (!source.id.startsWith(prefix)) {
    return undefined;
  }
  const index = Number(source.id.slice(prefix.length));
  if (!Number.isSafeInteger(index) || index < 0 || source.id !== `${prefix}${index}`) {
    return undefined;
  }
  const action = producer.action;
  if (action.kind === "rich-text-splice") {
    const value = [...action.insert][index];
    return value === undefined ? undefined : { nodeId: action.nodeId, value };
  }
  const seeded =
    action.kind === "node-create"
      ? { nodeId: action.nodeId, seed: action.seed }
      : action.kind === "template-field-add" && action.fieldDefinition.kind === "new"
        ? { nodeId: action.fieldDefinition.fieldDefinitionId, seed: action.fieldDefinition.seed }
        : undefined;
  const value = seeded?.seed ? nodeSeedCodepoints(seeded.seed.text)[index]?.value : undefined;
  return value === undefined || !seeded ? undefined : { nodeId: seeded.nodeId, value };
}

export function historyFactSteps(snapshot: FactSnapshot): readonly HistoryFactStep[] {
  const factsBySequence = new Map(
    snapshot.facts.map((fact) => [`${fact.coordinate.dot.replicaId}/${fact.coordinate.dot.sequence}`, fact]),
  );
  const steps = snapshot.facts.flatMap((fact): HistoryFactStep[] => {
    if (fact.body.kind !== "history") {
      return [];
    }
    const actionFacts: ActionFact[] = [];
    const first = fact.coordinate.dot.sequence - fact.body.actionFactCount;
    for (let sequence = first; sequence < fact.coordinate.dot.sequence; sequence += 1) {
      const owned = factsBySequence.get(`${fact.coordinate.dot.replicaId}/${sequence}`);
      if (!owned || owned.body.kind !== "action") {
        throw new Error(`History Step does not follow its complete Action Fact batch: ${fact.id}`);
      }
      actionFacts.push(owned as ActionFact);
    }
    return [{ id: fact.id, body: fact.body, actionFacts }];
  });
  validateContentRestorations(steps, snapshot);
  return steps;
}
