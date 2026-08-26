import {
  compareCausalOrder,
  factActionContributions,
  factObserves,
  type CollectionName,
  type FactAction,
} from "../fact/index.js";

const SUPPORT_LINKED_COLLECTIONS = [
  "template-member",
  "template-field",
  "optional-field",
] as const satisfies readonly CollectionName[];

type SupportLinkedCollection = (typeof SUPPORT_LINKED_COLLECTIONS)[number];

const SUPPORT_LINKED_COLLECTION_SET = new Set<CollectionName>(SUPPORT_LINKED_COLLECTIONS);

export type CausalCollectionSupportContext = Map<SupportLinkedCollection, Map<string, FactAction[]>>;

export function addCausalCollectionSupport(
  support: Set<string>,
  fact: FactAction,
  context: CausalCollectionSupportContext,
  viable: ReadonlySet<string>,
): void {
  for (const contribution of factActionContributions(fact)) {
    if (
      contribution.kind !== "causal-collection" ||
      !isSupportLinkedCollection(contribution.collection) ||
      (contribution.operation !== "add" && contribution.operation !== "remove-observed") ||
      typeof contribution.key !== "string"
    ) {
      continue;
    }
    const additions = collectionAdditions(context, contribution.collection);
    if (contribution.operation === "add") {
      const candidates = additions.get(contribution.key) ?? [];
      candidates.push(fact);
      additions.set(contribution.key, candidates);
    } else if (contribution.operation === "remove-observed") {
      addLatestObservedSupport(support, additions.get(contribution.key) ?? [], fact, viable);
    }
  }
}

function collectionAdditions(
  context: CausalCollectionSupportContext,
  collection: SupportLinkedCollection,
): Map<string, FactAction[]> {
  const additions = context.get(collection) ?? new Map<string, FactAction[]>();
  context.set(collection, additions);
  return additions;
}

function isSupportLinkedCollection(collection: CollectionName): collection is SupportLinkedCollection {
  return SUPPORT_LINKED_COLLECTION_SET.has(collection);
}

function addLatestObservedSupport(
  support: Set<string>,
  candidates: readonly FactAction[],
  observer: FactAction,
  viable: ReadonlySet<string>,
): void {
  const observed = candidates.filter((candidate) => factObserves(observer, candidate)).sort(compareCausalOrder);
  const candidate = [...observed].reverse().find((value) => viable.has(value.id)) ?? observed.at(-1);
  if (candidate !== undefined) {
    support.add(candidate.id);
  }
}
