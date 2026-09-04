import assert from "node:assert/strict";

import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

designSystemTest(
  "the outline ViewModel renders its occurrence, field, and selection states",
  verifyOutlinePresentation,
);

async function verifyOutlinePresentation(page) {
  await navigateToCatalogPage(page, "components/outline");
  const tree = page.getByRole("tree");
  await tree.waitFor({ state: "visible" });
  const rowByText = (text) => page.locator('[data-ui="outline-row"]', { hasText: text }).first();
  const itemKey = (modelPath) => `outline-item:${encodeURIComponent(modelPath)}`;
  const rowByPath = (modelPath) => tree.locator(`[data-item-key=${JSON.stringify(itemKey(modelPath))}]`);
  const childrenOfPath = (modelPath) =>
    tree.locator(`[data-ui="outline-row"][data-parent-key=${JSON.stringify(itemKey(modelPath))}]`);
  const editor = page.locator('[data-ui="outline-editor"]');

  const lodeBullet = rowByText("Lode").locator('[data-ui="outline-bullet"]');
  await lodeBullet.hover();
  assert.equal(
    await lodeBullet.evaluate((element) => getComputedStyle(element).cursor),
    "pointer",
    "a clickable bullet must use the pointer cursor before a drag starts",
  );
  assert.equal(
    await lodeBullet.evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgba(0, 0, 0, 0)",
    "hovering a bullet must keep its hit target visually transparent",
  );

  const selectedNodeRow = rowByText("Design system roadmap");
  await selectedNodeRow.click();
  await page.keyboard.press("Escape");
  assert.equal(await selectedNodeRow.getAttribute("aria-selected"), "true");
  const selectedBulletTarget = selectedNodeRow.locator('[data-ui="outline-bullet"]');
  const selectedBulletMark = selectedNodeRow.locator('[data-ui="outline-bullet-mark"]');
  const selectedNodeDot = selectedNodeRow.locator('[data-ui="outline-node-dot"]');
  const [selectedBulletMarkBox, selectedNodeDotBox] = await Promise.all([
    selectedBulletMark.boundingBox(),
    selectedNodeDot.boundingBox(),
  ]);
  assert.ok(
    selectedBulletMarkBox !== null &&
      selectedNodeDotBox !== null &&
      Math.abs(selectedBulletMarkBox.width - 15) < 0.1 &&
      Math.abs(selectedBulletMarkBox.height - 15) < 0.1 &&
      Math.abs(selectedNodeDotBox.width - 5) < 0.1 &&
      Math.abs(selectedNodeDotBox.height - 5) < 0.1,
    "an ordinary bullet must use Tana's 15px footprint and 5px visible dot",
  );
  assert.deepEqual(
    await Promise.all(
      [selectedBulletTarget, selectedBulletMark].map((locator) =>
        locator.evaluate((element) => getComputedStyle(element).backgroundColor),
      ),
    ),
    ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"],
    "the current Node must not add a selection halo to its bullet",
  );
  assert.equal(
    await selectedNodeDot.evaluate((element) => getComputedStyle(element).backgroundColor),
    await rowByText("Why local-first changes product design")
      .locator('[data-ui="outline-node-dot"]')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    "selection must not recolor the ordinary Node dot",
  );

  for (const [label, datatype] of [
    ["Status", "options"],
    ["Owner", "supertag"],
    ["Review date", "date"],
    ["Ready", "checkbox"],
  ]) {
    assert.equal(
      await rowByText(label)
        .locator(`[data-ui="outline-field-mark"][data-datatype="${datatype}"] [data-ui="outline-field-type-mark"]`)
        .count(),
      1,
      `the ${label} Field node must expose its datatype through the bullet glyph`,
    );
  }
  assert.equal(
    await rowByText("In progress").locator('[data-ui="outline-field-type-mark"]').count(),
    0,
    "a Field Value node must keep the ordinary node dot instead of inheriting its Field's type glyph",
  );
  assert.ok(
    (await tree
      .locator(
        '[data-ui="outline-field-mark"][data-prominence="strong"][data-datatype="text"] [data-ui="outline-field-type-mark"]',
      )
      .count()) > 0,
    "a Field Definition occurrence must use the definition glyph inside the normal bullet hit target",
  );
  const ownerField = rowByPath("projects/lode/owner-field");
  assert.equal(await ownerField.getAttribute("aria-expanded"), null, "a Field node must not expose disclosure state");
  assert.equal(
    await ownerField.getByRole("button", { name: /^Expand/u }).count(),
    0,
    "a Field node must not expose the ordinary Node expansion control",
  );
  assert.equal(
    await childrenOfPath("projects/lode/owner-field").count(),
    2,
    "the Owner Field must present Kei and Lode team as its two Value occurrences",
  );
  assert.equal(
    await rowByPath("projects/lode/owner-field").locator("..").getAttribute("data-children-layout"),
    "beside",
    "a Field node must place its children beside its label",
  );

  const referenceRow = rowByPath("projects/lode/roadmap/local-first-reference");
  assert.equal(
    await referenceRow.getAttribute("data-item-key"),
    itemKey("projects/lode/roadmap/local-first-reference"),
  );
  assert.equal(
    await referenceRow.getAttribute("data-node-id"),
    null,
    "the component DOM must not expose a host Node id",
  );
  assert.equal(
    await referenceRow.getAttribute("data-occurrence-id"),
    null,
    "the component DOM must not expose a host Occurrence id",
  );
  assert.equal(await referenceRow.getAttribute("aria-expanded"), "true");
  assert.equal(
    await referenceRow.locator('[data-appearance="reference"] [data-ui="outline-reference-ring"]').count(),
    1,
    "a Reference occurrence must use the ring-and-dot appearance observed in Tana",
  );
  const referenceRingBox = await referenceRow.locator('[data-ui="outline-reference-ring"]').boundingBox();
  const collapsedNodeRingBox = await rowByPath("inbox/local-first-original")
    .locator('[data-ui="outline-bullet-mark"]')
    .boundingBox();
  assert.ok(
    referenceRingBox !== null &&
      collapsedNodeRingBox !== null &&
      Math.abs(referenceRingBox.width - collapsedNodeRingBox.width) <= 1 &&
      Math.abs(referenceRingBox.height - collapsedNodeRingBox.height) <= 1,
    "Reference and collapsed-child bullet rings must share one geometric footprint",
  );
  const referenceChild = rowByPath("projects/lode/roadmap/local-first-reference/local-first-summary");
  assert.equal(
    await referenceChild.count(),
    1,
    "an expanded Reference must unfold the target Node's child occurrences",
  );
  assert.equal(
    await referenceChild.locator('[data-appearance="node"]').count(),
    1,
    "a child unfolded through a Reference keeps its own occurrence appearance",
  );

  const fieldLabelBox = await rowByText("Status").boundingBox();
  const firstValueBox = await rowByText("In progress").boundingBox();
  const firstOwnerBox = await rowByPath("projects/lode/owner-field/kei-owner").boundingBox();
  const secondOwnerBox = await rowByPath("projects/lode/owner-field/team-owner").boundingBox();
  assert.ok(fieldLabelBox !== null && firstValueBox !== null, "Field and Field Value rows must be measurable");
  assert.ok(fieldLabelBox.width <= 260, "the Field label column must stay close to Tana's compact value offset");
  assert.equal(
    await tree
      .locator(`[data-item-key=${JSON.stringify(itemKey("projects/lode/status-field/in-progress"))}]`)
      .locator('[data-ui="outline-inline-content"]')
      .evaluate((element) => getComputedStyle(element).textDecorationLine),
    "none",
    "a reference-backed Field Value must not invent a dotted text underline",
  );
  assert.ok(
    Math.abs(fieldLabelBox.y - firstValueBox.y) <= 1,
    "a Field node and its first Field Value node must share one visual line",
  );
  assert.ok(firstOwnerBox !== null && secondOwnerBox !== null, "list Field Value rows must be measurable");
  assert.ok(
    Math.abs(firstOwnerBox.x - secondOwnerBox.x) <= 1,
    "later Field Value nodes must align with the first Field Value node",
  );

  const lodeEditingRow = rowByPath("projects/lode");
  const lodeSupertagBeforeEditing = await lodeEditingRow.locator('[data-ui="outline-row-badge"]').boundingBox();
  await lodeEditingRow.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  const lodeEditingBackground = await lodeEditingRow.evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.equal(
    lodeEditingBackground,
    "rgba(0, 0, 0, 0)",
    "editing one Node must not paint the full-width multi-selection background",
  );
  assert.equal(
    await editor.textContent(),
    "Lode #{project}",
    "Supertags reveal their closed source in the same editor",
  );
  assert.equal(
    await lodeEditingRow.locator('[data-ui="outline-row-badge"]').count(),
    0,
    "a Supertag must not render a duplicate badge beside its editable source",
  );
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const supertagBox = await lodeEditingRow.locator('[data-ui="outline-row-badge"]').boundingBox();
  assert.ok(
    supertagBox !== null &&
      lodeSupertagBeforeEditing !== null &&
      Math.abs(lodeSupertagBeforeEditing.x - supertagBox.x) <= 1,
    "leaving source editing restores the Supertag's inline position",
  );

  const pendingMilestone = rowByPath("projects/lode/roadmap/outline-m2");
  const pendingCheckbox = pendingMilestone.getByRole("checkbox");
  assert.equal(await pendingCheckbox.isChecked(), false, "the checkbox ViewModel must render its current state");
  await pendingCheckbox.click();
  assert.equal(await pendingCheckbox.isChecked(), true, "checkbox activation must emit the component's checked intent");
  assert.equal(
    await pendingMilestone
      .locator('[data-ui="outline-row-content"]')
      .evaluate((element) => getComputedStyle(element).textDecorationLine),
    "line-through",
    "the host must map the updated Model back into the component ViewModel",
  );
  await pendingCheckbox.click();

  const statusValue = rowByPath("projects/lode/status-field/in-progress");
  await statusValue.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  const suggestions = page.getByRole("listbox", { name: "Suggested values" });
  assert.equal(await suggestions.count(), 0, "focusing an existing Options value must leave Enter available to insert");
  await editor.press("Control+A");
  await editor.pressSequentially("I");
  await suggestions.waitFor({ state: "visible" });
  assert.equal(
    await suggestions.getByRole("option", { name: "I", exact: true }).count(),
    1,
    "an Options datatype derives candidates from their targets' current content",
  );
  await editor.press("Control+A");
  await editor.pressSequentially("Custom status");
  assert.equal(await editor.textContent(), "Custom status", "datatype suggestions must not reject arbitrary Node text");
  await rowByPath("projects/lode/review-date-field").click();
  await suggestions.waitFor({ state: "detached" });
  await editor.waitFor({ state: "detached" });
  assert.equal(
    await statusValue.locator('[data-appearance="reference"]').count(),
    1,
    "editing a reference-backed Field Value preserves its shared target identity",
  );
  await statusValue.locator('[data-ui="outline-row-text"]').click();
  assert.equal(await suggestions.count(), 0, "an existing arbitrary value reopens as an ordinary Node editor");
  await editor.press("Enter");
  const statusValues = childrenOfPath("projects/lode/status-field");
  await statusValues.nth(1).waitFor({ state: "visible" });
  const [firstStatusBox, secondStatusBox] = await Promise.all([
    statusValues.nth(0).boundingBox(),
    statusValues.nth(1).boundingBox(),
  ]);
  assert.ok(
    firstStatusBox !== null && secondStatusBox !== null && Math.abs(firstStatusBox.x - secondStatusBox.x) <= 1,
    "a Field Value inserted with Enter must stay in the value column instead of escaping into an indented row",
  );
  await editor.pressSequentially("Another status value");
  const insertedEditorBox = await editor.boundingBox();
  assert.ok(
    insertedEditorBox !== null && insertedEditorBox.width >= 96 && insertedEditorBox.height < 40,
    "a newly inserted Node editor must keep a usable horizontal line box",
  );
  if (await suggestions.isVisible()) {
    await editor.press("Escape");
  }
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });

  const fieldDefinition = rowByPath("field-definitions/status-definition-occurrence");
  const titleBeforeFieldDefinition = await page.locator("main h1").first().textContent();
  await fieldDefinition.locator('[data-ui="outline-bullet"]').click();
  assert.equal(
    await page.locator("main h1").first().textContent(),
    titleBeforeFieldDefinition,
    "the component reports Field Definition bullet activation without forcing page navigation",
  );
  assert.equal(
    await tree.locator('[data-ui="outline-row-details"]').count(),
    0,
    "node rows must not leak model explanations into secondary text",
  );

  const lodeTeam = rowByPath("projects/lode/owner-field/team-owner");
  await lodeTeam.getByRole("button", { name: "Expand Lode team" }).click();
  const lodeTeamPlaceholder = tree.locator(
    `[data-ui="outline-empty-child-placeholder"][data-parent-key=${JSON.stringify(itemKey("projects/lode/owner-field/team-owner"))}]`,
  );
  await lodeTeamPlaceholder.waitFor({ state: "visible" });
  const [lodeTeamBox, lodeTeamPlaceholderBox] = await Promise.all([
    lodeTeam.boundingBox(),
    lodeTeamPlaceholder.boundingBox(),
  ]);
  assert.ok(
    lodeTeamBox !== null && lodeTeamPlaceholderBox !== null && lodeTeamPlaceholderBox.x >= lodeTeamBox.x,
    "an empty-child placeholder under a Field Value must remain in the value column",
  );
  const lodeTeamBulletBox = await lodeTeam.locator('[data-ui="outline-bullet"]').boundingBox();
  const lodeTeamChildBulletBox = await lodeTeamPlaceholder.locator('[data-ui="outline-bullet-mark"]').boundingBox();
  assert.ok(
    lodeTeamBulletBox !== null && lodeTeamChildBulletBox !== null && lodeTeamChildBulletBox.x > lodeTeamBulletBox.x,
    "an empty-child placeholder must indent locally from its Field Value parent",
  );
  assert.equal(
    await childrenOfPath("projects/lode/owner-field/team-owner").count(),
    0,
    "expanding an empty Node must not materialize a model Node",
  );
  assert.equal(await lodeTeamPlaceholder.locator('[data-ui="outline-placeholder-bullet"]').count(), 1);
  assert.doesNotMatch(
    (await lodeTeamPlaceholder.textContent()) ?? "",
    /Type \/ for commands/u,
    "an unfocused empty-child placeholder keeps Tana's quiet bullet-only appearance",
  );

  await tree.getByRole("button", { name: "Expand Expandable empty node" }).click();
  const emptyChildPlaceholder = tree.locator(
    `[data-ui="outline-empty-child-placeholder"][data-parent-key=${JSON.stringify(itemKey("projects/lode/roadmap/empty-container"))}]`,
  );
  await emptyChildPlaceholder.waitFor({ state: "visible" });
  const [emptyContainerBulletBox, emptyPlaceholderBulletBox] = await Promise.all([
    rowByPath("projects/lode/roadmap/empty-container").locator('[data-ui="outline-bullet"]').boundingBox(),
    emptyChildPlaceholder.locator('[data-ui="outline-bullet-mark"]').boundingBox(),
  ]);
  assert.ok(
    emptyContainerBulletBox !== null &&
      emptyPlaceholderBulletBox !== null &&
      emptyPlaceholderBulletBox.x > emptyContainerBulletBox.x + 10,
    "the empty-child placeholder must sit one indent step inside its parent",
  );
  assert.equal(
    await emptyChildPlaceholder.locator('[data-ui="outline-placeholder-bullet"]').count(),
    1,
    "expanding an empty Node must render Tana's empty-child placeholder without changing the Model",
  );
  const inactivePlaceholderBox = await emptyChildPlaceholder.boundingBox();
  await emptyChildPlaceholder.click();
  const emptyChild = childrenOfPath("projects/lode/roadmap/empty-container");
  await emptyChild.waitFor({ state: "visible" });
  await editor.waitFor({ state: "visible" });
  const activePlaceholderBox = await emptyChild.locator('[data-ui="outline-placeholder"]').boundingBox();
  const emptyChildBox = await emptyChild.boundingBox();
  assert.ok(
    activePlaceholderBox !== null &&
      emptyChildBox !== null &&
      activePlaceholderBox.height <= 24 &&
      activePlaceholderBox.y + activePlaceholderBox.height <= emptyChildBox.y + emptyChildBox.height,
    "an active empty Node placeholder must remain on one clipped line inside its row",
  );
  assert.ok(
    inactivePlaceholderBox !== null &&
      emptyChildBox !== null &&
      Math.abs(inactivePlaceholderBox.height - emptyChildBox.height) <= 1,
    "activating an empty-child placeholder must not change the visual row height",
  );
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  await emptyChild.waitFor({ state: "visible" });
  assert.equal(
    await emptyChild.locator('[data-ui="outline-placeholder-bullet"]').count(),
    0,
    "a materialized empty Node must remain a normal Node after focus leaves it",
  );
  assert.equal(
    await emptyChildPlaceholder.count(),
    0,
    "a parent with a real empty child must not also render the no-child placeholder",
  );
  await emptyChild.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("Enter");
  const emptyChildren = childrenOfPath("projects/lode/roadmap/empty-container");
  await emptyChildren.nth(1).waitFor({ state: "visible" });
  assert.equal(
    await emptyChildren.count(),
    2,
    "Enter on an empty Node must preserve it and advance to a new empty Node",
  );
  assert.equal(
    await emptyChildren.first().locator('[data-ui="outline-placeholder-bullet"]').count(),
    0,
    "the empty Node fixed by Enter must retain ordinary Node identity",
  );
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(await emptyChildren.count(), 2, "the next empty Node must also survive an unfocused state");
  await rowByText("Status").click();
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press("Shift+ArrowDown");
  }
  await page.getByRole("toolbar", { name: "4 items selected" }).waitFor({ state: "visible" });
  assert.equal(
    await tree.locator('[data-ui="outline-row"][aria-selected="true"]').count(),
    4,
    "Shift selection must include every visible Node occurrence in the range",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("toolbar", { name: "4 items selected" }).waitFor({ state: "detached" });

  assert.equal(
    await rowByText("Open design decisions").locator('[data-bullet-marker="search"]').count(),
    1,
    "a Search Node must expose its semantic bullet treatment",
  );
  const searchMarkBox = await rowByText("Open design decisions")
    .locator('[data-ui="outline-search-mark"]')
    .boundingBox();
  const searchBulletBox = await rowByText("Open design decisions")
    .locator('[data-ui="outline-bullet-mark"]')
    .boundingBox();
  assert.ok(
    searchMarkBox !== null &&
      searchBulletBox !== null &&
      searchBulletBox.width >= 15 &&
      searchBulletBox.height >= 15 &&
      searchMarkBox.width < searchBulletBox.width &&
      searchMarkBox.height < searchBulletBox.height,
    "the Search glyph must remain inside the shared 15px outer bullet footprint",
  );
  assert.equal(
    await rowByText("Daily notes").locator('[data-bullet-marker="calendar"]').count(),
    1,
    "a date-backed system node must support a semantic bullet replacement",
  );
  assert.equal(
    await rowByPath("kei").locator('[data-bullet-marker="default"]').count(),
    1,
    "a Person supertag instance must retain the ordinary Node bullet",
  );
  assert.equal(
    await rowByPath("kei").locator('[data-ui="outline-row-badge"]', { hasText: "#person" }).count(),
    1,
    "a Person classification must render through its supertag badge rather than a component-owned bullet type",
  );
  await rowByText("Open design decisions").locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("Escape");
  await rowByPath("kei").locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(
    await rowByText("Interaction coverage").getByRole("progressbar").getAttribute("aria-valuenow"),
    "3",
    "a node row must expose secondary progress as accessible metadata",
  );
  await rowByText("Daily notes").locator('[data-ui="outline-row-text"]').click();
  assert.equal(
    await page.locator('[data-ui="outline-editor"]').count(),
    0,
    "a date-backed system node whose name is owned by the domain must remain read-only",
  );

  const originalRow = rowByPath("inbox/local-first-original");
  await referenceRow.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("End");
  await editor.pressSequentially("!");
  await originalRow.locator('[data-ui="outline-inline-content"]', { hasText: "Local-first software essay!" }).waitFor({
    state: "visible",
  });
  assert.equal(await editor.count(), 1, "a Reference edit must update its Original while the editor remains focused");
  await editor.press("Backspace");
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });

  await originalRow.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("End");
  await editor.pressSequentially("!");
  await referenceRow.locator('[data-ui="outline-inline-content"]', { hasText: "Local-first software essay!" }).waitFor({
    state: "visible",
  });
  assert.equal(await editor.count(), 1, "an Original edit must update its References while the editor remains focused");
  await editor.press("Backspace");
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });

  await referenceChild.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("End");
  await editor.press("Enter");
  await editor.pressSequentially("Shared through reference");
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  await childrenOfPath("projects/lode/roadmap/local-first-reference")
    .filter({ hasText: "Shared through reference" })
    .waitFor({ state: "visible" });

  await referenceRow.locator('[data-ui="outline-bullet"]').click();
  await page.getByRole("heading", { name: "Local-first software essay", level: 3 }).waitFor({ state: "visible" });
  const referenceBreadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  assert.equal(
    await referenceBreadcrumb.getByText("Reading inbox", { exact: true }).count(),
    1,
    "activating a Reference navigates through the target Node's Original path",
  );
  assert.equal(
    await referenceBreadcrumb.getByText("Design system roadmap", { exact: true }).count(),
    0,
    "Reference navigation must not turn the Reference occurrence path into the target's owning path",
  );
  assert.equal(
    await page.locator('[data-ui="outline-row"]', { hasText: "Shared through reference" }).count(),
    1,
    "structural edits through a Reference must update the target Node seen from its Original occurrence",
  );
  await navigateToCatalogPage(page, "components/buttons");
  await navigateToCatalogPage(page, "components/outline");
  await tree.waitFor({ state: "visible" });

  await tree.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Control+ArrowUp");
  assert.equal(
    await rowByText("Projects").getAttribute("aria-expanded"),
    "false",
    "Ctrl+ArrowUp collapses the editing row",
  );
  await page.keyboard.press("Control+ArrowDown");
  assert.equal(
    await rowByText("Projects").getAttribute("aria-expanded"),
    "true",
    "Ctrl+ArrowDown expands the editing row",
  );

  const inbox = rowByText("Reading inbox");
  assert.equal(await inbox.getAttribute("aria-level"), "1", "the demo starts with Reading inbox at the root level");
  await inbox.click();
  await page.keyboard.press("Tab");
  await page
    .locator('[data-ui="outline-row"][aria-level="2"]', { hasText: "Reading inbox" })
    .first()
    .waitFor({ state: "visible" });

  await rowByText("Projects").locator('[data-ui="outline-bullet"]').click();
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await breadcrumb.waitFor({ state: "visible" });
  assert.equal(
    (await breadcrumb.locator('[aria-current="page"]').textContent())?.trim(),
    "Projects",
    "zooming a node must land its title in the breadcrumb",
  );
  await page.locator('[data-ui="outline-row"][aria-level="1"]', { hasText: "Lode" }).first().waitFor({
    state: "visible",
  });
  await breadcrumb.getByRole("button", { name: "All nodes" }).click();
  await breadcrumb.waitFor({ state: "detached" });
}

