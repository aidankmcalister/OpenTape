import { expect, test } from "bun:test";
import { createClock, estimateTime } from "./clock";

test("a clock should tell its listeners only when the time changes", () => {
  const clock = createClock();
  let heard = 0;
  clock.subscribe(() => heard++);
  clock.set(1.5);
  clock.set(1.5);
  clock.set(2);
  expect(heard).toBe(2);
  expect(clock.seconds()).toBe(2);
});

test("an unsubscribed listener should hear nothing more", () => {
  const clock = createClock();
  let heard = 0;
  const stop = clock.subscribe(() => heard++);
  stop();
  clock.set(1);
  expect(heard).toBe(0);
});

const PLAYING = {
  currentTime: 2,
  playbackRate: 1,
  paused: false,
  duration: 10,
};

test("a playing video should count on from when its time last moved", () => {
  const last = { seconds: 2, at: 1000 };
  const { seconds, sighting } = estimateTime(last, 1250, PLAYING);
  expect(seconds).toBe(2.25);
  expect(sighting).toBe(last);
});

test("a moved time should restart the count from now", () => {
  const { seconds, sighting } = estimateTime({ seconds: 2, at: 1000 }, 1500, {
    ...PLAYING,
    currentTime: 2.4,
  });
  expect(seconds).toBe(2.4);
  expect(sighting).toEqual({ seconds: 2.4, at: 1500 });
});

test("the count should follow the playback rate", () => {
  const { seconds } = estimateTime({ seconds: 2, at: 1000 }, 1500, {
    ...PLAYING,
    playbackRate: 2,
  });
  expect(seconds).toBe(3);
});

test("a paused video should hold still", () => {
  const { seconds } = estimateTime({ seconds: 2, at: 1000 }, 5000, {
    ...PLAYING,
    paused: true,
  });
  expect(seconds).toBe(2);
});

test("the estimate should stop at the video's end", () => {
  const { seconds } = estimateTime({ seconds: 9.9, at: 0 }, 5000, {
    ...PLAYING,
    currentTime: 9.9,
  });
  expect(seconds).toBe(10);
});
