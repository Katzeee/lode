import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDesktopEngine } from "@lode/engine-platform-desktop";
import { END_SEQUENCE_ANCHOR as anchor, type EngineApplicationContract } from "@lode/sdk";
import { contentToSource } from "@lode/ui";
import { expect, it } from "vitest";
import { ApplicationSession } from "../session/session.js";
import { WorkspaceController } from "./workspace-controller.js";
import { projectWorkspaceOutline } from "./workspace-outline.js";
import { workspaceContentKey } from "./workspace-content-target.js";
import { workspaceOutlineActions } from "./workspace-outline-actions.js";
import { workspaceCompletions } from "./workspace-completions.js";
import { nodeSource } from "./node-source.js";

it("edits each linked template through an isolated draft and hands off to the Engine copy without changing its editor identity", async () => {
  const path = await mkdtemp(join(tmpdir(), "lode-template-edit-"));
  const engine = createDesktopEngine({
    dataRoot: path,
    peerTransport: {
      start: () => {},
      close: () => {},
      dial: () => {
        throw new Error("Local test");
      },
    },
  });
  let stop: (() => void) | undefined;
  try {
    await engine.start();
    const session = new ApplicationSession(engine.api);
    await session.initialize({ actorLabel: "Writer", passphrase: "template-edit-passphrase" });
    const state = await session.createWorkspace("Template editor");
    const workspaceId = state.workspaces[0]!.workspaceId;
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    let pause = false;
    let detachCalls = 0;
    const service: EngineApplicationContract = {
      ...session.engine,
      execute: async (command) => {
        if (command.kind === "edit" && command.actions.some((action) => action.kind === "template-node-edit")) {
          detachCalls += 1;
          if (pause) {
            await new Promise<void>((resolve) => {
              release = resolve;
              started?.();
            });
          }
        }
        return session.engine.execute(command);
      },
    };
    const controller = new WorkspaceController(service, workspaceId, state.actors[0]!.actorId);
    stop = controller.start();
    await controller.whenIdle();
    const node = (nodeId: string, parentNodeId = workspaceId, type?: "supertag-definition") => ({
      kind: "node-create" as const,
      nodeId,
      occurrenceId: `${nodeId}-occ`,
      parentNodeId,
      anchor,
      ...(type ? { intrinsicNodeType: type } : {}),
      seed: { text: [{ value: nodeId, attributes: {} }] },
    });
    await controller.apply(() => [
      node("tag", workspaceId, "supertag-definition"),
      node("Guide", "tag"),
      node("Target"),
      node("one"),
      node("two"),
      { kind: "supertag-application-create", hostNodeId: "one", supertagId: "tag", anchor },
      { kind: "supertag-application-create", hostNodeId: "two", supertagId: "tag", anchor },
    ]);
    const view = (owner: string) =>
      projectWorkspaceOutline(controller.viewGraph()!, controller.getSnapshot().drafts, owner);
    const appearance = (owner: string) =>
      [...view(owner).bindings.values()].find((item) => item.contentTarget?.kind === "template-instance")!;
    const one = appearance("one");
    const two = appearance("two");
    expect(one.editable).toBe(true);
    expect(one.reference).toBe(false);
    expect(one.key).not.toBe(two.key);
    const oneTarget = one.contentTarget!;
    const completion = workspaceCompletions({
      graph: controller.viewGraph()!,
      controller,
      contentNodeId: () => "Guide",
      contentTarget: () => oneTarget,
    });
    const commandContext = { keys: [one.key], position: null, content: null, source: "keyboard" as const };
    expect(completion.commands.every((command) => command.canExecute?.(commandContext) === false)).toBe(true);
    completion.commands[0]?.execute(commandContext);
    expect(completion.providers.find((provider) => provider.id === "supertag")?.enabled?.(one.key)).toBe(true);
    controller.commitContent(oneTarget, [{ type: "text", text: "Guide" }], "blur");
    await controller.whenIdle();
    expect(detachCalls).toBe(0);
    const first = [{ type: "text" as const, text: "**Guide** @{Target}" }];
    controller.stageContent(oneTarget, first);
    expect(controller.getSnapshot().drafts.has("Guide")).toBe(false);
    expect(controller.getSnapshot().drafts.has(workspaceContentKey(oneTarget))).toBe(true);
    expect(contentToSource(view("one").items[0]!.content)).toBe("**Guide** @{Target}");
    expect(contentToSource(view("two").items[0]!.content)).toBe("Guide");
    pause = true;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    controller.flush();
    await pending;
    const continued = [{ type: "text" as const, text: "**Guide** @{Target} continued" }];
    controller.stageContent(oneTarget, continued);
    pause = false;
    release?.();
    await controller.whenIdle();
    controller.flush();
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    expect(detachCalls).toBe(1);
    expect(appearance("one").key).toBe(one.key);
    const copy = appearance("one").contentNodeId;
    expect(copy).not.toBe("Guide");
    expect(
      contentToSource(nodeSource(controller.getSnapshot().graph!.nodes[copy]!, controller.getSnapshot().graph!)),
    ).toBe("**Guide** @{Target} continued");
    expect(contentToSource(view("two").items[0]!.content)).toBe("Guide");
    expect(
      contentToSource(nodeSource(controller.getSnapshot().graph!.nodes.Guide!, controller.getSnapshot().graph!)),
    ).toBe("Guide");
    const history = async (direction: "undo" | "redo") => {
      const graph = controller.viewGraph()!,
        projected = view("one");
      return workspaceOutlineActions(graph, controller, projected.bindings, "one").history(direction, {
        key: one.key,
        caret: 5,
        editing: true,
      });
    };
    await history("undo");
    expect(contentToSource(view("one").items[0]!.content)).toBe("**Guide** @{Target}");
    const undone = await history("undo");
    expect(undone?.position?.key).toBe(one.key);
    expect(appearance("one").key).toBe(one.key);
    expect(appearance("one").contentNodeId).toBe("Guide");
    controller.commitContent(appearance("one").contentTarget!, [{ type: "text", text: "Second local edit" }], "blur");
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    const second = appearance("one").contentNodeId;
    expect(second).not.toBe(copy);
    expect(appearance("one").key).toBe(one.key);
    await history("undo");
    expect(appearance("one").contentNodeId).toBe("Guide");
    await history("redo");
    expect(appearance("one").contentNodeId).toBe(second);
    expect(contentToSource(view("one").items[0]!.content)).toBe("Second local edit");
    expect(contentToSource(view("two").items[0]!.content)).toBe("Guide");
    const twoTarget = appearance("two").contentTarget!;
    controller.stageContent(twoTarget, [{ type: "text", text: "Guide #{tag}" }]);
    controller.flush();
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    const taggedCopy = appearance("two").contentNodeId;
    expect(taggedCopy).not.toBe("Guide");
    expect(controller.getSnapshot().graph!.supertagApplications[taggedCopy]?.map((item) => item.supertagId)).toEqual([
      "tag",
    ]);
    expect(controller.getSnapshot().graph!.supertagApplications.Guide ?? []).toEqual([]);
    await controller.history("undo");
    await controller.whenIdle();
    await controller.apply(() => [
      node("marker", workspaceId, "supertag-definition"),
      { kind: "supertag-application-create", hostNodeId: "Guide", supertagId: "marker", anchor },
    ]);
    expect(appearance("two").editable).toBe(true);
    controller.commitContent(
      appearance("two").contentTarget!,
      [{ type: "text", text: "Tagged source edited #{marker}" }],
      "blur",
    );
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    expect(
      controller
        .getSnapshot()
        .graph!.supertagApplications[appearance("two").contentNodeId]?.map((item) => item.supertagId),
    ).toEqual(["marker"]);
    expect(appearance("one").editable).toBe(true);
  } finally {
    stop?.();
    await engine.stop();
    expect(resolve(path).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(path, { recursive: true, force: true });
  }
}, 25_000);
