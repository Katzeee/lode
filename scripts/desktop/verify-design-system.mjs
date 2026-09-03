import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron } from "playwright-core";

import { catalogPages } from "../../packages/design-system-catalog/dist/index.js";
import { tokens } from "../../packages/design-tokens/dist/index.js";
import { verifyCatalogAccessibility } from "./catalog-accessibility.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const documentPath = join(repositoryRoot, "apps", "desktop", "dist", "index.html");
const harnessPath = join(scriptDirectory, "design-system-harness.cjs");
const application = await _electron.launch({ args: [harnessPath, documentPath], cwd: repositoryRoot });

// Representative window sizes from the smallest supported phone through
// tablets in both orientations up to a full desktop. The catalog must fit
// every one of them without horizontal overflow, and the app shell must pick
// the navigation tier its container width mandates.
const deviceViewports = [
  { label: "folded phone (320×568)", width: 320, height: 568 },
  { label: "phone (360×800)", width: 360, height: 800 },
  { label: "large phone (390×844)", width: 390, height: 844 },
  { label: "phone landscape (844×390)", width: 844, height: 390 },
  { label: "tablet portrait (768×1024)", width: 768, height: 1024 },
  { label: "tablet landscape (1024×768)", width: 1024, height: 768 },
  { label: "small laptop (1280×800)", width: 1280, height: 800 },
  { label: "laptop (1366×768)", width: 1366, height: 768 },
  { label: "desktop (1920×1080)", width: 1920, height: 1080 },
];

