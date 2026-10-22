import { describe, expect, it } from "vitest";

import {
  appendText,
  contentLength,
  contentToDoc,
  contentToPlainText,
  contentToSource,
  docToContent,
  mergeContent,
  splitContent,
  type OutlineContent,
  type OutlineToken,
} from "./outline-content.js";

const token: OutlineToken = {
  data: { target: "stable-17" },
  extension: "external-entity",
  label: "Design system",
  source: "@{Design system}",
  type: "token",
};
const content: OutlineContent = [{ text: "**Read** ", type: "text" }, token, { text: "\n__today__", type: "text" }];

describe("outline source document", () => {
  it("preserves closed source, whitespace and opaque identity through the editing document", () => {
    expect(docToContent(contentToDoc(content))).toEqual(content);
    expect(contentToSource(content)).toBe("**Read** @{Design system}\n__today__");
    expect(contentLength(content)).toBe(contentToSource(content).length);
    expect(contentToPlainText([token])).toBe("Design system");
  });

  it("preserves incomplete syntax instead of repairing the user's draft", () => {
    const draft: OutlineContent = [{ text: "**unfinished #{name\n  ", type: "text" }];
    expect(docToContent(contentToDoc(draft))).toEqual(draft);
  });

  it("removes an identity when its source is edited and restores it when the original document is restored", () => {
    const document = contentToDoc([token]);
    const changed = structuredClone(document);
    const inline = changed.content[0].content?.[0];
    if (inline?.type !== "text") {
      throw new Error("Expected editable token text");
    }
    inline.text = "@{Different name}";
    expect(docToContent(changed)).toEqual([{ text: "@{Different name}", type: "text" }]);
    expect(docToContent(document)).toEqual([token]);
  });

  it("keeps repeated adjacent tokens distinct", () => {
    expect(docToContent(contentToDoc([token, token]))).toEqual([token, token]);
  });

  it("retains identity only when a split retains the entire closed token", () => {
    expect(splitContent(content, 8, 8)).toEqual({
      before: [{ text: "**Read**", type: "text" }],
      after: [{ text: " ", type: "text" }, token, { text: "\n__today__", type: "text" }],
    });
    expect(splitContent([token], 3, 3)).toEqual({
      before: [{ text: "@{D", type: "text" }],
      after: [{ text: "esign system}", type: "text" }],
    });
  });

  it("merges and appends source without losing tokens or inventing whitespace", () => {
    expect(mergeContent([{ text: "**a", type: "text" }], [{ text: "b** ", type: "text" }], [token])).toEqual([
      { text: "**ab** ", type: "text" },
      token,
    ]);
    expect(appendText([token], "!")).toEqual([token, { text: "!", type: "text" }]);
  });

  it("handles empty and malformed editor documents", () => {
    expect(docToContent(contentToDoc([]))).toEqual([]);
    expect(docToContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "other" }] }] })).toEqual([]);
    expect(docToContent(null)).toEqual([]);
  });
});
