import { describe, expect, it } from "vitest";
import { installComponents, type ComponentDefinition } from "./component.js";
import { AppRuntime } from "./app-runtime.js";

type Services = { a: string; b: string };
type Config = { readonly suffix: string };

describe("component definitions", () => {
  it("resolve declared capabilities without making dependencies owners", async () => {
    const runtime = new AppRuntime("test");
    const order: string[] = [];
    const a: ComponentDefinition<Services, "a", never, Config> = {
      name: "a",
      create: ({ config }) => {
        order.push("a");
        return `A${config.suffix}`;
      },
    };
    const b: ComponentDefinition<Services, "b", "a", Config> = {
      name: "b",
      requires: ["a"],
      create: ({ deps }) => {
        order.push("b");
        return `${deps.a}B`;
      },
    };

    const services = await installComponents(runtime, [b, a], { suffix: "!" });

    expect(order).toEqual(["a", "b"]);
    expect(services).toEqual({ a: "A!", b: "A!B" });
  });

  it("stops already-created components when a later constructor fails", async () => {
    const runtime = new AppRuntime("test");
    let released = false;
    const a: ComponentDefinition<Services, "a", never, Config> = {
      name: "a",
      create: ({ instance }) => {
        instance.own({
          id: "a",
          release: () => {
            released = true;
          },
        });
        return "A";
      },
    };
    const b: ComponentDefinition<Services, "b", "a", Config> = {
      name: "b",
      requires: ["a"],
      create: () => {
        throw new Error("broken b");
      },
    };

    await expect(installComponents(runtime, [a, b], { suffix: "" })).rejects.toThrow("broken b");
    expect(released).toBe(true);
    expect(runtime.root.isStopped).toBe(true);
  });

  it("rejects unknown dependencies and dependency cycles before construction", async () => {
    const unknown = new AppRuntime("unknown");
    await expect(
      installComponents<Services, Config>(
        unknown,
        [{ name: "a", requires: ["missing" as "a"], create: () => "A" }],
        { suffix: "" },
      ),
    ).rejects.toThrow(/unknown component/);

    const cyclic = new AppRuntime("cyclic");
    await expect(
      installComponents<Services, Config>(
        cyclic,
        [
          { name: "a", requires: ["b"], create: () => "A" },
          { name: "b", requires: ["a"], create: () => "B" },
        ],
        { suffix: "" },
      ),
    ).rejects.toThrow(/cycle/);
  });
});
