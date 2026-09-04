import { useState } from "react";

import { OutlineTree, type OutlineContent, type OutlineInlineExtension } from "../../../dist/index.js";

const extensions: readonly OutlineInlineExtension[] = [
  {
    id: "ticket",
    render: ({ children }) => <mark data-ui="host-ticket">{children}</mark>,
  },
];

export function OutlineExtensionFixture() {
  const [content, setContent] = useState<OutlineContent>([]);
  return (
    <main>
      <OutlineTree
        expandedKeys={new Set()}
        inlineExtensions={extensions}
        items={[{ accessibilityLabel: "External editor", content, key: "external", presentation: null }]}
        label="External outline"
        onExpandedChange={() => undefined}
        presentation={{ resolve: () => ({ bullet: { content: "•" } }) }}
        editing={{
          completionProviders: [
            {
              ariaLabel: "External choices",
              emptyLabel: "Nothing found",
              heading: "External tickets",
              id: "tickets",
              match: (context) =>
                context.textBeforeCaret.startsWith("^")
                  ? { from: 0, to: context.selection.to, query: context.textBeforeCaret.slice(1) }
                  : null,
              items: (_key, query) => [
                {
                  id: "issue-42",
                  label: "",
                  description: query,
                  replacement: [
                    {
                      data: { id: "issue-42" },
                      extension: "ticket",
                      label: "Ticket",
                      source: "%{Ticket}",
                      type: "token",
                    },
                  ],
                },
              ],
              renderItem: (item) => (
                <span>
                  Ticket
                  <em> supplied by host</em>
                  <code data-ui="provided-query">{JSON.stringify(item.description)}</code>
                </span>
              ),
            },
          ],
          onContentChange: (_key, value) => setContent(value),
          onContentCommit: (_key, value) => setContent(value),
          onCreateAfter: () => undefined,
          onCreateBefore: () => undefined,
          onDeleteEmpty: () => undefined,
          onSplit: () => undefined,
        }}
      />
      <output aria-label="Saved document">{JSON.stringify(content)}</output>
    </main>
  );
}
