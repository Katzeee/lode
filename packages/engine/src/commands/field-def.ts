import { type Empty } from "@bufbuild/protobuf/wkt";
import type {
  CreateFieldDefRequest,
  NodeOccurrenceRef,
  SetFieldDefPresenceRequest,
  SetFieldDefTypeRequest,
} from "@lode/protocol/proto";
import { createFieldDef, setFieldDefPresence, setFieldDefType } from "../domain/field/field.js";
import { authed } from "./handler.js";
import type { CommandDeps } from "./wire/context.js";
import { EMPTY } from "./wire/empty.js";
import { fieldPresenceFromProto, fieldTypeFromProto, identityToProto } from "./wire/mappers.js";
import { runMutation } from "./wire/mutation.js";

export function createFieldDefHandlers(ctx: CommandDeps) {
  return {
    createFieldDef: authed(
      async (req: CreateFieldDefRequest, caller): Promise<NodeOccurrenceRef> => {
        const identity = await runMutation(ctx, caller, req.workspaceId, (engine) =>
          createFieldDef(
            engine,
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
      await runMutation(ctx, caller, req.workspaceId, (engine) =>
        setFieldDefType(engine, req.fieldDefNodeId, fieldTypeFromProto(req.fieldType) ?? "plain"),
      );
      return EMPTY;
    }),

    setFieldDefPresence: authed(async (req: SetFieldDefPresenceRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (engine) =>
        setFieldDefPresence(
          engine,
          req.fieldDefNodeId,
          fieldPresenceFromProto(req.presence) ?? "normal",
        ),
      );
      return EMPTY;
    }),
  };
}
