import type { OutlineSelection } from "./outline-selection.js";
import { canMoveOutline } from "./outline-capabilities.js";
import { resolveOutlineMove } from "./outline-tree-view-model.js";
import type {
  OutlineEditPosition,
  OutlineMove,
  OutlineMoveResult,
  OutlineRowViewModel,
} from "./outline-tree-view-model.js";
type Options = Readonly<{
  rows: readonly OutlineRowViewModel[];
  onMove?: (move: OutlineMove) => OutlineMoveResult | null | Promise<OutlineMoveResult | null>;
  expand(key: string, expanded: boolean): void;
  state(): Readonly<{ selection: OutlineSelection; expandedKeys: ReadonlySet<string>; cursorKey: string | null }>;
  select(selection: OutlineSelection): void;
  setCursor(key: string | null): void;
  remap(mapping: ReadonlyMap<string, string>): void;
  position(): OutlineEditPosition | null;
  restore(position: OutlineEditPosition): void;
}>;
export function outlineMovement(options: Options): (move: OutlineMove) => OutlineMoveResult | null {
  const finish = (result: OutlineMoveResult | null) => {
    if (result === null) {
      return null;
    }
    const remap = (key: string | null) => (key === null ? null : (result.keyMap.get(key) ?? key));
    const current = options.state();
    for (const key of result.revealKeys ?? []) {
      options.expand(key, true);
    }
    for (const key of current.expandedKeys) {
      const destination = result.keyMap.get(key);
      if (destination && destination !== key) {
        options.expand(key, false);
        options.expand(destination, true);
      }
    }
    options.remap(result.keyMap);
    options.setCursor(remap(current.cursorKey));
    options.select({
      anchorKey: remap(current.selection.anchorKey),
      focusKey: remap(current.selection.focusKey),
      keys: new Set([...current.selection.keys].map((key) => result.keyMap.get(key) ?? key)),
    });
    return result;
  };
  return (move) => {
    const destination = resolveOutlineMove(options.rows, move);
    const movable =
      move.sourceKeys.length > 0 &&
      move.sourceKeys.every((key) =>
        options.rows.some((row) => row.key === key && row.item.capabilities?.move !== false),
      );
    if (
      !options.onMove ||
      !movable ||
      (move.kind === "absolute" && (!destination || !canMoveOutline(options.rows, destination)))
    ) {
      return null;
    }
    if (destination?.targetParentKey != null) {
      options.expand(destination.targetParentKey, true);
    }
    const result = options.onMove(move);
    if (result !== null && "then" in result) {
      void result.then(
        (resolved) => {
          const position = options.position();
          finish(resolved);
          if (resolved && position && resolved.keyMap.has(position.key)) {
            options.restore({
              ...position,
              key: resolved.keyMap.get(position.key) ?? position.key,
              preserveSelection: true,
            });
          }
        },
        () => {
          const position = options.position();
          if (position) {
            options.restore({ ...position, preserveSelection: true });
          }
        },
      );
      return null;
    }
    return finish(result);
  };
}
