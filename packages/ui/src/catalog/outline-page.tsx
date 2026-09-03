import { useState } from "react";

import { Badge } from "../components/badge.js";
import { Breadcrumbs, type BreadcrumbItem } from "../components/breadcrumbs.js";
import { Checkbox } from "../components/checkbox.js";
import { cn } from "../components/cn.js";
import { OutlineTree, type OutlineMove, type OutlineNode, type OutlineRow } from "../components/outline-tree.js";
import { PageIntro, Specimen } from "./specimen.js";

type NodeValue = Readonly<{ field?: string; tag?: string; title: string; todo?: "done" | "open" }>;
type DemoNode = OutlineNode<NodeValue>;

const node = (id: string, value: NodeValue, children?: readonly DemoNode[]): DemoNode => ({
  children,
  id,
  value,
});

const initialNodes: readonly DemoNode[] = [
  node("projects", { title: "Projects" }, [
    node("lode", { tag: "#project", title: "Lode" }, [
      node("status", { field: "Status", title: "In progress" }),
      node("roadmap", { title: "Design system roadmap" }, [
        node("outline-m1", { title: "Outline tree structure engine", todo: "done" }),
        node("outline-m2", { title: "Bullet drag and drop", todo: "open" }),
        node("command-palette", { title: "Command palette", todo: "open" }),
        { id: "local-first", kind: "reference", value: { title: "Local-first software essay" } },
      ]),
      node("engine", { title: "Engine facts and projections" }),
    ]),
    node("home-lab", { tag: "#project", title: "Home lab notes" }),
  ]),
  node("inbox", { title: "Reading inbox" }, [
    node("local-first", { title: "Local-first software essay" }),
    node("crdt-survey", { title: "CRDT ordering survey" }),
  ]),
  node(
    "archive",
    { title: "Archive" },
    Array.from({ length: 400 }, (_, index) =>
      node(`note-${String(index)}`, { title: `Field note ${String(index + 1)}` }),
    ),
  ),
];

function DemoRow({ row }: Readonly<{ row: OutlineRow<NodeValue> }>) {
  const value = row.node.value;
  if (value.field !== undefined) {
    return (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-label font-medium text-primary">{value.field}</span>
        <span className="truncate text-muted-foreground">{value.title}</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {value.todo === undefined ? null : (
        <Checkbox
          aria-label={`Toggle ${value.title}`}
          className="mr-0.5 size-4"
          defaultChecked={value.todo === "done"}
          onClick={(event) => event.stopPropagation()}
          tabIndex={-1}
        />
      )}
      <span
        className={cn(
          "truncate",
          row.node.kind === "reference" && "underline decoration-dotted decoration-muted-foreground underline-offset-4",
          value.todo === "done" && "text-muted-foreground line-through",
        )}
      >
        {value.title}
      </span>
      {value.tag === undefined ? null : (
        <Badge size="inline" tone="accent">
          {value.tag}
        </Badge>
      )}
    </span>
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

const absoluteKey = (zoomKey: string | null, key: string | null): string | null => {
  if (key === null) {
    return zoomKey;
  }
  return zoomKey === null ? key : `${zoomKey}/${key}`;
};

export function OutlinePage() {
  const [nodes, setNodes] = useState(initialNodes);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    () => new Set(["projects", "projects/lode", "projects/lode/roadmap", "inbox"]),
  );
  const [zoomKey, setZoomKey] = useState<string | null>(null);

  const zoomedNodes = zoomKey === null ? nodes : (findNode(nodes, zoomKey)?.children ?? []);

  const breadcrumbItems: readonly BreadcrumbItem[] = [
    { label: "All nodes", onSelect: () => setZoomKey(null) },
    ...(zoomKey ?? "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment, index, segments) => {
        const path = segments.slice(0, index + 1).join("/");
        return {
          label: findNode(nodes, path)?.value.title ?? segment,
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
    const source = findNode(nodes, sourceKey);
    if (source === undefined) {
      return;
    }
    setNodes(insertNode(removeNode(nodes, sourceKey), targetParentKey, move.index, source));
  };

  return (
    <>
      <PageIntro
        description="Everything is a node, and every surface renders nodes through this one tree: the same rows carry documents, search results, and settings. Arrow keys walk and fold, Tab and Shift+Tab indent and outdent, Ctrl+Arrow reorders siblings, the bullet zooms a node into a page of its own, and dragging a bullet restructures with a depth-aware drop line."
        title="Outline"
      />
      <Specimen
        className="flex-col flex-nowrap items-stretch gap-4"
        description="A live outline over local state. Solid bullets are nodes, hollow bullets are references to a node that lives elsewhere, and a halo means depth hides beneath a collapsed bullet. Row content is a slot: todos, fields, and tags here are plain row renderers. Zooming only emits an event — the breadcrumb-and-title header it produces here is page chrome, never part of the tree. The Archive branch holds 400 nodes and renders through windowing."
        title="Node tree"
      >
        {zoomKey === null ? null : (
          <header className="flex flex-col gap-0.5 border-b border-border pb-3">
            <Breadcrumbs items={breadcrumbItems} />
            <h3 className="text-title-small font-semibold tracking-tight">{findNode(nodes, zoomKey)?.value.title}</h3>
          </header>
        )}
        <OutlineTree
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
