import { create } from "@bufbuild/protobuf";
import {
  SchemaChangeResultSchema,
  type ApplySchemaRequest,
  type CreateSchemaRequest,
  type NodeOccurrenceRef,
  type ReconcileSchemaRequest,
  type RemoveSchemaRequest,
  type SchemaChangeResult,
} from "@lode/protocol/proto";
import {
  applySchema,
  createSchema,
  reconcileSchema,
  removeSchema,
} from "../domain/schema/schema.js";
import type { SchemaChangeResult as DomainSchemaChangeResult } from "../domain/model/schema.js";
import { authed } from "../handler.js";
import type { AppContext } from "./wire/context.js";
import { changeToProto, identityToProto, nodeRefToProto } from "./wire/mappers.js";
import { runMutation } from "./wire/mutation.js";

export function createSchemaHandlers(ctx: AppContext) {
  const toResult = (result: DomainSchemaChangeResult): SchemaChangeResult =>
    create(SchemaChangeResultSchema, {
      target: identityToProto(result.target),
      ...(result.schema === undefined ? {} : { schema: nodeRefToProto(result.schema.nodeId) }),
      changes: result.changes.map(changeToProto),
    });

  return {
    createSchema: authed(async (req: CreateSchemaRequest, caller): Promise<NodeOccurrenceRef> => {
      const identity = await runMutation(ctx, caller, req.workspaceId, (doc) =>
        createSchema(doc, req.name, req.parentOccurrenceId),
      );
      return identityToProto(identity);
    }),

    applySchema: authed(async (req: ApplySchemaRequest, caller): Promise<SchemaChangeResult> => {
      return toResult(
        await runMutation(ctx, caller, req.workspaceId, (doc) =>
          applySchema(doc, req.targetOccurrenceId, req.schemaNodeId),
        ),
      );
    }),

    removeSchema: authed(async (req: RemoveSchemaRequest, caller): Promise<SchemaChangeResult> => {
      return toResult(
        await runMutation(ctx, caller, req.workspaceId, (doc) =>
          removeSchema(doc, req.targetOccurrenceId, req.schemaNodeId),
        ),
      );
    }),

    reconcileSchema: authed(
      async (req: ReconcileSchemaRequest, caller): Promise<SchemaChangeResult> => {
        return toResult(
          await runMutation(ctx, caller, req.workspaceId, (doc) =>
            reconcileSchema(doc, req.targetOccurrenceId),
          ),
        );
      },
    ),
  };
}
