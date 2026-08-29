import type { EngineCommand, EngineQueryKind } from "@lode/sdk";

import {
  ACTION_DEFINITIONS,
  type AuthoredAction,
  type Fact,
  type FactBody,
  type FieldDefinitionConfigurationValue,
  type GovernanceAction,
  type NodeSeed,
  type PreviousValue,
  type ResolutionDecision,
  type SearchClause,
  type SearchFieldValue,
  type SearchScopeTarget,
  type SequenceAnchor,
  type TransitEnvelope,
} from "../../src/domain/fact/index.js";
import type { AuthoredActionDefinition } from "../../src/domain/fact/action-catalog.js";
import { PROJECTION_SECTION_NAMES, type ProjectionSectionName } from "../../src/domain/reconcile/index.js";
import { ACTION_FIELD_AUTHORITY, ACTION_ORACLE_ROUTE } from "./fact-sot-action-coverage.js";
import { PUBLIC_DOMAIN_QUERY_KINDS } from "./reconcile/fact-oracle-public-query.js";

type FactBodyFieldClassification = {
  [Kind in FactBody["kind"]]: Readonly<
    Record<Exclude<keyof Extract<FactBody, Readonly<{ kind: Kind }>>, "kind">, AuthorityRole>
  >;
};

type AuthorityRole = "domain-choice" | "stable-identity" | "causal-observation" | "governance-authority";
type QueryOracleRoute = "domain-observable" | "runtime-excluded";
type GovernanceFieldClassification = {
  [Kind in GovernanceAction["kind"]]: Readonly<
    Record<Exclude<keyof Extract<GovernanceAction, Readonly<{ kind: Kind }>>, "kind">, AuthorityRole>
  >;
};
type UnionFieldNames<Value> = Value extends unknown ? Exclude<keyof Value, "kind"> : never;
type FieldClassification<Value> = Readonly<Record<keyof Value, AuthorityRole>>;
type UnionFieldClassification<Value> = Readonly<Record<UnionFieldNames<Value>, AuthorityRole>>;

type NodeCreateAction = Extract<AuthoredAction, Readonly<{ kind: "node-create" }>>;
type TemplateFieldAddAction = Extract<AuthoredAction, Readonly<{ kind: "template-field-add" }>>;
type OriginalPlacement = Exclude<NodeCreateAction["originalPlacement"], null>;
type TemplateFieldDefinition = TemplateFieldAddAction["fieldDefinition"];
type TransitPeer = Extract<GovernanceAction, Readonly<{ kind: "transit-rotate" }>>["peers"][number];

export const FACT_BODY_FIELD_AUTHORITY = {
  action: {
    actorId: "governance-authority",
    intent: "domain-choice",
    actions: "domain-choice",
  },
  resolution: {
    actorId: "governance-authority",
    decision: "domain-choice",
    proposalFactIds: "causal-observation",
    adjudicatesResolutionIds: "causal-observation",
  },
  governance: {
    actorId: "governance-authority",
    action: "governance-authority",
  },
  history: {
    channelId: "stable-identity",
    operation: "domain-choice",
    targetStepId: "causal-observation",
    actionFactCount: "causal-observation",
  },
} as const satisfies FactBodyFieldClassification;

export const FACT_COORDINATE_AUTHORITY = {
  id: "derived-from-coordinate",
  coordinate: "causal-observation",
  body: "domain-authority",
} as const satisfies Readonly<
  Record<keyof Fact, "derived-from-coordinate" | "causal-observation" | "domain-authority">
>;

export const CAUSAL_COORDINATE_FIELD_AUTHORITY = {
  dot: "causal-observation",
  observed: "causal-observation",
  lamport: "causal-observation",
} as const satisfies Readonly<Record<keyof Fact["coordinate"], "causal-observation">>;

export const FACT_DOT_FIELD_AUTHORITY = {
  replicaId: "stable-identity",
  sequence: "causal-observation",
} as const satisfies Readonly<Record<keyof Fact["coordinate"]["dot"], AuthorityRole>>;

export const SEQUENCE_ANCHOR_FIELD_AUTHORITY = {
  after: "causal-observation",
  before: "causal-observation",
  affinity: "domain-choice",
  fallback: "domain-choice",
} as const satisfies FieldClassification<SequenceAnchor>;

