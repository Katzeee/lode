import {
  EditActionSchema,
  EngineCommandSchema,
  EngineQuerySchema,
  type ConflictIssue as ProtocolConflictIssue,
  type DecisionEffect as ProtocolDecisionEffect,
  type EditAction as ProtocolEditAction,
  type EngineCommand as ProtocolEngineCommand,
  type EngineQuery as ProtocolEngineQuery,
  type QueryResult as ProtocolQueryResult,
  type WriteResult as ProtocolWriteResult,
} from "@lode/protocol/proto";
import type { EditAction } from "./edit.js";
import type { EngineCommand, EngineQuery, WriteResult } from "./contract.js";
import type { ConflictIssue, DecisionEffect } from "./review.js";

type OneofCase<Group extends Readonly<{ case?: unknown }>> = Exclude<Group["case"], undefined>;

export type ProtocolCommandCase = OneofCase<ProtocolEngineCommand["command"]>;
export type ProtocolQueryCase = OneofCase<ProtocolEngineQuery["query"]>;
export type ProtocolActionCase = OneofCase<ProtocolEditAction["action"]>;
export type ProtocolWriteResultCase = OneofCase<ProtocolWriteResult["result"]>;
type RawProtocolQueryResultCase = OneofCase<ProtocolQueryResult["result"]>;
export type ProtocolDecisionEffectCase = OneofCase<ProtocolDecisionEffect["effect"]>;
export type ProtocolConflictIssueCase = OneofCase<ProtocolConflictIssue["issue"]>;

// A protocol oneof case is exactly the camelCase form of its domain kind: the wire generator
// derives proto field names from the registry kinds, so the correspondence is total by
// construction. The conversions below are therefore mechanical; the assertions pin the two
// vocabularies to each other at compile time, in both directions.
type CamelCase<Kind extends string> = Kind extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : Kind;
type SameMembers<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
type Assert<Coverage extends true> = Coverage;

type CommandCasesMatch = Assert<SameMembers<CamelCase<EngineCommand["kind"]>, ProtocolCommandCase>>;
type QueryCasesMatch = Assert<SameMembers<CamelCase<EngineQuery["kind"]>, ProtocolQueryCase>>;
type ActionCasesMatch = Assert<SameMembers<CamelCase<EditAction["kind"]>, ProtocolActionCase>>;
type WriteResultCasesMatch = Assert<SameMembers<CamelCase<WriteResult["status"]>, ProtocolWriteResultCase>>;
type DecisionEffectCasesMatch = Assert<SameMembers<CamelCase<DecisionEffect["kind"]>, ProtocolDecisionEffectCase>>;
type ConflictIssueCasesMatch = Assert<SameMembers<CamelCase<ConflictIssue["kind"]>, ProtocolConflictIssueCase>>;
type QueryResultCoversQueries = Assert<SameMembers<ProtocolQueryCase, Exclude<RawProtocolQueryResultCase, "rejected">>>;
declare const _caseCoverage: [
  CommandCasesMatch,
  QueryCasesMatch,
  ActionCasesMatch,
  WriteResultCasesMatch,
  DecisionEffectCasesMatch,
  ConflictIssueCasesMatch,
  QueryResultCoversQueries,
];

function camelCase(kind: string): string {
  return kind.replaceAll(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function kebabCase(protocolCase: string): string {
  return protocolCase.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function oneofKinds(
  schema: Readonly<{ oneofs: readonly Readonly<{ fields: readonly Readonly<{ localName: string }>[] }>[] }>,
): readonly string[] {
  const [group] = schema.oneofs;
  if (group === undefined) {
    throw new Error("Protocol schema has no oneof to enumerate");
  }
  return group.fields.map((field) => kebabCase(field.localName));
}

export const COMMAND_KINDS = oneofKinds(EngineCommandSchema) as readonly EngineCommand["kind"][];
export const QUERY_KINDS = oneofKinds(EngineQuerySchema) as readonly EngineQuery["kind"][];
export const ACTION_KINDS = oneofKinds(EditActionSchema) as readonly EditAction["kind"][];

export function protocolCommandCase(kind: EngineCommand["kind"]): ProtocolCommandCase {
  return camelCase(kind) as ProtocolCommandCase;
}

export function commandKind(protocolCase: ProtocolCommandCase): EngineCommand["kind"] {
  return kebabCase(protocolCase) as EngineCommand["kind"];
}

export function protocolQueryCase(kind: EngineQuery["kind"]): ProtocolQueryCase {
  return camelCase(kind) as ProtocolQueryCase;
}

export function queryKind(protocolCase: ProtocolQueryCase): EngineQuery["kind"] {
  return kebabCase(protocolCase) as EngineQuery["kind"];
}

export function protocolActionCase(kind: EditAction["kind"]): ProtocolActionCase {
  return camelCase(kind) as ProtocolActionCase;
}

export function actionKind(protocolCase: ProtocolActionCase): EditAction["kind"] {
  return kebabCase(protocolCase) as EditAction["kind"];
}

export function protocolWriteResultCase(status: WriteResult["status"]): ProtocolWriteResultCase {
  return camelCase(status) as ProtocolWriteResultCase;
}

export function writeResultStatus(protocolCase: ProtocolWriteResultCase): WriteResult["status"] {
  return kebabCase(protocolCase) as WriteResult["status"];
}

export function protocolDecisionEffectCase(kind: DecisionEffect["kind"]): ProtocolDecisionEffectCase {
  return camelCase(kind) as ProtocolDecisionEffectCase;
}

export function decisionEffectKind(protocolCase: ProtocolDecisionEffectCase): DecisionEffect["kind"] {
  return kebabCase(protocolCase) as DecisionEffect["kind"];
}

export function protocolConflictIssueCase(kind: ConflictIssue["kind"]): ProtocolConflictIssueCase {
  return camelCase(kind) as ProtocolConflictIssueCase;
}

export function conflictIssueKind(protocolCase: ProtocolConflictIssueCase): ConflictIssue["kind"] {
  return kebabCase(protocolCase) as ConflictIssue["kind"];
}
