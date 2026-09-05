import assert from "node:assert/strict";
export async function verifyWorkspaceEditing(page, client, workspaceId, actorId, hostNodeId) {
  const end = { after: null, before: null, affinity: "after", fallback: "end" };
  const created = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "fixture",
    intent: "direct",
    actions: [
      {
        kind: "node-create",
        nodeId: "reference-target",
        occurrenceId: "target-placement",
        parentNodeId: workspaceId,
        anchor: end,
        seed: { text: [{ value: "Reference target", attributes: {} }] },
      },
      {
        kind: "node-create",
        nodeId: "project-tag",
        occurrenceId: "project-placement",
        parentNodeId: workspaceId,
        anchor: end,
        intrinsicNodeType: "supertag-definition",
        seed: { text: [{ value: "project", attributes: {} }] },
      },
      {
        kind: "node-create",
        nodeId: "owner-field",
        occurrenceId: "owner-placement",
        parentNodeId: workspaceId,
        anchor: end,
        intrinsicNodeType: "field-definition",
        seed: { text: [{ value: "Owner", attributes: {} }] },
      },
    ],
  });
  assert.equal(created.status, "published");
  await page.getByText("Reference target", { exact: true }).waitFor();
  const hostRow = page
    .locator('[data-ui="outline-row"]')
    .filter({ hasText: "A shared note from another client" })
    .first();
  await hostRow.locator('[data-ui="outline-row-text"]').click();
  const editor = () => page.locator('[data-ui="outline-editor"]');
  await editor().press("Control+a");
  await editor().pressSequentially("**Plan** @Reference");
  await page.getByRole("option", { name: "Reference target", exact: true }).click();
  await editor().press("End");
  await editor().pressSequentially(" #pro");
  await page.getByRole("option", { name: "project", exact: true }).click();
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).click();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-ui="outline-reference"]').first().textContent(), "Reference target");
  assert.equal(await page.locator("strong").filter({ hasText: "Plan" }).count(), 1);
  const query = async (section) => {
    const result = await client.query({ kind: "projection", workspaceId, perspective: "origin", section, limit: 100 });
    assert.equal(result.status, "ok");
    return result.value[section];
  };
  let nodes = await query("nodes");
  const referenceId = nodes[hostNodeId].content.find((item) => item.kind === "inline-reference").id;
  assert.equal((await query("supertagApplications"))[hostNodeId][0].supertagId, "project-tag");
  await page.locator("strong").filter({ hasText: "Plan" }).click();
  assert.match(await editor().textContent(), /\*\*Plan\*\*/);
  await editor().press("End");
  await editor().pressSequentially(" >Own");
  await page.getByRole("option", { name: "Owner", exact: true }).click();
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).click();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const fields = await query("materializedFields");
  assert.equal(fields[hostNodeId][0].fieldDefinitionId, "owner-field");
  nodes = await query("nodes");
  assert.equal(nodes[hostNodeId].content.find((item) => item.kind === "inline-reference").id, referenceId);
  const planRow = page
    .locator('[data-ui="outline-row"]')
    .filter({ has: page.locator("strong").filter({ hasText: "Plan" }) });
  await planRow.getByRole("button", { name: /^Expand / }).click();
  await page.getByRole("button", { name: "Create child under Owner", exact: true }).click();
  await editor().pressSequentially("Ada");
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).click();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  assert.ok(
    Object.values(await query("nodes")).some(
      (node) => node.content.map((item) => (item.kind === "text" ? item.value : "@")).join("") === "Ada",
    ),
  );
  const targetRow = page.locator(
    `[data-ui="outline-row"][data-item-key=${JSON.stringify(JSON.stringify(["target-placement"]))}]`,
  );
  await targetRow.locator('[data-ui="outline-row-text"]').click();
  await editor().press("Tab");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  assert.equal((await query("occurrences"))["target-placement"].parentNodeId, hostNodeId);
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  await editor().press("Control+z");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  assert.equal((await query("occurrences"))["target-placement"].parentNodeId, workspaceId);
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  assert.equal(await editor().textContent(), "Reference target");
  await editor().evaluate((element) => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true }));
    window.applicationClipboard = data;
  });
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).click();
  await page.locator("strong").filter({ hasText: "Plan" }).click();
  await editor().press("End");
  await editor().evaluate((element) =>
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: window.applicationClipboard, bubbles: true })),
  );
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).click();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  assert.equal((await query("nodes"))[hostNodeId].content.filter((item) => item.kind === "inline-reference").length, 2);
  await page.getByRole("button", { name: "Create node", exact: true }).click();
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  await editor().pressSequentially("Meeting /");
  await page.getByRole("option", { name: "Create supertag", exact: true }).click();
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).click();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  assert.ok(
    Object.values(await query("nodes")).some(
      (node) =>
        node.intrinsicNodeType === "supertag-definition" &&
        node.content.map((item) => (item.kind === "text" ? item.value : "@")).join("") === "Meeting",
    ),
  );
  await page.reload();
  await page.locator('[data-ui="outline-reference"]').first().waitFor();
  await page.locator('[data-ui="outline-reference"]').first().click();
  await page.getByRole("heading", { name: "Reference target", exact: true }).waitFor();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "Shared workspace" }).click();
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
}
