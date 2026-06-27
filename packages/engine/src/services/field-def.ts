import { type Empty } from "@bufbuild/protobuf/wkt";
import type {
  CreateFieldDefRequest,
  NodeOccurrenceRef,
  SetFieldDefPresenceRequest,
  SetFieldDefTypeRequest,
} from "@lode/protocol/proto";
import { createFieldDef, setFieldDefPresence, setFieldDefType } from "../domain/field.js";
import type { AppContext } from "./context.js";
import { EMPTY } from "./empty.js";
import { fieldPresenceFromProto, fieldTypeFromProto, identityToProto } from "./mappers.js";
import { runMutation } from "./mutation.js";

export function createFieldDefHandlers(ctx: AppContext) {
  return {
    createFieldDef: async (
      req: CreateFieldDefRequest,
      connectionId: string,
    ): Promise<NodeOccurrenceRef> => {
      const identity = await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
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

    setFieldDefType: async (req: SetFieldDefTypeRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        setFieldDefType(doc, req.fieldDefNodeId, fieldTypeFromProto(req.fieldType) ?? "plain"),
      );
      return EMPTY;
    },

    setFieldDefPresence: async (
      req: SetFieldDefPresenceRequest,
      connectionId: string,
    ): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        setFieldDefPresence(
          doc,
          req.fieldDefNodeId,
          fieldPresenceFromProto(req.presence) ?? "normal",
        ),
      );
      return EMPTY;
    },
  };
}
