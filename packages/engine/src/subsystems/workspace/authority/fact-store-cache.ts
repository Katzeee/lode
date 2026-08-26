import {
  buildFactSnapshot,
  compareCausalOrder,
  normalizeFrontier,
  validateStaticFact,
  type FactFrontier,
  type FactActionId,
  type FactId,
  type Fact,
  type FactSnapshot,
} from "../../../domain/fact/index.js";
import { FactQueryIndex } from "./fact-query-index.js";

export class FactStoreCache {
  private snapshotValue!: FactSnapshot;
  private index = FactQueryIndex.build([]);

  constructor(private readonly workspaceId: string) {}

  refresh(facts: readonly Fact[], authorityFrontier?: FactFrontier): void {
    const snapshot = buildFactSnapshot(this.workspaceId, facts, authorityFrontier);
    this.snapshotValue = snapshot;
    this.index = FactQueryIndex.build(snapshot.facts);
  }

  previewAppend(facts: readonly Fact[], authorityFrontier: FactFrontier): FactSnapshot {
    facts.forEach((fact) => validateStaticFact(this.workspaceId, fact));
    return {
      facts: mergeFacts(this.snapshotValue.facts, [...facts].sort(compareCausalOrder)),
      frontier: normalizeFrontier(authorityFrontier),
    };
  }

  append(facts: readonly Fact[], snapshot: FactSnapshot): void {
    this.snapshotValue = snapshot;
    this.index.append(facts);
  }

  snapshot(): FactSnapshot {
    return this.snapshotValue;
  }

  allFacts(): readonly Fact[] {
    return this.snapshotValue.facts;
  }

  facts(factIds: readonly FactId[]): readonly Fact[] {
    return this.index.facts(factIds);
  }

  factsOwningActions(actionIds: readonly FactActionId[]): readonly Fact[] {
    return this.index.factsOwningActions(actionIds);
  }

  relatedFacts(factIds: readonly FactId[]): readonly Fact[] {
    return this.index.relatedFacts(factIds);
  }

  relatedFactsOwningActions(actionIds: readonly FactActionId[]): readonly Fact[] {
    return this.index.relatedFactsOwningActions(actionIds);
  }
}

function mergeFacts(left: readonly Fact[], right: readonly Fact[]): readonly Fact[] {
  const result: Fact[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftFact = left[leftIndex];
    const rightFact = right[rightIndex];
    if (leftFact === undefined || rightFact === undefined) {
      throw new Error("Sorted Fact merge lost an entry");
    }
    if (compareCausalOrder(leftFact, rightFact) <= 0) {
      result.push(leftFact);
      leftIndex += 1;
    } else {
      result.push(rightFact);
      rightIndex += 1;
    }
  }
  result.push(...left.slice(leftIndex), ...right.slice(rightIndex));
  return result;
}
