import { useState } from "react";

import { Icon, OutlineTree, type OutlineContent, type OutlineCompletionItem } from "../../../dist/index.js";

const candidates: readonly OutlineCompletionItem[] = Array.from({ length: 16 }, (_value, index) => ({
  id: `choice-${index}`,
  label: `Suggestion ${index}`,
  description: index % 2 === 0 ? `Additional detail for suggestion ${index}` : undefined,
  leading: <Icon name="type" size="sm" />,
  replacement: [{ text: `Selected ${index}`, type: "text" }],
}));

export function OutlineSuggestionFixture() {
  const [content, setContent] = useState<OutlineContent>([]);
  const [reversed, setReversed] = useState(false);
  const [events, setEvents] = useState({ accepted: [] as string[], moves: 0, created: 0 });
  return (
    <main className="p-8">
      <button onMouseDown={(event) => event.preventDefault()} onClick={() => setReversed(!reversed)} type="button">
        Refresh suggestions
      </button>
      <OutlineTree
        selectionToolbar
        expandedKeys={new Set()}
        items={[{ accessibilityLabel: "Suggestion input", content, key: "input", presentation: null }]}
        label="Suggestion fixture"
        onExpandedChange={() => undefined}
        onMove={() => {
          setEvents((previous) => ({ ...previous, moves: previous.moves + 1 }));
          return { keyMap: new Map() };
        }}
        presentation={{ resolve: () => ({ bullet: { content: "•" } }) }}
        editing={{
          completionProviders: [
            {
              id: "external-suggestions",
              ariaLabel: "Test suggestions",
              heading: "Suggestions",
              emptyLabel: "No suggestions",
              match: (context) =>
                context.textBeforeCaret.startsWith("~")
                  ? { from: 0, to: context.selection.to, query: context.textBeforeCaret.slice(1) }
                  : null,
              items: (_key, query) => (query === "none" ? [] : reversed ? [...candidates].reverse() : candidates),
              keyBindings: [
                { key: "Enter", action: null },
                { key: "Enter", control: true, action: "accept" },
                { key: "Tab", action: "next" },
                { key: "Home", control: true, action: "first" },
                { key: "End", control: true, action: "last" },
              ],
              canAccept: (_key, item) => item.id !== "choice-0",
            },
          ],
          onContentChange: (_key, value) => setContent(value),
          onContentCommit: (_key, value) => setContent(value),
          onCompletion: (_key, _provider, id, value) => {
            setContent(value);
            setEvents((previous) => ({ ...previous, accepted: [...previous.accepted, id] }));
          },
          onCreateAfter: () => setEvents((previous) => ({ ...previous, created: previous.created + 1 })),
          onCreateBefore: () => setEvents((previous) => ({ ...previous, created: previous.created + 1 })),
          onDeleteEmpty: () => undefined,
          onSplit: () => undefined,
        }}
      />
      <output aria-label="Suggestion events">{JSON.stringify(events)}</output>
    </main>
  );
}
