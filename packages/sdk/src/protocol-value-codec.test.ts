import { describe, expect, it } from "vitest";

import type { ConflictIssue } from "./review.js";
import { fromConflictIssue, toConflictIssue } from "./protocol-conflict-codec.js";
import { fromPreviousValue, toPreviousValue } from "./protocol-previous-value-codec.js";
import { fromProtocolValue, toProtocolValue } from "./protocol-value-codec.js";

describe("protocol value ownership", () => {
  it("keeps generic traversal structural when field names resemble semantic shapes", () => {
    const protocolLikeValue = { state: { case: "set", value: { issue: "literal" } } };
    const domainLikeValue = { kind: "set", value: "literal" };

    expect(fromProtocolValue(protocolLikeValue)).toEqual(protocolLikeValue);
    expect(toProtocolValue(domainLikeValue)).toEqual(domainLikeValue);
  });

  it("converts PreviousValue only through its owning codec", () => {
    const value = { kind: "set", value: { issue: "literal" } } as const;

    expect(fromPreviousValue(toPreviousValue(value))).toEqual(value);
  });

  it("converts ConflictIssue only through its owning codec", () => {
    const issue: ConflictIssue = {
      kind: "supertag-extension-cycle",
      identity: "cycle:task",
      supertagIds: ["task", "project"],
    };

    expect(fromConflictIssue(toConflictIssue(issue))).toEqual(issue);
  });
});
