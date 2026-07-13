---
version: alpha
name: Editorial Workspace
description: A calm, content-first design system for professional creation, knowledge, project, CRM, and AI-assisted workspaces.

colors:
  primary: "#315F49"
  primary-hover: "#244C39"
  primary-pressed: "#1C3C2D"
  primary-soft: "#EDF4EF"
  on-primary: "#FFFFFF"
  background: "#F6F7F5"
  surface: "#FFFFFF"
  surface-subtle: "#FAFBF9"
  surface-muted: "#EFF1EE"
  surface-selected: "#E7F0EA"
  on-surface: "#171A17"
  on-surface-variant: "#5F665F"
  text-muted: "#676E67"
  outline: "#E1E5E0"
  outline-strong: "#C8CEC8"
  focus-ring: "#315F49"
  success: "#3F7D55"
  success-container: "#E8F3EB"
  on-success-container: "#285238"
  warning: "#8A6116"
  warning-container: "#FFF4D6"
  on-warning-container: "#63450C"
  error: "#B4403B"
  error-hover: "#963530"
  error-container: "#FCECEA"
  on-error-container: "#7E2E2A"
  scrim: "#0F1D16A3"

dataColors:
  series-1: "#315F49"
  series-2: "#5C6F91"
  series-3: "#9A6A45"
  series-4: "#7A668F"
  series-5: "#5E7772"
  series-6: "#8B625F"

typography:
  page-title:
    fontFamily: "Inter, Noto Sans SC, system-ui, sans-serif"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 36px
    letterSpacing: -0.02em
  section-title:
    fontFamily: "Inter, Noto Sans SC, system-ui, sans-serif"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 30px
    letterSpacing: -0.01em
  card-title:
    fontFamily: "Inter, Noto Sans SC, system-ui, sans-serif"
    fontSize: 19px
    fontWeight: 600
    lineHeight: 26px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: "Inter, Noto Sans SC, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 26px
  body-md:
    fontFamily: "Inter, Noto Sans SC, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 22px
  body-sm:
    fontFamily: "Inter, Noto Sans SC, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  label-md:
    fontFamily: "Inter, Noto Sans SC, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
  label-sm:
    fontFamily: "Inter, Noto Sans SC, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
  caption:
    fontFamily: "Inter, Noto Sans SC, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
  code-sm:
    fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
  code-md:
    fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  document-title:
    fontFamily: "Source Serif 4, Noto Serif SC, Georgia, serif"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 42px
    letterSpacing: -0.015em
  document-body:
    fontFamily: "Source Serif 4, Noto Serif SC, Georgia, serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 28px

rounded:
  none: 0px
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 22px
  full: 9999px

spacing:
  2xs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  2xl: 32px
  3xl: 40px
  4xl: 48px
  global-nav-width: 48px
  local-nav-width: 256px
  inspector-width: 360px
  inspector-min-width: 320px
  inspector-max-width: 420px
  content-max-width: 1200px
  document-max-width: 760px

borders:
  default:
    color: "{colors.outline}"
    width: 1px
    style: solid
  strong:
    color: "{colors.outline-strong}"
    width: 1px
    style: solid
  focus:
    color: "{colors.focus-ring}"
    width: 2px
    style: solid
    offset: 2px
  error:
    color: "{colors.error}"
    width: 1px
    style: solid

elevation:
  level-0: none
  level-1: none
  level-2: "0 1px 2px rgba(20, 30, 24, 0.04), 0 4px 12px rgba(20, 30, 24, 0.04)"
  level-3: "0 8px 28px rgba(20, 30, 24, 0.10), 0 1px 4px rgba(20, 30, 24, 0.06)"

motion:
  duration-instant: 0ms
  duration-fast: 120ms
  duration-standard: 160ms
  duration-panel: 200ms
  duration-slow: 220ms
  easing-standard: "cubic-bezier(0.2, 0, 0, 1)"
  distance-small: 4px
  distance-medium: 8px
  reduced-motion-duration: 0ms

breakpoints:
  mobile: 0px
  tablet: 768px
  desktop: 1024px
  wide: 1440px

density:
  comfortable:
    controlHeight: 44px
    paddingBlock: 12px
    paddingInline: 20px
  standard:
    controlHeight: 40px
    paddingBlock: 10px
    paddingInline: 16px
  compact:
    controlHeight: 32px
    paddingBlock: 6px
    paddingInline: 12px
    minimumRowHeight: 28px

