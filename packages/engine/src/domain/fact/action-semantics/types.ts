import type { FactActionId, SequenceAnchor } from "../fact-value-types.js";
import type { IntrinsicNodeType } from "../intrinsic-node-type-types.js";

export const SELF_FACT_ACTION = Symbol("self Fact Action");
export type IdentityRole = "declare" | "require" | "relate" | "contribution-owner";

export type SemanticIdentity =
  | Readonly<{ kind: "node"; nodeId: string }>
  | Readonly<{ kind: "node-children"; nodeId: string }>
  | Readonly<{ kind: "occurrence"; occurrenceId: string }>
  | Readonly<{ kind: "fact-action"; factActionId: FactActionId }>
  | Readonly<{ kind: "inline-reference"; inlineReferenceId: string }>
  | Readonly<{ kind: "inline-alias"; inlineReferenceId: string; aliasNodeId: string }>
  | Readonly<{ kind: "supertag"; nodeId: string; instanceLookup: boolean }>
  | Readonly<{ kind: "field-definition"; nodeId: string }>
  | Readonly<{ kind: "intrinsic-node-type"; nodeId: string; intrinsicNodeType: IntrinsicNodeType }>;

export type IdentityContribution = Readonly<{
  kind: "identity";
  identity: SemanticIdentity;
  roles: readonly IdentityRole[];
}>;

export type CollectionName =
  | "supertag-extension"
  | "supertag-application"
  | "template-field"
  | "template-member"
  | "optional-field"
  | "shared-default-view"
  | "view-column"
  | "view-sort"
  | "view-group"
  | "view-filter"
  | "search-expression";

export type CollectionContribution =
  | Readonly<{
      kind: "causal-collection";
      collection: CollectionName;
      operation: "add";
      key: string | typeof SELF_FACT_ACTION;
      entryId: typeof SELF_FACT_ACTION;
      initialRegisters?: Readonly<Record<string, unknown>>;
    }>
  | Readonly<{
      kind: "causal-collection";
      collection: CollectionName;
      operation: "remove-observed";
      key: string;
    }>
  | Readonly<{
      kind: "causal-collection";
      collection: CollectionName;
      operation: "restore";
      entryId: FactActionId;
    }>
  | Readonly<{
      kind: "causal-collection";
      collection: CollectionName;
      operation: "register";
      entryId: FactActionId;
      register: string;
      value: unknown;
    }>;

export type SemanticContribution =
  | IdentityContribution
  | CollectionContribution
  | Readonly<{
      kind: "node-declaration";
      nodeId: string;
      ownerNodeId?: string;
      intrinsicNodeType?: IntrinsicNodeType;
    }>
  | (
      | Readonly<{
          kind: "sequence-position";
          operation: "insert" | "move";
          occurrenceId: string;
          nodeId?: string;
          parentNodeId: string;
          anchor: SequenceAnchor;
        }>
      | Readonly<{
          kind: "sequence-position";
          operation: "remove";
          occurrenceId: string;
        }>
    )
  | Readonly<{
      kind: "node-lifecycle";
      operation: "trash" | "restore" | "promote-original";
      nodeId: string;
      occurrenceId?: string;
      parentNodeId?: string;
      anchor?: SequenceAnchor;
    }>
  | (
      | Readonly<{
          kind: "text-operation";
          operation: "splice";
          nodeId: string;
          referencedActionIds: readonly FactActionId[];
          anchor: SequenceAnchor;
        }>
      | Readonly<{
          kind: "text-operation";
          operation: "mark";
          nodeId: string;
          referencedActionIds: readonly FactActionId[];
        }>
    )
  | Readonly<{
      kind: "field-materialization";
      ownerNodeId: string;
      fieldDefinitionId: string;
    }>
  | Readonly<{ kind: "causal-register-write"; registerKey: string }>
  | Readonly<{ kind: "generated-occurrence"; occurrenceId: string }>
  | Readonly<{ kind: "terminal-cutoff"; nodeId: string }>;
