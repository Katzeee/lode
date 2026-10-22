import { useState } from "react";
import { NodeEditor, NodeHeading, OutlineTree, contentToSource, type OutlineContent } from "../../../dist/index.js";

export function NodeEditorLifecycleFixture({ empty = false }: Readonly<{ empty?: boolean }>) {
  const [keys, setKeys] = useState([empty ? "empty" : "source"]);
  const [content, setContent] = useState<Record<string, OutlineContent>>({
    source: [{ type: "text", text: "Alpha Beta" }],
    empty: [],
  });
  const [split, setSplit] = useState<Readonly<{ before: OutlineContent; after: OutlineContent }> | null>(null);
  const [commits, setCommits] = useState<readonly Readonly<{ key: string; text: string; reason: string }>[]>([]);
  const update = (key: string, value: OutlineContent) => setContent((previous) => ({ ...previous, [key]: value }));
  return (
    <main className="p-8">
      <NodeEditor>
        <NodeHeading
          target={{ key: "heading", accessibilityLabel: "Document", content: [{ type: "text", text: "Document" }] }}
          editing={{ onContentChange: () => undefined, onContentCommit: () => undefined }}
          onEnter={() => undefined}
          onEmptyBody={() => undefined}
        />
        <OutlineTree
          label="Lifecycle outline"
          items={keys.map((key) => ({
            key,
            accessibilityLabel: key,
            content: content[key] ?? [],
            presentation: null,
            placeholder: key === "empty",
          }))}
          expandedKeys={new Set()}
          onExpandedChange={() => undefined}
          presentation={{ resolve: () => ({ bullet: { content: "•" } }) }}
          editing={{
            onContentChange: update,
            onContentCommit: (key, value, reason) => {
              setCommits((previous) => [...previous, { key, text: contentToSource(value), reason }]);
              if (key === "empty" && reason === "blur" && contentToSource(value).length === 0) {
                setKeys((previous) => previous.filter((candidate) => candidate !== key));
              } else {
                update(key, value);
              }
            },
            onCreateAfter: () => undefined,
            onSplit: (_key, before, after) => {
              setSplit({ before, after });
              return { key: "created", caret: 0 };
            },
            onMerge: (merge) => {
              update(merge.targetKey, merge.content);
              setKeys((previous) => previous.filter((key) => key !== merge.sourceKey));
            },
          }}
        />
      </NodeEditor>
      <button
        type="button"
        disabled={split === null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (split) {
            setContent((previous) => ({ ...previous, source: split.before, created: split.after }));
            setKeys(["source", "created"]);
          }
        }}
      >
        Publish split
      </button>
      <button type="button">Outside focus</button>
      <output aria-label="Lifecycle contents">{JSON.stringify(content)}</output>
      <output aria-label="Submitted contents">{JSON.stringify(commits)}</output>
    </main>
  );
}
