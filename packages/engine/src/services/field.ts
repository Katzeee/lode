import { create } from "@bufbuild/protobuf";
import { type Empty } from "@bufbuild/protobuf/wkt";
import {
  AddFieldResultSchema,
  SetFieldValuesResultSchema,
  type AddFieldRequest,
  type AddFieldResult,
  type RemoveFieldRequest,
  type SetFieldValuesRequest,
  type SetFieldValuesResult,
} from "@lode/protocol/proto";
import { addField, removeField, setFieldValues } from "../domain/field.js";
import type { AppContext } from "./context.js";
import { EMPTY } from "./empty.js";
import {
  changeToProto,
  fieldModeFromProto,
  fieldValueInputFromProto,
  identityToProto,
} from "./mappers.js";
import { runMutation } from "./mutation.js";

export function createFieldHandlers(ctx: AppContext) {
  return {
    addField: async (req: AddFieldRequest, connectionId: string): Promise<AddFieldResult> => {
      const result = await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        addField(doc, req.targetOccurrenceId, req.fieldDefNodeId, fieldModeFromProto(req.mode)),
      );
      return create(AddFieldResultSchema, {
        nodeId: result.nodeId,
        occurrenceId: result.occurrenceId,
        created: result.created,
      });
    },

    setFieldValues: async (
      req: SetFieldValuesRequest,
      connectionId: string,
    ): Promise<SetFieldValuesResult> => {
      const result = await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        setFieldValues(doc, req.fieldOccurrenceId, req.values.map(fieldValueInputFromProto)),
      );
      return create(SetFieldValuesResultSchema, {
        field: identityToProto(result.field),
        changes: result.changes.map(changeToProto),
      });
    },

    removeField: async (req: RemoveFieldRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        removeField(doc, req.fieldOccurrenceId),
      );
      return EMPTY;
    },
  };
}
