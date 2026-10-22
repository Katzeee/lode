import {
  parseFactBody,
  factActionsFromFacts,
  type Fact,
  type FactAction,
  type FactSnapshot,
  type GraphAction,
  type HistoryContentSource,
} from "../fact/index.js";
import type { InterpretedProjection } from "../reconcile/index.js";
import { historySteps } from "./state.js";

type Content = InterpretedProjection["nodes"][string]["content"][number];
const sourceKey = (source: HistoryContentSource) => `${source.factActionId}|${source.id}`;

/** Restored identities are aliases only inside the compensated History basis. */
export function contentAttribution(snapshot: FactSnapshot, neutralized: ReadonlySet<string>) {
  const sources = new Map<string, HistoryContentSource>();
  const atomSources = new Map<string, string>();
  for (const step of historySteps(snapshot)) {
    for (const restoration of step.body.restorations) {
      const fact = step.actionFacts[restoration.factIndex];
      if (!fact || !neutralized.has(fact.id)) {
        continue;
      }
      const action = factActionsFromFacts([fact])[restoration.actionIndex];
      if (!action) {
        throw new Error("History restoration output is absent");
      }
      restoration.sources.forEach((source, index) => {
        const id =
          action.action.kind === "rich-text-splice"
            ? `${action.id}#${index}`
            : action.action.kind === "inline-reference-create"
              ? action.action.inlineReferenceId
              : null;
        if (id === null) {
          throw new Error("History restoration output has no content identity");
        }
        sources.set(sourceKey({ id, factActionId: action.id }), source);
        if (action.action.kind === "rich-text-splice") {
          atomSources.set(id, source.id);
        }
      });
    }
  }
  function resolve(source: HistoryContentSource): HistoryContentSource {
    let current = source;
    const visited = new Set<string>();
    while (sources.has(sourceKey(current))) {
      const key = sourceKey(current);
      if (visited.has(key)) {
        throw new Error("History content provenance contains a cycle");
      }
      visited.add(key);
      current = sources.get(key)!;
    }
    return current;
  }
  function logicalId(id: string): string {
    let current = id;
    const visited = new Set<string>();
    while (atomSources.has(current) && !visited.has(current)) {
      visited.add(current);
      current = atomSources.get(current)!;
    }
    return current;
  }
  const physicalIds = new Map<string, string>();
  return {
    projection(projection: InterpretedProjection): InterpretedProjection {
      return {
        ...projection,
        nodes: Object.fromEntries(
          Object.entries(projection.nodes).map(([nodeId, node]) => [
            nodeId,
            {
              ...node,
              content: node.content.map((item): Content => {
                const source = resolve(item);
                physicalIds.set(source.id, item.id);
                return item.kind === "text"
                  ? { ...item, factActionId: source.factActionId, id: source.id as typeof item.id }
                  : { ...item, ...source };
              }),
            },
          ]),
        ),
      };
    },
    fact(fact: Fact): Fact {
      return fact.body.kind === "action"
        ? {
            ...fact,
            body: parseFactBody({
              ...fact.body,
              actions: fact.body.actions.map((action) => remapContent(action, logicalId)),
            }),
          }
        : fact;
    },
    action(fact: FactAction): FactAction {
      return { ...fact, action: remapContent(fact.action, logicalId) };
    },
    output(action: GraphAction): GraphAction {
      return remapContent(action, (id) => physicalIds.get(id) ?? id);
    },
  };
}

function remapContent<Action extends FactAction["action"]>(action: Action, identity: (id: string) => string): Action {
  if (action.kind === "rich-text-mark") {
    return { ...action, atomIds: action.atomIds.map(identity) };
  }
  if (action.kind === "rich-text-splice" || action.kind === "inline-reference-create") {
    return {
      ...action,
      ...(action.kind === "rich-text-splice" ? { deleteAtomIds: action.deleteAtomIds.map(identity) } : {}),
      anchor: {
        ...action.anchor,
        before: action.anchor.before === null ? null : identity(action.anchor.before),
        after: action.anchor.after === null ? null : identity(action.anchor.after),
      },
    };
  }
  return action;
}
