import assert from "node:assert/strict";

export async function verifyEntryFeedback(page, client, workspaceId, actorId) {
  const anchor = { after: null, before: null, affinity: "after", fallback: "end" };
  const node = (id, parentNodeId, text) => ({
    kind: "node-create",
    nodeId: id,
    occurrenceId: `${id}-occ`,
    parentNodeId,
    anchor,
    seed: { text: [{ value: text, attributes: {} }] },
  });
  const result = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "entry-feedback-setup",
    intent: "direct",
    actions: [
      node("entry-feedback", workspaceId, "Entry feedback"),
      node("collapsed-parent", "entry-feedback", "Collapsed parent"),
      node("child-marker", "collapsed-parent", "Child marker"),
      node("empty-parent", "entry-feedback", "Empty parent"),
    ],
  });
  assert.equal(result.status, "published");
  const row = (path) => page.locator(`[data-ui="outline-row"][data-item-key=${JSON.stringify(JSON.stringify(path))}]`);
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
  const read = async (section) => {
    const result = await client.query({ kind: "projection", workspaceId, perspective: "origin", section, limit: 100 });
    assert.equal(result.status, "ok");
    return result.value[section];
  };
  const heading = page.getByRole("heading", { name: "Entry feedback", exact: true });
  await row(["entry-feedback-occ"]).getByRole("button", { name: "Activate Entry feedback" }).click();
  await heading.waitFor();
  const storedBefore = Object.keys(await read("nodes"));
  const create = page.getByRole("button", { name: "Create node", exact: true });
  await create.click();
  await editor().waitFor();
  assert.equal(await page.locator('[data-editing="true"] [data-ui="outline-placeholder-bullet"]').count(), 1);
  assert.equal(await create.count(), 0, "one empty insertion does not grow a second footer");
  assert.deepEqual(Object.keys(await read("nodes")), storedBefore, "focus alone publishes no Node");
  await page.locator('[data-ui="document-navigation"]').click({ position: { x: 4, y: 4 } });
  await create.waitFor();
  assert.deepEqual(
    Object.keys(await read("nodes")),
    storedBefore,
    "leaving an untouched placeholder publishes no Node",
  );

  const parent = row(["collapsed-parent-occ"]),
    mark = parent.locator('[data-ui="outline-bullet-mark"]');
  await heading.hover();
  assert.notEqual(
    await mark.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)",
    "a collapsed parent carries the shared component halo",
  );
  await parent.getByRole("button", { name: "Expand Collapsed parent" }).click();
  await heading.hover();
  assert.equal(
    await mark.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)",
    "expanding clears the collapsed-child halo",
  );
  const child = row(["collapsed-parent-occ", "child-marker-occ"]),
    childMark = child.locator('[data-ui="outline-bullet-mark"]');
  const box = await childMark.boundingBox();
  await child.locator('[data-ui="outline-bullet"]').hover();
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-ui="outline-bullet"]:hover [data-ui="outline-bullet-mark"]');
    return element && getComputedStyle(element).backgroundColor !== "rgba(0, 0, 0, 0)";
  });
  assert.deepEqual(await childMark.boundingBox(), box, "bullet hover never changes row geometry");

  await row(["empty-parent-occ"]).getByRole("button", { name: "Expand Empty parent" }).click();
  await page.getByRole("button", { name: "Create child under Empty parent" }).click();
  await editor().waitFor();
  assert.deepEqual(
    (await read("childOccurrences"))["empty-parent"] ?? [],
    [],
    "child placeholders also stay outside the Engine",
  );
  await heading.click();
  await page.getByRole("button", { name: "Create child under Empty parent" }).waitFor();
  assert.deepEqual(Object.keys(await read("nodes")), storedBefore);

  await create.click();
  await editor().waitFor();
  const positions = [];
  const location = () =>
    editor().evaluate((el) => ({
      key: el.closest("[data-item-key]").getAttribute("data-item-key"),
      y: el.getBoundingClientRect().y,
    }));
  positions.push(await location());
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press("Enter");
    positions.push(await location());
  }
  assert.equal(
    new Set(positions.map((position) => position.key)).size,
    6,
    "every Enter advances to a distinct local insertion immediately",
  );
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(
      positions[index].y > positions[index - 1].y + 20,
      "the caret advances down instead of jumping to an earlier row",
    );
  }
  await page.getByText("Saved locally", { exact: true }).waitFor();
  assert.deepEqual(await location(), positions.at(-1), "daemon acknowledgements never pull the caret back");
  assert.equal(
    (await read("childOccurrences"))["entry-feedback"].length,
    7,
    "Enter confirms five empty nodes; the last insertion remains provisional",
  );
  await heading.click();
  assert.equal((await read("childOccurrences"))["entry-feedback"].length, 7);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "Shared workspace" }).click();
}
