import {
  canonicalJson,
  factActionContributions,
  factObserves,
  SELF_FACT_ACTION,
  type CollectionContribution,
  type CollectionName,
  type ActionKindAddingToCollection,
  type FactAction,
  type FactActionId,
  type FactActionOf,
} from "../fact/index.js";

export type CausalCollectionRegisterState = Readonly<{
  values: readonly unknown[];
  candidates: readonly FactAction[];
  conflicted: boolean;
}>;

type UntypedCausalCollectionState = Readonly<{
  addition: FactAction;
  entryId: FactActionId;
  key: string;
  removed: boolean;
  registers: ReadonlyMap<string, CausalCollectionRegisterState>;
}>;

export type CausalCollectionState<Collection extends CollectionName> = Omit<UntypedCausalCollectionState, "addition"> &
  Readonly<{ addition: FactActionOf<ActionKindAddingToCollection<Collection>> }>;

type BoundContribution = Readonly<{
  fact: FactAction;
  contribution:
    | Readonly<{
        operation: "add";
        key: string;
        entryId: FactActionId;
        initialRegisters?: Readonly<Record<string, unknown>>;
      }>
    | Exclude<CollectionContribution, Readonly<{ operation: "add" }>>;
}>;

const statesByFacts = new WeakMap<
  readonly FactAction[],
  Map<CollectionName, readonly UntypedCausalCollectionState[]>
>();

export function causalCollectionStates<Collection extends CollectionName>(
  facts: readonly FactAction[],
  collection: Collection,
): readonly CausalCollectionState<Collection>[] {
  const cached = statesByFacts.get(facts)?.get(collection);
  if (cached !== undefined) {
    return cached as readonly CausalCollectionState<Collection>[];
  }
  const states = deriveCausalCollectionStates(facts, collection);
  const byCollection = statesByFacts.get(facts) ?? new Map<CollectionName, readonly UntypedCausalCollectionState[]>();
  byCollection.set(collection, states);
  statesByFacts.set(facts, byCollection);
  return states as readonly CausalCollectionState<Collection>[];
}

function deriveCausalCollectionStates(
  facts: readonly FactAction[],
  collection: CollectionName,
): readonly UntypedCausalCollectionState[] {
  const contributions = facts.flatMap((fact) => collectionContributions(fact, collection));
  const additions = contributions.filter(isOperation("add"));
  const removals = contributions.filter(isOperation("remove-observed"));
  const restores = contributions.filter(isOperation("restore"));
  const registers = contributions.filter(isOperation("register"));

  return additions.map(({ fact: addition, contribution }) => {
    const supports = [
      addition,
      ...restores
        .filter((restore) => restore.contribution.entryId === contribution.entryId)
        .map((restore) => restore.fact),
    ];
    const removed = supports.every((support) =>
      removals.some((removal) => removal.contribution.key === contribution.key && observes(removal.fact, support)),
    );
    const registerNames = new Set([
      ...Object.keys(contribution.initialRegisters ?? {}),
      ...registers
        .filter((register) => register.contribution.entryId === contribution.entryId)
        .map((register) => register.contribution.register),
    ]);
    const registerStates = new Map(
      [...registerNames].map((name) => {
        const candidates = causalMaxima(
          registers.filter(
            (register) =>
              register.contribution.entryId === contribution.entryId && register.contribution.register === name,
          ),
        );
        const initial = contribution.initialRegisters?.[name];
        const values = candidates.length === 0 ? (initial === undefined ? [] : [initial]) : candidates.map(valueOf);
        const unique = new Map(values.map((value) => [canonicalJson(value), value]));
        return [
          name,
          {
            values: [...unique.values()],
            candidates: candidates.map((candidate) => candidate.fact),
            conflicted: unique.size > 1,
          },
        ] as const;
      }),
    );
    return {
      addition,
      entryId: contribution.entryId,
      key: contribution.key,
      removed,
      registers: registerStates,
    };
  });
}

function collectionContributions(fact: FactAction, collection: CollectionName): readonly BoundContribution[] {
  return factActionContributions(fact)
    .filter(
      (contribution): contribution is CollectionContribution =>
        contribution.kind === "causal-collection" && contribution.collection === collection,
    )
    .map((contribution) => ({ fact, contribution: bindSelfReference(contribution, fact.id) }));
}

function bindSelfReference(
  contribution: CollectionContribution,
  actionId: FactActionId,
): BoundContribution["contribution"] {
  if (contribution.operation !== "add") {
    return contribution;
  }
  return {
    operation: "add",
    key: contribution.key === SELF_FACT_ACTION ? actionId : contribution.key,
    entryId: actionId,
    ...(contribution.initialRegisters === undefined ? {} : { initialRegisters: contribution.initialRegisters }),
  };
}

function isOperation<Operation extends BoundContribution["contribution"]["operation"]>(operation: Operation) {
  return (
    value: BoundContribution,
  ): value is BoundContribution &
    Readonly<{ contribution: Extract<BoundContribution["contribution"], { operation: Operation }> }> =>
    value.contribution.operation === operation;
}

function valueOf(
  contribution: BoundContribution &
    Readonly<{ contribution: Extract<BoundContribution["contribution"], { operation: "register" }> }>,
): unknown {
  return contribution.contribution.value;
}

function causalMaxima<Contribution extends BoundContribution>(
  values: readonly Contribution[],
): readonly Contribution[] {
  return values.filter(
    (candidate) => !values.some((other) => other.fact.id !== candidate.fact.id && observes(other.fact, candidate.fact)),
  );
}

function observes(observer: FactAction, observed: FactAction): boolean {
  return observer.factId === observed.factId ? observer.index > observed.index : factObserves(observer, observed);
}