iconography:
  style: monochrome-linear
  strokeWidth: 1.75px
  strokeLinecap: round
  sizes:
    small: 16px
    medium: 18px
    large: 20px

zIndex:
  base: 0
  sticky: 100
  dropdown: 200
  overlay: 300
  modal: 400
  toast: 500

states:
  hover:
    transitionDuration: "{motion.duration-fast}"
    transitionEasing: "{motion.easing-standard}"
  pressed:
    translateY: 1px
    transitionDuration: "{motion.duration-fast}"
  focus-visible:
    ringColor: "{colors.focus-ring}"
    ringWidth: 2px
    ringOffset: 2px
    ringStyle: solid
  disabled:
    cursor: not-allowed
    opacity: 0.64
  loading:
    cursor: progress
  read-only:
    backgroundColor: "{colors.surface-subtle}"
  selected:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.primary-hover}"
  destructive:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-primary}"

components:
  workspace-shell:
    backgroundColor: "{colors.background}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
  global-navigation:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.on-surface-variant}"
    width: "{spacing.global-nav-width}"
  local-navigation:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.on-surface}"
    width: "{spacing.local-nav-width}"
    padding: "{spacing.md}"
  inspector-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    width: "{spacing.inspector-width}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 16px"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 16px"
  button-primary-disabled:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 16px"
  button-primary-loading:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 16px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 16px"
  button-secondary-pressed:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 16px"
  button-secondary-disabled:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 16px"
  button-quiet:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 36px
    padding: "0 12px"
  button-quiet-hover:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 36px
    padding: "0 12px"
  button-quiet-pressed:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 36px
    padding: "0 12px"
  button-destructive:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 16px"
  button-destructive-hover:
    backgroundColor: "{colors.error-hover}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 16px"
  icon-button:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.on-surface-variant}"
    rounded: "{rounded.sm}"
    size: 36px
  icon-button-hover:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    size: 36px
  icon-button-selected:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.primary-hover}"
    rounded: "{rounded.sm}"
    size: 36px
  focus-indicator:
    backgroundColor: "{colors.focus-ring}"
    rounded: "{rounded.sm}"
    size: 2px
  content-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  content-card-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  content-card-selected:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  segmented-control:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 4px
  segmented-control-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 28px
    padding: "0 12px"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 12px"
  input-field-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 12px"
  input-field-disabled:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 12px"
  input-field-read-only:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 12px"
  input-field-error:
    backgroundColor: "{colors.error-container}"
    textColor: "{colors.on-error-container}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "0 12px"
  divider:
    backgroundColor: "{colors.outline}"
    height: 1px
  resize-handle:
    backgroundColor: "{colors.outline-strong}"
    width: 1px
  metadata:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    typography: "{typography.caption}"
  badge-neutral:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
  badge-success:
    backgroundColor: "{colors.success-container}"
    textColor: "{colors.on-success-container}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
  badge-warning:
    backgroundColor: "{colors.warning-container}"
    textColor: "{colors.on-warning-container}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
  badge-error:
    backgroundColor: "{colors.error-container}"
    textColor: "{colors.on-error-container}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
  status-success:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.success}"
    typography: "{typography.label-sm}"
  status-warning:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.warning}"
    typography: "{typography.label-sm}"
  status-error:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
    typography: "{typography.label-sm}"
  floating-toolbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    height: 44px
    padding: "4px 8px"
  ai-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    width: "{spacing.inspector-width}"
    padding: "{spacing.lg}"
  modal-scrim:
    backgroundColor: "{colors.scrim}"
  document-page:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.document-body}"
    rounded: "{rounded.xs}"
    width: 100%
    padding: "{spacing.4xl}"
---

# Editorial Workspace Design System

## Overview

Editorial Workspace is a design language for complex, content-centered work. It supports creation, knowledge management, project management, research, CRM, content review, and AI-assisted workflows. The interface should feel calm, clear, professional, and trustworthy. It may be powerful, but its tools must never compete with the work itself.

The governing principle is: **content is the subject and the interface is its frame. Use quiet layers to establish order, one brand color to guide action, and contextual tools to shorten the distance between intent and outcome.**

### Product character

