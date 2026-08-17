import { isSearchMutation, type ContributionFact } from "../fact/index.js";
import { type CompensationStep } from "./compensation-types.js";

export function compensateSearchMutation(target: ContributionFact): CompensationStep | null {
  const mutation = target.body.mutation;
  if (!isSearchMutation(mutation)) {
    return null;
  }
  if (mutation.kind === "search-expression-attach" && mutation.previousExpression !== undefined) {
    return {
      kind: "ready",
      mutations: [
        {
          ...mutation,
          expression: mutation.previousExpression,
          previousExpression: mutation.expression,
        },
      ],
    };
  }
  if (mutation.kind === "search-expression-attach") {
    const { previousExpression: _previousExpression, ...fields } = mutation;
    return { kind: "ready", mutations: [{ ...fields, kind: "search-expression-detach" }] };
  }
  return {
    kind: "ready",
    mutations: [
      {
        ...mutation,
        kind: "search-expression-attach",
      },
    ],
  };
}
