import type { EngineCommand } from "@lode/sdk";

type Mutation = Extract<EngineCommand, { kind: "mutate" }>["mutations"][number];

const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;

export function animeNotesProgram(workspaceNodeId = "anime-notes"): readonly Mutation[] {
  return [
    ...outline(workspaceNodeId),
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
    supertagApplication("frieren", "anime-work"),
    supertagApplication("fern", "character"),
    supertagApplication("quick-note", "quick-impression"),
    supertagApplication("quick-note", "anime-context"),
    supertagApplication("review-note", "review"),
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
    ["anime-work", "anime-work-occurrence", "definition-library", "supertag-definition"],
    ["character", "character-occurrence", "definition-library", "supertag-definition"],
    ["anime-context", "anime-context-occurrence", "definition-library", "supertag-definition"],
    ["quick-impression", "quick-impression-occurrence", "definition-library", "supertag-definition"],
    ["review", "review-occurrence", "definition-library", "supertag-definition"],
    ["title-field", "title-field-occurrence", "definition-library", "field-definition"],
    ["work-field", "work-field-occurrence", "definition-library", "field-definition"],
    ["context-field", "context-field-occurrence", "definition-library", "field-definition"],
    ["impression-field", "impression-field-occurrence", "definition-library", "field-definition"],
    ["rating-field", "rating-field-occurrence", "definition-library", "field-definition"],
    ["frieren", "frieren-occurrence", "library"],
    ["fern", "fern-occurrence", "library"],
    ["quick-note", "quick-note-occurrence", "notes"],
    ["review-note", "review-note-occurrence", "notes"],
  ] as const;
  return placements.map(([nodeId, occurrenceId, parentNodeId, intrinsicNodeType]) =>
    nodeAt(nodeId, parentNodeId, occurrenceId, undefined, intrinsicNodeType),
  );
}

export function reviewApplicationProposal(): readonly Mutation[] {
  return [supertagApplication("quick-note", "review")];
}

function supertagApplication(nodeId: string, supertagId: string): Mutation {
  const applicationNodeId = `${nodeId}-${supertagId}-application`;
  return {
    kind: "supertag-application-create",
    hostNodeId: nodeId,
    supertagId,
    metanodeId: `${nodeId}-metanode`,
    applicationNodeId,
    applicationOccurrenceId: `${applicationNodeId}-occurrence`,
    definitionOccurrenceId: `${applicationNodeId}-definition-occurrence`,
    relationDefinitionOccurrenceId: `${applicationNodeId}-relation-definition-occurrence`,
    anchor: end,
  };
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
  intrinsicNodeType?: "supertag-definition" | "field-definition",
): Mutation {
  return {
    kind: "node-create",
    nodeId,
    occurrenceId,
    parentNodeId,
    anchor: end,
    ...(intrinsicNodeType === undefined ? {} : { intrinsicNodeType }),
    ...(text === undefined
      ? {}
      : {
          seed: {
            text: [...text].map((value) => ({ value, attributes: {} })),
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
