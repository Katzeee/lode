import { describe, expect, it } from "vitest";

import { contentToSource, type OutlineContent } from "../components/outline/outline-content.js";
import { createDemoCompletionProviders, completionIds } from "./outline-demo-completions.js";
import { demoInlineToken } from "./outline-demo-inline.js";
import { initialGraph, textContent } from "./outline-demo-model.js";
import { updateGraphNode } from "./outline-demo-graph.js";

const providers = createDemoCompletionProviders({
  commands: [],
  fieldDefinitionIdsByKey: new Map(),
  graph: initialGraph,
});
const match = (providerId: string, content: OutlineContent, caret = contentToSource(content).length) => {
  const text = contentToSource(content);
  return providers
    .find((provider) => provider.id === providerId)
    ?.match({
      content,
      selection: { from: caret, to: caret },
      text,
      textBeforeCaret: text.slice(0, caret),
    });
};

describe("host-owned inline completions", () => {
  it("excludes unnamed nodes and commands in the external providers", () => {
    let graph = initialGraph;
    for (const id of ["kei", "lode-team", "status-definition", "supertag-person"]) {
      graph = updateGraphNode(graph, id, (node) => ({
        ...node,
        value: { ...node.value, content: textContent(" \t ") },
      }));
    }
    const registered = createDemoCompletionProviders({
      commands: [
        { id: "blank", label: " ", replacement: [] },
        { id: "named", label: "Visible command", replacement: [] },
      ],
      fieldDefinitionIdsByKey: new Map([["owner-value", "owner-definition"]]),
      graph,
    });
    for (const provider of registered) {
      expect(provider.items("owner-value", "").every((item) => item.label.trim().length > 0)).toBe(true);
    }
    expect(registered.find((provider) => provider.id === completionIds.value)?.items("owner-value", "")).toEqual([]);
    expect(
      registered
        .find((provider) => provider.id === completionIds.field)
        ?.items("", "")
        .map((item) => item.id),
    ).not.toContain("status-definition");
    expect(
      registered
        .find((provider) => provider.id === completionIds.supertag)
        ?.items("", "")
        .map((item) => item.id),
    ).toEqual(["supertag-project"]);
    expect(
      registered
        .find((provider) => provider.id === completionIds.command)
        ?.items("", "")
        .map((item) => item.id),
    ).toEqual(["named"]);
  });

  it("uses @ and # for searches and leaves double brackets and email addresses as ordinary text", () => {
    expect(match(completionIds.reference, textContent("@Local-first"))).toEqual({
      from: 0,
      query: "Local-first",
      to: 12,
    });
    expect(match(completionIds.supertag, textContent("#pro"))).toEqual({ from: 0, query: "pro", to: 4 });
    expect(match(completionIds.reference, textContent("[[Local first"))).toBeNull();
    expect(match(completionIds.reference, textContent("me@example.com"))).toBeNull();
  });

  it("ends unbraced queries at whitespace instead of reopening while ordinary text is typed", () => {
    for (const [provider, trigger] of [
      [completionIds.reference, "@"],
      [completionIds.supertag, "#"],
    ] as const) {
      for (const suffix of [" ", " name", "name ", "name more", "\t", "\n"]) {
        expect(match(provider, textContent(`${trigger}${suffix}`))).toBeNull();
      }
    }
  });

  it("keeps completed and bound tokens outside later searches", () => {
    for (const kind of ["reference", "supertag"] as const) {
      const token = demoInlineToken(kind, "a", "Name with spaces");
      for (const suffix of [" ", " next text", ". More text"]) {
        expect(match(completionIds[kind], textContent(token.source + suffix))).toBeNull();
        expect(match(completionIds[kind], [token, ...textContent(suffix)])).toBeNull();
      }
      const content = [token, ...textContent(" @Local")];
      expect(match(completionIds.reference, content)).toEqual({
        from: token.source.length + 1,
        query: "Local",
        to: token.source.length + 7,
      });
    }
  });

  it("allows spaces and escaped delimiters inside braces without opening a different provider", () => {
    expect(match(completionIds.reference, textContent("@{Local first"))).toEqual({
      from: 0,
      query: "Local first",
      to: 13,
    });
    const source = demoInlineToken("reference", "a", "Name } with spaces").source;
    expect(match(completionIds.reference, textContent(source), 10)).toEqual({
      from: 0,
      query: "Name } with spaces",
      to: source.length,
    });
    expect(match(completionIds.supertag, textContent("@{Name #other"))).toBeNull();
    expect(match(completionIds.reference, textContent("#{Name @other"))).toBeNull();
  });

  it("stores selected entities with closed source and stable identity", () => {
    const reference = providers
      .find((provider) => provider.id === completionIds.reference)
      ?.items("", "Local-first software essay")[0];
    expect(reference?.replacement[0]).toMatchObject({
      source: "@{Local-first software essay}",
      data: { id: "local-first" },
    });
    const tag = providers.find((provider) => provider.id === completionIds.supertag)?.items("", "project")[0];
    expect(tag?.replacement[0]).toMatchObject({ source: "#{project}", data: { id: "supertag-project" } });
  });

  it("replaces the whole closed expression when editing its name, while bound tokens remain resolved", () => {
    expect(match(completionIds.reference, textContent("@{Local first} later"), 7)).toEqual({
      from: 0,
      query: "Local first",
      to: 14,
    });
    expect(match(completionIds.reference, [demoInlineToken("reference", "a", "Local first")], 7)).toBeNull();
    const escaped = demoInlineToken("reference", "a", "Name } with \\ slash");
    expect(escaped.source).toBe("@{Name \\} with \\\\ slash}");
  });

  it("populates the command panel only with commands supplied by the host", () => {
    const commands = createDemoCompletionProviders({
      commands: [{ id: "host-review", label: "Request review", replacement: textContent("Review requested") }],
      fieldDefinitionIdsByKey: new Map(),
      graph: initialGraph,
    }).find((provider) => provider.id === completionIds.command);
    expect(commands?.items("", "review")).toEqual([
      { id: "host-review", label: "Request review", replacement: textContent("Review requested") },
    ]);
    expect(providers.find((provider) => provider.id === completionIds.command)?.items("", "")).toEqual([]);
  });
});
