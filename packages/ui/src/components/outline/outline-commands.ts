import type { OutlineContent } from "./outline-content.js";
import type { OutlineEditPosition, OutlineRowViewModel } from "./outline-tree-view-model.js";

export type OutlineCommandContext = Readonly<{
  /** Appearance roots; the host resolves domain identities and applies one transaction. */
  keys: readonly string[];
  position: OutlineEditPosition | null;
  content: OutlineContent | null;
  source: "keyboard" | "completion" | "presentation" | "toolbar";
}>;

export type OutlineCommandKeyBinding = Readonly<{ key: string; mod?: boolean; shift?: boolean; alt?: boolean }>;

export type OutlineHostCommand = Readonly<{
  id: string;
  label: string;
  keyBindings?: readonly OutlineCommandKeyBinding[];
  inSelectionToolbar?: boolean;
  canExecute?: (context: OutlineCommandContext) => boolean;
  execute: (context: OutlineCommandContext) => OutlineEditPosition | void;
}>;

export function outlineCommandForKey(
  commands: readonly OutlineHostCommand[],
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): OutlineHostCommand | undefined {
  return commands.find((command) =>
    command.keyBindings?.some(
      (binding) =>
        binding.key.toLowerCase() === event.key.toLowerCase() &&
        (binding.mod ?? false) === (event.ctrlKey || event.metaKey) &&
        (binding.alt ?? false) === event.altKey &&
        (binding.shift ?? false) === event.shiftKey,
    ),
  );
}

export function outlineCommandDispatcher(
  options: Readonly<{
    commands: readonly OutlineHostCommand[];
    rows: readonly OutlineRowViewModel[];
    selectedKeys: readonly string[];
    cursorKey: string | null;
    getPosition: () => OutlineEditPosition | null;
    checkpoint: (position: OutlineEditPosition | null) => void;
    restore: (position: OutlineEditPosition) => void;
  }>,
) {
  const contextFor = (
    source: OutlineCommandContext["source"],
    keys?: readonly string[],
    content?: OutlineContent,
  ): OutlineCommandContext => {
    const position = options.getPosition();
    return {
      keys:
        keys ??
        (options.selectedKeys.length > 0
          ? options.selectedKeys
          : options.cursorKey === null
            ? []
            : [options.cursorKey]),
      position,
      source,
      content: content ?? options.rows.find((row) => row.key === position?.key)?.item.content ?? null,
    };
  };
  return {
    canExecute: (id: string, keys?: readonly string[], source: OutlineCommandContext["source"] = "presentation") => {
      const command = options.commands.find((candidate) => candidate.id === id);
      return command !== undefined && command.canExecute?.(contextFor(source, keys)) !== false;
    },
    execute: (
      id: string,
      source: OutlineCommandContext["source"],
      keys?: readonly string[],
      content?: OutlineContent,
    ): boolean | OutlineEditPosition => {
      const command = options.commands.find((candidate) => candidate.id === id);
      const context = contextFor(source, keys, content);
      if (command === undefined || command.canExecute?.(context) === false) {
        return false;
      }
      options.checkpoint(context.position);
      const position = command.execute(context);
      if (position !== undefined) {
        options.restore(position);
      }
      return position ?? true;
    },
  };
}
