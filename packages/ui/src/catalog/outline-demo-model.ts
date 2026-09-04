import type { OutlineContent } from "../components/outline/outline-content.js";

export type FieldDatatype = "checkbox" | "date" | "number" | "options" | "options-from-supertag" | "plain";

export type NodeValue = Readonly<{
  content: OutlineContent;
  editable?: boolean;
  field?: Readonly<{ datatype: FieldDatatype; kind: "definition" }> | Readonly<{ definitionId: string; kind: "field" }>;
  intrinsicNodeType?: "calendar" | "search";
  progress?: Readonly<{ max: number; value: number }>;
  tags?: readonly string[];
  todo?: "done" | "open";
}>;

export type DemoNode = Readonly<{
  childOccurrenceIds: readonly string[];
  id: string;
  value: NodeValue;
}>;

export type DemoOccurrence = Readonly<{
  appearance?: "original" | "reference";
  expandable?: boolean;
  id: string;
  nodeId: string;
}>;

export type DemoGraph = Readonly<{
  nodes: Readonly<Record<string, DemoNode>>;
  occurrences: Readonly<Record<string, DemoOccurrence>>;
  rootOccurrenceIds: readonly string[];
}>;

type Seed = Readonly<{
  appearance?: "original" | "reference";
  children?: readonly Seed[];
  expandable?: boolean;
  nodeId: string;
  occurrenceId: string;
  value: NodeValue;
}>;

export const textContent = (text: string): OutlineContent => (text.length === 0 ? [] : [{ text, type: "text" }]);

const seed = (
  occurrenceId: string,
  value: NodeValue,
  children?: readonly Seed[],
  options: Readonly<{
    appearance?: "original" | "reference";
    expandable?: boolean;
    nodeId?: string;
  }> = {},
): Seed => ({
  appearance: options.appearance,
  children,
  expandable: options.expandable,
  nodeId: options.nodeId ?? occurrenceId,
  occurrenceId,
  value,
});

const fieldDefinitionFixtures = [
  { datatype: "options", id: "status-definition", label: "Status" },
  { datatype: "options-from-supertag", id: "owner-definition", label: "Owner" },
  { datatype: "date", id: "review-date-definition", label: "Review date" },
  { datatype: "checkbox", id: "ready-definition", label: "Ready" },
  { datatype: "plain", id: "notes-definition", label: "Notes" },
] as const satisfies readonly { datatype: FieldDatatype; id: string; label: string }[];

export const fieldValueSuggestionIds = {
  options: ["status-planned", "status-in-progress", "status-done"],
  "options-from-supertag": ["kei", "lode-team"],
} as const;

const fieldValue = (
  occurrenceId: string,
  content: string,
  options: Readonly<{ targetNodeId?: string; todo?: "done" | "open" }> = {},
): Seed =>
  seed(
    occurrenceId,
    { content: textContent(content), todo: options.todo },
    undefined,
    options.targetNodeId === undefined ? undefined : { appearance: "reference", nodeId: options.targetNodeId },
  );

const field = (id: string, definitionId: string, label: string, values: readonly Seed[]): Seed =>
  seed(
    id,
    {
      content: textContent(label),
      editable: false,
      field: { definitionId, kind: "field" },
    },
    values,
    { expandable: false },
  );

const localFirstChildren = [
  seed("local-first-summary", { content: textContent("Why local-first changes product design") }),
];

