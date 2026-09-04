import { Badge } from "../components/badge.js";
import { outlineFormatting } from "../components/outline/outline-formatting.js";
import type { OutlineInlineExtension } from "../components/outline/outline-inline-extension.js";
import { demoInlineIds, demoTokenTarget } from "./outline-demo-inline.js";

export const demoInlineExtensions: readonly OutlineInlineExtension[] = [
  ...outlineFormatting,
  {
    id: demoInlineIds.reference,
    render: ({ children, token }) => (
      <span
        className="text-primary underline decoration-primary/45 underline-offset-2"
        data-reference-id={token === undefined ? undefined : (demoTokenTarget(token) ?? undefined)}
        data-ui="outline-reference"
      >
        {children}
      </span>
    ),
  },
  {
    id: demoInlineIds.supertag,
    render: ({ children }) => (
      <Badge data-ui="outline-row-badge" size="inline" tone="accent">
        {children}
      </Badge>
    ),
  },
];
