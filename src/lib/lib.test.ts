import { describe, expect, test } from "bun:test";
import { latestWins, oneAtATime } from "@/hooks/useTauri";
import {
  contains,
  fitInside,
  intersect,
  rectStyle,
  relativeTo,
  roundedRectPath,
} from "./geometry";
import {
  createClock,
  formatClock,
  formatTime,
  playingTime,
  seekTarget,
  seekVideo,
  twoDigits,
} from "./time";

describe("geometry", () => {
  const rect = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
  });
  const BOX = rect(100, 100, 400, 300);

  test.each([
    [{ x: 100, y: 100 }, true],
    [{ x: 499, y: 399 }, true],
    [{ x: 500, y: 200 }, false],
    [{ x: 200, y: 400 }, false],
  ])(
    "contains counts the top-left edge in, the bottom-right out: %o",
    (point, inside) => {
      expect(contains(BOX, point)).toBe(inside);
    },
  );

  test.each([
    [rect(400, 350, 300, 300), rect(400, 350, 100, 50), "overlapping"],
    [rect(600, 600, 10, 10), null, "apart"],
    [rect(500, 100, 50, 50), null, "sharing only an edge"],
  ])("intersect with %o is %o: %s", (other, shared) => {
    expect(intersect(BOX, other)).toEqual(shared);
  });

  test("relativeTo moves a rectangle into another display's coordinates", () => {
    const moved = rect(-1412, 120, 400, 300);
    expect(relativeTo(BOX, { x: 1512, y: -20 })).toEqual(moved);
  });

  test("rectStyle places an element at the rectangle", () => {
    expect(rectStyle(BOX)).toEqual({
      left: 100,
      top: 100,
      width: 400,
      height: 300,
    });
  });

  test.each([
    ["fills the width of a tall box", { width: 160, height: 200 }],
    ["fills the height of a wide box", { width: 400, height: 90 }],
  ])("fitInside %s", (_, bounds) => {
    expect(fitInside(bounds, 16 / 9)).toEqual({ width: 160, height: 90 });
  });

  test("roundedRectPath traces square corners with no corner", () => {
    expect(roundedRectPath({ x: 1, y: 2, width: 10, height: 20 }, 0)).toBe(
      "M1 2H11A0 0 0 0 1 11 2V22A0 0 0 0 1 11 22H1A0 0 0 0 1 1 22V2A0 0 0 0 1 1 2Z",
    );
  });

  test("roundedRectPath shrinks a corner too big for a narrow rectangle", () => {
    expect(
      roundedRectPath({ x: 0, y: 0, width: 10, height: 40 }, 20),
    ).toStartWith("M5 0H5A5 5 0 0 1 10 5");
  });
});

describe("time", () => {
  test.each([
    [0, "00:00.00"],
    [6350, "00:06.35"],
    [125_000, "02:05.00"],
    [999, "00:00.99"],
  ])("formatTime(%p) rounds down to %p", (ms, text) => {
    expect(formatTime(ms)).toBe(text);
  });

  test.each([
    [12_900, "00:12"],
    [605_000, "10:05"],
    [59_999, "00:59"],
    [3_725_000, "62:05"],
  ])(
    "formatClock(%p) rounds down to %p, counting minutes past an hour",
    (ms, text) => {
      expect(formatClock(ms)).toBe(text);
    },
  );

  test("twoDigits pads single digits only", () => {
    expect([twoDigits(7), twoDigits(42)]).toEqual(["07", "42"]);
  });
});

describe("clock", () => {
  test("tells its listeners only when the time changes, until they unsubscribe", () => {
    const clock = createClock();
    let heard = 0;
    const stop = clock.subscribe(() => heard++);
    clock.set(1.5);
    clock.set(1.5);
    clock.set(2);
    expect(heard).toBe(2);
    expect(clock.seconds()).toBe(2);
    stop();
    clock.set(3);
    expect(heard).toBe(2);
  });
});

test.each([
  ["follows the video forward", 2, 2.1, 2.1],
  ["holds through a small step back", 2.1, 2.0, 2.1],
  ["follows a big jump back, like a loop", 9.8, 0.1, 0.1],
])("the playing time %s", (_, shown, current, expected) => {
  expect(playingTime(shown, current)).toBe(expected);
});

describe("oneAtATime", () => {
  function deferred() {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  test("drops a second job while the first runs", async () => {
    const run = oneAtATime();
    const first = deferred();
    let calls = 0;
    const job = () => {
      calls++;
      return first.promise;
    };
    const running = run(job);
    expect(await run(job)).toBeUndefined();
    first.resolve();
    await running;
    expect(calls).toBe(1);
    expect(await run(async () => "next")).toBe("next");
  });

  test("passes a failed job's error on and frees the next one", async () => {
    const run = oneAtATime();
    const failing = deferred();
    const running = run(() => failing.promise);
    failing.reject(new Error("no disk"));
    await expect(running).rejects.toThrow("no disk");
    expect(await run(async () => "after")).toBe("after");
  });

  test("separate gates don't block each other", async () => {
    const save = oneAtATime();
    const copy = oneAtATime();
    const saving = deferred();
    const running = save(() => saving.promise);
    expect(await copy(async () => "copied")).toBe("copied");
    saving.resolve();
    await running;
  });
});

describe("latestWins", () => {
  function play(arrivals: ["answer" | "event", string][]) {
    const order = latestWins();
    const shown: string[] = [];
    const show = (value: string) => void shown.push(value);
    for (const [kind, value] of arrivals) order[kind](value, show);
    return shown;
  }

  test("drops an answer that an event beat", () => {
    const shown = play([
      ["event", "recording"],
      ["answer", "idle"],
      ["event", "paused"],
    ]);
    expect(shown).toEqual(["recording", "paused"]);
  });

  test("shows an answer that came first, then each event", () => {
    const shown = play([
      ["answer", "idle"],
      ["event", "recording"],
    ]);
    expect(shown).toEqual(["idle", "recording"]);
  });
});

describe("seekVideo", () => {
  class FakeVideo extends EventTarget {
    seeking = false;
    started: number[] = [];
    #seconds = 0;
    get currentTime() {
      return this.#seconds;
    }
    set currentTime(seconds: number) {
      this.#seconds = seconds;
      this.seeking = true;
      this.started.push(seconds);
    }
    land() {
      this.seeking = false;
      this.dispatchEvent(new Event("seeked"));
    }
  }

  test("seeks while nothing else is seeking, and keeps only the latest while one is", () => {
    const fake = new FakeVideo();
    const video = fake as unknown as HTMLVideoElement;
    seekVideo(video, 1);
    seekVideo(video, 2);
    seekVideo(video, 3);
    expect(fake.started).toEqual([1]);
    expect(seekTarget(video)).toBe(3);

    fake.land();
    expect(fake.started).toEqual([1, 3]);
    fake.land();
    expect(fake.started).toEqual([1, 3]);
    expect(seekTarget(video)).toBe(3);
  });
});
