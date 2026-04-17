import type { CommandDef } from "../plugins/index.js";
import type { BlockId } from "../types.js";

function resolveBlockId(ctx: { engine: { getSelection(): unknown } }, args: unknown): BlockId | undefined {
  if (args && typeof args === "object" && "blockId" in args) {
    const v = (args as { blockId?: BlockId }).blockId;
    if (v != null) return v;
  }
  const sel = (ctx.engine as { getSelection(): import("../types.js").Selection }).getSelection();
  if (sel && sel.type === "text") return sel.anchor.blockId;
  if (sel && sel.type === "block" && sel.blockIds.length > 0) return sel.blockIds[0];
  return undefined;
}

export const indent: CommandDef = {
  execute(ctx, args) {
    const id = resolveBlockId(ctx, args);
    if (id != null) ctx.engine.indent(id);
  },
  can(ctx, args) {
    if (ctx.engine.readonly) return false;
    const id = resolveBlockId(ctx, args);
    if (id == null) return false;
    const view = ctx.engine.getBlock(id);
    if (!view) return false;
    const siblings = view.parentId != null
      ? ctx.engine.getBlock(view.parentId)?.childIds ?? []
      : ctx.engine.getRootIds();
    const idx = siblings.indexOf(id);
    return idx > 0;
  },
};

export const outdent: CommandDef = {
  execute(ctx, args) {
    const id = resolveBlockId(ctx, args);
    if (id != null) ctx.engine.outdent(id);
  },
  can(ctx, args) {
    if (ctx.engine.readonly) return false;
    const id = resolveBlockId(ctx, args);
    if (id == null) return false;
    const view = ctx.engine.getBlock(id);
    return !!view && view.parentId != null;
  },
};

export const moveUp: CommandDef = {
  execute(ctx, args) {
    const id = resolveBlockId(ctx, args);
    if (id != null) ctx.engine.moveUp(id);
  },
  can(ctx, args) {
    if (ctx.engine.readonly) return false;
    const id = resolveBlockId(ctx, args);
    if (id == null) return false;
    const view = ctx.engine.getBlock(id);
    if (!view) return false;
    const siblings = view.parentId != null
      ? ctx.engine.getBlock(view.parentId)?.childIds ?? []
      : ctx.engine.getRootIds();
    return siblings.indexOf(id) > 0;
  },
};

export const moveDown: CommandDef = {
  execute(ctx, args) {
    const id = resolveBlockId(ctx, args);
    if (id != null) ctx.engine.moveDown(id);
  },
  can(ctx, args) {
    if (ctx.engine.readonly) return false;
    const id = resolveBlockId(ctx, args);
    if (id == null) return false;
    const view = ctx.engine.getBlock(id);
    if (!view) return false;
    const siblings = view.parentId != null
      ? ctx.engine.getBlock(view.parentId)?.childIds ?? []
      : ctx.engine.getRootIds();
    const idx = siblings.indexOf(id);
    return idx >= 0 && idx < siblings.length - 1;
  },
};

export const toggleCollapsed: CommandDef = {
  execute(ctx, args) {
    const id = resolveBlockId(ctx, args);
    if (id != null) ctx.engine.toggleCollapsed(id);
  },
  can(ctx, args) {
    if (ctx.engine.readonly) return false;
    const id = resolveBlockId(ctx, args);
    if (id == null) return false;
    const view = ctx.engine.getBlock(id);
    return !!view && view.hasChildren;
  },
};
