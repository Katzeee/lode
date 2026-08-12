import { stableStringCompare, type ContributionFact } from "../fact/index.js";
import type { DefinitionStatus } from "./projection-types.js";

export function projectDefinitionStatuses(
  active: readonly ContributionFact[],
  activeNodeIds: ReadonlySet<string>,
  deletionFactIds: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, DefinitionStatus>> {
  const kinds = new Map<string, Set<"schema" | "field">>();
  const add = (definitionId: string, kind: "schema" | "field") => {
    const definitions = kinds.get(definitionId) ?? new Set();
    definitions.add(kind);
    kinds.set(definitionId, definitions);
  };
  for (const fact of active) {
    const mutation = fact.body.mutation;
    switch (mutation.kind) {
      case "schema-apply":
      case "schema-remove":
        add(mutation.schemaId, "schema");
        break;
      case "schema-field-add":
      case "schema-field-remove":
      case "schema-field-configure":
        add(mutation.schemaId, "schema");
        add(mutation.fieldDefinitionId, "field");
        break;
      case "schema-extension-add":
      case "schema-extension-remove":
        add(mutation.schemaId, "schema");
        add(mutation.baseSchemaId, "schema");
        break;
      case "schema-template-node-add":
      case "schema-template-node-remove":
        add(mutation.schemaId, "schema");
        break;
      case "field-materialize":
      case "field-value-delete":
      case "materialized-field-delete":
        add(mutation.fieldDefinitionId, "field");
        break;
      case "field-initialize":
        add(mutation.schemaId, "schema");
        add(mutation.fieldDefinitionId, "field");
        break;
      case "node-create":
      case "node-delete":
      case "node-restore":
      case "occurrence-create":
      case "occurrence-delete":
      case "occurrence-restore":
      case "occurrence-move":
      case "canonical-occurrence-set":
      case "text-splice":
      case "text-mark":
      case "value-set":
      case "value-unset":
      case "template-node-detach":
        break;
    }
  }
  return Object.fromEntries(
    [...kinds]
      .sort(([left], [right]) => stableStringCompare(left, right))
      .map(([definitionId, definitionKinds]) => {
        const deleted = deletionFactIds.get(definitionId) ?? [];
        return [
          definitionId,
          {
            definitionId,
            kinds: [...definitionKinds].sort(stableStringCompare),
            state: activeNodeIds.has(definitionId) ? "active" : "deleted",
            deletionFactIds: [...deleted].sort(stableStringCompare),
          },
        ];
      }),
  );
}
