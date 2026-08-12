import { canonicalJson, type Mutation, type SequenceAnchor } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateSchemaEvidence(
  mutation: Extract<Mutation, { kind: `schema-${string}` }>,
  previous: Projection,
  available: Projection,
): void {
  requireNode(available, mutation.schemaId, "Schema");
  if (mutation.kind === "schema-field-configure") {
    requireNode(available, mutation.fieldDefinitionId, "Field Definition");
    const item = available.schemaFieldItems[mutation.schemaId]?.find(
      (candidate) => candidate.fieldDefinitionId === mutation.fieldDefinitionId,
    );
    if (!item) {
      throw new Error("Schema Field is absent from the observed projection");
    }
    const observedIds = item.configCandidates.flatMap((candidate) => candidate.contributionIds);
    if (
      canonicalJson([...observedIds].sort()) !==
      canonicalJson([...(mutation.observedConfigFactIds ?? [])].sort())
    ) {
      throw new Error("Field config Fact evidence does not match the observed projection");
    }
    if (canonicalJson(item.effectiveConfig) !== canonicalJson(mutation.previousConfig)) {
      throw new Error("Field previous config does not match the observed projection");
    }
    return;
  }
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    requireNode(available, mutation.nodeId, "Schema application target");
    validateRelation(
      available.schemaApplications[mutation.nodeId] ?? [],
      previous.schemaApplications[mutation.nodeId] ?? [],
      mutation.schemaId,
      mutation.kind === "schema-apply" ? mutation.anchor : mutation.previousAnchor,
      mutation.kind === "schema-apply",
      "Schema Application",
    );
    return;
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    requireNode(available, mutation.baseSchemaId, "Base Schema");
    validateRelation(
      available.schemaExtensions[mutation.schemaId] ?? [],
      previous.schemaExtensions[mutation.schemaId] ?? [],
      mutation.baseSchemaId,
      mutation.kind === "schema-extension-add" ? mutation.anchor : mutation.previousAnchor,
      mutation.kind === "schema-extension-add",
      "Schema Extension",
    );
    return;
  }
  requireNode(available, mutation.fieldDefinitionId, "Field Definition");
  validateRelation(
    available.schemaFields[mutation.schemaId] ?? [],
    previous.schemaFields[mutation.schemaId] ?? [],
    mutation.fieldDefinitionId,
    mutation.kind === "schema-field-add" ? mutation.anchor : mutation.previousAnchor,
    mutation.kind === "schema-field-add",
    "Schema Field",
  );
}

function validateRelation(
  available: readonly string[],
  previous: readonly string[],
  identity: string,
  anchor: SequenceAnchor | undefined,
  adding: boolean,
  label: string,
): void {
  if (adding) {
    if (
      !anchor ||
      [anchor.after, anchor.before].some((id) => id !== null && !available.includes(id))
    ) {
      throw new Error(`${label} anchor is absent from the observed projection`);
    }
    return;
  }
  const index = previous.indexOf(identity);
  if (index < 0) {
    throw new Error(`${label} is absent from the observed projection`);
  }
  if (canonicalJson(anchorAt(previous, index)) !== canonicalJson(anchor)) {
    throw new Error(`${label} previous anchor does not match the observed projection`);
  }
}

function requireNode(projection: Projection, nodeId: string, label: string): void {
  if (!projection.nodes[nodeId]) {
    throw new Error(`${label} Node is absent from the observed projection`);
  }
}

function anchorAt(identities: readonly string[], index: number): SequenceAnchor {
  return {
    after: identities[index - 1] ?? null,
    before: identities[index + 1] ?? null,
    affinity: index === 0 ? "before" : "after",
    fallback: index === 0 ? "start" : "end",
  };
}