- **Calm, not empty:** Use space to group and focus, not to create decorative looseness.
- **Professional, not corporate-generic:** Build quality through typography, proportion, borders, and detail rather than a conventional blue admin template.
- **Soft, not playful:** Keep radii and shadows restrained. Avoid bubbles, toy-like forms, and excessive pills.
- **Capable, not crowded:** Show only the capabilities required by the current task. Reveal secondary actions on hover, focus, selection, or through a More menu.
- **AI-assisted, not AI-dominated:** AI is a contextual companion. It must not replace the content workspace or force users away from the task at hand.

### Decision hierarchy

When rules conflict, decide in this order: accessibility and task completion; content clarity; spatial and hierarchical consistency; brand expression; decoration. Every new interface must inherit the colors, typography, spacing, shape, and interaction logic in this document. When no rule applies, choose the quieter solution that stays closest to the content object.

## Colors

The palette uses warm, natural neutrals with forest green reserved for brand expression and primary action. Except for semantic status and data visualization, a view must not introduce a second accent color.

- **Primary / Forest Green (`#315F49`):** Primary buttons, the current module, key links, focus, and selection indicators. Do not use it as a large page background.
- **Primary Hover (`#244C39`):** Hover and pressed feedback for primary actions, and emphasis text on pale green surfaces.
- **Background (`#F6F7F5`):** The application canvas, softened for long working sessions.
- **Surface (`#FFFFFF`):** Cards, documents, overlays, fields, and principal content containers.
- **Subtle surfaces (`#FAFBF9` / `#EFF1EE`):** Navigation, quiet grouping, disabled states, and segmented-control tracks.
- **Text (`#171A17`):** Titles and body copy. Avoid pure black.
- **Secondary text (`#5F665F`):** Supporting copy and navigation. Use `#676E67` only for non-critical metadata.
- **Outlines (`#E1E5E0` / `#C8CEC8`):** Default and emphasized boundaries. Fields, tables, and actionable regions must remain visibly bounded.
- **Semantic colors:** Pair success, warning, and error colors with text or an icon. Color alone must never communicate status.

White text is permitted only on `primary`, `primary-hover`, `primary-pressed`, or a semantic background dark enough to meet contrast requirements. Pale containers must use their corresponding dark `on-*-container` color. Muted text must not carry form labels, essential data, error causes, or the only instruction for an action.

### Data color

Use `dataColors` only when a chart, board, calendar, user identity, or categorical dataset genuinely requires differentiation. Keep the primary series forest green and assign colors consistently within a product area. Never reuse semantic red, amber, or green to represent ordinary categories when that could imply error, warning, or success. Labels, patterns, shapes, or direct values must make the visualization understandable without color alone.

## Typography

The application interface uses `Inter, Noto Sans SC, system-ui, sans-serif`. In Chinese environments, Noto Sans SC or the system sans serif maintains a neutral, compact, readable texture. Documents, scripts, and long-form editing surfaces may switch to `Source Serif 4, Noto Serif SC, Georgia, serif`, creating a deliberate contrast between tool interface and paper content.

Use only 400, 500, and 600 weights across the product so that Latin, CJK, variable, and non-variable font fallbacks render predictably.

Formulas, identifiers, shortcuts, logs, and code use `JetBrains Mono, SFMono-Regular, Consolas, monospace`. Use `code-sm` for compact metadata and `code-md` for editable expressions or multi-line technical content. Monospace is functional, not decorative; do not apply it to ordinary labels or prose.

### Hierarchy

- `page-title` is reserved for the primary page heading; most views have one.
- `section-title` identifies a first-level content section within a page.
- `card-title` identifies cards, panels, and detail regions.
- `body-md` is the default interface text; `body-sm` supports denser lists and tables.
- `label-md` is for buttons, labels, and form titles; `label-sm` is for status chips.
- `caption` is only for metadata such as time, author, and counts.
- `document-title` and `document-body` belong only to paper or long-document modes, never navigation or controls.

Avoid extra-bold headings and all-uppercase labels. Preserve natural spacing in mixed-language copy. Single-line text must account for truncation and expose the full value through an accessible name or tooltip when it matters.

## Layout

The desktop workspace uses four layers: **48px global navigation + 256px local navigation + flexible main workspace + 360px contextual inspector or AI panel**. These are target dimensions, not reasons to squeeze the primary workspace. The main workspace always receives the remaining space first.

### Workspace layers

1. **Global navigation:** Product-level modules represented by labeled icons. Brand sits at the top; settings, notifications, and profile sit at the bottom.
2. **Local navigation:** Directory, filters, or hierarchy for the current module. Labels remain visible; the region scrolls independently and can collapse.
3. **Main workspace:** Cards, lists, tables, canvas, forms, or paper mode according to the task.
4. **Context panel:** Properties, comments, history, task status, or AI. Open it on demand and never alongside a second large floating panel.