try {
  const page = await application.firstWindow({ timeout: 30_000 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await verifyCatalogAccessibility(page);
  await page.setViewportSize({ height: 844, width: 390 });
  await verifyCatalogAccessibility(page);
  await verifyDeviceViewports(page);
  await verifyOverlaysAtShortViewport(page);
  await verifyCatalogDrawer(page);
  await page.setViewportSize({ height: 900, width: 1000 });
  await verifyOutlineTree(page);
  await verifyResponsivePatterns(page);
  await verifyCoarsePointerBehavior(page);
  process.stdout.write(
    `Verified ${catalogPages.length} accessible catalog pages across ${String(deviceViewports.length)} device viewports, the responsive layout tiers, the compact navigation drawer, the outline tree, short-viewport overlays, and coarse-pointer touch targets.\n`,
  );
} finally {
  await application.close();
}

async function verifyDeviceViewports(page) {
  for (const viewport of deviceViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    for (const catalogPage of catalogPages) {
      await navigateToCatalogPage(page, catalogPage.path);
      const measurement = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        offenders: [...document.querySelectorAll("body *")]
          .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .slice(0, 3)
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}.${element.className}:${element.textContent?.trim().slice(0, 40) ?? ""}`,
          ),
      }));
      assert.ok(
        measurement.overflow <= 1,
        `${catalogPage.title} overflows the ${viewport.label} viewport by ${String(measurement.overflow)}px: ${measurement.offenders.join(", ")}`,
      );
    }
    await verifyShellTier(page, viewport);
  }
}

async function verifyShellTier(page, viewport) {
  await navigateToCatalogPage(page, "templates/product");
  await page.locator('[data-ui="app-shell"]').first().waitFor({ state: "visible" });
  // The product template nests the previewed product shell inside the
  // catalog's own shell; each one must pick the tier its container mandates.
  const shells = await page.evaluate(() =>
    [...document.querySelectorAll('[data-ui="app-shell"]')].map((element) => ({
      visible: [...element.querySelectorAll("[data-layout]")]
        .filter((candidate) => candidate.closest('[data-ui="app-shell"]') === element)
        .filter((candidate) => candidate.checkVisibility())
        .map((candidate) => candidate.dataset.layout),
      width: element.getBoundingClientRect().width,
    })),
  );
  assert.equal(shells.length, 2, `the product template must render the catalog shell and the previewed shell`);
  const { expanded, medium } = tokens.layout.breakpoint;
  for (const shell of shells) {
    const expectedTier = shell.width >= expanded ? "expanded" : shell.width >= medium ? "medium" : "compact";
    assert.deepEqual(
      shell.visible,
      [expectedTier],
      `the ${viewport.label} viewport must show only the ${expectedTier} navigation tier for a ${String(Math.round(shell.width))}px shell container`,
    );
  }
}

async function verifyOverlaysAtShortViewport(page) {
  const viewport = deviceViewports.find((candidate) => candidate.label.startsWith("phone landscape"));
  await page.setViewportSize({ height: viewport.height, width: viewport.width });
  await navigateToCatalogPage(page, "components/overlays");

  await page.getByRole("button", { name: "Open dialog" }).click();
  const dialog = page.locator('[role="dialog"].lode-overlay-popup');
  await dialog.waitFor({ state: "visible" });
  const dialogBox = await dialog.boundingBox();
  assert.ok(dialogBox !== null, "the Dialog must be measurable on a landscape phone");
  assertWithinViewport(dialogBox, viewport, "Dialog");
  const confirm = page.getByRole("button", { name: "Save changes" });
  await confirm.scrollIntoViewIfNeeded();
  assert.equal(await confirm.isVisible(), true, "the Dialog actions must stay reachable on a landscape phone");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });

  await page.getByRole("button", { name: "Show toast" }).click();
  const toast = page.locator('[data-ui="toast"]');
  await toast.waitFor({ state: "visible" });
  const toastBox = await toast.boundingBox();
  assert.ok(toastBox !== null, "the Toast must be measurable on a landscape phone");
  assertWithinViewport(toastBox, viewport, "Toast");
  await toast.locator('[data-ui="toast-close"]').click();
  await toast.waitFor({ state: "detached" });
}

async function verifyCatalogDrawer(page) {
  await page.setViewportSize({ height: 844, width: 390 });
  await navigateToCatalogPage(page, "");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Lode Design System navigation" });
  await drawer.waitFor({ state: "visible" });
  await drawer.getByRole("link", { name: "Buttons" }).click();
  await drawer.waitFor({ state: "detached" });
  await page.locator("main h1").first().waitFor({ state: "visible" });
  assert.equal(
    await page.locator("main h1").first().textContent(),
    "Buttons",
    "selecting a drawer destination must navigate and close the drawer",
  );
}

async function verifyOutlineTree(page) {
  await navigateToCatalogPage(page, "components/outline");
  const tree = page.getByRole("tree");
  await tree.waitFor({ state: "visible" });
  const rowByText = (text) => page.locator('[data-ui="outline-row"]', { hasText: text }).first();
  const editor = page.locator('[data-ui="outline-editor"]');

  const lodeBullet = rowByText("Lode").locator('[data-ui="outline-bullet"]');
  await lodeBullet.hover();
  assert.equal(
    await lodeBullet.evaluate((element) => getComputedStyle(element).cursor),
    "pointer",
    "a clickable bullet must use the pointer cursor before a drag starts",
  );
  assert.match(
    await lodeBullet.getAttribute("class"),
    /hover:bg-secondary/u,
    "a bullet hit target must own the design-system hover halo",
  );

  for (const [label, datatype] of [
    ["Status", "options"],
    ["Owner", "options-from-supertag"],
    ["Review date", "date"],
    ["Ready", "checkbox"],
  ]) {
    assert.equal(
      await rowByText(label)
        .locator(`[data-kind="field"][data-datatype="${datatype}"] [data-ui="outline-field-type-mark"]`)
        .count(),
      1,
      `the ${label} Field node must expose its datatype through the bullet glyph`,
    );
  }
  assert.equal(
    await rowByText("In progress").locator('[data-kind="field-value"] [data-ui="outline-field-type-mark"]').count(),
    0,
    "a Field Value node must keep the ordinary node dot instead of inheriting its Field's type glyph",
  );
  assert.ok(
    (await tree
      .locator('[data-kind="field-definition"][data-datatype="plain"] [data-ui="outline-field-type-mark"]')
      .count()) > 0,
    "a Field Definition occurrence must use the definition glyph inside the normal bullet hit target",
  );
  const ownerField = tree.locator('[data-occurrence-id="owner-field"]');
  assert.equal(await ownerField.getAttribute("aria-expanded"), null, "a Field node must not expose disclosure state");
  assert.equal(
    await ownerField.getByRole("button", { name: /^Expand/u }).count(),
    0,
    "a Field node must not expose the ordinary Node expansion control",
  );
  assert.equal(
    await tree.locator('[data-parent-key="projects/lode/owner-field"][data-layout-column="trailing"]').count(),
    2,
    "the Owner Field must project Kei and Lode team as its two value occurrences",
  );
  assert.equal(
    await tree.locator('[data-parent-key="projects/lode/owner-field"][data-layout-column="single"]').count(),
    0,
    "a Field Value draft must never escape into an extra indented ordinary row",
  );

  const referenceRow = tree.locator('[data-occurrence-id="local-first-reference"]');
  assert.equal(await referenceRow.getAttribute("data-node-id"), "local-first");
  assert.equal(await referenceRow.getAttribute("aria-expanded"), "true");
  assert.equal(
    await referenceRow.locator('[data-kind="reference"] [data-ui="outline-reference-ring"]').count(),
    1,
    "a Reference occurrence must use the ring-and-dot appearance observed in Tana",
  );
  const referenceRingBox = await referenceRow.locator('[data-ui="outline-reference-ring"]').boundingBox();
  const collapsedNodeRingBox = await tree
    .locator('[data-occurrence-id="local-first-original"] [data-ui="outline-bullet-mark"]')
    .boundingBox();
  assert.ok(
    referenceRingBox !== null &&
      collapsedNodeRingBox !== null &&
      Math.abs(referenceRingBox.width - collapsedNodeRingBox.width) <= 1 &&
      Math.abs(referenceRingBox.height - collapsedNodeRingBox.height) <= 1,
    "Reference and collapsed-child bullet rings must share one geometric footprint",
  );
  const referenceChild = tree.locator(
    '[data-parent-key="projects/lode/roadmap/local-first-reference"][data-occurrence-id="local-first-summary"]',
  );
  assert.equal(
    await referenceChild.count(),
    1,
    "an expanded Reference must unfold the target Node's child occurrences",
  );
  assert.equal(
    await referenceChild.locator('[data-kind="node"]').count(),
    1,
    "a child unfolded through a Reference keeps its own occurrence appearance",
  );

  const fieldLabelBox = await rowByText("Status").boundingBox();
  const firstValueBox = await rowByText("In progress").boundingBox();
  const firstOwnerBox = await page
    .locator('[data-ui="outline-row"][data-layout-column="trailing"]', { hasText: "Kei" })
    .first()
    .boundingBox();
  const secondOwnerBox = await page
    .locator('[data-ui="outline-row"][data-layout-column="trailing"]', { hasText: "Lode team" })
    .first()
    .boundingBox();
  assert.ok(fieldLabelBox !== null && firstValueBox !== null, "Field and Field Value rows must be measurable");
  assert.ok(fieldLabelBox.width <= 260, "the Field label column must stay close to Tana's compact value offset");
  assert.equal(
    await tree
      .locator('[data-occurrence-id="in-progress"]')
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

  const lodeEditingRow = tree.locator('[data-occurrence-id="lode"]');
  await lodeEditingRow.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  const lodeEditingBackground = await lodeEditingRow.evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.equal(
    lodeEditingBackground,
    "rgba(0, 0, 0, 0)",
    "editing one Node must not paint the full-width multi-selection background",
  );
  const editorBox = await editor.boundingBox();
  const supertagBox = await lodeEditingRow.locator('[data-ui="outline-row-badge"]').boundingBox();
  assert.ok(
    editorBox !== null && supertagBox !== null && Math.abs(editorBox.y - supertagBox.y) <= 2,
    "Supertags must remain inline beside the Node editor",
  );
  await editor.press("Escape");
  await editor.waitFor({ state: "detached" });

  const statusValue = tree.locator('[data-occurrence-id="in-progress"]');
  await statusValue.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  const suggestions = page.getByRole("listbox", { name: "Suggested values" });
  assert.equal(await suggestions.count(), 0, "focusing an existing Options value must leave Enter available to insert");
  await editor.press("Control+A");
  await editor.pressSequentially("I");
  await suggestions.waitFor({ state: "visible" });
  assert.equal(
    await suggestions.getByRole("option", { name: "In progress" }).count(),
    1,
    "an Options datatype provides candidates inside the ordinary Node editor",
  );
  await editor.press("Control+A");
  await editor.pressSequentially("Custom status");
  assert.equal(await editor.textContent(), "Custom status", "datatype suggestions must not reject arbitrary Node text");
  await tree.locator('[data-occurrence-id="review-date-field"]').click();
  await suggestions.waitFor({ state: "detached" });
  await editor.waitFor({ state: "detached" });
  assert.notEqual(
    await statusValue.getAttribute("data-node-id"),
    "status-in-progress",
    "free text in a Reference-backed Field Value must become a new ordinary Node instead of renaming its target",
  );
  await statusValue.locator('[data-ui="outline-row-text"]').click();
  assert.equal(await suggestions.count(), 0, "an existing arbitrary value reopens as an ordinary Node editor");
  await editor.press("Enter");
  const statusValues = tree.locator('[data-parent-key="projects/lode/status-field"][data-layout-column="trailing"]');
  await statusValues.nth(1).waitFor({ state: "visible" });
  await editor.pressSequentially("Another status value");
  const insertedEditorBox = await editor.boundingBox();
  assert.ok(
    insertedEditorBox !== null && insertedEditorBox.width >= 96 && insertedEditorBox.height < 40,
    "a newly inserted Node editor must keep a usable horizontal line box",
  );
  if (await suggestions.isVisible()) {
    await editor.press("Escape");
  }
  await editor.press("Escape");
  await editor.waitFor({ state: "detached" });

  const fieldDefinition = tree.locator('[data-occurrence-id="status-definition-occurrence"]');
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

  const lodeTeam = tree.locator('[data-occurrence-id="team-owner"]');
  await lodeTeam.getByRole("button", { name: "Expand lode-team" }).click();
  const lodeTeamPlaceholder = tree.locator(
    '[data-ui="outline-empty-child-placeholder"][data-parent-key="projects/lode/owner-field/team-owner"]',
  );
  await lodeTeamPlaceholder.waitFor({ state: "visible" });
  assert.equal(
    await lodeTeamPlaceholder.getAttribute("data-layout-column"),
    "trailing",
    "an empty-child placeholder under a Field Value must remain in the value column",
  );
  const lodeTeamBulletBox = await lodeTeam.locator('[data-ui="outline-bullet"]').boundingBox();
  const lodeTeamChildBulletBox = await lodeTeamPlaceholder.locator('[data-ui="outline-bullet-mark"]').boundingBox();
  assert.ok(
    lodeTeamBulletBox !== null && lodeTeamChildBulletBox !== null && lodeTeamChildBulletBox.x > lodeTeamBulletBox.x,
    "an empty-child placeholder must indent locally from its Field Value parent",
  );
  assert.equal(
    await tree.locator('[data-parent-key="projects/lode/owner-field/team-owner"][data-ui="outline-row"]').count(),
    0,
    "expanding an empty Node must not materialize a model Node",
  );
  assert.equal(await lodeTeamPlaceholder.locator('[data-ui="outline-placeholder-bullet"]').count(), 1);
  assert.doesNotMatch(
    (await lodeTeamPlaceholder.textContent()) ?? "",
    /Type \/ for commands/u,
    "an unfocused empty-child placeholder keeps Tana's quiet bullet-only appearance",
  );

  await tree.getByRole("button", { name: "Expand empty-container" }).click();
  const emptyChildPlaceholder = tree.locator(
    '[data-ui="outline-empty-child-placeholder"][data-parent-key="projects/lode/roadmap/empty-container"]',
  );
  await emptyChildPlaceholder.waitFor({ state: "visible" });
  assert.equal(await emptyChildPlaceholder.getAttribute("data-level"), "5");
  assert.equal(
    await emptyChildPlaceholder.locator('[data-ui="outline-placeholder-bullet"]').count(),
    1,
    "expanding an empty Node must project Tana's empty-child placeholder without changing the model",
  );
  const inactivePlaceholderBox = await emptyChildPlaceholder.boundingBox();
  await emptyChildPlaceholder.click();
  const emptyChild = tree.locator('[data-ui="outline-row"][data-parent-key="projects/lode/roadmap/empty-container"]');
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
  await editor.press("Escape");
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
    "a parent with a real empty child must not also project the no-child placeholder",
  );
  await emptyChild.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("Enter");
  const emptyChildren = tree.locator(
    '[data-ui="outline-row"][data-parent-key="projects/lode/roadmap/empty-container"]',
  );
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
  await editor.press("Escape");
  await editor.waitFor({ state: "detached" });
  assert.equal(await emptyChildren.count(), 2, "the next empty Node must also survive an unfocused state");
  await rowByText("Status").click();
  await rowByText("Owner").click({ modifiers: ["Shift"] });
  await page.getByRole("toolbar", { name: "4 nodes selected" }).waitFor({ state: "visible" });
  assert.equal(
    await tree.locator('[data-ui="outline-row"][aria-selected="true"]').count(),
    4,
    "Shift selection must include every visible Node occurrence in the range",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("toolbar", { name: "4 nodes selected" }).waitFor({ state: "detached" });

  assert.equal(
    await rowByText("Open design decisions").locator('[data-kind="search"]').count(),
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
      searchBulletBox.width >= 13 &&
      searchBulletBox.height >= 13 &&
      searchMarkBox.width < searchBulletBox.width &&
      searchMarkBox.height < searchBulletBox.height,
    "the Search glyph must remain inside the shared outer bullet footprint reserved for occurrence state",
  );
  assert.equal(
    await rowByText("Daily notes").locator('[data-kind="calendar"]').count(),
    1,
    "a date-backed system node must support a semantic bullet replacement",
  );
  assert.equal(
    await page.locator('[data-ui="outline-row"] [data-kind="person"]').count(),
    1,
    "a person node must support an avatar bullet replacement",
  );
  await rowByText("Open design decisions").locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("Escape");
  await tree.locator('[data-occurrence-id="kei"] [data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("Escape");
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

  const originalRow = tree.locator('[data-occurrence-id="local-first-original"]');
  await referenceRow.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("End");
  await editor.pressSequentially("!");
  await originalRow.locator('[data-ui="outline-inline-content"]', { hasText: "Local-first software essay!" }).waitFor({
    state: "visible",
  });
  assert.equal(await editor.count(), 1, "a Reference edit must update its Original while the editor remains focused");
  await editor.press("Backspace");
  await editor.press("Escape");
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
  await editor.press("Escape");
  await editor.waitFor({ state: "detached" });

  await referenceChild.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("End");
  await editor.press("Enter");
  await editor.pressSequentially("Shared through reference");
  await editor.press("Escape");
  await editor.waitFor({ state: "detached" });
  await tree
    .locator('[data-parent-key="projects/lode/roadmap/local-first-reference"]', { hasText: "Shared through reference" })
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
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await rowByText("Projects").getAttribute("aria-expanded"),
    "false",
    "ArrowLeft must collapse the cursor row",
  );
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await rowByText("Projects").getAttribute("aria-expanded"),
    "true",
    "ArrowRight must expand the cursor row",
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

  // Remount for a clean editing session.
  await navigateToCatalogPage(page, "components/buttons");
  await navigateToCatalogPage(page, "components/outline");
  const editorText = () => editor.textContent();
  const setEditorCaret = (offset) =>
    editor.evaluate((element, caret) => element.editor.commands.setTextSelection(caret + 1), offset);
  const homeLabText = rowByText("Home lab notes").locator('[data-ui="outline-inline-content"]');
  const clickedCaret = 4;
  await homeLabText.scrollIntoViewIfNeeded();
  const clickPoint = await homeLabText.evaluate((element, caret) => {
    const text = element.firstChild;
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
  assert.equal(
    await editor.evaluate((input) => input.closest('[data-ui="outline-row"]')?.getAttribute("aria-level")),
    "3",
    "Tab in edit mode must indent the row and keep its editor active",
  );
  assert.equal(await editorText(), "Home lab notes", "a structural edit must preserve the editor draft");
  await editor.press("Escape");
  await editor.waitFor({ state: "detached" });

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
  assert.equal(
    await editorText(),
    "Engine facts and projections editedsupporting detail",
    "a soft line break must keep both lines inside one edited node",
  );
  assert.equal(await editor.locator("br").count(), 1, "Shift+Enter must render a semantic soft line break");
  await editor.press("Escape");
  await editor.waitFor({ state: "detached" });
  await rowByText("Engine facts and projections edited").waitFor({ state: "visible" });

  await rowByText("CRDT ordering survey").locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("End");
  await editor.pressSequentially("[[");
  const referencePicker = page.getByRole("listbox", { name: "References" });
  await referencePicker.waitFor({ state: "visible" });
  await referencePicker.getByRole("option", { name: "Local-first software essay" }).click();
  const editedRow = editor.locator('xpath=ancestor::*[@data-ui="outline-row"]');
  await editedRow.locator('[data-ui="outline-reference"]', { hasText: "Local-first software essay" }).waitFor({
    state: "visible",
  });
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
  await editor.press("Escape");
  await editor.waitFor({ state: "detached" });
  await rowByText("CRDT ordering survey")
    .locator('[data-ui="outline-reference"]', { hasText: "Local-first software essay" })
    .waitFor({ state: "visible" });

  const quickCapture = tree.locator('[data-occurrence-id="quick-capture"]');
  assert.equal(
    await quickCapture.locator('[data-ui="outline-placeholder-bullet"]').count(),
    0,
    "a real empty Node must not inherit the synthetic placeholder bullet",
  );
  await quickCapture.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.press("Escape");
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
  await editor.press("Escape");
  await editor.waitFor({ state: "detached" });

  // A field is selected through the editor, but the resulting Field and Field Value remain distinct Node rows.
  await navigateToCatalogPage(page, "components/buttons");
  await navigateToCatalogPage(page, "components/outline");
  await page.getByRole("tree").focus();
  await page.keyboard.press("End");
  await tree.locator('[data-occurrence-id="quick-capture"] [data-ui="outline-row-text"]').click();
  await editor.waitFor({ state: "visible" });
  await editor.pressSequentially(">");
  const fieldPicker = page.getByRole("listbox", { name: "Fields" });
  await fieldPicker.waitFor({ state: "visible" });
  await fieldPicker.getByRole("option", { name: "Notes" }).click();
  await editor.waitFor({ state: "detached" });
  await page.getByRole("tree").focus();
  await page.keyboard.press("End");
  const createdField = page
    .locator('[data-ui="outline-row"][data-layout-column="leading"]', { hasText: "Notes" })
    .first();
  const createdValue = page.locator('[data-ui="outline-row"][data-layout-column="trailing"]').last();
  await page.waitForTimeout(200);
  const createdRows = await page
    .locator('[data-ui="outline-row"]')
    .evaluateAll((rows) => rows.map((row) => ({ layout: row.dataset.layoutColumn, text: row.textContent })));
  assert.equal(
    await createdField.count(),
    1,
    `choosing a definition must create a Field Node: ${JSON.stringify(createdRows)}`,
  );
  assert.ok(
    await createdValue.count(),
    `choosing a definition must create a Field Value Node: ${JSON.stringify(createdRows)}`,
  );
  const createdFieldBox = await createdField.boundingBox();
  const createdValueBox = await createdValue.boundingBox();
  assert.ok(createdFieldBox !== null && createdValueBox !== null, "created Field nodes must be measurable");
  assert.ok(
    Math.abs(createdFieldBox.y - createdValueBox.y) <= 1,
    `a newly created Field and its first Field Value Node must share one visual line: ${JSON.stringify({ createdFieldBox, createdValueBox })}`,
  );

  // Remount for a clean structure, then restructure by dragging a bullet.
  await navigateToCatalogPage(page, "components/buttons");
  await navigateToCatalogPage(page, "components/outline");
  const lodeRow = page.locator('[data-ui="outline-row"][data-occurrence-id="lode"]');
  await lodeRow.getByRole("button", { name: "Collapse lode" }).click();
  const handle = rowByText("Home lab notes").locator('[data-ui="outline-bullet"]');
  await handle.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  const lodeBox = await lodeRow.boundingBox();
  const treeBox = await page.getByRole("tree").boundingBox();
  assert.ok(handleBox !== null && lodeBox !== null && treeBox !== null, "drag geometry must be measurable");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(treeBox.x + 30, lodeBox.y + 3, { steps: 10 });
  const indicator = await page.evaluate(() => document.querySelector('[role="tree"] .bg-primary.h-0\\.5') !== null);
  assert.equal(indicator, true, "an eligible drop position must show the insertion line");
  await page.mouse.up();
  const moved = rowByText("Home lab notes");
  assert.equal(await moved.getAttribute("aria-level"), "2", "the dragged row must land under Projects");
  assert.equal(await moved.getAttribute("aria-posinset"), "1", "the dragged row must land before Lode");

  // Dropping a subtree into its own descendant must be rejected.
  const projectsHandle = rowByText("Projects").locator('[data-ui="outline-bullet"]');
  await projectsHandle.scrollIntoViewIfNeeded();
  const projectsBox = await projectsHandle.boundingBox();
  const roadmapBox = await rowByText("Design system roadmap").boundingBox();
  assert.ok(projectsBox !== null && roadmapBox !== null, "illegal-drop geometry must be measurable");
  await page.mouse.move(projectsBox.x + projectsBox.width / 2, projectsBox.y + projectsBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(roadmapBox.x + roadmapBox.width / 2, roadmapBox.y + roadmapBox.height - 3, { steps: 10 });
  await page.mouse.up();
  assert.equal(
    await rowByText("Projects").getAttribute("aria-level"),
    "1",
    "a subtree must never move into its own descendants",
  );
}

function assertWithinViewport(box, viewport, label) {
  const fits =
    box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  assert.ok(
    fits,
    `${label} must fit inside the ${viewport.label} viewport; got ${String(Math.round(box.width))}×${String(Math.round(box.height))} at (${String(Math.round(box.x))}, ${String(Math.round(box.y))})`,
  );
}

async function verifyResponsivePatterns(page) {
  await page.evaluate(() => {
    window.location.hash = "#/design-system/templates/product";
  });
  const shell = page.locator('main [data-ui="app-shell"]');
  await shell.waitFor({ state: "visible" });
  for (const [width, expected] of [
    [500, "compact"],
    [700, "medium"],
    [900, "expanded"],
  ]) {
    await shell.evaluate((element, nextWidth) => {
      element.style.width = `${nextWidth}px`;
    }, width);
    await shell.locator(`[data-layout="${expected}"]`).waitFor({ state: "visible" });
    const visibleTiers = await shell.locator("[data-layout]:visible").count();
    assert.equal(visibleTiers, 1, `${String(width)}px must expose only the ${expected} navigation tier`);
  }

  await page.evaluate(() => {
    window.location.hash = "#/design-system/templates/layouts";
  });
  const pattern = page.locator('[data-ui="list-detail"]');
  await pattern.waitFor({ state: "visible" });
  await pattern.evaluate((element) => {
    element.style.width = "500px";
  });
  await pattern.locator('[data-pane="list"]').waitFor({ state: "visible" });
  assert.equal(await pattern.locator('[data-pane="detail"]').isVisible(), false);
  await pattern.getByRole("button", { name: /Field notes/u }).click();
  await pattern.locator('[data-pane="detail"]').waitFor({ state: "visible" });
  assert.equal(await pattern.locator('[data-pane="list"]').isVisible(), false);
  await pattern.getByRole("button", { name: "← Back to list" }).click();
  await pattern.locator('[data-pane="list"]').waitFor({ state: "visible" });
  await pattern.evaluate((element) => {
    element.style.width = "900px";
  });
  await pattern.locator('[data-pane="detail"]').waitFor({ state: "visible" });
  assert.equal(await pattern.locator('[data-pane="list"]').isVisible(), true);
}

async function verifyCoarsePointerBehavior(page) {
  await navigateToCatalogPage(page, "components/overlays");
  await page.getByRole("button", { name: "Show actionable toast" }).click();
  const fineToast = await measureToast(page);
  await dismissToast(page);

  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  try {
    assert.equal(
      await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches),
      true,
      "the touch verification pass must activate (pointer: coarse)",
    );
    const target = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lode-control-hit-target")),
    );
    assert.equal(target, 48, "the touch target token must resolve to 48px");

    for (const catalogPage of catalogPages) {
      await navigateToCatalogPage(page, catalogPage.path);
      await assertVisibleTouchTargets(page, target, catalogPage.title);
    }

    await navigateToCatalogPage(page, "components/forms");
    const switchControl = page.getByRole("switch").first();
    const switchGeometry = await measureTouchTarget(switchControl);
    assert.equal(switchGeometry.visualHeight, 24, "the visible Switch pill must remain 24px tall");
    assertEffectiveTouchTarget(switchGeometry, target, "Switch");
    await assertExpandedHitArea(page, switchControl, target, "Switch");

    const input = page.locator('input[name="workspace"]');
    await input.scrollIntoViewIfNeeded();
    const inputHitArea = input.locator('xpath=parent::*[@data-ui="input-hit-area"]');
    const inputBox = await input.boundingBox();
    const inputHitBox = await inputHitArea.boundingBox();
    assert.ok(inputBox !== null && inputHitBox !== null, "the Input and its touch wrapper must be visible");
    assert.equal(inputBox.height, 40, "the visible Input must remain 40px tall");
    assert.ok(inputHitBox.height >= target, "the Input wrapper must expose the touch target height");
    await page.mouse.click(inputHitBox.x + inputHitBox.width / 2, inputHitBox.y + 2);
    assert.equal(await input.evaluate((element) => document.activeElement === element), true);

    await navigateToCatalogPage(page, "components/buttons");
    const smallButton = page.getByRole("button", { name: "Size sm" });
    const buttonGeometry = await measureTouchTarget(smallButton);
    assert.equal(buttonGeometry.visualHeight, 32, "the visible small Button must remain 32px tall");
    assertEffectiveTouchTarget(buttonGeometry, target, "small Button");
    await assertExpandedHitArea(page, smallButton, target, "small Button");

    await navigateToCatalogPage(page, "components/overlays");
    await page.getByRole("button", { name: "Show actionable toast" }).click();
    const coarseToast = await measureToast(page);
    assertGeometryEqual(coarseToast, fineToast, "Toast layout must not change under a coarse pointer");
    const closeButton = page.locator('[data-ui="toast-close"]');
    const closeGeometry = await measureTouchTarget(closeButton);
    assert.equal(closeGeometry.visualHeight, 28, "the visible Toast close button must remain 28px tall");
    assertEffectiveTouchTarget(closeGeometry, target, "Toast close button");
    await assertExpandedHitArea(page, closeButton, target, "Toast close button");
    await dismissToast(page);
  } finally {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await session.detach();
  }
}

async function navigateToCatalogPage(page, path) {
  await page.evaluate(
    (hash) => {
      window.location.hash = hash;
    },
    path === "" ? "#/design-system" : `#/design-system/${path}`,
  );
  await page.locator("main h1").first().waitFor({ state: "visible" });
}

async function assertVisibleTouchTargets(page, target, title) {
  const offenders = await page.evaluate((minimum) => {
    const selector =
      'button:not([disabled]), input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]), textarea:not([disabled]), a[href], [role="menuitem"]:not([aria-disabled="true"]), [role="switch"]:not([disabled])';
    return [...document.querySelectorAll(selector)].flatMap((element) => {
      const rectangle = element.getBoundingClientRect();
      // Form-serialization inputs render at 1×1; nothing at or below that
      // size is a real pointer target.
      if (rectangle.width <= 1 || rectangle.height <= 1) {
        return [];
      }
      const inputArea = element.matches("input") ? element.parentElement?.closest('[data-ui="input-hit-area"]') : null;
      const areaRectangle = inputArea?.getBoundingClientRect();
      const pseudo = getComputedStyle(element, "::after");
      const effectiveWidth = areaRectangle?.width ?? Math.max(rectangle.width, Number.parseFloat(pseudo.width) || 0);
      const effectiveHeight =
        areaRectangle?.height ?? Math.max(rectangle.height, Number.parseFloat(pseudo.height) || 0);
      return effectiveWidth + 0.01 < minimum || effectiveHeight + 0.01 < minimum
        ? [
            `${element.tagName.toLowerCase()}[${element.getAttribute("aria-label") ?? element.textContent?.trim() ?? ""}] ${effectiveWidth}x${effectiveHeight}`,
          ]
        : [];
    });
  }, target);
  assert.deepEqual(offenders, [], `${title} contains undersized coarse-pointer targets: ${offenders.join(", ")}`);
}

async function measureTouchTarget(locator) {
  return locator.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    const pseudo = getComputedStyle(element, "::after");
    return {
      effectiveHeight: Math.max(rectangle.height, Number.parseFloat(pseudo.height) || 0),
      effectiveWidth: Math.max(rectangle.width, Number.parseFloat(pseudo.width) || 0),
      visualHeight: rectangle.height,
      visualWidth: rectangle.width,
    };
  });
}

