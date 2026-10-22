import type { useNodeEditSession } from "./node-edit-session.js";
import type { NodeEditing } from "./node-editing.js";
import type { OutlineContent } from "./outline-content.js";
import type { OutlineEditPosition } from "./outline-tree-view-model.js";
import type {
  OutlineEditorBinding,
  OutlineEditorCommand,
  OutlineTextKeyContext,
} from "./outline-tree-edit-contract.js";
import { bindOutlineCompletionProviders } from "./outline-editor-picker.js";

export function nodeEditorBinding(
  state: ReturnType<typeof useNodeEditSession>,
  {
    editing,
    canExecuteCommand,
    onKeyDown,
    onCommand,
    onExecuteCommand,
    onTextInput,
    onCursorChange,
    focusContainer,
  }: Readonly<{
    editing?: NodeEditing;
    canExecuteCommand(id: string): boolean;
    onKeyDown(event: KeyboardEvent, context: OutlineTextKeyContext): boolean;
    onCommand(command: OutlineEditorCommand): boolean;
    onExecuteCommand(id: string, content: OutlineContent): boolean | OutlineEditPosition;
    onTextInput(): void;
    onCursorChange(key: string): void;
    focusContainer(): void;
  }>,
): OutlineEditorBinding | null {
  const {
    session,
    sessionRef,
    editingRef,
    lastPositionRef,
    desiredCaretRef,
    desiredSelectionEndRef,
    setPending,
    setSession,
  } = state;
  const binding: OutlineEditorBinding | null =
    session === null || editing === undefined
      ? null
      : {
          canExecuteCommand,
          ariaLabel: session.ariaLabel,
          completionProviders: bindOutlineCompletionProviders(editing.completionProviders ?? [], session?.key),
          content: session.content,
          revision: session.revision,
          initialCaret: desiredCaretRef.current,
          initialSelectionEnd: desiredSelectionEndRef.current,
          onInteraction: state.recordInteraction,
          onBlur: (content, position) => {
            if (sessionRef.current?.key === session.key && sessionRef.current.revision === session.revision) {
              state.recordInteraction();
              lastPositionRef.current = { key: session.key, caret: position.from, selectionEnd: position.to };
              state.commit(session.key, content, "blur");
              setPending(null);
              setSession(null);
            }
          },
          onChange: (content, before, group) => {
            const current = sessionRef.current;
            if (current?.key === session.key) {
              state.recordInteraction();
              editingRef.current?.history?.checkpoint(
                { key: session.key, caret: before.from, selectionEnd: before.to },
                group,
              );
              sessionRef.current = { ...current, content, submitted: false };
              onCursorChange(session.key);
              onTextInput();
              editingRef.current?.onContentChange(session.key, content);
            }
          },
          onSelectionChange: (position) => {
            state.recordInteraction();
            lastPositionRef.current = { key: session.key, caret: position.from, selectionEnd: position.to };
          },
          onKeyDown,
          onCommand,
          onCompletion: (providerId, itemId, content, commandId) => {
            const current = sessionRef.current;
            if (current?.key !== session.key) {
              return;
            }
            sessionRef.current = { ...current, content, submitted: false };
            const provider = editing.completionProviders?.find((candidate) => candidate.id === providerId);
            if (commandId !== undefined) {
              const result = onExecuteCommand(commandId, content);
              if (result !== true) {
                return;
              }
            } else {
              editing.history?.checkpoint(lastPositionRef.current, "operation");
              const position =
                editing.onCompletion === undefined
                  ? editing.onContentChange(session.key, content)
                  : editing.onCompletion(session.key, providerId, itemId, content);
              if (position !== undefined) {
                setPending({ type: "position", position });
                return;
              }
            }
            if (provider?.exitOnSelect === true) {
              setPending(null);
              setSession(null);
              focusContainer();
            }
          },
          placeholder: editing.emptyPlaceholder ?? "Start typing…",
        };

  return binding;
}
