import type { EngineCommand } from "@lode/sdk";

type Mutation = Extract<EngineCommand, { kind: "mutate" }>["mutations"][number];

const VIEW_SCHEMA_PROPERTY = "view.schemaId";
const VIEW_LAYOUT_PROPERTY = "view.layout";
const VIEW_FIELDS_PROPERTY = "view.fieldDefinitionIds";

const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;

export function animeNotesProgram(workspaceNodeId = "anime-notes"): readonly Mutation[] {
  return [
    ...outline(workspaceNodeId),
    viewProperty(VIEW_SCHEMA_PROPERTY, "review"),
    viewProperty(VIEW_LAYOUT_PROPERTY, "table"),
    viewProperty(VIEW_FIELDS_PROPERTY, ["work-field", "rating-field"]),
    ...(
      [
        ["root", "Root"],
        ["definition-library", "Definition Library"],
        ["library", "Library"],
        ["notes", "Notes"],
        ["frieren", "Frieren: Beyond Journey's End"],
        ["fern", "Fern"],
        ["quick-note", "Quick note"],
        ["review-note", "Review note"],
      ] as const
    ).map(([nodeId, insert]): Mutation => ({
      kind: "text-splice",
      nodeId,
      deleteAtomIds: [],
      anchor: end,
      insert,
    })),
    ...schemaFields("anime-work", ["title-field"]),
    ...schemaFields("character", ["work-field"]),
    ...schemaFields("anime-context", ["context-field"]),
    ...schemaFields("quick-impression", ["work-field", "impression-field"]),
    ...schemaFields("review", ["work-field", "rating-field"]),
    schemaApplication("frieren", "anime-work"),
    schemaApplication("fern", "character"),
    schemaApplication("quick-note", "quick-impression"),
    schemaApplication("quick-note", "anime-context"),
    schemaApplication("review-note", "review"),
    ...materializedField("quick-note", "work-field", "quick-work", "quick-work-reference", "frieren"),
    ...materializedField(
      "quick-note",
      "impression-field",
      "quick-impression-value",
      "quick-impression-text",
      "impression-text",
      "Quiet, patient, and humane",
    ),
    ...materializedField("review-note", "work-field", "review-work", "review-work-reference", "frieren"),
    ...materializedField("review-note", "rating-field", "review-rating", "review-rating-text", "rating-text", "9/10"),
  ];
}

function outline(workspaceNodeId: string): readonly Mutation[] {
  const placements = [
    ["root", "root-occurrence", workspaceNodeId],
    ["definition-library", "definition-library-occurrence", "root"],
    ["library", "library-occurrence", "root"],
    ["notes", "notes-occurrence", "root"],
    ["anime-work", "anime-work-occurrence", "definition-library", "schema"],
    ["character", "character-occurrence", "definition-library", "schema"],
    ["anime-context", "anime-context-occurrence", "definition-library", "schema"],
    ["quick-impression", "quick-impression-occurrence", "definition-library", "schema"],
    ["review", "review-occurrence", "definition-library", "schema"],
    ["title-field", "title-field-occurrence", "definition-library", "field-definition"],
    ["work-field", "work-field-occurrence", "definition-library", "field-definition"],
    ["context-field", "context-field-occurrence", "definition-library", "field-definition"],
    ["impression-field", "impression-field-occurrence", "definition-library", "field-definition"],
    ["rating-field", "rating-field-occurrence", "definition-library", "field-definition"],
    ["review-view", "review-view-occurrence", "definition-library", "view"],
    ["frieren", "frieren-occurrence", "library"],
    ["fern", "fern-occurrence", "library"],
    ["quick-note", "quick-note-occurrence", "notes"],
    ["review-note", "review-note-occurrence", "notes"],
  ] as const;
  return placements.map(([nodeId, occurrenceId, parentNodeId, nodeType]) =>
    nodeAt(nodeId, parentNodeId, occurrenceId, undefined, nodeType),
  );
}

function viewProperty(key: string, value: string | string[]): Mutation {
  return {
    kind: "value-set",
    target: { kind: "node", id: "review-view" },
    namespace: "property",
    key,
    value,
  };
}

export function moodProposal(): readonly Mutation[] {
  return [
    nodeAt("mood-field", "definition-library", "mood-field-original", undefined, "field-definition"),
    {
      kind: "schema-field-add",
      schemaId: "quick-impression",
      fieldDefinitionId: "mood-field",
      fieldNodeId: "quick-impression-mood-field-template-field",
      fieldOccurrenceId: "quick-impression-mood-field-template-field-occurrence",
      anchor: end,
    },
  ];
}

export function pendingMoodEdit(): readonly Mutation[] {
  return [
    nodeAt("mood-on-quick-note", "quick-note", "mood-on-quick-note-occurrence"),
    nodeAt("mood-text", "mood-on-quick-note", "mood-text-occurrence"),
    {
      kind: "text-splice",
      nodeId: "mood-text",
      deleteAtomIds: [],
      anchor: end,
      insert: "Reflective",
    },
    {
      kind: "field-materialize",
      ownerNodeId: "quick-note",
      fieldDefinitionId: "mood-field",
      fieldNodeId: "mood-on-quick-note",
      fieldOccurrenceId: "mood-on-quick-note-occurrence",
    },
  ];
}

export function reviewApplicationProposal(): readonly Mutation[] {
  return [schemaApplication("quick-note", "review")];
}

function schemaFields(schemaId: string, fieldDefinitionIds: readonly string[]): Mutation[] {
  return fieldDefinitionIds.map((fieldDefinitionId) => ({
    kind: "schema-field-add",
    schemaId,
    fieldDefinitionId,
    fieldNodeId: `${schemaId}-${fieldDefinitionId}-template-field`,
    fieldOccurrenceId: `${schemaId}-${fieldDefinitionId}-template-field-occurrence`,
    anchor: end,
  }));
}

function schemaApplication(nodeId: string, schemaId: string): Mutation {
  return { kind: "schema-apply", nodeId, schemaId, anchor: end };
}

function materializedField(
  ownerNodeId: string,
  fieldDefinitionId: string,
  fieldNodeId: string,
  valueOccurrenceId: string,
  valueNodeId: string,
  valueText?: string,
): readonly Mutation[] {
  const fieldOccurrenceId = `${fieldNodeId}-occurrence`;
  return [
    nodeAt(fieldNodeId, ownerNodeId, fieldOccurrenceId),
    {
      kind: "field-materialize",
      ownerNodeId,
      fieldDefinitionId,
      fieldNodeId,
      fieldOccurrenceId,
    },
    valueText === undefined
      ? occurrence(valueOccurrenceId, valueNodeId, fieldNodeId)
      : nodeAt(valueNodeId, fieldNodeId, valueOccurrenceId, valueText),
  ];
}

function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  text?: string,
  nodeType?: "schema" | "field-definition" | "view",
): Mutation {
  return {
    kind: "node-create",
    nodeId,
    occurrenceId,
    parentNodeId,
    anchor: end,
    ...(nodeType === undefined ? {} : { nodeType }),
    ...(text === undefined
      ? {}
      : {
          seed: {
            text: [...text].map((value) => ({ value, attributes: {} })),
            properties: {},
            metadata: {},
          },
        }),
  };
}

function occurrence(occurrenceId: string, nodeId: string, parentNodeId: string): Mutation {
  return {
    kind: "occurrence-create",
    occurrenceId,
    nodeId,
    parentNodeId,
    anchor: end,
  };
}