export const ORIGINAL_PLACEMENT_FIELD_AUTHORITY = {
  placementId: "stable-identity",
  anchor: "causal-observation",
} as const satisfies FieldClassification<OriginalPlacement>;

export const NODE_SEED_FIELD_AUTHORITY = {
  text: "domain-choice",
} as const satisfies FieldClassification<NodeSeed>;

export const NODE_SEED_TEXT_FIELD_AUTHORITY = {
  value: "domain-choice",
  attributes: "domain-choice",
} as const satisfies FieldClassification<NodeSeed["text"][number]>;

export const TEMPLATE_FIELD_DEFINITION_FIELD_AUTHORITY = {
  fieldDefinitionId: "stable-identity",
  seed: "domain-choice",
} as const satisfies UnionFieldClassification<TemplateFieldDefinition>;

export const PREVIOUS_VALUE_FIELD_AUTHORITY = {
  value: "domain-choice",
} as const satisfies UnionFieldClassification<PreviousValue>;

export const FIELD_CONFIGURATION_FIELD_AUTHORITY = {
  datatypeNodeId: "stable-identity",
  optionsSupertagId: "stable-identity",
  cardinalityNodeId: "stable-identity",
  optionalityNodeId: "stable-identity",
  expression: "domain-choice",
} as const satisfies UnionFieldClassification<FieldDefinitionConfigurationValue>;

export const FIELD_INITIALIZATION_EXPRESSION_FIELD_AUTHORITY = {
  kind: "domain-choice",
  sourceFieldDefinitionId: "stable-identity",
} as const satisfies FieldClassification<
  Extract<FieldDefinitionConfigurationValue, Readonly<{ kind: "initialization-expression" }>>["expression"]
>;

export const SEARCH_CLAUSE_FIELD_AUTHORITY = {
  supertagId: "stable-identity",
  text: "domain-choice",
  fieldDefinitionId: "stable-identity",
  defined: "domain-choice",
  value: "domain-choice",
  operator: "domain-choice",
  date: "domain-choice",
  target: "domain-choice",
  targetNodeId: "stable-identity",
} as const satisfies UnionFieldClassification<SearchClause>;

export const SEARCH_FIELD_VALUE_FIELD_AUTHORITY = {
  nodeId: "stable-identity",
  value: "domain-choice",
} as const satisfies UnionFieldClassification<SearchFieldValue>;

export const SEARCH_SCOPE_TARGET_FIELD_AUTHORITY = {
  nodeId: "stable-identity",
} as const satisfies UnionFieldClassification<SearchScopeTarget>;

export const TRANSIT_ENVELOPE_FIELD_AUTHORITY = {
  ephemeral: "governance-authority",
  seal: "governance-authority",
} as const satisfies FieldClassification<TransitEnvelope>;

export const TRANSIT_PEER_FIELD_AUTHORITY = {
  peerId: "stable-identity",
  envelope: "governance-authority",
} as const satisfies FieldClassification<TransitPeer>;

export const COMMAND_ORACLE_ROUTE = {
  edit: "commits-authored-actions",
  "resolve-review": "commits-resolution",
  "adjudicate-resolution": "commits-resolution",
  undo: "commits-history-compensation",
  redo: "commits-history-compensation",
  "finalize-deletions": "commits-terminal-actions",
} as const satisfies Readonly<Record<EngineCommand["kind"], string>>;

export const QUERY_ORACLE_ROUTE = {
  projection: "domain-observable",
  review: "domain-observable",
  history: "domain-observable",
  invocation: "runtime-excluded",
  conflicts: "domain-observable",
  "supertag-instances": "domain-observable",
  backlinks: "domain-observable",
  "search-results": "domain-observable",
  "view-rows": "domain-observable",
  outline: "domain-observable",
  "debug-node": "domain-observable",
  "trash-evidence": "domain-observable",
} as const satisfies Readonly<Record<EngineQueryKind, QueryOracleRoute>>;

export const RESOLUTION_ORACLE_ROUTE = {
  accept: "domain-observable",
  reject: "domain-observable",
} as const satisfies Readonly<Record<ResolutionDecision, "domain-observable">>;

