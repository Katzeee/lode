import { useRef, useState } from "react";
import { OutlineTree, type OutlineContent, type OutlineItemViewModel } from "../../../dist/index.js";

const item = (key: string): OutlineItemViewModel<null> => ({
  key,
  accessibilityLabel: key,
  content: [{ type: "text", text: key }],
  presentation: null,
});

export function NodeEditorCapabilitiesFixture() {
  const [names, setNames] = useState<Record<string, OutlineContent>>({});
  const [children, setChildren] = useState(["child-a", "child-b"]);
  const [calls, setCalls] = useState<readonly string[]>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(["root", "locked-leaf"]));
  const call = (value: string) => setCalls((previous) => [...previous, value]);
  const content = (key: string) => ({ ...item(key), content: names[key] ?? item(key).content });
  return (
    <main className="p-8">
      <OutlineTree
        label="Capability outline"
        selectionToolbar
        items={[
          {
            ...content("root"),
            capabilities: { insertSiblings: false, insertChildren: false, move: false, remove: false },
            children: children.map(content),
          },
          { ...item("locked-leaf"), capabilities: { insertChildren: false } },
        ]}
        expandedKeys={expanded}
        onExpandedChange={(key, open) =>
          setExpanded((previous) => {
            const next = new Set(previous);
            if (open) {
              next.add(key);
            } else {
              next.delete(key);
            }
            return next;
          })
        }
        presentation={{ resolve: () => ({ bullet: { content: "•" } }) }}
        onMove={(move) => {
          call(`move:${move.sourceKeys.join(",")}`);
          return { keyMap: new Map() };
        }}
        onDeleteSelection={(keys) => {
          call(`remove:${keys.join(",")}`);
          setChildren((previous) => previous.filter((key) => !keys.includes(key)));
        }}
        editing={{
          onContentChange: (key, value) => setNames((previous) => ({ ...previous, [key]: value })),
          onContentCommit: () => undefined,
          onCreateAfter: (key) => {
            call(`after:${key}`);
            setChildren((previous) => [...previous, "created"]);
            return { key: "created", caret: 0 };
          },
          onCreateBefore: (key) => {
            call(`before:${key}`);
          },
          onCreateChild: (key) => {
            call(`child:${key}`);
          },
          onSplit: (key) => {
            call(`split:${key}`);
          },
          onDeleteEmpty: (key) => call(`empty:${key}`),
          onDuplicate: (keys) => {
            call(`duplicate:${keys.join(",")}`);
            return null;
          },
          onCopy: (keys, operation) => {
            call(`${operation}:${keys.join(",")}`);
            return [];
          },
        }}
      />
      <output aria-label="Capability calls">{JSON.stringify(calls)}</output>
    </main>
  );
}

export function NodeEditorMoveSelectionFixture({ delayed = false }: Readonly<{ delayed?: boolean }>) {
  const [moved, setMoved] = useState(false);
  const [other, setOther] = useState("other");
  const release = useRef<(() => void) | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(["moving"]));
  const moving = { ...item(moved ? "moved" : "moving"), children: [item(moved ? "moved-child" : "child")] };
  return (
    <main className="p-8">
      <OutlineTree
        label="Moving subtree"
        items={[
          ...(moved ? [{ ...item("container"), children: [moving] }] : [item("container"), moving]),
          ...(delayed ? [{ ...item("other"), content: [{ type: "text" as const, text: other }] }] : []),
        ]}
        expandedKeys={expanded}
        onExpandedChange={(key, open) =>
          setExpanded((previous) => {
            const next = new Set(previous);
            if (open) {
              next.add(key);
            } else {
              next.delete(key);
            }
            return next;
          })
        }
        presentation={{ resolve: () => ({ bullet: { content: "•" } }) }}
        editing={{
          onContentChange: (key, content) => {
            if (key === "other") {
              setOther(content.map((item) => (item.type === "text" ? item.text : item.source)).join(""));
            }
          },
          onContentCommit: () => undefined,
          history: {
            checkpoint: () => undefined,
            undo: () => {
              setMoved(false);
              return { position: { key: "moving", caret: 0 } };
            },
            redo: () => null,
          },
        }}
        onMove={() => {
          const apply = () => {
            setMoved(true);
            return {
              keyMap: new Map([
                ["moving", "moved"],
                ["child", "moved-child"],
              ]),
            };
          };
          return delayed
            ? new Promise<ReturnType<typeof apply>>((resolve) => {
                release.current = () => resolve(apply());
              })
            : Promise.resolve().then(apply);
        }}
      />
      {delayed ? (
        <>
          <button type="button" onClick={() => release.current?.()}>
            Release pending move
          </button>
          <input aria-label="Outside field" />
        </>
      ) : null}
    </main>
  );
}
