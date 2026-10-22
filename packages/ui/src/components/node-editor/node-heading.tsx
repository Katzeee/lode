import { useRef } from "react";
import { flushSync } from "react-dom";
import { useNodeEditSession } from "./node-edit-session.js";
import { nodeEditorBinding } from "./node-editor-binding.js";
import { NodeEditor } from "./node-editor.js";
import { nodeTextPointerSelection } from "./node-text-pointer.js";
import { outlineCommandDispatcher, outlineCommandForKey, type OutlineHostCommand } from "./outline-commands.js";
import { OutlineInlineEditorProvider, OutlineInlineContent } from "./outline-tree-editor.js";
import { OutlineInlineExtensionsProvider } from "./outline-source-content.js";
import type { OutlineInlineExtension } from "./outline-inline-extension.js";
import type { NodeEditing, NodeEditTarget } from "./node-editing.js";

type Properties = Readonly<{
  target: NodeEditTarget;
  editing: NodeEditing;
  inlineExtensions?: readonly OutlineInlineExtension[];
  commands?: readonly OutlineHostCommand[];
  onEnter(): void;
  onEmptyBody(): void;
}>;

export function NodeHeading(props: Properties) {
  return (
    <NodeEditor>
      <HeadingRegion {...props} />
    </NodeEditor>
  );
}

function HeadingRegion({ target, editing, inlineExtensions = [], commands = [], onEnter, onEmptyBody }: Properties) {
  const containerRef = useRef<HTMLDivElement>(null);
  const session = useNodeEditSession({
    containerRef,
    targets: [target],
    editing,
    onCursorChange: () => {},
    onTextInput: () => {},
    scrollToKey: () => {},
  });
  const dispatcher = outlineCommandDispatcher({
    commands,
    targets: [target],
    selectedKeys: [],
    cursorKey: target.key,
    getPosition: session.getPosition,
    checkpoint: (position) => editing.history?.checkpoint(position, "operation"),
    restore: (position) => session.setPending({ type: "position", position }),
  });
  const binding = nodeEditorBinding(session, {
    editing,
    canExecuteCommand: (id) => dispatcher.canExecute(id),
    onExecuteCommand: (id, content) => dispatcher.execute(id, "completion", undefined, content),
    onCursorChange: () => {},
    onTextInput: () => {},
    focusContainer: () => containerRef.current?.focus({ preventScroll: true }),
    onKeyDown: (event, context) => {
      if (event.key === "Escape") {
        session.commitAndExit();
        containerRef.current?.focus({ preventScroll: true });
        return true;
      }
      const command = outlineCommandForKey(commands, event);
      if (command && dispatcher.execute(command.id, "keyboard", undefined, context.content) !== false) {
        return true;
      }
      return false;
    },
    onCommand: (command) => {
      if (command.type === "history") {
        return session.history(command.direction);
      }
      if (command.type === "enter") {
        session.commitAndExit();
        onEnter();
        return true;
      }
      if (command.type === "navigate" && command.direction === 1) {
        session.commitAndExit();
        if (!session.navigateOutside(1)) {
          onEmptyBody();
        }
        return true;
      }
      return command.type === "backspace" || command.type === "delete-forward" || command.type === "structure";
    },
  });
  return (
    <div
      ref={containerRef}
      tabIndex={0}
      data-ui="outline-title"
      data-item-key={target.key}
      className="min-w-0 outline-none"
      style={{ cursor: target.editable === false ? "default" : "text" }}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          session.claimFocus();
        }
      }}
      onMouseDown={(event) => {
        if (
          event.button !== 0 ||
          !(event.target instanceof Element) ||
          event.target.closest('button, a, input, select, textarea, [role="checkbox"]')
        ) {
          return;
        }
        if (event.target.closest('[data-ui="outline-editor"]') && event.detail < 2) {
          return;
        }
        if (target.editable === false) {
          event.preventDefault();
          session.activatePosition({ key: target.key, caret: 0, editing: false });
          return;
        }
        event.preventDefault();
        const selection = nodeTextPointerSelection(event.currentTarget, target.content, event);
        flushSync(() => session.activate(target, target.content, selection.from, selection.to));
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          session.commitAndExit();
          containerRef.current?.focus({ preventScroll: true });
        } else if (event.target === event.currentTarget && event.key === "Enter") {
          event.preventDefault();
          session.activatePosition({ key: target.key, caret: 0, editing: true });
        } else if (
          event.target === event.currentTarget &&
          event.key === "ArrowDown" &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          if (!session.navigateOutside(1)) {
            onEmptyBody();
          }
        }
      }}
    >
      <OutlineInlineExtensionsProvider value={inlineExtensions}>
        <OutlineInlineEditorProvider binding={binding} placeholder="Untitled">
          <OutlineInlineContent content={target.content} />
        </OutlineInlineEditorProvider>
      </OutlineInlineExtensionsProvider>
    </div>
  );
}
