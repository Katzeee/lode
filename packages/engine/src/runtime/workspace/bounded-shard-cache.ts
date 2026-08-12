import { cacheKey } from "./materialized-generation-format.js";
import type { MaterializedShard } from "./bounded-materializer-types.js";

export class BoundedShardCache {
  private values = new Map<string, MaterializedShard>();

  constructor(private readonly capacity: number) {}

  reset(): void {
    this.values = new Map();
  }

  get(generationId: string, key: string): Readonly<{ hit: boolean; value: unknown }> {
    const indexed = cacheKey(generationId, key);
    const cached = this.values.get(indexed);
    if (cached) {
      this.values.delete(indexed);
      this.values.set(indexed, cached);
    }
    return cached ? { hit: true, value: cached.value } : { hit: false, value: null };
  }

  set(key: string, generationId: string, value: unknown): void {
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

  size(): number {
    return this.values.size;
  }
}
