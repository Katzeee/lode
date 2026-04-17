import type { CommandDef } from "../plugins/index.js";

export const toggleMark: CommandDef = {
  execute(ctx, args) {
    const a = args as { key: string; value?: unknown };
    ctx.engine.toggleMark(a.key, a.value ?? true);
  },
  can(ctx) {
    if (ctx.engine.readonly) return false;
    return ctx.engine.getSelection() != null;
  },
};

export const setMark: CommandDef = {
  execute(ctx, args) {
    const a = args as { key: string; value: unknown };
    ctx.engine.setMark(a.key, a.value);
  },
  can(ctx) {
    if (ctx.engine.readonly) return false;
    return ctx.engine.getSelection() != null;
  },
};

export const unsetMark: CommandDef = {
  execute(ctx, args) {
    const a = args as { key: string };
    ctx.engine.unsetMark(a.key);
  },
  can(ctx) {
    if (ctx.engine.readonly) return false;
    return ctx.engine.getSelection() != null;
  },
};

export const setBlockType: CommandDef = {
  execute(ctx, args) {
    const a = args as { type: string; blockId?: string };
    const id = a.blockId ?? selectionAnchor(ctx);
    if (id == null) return;
    // Merge defaultProps from registered spec if present
    const spec = ctx.engine.getSpec?.(a.type);
    ctx.engine.batch(() => {
      ctx.engine.setBlockType(id, a.type);
      if (spec?.defaultProps) {
        const props = spec.defaultProps();
        for (const [k, v] of Object.entries(props)) {
          ctx.engine.setProp(id, k, v);
        }
      }
    });
  },
  can(ctx) {
    return !ctx.engine.readonly;
  },
};

function selectionAnchor(ctx: { engine: { getSelection(): import("../types.js").Selection } }): string | undefined {
  const sel = ctx.engine.getSelection();
  if (!sel) return undefined;
  if (sel.type === "text") return sel.anchor.blockId;
  return sel.blockIds[0];
}
