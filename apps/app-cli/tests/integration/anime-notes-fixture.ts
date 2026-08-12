import {
  VIEW_FIELDS_PROPERTY,
  VIEW_LAYOUT_PROPERTY,
  VIEW_SCHEMA_PROPERTY,
  type EngineCommand,
} from "@lode/engine";

type Mutation = Extract<EngineCommand, { kind: "mutate" }>["mutations"][number];

const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;

export function animeNotesProgram(): readonly Mutation[] {
  const nodes = [
    "root",
    "definition-library",
    "library",
    "notes",
    "anime-work",
    "character",
    "anime-context",
    "quick-impression",
    "review",
    "review-view",
    "title-field",
    "work-field",
    "context-field",
    "impression-field",
    "rating-field",
    "frieren",
    "fern",
    "quick-note",
    "review-note",
    "quick-work",
    "quick-impression-value",
    "review-work",
    "review-rating",
    "impression-text",
    "rating-text",
  ];
  return [
    ...nodes.map((nodeId): Mutation => ({ kind: "node-create", nodeId })),
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
        ["impression-text", "Quiet, patient, and humane"],
        ["rating-text", "9/10"],
      ] as const
    ).map(([nodeId, insert]): Mutation => ({
      kind: "text-splice",
      nodeId,
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert,
    })),
    ...outline(),
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
    ...materializedField(
      "quick-note",
      "quick-note-occurrence",
      "work-field",
      "quick-work",
      "quick-work-reference",
      "frieren",
    ),
    ...materializedField(
      "quick-note",
      "quick-note-occurrence",
      "impression-field",
      "quick-impression-value",
      "quick-impression-text",
      "impression-text",
    ),
    ...materializedField(
      "review-note",
      "review-note-occurrence",
      "work-field",
      "review-work",
      "review-work-reference",
      "frieren",
    ),
    ...materializedField(
      "review-note",
      "review-note-occurrence",
      "rating-field",
      "review-rating",
      "review-rating-text",
      "rating-text",
    ),
  ];
}

function outline(): readonly Mutation[] {
  const placements = [
    ["root", "root-occurrence", null],
    ["definition-library", "definition-library-occurrence", "root-occurrence"],
    ["library", "library-occurrence", "root-occurrence"],
    ["notes", "notes-occurrence", "root-occurrence"],
    ["anime-work", "anime-work-occurrence", "definition-library-occurrence"],
    ["character", "character-occurrence", "definition-library-occurrence"],
    ["anime-context", "anime-context-occurrence", "definition-library-occurrence"],
    ["quick-impression", "quick-impression-occurrence", "definition-library-occurrence"],
    ["review", "review-occurrence", "definition-library-occurrence"],
    ["title-field", "title-field-occurrence", "definition-library-occurrence"],
    ["work-field", "work-field-occurrence", "definition-library-occurrence"],
    ["context-field", "context-field-occurrence", "definition-library-occurrence"],
    ["impression-field", "impression-field-occurrence", "definition-library-occurrence"],
    ["rating-field", "rating-field-occurrence", "definition-library-occurrence"],
    ["review-view", "review-view-occurrence", "definition-library-occurrence"],
    ["frieren", "frieren-occurrence", "library-occurrence"],
    ["fern", "fern-occurrence", "library-occurrence"],
    ["quick-note", "quick-note-occurrence", "notes-occurrence"],
    ["review-note", "review-note-occurrence", "notes-occurrence"],
  ] as const;
  return placements.map(([nodeId, occurrenceId, parentOccurrenceId]) =>
    occurrence(occurrenceId, nodeId, parentOccurrenceId),
  );
}

function viewProperty(key: string, value: string | string[]): Mutation {
  return {
    kind: "value-set",
    owner: { kind: "node", id: "review-view" },
    namespace: "property",
    key,
    value,
  };
}

export function moodProposal(): readonly Mutation[] {
  return [
    { kind: "node-create", nodeId: "mood-field" },
    {
      kind: "schema-field-add",
      schemaId: "quick-impression",
      fieldDefinitionId: "mood-field",
      anchor: end,
    },
  ];
}

export function pendingMoodEdit(): readonly Mutation[] {
  return [
    { kind: "node-create", nodeId: "mood-on-quick-note" },
    { kind: "node-create", nodeId: "mood-text" },
    {
      kind: "text-splice",
      nodeId: "mood-text",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "Reflective",
    },
    occurrence("mood-on-quick-note-occurrence", "mood-on-quick-note", "quick-note-occurrence"),
    {
      kind: "field-materialize",
      ownerNodeId: "quick-note",
      fieldDefinitionId: "mood-field",
      fieldNodeId: "mood-on-quick-note",
      fieldOccurrenceId: "mood-on-quick-note-occurrence",
    },
    occurrence("mood-text-occurrence", "mood-text", "mood-on-quick-note-occurrence"),
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
    anchor: end,
  }));
}

function schemaApplication(nodeId: string, schemaId: string): Mutation {
  return { kind: "schema-apply", nodeId, schemaId, anchor: end };
}

function materializedField(
  ownerNodeId: string,
  ownerOccurrenceId: string,
  fieldDefinitionId: string,
  fieldNodeId: string,
  valueOccurrenceId: string,
  valueNodeId: string,
): readonly Mutation[] {
  const fieldOccurrenceId = `${fieldNodeId}-occurrence`;
  return [
    occurrence(fieldOccurrenceId, fieldNodeId, ownerOccurrenceId),
    {
      kind: "field-materialize",
      ownerNodeId,
      fieldDefinitionId,
      fieldNodeId,
      fieldOccurrenceId,
    },
    occurrence(valueOccurrenceId, valueNodeId, fieldOccurrenceId),
  ];
}

function occurrence(
  occurrenceId: string,
  nodeId: string,
  parentOccurrenceId: string | null,
): Mutation {
  return {
    kind: "occurrence-create",
    occurrenceId,
    nodeId,
    parentOccurrenceId,
    parentPolicy: "cascade",
    anchor: end,
  };
}