export const GOVERNANCE_ORACLE_ROUTE = {
  "workspace-establish": "domain-observable",
  "actor-admit": "domain-observable",
  "actor-remove": "domain-observable",
  "owner-transfer": "domain-observable",
  "peer-admit": "domain-observable",
  "transit-rotate": "domain-observable",
} as const satisfies Readonly<Record<GovernanceAction["kind"], "domain-observable">>;

export const GOVERNANCE_FIELD_AUTHORITY = {
  "workspace-establish": { ownerActorId: "governance-authority" },
  "actor-admit": { actorId: "governance-authority" },
  "actor-remove": { actorId: "governance-authority" },
  "owner-transfer": { nextOwnerActorId: "governance-authority" },
  "peer-admit": {
    peerId: "stable-identity",
    peerKxPublicKey: "governance-authority",
    envelope: "governance-authority",
    epoch: "causal-observation",
  },
  "transit-rotate": {
    epoch: "causal-observation",
    peers: "governance-authority",
  },
} as const satisfies GovernanceFieldClassification;

export const PROJECTION_SECTION_ORACLE_ROUTE = {
  nodes: "paged-domain-observable",
  occurrences: "paged-domain-observable",
  childOccurrences: "paged-domain-observable",
  nodeOwners: "paged-domain-observable",
  metanodes: "paged-domain-observable",
  workspaceSystemNodes: "paged-domain-observable",
  supertagApplications: "paged-domain-observable",
  supertagTemplateNodes: "paged-domain-observable",
  templateFields: "paged-domain-observable",
  optionalFieldContributions: "paged-domain-observable",
  templateNodeInstances: "paged-domain-observable",
  supertagExtensions: "paged-domain-observable",
  supertagInstanceSupertags: "paged-domain-observable",
  supertagExtensionConflicts: "paged-domain-observable",
  conflictIssues: "paged-domain-observable",
  materializedFields: "paged-domain-observable",
  effectiveFields: "paged-domain-observable",
  optionalFieldSuggestions: "paged-domain-observable",
  fieldDefinitionConfigurations: "paged-domain-observable",
  typedFieldValues: "paged-domain-observable",
  searchExpressions: "paged-domain-observable",
  sharedDefaultViewDefinitions: "paged-domain-observable",
} as const satisfies Readonly<Record<ProjectionSectionName, "paged-domain-observable">>;

export function factSotCompletenessProblems(): readonly string[] {
  const problems: string[] = [];
  const families = Object.values(ACTION_DEFINITIONS) as unknown as readonly Readonly<
    Record<string, AuthoredActionDefinition>
  >[];
  const definitions = families.flatMap((family) => Object.values(family));
  compareSets(
    "Authored Action kinds",
    definitions.map((definition) => definition.kind),
    Object.keys(ACTION_ORACLE_ROUTE),
    problems,
  );
  const fieldAuthority = ACTION_FIELD_AUTHORITY as Readonly<Record<string, Readonly<Record<string, AuthorityRole>>>>;
  for (const definition of definitions) {
    compareSets(
      `Authored Action ${definition.kind} fields`,
      Object.keys(definition.fields),
      Object.keys(fieldAuthority[definition.kind] ?? {}),
      problems,
    );
  }
  compareSets("Projection sections", PROJECTION_SECTION_NAMES, Object.keys(PROJECTION_SECTION_ORACLE_ROUTE), problems);
  compareSets(
    "public domain Query families",
    Object.entries(QUERY_ORACLE_ROUTE).flatMap(([kind, route]) => (route === "domain-observable" ? [kind] : [])),
    PUBLIC_DOMAIN_QUERY_KINDS,
    problems,
  );

  return problems;
}

function compareSets(label: string, actual: readonly string[], expected: readonly string[], problems: string[]): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = [...actualSet].filter((value) => !expectedSet.has(value)).sort();
  const stale = [...expectedSet].filter((value) => !actualSet.has(value)).sort();
  if (missing.length > 0) {
    problems.push(`${label} lack Fact-only decisions: ${missing.join(", ")}`);
  }
  if (stale.length > 0) {
    problems.push(`${label} retain stale Fact-only decisions: ${stale.join(", ")}`);
  }
}
