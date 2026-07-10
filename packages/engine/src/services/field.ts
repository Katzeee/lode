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
import { addField, removeField, setFieldValues } from "../domain/field/field.js";
import { authed } from "../handler.js";
import type { AppContext } from "./wire/context.js";
import { EMPTY } from "./wire/empty.js";
import {
  changeToProto,
  fieldModeFromProto,
  fieldValueInputFromProto,
  identityToProto,
} from "./wire/mappers.js";
import { runMutation } from "./wire/mutation.js";

export function createFieldHandlers(ctx: AppContext) {
  return {
    addField: authed(async (req: AddFieldRequest, caller): Promise<AddFieldResult> => {
      const result = await runMutation(ctx, caller, req.workspaceId, (doc) =>
        addField(doc, req.targetOccurrenceId, req.fieldDefNodeId, fieldModeFromProto(req.mode)),
      );
      return create(AddFieldResultSchema, {
        nodeId: result.nodeId,
        occurrenceId: result.occurrenceId,
        created: result.created,
      });
    }),

    setFieldValues: authed(
      async (req: SetFieldValuesRequest, caller): Promise<SetFieldValuesResult> => {
        const result = await runMutation(ctx, caller, req.workspaceId, (doc) =>
          setFieldValues(doc, req.fieldOccurrenceId, req.values.map(fieldValueInputFromProto)),
        );
        return create(SetFieldValuesResultSchema, {
          field: identityToProto(result.field),
          changes: result.changes.map(changeToProto),
        });
      },
    ),

    removeField: authed(async (req: RemoveFieldRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (doc) =>
        removeField(doc, req.fieldOccurrenceId),
      );
      return EMPTY;
    }),
  };
}
