import { type Empty } from "@bufbuild/protobuf/wkt";
import type {
  CreateFieldDefRequest,
  NodeOccurrenceRef,
  SetFieldDefPresenceRequest,
  SetFieldDefTypeRequest,
} from "@lode/protocol/proto";
import { createFieldDef, setFieldDefPresence, setFieldDefType } from "../domain/field/field.js";
import { authed } from "../handler.js";
import type { AppContext } from "./wire/context.js";
import { EMPTY } from "./wire/empty.js";
import { fieldPresenceFromProto, fieldTypeFromProto, identityToProto } from "./wire/mappers.js";
import { runMutation } from "./wire/mutation.js";

export function createFieldDefHandlers(ctx: AppContext) {
  return {
    createFieldDef: authed(
      async (req: CreateFieldDefRequest, caller): Promise<NodeOccurrenceRef> => {
        const identity = await runMutation(ctx, caller, req.workspaceId, (doc) =>
          createFieldDef(
            doc,
            req.parentOccurrenceId,
            req.name,
            fieldTypeFromProto(req.fieldType),
            fieldPresenceFromProto(req.presence),
          ),
        );
        return identityToProto(identity);
      },
    ),

    setFieldDefType: authed(async (req: SetFieldDefTypeRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (doc) =>
        setFieldDefType(doc, req.fieldDefNodeId, fieldTypeFromProto(req.fieldType) ?? "plain"),
      );
      return EMPTY;
    }),

    setFieldDefPresence: authed(async (req: SetFieldDefPresenceRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (doc) =>
        setFieldDefPresence(
          doc,
          req.fieldDefNodeId,
          fieldPresenceFromProto(req.presence) ?? "normal",
        ),
      );
      return EMPTY;
    }),
  };
}
