import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { outlineFormatting } from "./outline-formatting.js";
import {
  parseOutlineContent,
  parseOutlineSource,
  surroundOutlineSelection,
  type OutlineInlineExtension,
} from "./outline-inline-extension.js";
import { OutlineInlineExtensionsProvider, OutlineSourceContent } from "./outline-source-content.js";
import type { OutlineContent } from "./outline-content.js";

const render = (content: OutlineContent, extensions: readonly OutlineInlineExtension[]) =>
  renderToStaticMarkup(
    createElement(
      OutlineInlineExtensionsProvider,
      { value: extensions },
      createElement(OutlineSourceContent, { content }),
    ),
  );

describe("registered inline syntax", () => {
  it("leaves formatting uninterpreted until the host installs it", () => {
    expect(render([{ text: "**bold**", type: "text" }], [])).not.toContain("<strong>");
    expect(render([{ text: "**bold**", type: "text" }], outlineFormatting)).toContain("<strong>");
  });

  it("renders nested formatting while mapping visible text back to source positions", () => {
    const source = "Read **bold __italic__**";
    const spans = parseOutlineSource(source, outlineFormatting);
    expect(spans[1]?.children?.[0]).toMatchObject({ from: 7, text: "bold " });
    expect(spans[1]?.children?.[1]?.children?.[0]).toMatchObject({ from: 14, text: "italic" });
    const html = render([{ text: source, type: "text" }], outlineFormatting);
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect(html).not.toContain("**");
  });

  it("keeps escaped and unfinished formatting literal and treats code as literal content", () => {
    expect(render([{ text: "\\**literal**", type: "text" }], outlineFormatting)).not.toContain("<strong>");
    expect(render([{ text: "**unfinished", type: "text" }], outlineFormatting)).toContain("**unfinished");
    const html = render([{ text: "`**literal**`", type: "text" }], outlineFormatting);
    expect(html).toContain("<code>");
    expect(html).not.toContain("<strong>");
  });

  it("supports external syntax and token rendering through the same registry", () => {
    const highlight: OutlineInlineExtension = {
      id: "highlight",
      match: (source) => (source.startsWith("==hello==") ? { contentFrom: 2, contentTo: 7, length: 9 } : null),
      render: ({ children }) => createElement("mark", {}, children),
    };
    expect(render([{ text: "==hello==", type: "text" }], [highlight])).toContain("<mark>");
    const content: OutlineContent = [
      { text: "**", type: "text" },
      { data: { id: "opaque" }, extension: "highlight", label: "Hello", source: "%{Hello}", type: "token" },
      { text: "**", type: "text" },
    ];
    const html = render(content, [...outlineFormatting, highlight]);
    expect(html).toContain("<strong>");
    expect(html).toContain("<mark>Hello</mark>");
    expect(parseOutlineContent(content, [...outlineFormatting, highlight])[0]?.children?.[0]?.token?.data).toEqual({
      id: "opaque",
    });
  });

  it("surrounds a selected token without discarding its identity and supports toggling", () => {
    const token = { data: { id: "x" }, extension: "custom", label: "X", source: "%{X}", type: "token" } as const;
    const edit = surroundOutlineSelection([token], { from: 0, to: 4 }, "**");
    expect(edit.replacement[1]).toEqual(token);
    expect(edit.selection).toEqual({ from: 2, to: 6 });
    expect(surroundOutlineSelection(edit.replacement, { from: 2, to: 6 }, "**")).toMatchObject({
      from: 0,
      to: 8,
      replacement: [token],
      selection: { from: 0, to: 4 },
    });
  });
});
