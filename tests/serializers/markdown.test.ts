import { beforeEach, describe, expect, it } from "vitest";
import { BlockEngine } from "../../src/engine.js";
import { textToDelta } from "../../src/delta/utils.js";

let engine: BlockEngine;

beforeEach(() => {
  engine = new BlockEngine();
  engine.mount();
});

describe("toMarkdown", () => {
  it("serializes paragraph", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, textToDelta("hello"));
    expect(engine.toMarkdown()).toBe("hello");
  });

  it("serializes heading levels", () => {
    for (let level = 1; level <= 6; level++) {
      const e = new BlockEngine();
      e.mount();
      const id = e.createBlock();
      e.setBlockType(id, "heading");
      e.setProp(id, "level", level);
      e.replaceDeltas(id, textToDelta("title"));
      expect(e.toMarkdown()).toBe("#".repeat(level) + " title");
    }
  });

  it("serializes bullet / numbered / todo / quote / divider", () => {
    const bullet = engine.createBlock();
    engine.setBlockType(bullet, "bullet");
    engine.replaceDeltas(bullet, textToDelta("item"));

    const num = engine.createBlock();
    engine.setBlockType(num, "numbered");
    engine.setProp(num, "order", 3);
    engine.replaceDeltas(num, textToDelta("third"));

    const todo = engine.createBlock();
    engine.setBlockType(todo, "todo");
    engine.setProp(todo, "checked", true);
    engine.replaceDeltas(todo, textToDelta("done"));

    const quote = engine.createBlock();
    engine.setBlockType(quote, "quote");
    engine.replaceDeltas(quote, textToDelta("wise"));

    const div = engine.createBlock();
    engine.setBlockType(div, "divider");

    const md = engine.toMarkdown();
    expect(md).toContain("- item");
    expect(md).toContain("3. third");
    expect(md).toContain("- [x] done");
    expect(md).toContain("> wise");
    expect(md).toContain("---");
  });

  it("serializes code block with language", () => {
    const id = engine.createBlock();
    engine.setBlockType(id, "code");
    engine.setProp(id, "language", "ts");
    engine.replaceDeltas(id, [{ insert: "const x = 1;\nconst y = 2;" }]);
    const md = engine.toMarkdown();
    expect(md).toBe("```ts\nconst x = 1;\nconst y = 2;\n```");
  });

  it("serializes inline marks", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, [
      { insert: "hi " },
      { insert: "bold", attributes: { bold: true } },
      { insert: " and " },
      { insert: "italic", attributes: { italic: true } },
      { insert: " and " },
      { insert: "code", attributes: { code: true } },
      { insert: " and " },
      { insert: "link", attributes: { link: "https://x.com" } },
    ]);
    const md = engine.toMarkdown();
    expect(md).toBe("hi **bold** and _italic_ and `code` and [link](https://x.com)");
  });

  it("serializes nested blocks with indentation", () => {
    const a = engine.createBlock();
    engine.setBlockType(a, "bullet");
    engine.replaceDeltas(a, textToDelta("a"));
    const b = engine.createBlock(a);
    engine.setBlockType(b, "bullet");
    engine.replaceDeltas(b, textToDelta("b"));
    const c = engine.createBlock(b);
    engine.setBlockType(c, "bullet");
    engine.replaceDeltas(c, textToDelta("c"));
    const md = engine.toMarkdown();
    expect(md).toBe("- a\n  - b\n    - c");
  });
});

describe("fromMarkdown", () => {
  it("parses headings", () => {
    engine.fromMarkdown("# h1\n## h2\n### h3");
    const ids = engine.getAllBlockIds();
    expect(ids).toHaveLength(3);
    expect(engine.getBlockType(ids[0])).toBe("heading");
    expect(engine.getBlock(ids[0])?.props.level).toBe(1);
    expect(engine.getBlock(ids[1])?.props.level).toBe(2);
    expect(engine.getBlock(ids[2])?.props.level).toBe(3);
  });

  it("parses bullet / numbered / todo / quote / divider", () => {
    engine.fromMarkdown("- bul\n3. num\n- [x] checked\n- [ ] todo\n> q\n---");
    const ids = engine.getAllBlockIds();
    expect(engine.getBlockType(ids[0])).toBe("bullet");
    expect(engine.getBlockType(ids[1])).toBe("numbered");
    expect(engine.getBlock(ids[1])?.props.order).toBe(3);
    expect(engine.getBlockType(ids[2])).toBe("todo");
    expect(engine.getBlock(ids[2])?.props.checked).toBe(true);
    expect(engine.getBlockType(ids[3])).toBe("todo");
    expect(engine.getBlock(ids[3])?.props.checked).toBe(false);
    expect(engine.getBlockType(ids[4])).toBe("quote");
    expect(engine.getBlockType(ids[5])).toBe("divider");
  });

  it("parses code fence", () => {
    engine.fromMarkdown("```ts\nconst x = 1;\nconst y = 2;\n```");
    const ids = engine.getAllBlockIds();
    expect(ids).toHaveLength(1);
    expect(engine.getBlockType(ids[0])).toBe("code");
    expect(engine.getBlock(ids[0])?.props.language).toBe("ts");
    expect(engine.getBlock(ids[0])?.deltas).toEqual([{ insert: "const x = 1;\nconst y = 2;" }]);
  });

  it("parses inline marks", () => {
    engine.fromMarkdown("**bold** _italic_ `code` [link](https://x.com)");
    const ids = engine.getAllBlockIds();
    const deltas = engine.getBlock(ids[0])?.deltas ?? [];
    const findAttr = (attr: string) =>
      deltas.find(d => d.attributes && attr in d.attributes);
    expect(findAttr("bold")?.insert).toBe("bold");
    expect(findAttr("italic")?.insert).toBe("italic");
    expect(findAttr("code")?.insert).toBe("code");
    expect(findAttr("link")?.insert).toBe("link");
    expect(findAttr("link")?.attributes?.link).toBe("https://x.com");
  });

  it("parses nested blocks via indentation", () => {
    engine.fromMarkdown("- a\n  - b\n    - c");
    const ids = engine.getAllBlockIds();
    expect(ids).toHaveLength(3);
    expect(engine.getBlock(ids[0])?.parentId).toBe(null);
    expect(engine.getBlock(ids[1])?.parentId).toBe(ids[0]);
    expect(engine.getBlock(ids[2])?.parentId).toBe(ids[1]);
  });
});

describe("round-trip", () => {
  it("preserves structure for supported types", () => {
    const md = [
      "# Title",
      "",
      "paragraph text",
      "- bullet one",
      "  - nested",
      "1. numbered",
      "- [x] done",
      "- [ ] pending",
      "> quote line",
      "---",
    ].filter(l => l.length > 0).join("\n");

    engine.fromMarkdown(md);
    const out1 = engine.toMarkdown();

    const engine2 = new BlockEngine();
    engine2.mount();
    engine2.fromMarkdown(out1);
    const out2 = engine2.toMarkdown();

    expect(out2).toBe(out1);
  });

  it("preserves inline marks round-trip", () => {
    const md = "hi **bold** and _italic_ and `code` and [link](https://x.com)";
    engine.fromMarkdown(md);
    expect(engine.toMarkdown()).toBe(md);
  });

  it("preserves code block round-trip", () => {
    const md = "```js\nconsole.log(1);\nconsole.log(2);\n```";
    engine.fromMarkdown(md);
    expect(engine.toMarkdown()).toBe(md);
  });
});