General content is capped at 1200px. Data tables and infinite canvases may exceed that limit. Long-form content is capped at 760px, centered, and surrounded by stable margins. Use a 4px base unit and an 8px primary rhythm: 8–12px inside controls, 16–20px inside cards, 12–16px between cards, 24–32px between modules, and 40–48px between major sections.

### Responsive behavior

- **Wide, 1440px and above:** Show all four layers. The inspector may remain pinned.
- **Desktop, 1024–1439px:** Keep global navigation. Allow local navigation to collapse. Present the inspector as an overlay side panel.
- **Tablet, 768–1023px:** Move local navigation into a drawer. Use one or two main columns. Present the inspector as a right-side sheet.
- **Mobile, below 768px:** Move global navigation to the bottom. Use a full-height drawer for hierarchy and a bottom sheet or full-screen view for the inspector and AI. Keep floating tools above the on-screen keyboard and safe area.

Mobile layouts must reorganize information architecture rather than proportionally shrink the desktop shell. Touch targets are at least 44 × 44px. Compact controls may be 36px high only in keyboard and precise-pointer environments.

### Density modes

- **Comfortable:** Cards, creation, and browsing; 16–20px container padding.
- **Standard:** General workspace use; 12–16px container padding.
- **Compact:** Tables and operational workflows; 8–12px padding, text no smaller than 12px, and rows no shorter than 28px.

Density changes spacing and control height, not information hierarchy, color meaning, focus visibility, or core font scale.

## Elevation & Depth

Establish hierarchy with surface color, borders, and spacing first. Shadows indicate objects that have genuinely left normal document flow. Ordinary cards use a 1px outline and usually no shadow.

- **Level 0 — Canvas:** Background surface, no shadow.
- **Level 1 — Embedded surface:** White or subtly differentiated surface with a 1px border for cards, fields, and sections.
- **Level 2 — Raised control:** Selected segmented items, menus, and lightweight floating tools.
- **Level 3 — Floating panel:** AI panels, dialogs, and prominent contextual panels.

Show at most one Level 3 panel in a viewport. Do not add obvious shadows to every card. Avoid hard black shadows, glow, and skeuomorphic highlights. Dragged objects may temporarily rise one level, then return to their owning level on release.

## Shapes

The shape language is soft but restrained. Use 6–8px for small controls, 12px for ordinary cards, 16px for large panels, and 22px only for distinctive floating containers. Reserve full rounding for avatars, status dots, very short chips, and circular icon buttons.

- **6px:** Document paper, tiny tags, and precise editing controls.
- **8px:** Buttons, fields, menu items, and icon buttons.
- **12px:** Content cards, table containers, and segmented controls.
- **16px:** Large cards, inspectors, drawers, and ordinary overlays.
- **22px:** AI panels and floating toolbars.

Icons use one monochrome linear family with round line caps and a 1.5–2px stroke. Standard sizes are 16px, 18px, and 20px. Never mix outline, filled, multicolor, and 3D icon families in one interface. Every icon-only control requires an accessible name.

## Components

### Component state contract

Every interactive component must define the states that apply to it: default, hover, pressed, focus-visible, disabled, loading, selected, read-only, and error or destructive. They are behavioral states of one component. In YAML, represent each state as a separately addressable, consistently prefixed component entry, such as `button-primary`, `button-primary-hover`, and `button-primary-disabled`, as required by the DESIGN.md alpha schema.

- **Hover:** Reinforce discoverability without moving layout or revealing the only path to an essential action.
- **Pressed:** Darken or shift the surface and optionally translate the control by 1px.
- **Focus-visible:** Use a 2px forest-green ring with a 2px offset. The ring must not be clipped.
- **Disabled:** Keep labels readable, remove interaction, and do not rely on opacity alone when it makes text illegible.
- **Loading:** Preserve control dimensions, show progress, and prevent duplicate submission.
- **Selected:** Combine surface, text, icon, or border changes; never rely on color alone.
- **Read-only:** Distinguish editable from non-editable content without making the value look disabled.
- **Error/destructive:** Explain consequences in text and reserve confirmation for actions with meaningful irreversible impact.

### Buttons