designSystemTest("outline editing emits content and structural intents", verifyOutlineEditing);

async function verifyOutlineEditing(page) {
  await navigateToCatalogPage(page, "components/outline");
  const tree = page.getByRole("tree");
  await tree.waitFor({ state: "visible" });
  const rowByText = (text) => page.locator('[data-ui="outline-row"]', { hasText: text }).first();
  const itemKey = (modelPath) => `outline-item:${encodeURIComponent(modelPath)}`;
  const rowByPath = (modelPath) => tree.locator(`[data-item-key=${JSON.stringify(itemKey(modelPath))}]`);
  const editor = page.locator('[data-ui="outline-editor"]');
  const editorText = () => editor.textContent();
  const setEditorCaret = (offset) =>
    editor.evaluate((element, caret) => element.editor.commands.setTextSelection(caret + 1), offset);
  const homeLabText = rowByText("Home lab notes").locator('[data-ui="outline-inline-content"]');
  const clickedCaret = 4;
  await homeLabText.scrollIntoViewIfNeeded();
  const clickPoint = await homeLabText.evaluate((element, caret) => {
    const text = element.querySelector("[data-source-start]")?.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("the demo row must expose its text for caret verification");
    }
    const range = document.createRange();
    range.setStart(text, caret - 1);
    range.setEnd(text, caret);
    const bounds = range.getBoundingClientRect();
    return { x: bounds.right - 0.25, y: (bounds.top + bounds.bottom) / 2 };
  }, clickedCaret);
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await editor.waitFor({ state: "visible" });
  assert.equal(
    await editor.evaluate((element) => element.editor.state.selection.from - 1),
    clickedCaret,
    "clicking within row text must preserve the clicked caret position",
  );
  await editor.press("Tab");
  await rowByPath("projects/lode/home-lab").locator('[data-ui="outline-editor"]').waitFor();
  assert.equal(
    await rowByText("Home lab notes").getAttribute("aria-level"),
    "3",
    "Tab in edit mode must emit an indent intent without predicting the host's next ViewModel key",
  );
  assert.equal(
    await editor.textContent(),
    "Home lab notes #{project}",
    "a structural intent preserves the draft and keeps its editor active",
  );

  await rowByText("Engine facts and projections").locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  assert.equal(await editorText(), "Engine facts and projections", "clicking row text must enter edit mode");
  await editor.press("End");
  await editor.pressSequentially(" edited");
  await setEditorCaret(6);
  await editor.press("Enter");
  await page.waitForFunction(
    (value) => document.querySelector('[data-ui="outline-editor"]')?.textContent === value,
    " facts and projections edited",
  );
  assert.equal(
    await editorText(),
    " facts and projections edited",
    "Enter in the middle must split and edit the trailing node",
  );
  await setEditorCaret((await editorText()).length);
  await editor.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-ui="outline-editor"]')?.textContent === "");
  assert.equal(await editorText(), "", "Enter at the end must create and edit an empty sibling");
  await editor.press("Backspace");
  await page.waitForFunction(
    (value) => document.querySelector('[data-ui="outline-editor"]')?.textContent === value,
    " facts and projections edited",
  );
  await setEditorCaret(0);
  await editor.press("Backspace");
  await page.waitForFunction(
    (value) => document.querySelector('[data-ui="outline-editor"]')?.textContent === value,
    "Engine facts and projections edited",
  );
  await setEditorCaret((await editorText()).length);
  await editor.press("Shift+Enter");
  await editor.pressSequentially("supporting detail");
  assert.equal(await editorText(), "supporting detail", "Shift+Enter creates a sibling and edits its content");
  assert.equal(
    await rowByText("Engine facts and projections edited").locator('[data-ui="outline-inline-content"]').textContent(),
    "Engine facts and projections edited",
    "forced sibling insertion preserves the original node",
  );
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  await rowByText("Engine facts and projections edited").waitFor({ state: "visible" });

  await rowByText("CRDT ordering survey").locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("End");
  await editor.pressSequentially(" @");
  const referencePicker = page.getByRole("listbox", { name: "References" });
  await referencePicker.waitFor({ state: "visible" });
  await referencePicker.getByRole("option", { name: "Local-first software essay" }).click();
  assert.equal(
    await editorText(),
    "CRDT ordering survey @{Local-first software essay}",
    "choosing a reference must insert editable closed source",
  );
  const rowsBeforeCompositionEnter = await page.locator('[data-ui="outline-row"]').count();
  await editor.evaluate((surface) => {
    surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
    surface.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, isComposing: true, key: "Enter" }),
    );
  });
  assert.equal(
    await page.locator('[data-ui="outline-row"]').count(),
    rowsBeforeCompositionEnter,
    "Enter during IME composition must not create or split a node",
  );
  assert.equal(await editor.count(), 1, "Enter during IME composition must keep the editor active");
  await editor.evaluate((surface) => {
    surface.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中" }));
  });
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  await rowByText("CRDT ordering survey")
    .locator('[data-ui="outline-reference"]', { hasText: "Local-first software essay" })
    .waitFor({ state: "visible" });

  const quickCapture = rowByPath("inbox/quick-capture");
  assert.equal(
    await quickCapture.locator('[data-ui="outline-placeholder-bullet"]').count(),
    0,
    "a real empty Node must not inherit the synthetic placeholder bullet",
  );
  await quickCapture.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  assert.ok(
    ((await editor.boundingBox())?.width ?? 0) >= 96,
    "an empty Node editor must retain a usable horizontal click target",
  );
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(await quickCapture.count(), 1, "focusing and leaving a real empty Node must not remove it");

  await quickCapture.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.pressSequentially("/");
  const commandPicker = page.getByRole("listbox", { name: "Commands" });
  await commandPicker.waitFor({ state: "visible" });
  await commandPicker.getByRole("option", { name: /Make task/ }).click();
  assert.equal(await editorText(), "", "choosing a slash command must remove its query from node content");
  assert.equal(
    await editor.locator('xpath=ancestor::*[@data-ui="outline-row"]').getByRole("checkbox").count(),
    1,
    "a slash command must hand the semantic node transformation to its owner",
  );
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editor.waitFor({ state: "detached" });

  // A field is selected through the editor, but the resulting Field and Field Value remain distinct Node rows.
  await navigateToCatalogPage(page, "components/buttons");
  await navigateToCatalogPage(page, "components/outline");
  await page.getByRole("tree").focus();
  await page.keyboard.press("End");
  await rowByPath("inbox/quick-capture").locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.pressSequentially(">");
  const fieldPicker = page.getByRole("listbox", { name: "Fields" });
  await fieldPicker.waitFor({ state: "visible" });
  await fieldPicker.getByRole("option", { name: "Notes" }).click();
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  await page.getByRole("tree").focus();
  await page.keyboard.press("End");
  const createdField = page
    .locator('[data-ui="outline-node"][data-children-layout="beside"] > [data-ui="outline-row"]', { hasText: "Notes" })
    .first();
  await createdField.waitFor({ state: "visible" });
  const createdRows = await page
    .locator('[data-ui="outline-row"]')
    .evaluateAll((rows) => rows.map((row) => ({ parent: row.dataset.parentKey, text: row.textContent })));
  assert.equal(
    await createdField.count(),
    1,
    `choosing a definition must create a Field Node: ${JSON.stringify(createdRows)}`,
  );
  const createdValue = tree.locator(
    `[data-ui="outline-row"][data-parent-key=${JSON.stringify(await createdField.getAttribute("data-item-key"))}]`,
  );
  assert.equal(
    await createdValue.count(),
    1,
    `choosing a definition must create a Field Value Node: ${JSON.stringify(createdRows)}`,
  );
  const createdFieldBox = await createdField.boundingBox();
  const createdValueBox = await createdValue.boundingBox();
  assert.ok(createdFieldBox !== null && createdValueBox !== null, "created Field nodes must be measurable");
  assert.ok(
    Math.abs(createdFieldBox.y - createdValueBox.y) <= 1,
    `a newly created Field and its first Field Value Node must share one visual line: ${JSON.stringify({ createdFieldBox, createdValueBox })}`,
  );
}

