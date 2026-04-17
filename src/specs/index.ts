import type { BlockView } from "../types.js";
import type { CommandDef } from "../plugins/index.js";

export interface BlockSpec {
  readonly type: string;
  defaultProps?(): Record<string, unknown>;
  allowedChildren?: string[] | null;
  commands?: Record<string, CommandDef>;
  markdown?: {
    serialize(block: BlockView, children: string): string;
    deserialize?(line: string): { props: Record<string, unknown>; text: string } | null;
  };
}

// ── Built-in specs ─────────────────────────────────────────────────────────────

export const paragraphSpec: BlockSpec = {
  type: "paragraph",
  markdown: {
    serialize: (_, children) => children,
  },
};

export const headingSpec: BlockSpec = {
  type: "heading",
  defaultProps: () => ({ level: 1 }),
  markdown: {
    serialize: (block, children) => {
      const level = Math.max(1, Math.min(6, Number(block.props.level ?? 1)));
      return "#".repeat(level) + " " + children;
    },
    deserialize: line => {
      const m = /^(#{1,6})\s+(.*)$/.exec(line);
      if (!m) return null;
      return { props: { level: m[1].length }, text: m[2] };
    },
  },
};

export const bulletSpec: BlockSpec = {
  type: "bullet",
  markdown: {
    serialize: (_, children) => "- " + children,
    deserialize: line => {
      const m = /^[-*+]\s+(.*)$/.exec(line);
      if (!m) return null;
      return { props: {}, text: m[1] };
    },
  },
};

export const numberedSpec: BlockSpec = {
  type: "numbered",
  markdown: {
    serialize: (block, children) => {
      const order = Number(block.props.order ?? 1);
      return `${order}. ${children}`;
    },
    deserialize: line => {
      const m = /^(\d+)\.\s+(.*)$/.exec(line);
      if (!m) return null;
      return { props: { order: Number(m[1]) }, text: m[2] };
    },
  },
};

export const todoSpec: BlockSpec = {
  type: "todo",
  defaultProps: () => ({ checked: false }),
  markdown: {
    serialize: (block, children) =>
      (block.props.checked ? "- [x] " : "- [ ] ") + children,
    deserialize: line => {
      const m = /^-\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (!m) return null;
      return { props: { checked: m[1].toLowerCase() === "x" }, text: m[2] };
    },
  },
};

export const codeSpec: BlockSpec = {
  type: "code",
  markdown: {
    serialize: (block, children) => {
      const lang = typeof block.props.language === "string" ? block.props.language : "";
      return "```" + lang + "\n" + children + "\n```";
    },
  },
};

export const quoteSpec: BlockSpec = {
  type: "quote",
  markdown: {
    serialize: (_, children) => "> " + children,
    deserialize: line => {
      const m = /^>\s?(.*)$/.exec(line);
      if (!m) return null;
      return { props: {}, text: m[1] };
    },
  },
};

export const dividerSpec: BlockSpec = {
  type: "divider",
  markdown: {
    serialize: () => "---",
    deserialize: line => (/^---+$/.test(line.trim()) ? { props: {}, text: "" } : null),
  },
};

export const builtinSpecs: BlockSpec[] = [
  paragraphSpec,
  headingSpec,
  bulletSpec,
  numberedSpec,
  todoSpec,
  codeSpec,
  quoteSpec,
  dividerSpec,
];
