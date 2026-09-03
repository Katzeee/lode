import { describe, expect, it } from "vitest";

import {
  appendText,
  contentLength,
  contentToDoc,
  contentToPlainText,
  docToContent,
  mergeContent,
  splitContent,
  type OutlineContent,
} from "./outline-content.js";

const richContent: OutlineContent = [
  { marks: ["italic", "bold"], text: "Read ", type: "text" },
  { id: "local-first", label: "Local-first software", type: "reference" },
  { marks: ["code"], text: " today", type: "text" },
];

describe("outline content mapping", () => {
  it("round-trips text marks and atomic references through the editor document", () => {
    const document = contentToDoc(richContent);

    expect(document).toEqual({
      content: [
        {
          content: [
            { marks: [{ type: "bold" }, { type: "italic" }], text: "Read ", type: "text" },
            { attrs: { id: "local-first", label: "Local-first software" }, type: "outlineReference" },
            { marks: [{ type: "code" }], text: " today", type: "text" },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
    expect(docToContent(document)).toEqual([
      { marks: ["bold", "italic"], text: "Read ", type: "text" },
      { id: "local-first", label: "Local-first software", type: "reference" },
      { marks: ["code"], text: " today", type: "text" },
    ]);
  });

  it("maps empty and malformed editor documents to portable empty content", () => {
    expect(contentToDoc([])).toEqual({ content: [{ type: "paragraph" }], type: "doc" });
    expect(
      docToContent({ content: [{ content: [{ attrs: { id: 3 }, type: "outlineReference" }] }], type: "doc" }),
    ).toEqual([]);
  });

  it("round-trips soft line breaks without turning a node into multiple blocks", () => {
    const content: OutlineContent = [{ marks: ["italic"], text: "first\nsecond", type: "text" }];

    expect(contentToDoc(content)).toEqual({
      content: [
        {
          content: [
            { marks: [{ type: "italic" }], text: "first", type: "text" },
            { marks: [{ type: "italic" }], type: "hardBreak" },
            { marks: [{ type: "italic" }], text: "second", type: "text" },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
    expect(docToContent(contentToDoc(content))).toEqual(content);
  });
});

describe("outline content operations", () => {
  it("treats a reference as one editor position while exposing its label as plain text", () => {
    expect(contentLength(richContent)).toBe(12);
    expect(contentToPlainText(richContent)).toBe("Read Local-first software today");
  });

  it("splits around selections without flattening marks or reference atoms", () => {
    expect(splitContent(richContent, 3, 7)).toEqual({
      after: [{ marks: ["code"], text: "today", type: "text" }],
      before: [{ marks: ["bold", "italic"], text: "Rea", type: "text" }],
    });
    expect(splitContent(richContent, 5, 5)).toEqual({
      after: [
        { id: "local-first", label: "Local-first software", type: "reference" },
        { marks: ["code"], text: " today", type: "text" },
      ],
      before: [{ marks: ["bold", "italic"], text: "Read ", type: "text" }],
    });
  });

  it("coalesces compatible text at merge and append boundaries", () => {
    expect(mergeContent([{ text: "alpha", type: "text" }], [{ text: " beta", type: "text" }])).toEqual([
      { marks: undefined, text: "alpha beta", type: "text" },
    ]);
    expect(appendText([{ marks: ["bold"], text: "alpha", type: "text" }], "!")).toEqual([
      { marks: ["bold"], text: "alpha", type: "text" },
      { marks: undefined, text: "!", type: "text" },
    ]);
  });
});
