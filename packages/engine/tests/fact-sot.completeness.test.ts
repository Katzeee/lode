import { describe, expect, it } from "vitest";

import { factSotCompletenessProblems, QUERY_ORACLE_ROUTE } from "./support/fact-sot-completeness.js";

describe("Fact source-of-truth completeness", () => {
  it("classifies every authority variant, public result, and schema field", () => {
    expect(factSotCompletenessProblems()).toEqual([]);
    expect(Object.entries(QUERY_ORACLE_ROUTE).filter(([, route]) => route === "runtime-excluded")).toEqual([
      ["invocation", "runtime-excluded"],
    ]);
  });
});
