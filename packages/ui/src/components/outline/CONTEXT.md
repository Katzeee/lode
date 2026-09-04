# Outline Component

The Outline component presents and edits a tree-shaped ViewModel without depending on the host's Model. Its boundary preserves outline interaction semantics while allowing each host to supply domain-specific presentation and actions.

## Language

**Outline Editor**:
The component that owns tree navigation, selection, disclosure, inline text editing, structural movement, drag arbitration, focus, and accessibility for a supplied Outline Item ViewModel. It never interprets a host Model or assigns domain meaning to a row.
_Avoid_: Node Editor, domain editor, recursive renderer

**Outline Presenter**:
The host-owned adapter that maps semantic state into Outline Item ViewModels and retains any mapping needed to translate their opaque keys back to host targets. It decides which presentation and capabilities each presented item receives.
_Avoid_: Outline mapper, component projector, renderer

**Outline Item ViewModel**:
One presented appearance consumed by the Outline Editor, identified by an opaque key and containing editable content, child appearances, component capabilities, and a host-owned Presentation Spec. It contains no host Model object or persistent domain identity.
_Avoid_: Node, Outline Node, row Model

**Presentation Spec**:
Host-owned, typed presentation data attached to an Outline Item ViewModel. The Outline Editor treats it as opaque and passes it to the injected Outline Presentation Registry.
_Avoid_: Node Type, bullet type, component schema

**Outline Presentation Registry**:
The injected resolver that turns a Presentation Spec and current row state into standard presentation slots and Presentation Actions. It is composed per host rather than stored as mutable global state, and its registered meanings remain invisible to the Outline Editor.
_Avoid_: Node Type registry, global plugin registry, domain schema

**Presentation Slot**:
A constrained visual position exposed by the Outline Editor, such as bullet, leading content, suffix, trailing content, or details. A slot supplies presentation without taking ownership of tree structure, focus, selection, editing, or drag mechanics.
_Avoid_: arbitrary row renderer, DOM override

**Presentation Action**:
A host-defined, typed action associated with a Presentation Slot. The Outline Editor emits it only after resolving component mechanics such as click-versus-drag arbitration; the host translates it into navigation, configuration, or a domain command.
_Avoid_: DOM event handler, Engine command, component callback family

**Outline UI Intent**:
An interaction result emitted by the Outline Editor using opaque item keys. Structural and editing intents belong to the editor contract, while Presentation Actions carry host-specific meaning; neither is a domain command.
_Avoid_: mutation, Authored Action, Engine action

**Outline Core Interaction**:
Behavior whose consistency defines the Outline Editor, including disclosure, selection, keyboard navigation, caret and IME handling, text editing, indentation, reordering, drag-and-drop, focus, and tree accessibility. A host configures capabilities and handles emitted intents but does not replace these mechanics through presentation registration.
_Avoid_: domain behavior, presentation action
