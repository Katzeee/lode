import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

export async function verifyNodeEditing(page, client, workspaceId, actorId) {
  const artifacts = process.env.LODE_VERIFICATION_ARTIFACTS;
  const screenshot = async (name) => {
    if (!artifacts) {
      return;
    }
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: resolve(artifacts, name + ".png") });
  };
  await page.setViewportSize({ width: 1280, height: 850 });
  const end = { after: null, before: null, affinity: "after", fallback: "end" };
  const write = async (actions) => {
    const result = await client.execute({
      kind: "edit",
      workspaceId,
      actorId,
      invocationId: crypto.randomUUID(),
      historyChannelId: "baseline-setup",
      intent: "direct",
      actions,
    });
    assert.equal(result.status, "published", JSON.stringify(result));
  };
  const read = async (section) => {
    const result = await client.query({ kind: "projection", workspaceId, perspective: "origin", section, limit: 100 });
    assert.equal(result.status, "ok");
    return result.value[section];
  };
  const text = (node) => node.content.map((part) => (part.kind === "text" ? part.value : "@")).join("");
  const row = (path) => page.locator(`[data-ui="outline-row"][data-item-key=${JSON.stringify(JSON.stringify(path))}]`);
  const editor = () => page.locator('[data-ui="outline-editor"]');
  const saved = () => page.getByText("Saved locally", { exact: true }).waitFor({ state: "attached" });
  await write([
    {
      kind: "node-create",
      nodeId: "editing-lab",
      occurrenceId: "editing-lab-occ",
      parentNodeId: workspaceId,
      anchor: end,
      seed: { text: [{ value: "Editor baseline", attributes: {} }] },
    },
  ]);
  await row(["editing-lab-occ"]).getByRole("button", { name: "Activate Editor baseline" }).click();
  await page.getByRole("heading", { name: "Editor baseline", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Add node", exact: true }).count(), 0);
  assert.equal((await read("childOccurrences"))["editing-lab"]?.length ?? 0, 0);
  await page.getByRole("button", { name: "Create node", exact: true }).click();
  await editor().pressSequentially("Alpha Beta");
  await editor().press("Home");
  for (let index = 0; index < 6; index += 1) {
    await editor().press("ArrowRight");
  }
  await editor().press("Enter");
  await page.getByRole("textbox", { name: "Edit Beta", exact: true }).waitFor();
  assert.equal(await editor().textContent(), "Beta");
  await editor().press("Backspace");
  await page.getByRole("textbox", { name: /Edit Alpha/ }).waitFor();
  assert.equal(await editor().textContent(), "Alpha Beta");
  await editor().press("End");
  await editor().pressSequentially("!");
  await page.getByRole("heading", { name: "Editor baseline", exact: true }).click();
  await saved();
  let nodes = await read("nodes"),
    occurrences = await read("occurrences");
  const children = (await read("childOccurrences"))["editing-lab"];
  const alphaOccurrenceId = children.find((id) => text(nodes[occurrences[id].nodeId]) === "Alpha Beta!");
  assert.ok(alphaOccurrenceId, "split, merge and continuing input preserve the whole name");
  const alphaNodeId = occurrences[alphaOccurrenceId].nodeId;

  await write([
    {
      kind: "node-create",
      nodeId: "mirror",
      occurrenceId: "mirror-occ",
      parentNodeId: "editing-lab",
      anchor: end,
      seed: { text: [{ value: "Mirror context", attributes: {} }] },
    },
    {
      kind: "occurrence-create",
      nodeId: alphaNodeId,
      occurrenceId: "alpha-reference",
      parentNodeId: "mirror",
      anchor: end,
    },
    {
      kind: "node-create",
      nodeId: "baseline-field",
      occurrenceId: "baseline-field-occ",
      parentNodeId: workspaceId,
      anchor: end,
      intrinsicNodeType: "field-definition",
      seed: { text: [{ value: "Alignment value", attributes: {} }] },
    },
    { kind: "field-materialize", ownerNodeId: "mirror", fieldDefinitionId: "baseline-field" },
  ]);
  const field = (await read("materializedFields")).mirror[0];
  await write([
    {
      kind: "occurrence-create",
      nodeId: alphaNodeId,
      occurrenceId: "alpha-value-reference",
      parentNodeId: field.fieldNodeId,
      anchor: end,
    },
  ]);
  await row(["mirror-occ"])
    .getByRole("button", { name: /^Expand / })
    .click();
  const reference = row(["mirror-occ", "alpha-reference"]).locator('[data-ui="outline-row-text"]');
  await reference.click();
  assert.equal(await editor().count(), 0, "single click focuses the object without entering its name");
  await reference.dblclick();
  await editor().press("End");
  await editor().pressSequentially("?");
  await editor().press("Enter");
  await editor().waitFor({ state: "detached" });
  await saved();
  assert.equal(text((await read("nodes"))[alphaNodeId]), "Alpha Beta!?");
  assert.equal((await read("childOccurrences")).mirror.filter((id) => id === "alpha-reference").length, 1);

  const value = row(["mirror-occ", field.fieldOccurrenceId, "alpha-value-reference"]).locator(
    '[data-ui="outline-row-text"]',
  );
  await value.dblclick();
  await editor().press("End");
  await editor().pressSequentially(" Shared");
  await editor().press("Home");
  await editor().press("Backspace");
  await page.getByRole("heading", { name: "Editor baseline", exact: true }).click();
  await saved();
  assert.equal(text((await read("nodes"))[alphaNodeId]), "Alpha Beta!? Shared");
  assert.equal(
    text((await read("nodes"))["baseline-field"]),
    "Alignment value",
    "the value never merges into the field label",
  );
  await row(["mirror-occ", field.fieldOccurrenceId]).locator('[data-ui="outline-row-text"]').dblclick();
  assert.equal(await editor().count(), 0, "a borrowed definition name remains protected");

  await row(["mirror-occ"]).locator('[data-ui="outline-row-text"]').click();
  await editor().press("End");
  await editor().press("Enter");
  await page.getByRole("textbox", { name: "Edit Empty node", exact: true }).waitFor();
  await editor().pressSequentially("First child");
  await page.getByRole("heading", { name: "Editor baseline", exact: true }).click();
  await saved();
  nodes = await read("nodes");
  occurrences = await read("occurrences");
  const firstId = (await read("childOccurrences")).mirror[0];
  assert.equal(text(nodes[occurrences[firstId].nodeId]), "First child");

  await row(["mirror-occ"]).locator('[data-ui="outline-row-text"]').click();
  await editor().press("End");
  await editor().press("Shift+Enter");
  await page.getByRole("textbox", { name: "Edit Empty node", exact: true }).waitFor();
  await editor().pressSequentially("Gamma");
  await page.getByRole("heading", { name: "Editor baseline", exact: true }).click();
  await saved();
  const gamma = Object.values(await read("nodes")).find((node) => text(node) === "Gamma");
  const gammaOccurrence = Object.values(await read("occurrences")).find((item) => item.nodeId === gamma.nodeId);
  await row([gammaOccurrence.occurrenceId]).locator('[data-ui="outline-row-text"]').click();
  await editor().press("Home");
  await editor().press("Backspace");
  await page.getByRole("heading", { name: "Editor baseline", exact: true }).click();
  await saved();
  assert.equal(
    text((await read("nodes")).mirror),
    "Mirror contextGamma",
    "merge skips expanded descendants and targets the previous sibling",
  );
  assert.equal(text((await read("nodes"))[alphaNodeId]), "Alpha Beta!? Shared");
  await row(["mirror-occ"]).locator('[data-ui="outline-row-text"]').click();
  await editor().press("Control+z");
  await saved();
  assert.equal(text((await read("nodes")).mirror), "Mirror context");
  assert.ok((await read("occurrences"))[gammaOccurrence.occurrenceId]);

  await row(["mirror-occ"]).locator('[data-ui="outline-row-text"]').click();
  await editor().press("Escape");
  const toolbar = page.getByRole("toolbar");
  await toolbar.waitFor();
  assert.equal(await toolbar.getByText(/selected/).count(), 0);
  assert.equal(await toolbar.getByRole("button", { name: "More commands" }).count(), 1);
  assert.equal(
    await row(["mirror-occ", field.fieldOccurrenceId, "alpha-value-reference"]).getAttribute("aria-selected"),
    "true",
  );
  await screenshot("lode-selection-desktop");
  await toolbar.getByRole("button", { name: "More commands" }).click();
  await page.getByRole("menuitem", { name: "Move down", exact: true }).waitFor();
  assert.equal(
    await row(["mirror-occ", field.fieldOccurrenceId, "alpha-value-reference"]).getAttribute("aria-selected"),
    "true",
    "opening a portal command menu keeps the subtree selection",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { name: "Editor baseline", exact: true }).click();
  const fieldRow = row(["mirror-occ", field.fieldOccurrenceId]);
  const labelBox = await fieldRow.boundingBox(),
    valueBox = await value.boundingBox();
  assert.ok(
    Math.abs(labelBox.y - valueBox.y) < 8 && valueBox.x > labelBox.x + 150,
    "wide fields keep names and values on the same line",
  );
  await screenshot("lode-document-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  const narrowLabel = await fieldRow.boundingBox(),
    narrowValue = await value.boundingBox();
  assert.ok(
    narrowValue.y >= narrowLabel.y + narrowLabel.height - 1,
    "field values stack when their container has insufficient width",
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await screenshot("lode-document-narrow");
  await page.setViewportSize({ width: 1280, height: 850 });
  const orderBeforeClear = (await read("childOccurrences")).mirror;
  await reference.click();
  await page.getByRole("tree", { name: "Workspace nodes" }).press("Backspace");
  await page.getByRole("textbox", { name: "Edit Empty node", exact: true }).waitFor();
  await saved();
  assert.equal(await reference.count(), 0, "clearing a focused reference removes only this appearance");
  assert.equal(text((await read("nodes"))[alphaNodeId]), "Alpha Beta!? Shared");
  assert.equal(await value.textContent(), "Alpha Beta!? Shared");
  await editor().press("Control+z");
  await reference.waitFor();
  await saved();
  assert.equal(await editor().count(), 0, "undo restores reference object focus");
  assert.deepEqual(
    (await read("childOccurrences")).mirror,
    orderBeforeClear,
    "undo restores the appearance between the same siblings",
  );
  await row([alphaOccurrenceId]).locator('[data-ui="outline-row-text"]').click();
  await editor().press("Control+a");
  await editor().pressSequentially("**Alpha** Beta!? Shared");
  assert.equal(await editor().textContent(), "**Alpha** Beta!? Shared", "active names expose formatting source");
  assert.equal(
    await value.locator("strong").textContent(),
    "Alpha",
    "all other appearances render the shared source draft",
  );
  await screenshot("lode-source-editing");
  await page.getByRole("heading", { name: "Editor baseline", exact: true }).click();
  await saved();
  assert.equal(await row([alphaOccurrenceId]).locator("strong").textContent(), "Alpha");
  await screenshot("lode-document-desktop");

  await page.getByRole("heading", { name: "Editor baseline", exact: true }).click();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "Shared workspace" }).click();
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
}
