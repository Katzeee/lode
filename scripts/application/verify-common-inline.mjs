import assert from "node:assert/strict";

export async function verifyCommonInline(page, client, workspaceId, actorId) {
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
  const created = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "common-inline-setup",
    intent: "direct",
    actions: [
      { ...node("common-inline", workspaceId, "Common inline"), anchor: { ...anchor, fallback: "start" } },
      node("common-inline-host", "common-inline", "Host"),
      node("common-inline-format", "common-inline", "Prefix middle suffix"),
      node("common-inline-reference-a", "common-inline", "RefPick Alpha"),
      node("common-inline-reference-b", "common-inline", "RefPick Beta"),
      node("common-inline-tag-a", "common-inline", "TagPick Alpha", "supertag-definition"),
      node("common-inline-tag-b", "common-inline", "TagPick Beta", "supertag-definition"),
    ],
  });
  assert.equal(created.status, "published", JSON.stringify(created));
  const read = async (section) => {
    const values = {};
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
      Object.assign(values, result.value[section]);
      after = result.value.next;
    } while (after);
    return values;
  };
  const origin = new URL(page.url()).origin;
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto(`${origin}/#/workspace/${workspaceId}/node/common-inline`);
  await page.getByRole("heading", { name: "Common inline", exact: true }).waitFor();
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
  const saved = () => page.getByText("Saved locally", { exact: true }).waitFor();
  await page
    .locator('[data-ui="outline-row-text"]')
    .filter({ hasText: /^Host$/ })
    .click();
  const originalChildren = (await read("childOccurrences"))["common-inline"];
  const picked = new Map();
  for (const [trigger, query, label, kind] of [
    ["@", "RefPick", "Link a node", "reference"],
    ["#", "TagPick", "Apply a supertag", "tag"],
  ]) {
    await editor().press("End");
    await editor().pressSequentially(` ${trigger}${query}`);
    const panel = page.getByRole("listbox", { name: label });
    await panel.waitFor();
    assert.equal(await panel.getByRole("option").count(), 2);
    const active = () => panel.locator('[role="option"][aria-selected="true"]');
    const first = await active().textContent();
    await editor().press("ArrowDown");
    const second = await active().textContent();
    assert.notEqual(second, first, "ArrowDown changes the active host candidate");
    await editor().press("ArrowUp");
    assert.equal(await active().textContent(), first);
    await editor().press("ArrowDown");
    picked.set(kind, second.trim());
    await editor().press("Enter");
    await panel.waitFor({ state: "detached" });
    assert.ok((await editor().textContent()).includes(`${trigger}{${second.trim()}}`));
    await saved();
    assert.deepEqual(
      (await read("childOccurrences"))["common-inline"],
      originalChildren,
      "accepting a candidate does not insert another row",
    );
  }
  const expectedReference =
    picked.get("reference") === "RefPick Alpha" ? "common-inline-reference-a" : "common-inline-reference-b";
  const expectedTag = picked.get("tag") === "TagPick Alpha" ? "common-inline-tag-a" : "common-inline-tag-b";
  const references = () =>
    read("nodes").then((nodes) =>
      nodes["common-inline-host"].content.filter((item) => item.kind === "inline-reference"),
    );
  const originalReference = (await references())[0];
  assert.equal(originalReference.targetNodeId, expectedReference);
  assert.deepEqual(
    (await read("supertagApplications"))["common-inline-host"].map((item) => item.supertagId),
    [expectedTag],
  );
  for (const [trigger, query, label] of [
    ["@", "RefPick", "Link a node"],
    ["#", "TagPick", "Apply a supertag"],
  ]) {
    const source = await editor().textContent();
    const suffix = ` ${trigger}${query}`;
    await editor().press("End");
    await editor().pressSequentially(suffix);
    const panel = page.getByRole("listbox", { name: label });
    await panel.waitFor();
    await editor().press("Escape");
    await panel.waitFor({ state: "detached" });
    assert.equal(await editor().textContent(), source + suffix, "cancel leaves the unaccepted query as source text");
    await eraseTail(editor(), suffix.length);
    await editor().pressSequentially(` ${trigger}`);
    await panel.waitFor();
    await editor().press("Space");
    assert.equal(await page.getByRole("listbox").count(), 0);
    await editor().pressSequentially("plain");
    assert.equal(await page.getByRole("listbox").count(), 0, "typing after a space does not revive the trigger");
    await eraseTail(editor(), ` ${trigger} plain`.length);
    assert.equal(await editor().textContent(), source);
    await saved();
    assert.deepEqual(await references(), [originalReference]);
    assert.deepEqual(
      (await read("supertagApplications"))["common-inline-host"].map((item) => item.supertagId),
      [expectedTag],
    );
  }

  const tagSource = `#{${picked.get("tag")}}`;
  const text = await editor().textContent();
  await selectRange(editor(), text.indexOf(tagSource), tagSource.length);
  await editor().press("Backspace");
  await saved();
  assert.deepEqual((await read("supertagApplications"))["common-inline-host"] ?? [], []);
  assert.deepEqual(await references(), [originalReference]);
  await undoWhileEditingAnotherRow(page, editor, saved, read);
  assert.deepEqual(
    (await read("supertagApplications"))["common-inline-host"].map((item) => item.supertagId),
    [expectedTag],
  );
  assert.deepEqual(await references(), [originalReference]);

  await editor().press("End");
  await editor().press("Backspace");
  assert.equal(await editor().textContent(), "Prefix middle suffix");
  await saved();
  for (const [key, attribute, delimiter] of [
    ["b", "bold", "**"],
    ["i", "italic", "__"],
    ["e", "code", "`"],
  ]) {
    await selectRange(editor(), "Prefix ".length, "middle".length);
    await editor().press(`Control+${key}`);
    assert.equal(await editor().textContent(), `Prefix ${delimiter}middle${delimiter} suffix`);
    await saved();
    await assertFormatting(read, attribute, true);
    await editor().press(`Control+${key}`);
    assert.equal(await editor().textContent(), "Prefix middle suffix");
    await saved();
    await assertFormatting(read, attribute, false);
    await editor().press("Control+z");
    await saved();
    await assertFormatting(read, attribute, true);
    await editor().press("Control+Shift+z");
    await saved();
    await assertFormatting(read, attribute, false);
  }
  assert.deepEqual((await read("childOccurrences"))["common-inline"], originalChildren);
  await page.goto(`${origin}/#/workspace/${workspaceId}`);
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
}

