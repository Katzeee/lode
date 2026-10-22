import assert from "node:assert/strict";
import { verifyOrdinaryBoundaries } from "./verify-ordinary-boundaries.mjs";
import { verifyOrdinaryFieldTrash } from "./verify-ordinary-field-trash.mjs";

/** A real daemon write is delayed at transport while the user continues elsewhere. */
export async function verifyOrdinaryEditing(page, client, workspaceId, actorId) {
  const anchor = { after: null, before: null, affinity: "after", fallback: "end" };
  const node = (nodeId, parentNodeId, value) => ({
    kind: "node-create",
    nodeId,
    occurrenceId: `${nodeId}-occ`,
    parentNodeId,
    anchor,
    seed: { text: [{ value, attributes: {} }] },
  });
  const result = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "ordinary-continuity-setup",
    intent: "direct",
    actions: [
      { ...node("ordinary-lab", workspaceId, "Ordinary continuity"), anchor: { ...anchor, fallback: "start" } },
      node("ordinary-a", "ordinary-lab", "A"),
      node("ordinary-b", "ordinary-lab", "B"),
      node("ordinary-c", "ordinary-lab", "C"),
    ],
  });
  assert.equal(result.status, "published", JSON.stringify(result));
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/#/workspace/${workspaceId}/node/ordinary-lab`);
  await page.getByRole("heading", { name: "Ordinary continuity", exact: true }).waitFor();
  const row = (path) => page.locator(`[data-ui="outline-row"][data-item-key=${JSON.stringify(JSON.stringify(path))}]`);
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
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
  let release;
  let entered;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const requested = new Promise((resolve) => {
    entered = resolve;
  });
  const isMove = (request) => {
    if (request.method() !== "POST") return false;
    const body = request.postDataJSON();
    return body?.method === "execute" && body.input?.actions?.some((action) => action.kind === "occurrence-move");
  };
  const intercept = async (route) => {
    if (isMove(route.request())) {
      entered();
      await held;
    }
    await route.continue();
  };
  await page.route("**/api/application", intercept);
  try {
    await row(["ordinary-b-occ"]).locator('[data-ui="outline-row-text"]').click();
    await editor().press("Tab");
    await Promise.race([
      requested,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Move request absent")), 10000)),
    ]);
    await row(["ordinary-c-occ"]).locator('[data-ui="outline-row-text"]').click();
    await editor().press("End");
    await editor().pressSequentially(" typed");
    const response = page.waitForResponse(
      (response) => response.url().endsWith("/api/application") && isMove(response.request()),
    );
    release();
    await response;
    await page.getByText("Saved locally", { exact: true }).waitFor();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(
      await editor().evaluate((element) => element.closest("[data-item-key]").getAttribute("data-item-key")),
      JSON.stringify(["ordinary-c-occ"]),
      "acknowledging an earlier move must not steal the user's current editing target",
    );
    assert.equal(await editor().textContent(), "C typed");
    const nodes = await read("nodes");
    assert.equal(
      nodes["ordinary-c"].content.map((item) => (item.kind === "text" ? item.value : "")).join(""),
      "C typed",
    );
    const occurrences = await read("occurrences");
    assert.equal(
      occurrences["ordinary-b-occ"].parentNodeId,
      "ordinary-a",
      "the pending structural edit still reaches the real daemon",
    );
  } finally {
    release();
    await page.unroute("**/api/application", intercept);
  }
  await verifyRapidInput(page, client, workspaceId, actorId, origin, node, read);
  await verifyRepeatedReorder(page, client, workspaceId, actorId, origin, node, read);
  await verifyOrdinaryBoundaries(page, client, workspaceId, actorId, node, read);
  await verifyOrdinaryFieldTrash(page, client, workspaceId, actorId, node, read);
  await page.goto(`${origin}/#/workspace/${workspaceId}`);
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
}