const initialSeeds: readonly Seed[] = [
  seed("projects", { content: textContent("Projects") }, [
    seed("lode", { content: textContent("Lode"), tags: ["#project"] }, [
      field("status-field", "status-definition", "Status", [
        fieldValue("in-progress", "In progress", { targetNodeId: "status-in-progress" }),
      ]),
      field("owner-field", "owner-definition", "Owner", [
        fieldValue("kei-owner", "Kei", { targetNodeId: "kei" }),
        fieldValue("team-owner", "Lode team", { targetNodeId: "lode-team" }),
      ]),
      field("review-date-field", "review-date-definition", "Review date", [
        fieldValue("review-date-value", "Sep 12, 2026"),
      ]),
      field("ready-field", "ready-definition", "Ready", [
        fieldValue("ready-value", "Ready for review", { todo: "open" }),
      ]),
      seed("roadmap", { content: textContent("Design system roadmap") }, [
        seed("outline-m1", { content: textContent("Outline tree structure engine"), todo: "done" }),
        seed("outline-m2", { content: textContent("Bullet drag and drop"), todo: "open" }),
        seed("coverage", {
          content: textContent("Interaction coverage"),
          progress: { max: 5, value: 3 },
        }),
        seed("command-palette", {
          content: [
            { text: "Command palette follows ", type: "text" },
            { id: "outline-m1", label: "Outline tree structure engine", type: "reference" },
          ],
          todo: "open",
        }),
        seed("local-first-reference", { content: textContent("Local-first software essay") }, localFirstChildren, {
          appearance: "reference",
          nodeId: "local-first",
        }),
        seed("empty-container", { content: textContent("Expandable empty node") }),
      ]),
      seed("engine", { content: textContent("Engine facts and projections") }),
    ]),
    seed("home-lab", { content: textContent("Home lab notes"), tags: ["#project"] }),
  ]),
  seed(
    "field-definitions",
    { content: textContent("Field definitions"), editable: false },
    fieldDefinitionFixtures.map((definition) =>
      seed(
        `${definition.id}-occurrence`,
        {
          content: textContent(definition.label),
          editable: false,
          field: { datatype: definition.datatype, kind: "definition" },
        },
        undefined,
        { expandable: false, nodeId: definition.id },
      ),
    ),
  ),
  seed("daily-notes", { content: textContent("Daily notes"), editable: false, intrinsicNodeType: "calendar" }),
  seed("open-decisions", { content: textContent("Open design decisions"), intrinsicNodeType: "search" }),
  seed("kei", { content: textContent("Kei"), tags: ["#person"] }),
  seed("inbox", { content: textContent("Reading inbox") }, [
    seed("local-first-original", { content: textContent("Local-first software essay") }, localFirstChildren, {
      nodeId: "local-first",
    }),
    seed("crdt-survey", { content: textContent("CRDT ordering survey") }),
    seed("quick-capture", { content: [] }),
  ]),
  seed("archive", { content: textContent("Archive") }, [
    seed("value-library", { content: textContent("Value library") }, [
      seed("status-planned-original", { content: textContent("Planned") }, undefined, { nodeId: "status-planned" }),
      seed("status-in-progress-original", { content: textContent("In progress") }, undefined, {
        nodeId: "status-in-progress",
      }),
      seed("status-done-original", { content: textContent("Done") }, undefined, { nodeId: "status-done" }),
      seed("lode-team-original", { content: textContent("Lode team") }, undefined, { nodeId: "lode-team" }),
    ]),
    ...Array.from({ length: 400 }, (_, index) =>
      seed(`note-${String(index)}`, { content: textContent(`Field note ${String(index + 1)}`) }),
    ),
  ]),
];

function graphFromSeeds(seeds: readonly Seed[]): DemoGraph {
  const nodes: Record<string, DemoNode> = {};
  const occurrences: Record<string, DemoOccurrence> = {};
  const visit = (candidate: Seed) => {
    const childOccurrenceIds = candidate.children?.map((child) => child.occurrenceId) ?? [];
    const current = nodes[candidate.nodeId];
    const definesNode = current === undefined || candidate.appearance !== "reference";
    nodes[candidate.nodeId] = {
      childOccurrenceIds: definesNode ? childOccurrenceIds : current.childOccurrenceIds,
      id: candidate.nodeId,
      value: definesNode ? candidate.value : current.value,
    };
    occurrences[candidate.occurrenceId] = {
      appearance: candidate.appearance,
      expandable: candidate.expandable,
      id: candidate.occurrenceId,
      nodeId: candidate.nodeId,
    };
    candidate.children?.forEach(visit);
  };
  seeds.forEach(visit);
  return { nodes, occurrences, rootOccurrenceIds: seeds.map((candidate) => candidate.occurrenceId) };
}

export const initialGraph = graphFromSeeds(initialSeeds);

export const outlineCommands = [
  { description: "Add an actionable checkbox to this node", id: "task", keywords: ["todo"], label: "Make task" },
  {
    description: "Apply the #project Supertag",
    id: "project",
    keywords: ["tag", "supertag"],
    label: "Add #project",
  },
] as const;
