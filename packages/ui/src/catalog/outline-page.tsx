import { useRef, useState } from "react";

import { Badge } from "../components/badge.js";
import { Breadcrumbs, type BreadcrumbItem } from "../components/breadcrumbs.js";
import { Checkbox } from "../components/checkbox.js";
import { cn } from "../components/cn.js";
import { contentToPlainText, mergeContent } from "../components/outline-content.js";
import {
  OutlineInlineContent,
  OutlineTree,
  type OutlineContent,
  type OutlineMove,
  type OutlineNode,
  type OutlineRow,
} from "../components/outline-tree.js";
import { flattenOutline } from "../components/outline-tree-model.js";
import { PageIntro, Specimen } from "./specimen.js";

type NodeValue = Readonly<{ content: OutlineContent; field?: string; tag?: string; todo?: "done" | "open" }>;
type DemoNode = OutlineNode<NodeValue>;

const textContent = (text: string): OutlineContent => [{ text, type: "text" }];

const node = (id: string, value: NodeValue, children?: readonly DemoNode[]): DemoNode => ({
  children,
  id,
  value,
});

const initialNodes: readonly DemoNode[] = [
  node("projects", { content: textContent("Projects") }, [
    node("lode", { content: textContent("Lode"), tag: "#project" }, [
      node("status", { content: textContent("In progress"), field: "Status" }),
      node("roadmap", { content: textContent("Design system roadmap") }, [
        node("outline-m1", { content: textContent("Outline tree structure engine"), todo: "done" }),
        node("outline-m2", { content: textContent("Bullet drag and drop"), todo: "open" }),
        node("command-palette", {
          content: [
            { text: "Command palette follows ", type: "text" },
            { id: "outline-m1", label: "Outline tree structure engine", type: "reference" },
          ],
          todo: "open",
        }),
        {
          id: "local-first",
          kind: "reference",
          value: { content: textContent("Local-first software essay") },
        },
      ]),
      node("engine", { content: textContent("Engine facts and projections") }),
    ]),
    node("home-lab", { content: textContent("Home lab notes"), tag: "#project" }),
  ]),
  node("inbox", { content: textContent("Reading inbox") }, [
    node("local-first", { content: textContent("Local-first software essay") }),
    node("crdt-survey", { content: textContent("CRDT ordering survey") }),
  ]),
  node(
    "archive",
    { content: textContent("Archive") },
    Array.from({ length: 400 }, (_, index) =>
      node(`note-${String(index)}`, { content: textContent(`Field note ${String(index + 1)}`) }),
    ),
  ),
];

