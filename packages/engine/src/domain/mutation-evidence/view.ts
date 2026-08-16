import { canonicalJson, type ViewMutation } from "../fact/index.js";
import type { MutationEvidenceFamily } from "./policy.js";
import { assertEvidenceEqual } from "./evidence-validation.js";

const VIEW_MUTATION_KINDS = [
  "shared-default-view-definition-attach",
  "shared-default-view-definition-mode-set",
] as const satisfies readonly ViewMutation["kind"][];

export const viewMutationEvidence = {
  key: "view",
  mutationKinds: VIEW_MUTATION_KINDS,
  complete(mutation, context) {
    if (mutation.kind === "shared-default-view-definition-attach") {
      return mutation;
    }
    if (mutation.previousViewType !== undefined && mutation.observedModeFactIds !== undefined) {
      return mutation;
    }
    const definition = Object.values(context.projections().available.sharedDefaultViewDefinitions)
      .flat()
      .find((candidate) => candidate.viewDefinitionNodeId === mutation.viewDefinitionNodeId);
    return {
      ...mutation,
      previousViewType: definition?.viewType ?? null,
      observedModeFactIds: definition?.modeContributionIds ?? [],
    };
  },
  validate(mutation, context) {
    if (mutation.kind === "shared-default-view-definition-attach") {
      return;
    }
    const expected = viewMutationEvidence.complete(
      { ...mutation, previousViewType: undefined, observedModeFactIds: undefined },
      context,
    );
    if (expected.kind !== "shared-default-view-definition-mode-set") {
      throw new Error("View mode evidence resolved to another mutation kind");
    }
    assertEvidenceEqual(expected.previousViewType, mutation.previousViewType, "View previous mode");
    if (
      canonicalJson([...(expected.observedModeFactIds ?? [])].sort()) !==
      canonicalJson([...(mutation.observedModeFactIds ?? [])].sort())
    ) {
      throw new Error("View mode Fact evidence does not match the observed projection");
    }
  },
} satisfies MutationEvidenceFamily<(typeof VIEW_MUTATION_KINDS)[number]>;
