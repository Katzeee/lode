import { useState } from "react";

import { OutlineTree, type OutlineContent, type OutlineInlineExtension } from "../../../dist/index.js";

const extensions: readonly OutlineInlineExtension[] = [
  {
    id: "ticket",
    render: ({ children }) => <mark data-ui="host-ticket">{children}</mark>,
  },
];

export function OutlineExtensionFixture({ commandsEnabled = false }: Readonly<{ commandsEnabled?: boolean }>) {
  const [content, setContent] = useState<OutlineContent>([]);
  const [invocations, setInvocations] = useState(0);
  return (
    <main>
      <OutlineTree
        selectionToolbar
        commands={
          commandsEnabled
            ? ["run", "focus"].map((id) => ({
                id,
                label: id,
                keyBindings: [{ key: id === "run" ? "r" : "f", alt: true }],
                execute: (context) => {
                  setContent(context.content ?? []);
                  setInvocations((count) => count + 1);
                  return id === "focus" ? { key: "external", caret: 0 } : undefined;
                },
              }))
            : []
        }
        expandedKeys={new Set()}
        inlineExtensions={extensions}
        items={[{ accessibilityLabel: "External editor", content, key: "external", presentation: null }]}
        label="External outline"
        onExpandedChange={() => undefined}
        presentation={{ resolve: () => ({ bullet: { content: "•" } }) }}
        editing={{
          completionProviders: [
            ...(commandsEnabled
              ? [
                  {
                    id: "host-command",
                    ariaLabel: "Host commands",
                    heading: "Host commands",
                    emptyLabel: "No commands",
                    exitOnSelect: true,
                    match: (context: { textBeforeCaret: string; selection: { to: number } }) =>
                      context.textBeforeCaret.startsWith("!") ? { from: 0, to: context.selection.to, query: "" } : null,
                    items: () =>
                      ["run", "focus"].map((id) => ({
                        id,
                        label: id,
                        commandId: id,
                        replacement: [{ type: "text" as const, text: "Accepted" }],
                      })),
                  },
                ]
              : []),
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
      <output aria-label="Command invocations">{invocations}</output>
    </main>
  );
}