Use a forest-green primary button only for the most important advancing action in a local region, such as Save, Publish, Create, or Confirm. Secondary buttons use a white surface and visible outline. Quiet buttons support toolbars and low-risk actions. Button labels use specific verbs rather than vague confirmations.

Do not place more than one primary action in a local action group. Loading buttons keep their original width. Destructive actions use red only when the action itself is destructive; cancellation and navigation remain neutral.

### Navigation

The current global-navigation item uses a pale green or gray rounded surface and `aria-current`. Local navigation uses visible labels; current state combines background, text weight, and optionally a narrow green indicator. Add dividers only where information architecture changes, never between every row.

Global navigation may appear icon-only visually, but persistent tooltips and accessible names are required. On unfamiliar or infrequent destinations, prefer a label-visible expanded state.

### Content cards

Prefer this hierarchy: category or description; primary title; status; metadata; optional visual. Place the title at top left, overflow actions at top right, metadata at lower left, and an image or preview at lower right. If the whole card is clickable, do not nest a second primary action within it. Reveal secondary actions on hover, focus-within, or selection.

Cards use a white background, 1px outline, and 12px radius. Hover may strengthen the outline and add Level 2 elevation. Selected cards use `surface-selected` or `primary-soft`, plus a visible selection icon, border, or text label. A white fade may protect text over an image, but it must not obscure the subject or create low-contrast copy.

### Segmented controls and tabs

Use a segmented control for two to four peer views: gray track, white selected item, 36px height. Switch to tabs or a selector when there are more than four items, labels are long, or horizontal scrolling would be required. Selected state changes both text and surface and does not depend on shadow alone.

### Inputs and forms

Fields are 40px high with an 8px radius, white background, and visible outline. Labels always sit above fields; placeholders never replace labels. Focus strengthens the outline and adds the standard focus ring. Show errors directly below the field with an icon, cause, and recovery guidance. A red outline alone is insufficient.

Group complex forms semantically, with 24–32px between groups. Show save state locally. Autosave must expose explicit Saving, Saved, and Save failed states. Read-only values remain legible and selectable. Disabled controls should be used only when the reason is apparent or explained nearby.

### Status chips

Status chips use a subtle container, dark text, 12px type, 4px block padding, 8px inline padding, and full rounding. Pair them with a small icon or status dot when useful. Success, warning, and error colors describe status only. Ordinary categories use neutral or pale-green styling.

### Floating toolbar

Show a floating toolbar only after an object is selected or an editing context begins. Keep frequent actions visible and move infrequent actions into More. The toolbar is 44px high with a 22px radius and Level 2 elevation. Position it near its object without covering a selection, insertion point, or critical content. On narrow screens, pin it within the safe area or above the keyboard.

### Context inspector and AI panel

The right panel reflects the current selection and may contain properties, comments, history, or AI. AI is a companion tool: it can reference the current page or selection, show execution steps and state, allow cancellation and retry, and keep its prompt input anchored at the bottom. It may collapse, expand, or go full-screen, but it must not claim the primary workspace by default.

AI-generated changes require a preview or a clear change summary. Bulk edits, deletion, publication, and external sending require confirmation. Progress appears inline with meaningful step labels, never as an uninformative full-screen loading animation. Users must be able to identify the referenced scope, affected objects, result, and available undo path.

### Document mode

Long documents and scripts use a centered white paper container and serif body text. Application navigation, toolbars, and property panels remain sans serif. Paper is `width: 100%` with a 760px maximum and 48px desktop padding. On mobile, remove paper shadow, border, fixed sizing, and excessive margin; render a full-width content flow.

### Tables and dense data

Prefer a list or table when data volume makes cards inefficient. Keep headers visible, column alignment stable, numbers right-aligned, and row hover extremely subtle. Keep the action column near its object and fixed when horizontal scrolling is necessary. Compact mode must preserve readable text and visible keyboard focus.

Use category colors only when they materially improve scanning. Always provide a text label, icon, pattern, or value. Do not turn every cell into a chip or every category into a saturated badge.

### Empty, loading, and error states

An empty state explains what belongs here, why the area is empty, and what the user can do next. Offer one primary action. Prefer local skeletons or inline progress to full-page loading; skeleton geometry should resemble the final content. Place errors as close as possible to the failed object. Use a full-page error only when the application cannot function.

## Motion

Use 120–160ms for hover, pressed, and selection feedback, and 180–220ms for panels, sheets, and layout changes. Apply a calm ease-out curve and keep movement within 8px. Motion clarifies origin, destination, and state; it is not decoration.

