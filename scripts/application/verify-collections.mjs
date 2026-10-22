import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function verifyCollections(page, client, workspaceId, actorId) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const anchor = { after: null, before: null, affinity: "after", fallback: "end" };
  const write = async (actions) => {
    const result = await client.execute({
      kind: "edit",
      workspaceId,
      actorId,
      invocationId: crypto.randomUUID(),
      historyChannelId: "collection-setup",
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
  const seed = (nodeId, parentNodeId, value, intrinsicNodeType) => ({
    kind: "node-create",
    nodeId,
    parentNodeId,
    occurrenceId: `${nodeId}-occ`,
    intrinsicNodeType,
    anchor,
    seed: { text: [{ value, attributes: {} }] },
  });
  await write([
    seed("collection-lab", workspaceId, "Collection lab"),
    seed("collection-row", "collection-lab", "Collection row"),
    seed("collection-field", workspaceId, "Collection field", "field-definition"),
    seed("collection-tag", workspaceId, "Collection tag", "supertag-definition"),
  ]);
  const route = (nodeId) => `${new URL(page.url()).origin}/#/workspace/${workspaceId}/node/${nodeId}`;
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
  const saved = () => page.getByText("Saved locally", { exact: true }).waitFor();
  const blur = () => page.locator('[data-ui="document-navigation"]').click({ position: { x: 4, y: 4 } });
  await page.goto(route("collection-lab"));
  await page.getByRole("button", { name: "Shared view · Outline" }).click();
  await page.getByRole("menuitem", { name: "Table", exact: true }).click();
  await page.getByRole("table", { name: "Node table" }).waitFor();
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  await page.getByRole("menuitem", { name: "Show Collection field", exact: true }).click();
  const table = () => page.getByRole("table", { name: "Node table" });
  const valueCell = () => table().locator("tbody tr").first().locator("td").nth(1);
  await valueCell().getByRole("button", { name: "Create node", exact: true }).click();
  await editor().waitFor();
  assert.equal(
    (await read("materializedFields"))["collection-row"]?.length ?? 0,
    0,
    "cell focus creates no Field or value",
  );
  await blur();
  await saved();
  assert.equal((await read("materializedFields"))["collection-row"]?.length ?? 0, 0);
  await valueCell().getByRole("button", { name: "Create node", exact: true }).click();
  await editor().pressSequentially("Alpha");
  await editor().press("Enter");
  await editor().pressSequentially("Beta");
  await blur();
  await saved();
  let field = (await read("materializedFields"))["collection-row"][0];
  assert.equal(field.valueOccurrenceIds.length, 2);
  const [alphaId, betaId] = field.valueOccurrenceIds;
  const occurrences = await read("occurrences");
  const alpha = occurrences[alphaId].nodeId,
    beta = occurrences[betaId].nodeId;
  await valueCell().getByText("Beta", { exact: true }).click();
  await editor().press("Tab");
  await saved();
  assert.equal(
    (await read("occurrences"))[betaId].parentNodeId,
    alpha,
    "Tana Tab moves the second value under the first",
  );
  assert.equal(await editor().textContent(), "Beta", "caret follows the same node after nesting");
  await editor().press("Shift+Tab");
  await saved();
  assert.deepEqual((await read("materializedFields"))["collection-row"][0].valueOccurrenceIds, [alphaId, betaId]);
  await valueCell().getByRole("button", { name: "Expand Beta", exact: true }).click();
  await valueCell().getByRole("button", { name: "Create child under Beta", exact: true }).click();
  await editor().pressSequentially("Nested value child");
  await blur();
  await saved();
  assert.equal((await read("childOccurrences"))[beta].length, 1);
  await table().getByText("Collection row", { exact: true }).click();
  await editor().press("Control+a");
  await editor().pressSequentially("**Same row**");
  await blur();
  await saved();
  assert.equal(await table().locator("strong").textContent(), "Same row");
  await table().getByText("Same row", { exact: true }).click();
  assert.equal(await editor().textContent(), "**Same row**");
  await editor().press("End");
  await editor().press("Enter");
  await editor().pressSequentially("Second table row");
  await blur();
  await saved();
  assert.equal(
    (await read("childOccurrences"))["collection-lab"].length,
    2,
    "Enter in a name cell creates a sibling table row",
  );
  if (process.env.LODE_VERIFICATION_ARTIFACTS) {
    await mkdir(process.env.LODE_VERIFICATION_ARTIFACTS, { recursive: true });
    await page.screenshot({ path: resolve(process.env.LODE_VERIFICATION_ARTIFACTS, "node-table.png") });
  }
  await page.getByRole("button", { name: "Shared view · Table" }).click();
  await page.getByRole("menuitem", { name: "Outline", exact: true }).click();
  await page.getByRole("button", { name: "Expand Same row", exact: true }).click();
  await page.getByText("Alpha", { exact: true }).waitFor();
  assert.deepEqual(
    (await read("materializedFields"))["collection-row"][0].valueOccurrenceIds,
    [alphaId, betaId],
    "view switching reuses the same values",
  );
  await write([{ kind: "shared-default-view-create", hostNodeId: beta, viewType: "table", anchor }]);
  await page.getByRole("button", { name: "Expand Beta", exact: true }).click();
  const nested = page.getByRole("table", { name: "Node table" });
  await nested.getByText("Nested value child", { exact: true }).click();
  await editor().press("End");
  await editor().press("Enter");
  await editor().pressSequentially("Another nested row");
  await blur();
  await saved();
  assert.equal(
    (await read("childOccurrences"))[beta].length,
    2,
    "a value embeds its own Table without losing its child source",
  );
  await nested.getByText("Nested value child", { exact: true }).waitFor();
  await nested.getByText("Another nested row", { exact: true }).waitFor();
  if (process.env.LODE_VERIFICATION_ARTIFACTS) {
    await page.screenshot({ path: resolve(process.env.LODE_VERIFICATION_ARTIFACTS, "nested-node-table.png") });
  }
  const currentRoute = page.url();
  const dock = page.getByRole("navigation", { name: "Primary", exact: true });
  await dock.getByRole("button", { name: "Expand Shared workspace", exact: true }).click();
  await dock.getByRole("button", { name: "Expand Collection lab", exact: true }).click();
  assert.equal(page.url(), currentRoute, "expanding the dock does not navigate");
  await dock.getByRole("link", { name: "Same row", exact: true }).click();
  await page.getByRole("heading", { name: "Same row", exact: true }).waitFor();
  await dock.getByRole("button", { name: "Collapse Shared workspace", exact: true }).click();
  await page.goto(route("collection-tag"));
  await page.getByRole("button", { name: "New field", exact: true }).click();
  await editor().pressSequentially("Template field");
  await blur();
  await saved();
  const template = (await read("templateFields"))["collection-tag"][0];
  const defaultRegion = page.getByRole("tree", { name: "Default value for Template field", exact: true });
  await defaultRegion.locator('[data-ui="outline-row-text"]').click();
  await editor().pressSequentially("Template default");
  await blur();
  await saved();
  assert.equal(
    (await read("nodes"))[template.staticDefaultValueNodeId].content.map((atom) => atom.value).join(""),
    "Template default",
  );
  assert.equal(
    (await read("nodes"))[template.fieldDefinitionId].content.map((atom) => atom.value).join(""),
    "Template field",
  );
  if (process.env.LODE_VERIFICATION_ARTIFACTS) {
    await page.screenshot({ path: resolve(process.env.LODE_VERIFICATION_ARTIFACTS, "supertag-configuration.png") });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.goto(`${new URL(page.url()).origin}/#/workspace/${workspaceId}`);
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
}