function assertEffectiveTouchTarget(geometry, target, label) {
  assert.ok(geometry.effectiveHeight >= target, `${label} must expose at least ${String(target)}px of touch height`);
  assert.ok(geometry.effectiveWidth >= target, `${label} must expose at least ${String(target)}px of touch width`);
}

async function assertExpandedHitArea(page, locator, target, label) {
  await locator.scrollIntoViewIfNeeded();
  const point = await locator.evaluate((element, minimum) => {
    const rectangle = element.getBoundingClientRect();
    const expansion = (minimum - rectangle.height) / 2;
    const x = rectangle.left + rectangle.width / 2;
    const y = rectangle.top - Math.min(4, expansion / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      hit: hit?.outerHTML.slice(0, 200) ?? "nothing",
      owned: hit === element || element.contains(hit),
      x,
      y,
    };
  }, target);
  assert.equal(point.owned, true, `${label} must receive hits outside its visible box; hit ${point.hit}`);
  await page.mouse.move(point.x, point.y);
}

async function measureToast(page) {
  const toast = page.locator('[data-ui="toast"]');
  await toast.waitFor({ state: "visible" });
  const content = toast.locator('[data-ui="toast-content"]');
  const close = toast.locator('[data-ui="toast-close"]');
  const [toastBox, contentBox, closeBox] = await Promise.all([
    toast.boundingBox(),
    content.boundingBox(),
    close.boundingBox(),
  ]);
  assert.ok(toastBox !== null && contentBox !== null && closeBox !== null, "the Toast geometry must be measurable");
  return {
    closeHeight: closeBox.height,
    closeWidth: closeBox.width,
    contentHeight: contentBox.height,
    contentWidth: contentBox.width,
    toastHeight: toastBox.height,
    toastWidth: toastBox.width,
  };
}

function assertGeometryEqual(actual, expected, message) {
  for (const key of Object.keys(expected)) {
    assert.ok(Math.abs(actual[key] - expected[key]) <= 0.01, `${message}: ${key} changed`);
  }
}

async function dismissToast(page) {
  const toast = page.locator('[data-ui="toast"]');
  await toast.locator('[data-ui="toast-close"]').click();
  await toast.waitFor({ state: "detached" });
}
