import { cacheKey } from "./materialized-generation-format.js";

type MaterializedShard = Readonly<{
  key: string;
  generationId: string;
  value: unknown;
}>;

export class BoundedShardCache {
  private values = new Map<string, MaterializedShard>();

  constructor(private readonly capacity: number) {}

  reset(): void {
    this.values = new Map();
  }

  get<Value>(generationId: string, key: string): Readonly<{ hit: true; value: Value }> | Readonly<{ hit: false }> {
    const indexed = cacheKey(generationId, key);
    const cached = this.values.get(indexed);
    if (cached) {
      this.values.delete(indexed);
      this.values.set(indexed, cached);
    }
    // The cache is populated only after the owning materialized dataset accepts the value.
    return cached ? { hit: true, value: cached.value as Value } : { hit: false };
  }

  set<Value>(key: string, generationId: string, value: Value): void {
    const indexed = cacheKey(generationId, key);
    this.values.delete(indexed);
    this.values.set(indexed, { key, generationId, value });
    while (this.values.size > this.capacity) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.values.delete(oldest);
    }
  }
}