designSystemTest("outline drag and drop preserves tree constraints", verifyOutlineDragging);

async function verifyOutlineDragging(page) {
  await navigateToCatalogPage(page, "components/outline");
  const tree = page.getByRole("tree");
  await tree.waitFor({ state: "visible" });
  const rowByText = (text) => page.locator('[data-ui="outline-row"]', { hasText: text }).first();
  const itemKey = (modelPath) => `outline-item:${encodeURIComponent(modelPath)}`;
  const rowByPath = (modelPath) => tree.locator(`[data-item-key=${JSON.stringify(itemKey(modelPath))}]`);
  const lodeRow = rowByPath("projects/lode");
  await lodeRow.getByRole("button", { name: "Collapse Lode" }).click();
  const handle = rowByText("Home lab notes").locator('[data-ui="outline-bullet"]');
  await handle.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  const lodeBox = await lodeRow.boundingBox();
  assert.ok(handleBox !== null && lodeBox !== null, "drag geometry must be measurable");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2, lodeBox.y + 3);
  const indicator = await page.evaluate(
    () => document.querySelector('[role="tree"] [data-ui="outline-drop-indicator"]') !== null,
  );
  assert.equal(indicator, true, "an eligible drop position must show the insertion line");
  await page.mouse.up();
  const moved = rowByText("Home lab notes");
  assert.equal(await moved.getAttribute("aria-level"), "2", "the dragged row must land under Projects");
  assert.equal(await moved.getAttribute("aria-posinset"), "1", "the dragged row must land before Lode");

  // Dropping a subtree into its own descendant must be rejected.
  await lodeRow.getByRole("button", { name: "Expand Lode" }).click();
  const projectsHandle = rowByText("Projects").locator('[data-ui="outline-bullet"]');
  await projectsHandle.scrollIntoViewIfNeeded();
  const projectsBox = await projectsHandle.boundingBox();
  const roadmapBox = await rowByText("Design system roadmap").boundingBox();
  assert.ok(projectsBox !== null && roadmapBox !== null, "illegal-drop geometry must be measurable");
  await page.mouse.move(projectsBox.x + projectsBox.width / 2, projectsBox.y + projectsBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(roadmapBox.x + roadmapBox.width / 2, roadmapBox.y + roadmapBox.height - 3);
  await page.mouse.up();
  assert.equal(
    await rowByText("Projects").getAttribute("aria-level"),
    "1",
    "a subtree must never move into its own descendants",
  );
}

