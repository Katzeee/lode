import { compareFacts, type ContributionFact, type Mutation } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateSchemaMutation(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
  projection: Projection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (!isSchemaRelation(mutation)) {
    return noCompensation();
  }
  if (hasLaterRelationEdit(target, activeFacts)) {
    return noCompensation();
  }
  if (mutation.kind === "schema-apply") {
    return contains(projection, mutation)
      ? ready({
          kind: "schema-remove",
          nodeId: mutation.nodeId,
          schemaId: mutation.schemaId,
          previousAnchor: currentAnchor(
            projection.schemaApplications[mutation.nodeId] ?? [],
            mutation.schemaId,
          ),
        })
      : noCompensation();
  }
  if (mutation.kind === "schema-remove") {
    return !contains(projection, mutation) && mutation.previousAnchor
      ? ready({
          kind: "schema-apply",
          nodeId: mutation.nodeId,
          schemaId: mutation.schemaId,
          anchor: mutation.previousAnchor,
        })
      : noCompensation();
  }
  if (mutation.kind === "schema-field-add") {
    return contains(projection, mutation)
      ? ready({
          kind: "schema-field-remove",
          schemaId: mutation.schemaId,
          fieldDefinitionId: mutation.fieldDefinitionId,
          previousAnchor: currentAnchor(
            projection.schemaFields[mutation.schemaId] ?? [],
            mutation.fieldDefinitionId,
          ),
        })
      : noCompensation();
  }
  if (mutation.kind === "schema-field-remove") {
    return !contains(projection, mutation) && mutation.previousAnchor
      ? ready({
          kind: "schema-field-add",
          schemaId: mutation.schemaId,
          fieldDefinitionId: mutation.fieldDefinitionId,
          anchor: mutation.previousAnchor,
        })
      : noCompensation();
  }
  if (mutation.kind === "schema-field-configure") {
    return mutation.previousConfig == null
      ? noCompensation()
      : ready({
          kind: "schema-field-configure",
          schemaId: mutation.schemaId,
          fieldDefinitionId: mutation.fieldDefinitionId,
          config: mutation.previousConfig,
          previousConfig: mutation.config,
          observedConfigFactIds: [target.id],
        });
  }
  if (mutation.kind === "schema-extension-add") {
    return contains(projection, mutation)
      ? ready({
          kind: "schema-extension-remove",
          schemaId: mutation.schemaId,
          baseSchemaId: mutation.baseSchemaId,
          previousAnchor: currentAnchor(
            projection.schemaExtensions[mutation.schemaId] ?? [],
            mutation.baseSchemaId,
          ),
        })
      : noCompensation();
  }
  if (mutation.kind === "schema-extension-remove") {
    return !contains(projection, mutation) && mutation.previousAnchor
      ? ready({
          kind: "schema-extension-add",
          schemaId: mutation.schemaId,
          baseSchemaId: mutation.baseSchemaId,
          anchor: mutation.previousAnchor,
        })
      : noCompensation();
  }
  return compensateTemplateNodeRelation(mutation, projection);
}

function compensateTemplateNodeRelation(
  mutation: Extract<Mutation, { kind: "schema-template-node-add" | "schema-template-node-remove" }>,
  projection: Projection,
): CompensationStep {
  if (mutation.kind === "schema-template-node-add") {
    return contains(projection, mutation)
      ? ready({
          kind: "schema-template-node-remove",
          schemaId: mutation.schemaId,
          templateNodeId: mutation.templateNodeId,
          previousAnchor: currentAnchor(
            projection.schemaTemplateNodes[mutation.schemaId] ?? [],
            mutation.templateNodeId,
          ),
        })
      : noCompensation();
  }
  return !contains(projection, mutation) && mutation.previousAnchor
    ? ready({
        kind: "schema-template-node-add",
        schemaId: mutation.schemaId,
        templateNodeId: mutation.templateNodeId,
        anchor: mutation.previousAnchor,
      })
    : noCompensation();
}

function ready(mutation: Mutation): CompensationStep {
  return { kind: "ready", mutations: [mutation] };
}

function contains(
  projection: Projection,
  mutation: Extract<Mutation, { kind: `schema-${string}` }>,
): boolean {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return (projection.schemaApplications[mutation.nodeId] ?? []).includes(mutation.schemaId);
  }
  if (
    mutation.kind === "schema-field-add" ||
    mutation.kind === "schema-field-remove" ||
    mutation.kind === "schema-field-configure"
  ) {
    return (projection.schemaFields[mutation.schemaId] ?? []).includes(mutation.fieldDefinitionId);
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    return (projection.schemaExtensions[mutation.schemaId] ?? []).includes(mutation.baseSchemaId);
  }
  return (projection.schemaTemplateNodes[mutation.schemaId] ?? []).includes(
    mutation.templateNodeId,
  );
}

function currentAnchor(identities: readonly string[], identity: string) {
  const index = identities.indexOf(identity);
  return {
    after: identities[index - 1] ?? null,
    before: identities[index + 1] ?? null,
    affinity: index === 0 ? ("before" as const) : ("after" as const),
    fallback: index === 0 ? ("start" as const) : ("end" as const),
  };
}

function isSchemaRelation(
  mutation: Mutation,
): mutation is Extract<Mutation, { kind: `schema-${string}` }> {
  return mutation.kind.startsWith("schema-");
}

function hasLaterRelationEdit(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
): boolean {
  const mutation = target.body.mutation;
  if (!isSchemaRelation(mutation)) {
    return false;
  }
  return activeFacts.some(
    (fact) =>
      compareFacts(target, fact) < 0 &&
      isSchemaRelation(fact.body.mutation) &&
      relationOwner(fact.body.mutation) === relationOwner(mutation),
  );
}

function relationOwner(mutation: Extract<Mutation, { kind: `schema-${string}` }>): string {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return JSON.stringify(["application", mutation.nodeId, mutation.schemaId]);
  }
  if (
    mutation.kind === "schema-field-add" ||
    mutation.kind === "schema-field-remove" ||
    mutation.kind === "schema-field-configure"
  ) {
    return JSON.stringify(["field", mutation.schemaId, mutation.fieldDefinitionId]);
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    return JSON.stringify(["extension", mutation.schemaId, mutation.baseSchemaId]);
  }
  return JSON.stringify(["template-node", mutation.schemaId, mutation.templateNodeId]);
}
