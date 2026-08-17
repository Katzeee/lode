import type { DesktopClient } from "@lode/desktop-client";
import type { EditMutation } from "@lode/sdk";

import { end, nodeType, optionalFlag, projection, required, requiredFlag } from "./domain-command-support.js";

export async function structureDomainMutations(
  client: DesktopClient,
  workspaceId: string,
  argv: readonly string[],
): Promise<readonly EditMutation[] | null> {
  const action = required(argv[0], "domain action");
  if (action === "node-create" || action === "supertag-create" || action === "field-definition-create") {
    const nodeId = required(argv[1], "Node identity");
    const parentNodeId = required(argv[2], "parent Node identity");
    const intrinsicNodeType =
      action === "supertag-create"
        ? "supertag-definition"
        : action === "field-definition-create"
          ? "field-definition"
          : optionalFlag(argv, "--type");
    const text = optionalFlag(argv, "--text");
    return [
      {
        kind: "node-create",
        nodeId,
        occurrenceId: optionalFlag(argv, "--occurrence") ?? `${nodeId}-occurrence`,
        parentNodeId,
        anchor: end,
        ...(intrinsicNodeType === undefined ? {} : { intrinsicNodeType: nodeType(intrinsicNodeType) }),
        ...(text === undefined ? {} : { seed: { text: [{ value: text, attributes: {} }] } }),
      },
    ];
  }
  if (action === "node-trash") {
    return [{ kind: "node-delete", nodeId: required(argv[1], "Node identity") }];
  }
  if (action === "node-restore") {
    return [
      {
        kind: "node-restore",
        nodeId: required(argv[1], "Node identity"),
        deletionFactId: requiredFlag(argv, "--deletion-fact"),
        occurrenceId: requiredFlag(argv, "--occurrence"),
        ownerNodeId: requiredFlag(argv, "--owner"),
        parentNodeId: requiredFlag(argv, "--parent"),
        anchor: end,
      },
    ];
  }
  if (action === "occurrence-move") {
    return [
      {
        kind: "occurrence-move",
        occurrenceId: required(argv[1], "Occurrence identity"),
        parentNodeId: required(argv[2], "parent Node identity"),
        anchor: end,
      },
    ];
  }
  if (action === "reference-create") {
    return [
      {
        kind: "occurrence-create",
        occurrenceId: required(argv[3], "Reference Occurrence identity"),
        nodeId: required(argv[1], "target Node identity"),
        parentNodeId: required(argv[2], "parent Node identity"),
        anchor: end,
      },
    ];
  }
  if (action === "supertag-apply") {
    const hostNodeId = required(argv[1], "host Node identity");
    const supertagId = required(argv[2], "Supertag identity");
    const applicationNodeId = optionalFlag(argv, "--application") ?? `${hostNodeId}-${supertagId}-application`;
    return [
      {
        kind: "supertag-application-create",
        hostNodeId,
        metanodeId: optionalFlag(argv, "--metanode") ?? `${hostNodeId}-metanode`,
        supertagId,
        applicationNodeId,
        applicationOccurrenceId: `${applicationNodeId}-occurrence`,
        relationDefinitionOccurrenceId: `${applicationNodeId}-relation-definition`,
        definitionOccurrenceId: `${applicationNodeId}-definition`,
        anchor: end,
      },
    ];
  }
  if (action === "supertag-remove") {
    const hostNodeId = required(argv[1], "host Node identity");
    const supertagId = required(argv[2], "Supertag identity");
    const applicationNodeId = optionalFlag(argv, "--application") ?? `${hostNodeId}-${supertagId}-application`;
    return [
      {
        kind: "supertag-remove",
        hostNodeId,
        supertagId,
        applicationNodeId,
        applicationOccurrenceId: `${applicationNodeId}-occurrence`,
        relationDefinitionOccurrenceId: `${applicationNodeId}-relation-definition`,
        definitionOccurrenceId: `${applicationNodeId}-definition`,
        detachedValueNodeId: `detached-supertag-value:v1:${encodeURIComponent(applicationNodeId)}`,
        detachedValueOccurrenceId: `detached-supertag-value-occ:v1:${encodeURIComponent(applicationNodeId)}`,
      },
    ];
  }
  if (action === "supertag-extend" || action === "supertag-unextend") {
    return [
      {
        kind: action === "supertag-extend" ? "supertag-extension-add" : "supertag-extension-remove",
        supertagId: required(argv[1], "Supertag identity"),
        baseSupertagId: required(argv[2], "base Supertag identity"),
        ...(action === "supertag-extend" ? { anchor: end } : {}),
      } as EditMutation,
    ];
  }
  if (action === "template-field-create" || action === "template-field-add-existing") {
    return [templateFieldMutation(action, argv)];
  }
  if (action === "template-field-discover") {
    return [
      {
        kind: "supertag-template-field-make-discoverable",
        supertagId: required(argv[1], "Supertag identity"),
        templateFieldNodeId: required(argv[2], "Template Field identity"),
        fieldDefinitionId: required(argv[3], "Field Definition identity"),
      },
    ];
  }
  if (action === "template-field-remove") {
    return [
      {
        kind: "supertag-template-field-remove",
        supertagId: required(argv[1], "Supertag identity"),
        templateFieldNodeId: required(argv[2], "Template Field identity"),
      },
    ];
  }
  if (action === "template-field-visibility") {
    const visibility = required(argv[3], "Template Field visibility");
    if (visibility !== "normal" && visibility !== "pinned") {
      throw new Error("Template Field visibility must be normal or pinned");
    }
    return [
      {
        kind: "supertag-template-field-visibility-set",
        supertagId: required(argv[1], "Supertag identity"),
        templateFieldNodeId: required(argv[2], "Template Field identity"),
        visibility,
      },
    ];
  }
  if (action === "template-field-default") {
    return [
      {
        kind: "supertag-template-field-static-default-set",
        supertagId: required(argv[1], "Supertag identity"),
        templateFieldNodeId: required(argv[2], "Template Field identity"),
        value: required(argv[3], "Static Default value"),
      },
    ];
  }
  if (action === "optional-field-add") {
    return optionalFieldMutation(client, workspaceId, argv);
  }
  return null;
}

