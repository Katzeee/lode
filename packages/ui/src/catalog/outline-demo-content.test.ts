import { describe, expect, it } from "vitest";

import { contentToSource } from "../components/outline/outline-content.js";
import { resolveDemoContent } from "./outline-demo-content.js";
import { demoInlineToken } from "./outline-demo-inline.js";
import { updateGraphContent } from "./outline-demo-graph.js";
import { initialGraph, textContent } from "./outline-demo-model.js";

describe("demo content source resolution", () => {
  it("resolves closed source from the graph without editor marks or a completion event", () => {
    const source = "@{Local-first software essay} #{person}";
    const resolved = resolveDemoContent(initialGraph, textContent(source));
    expect(resolved).toEqual([
      demoInlineToken("reference", "local-first", "Local-first software essay"),
      ...textContent(" "),
      demoInlineToken("supertag", "supertag-person", "person"),
    ]);
    expect(contentToSource(resolved)).toBe(source);
  });

  it("recovers a Supertag after an incomplete source is committed and its closing brace is retyped", () => {
    const incomplete = updateGraphContent(
      initialGraph,
      "projects/lode/owner-field/kei-owner",
      textContent("Kei #{person"),
    );
    expect(incomplete.nodes.kei?.value.content).toEqual(textContent("Kei #{person"));
    const repaired = updateGraphContent(
      incomplete,
      "projects/lode/owner-field/kei-owner",
      textContent("Kei #{person}"),
    );
    expect(repaired.nodes.kei?.value.content).toEqual([
      ...textContent("Kei "),
      demoInlineToken("supertag", "supertag-person", "person"),
    ]);
    expect(repaired.occurrences["kei-owner"]?.nodeId).toBe("kei");
  });

  it("respects code and escaped triggers while resolving entities inside text formatting", () => {
    const literal = "\\#{person} `#{person}`";
    expect(resolveDemoContent(initialGraph, textContent(literal))).toEqual(textContent(literal));
    expect(resolveDemoContent(initialGraph, textContent("**#{person}**"))).toEqual([
      ...textContent("**"),
      demoInlineToken("supertag", "supertag-person", "person"),
      ...textContent("**"),
    ]);
  });

  it("resolves names with escaped closing braces and preserves the exact entered source", () => {
    const graph = {
      ...initialGraph,
      nodes: {
        ...initialGraph.nodes,
        escaped: { id: "escaped", childOccurrenceIds: [], value: { content: textContent("Name } here") } },
      },
    };
    const source = "@{Name \\} here}";
    expect(resolveDemoContent(graph, textContent(source))).toEqual([
      demoInlineToken("reference", "escaped", "Name } here"),
    ]);
  });

  it("keeps unknown or ambiguous names as text and preserves an explicitly bound identity", () => {
    const person = initialGraph.nodes["supertag-person"]!;
    const graph = { ...initialGraph, nodes: { ...initialGraph.nodes, other: { ...person, id: "other" } } };
    expect(resolveDemoContent(graph, textContent("#{person}"))).toEqual(textContent("#{person}"));
    expect(resolveDemoContent(graph, textContent("#{unknown}"))).toEqual(textContent("#{unknown}"));
    const bound = [demoInlineToken("supertag", "supertag-person", "person")];
    expect(resolveDemoContent(graph, bound)).toEqual(bound);
  });
});
