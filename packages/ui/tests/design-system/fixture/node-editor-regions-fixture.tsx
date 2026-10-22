import { useRef, useState } from "react";
import {
  NodeEditor,
  NodeHeading,
  OutlineTree,
  type OutlineContent,
  type OutlineEditHistory,
  type OutlineTreeEditing,
} from "../../../dist/index.js";

const text = (value: string): OutlineContent => [{ type: "text", text: value }];

export function NodeEditorRegionsFixture({
  empty = false,
  delayed = false,
}: Readonly<{ empty?: boolean; delayed?: boolean }>) {
  const [content, setContent] = useState<Record<string, OutlineContent>>({
    heading: text("Document"),
    first: text("First row"),
    second: text("Second row"),
  });
  const [created, setCreated] = useState(false);
  const [fallbacks, setFallbacks] = useState(0);
  const completeHistory = useRef<(() => void) | null>(null);
  const update = (key: string, value: OutlineContent) => setContent((current) => ({ ...current, [key]: value }));
  const history: OutlineEditHistory = {
    checkpoint: () => undefined,
    redo: () => null,
    undo: () => {
      const restore = () => {
        update("heading", text("Document"));
        return { position: { key: "heading", caret: 2 } };
      };
      return delayed
        ? new Promise((resolve) => {
            completeHistory.current = () => resolve(restore());
          })
        : restore();
    },
  };
  const editing: OutlineTreeEditing = {
    history,
    onContentChange: update,
    onContentCommit: update,
    onCreateAfter: () => undefined,
    onCreateBefore: () => undefined,
    onDeleteEmpty: () => undefined,
    onSplit: () => undefined,
  };
  const item = (key: string, label: string) => ({
    key,
    accessibilityLabel: label,
    content: content[key] ?? [],
    presentation: null,
  });
  return (
    <main className="p-8">
      <NodeEditor>
        <NodeHeading
          target={item("heading", "Document")}
          editing={editing}
          onEnter={() => setFallbacks((count) => count + 1)}
          onEmptyBody={() => setFallbacks((count) => count + 1)}
        />
        <OutlineTree
          label="First region"
          items={empty && !created ? [] : [item("first", "First row")]}
          expandedKeys={new Set()}
          onExpandedChange={() => undefined}
          presentation={{ resolve: () => ({ bullet: { content: "•" } }) }}
          editing={{
            ...editing,
            onCreateRoot: (value) => {
              update("first", value);
              setCreated(true);
              return { key: "first", caret: 0 };
            },
          }}
        />
        <OutlineTree
          label="Second region"
          items={[item("second", "Second row")]}
          expandedKeys={new Set()}
          onExpandedChange={() => undefined}
          presentation={{ resolve: () => ({ bullet: { content: "•" } }) }}
          editing={editing}
        />
      </NodeEditor>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => completeHistory.current?.()}>
        Release history
      </button>
      <output aria-label="Created nodes">{Number(created)}</output>
      <output aria-label="Heading fallbacks">{fallbacks}</output>
      <output aria-label="Stored heading">{JSON.stringify(content.heading)}</output>
    </main>
  );
}
