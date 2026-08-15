import type { FactSnapshot, Mutation } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { fieldMutationEvidence } from "./field.js";
import { nodeMutationEvidence } from "./node.js";
import { occurrenceMutationEvidence } from "./occurrence.js";
import { schemaMutationEvidence } from "./schema-family.js";
import { templateMutationEvidence } from "./template.js";
import { textMutationEvidence } from "./text.js";
import { valueMutationEvidence } from "./value.js";

export type MutationEvidenceContext = Readonly<{
  snapshot: FactSnapshot;
  projections(): Readonly<{
    previous: ScopedProjection;
    available: ScopedProjection;
  }>;
}>;

type MutationOf<Kind extends Mutation["kind"]> = Extract<Mutation, { kind: Kind }>;

export type MutationEvidenceFamily<Kind extends Mutation["kind"] = Mutation["kind"]> = Readonly<{
  key: string;
  mutationKinds: readonly Kind[];
  complete(mutation: MutationOf<Kind>, context: MutationEvidenceContext): MutationOf<Kind>;
  validate(mutation: MutationOf<Kind>, context: MutationEvidenceContext): void;
}>;

const MUTATION_EVIDENCE_FAMILIES = [
  nodeMutationEvidence,
  occurrenceMutationEvidence,
  schemaMutationEvidence,
  templateMutationEvidence,
  fieldMutationEvidence,
  textMutationEvidence,
  valueMutationEvidence,
] as const;

type OwnedMutationKind = (typeof MUTATION_EVIDENCE_FAMILIES)[number]["mutationKinds"][number];
type AssertNever<Value extends never> = Value;
export type MutationEvidenceOwnershipIsComplete = AssertNever<Exclude<Mutation["kind"], OwnedMutationKind>>;

const FAMILY_BY_MUTATION = compileMutationEvidenceFamilies(MUTATION_EVIDENCE_FAMILIES);

export function completeMutationEvidence(mutation: Mutation, context: MutationEvidenceContext): Mutation {
  return familyFor(mutation.kind).complete(mutation, context);
}

export function validateMutationEvidence(mutation: Mutation, context: MutationEvidenceContext): void {
  familyFor(mutation.kind).validate(mutation, context);
}

function familyFor(kind: Mutation["kind"]): MutationEvidenceFamily {
  const family = FAMILY_BY_MUTATION.get(kind);
  if (!family) {
    throw new Error(`Mutation evidence has no family owner: ${kind}`);
  }
  return family;
}

function compileMutationEvidenceFamilies(
  families: readonly MutationEvidenceFamily[],
): ReadonlyMap<Mutation["kind"], MutationEvidenceFamily> {
  const byMutation = new Map<Mutation["kind"], MutationEvidenceFamily>();
  for (const family of families) {
    for (const kind of family.mutationKinds) {
      const owner = byMutation.get(kind);
      if (owner) {
        throw new Error(`Mutation evidence ${kind} has duplicate family owners: ${owner.key}, ${family.key}`);
      }
      byMutation.set(kind, family);
    }
  }
  return byMutation;
}
