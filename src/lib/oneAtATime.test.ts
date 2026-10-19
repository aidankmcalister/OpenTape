import { expect, test } from "bun:test";
import { oneAtATime } from "./oneAtATime";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a second job while the first runs should be dropped", async () => {
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
});

test("a job after the first finishes should run and give its result", async () => {
  const run = oneAtATime();
  await run(async () => "first");
  expect(await run(async () => "second")).toBe("second");
});

test("a failed job should pass its error on and free the next one", async () => {
  const run = oneAtATime();
  const failing = deferred();
  const running = run(() => failing.promise);
  failing.reject(new Error("no disk"));
  await expect(running).rejects.toThrow("no disk");
  expect(await run(async () => "after")).toBe("after");
});

test("separate gates should not block each other", async () => {
  const save = oneAtATime();
  const copy = oneAtATime();
  const saving = deferred();
  const running = save(() => saving.promise);
  expect(await copy(async () => "copied")).toBe("copied");
  saving.resolve();
  await running;
});
