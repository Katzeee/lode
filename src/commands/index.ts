import type { BlockEngine } from "../engine.js";
import { indent, moveDown, moveUp, outdent, toggleCollapsed } from "./tree.js";
import { deleteSelection, mergeBlockWithPrev, splitBlock } from "./text.js";
import { setBlockType, setMark, toggleMark, unsetMark } from "./marks.js";
import { redo, undo } from "./history.js";

export function registerBuiltins(engine: BlockEngine): void {
  engine.registerCommand("indent", indent);
  engine.registerCommand("outdent", outdent);
  engine.registerCommand("moveUp", moveUp);
  engine.registerCommand("moveDown", moveDown);
  engine.registerCommand("toggleCollapsed", toggleCollapsed);

  engine.registerCommand("splitBlock", splitBlock);
  engine.registerCommand("mergeBlockWithPrev", mergeBlockWithPrev);
  engine.registerCommand("deleteSelection", deleteSelection);

  engine.registerCommand("toggleMark", toggleMark);
  engine.registerCommand("setMark", setMark);
  engine.registerCommand("unsetMark", unsetMark);
  engine.registerCommand("setBlockType", setBlockType);

  engine.registerCommand("undo", undo);
  engine.registerCommand("redo", redo);
}
