import { describe, expect, expectTypeOf, it } from "vitest";

import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { BoundedMaterializedStore } from "./bounded-materialized-store.js";
import {
  defineMaterializedDataset,
  materializedDatasetCatalog,
  materializedDatasetEntry,
} from "./materialized-dataset.js";
import { projectionMaterializedDataset } from "./projection-materialized-dataset.js";

const stringListDataset = defineMaterializedDataset<readonly string[]>(
  { dataset: "test", partition: "read-model", section: "references" },
  (_identity, value): value is readonly string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string"),
);

describe("materialized datasets", () => {
  it("binds a dataset value type to entries written through its descriptor", () => {
    const entry = materializedDatasetEntry(stringListDataset, "source", ["target"]);

    expectTypeOf(entry.value).toEqualTypeOf<readonly string[]>();
    expect(stringListDataset.isValue(entry.identity, entry.value)).toBe(true);
    expect(stringListDataset.isValue(entry.identity, { target: true })).toBe(false);
  });

  it("rejects duplicate roots while composing independently owned datasets", () => {
    expect(() =>
      materializedDatasetCatalog(
        [stringListDataset, stringListDataset],
        (value): value is { generationId: string } =>
          typeof value === "object" && value !== null && "generationId" in value,
      ),
    ).toThrow("Materialized dataset root is declared twice");
  });

  it("validates persisted Projection entries with the domain-owned section shape", () => {
    const conflicts = projectionMaterializedDataset("origin", "conflictIssues");

    expect(
      conflicts.isValue("conflict", {
        kind: "schema-extension-cycle",
        identity: "conflict",
        schemaIds: ["schema-a", "schema-b"],
      }),
    ).toBe(true);
    expect(conflicts.isValue("conflict", { kind: "schema-extension-cycle", identity: "conflict" })).toBe(false);
    expect(
      conflicts.isValue("another-conflict", {
        kind: "schema-extension-cycle",
        identity: "conflict",
        schemaIds: ["schema-a", "schema-b"],
      }),
    ).toBe(false);
  });

  it("validates a shard once before trusting its private cache", async () => {
    let validations = 0;
    const dataset = defineMaterializedDataset<readonly string[]>(
      { dataset: "test", partition: "cache", section: "references" },
      (_identity, value): value is readonly string[] => {
        validations += 1;
        return Array.isArray(value) && value.every((item) => typeof item === "string");
      },
    );
    const catalog = materializedDatasetCatalog(
      [dataset],
      (value, generationId): value is { generationId: string } =>
        typeof value === "object" && value !== null && "generationId" in value && value.generationId === generationId,
    );
    const documents = new InMemoryDocumentStore();
    const published = new BoundedMaterializedStore(documents, catalog, 4);
    await published.publish({ generationId: "generation" }, [materializedDatasetEntry(dataset, "source", ["target"])]);
    expect(validations).toBe(1);

    await published.read("generation", (generation) => generation.all(dataset));
    expect(validations).toBe(1);

    const reopened = new BoundedMaterializedStore(documents, catalog, 4);
    await reopened.read("generation", (generation) => generation.all(dataset));
    expect(validations).toBe(2);
    await reopened.read("generation", (generation) => generation.all(dataset));
    expect(validations).toBe(2);
  });
});
