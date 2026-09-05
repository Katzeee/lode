import type { OutlineSelection } from "./outline-selection.js";
import type { OutlineEditPosition, OutlineMove, OutlineMoveResult } from "./outline-tree-view-model.js";
type Options = Readonly<{
  onMove?: (move: OutlineMove) => OutlineMoveResult | null | Promise<OutlineMoveResult | null>;
  expand(key: string, expanded: boolean): void;
  selection: OutlineSelection;
  cursorKey: string | null;
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
    options.remap(result.keyMap);
    options.setCursor(remap(options.cursorKey));
    options.select({
      anchorKey: remap(options.selection.anchorKey),
      focusKey: remap(options.selection.focusKey),
      keys: new Set([...options.selection.keys].map((key) => result.keyMap.get(key) ?? key)),
    });
    return result;
  };
  return (move) => {
    if (!options.onMove) {
      return null;
    }
    if (move.targetParentKey !== null) {
      options.expand(move.targetParentKey, true);
    }
    const result = options.onMove(move);
    if (result !== null && "then" in result) {
      const position = options.position();
      void result.then(
        (resolved) => {
          finish(resolved);
          if (resolved && position) {
            options.restore({ ...position, key: resolved.keyMap.get(position.key) ?? position.key });
          }
        },
        () => {
          if (position) {
            options.restore(position);
          }
        },
      );
      return null;
    }
    return finish(result);
  };
}
