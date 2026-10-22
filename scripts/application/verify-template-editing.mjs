import assert from "node:assert/strict";

export async function verifyTemplateEditing(page, client, workspaceId, actorId) {
  const anchor = { after: null, before: null, affinity: "after", fallback: "end" };
  const node = (nodeId, parentNodeId, value, intrinsicNodeType) => ({
    kind: "node-create",
    nodeId,
    parentNodeId,
    occurrenceId: `${nodeId}-occ`,
    anchor,
    ...(intrinsicNodeType ? { intrinsicNodeType } : {}),
    seed: { text: [{ value, attributes: {} }] },
  });
  const result = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "template-editing-setup",
    intent: "direct",
    actions: [
      node("editing-tag", workspaceId, "Editing template", "supertag-definition"),
      node("editing-source", "editing-tag", "AlphaOmega"),
      node("editing-child", "editing-source", "Nested child"),
      node("editing-one", workspaceId, "Template editing one"),
      node("editing-two", workspaceId, "Template editing two"),
      { kind: "supertag-application-create", hostNodeId: "editing-one", supertagId: "editing-tag", anchor },
      { kind: "supertag-application-create", hostNodeId: "editing-two", supertagId: "editing-tag", anchor },
    ],
  });
  assert.equal(result.status, "published", JSON.stringify(result));
  const read = async (section) => {
    const values = section === "templateNodeInstances" ? [] : {};
    let after;
    do {
      const result = await client.query({
        kind: "projection",
        workspaceId,
        perspective: "origin",
        section,
        limit: 100,
        ...(after ? { after } : {}),
      });
      assert.equal(result.status, "ok");
      if (Array.isArray(values)) {
        values.push(...result.value[section]);
      } else {
        Object.assign(values, result.value[section]);
      }
      after = result.value.next;
    } while (after);
    return values;
  };
  const instance = async (owner = "editing-one") =>
    (await read("templateNodeInstances")).find(
      (item) => item.ownerNodeId === owner && item.templateNodeId === "editing-source",
    );
  const origin = new URL(page.url()).origin;
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
  const open = async (owner, title) => {
    await page.goto(`${origin}/#/workspace/${workspaceId}/node/${owner}`);
    await page.getByRole("heading", { name: new RegExp(title) }).waitFor();
  };
  const sourceRow = () => page.locator('[data-ui="outline-row-text"]').filter({ hasText: "AlphaOmega" }).first();
  await open("editing-one", "Template editing one");
  await sourceRow().click({position: {x: 6, y: 8}});
  const key = await editor().evaluate((element) => element.closest("[data-item-key]").getAttribute("data-item-key"));
  await page.getByRole("heading", { name: /Template editing one/ }).click();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  assert.equal((await instance()).state, "linked", "focus and blur do not author the inherited Node");
  await sourceRow().click({position: {x: 6, y: 8}});
  await editor().press("Control+End");
  const slowWrites = async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.method === "execute") {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await route.continue();
  };
  await page.route("**/api/application", slowWrites);
  try {
    await page.keyboard.press("Enter");
    await page.keyboard.type("Inserted child");
    assert.equal(
      await editor().textContent(),
      "Inserted child",
      "typing reaches the new row before materialization is acknowledged",
    );
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second child");
    assert.equal(await editor().textContent(), "Second child");
    await page.getByText("Saved locally", { exact: true }).waitFor();
  } finally {
    await page.unroute("**/api/application", slowWrites);
  }
  const local = await instance();
  const children = (await read("childOccurrences"))[local.instanceNodeId];
  const occurrences = await read("occurrences");
  const nodes = await read("nodes");
  const text = (node) => node.content.flatMap((item) => (item.kind === "text" ? [item.value] : [])).join("");
  assert.equal(children.length, 3);
  assert.equal(text(nodes[occurrences[children[0]].nodeId]), "Inserted child");
  assert.equal(text(nodes[occurrences[children[1]].nodeId]), "Second child");
  assert.equal(text(nodes[occurrences[children[2]].nodeId]), "Nested child");
  assert.equal(text(nodes["editing-source"]), "AlphaOmega");
  assert.equal((await instance("editing-two")).state, "linked");
  assert.ok(
    await page
      .locator('[data-ui="outline-row"]')
      .evaluateAll((rows, key) => rows.some((row) => row.getAttribute("data-item-key") === key), key),
    "copying keeps the source row's editing identity",
  );

  await open("editing-two", "Template editing two");
  await sourceRow().click({position: {x: 6, y: 8}});
  await editor().press("Home");
  for (let i = 0; i < 5; i += 1) {
    await editor().press("ArrowRight");
  }
  await page.route("**/api/application", slowWrites);
  try {
    await page.keyboard.press("Enter");
    await page.keyboard.type("!");
    assert.equal(await editor().textContent(), "!Omega");
    await page.getByText("Saved locally", { exact: true }).waitFor();
  } finally {
    await page.unroute("**/api/application", slowWrites);
  }
  const split = await instance("editing-two");
  const splitNodes = await read("nodes");
  const splitChildren = (await read("childOccurrences"))["editing-two"];
  assert.equal(text(splitNodes[split.instanceNodeId]), "Alpha");
  assert.equal(splitChildren.length, 2);
  assert.equal(text(splitNodes[(await read("occurrences"))[splitChildren[1]].nodeId]), "!Omega");
  assert.equal((await read("childOccurrences"))[split.instanceNodeId].length, 1);

  // A retained internal Reference must remain local through later edits in the same live editor.
  const referenceSetup = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "template-reference-setup",
    intent: "direct",
    actions: [
      {
        kind: "inline-reference-create",
        inlineReferenceId: "editing-inline",
        hostNodeId: "editing-source",
        targetNodeId: "editing-child",
        anchor,
      },
      node("editing-three", workspaceId, "Template editing three"),
      { kind: "supertag-application-create", hostNodeId: "editing-three", supertagId: "editing-tag", anchor },
    ],
  });
  assert.equal(referenceSetup.status, "published", JSON.stringify(referenceSetup));
  await open("editing-three", "Template editing three");
  await sourceRow().click({position: {x: 6, y: 8}});
  await editor().press("Control+End");
  await editor().pressSequentially("x");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const refInstance = await instance("editing-three");
  const localChild = refInstance.copies.find((copy) => copy.sourceNodeId === "editing-child").instanceNodeId;
  await editor().pressSequentially("y");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const stored = (await read("nodes"))[refInstance.instanceNodeId];
  assert.equal(stored.content.find((item) => item.kind === "inline-reference").targetNodeId, localChild);
  assert.ok(text(stored).endsWith("xy"));
  await page.goto(`${origin}/#/workspace/${workspaceId}`);
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
}
