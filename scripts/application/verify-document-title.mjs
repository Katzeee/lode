import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

export async function verifyDocumentTitle(page, client, workspaceId, actorId) {
  const screenshot = async (name) => {
    const path = process.env.LODE_VERIFICATION_ARTIFACTS;
    if (path) {
      await mkdir(path, { recursive: true });
      await page.screenshot({ path: resolve(path, name + ".png") });
    }
  };
  const read = async (section) => {
    const result = await client.query({ kind: "projection", workspaceId, perspective: "origin", section, limit: 100 });
    assert.equal(result.status, "ok");
    return result.value[section];
  };
  const blur = () => page.locator('[data-ui="document-navigation"]').click({ position: { x: 4, y: 4 } });
  const title = () => page.locator('[data-ui="outline-title"]');
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
  const saved = () => page.getByText("Saved locally", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
  const before = (await read("childOccurrences"))[workspaceId];
  await title().click();
  await editor().press("Control+a");
  await editor().pressSequentially("**Journal workspace**");
  assert.equal(
    await editor().textContent(),
    "**Journal workspace**",
    "workspace names use the same source editing mode",
  );
  assert.equal(await title().locator('[data-ui="outline-bullet"]').count(), 0);
  assert.equal(
    await editor().evaluate((el) => getComputedStyle(el).fontSize),
    await page.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).fontSize),
  );
  await blur();
  await saved();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Journal workspace", exact: true })
    .waitFor();
  assert.equal(await title().locator("strong").textContent(), "Journal workspace");
  await screenshot("workspace-node-title");
  assert.equal(
    (await client.listWorkspaces()).find((item) => item.workspaceId === workspaceId).label,
    "Journal workspace",
  );
  assert.deepEqual(
    (await read("childOccurrences"))[workspaceId],
    before,
    "renaming a workspace does not create a substitute Node",
  );
  await title().click();
  await editor().press("Control+z");
  await saved();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Shared workspace", exact: true })
    .waitFor();
  await editor().press("Control+Shift+z");
  await saved();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Journal workspace", exact: true })
    .waitFor();
  await editor().press("Control+a");
  await editor().pressSequentially("Shared workspace");
  await blur();
  await saved();

  const anchor = { after: null, before: null, affinity: "after", fallback: "end" };
  const seed = (nodeId, parentNodeId, text) => ({
    kind: "node-create",
    nodeId,
    occurrenceId: `${nodeId}-occ`,
    parentNodeId,
    anchor,
    seed: { text: [{ value: text, attributes: {} }] },
  });
  const created = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "title-setup",
    intent: "direct",
    actions: [
      seed("title-parent", workspaceId, "Title parent"),
      seed("title-child", "title-parent", "Title child"),
      {
        kind: "occurrence-create",
        nodeId: "title-child",
        occurrenceId: "title-reference",
        parentNodeId: workspaceId,
        anchor,
      },
    ],
  });
  assert.equal(created.status, "published");
  await page.getByRole("button", { name: "Activate Title child", exact: true }).click();
  await title().click();
  await editor().press("Control+a");
  await editor().pressSequentially("**Shared title**");
  await blur();
  await saved();
  assert.equal(
    (await read("nodes"))["title-child"].content.map((part) => (part.kind === "text" ? part.value : "@")).join(""),
    "Shared title",
  );
  await screenshot("node-title-breadcrumb");
  const crumb = page.getByRole("navigation", { name: "Breadcrumb" });
  assert.ok(
    (await crumb.boundingBox()).y < (await title().boundingBox()).y,
    "breadcrumbs belong to the panel header above the title",
  );
  assert.equal(await crumb.getByRole("button", { name: "Title parent", exact: true }).count(), 1);
  await title().click();
  await editor().press("End");
  await editor().press("Enter");
  await page.locator('[data-ui="outline-row"] [data-ui="outline-editor"]:focus').waitFor();
  await editor().pressSequentially("First title child");
  await blur();
  await saved();
  const children = (await read("childOccurrences"))["title-child"];
  assert.equal(children.length, 1, "Enter from the heading inserts a child of the opened Node");
  await crumb.getByRole("button", { name: "Title parent", exact: true }).click();
  await page.getByRole("heading", { name: "Title parent", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Activate Shared title", exact: true }).count(), 1);
  await crumb.getByRole("button", { name: "Shared workspace", exact: true }).click();
  await page.getByRole("button", { name: "Activate Shared title", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
  await page.getByRole("button", { name: "Activate Shared title", exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
