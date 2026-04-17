import type { CommandDef } from "../plugins/index.js";

export const undo: CommandDef = {
  execute(ctx) {
    ctx.engine.undo();
  },
  can(ctx) {
    return ctx.engine.canUndo();
  },
};

export const redo: CommandDef = {
  execute(ctx) {
    ctx.engine.redo();
  },
  can(ctx) {
    return ctx.engine.canRedo();
  },
};