async function undoWhileEditingAnotherRow(page, editor, saved, read) {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const isUndo = (request) => {
    if (request.method() !== "POST") return false;
    const body = request.postDataJSON();
    return body?.method === "execute" && body.input?.kind === "undo";
  };
  const intercept = async (route) => {
    if (isUndo(route.request())) await held;
    await route.continue();
  };
  await page.route("**/api/application", intercept);
  try {
    const requested = page.waitForRequest(isUndo);
    await editor().press("Control+z");
    await requested;
    await page.locator('[data-ui="outline-row-text"]').filter({ hasText: "Prefix middle suffix" }).click();
    await editor().press("End");
    await editor().pressSequentially("!");
    assert.equal(
      await editor().textContent(),
      "Prefix middle suffix!",
      "typing proceeds while the earlier tag Undo is held",
    );
    const response = page.waitForResponse(
      (response) => response.url().endsWith("/api/application") && isUndo(response.request()),
    );
    release();
    await response;
    await saved();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(
      await editor().evaluate((element) => element.closest("[data-item-key]").getAttribute("data-item-key")),
      '["common-inline-format-occ"]',
      "acknowledging an earlier tag Undo must not restore focus over a later same-region editing decision",
    );
    assert.equal(await editor().textContent(), "Prefix middle suffix!");
    assert.equal(
      (await read("nodes"))["common-inline-format"].content
        .map((item) => (item.kind === "text" ? item.value : "@"))
        .join(""),
      "Prefix middle suffix!",
    );
  } finally {
    release();
    await page.unroute("**/api/application", intercept);
  }
}

async function eraseTail(editor, length) {
  for (let index = 0; index < length; index += 1) await editor.press("Backspace");
}

async function selectRange(editor, from, length) {
  assert.ok(from >= 0);
  await editor.press("Home");
  for (let index = 0; index < from; index += 1) await editor.press("ArrowRight");
  for (let index = 0; index < length; index += 1) await editor.press("Shift+ArrowRight");
}

async function assertFormatting(read, attribute, enabled) {
  const node = (await read("nodes"))["common-inline-format"];
  assert.equal(node.content.map((item) => (item.kind === "text" ? item.value : "@")).join(""), "Prefix middle suffix");
  assert.ok(node.content.slice(7, 13).every((item) => (item.attributes[attribute] === true) === enabled));
  assert.ok(
    [...node.content.slice(0, 7), ...node.content.slice(13)].every((item) => item.attributes[attribute] !== true),
  );
}