function DemoRow({ row }: Readonly<{ row: OutlineRow<NodeValue> }>) {
  const value = row.node.value;
  const label = contentToPlainText(value.content);
  if (value.field !== undefined) {
    return (
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-label font-medium text-primary">{value.field}</span>
        <div className="min-w-0 flex-1 truncate text-muted-foreground">
          <OutlineInlineContent content={value.content} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {value.todo === undefined ? null : (
        <Checkbox
          aria-label={`Toggle ${label}`}
          className="mr-0.5 size-4"
          defaultChecked={value.todo === "done"}
          onClick={(event) => event.stopPropagation()}
          tabIndex={-1}
        />
      )}
      <div
        className={cn(
          "min-w-0 flex-1 truncate",
          row.node.kind === "reference" && "underline decoration-dotted decoration-muted-foreground underline-offset-4",
          value.todo === "done" && "text-muted-foreground line-through",
        )}
      >
        <OutlineInlineContent content={value.content} />
      </div>
      {value.tag === undefined ? null : (
        <Badge size="inline" tone="accent">
          {value.tag}
        </Badge>
      )}
    </div>
  );
}

function findNode(nodes: readonly DemoNode[], key: string): DemoNode | undefined {
  const [head, ...rest] = key.split("/");
  const match = nodes.find((candidate) => candidate.id === head);
  if (match === undefined || rest.length === 0) {
    return match;
  }
  return findNode(match.children ?? [], rest.join("/"));
}

function removeNode(nodes: readonly DemoNode[], key: string): readonly DemoNode[] {
  const [head, ...rest] = key.split("/");
  if (rest.length === 0) {
    return nodes.filter((candidate) => candidate.id !== head);
  }
  return nodes.map((candidate) =>
    candidate.id === head
      ? { ...candidate, children: removeNode(candidate.children ?? [], rest.join("/")) }
      : candidate,
  );
}

function insertNode(
  nodes: readonly DemoNode[],
  parentKey: string | null,
  index: number,
  inserted: DemoNode,
): readonly DemoNode[] {
  if (parentKey === null) {
    return [...nodes.slice(0, index), inserted, ...nodes.slice(index)];
  }
  const [head, ...rest] = parentKey.split("/");
  return nodes.map((candidate) =>
    candidate.id === head
      ? {
          ...candidate,
          children: insertNode(candidate.children ?? [], rest.length === 0 ? null : rest.join("/"), index, inserted),
        }
      : candidate,
  );
}

function updateNode(
  nodes: readonly DemoNode[],
  key: string,
  update: (current: DemoNode) => DemoNode,
): readonly DemoNode[] {
  const [head, ...rest] = key.split("/");
  return nodes.map((candidate) => {
    if (candidate.id !== head) {
      return candidate;
    }
    if (rest.length === 0) {
      return update(candidate);
    }
    return { ...candidate, children: updateNode(candidate.children ?? [], rest.join("/"), update) };
  });
}

function siblingLocation(
  nodes: readonly DemoNode[],
  key: string,
): Readonly<{ index: number; parentKey: string | null }> | null {
  const segments = key.split("/");
  const id = segments.pop();
  if (id === undefined) {
    return null;
  }
  const parentKey = segments.length === 0 ? null : segments.join("/");
  const siblings = parentKey === null ? nodes : (findNode(nodes, parentKey)?.children ?? []);
  const index = siblings.findIndex((candidate) => candidate.id === id);
  return index < 0 ? null : { index, parentKey };
}

const absoluteKey = (zoomKey: string | null, key: string | null): string | null => {
  if (key === null) {
    return zoomKey;
  }
  return zoomKey === null ? key : `${zoomKey}/${key}`;
};

function searchNodes(nodes: readonly DemoNode[], query: string): readonly { id: string; label: string }[] {
  const normalizedQuery = query.toLocaleLowerCase();
  const seen = new Set<string>();
  const matches: { id: string; label: string }[] = [];
  const visit = (candidates: readonly DemoNode[]) => {
    for (const candidate of candidates) {
      const label = contentToPlainText(candidate.value.content);
      if (!seen.has(candidate.id) && label.toLocaleLowerCase().includes(normalizedQuery)) {
        seen.add(candidate.id);
        matches.push({ id: candidate.id, label });
      }
      visit(candidate.children ?? []);
    }
  };
  visit(nodes);
  return matches.slice(0, 20);
}

export function OutlinePage() {
  const [nodes, setNodes] = useState(initialNodes);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    () => new Set(["projects", "projects/lode", "projects/lode/roadmap", "inbox"]),
  );
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const nextDraftId = useRef(0);

  const zoomedNodes = zoomKey === null ? nodes : (findNode(nodes, zoomKey)?.children ?? []);
  const visibleRows = flattenOutline(zoomedNodes, expandedKeys);

  const breadcrumbItems: readonly BreadcrumbItem[] = [
    { label: "All nodes", onSelect: () => setZoomKey(null) },
    ...(zoomKey ?? "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment, index, segments) => {
        const path = segments.slice(0, index + 1).join("/");
        return {
          label: contentToPlainText(findNode(nodes, path)?.value.content ?? textContent(segment)),
          onSelect: () => setZoomKey(path),
        };
      }),
  ];

  const applyMove = (move: OutlineMove) => {
    const sourceKey = absoluteKey(zoomKey, move.sourceKey);
    const targetParentKey = absoluteKey(zoomKey, move.targetParentKey);
    if (sourceKey === null) {
      return;
    }
    setNodes((previous) => {
      const source = findNode(previous, sourceKey);
      return source === undefined
        ? previous
        : insertNode(removeNode(previous, sourceKey), targetParentKey, move.index, source);
    });
  };

  const createDraftNode = (content: OutlineContent) => {
    nextDraftId.current += 1;
    return node(`draft-${String(nextDraftId.current)}`, { content });
  };

  return (
    <>
      <PageIntro
        description="Everything is a node, and every surface renders nodes through this one tree: the same rows carry documents, search results, and settings. Click row text or press Enter to edit rich inline content, type [[ or @ to link another node, use Enter and Backspace to split or join nodes, and press Escape to return to structural navigation. Tab and Shift+Tab indent and outdent, Ctrl+Arrow reorders siblings, the bullet zooms a node into a page of its own, and dragging a bullet restructures with a depth-aware drop line."
        title="Outline"
      />
      <Specimen
        className="flex-col flex-nowrap items-stretch gap-4"
        description="A live outline over local state. Solid bullets are nodes, hollow bullets are references to a node that lives elsewhere, and a halo means depth hides beneath a collapsed bullet. Row chrome remains a slot for todos, fields, and tags, while OutlineInlineContent keeps rich text and [[ reference pills visually stable between reading and editing. Zooming only emits an event — the breadcrumb-and-title header it produces here is page chrome, never part of the tree. The Archive branch holds 400 nodes and renders through windowing."
        title="Node tree"
      >
        {zoomKey === null ? null : (
          <header className="flex flex-col gap-0.5 border-b border-border pb-3">
            <Breadcrumbs items={breadcrumbItems} />
            <h3 className="text-title-small font-semibold tracking-tight">
              {contentToPlainText(findNode(nodes, zoomKey)?.value.content ?? [])}
            </h3>
          </header>
        )}
        <OutlineTree
          editing={{
            onCreateAfter: (key) => {
              const sourceKey = absoluteKey(zoomKey, key);
              if (sourceKey === null) {
                return;
              }
              const created = createDraftNode([]);
              setNodes((previous) => {
                const location = siblingLocation(previous, sourceKey);
                return location === null
                  ? previous
                  : insertNode(previous, location.parentKey, location.index + 1, created);
              });
            },
            onDeleteEmpty: (key) => {
              const sourceKey = absoluteKey(zoomKey, key);
              if (sourceKey !== null) {
                setNodes((previous) => removeNode(previous, sourceKey));
              }
            },
            onMergeUp: (key) => {
              const sourceIndex = visibleRows.findIndex((row) => row.key === key);
              const previousRow = visibleRows[sourceIndex - 1];
              const sourceKey = absoluteKey(zoomKey, key);
              const targetKey = absoluteKey(zoomKey, previousRow?.key ?? null);
              if (sourceKey === null || targetKey === null || previousRow === undefined) {
                return;
              }
              setNodes((previous) => {
                const source = findNode(previous, sourceKey);
                const target = findNode(previous, targetKey);
                if (source === undefined || target === undefined) {
                  return previous;
                }
                const merged = updateNode(previous, targetKey, (current) => ({
                  ...current,
                  value: { ...current.value, content: mergeContent(current.value.content, source.value.content) },
                }));
                return removeNode(merged, sourceKey);
              });
            },
            onSplit: (key, before, after) => {
              const sourceKey = absoluteKey(zoomKey, key);
              if (sourceKey === null) {
                return;
              }
              const created = createDraftNode(after);
              setNodes((previous) => {
                const location = siblingLocation(previous, sourceKey);
                if (location === null) {
                  return previous;
                }
                const updated = updateNode(previous, sourceKey, (current) => ({
                  ...current,
                  value: { ...current.value, content: before },
                }));
                return insertNode(updated, location.parentKey, location.index + 1, created);
              });
            },
            onContentCommit: (key, content) => {
              const sourceKey = absoluteKey(zoomKey, key);
              if (sourceKey !== null) {
                setNodes((previous) =>
                  updateNode(previous, sourceKey, (current) => ({
                    ...current,
                    value: { ...current.value, content },
                  })),
                );
              }
            },
            contentOf: (row) => row.node.value.content,
            searchNodes: (query) => searchNodes(nodes, query),
          }}
          expandedKeys={expandedKeys}
          label="Demo outline"
          nodes={zoomedNodes}
          onExpandedChange={(key, expanded) => {
            setExpandedKeys((previous) => {
              const next = new Set(previous);
              if (expanded) {
                next.add(key);
              } else {
                next.delete(key);
              }
              return next;
            });
          }}
          onMove={applyMove}
          onZoomIn={(key) => {
            setZoomKey(absoluteKey(zoomKey, key));
            setExpandedKeys(new Set());
          }}
          renderRow={(row) => <DemoRow row={row} />}
        />
      </Specimen>
    </>
  );
}