async function verifyRapidInput(page, client, workspaceId, actorId, origin, node, read) {
  const result = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "rapid-input-setup",
    intent: "direct",
    actions: [node("ordinary-rapid", "ordinary-lab", "Rapid input")],
  });
  assert.equal(result.status, "published", JSON.stringify(result));
  await page.goto(`${origin}/#/workspace/${workspaceId}/node/ordinary-rapid`);
  await page.getByRole("heading", { name: "Rapid input", exact: true }).waitFor();
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
  const slowWrites = async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.method === "execute") {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await route.continue();
  };
  await page.route("**/api/application", slowWrites);
  try {
    await page.getByRole("button", { name: "Create node", exact: true }).click();
    await editor().pressSequentially("Alpha");
    const firstKey = await editor().evaluate((element) =>
      element.closest("[data-item-key]").getAttribute("data-item-key"),
    );
    await page.keyboard.press("Enter");
    await page.keyboard.type("Beta");
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("!");
    assert.equal(
      await editor().textContent(),
      "Alpha!Beta",
      "typing continues at the merge connection point before daemon acknowledgements",
    );
    await page.getByText("Saved locally", { exact: true }).waitFor();
    assert.equal(await editor().textContent(), "Alpha!Beta");
    assert.equal(
      await editor().evaluate((element) => element.closest("[data-item-key]").getAttribute("data-item-key")),
      firstKey,
    );
    const children = (await read("childOccurrences"))["ordinary-rapid"];
    assert.deepEqual(children, JSON.parse(firstKey));
    const occurrence = (await read("occurrences"))[children[0]];
    const stored = (await read("nodes"))[occurrence.nodeId];
    assert.equal(stored.content.map((item) => (item.kind === "text" ? item.value : "")).join(""), "Alpha!Beta");
  } finally {
    await page.unroute("**/api/application", slowWrites);
  }
}

async function verifyRepeatedReorder(page, client, workspaceId, actorId, origin, node, read) {
  const result = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "rapid-reorder-setup",
    intent: "direct",
    actions: [
      node("ordinary-reorder", "ordinary-lab", "Rapid reorder"),
      ...["one", "two", "three"].map((name) => node(`ordinary-${name}`, "ordinary-reorder", name)),
    ],
  });
  assert.equal(result.status, "published", JSON.stringify(result));
  await page.goto(`${origin}/#/workspace/${workspaceId}/node/ordinary-reorder`);
  await page.getByRole("heading", { name: "Rapid reorder", exact: true }).waitFor();
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
  const slowWrites = async (route) => {
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    if (body?.method === "execute" && body.input?.actions?.some((action) => action.kind === "occurrence-move")) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await route.continue();
  };
  await page.route("**/api/application", slowWrites);
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.locator('[data-ui="outline-row-text"]').filter({ hasText: "three" }).click();
    await editor().press("Alt+Shift+ArrowUp");
    await editor().press("Alt+Shift+ArrowUp");
    await editor().press("End");
    await editor().pressSequentially(" typed");
    await cdp.send("Input.imeSetComposition", { text: "中文🙂", selectionStart: 4, selectionEnd: 4 });
    await page.getByText("Saved locally", { exact: true }).waitFor();
    assert.deepEqual(
      (await read("childOccurrences"))["ordinary-reorder"],
      ["ordinary-three-occ", "ordinary-one-occ", "ordinary-two-occ"],
      "two relative move commands advance two positions despite a delayed first acknowledgement",
    );
    await cdp.send("Input.imeSetComposition", { text: "中文🙂好", selectionStart: 5, selectionEnd: 5 });
    await cdp.send("Input.insertText", { text: "中文🙂好" });
    await page.getByText("Saved locally", { exact: true }).waitFor();
    assert.equal(
      await editor().textContent(),
      "three typed中文🙂好",
      "late structural acknowledgements preserve the active composition range",
    );
    assert.equal(
      (await read("nodes"))["ordinary-three"].content.map((item) => (item.kind === "text" ? item.value : "")).join(""),
      "three typed中文🙂好",
    );
  } finally {
    await cdp.detach();
    await page.unroute("**/api/application", slowWrites);
  }
}
