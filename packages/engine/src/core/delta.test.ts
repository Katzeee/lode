import { describe, expect, it } from "vitest";
import { deltaToText, textToDelta } from "./delta.js";

describe("deltaToText / textToDelta", () => {
  it("converts bidirectionally between text and delta", () => {
    expect(deltaToText(textToDelta("hello"))).toBe("hello");
    expect(textToDelta("")).toEqual([]);
  });
});
