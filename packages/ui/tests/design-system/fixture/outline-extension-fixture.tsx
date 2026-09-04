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
                context.textBeforeCaret.endsWith("^")
                  ? { from: context.selection.from - 1, to: context.selection.to, query: "" }
                  : null,
              items: () => [
                {
                  id: "issue-42",
                  label: "Ticket",
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
                  {item.label}
                  <em> supplied by host</em>
                </span>
              ),
            },
          ],
          onContentChange: (_key, value) => setContent(value),
          onContentCommit: (_key, value) => setContent(value),
          onCreateAfter: () => undefined,
          onDeleteEmpty: () => undefined,
          onSplit: () => undefined,
        }}
      />
      <output aria-label="Saved document">{JSON.stringify(content)}</output>
    </main>
  );
}
