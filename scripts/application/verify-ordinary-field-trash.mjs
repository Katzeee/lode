import assert from "node:assert/strict";
import { FIELD_DATATYPE_NODE_IDS } from "@lode/sdk";

export async function verifyOrdinaryFieldTrash(page, client, workspaceId, actorId, node, read) {
  const anchor = { after: null, before: null, affinity: "after", fallback: "end" };
  const write = async (actions) => {
    const result = await client.execute({
      kind: "edit",
      workspaceId,
      actorId,
      invocationId: crypto.randomUUID(),
      historyChannelId: "ordinary-field-trash-setup",
      intent: "direct",
      actions,
    });
    assert.equal(result.status, "published", JSON.stringify(result));
  };
  await write([
    node("ordinary-number", "ordinary-lab", "Number lab"),
    { ...node("ordinary-number-def", "ordinary-lab", "Number input"), intrinsicNodeType: "field-definition" },
    {
      kind: "field-datatype-configure",
      fieldDefinitionId: "ordinary-number-def",
      datatypeNodeId: FIELD_DATATYPE_NODE_IDS.number,
    },
    {
      kind: "field-value-create",
      ownerNodeId: "ordinary-number",
      fieldDefinitionId: "ordinary-number-def",
      valueNodeId: "ordinary-number-value",
      valueOccurrenceId: "ordinary-number-value-occ",
      anchor,
      seed: { text: [{ value: "10", attributes: {} }] },
    },
    node("ordinary-empty-number", "ordinary-lab", "Empty Number lab"),
    { kind: "field-materialize", ownerNodeId: "ordinary-empty-number", fieldDefinitionId: "ordinary-number-def" },
    node("ordinary-trash", "ordinary-lab", "Trash lab"),
    node("ordinary-trash-parent", "ordinary-trash", "Parent to delete"),
    node("ordinary-trash-child", "ordinary-trash-parent", "Referenced child"),
    {
      kind: "occurrence-create",
      nodeId: "ordinary-trash-child",
      occurrenceId: "ordinary-trash-reference",
      parentNodeId: "ordinary-trash",
      anchor,
    },
  ]);
  const origin = new URL(page.url()).origin;
  const go = (id) => page.goto(`${origin}/#/workspace/${workspaceId}/node/${id}`);
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
  const saved = () => page.getByText("Saved locally", { exact: true }).waitFor();
  const text = (nodes, id) => nodes[id].content.map((item) => (item.kind === "text" ? item.value : "")).join("");
  await go("ordinary-number");
  await page.locator('[data-ui="outline-row-text"]').filter({ hasText: /^10$/ }).click();
  await editor().press("Control+a");
  await editor().pressSequentially("not a number 中文🙂");
  await saved();
  assert.equal(text(await read("nodes"), "ordinary-number-value"), "not a number 中文🙂");
  const field = (await read("materializedFields"))["ordinary-number"][0];
  assert.deepEqual(
    field.valueOccurrenceIds,
    ["ordinary-number-value-occ"],
    "invalid Number source preserves the existing value Node identity",
  );
  await go("ordinary-empty-number");
  await page.getByRole("button", { name: "Create child under Number input", exact: true }).click();
  await editor().pressSequentially("也不是数字🙂");
  await saved();
  const empty = (await read("materializedFields"))["ordinary-empty-number"][0];
  assert.equal(empty.valueOccurrenceIds.length, 1);
  const valueId = (await read("occurrences"))[empty.valueOccurrenceIds[0]].nodeId;
  assert.equal(text(await read("nodes"), valueId), "也不是数字🙂");
  await go("ordinary-trash");
  const parentRow = page.locator('[data-ui="outline-row"][data-item-key=\'["ordinary-trash-parent-occ"]\']');
  const collapse = parentRow.getByRole("button", { name: "Collapse Parent to delete", exact: true });
  if (await collapse.count()) await collapse.click();
  await parentRow.locator('[data-ui="outline-row-text"]').click();
  await editor().press("Escape");
  await page.keyboard.press("Control+Shift+Backspace");
  await saved();
  await page.getByLabel("The referenced node is in the trash", { exact: true }).waitFor();
  assert.equal(
    (await read("nodeOwners"))["ordinary-trash-child"],
    "ordinary-trash-parent",
    "parent deletion preserves child Owner and the external Reference",
  );
  assert.deepEqual((await read("childOccurrences"))["ordinary-trash"], ["ordinary-trash-reference"]);
  await page.locator('[data-ui="outline-row-text"]').filter({ hasText: "Referenced child" }).dblclick();
  assert.equal(
    await editor().count(),
    0,
    "a descendant in Trash is read-only even through an active Reference appearance",
  );
  await page.keyboard.press("Control+z");
  await saved();
  assert.deepEqual((await read("childOccurrences"))["ordinary-trash"], [
    "ordinary-trash-parent-occ",
    "ordinary-trash-reference",
  ]);
  assert.equal(await page.getByLabel("The referenced node is in the trash", { exact: true }).count(), 0);
}
