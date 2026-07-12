import { describe, expect, it } from "vitest";
import { Bus } from "./bus.js";

class Ping {
  constructor(readonly n: number) {}
}
class Pong {
  constructor(readonly s: string) {}
}

describe("Bus", () => {
  it("fans an emitted fact out to handlers of its class only", () => {
    const bus = new Bus();
    const pings: number[] = [];
    const pongs: string[] = [];
    bus.on(Ping, (p) => pings.push(p.n));
    bus.on(Pong, (p) => pongs.push(p.s));

    bus.emit(new Ping(1));
    bus.emit(new Pong("x"));
    bus.emit(new Ping(2));

    expect(pings).toEqual([1, 2]);
    expect(pongs).toEqual(["x"]);
  });

  it("unsubscribe stops further delivery to that handler", () => {
    const bus = new Bus();
    const got: number[] = [];
    const sub = bus.on(Ping, (p) => got.push(p.n));

    bus.emit(new Ping(1));
    sub?.unsubscribe();
    bus.emit(new Ping(2));

    expect(got).toEqual([1]);
  });

  it("a throwing handler is detached; siblings still receive", () => {
    const bus = new Bus();
    const ok: number[] = [];
    bus.on(Ping, () => {
      throw new Error("boom");
    });
    bus.on(Ping, (p) => ok.push(p.n));

    bus.emit(new Ping(5));
    bus.emit(new Ping(6)); // the thrower is gone; only the survivor hears this

    expect(ok).toEqual([5, 6]);
  });

  it("on() returns null and emit() throws after dispose", () => {
    const bus = new Bus();
    bus.on(Ping, () => {});

    bus.dispose();

    expect(bus.on(Ping, () => {})).toBeNull();
    expect(() => bus.emit(new Ping(1))).toThrow(/closed/);
  });

  it("dispose is idempotent", () => {
    const bus = new Bus();
    bus.dispose();
    expect(() => bus.dispose()).not.toThrow();
  });
});