Honor `prefers-reduced-motion`: remove non-essential translation, scale, parallax, and autoplay. Keep immediate state feedback, progress communication, and focus changes. Never delay task completion to finish an animation.

## Accessibility contract

- Meet WCAG AA contrast for body text and essential controls.
- Keep keyboard focus visible and unobscured in every interactive state.
- Give every icon-only control a programmatic name.
- Communicate state with text, shape, position, or icon in addition to color.
- Use targets of at least 44 × 44px for touch interactions.
- Preserve content and functionality at 200% zoom and through text reflow.
- Keep DOM order aligned with visual and keyboard order.
- Use semantic landmarks, headings, labels, and live regions where their behavior requires them.
- Do not place critical information in tooltips alone.
- Use low contrast only for decoration, unavailable controls, or information duplicated accessibly elsewhere.

## Do's and Don'ts

### Do

- Keep content at the visual center; place navigation, properties, and AI at the edge or reveal them on demand.
- Establish hierarchy with surfaces, outlines, spacing, and typography before adding shadow.
- Reuse the workspace shell, spacing rhythm, and state model throughout the product.
- Keep one strongest primary action in each local region and guide it with forest green.
- Put actions close to their objects: card actions on cards, text actions near selection, and properties in the context panel.
- Offer list or table views for card-heavy pages and compact density for operational work.
- Recompose sidebars as drawers or sheets on mobile instead of compressing them.
- Make AI scope, execution steps, affected objects, outcome, and undo behavior visible.
- Test keyboard paths, focus rings, contrast, truncation, reflow, and 200% zoom in every view.
- Validate typography and weight fallback in every supported writing system.

### Don't

- Do not use large saturated color fields, decorative gradients, glow, glassmorphism, or heavy shadows.
- Do not introduce arbitrary accent colors by module. Semantic colors are not substitutes for brand color.
- Do not add shadow, radius, and border to every container until hierarchy becomes meaningless.
- Do not give ordinary cards radii above 20px or make every button a pill.
- Do not use readable text below 12px or assign critical meaning to faint gray text.
- Do not show more than one large Level 3 floating panel in a viewport.
- Do not put every capability in the top toolbar; progressively disclose low-frequency actions.
- Do not make hover the only way to discover essential functionality.
- Do not let AI execute irreversible bulk edits, deletion, publication, or external sending without review and confirmation.
- Do not navigate to a full page for a contextual task that fits naturally in an inspector, drawer, or inline expansion.

## Iteration Guide

1. Identify the task mode before styling: document, cards, table, canvas, form, or focused review. Do not force every task into the same container pattern.
2. Change one component family at a time. Keep related YAML variants under a shared prefix and update the corresponding prose contract in the same edit.
3. Reuse existing `{colors.*}`, `{typography.*}`, `{rounded.*}`, and `{spacing.*}` references before creating tokens. Add a token only when it represents a stable system decision rather than a one-off value.
4. Treat YAML tokens as normative where the alpha schema supports them. Treat borders, shadows, breakpoints, motion, maximum widths, and accessibility behavior in the prose as equally binding extensions until the schema supports those properties.
5. Preserve the workspace shell, content-first hierarchy, single-primary-action rule, and forest-green color discipline across new views.
6. Validate every change in comfortable, standard, and compact density; at mobile, tablet, desktop, and wide breakpoints; with keyboard navigation, reduced motion, 200% zoom, and realistic long content.
7. On Windows, run `npx -p @google/design.md designmd lint DESIGN.md`. Resolve every error and warning before using the file as generation context.

## Known Gaps

- This system defines a light workspace theme only. A dark theme requires its own tested surface ladder, contrast pairs, elevation behavior, and data palette; do not mechanically invert these colors.
- This system is optimized for product workspaces, not marketing pages. It does not define hero typography, campaign illustration, photography, testimonials, pricing cards, or long-scroll promotional rhythm.
- The categorical data palette is a starting set. Validate series distinguishability, color-vision accessibility, and domain meaning against real charts before production use.
- Product-specific editors may require additional semantic contracts for formulas, timelines, canvases, charts, or media. Extend the owning component family rather than creating a generic utility drawer.
- The DESIGN.md format is currently `alpha`. Custom top-level groups such as `motion`, `breakpoints`, `density`, and `iconography` are intentional extensions, but the official linter does not validate their internal structure.
