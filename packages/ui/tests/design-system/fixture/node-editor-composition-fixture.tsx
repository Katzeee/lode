import { useState } from "react";
import {
  NodeEditor,
  NodeHeading,
  OutlineTree,
  flattenOutline,
  resolveOutlineMove,
  type OutlineContent,
  type OutlineItemViewModel,
  type OutlineTreeEditing,
} from "../../../dist/index.js";

const item = (key: string, label: string): OutlineItemViewModel<null> => ({
  key,
  accessibilityLabel: label,
  content: [{ type: "text", text: label }],
  presentation: null,
});
const presentation = { resolve: () => ({ bullet: { content: "•" } }) };

function DelayedTarget({ requested, existing }: Readonly<{ requested: boolean; existing: boolean }>) {
  const [revealed, setRevealed] = useState(false);
  const [content, setContent] = useState<OutlineContent>([]);
  return (
    <section>
      {existing || revealed ? (
        <OutlineTree
          label="Delayed region"
          items={revealed ? [{ ...item("created", "Created node"), content }] : []}
          expandedKeys={new Set()}
          onExpandedChange={() => undefined}
          presentation={presentation}
          editing={{
            onContentChange: (_key, value) => setContent(value),
            onContentCommit: (_key, value) => setContent(value),
          }}
        />
      ) : null}
      <button
        type="button"
        disabled={!requested}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setRevealed(true)}
      >
        Reveal created region
      </button>
    </section>
  );
}

export function DelayedRegionFixture({ existing = false }: Readonly<{ existing?: boolean }>) {
  const [requested, setRequested] = useState(false);
  const [heading, setHeading] = useState<OutlineContent>([{ type: "text", text: "Document" }]);
  return (
    <main className="p-8">
      <NodeEditor>
        <NodeHeading
          target={{ ...item("heading", "Document"), content: heading }}
          editing={{
            onContentChange: (_key, value) => setHeading(value),
            onContentCommit: (_key, value) => setHeading(value),
          }}
          onEnter={() => undefined}
          onEmptyBody={() => undefined}
        />
        <OutlineTree
          label="Creation region"
          items={[]}
          expandedKeys={new Set()}
          onExpandedChange={() => undefined}
          presentation={presentation}
          editing={{
            onContentChange: () => undefined,
            onContentCommit: () => undefined,
            onCreateRoot: () => {
              setRequested(true);
              return { key: "created", caret: 0 };
            },
          }}
        />
        <DelayedTarget requested={requested} existing={existing} />
      </NodeEditor>
    </main>
  );
}

export function NestedRegionFixture() {
  const [calls, setCalls] = useState<Record<string, number>>({});
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const call = (key: string) => setCalls((previous) => ({ ...previous, [key]: (previous[key] ?? 0) + 1 }));
  const editing = (region: string): OutlineTreeEditing => ({
    onContentChange: () => undefined,
    onContentCommit: () => undefined,
    onCopy: (keys) => {
      call(`${region}-copy`);
      return keys.map((key) => ({ content: [{ type: "text", text: key }], children: [] }));
    },
    onPaste: (key) => {
      call(`${region}-paste`);
      return key === null ? null : { key, caret: 0 };
    },
    history: {
      checkpoint: () => undefined,
      undo: () => {
        call(`${region}-undo`);
        return null;
      },
      redo: () => null,
    },
  });
  const cell = (
    <table className="w-full table-fixed">
      <tbody>
        <tr>
          <td>
            <OutlineTree
              label="Field values"
              items={[item("value-a", "Value Alpha"), item("value-b", "Value Beta")]}
              expandedKeys={new Set()}
              onExpandedChange={() => undefined}
              presentation={presentation}
              editing={editing("cell")}
              onMove={(move) => {
                call("cell-move");
                setMoveTarget(
                  resolveOutlineMove(
                    flattenOutline([item("value-a", "Value Alpha"), item("value-b", "Value Beta")], new Set()),
                    move,
                  )?.targetParentKey ?? null,
                );
                return { keyMap: new Map() };
              }}
            />
          </td>
        </tr>
      </tbody>
    </table>
  );
  return (
    <main className="p-8">
      <NodeEditor>
        <OutlineTree
          label="Parent outline"
          items={[{ ...item("parent", "Parent"), children: [item("hidden-child", "Hidden outline child")] }]}
          childrenViews={new Map([["parent", cell]])}
          expandedKeys={new Set(["parent"])}
          onExpandedChange={() => undefined}
          selection={{ anchorKey: "parent", focusKey: "parent", keys: new Set(["parent"]) }}
          onSelectionChange={() => undefined}
          presentation={presentation}
          editing={editing("parent")}
          onMove={() => {
            call("parent-move");
            return { keyMap: new Map() };
          }}
        />
        <output aria-label="Region calls">{JSON.stringify(calls)}</output>
        <output aria-label="Move target">{moveTarget}</output>
      </NodeEditor>
    </main>
  );
}

export function ImmediateInsertionFixture() {
  const [rows, setRows] = useState(["same"]);
  const [content, setContent] = useState<Record<string, OutlineContent>>({
    same: [{ type: "text", text: "Same row" }],
  });
  const update = (key: string, value: OutlineContent) => setContent((previous) => ({ ...previous, [key]: value }));
  return (
    <main className="p-8">
      <NodeEditor>
        <table className="w-full table-fixed">
          <tbody>
            {rows.map((key) => (
              <tr key={key}>
                <td>
                  <OutlineTree
                    label={`Name ${key}`}
                    items={[{ ...item(key, key), content: content[key] ?? [] }]}
                    presentation={presentation}
                    expandedKeys={new Set()}
                    onExpandedChange={() => undefined}
                    editing={{
                      onContentChange: update,
                      onContentCommit: update,
                      onCreateAfter: () => {
                        setRows((previous) => [...previous, "created"]);
                        return { key: "created", caret: 0 };
                      },
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </NodeEditor>
      <output aria-label="Name contents">{JSON.stringify(content)}</output>
    </main>
  );
}