async function outlineDragContext(page) {
  await navigateToCatalogPage(page, "components/outline");
  const tree = page.getByRole("tree");
  await tree.waitFor({ state: "visible" });
  const itemKey = (modelPath) => `outline-item:${encodeURIComponent(modelPath)}`;
  const rowByPath = (modelPath) => tree.locator(`[data-item-key=${JSON.stringify(itemKey(modelPath))}]`);
  const drag = async (source, target, { depthOffset = 0, edge = "after" } = {}) => {
    const handle = source.locator('[data-ui="outline-bullet"]');
    const targetHandle = target.locator('[data-ui="outline-bullet"]');
    const [handleBox, targetHandleBox, targetBox] = await Promise.all([
      handle.boundingBox(),
      targetHandle.boundingBox(),
      target.boundingBox(),
    ]);
    assert.ok(
      handleBox !== null && targetHandleBox !== null && targetBox !== null,
      "the dragged Node and target bullets must be measurable",
    );
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      targetHandleBox.x + targetHandleBox.width / 2 + depthOffset * 20,
      edge === "before" ? targetBox.y + 2 : targetBox.y + targetBox.height - 2,
    );
    const indicator = tree.locator('[data-ui="outline-drop-indicator"] > div').first();
    await indicator.waitFor({ state: "visible" });
    const indicatorBox = await indicator.boundingBox();
    await page.mouse.up();
    return indicatorBox;
  };
  const reset = async () => {
    await navigateToCatalogPage(page, "components/buttons");
    await navigateToCatalogPage(page, "components/outline");
    await tree.waitFor({ state: "visible" });
  };
  const nodeOf = (row) => row.locator("..");
  return { drag, itemKey, nodeOf, reset, rowByPath, tree };
}