function templateFieldMutation(
  action: "template-field-create" | "template-field-add-existing",
  argv: readonly string[],
): EditMutation {
  const supertagId = required(argv[1], "Supertag identity");
  const templateFieldNodeId = required(argv[2], "Template Field identity");
  const common = {
    supertagId,
    templateFieldNodeId,
    templateFieldOccurrenceId: `${templateFieldNodeId}-occurrence`,
    fieldDefinitionId: required(argv[3], "Field Definition identity"),
    definitionOccurrenceId: `${templateFieldNodeId}-definition`,
    staticDefaultValueNodeId: `${templateFieldNodeId}-default`,
    staticDefaultValueOccurrenceId: `${templateFieldNodeId}-default-occurrence`,
    anchor: end,
  };
  const text = optionalFlag(argv, "--text");
  return action === "template-field-create"
    ? {
        kind: "supertag-template-field-create",
        ...common,
        ...(text === undefined ? {} : { fieldDefinitionSeed: { text: [{ value: text, attributes: {} }] } }),
      }
    : { kind: "supertag-template-field-add-existing", ...common };
}

async function optionalFieldMutation(
  client: DesktopClient,
  workspaceId: string,
  argv: readonly string[],
): Promise<readonly EditMutation[]> {
  const supertagId = required(argv[1], "Supertag identity");
  const fieldDefinitionId = required(argv[2], "Field Definition identity");
  const contributionNodeId = optionalFlag(argv, "--contribution") ?? `${supertagId}-${fieldDefinitionId}-optional`;
  const metanodes = await projection(client, workspaceId, "metanodes");
  const existingMetanodeId = metanodes[supertagId];
  const metanodeId =
    optionalFlag(argv, "--metanode") ??
    (typeof existingMetanodeId === "string" ? existingMetanodeId : `${supertagId}-metanode`);
  const nurseryNodeId = `${supertagId}-optional-fields`;
  return [
    {
      kind: "supertag-optional-field-contribution-add",
      supertagId,
      metanodeId,
      fieldNurseryNodeId: nurseryNodeId,
      fieldNurseryOccurrenceId: `${nurseryNodeId}-occurrence`,
      nurseryDefinitionOccurrenceId: `${nurseryNodeId}-definition`,
      nurseryValueNodeId: `${nurseryNodeId}-value`,
      nurseryValueOccurrenceId: `${nurseryNodeId}-value-occurrence`,
      contributionNodeId,
      contributionOccurrenceId: `${contributionNodeId}-occurrence`,
      fieldDefinitionId,
      definitionOccurrenceId: `${contributionNodeId}-definition`,
      valueNodeId: `${contributionNodeId}-value`,
      valueOccurrenceId: `${contributionNodeId}-value-occurrence`,
      anchor: end,
    },
  ];
}