designSystemTest("outline Nodes move independently of Field presentation columns", async (page) => {
  const { drag, itemKey, nodeOf, reset, rowByPath } = await outlineDragContext(page);

  const reviewField = rowByPath("projects/lode/review-date-field");
  const statusField = rowByPath("projects/lode/status-field");
  const statusFieldBox = await statusField.boundingBox();
  const reorderIndicatorBox = await drag(reviewField, statusField, { edge: "before" });
  assert.ok(reorderIndicatorBox !== null, "the Field reorder must expose a drop target");
  assert.ok(
    statusFieldBox !== null && Math.abs(reorderIndicatorBox.x - statusFieldBox.x) <= 8,
    "the insertion line for a Field reorder must start at the Field label column",
  );
  assert.equal(
    await reviewField.getAttribute("data-parent-key"),
    itemKey("projects/lode"),
    "vertical movement in the leading column must reorder the Field without changing its parent",
  );
  assert.equal(await reviewField.getAttribute("aria-posinset"), "1", "the Field must reorder before Status");

  await reset();
  const roadmap = rowByPath("projects/lode/roadmap");
  const ownerValue = rowByPath("projects/lode/owner-field/team-owner");
  const ownerValueBox = await ownerValue.boundingBox();
  const valueIndicatorBox = await drag(roadmap, ownerValue);
  assert.ok(valueIndicatorBox !== null, "the Field Value column must expose its owning Field depth as a drop target");
  assert.ok(
    ownerValueBox !== null && Math.abs(valueIndicatorBox.x - ownerValueBox.x) <= 8,
    `the insertion line for a drop beside a Field Value must start in the value column: ${JSON.stringify({ ownerValueBox, valueIndicatorBox })}`,
  );
  const movedRoadmap = rowByPath("projects/lode/owner-field/roadmap");
  assert.equal(
    await movedRoadmap.getAttribute("data-parent-key"),
    itemKey("projects/lode/owner-field"),
    "a Node dropped beside a Field Value must become another child of that Field",
  );
  const [movedRoadmapBox, keiBox] = await Promise.all([
    movedRoadmap.boundingBox(),
    rowByPath("projects/lode/owner-field/kei-owner").boundingBox(),
  ]);
  assert.ok(
    movedRoadmapBox !== null && keiBox !== null && Math.abs(movedRoadmapBox.x - keiBox.x) <= 1,
    "a Node that became a Field Value must align with the Field's other values",
  );

  await reset();
  const fieldInField = rowByPath("projects/lode/review-date-field");
  const firstOwnerValue = rowByPath("projects/lode/owner-field/kei-owner");
  assert.ok(
    (await drag(fieldInField, firstOwnerValue, { edge: "before" })) !== null,
    "a Field must be movable to the first child position of another Field",
  );
  const directFieldPath = "projects/lode/owner-field/review-date-field";
  const directField = rowByPath(directFieldPath);
  const directValue = rowByPath(`${directFieldPath}/review-date-value`);
  const ownerField = rowByPath("projects/lode/owner-field");
  assert.equal(await directField.getAttribute("data-parent-key"), itemKey("projects/lode/owner-field"));
  assert.equal(await nodeOf(directField).getAttribute("data-children-layout"), "beside");
  assert.equal(await directField.locator('[data-ui="outline-field-mark"]').count(), 1, "the moved Field stays a Field");
  assert.equal(await directField.getAttribute("data-readonly"), "true", "the Field label stays read-only");
  const [ownerFieldBox, directFieldBox, directValueBox] = await Promise.all([
    ownerField.boundingBox(),
    directField.boundingBox(),
    directValue.boundingBox(),
  ]);
  assert.ok(
    ownerFieldBox !== null && directFieldBox !== null && directValueBox !== null,
    "the nested Field chain must be measurable",
  );
  assert.ok(
    Math.abs(ownerFieldBox.y - directFieldBox.y) <= 1 && Math.abs(directFieldBox.y - directValueBox.y) <= 1,
    "a first-child Field and its first Value must chain across the owning Field's visual row",
  );

  await reset();
  const nestedReviewField = rowByPath("projects/lode/review-date-field");
  const nestedOwnerValue = rowByPath("projects/lode/owner-field/team-owner");
  const nestedOwnerValueBox = await nestedOwnerValue.boundingBox();
  const nestedIndicatorBox = await drag(nestedReviewField, nestedOwnerValue, { depthOffset: 1 });
  assert.ok(nestedIndicatorBox !== null, "one explicit depth step must expose the Field Value Node as a parent");
  assert.ok(
    nestedOwnerValueBox !== null && nestedIndicatorBox.x > nestedOwnerValueBox.x + 10,
    "the insertion line for a child drop must sit one indent step inside the Field Value row",
  );
  const nestedFieldPath = "projects/lode/owner-field/team-owner/review-date-field";
  const nestedField = rowByPath(nestedFieldPath);
  const nestedValue = rowByPath(`${nestedFieldPath}/review-date-value`);
  assert.equal(
    await nestedField.getAttribute("data-parent-key"),
    itemKey("projects/lode/owner-field/team-owner"),
    "a Field must be allowed to enter a Field Value subtree",
  );
  assert.equal(await nodeOf(nestedField).getAttribute("data-children-layout"), "beside");
  const [nestedFieldBox, nestedValueBox, nestedParentBox] = await Promise.all([
    nestedField.boundingBox(),
    nestedValue.boundingBox(),
    nestedOwnerValue.boundingBox(),
  ]);
  assert.ok(
    nestedFieldBox !== null && nestedValueBox !== null && nestedParentBox !== null,
    "the nested tuple must be measurable",
  );
  assert.ok(
    Math.abs(nestedFieldBox.y - nestedValueBox.y) <= 1 && nestedValueBox.x >= nestedFieldBox.x + nestedFieldBox.width,
    "the first child must share the Field row in the local trailing column",
  );
  assert.ok(
    nestedFieldBox.x > nestedParentBox.x + 10,
    "a Field inside a Field Value subtree must indent from its parent like any other child",
  );

  await reset();
  const detachableValue = rowByPath("projects/lode/owner-field/team-owner");
  const detachTarget = rowByPath("projects/lode/review-date-field");
  assert.ok(
    (await drag(detachableValue, detachTarget, { edge: "before" })) !== null,
    "the ordinary parent position must expose a drop target",
  );
  const detachedValue = rowByPath("projects/lode/team-owner");
  assert.equal(
    await detachedValue.getAttribute("data-parent-key"),
    itemKey("projects/lode"),
    "a Field Value Node must be allowed to leave its Field",
  );
  const [detachedValueBox, siblingFieldBox] = await Promise.all([
    detachedValue.boundingBox(),
    rowByPath("projects/lode/review-date-field").boundingBox(),
  ]);
  assert.ok(
    detachedValueBox !== null && siblingFieldBox !== null && Math.abs(detachedValueBox.x - siblingFieldBox.x) <= 1,
    "the former Value must use ordinary Node layout under an ordinary parent",
  );
  assert.equal(await nodeOf(detachedValue).getAttribute("data-children-layout"), "indented");
});
