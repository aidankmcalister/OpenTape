/**
 * Lets one async job run at a time, for actions a double click, a held key or a second listener
 * could start twice. A job started while another is running is dropped, and gives undefined.
 */
export function oneAtATime() {
  let isRunning = false;
  return async function run<T>(job: () => Promise<T>): Promise<T | undefined> {
    if (isRunning) return undefined;
    isRunning = true;
    try {
      return await job();
    } finally {
      isRunning = false;
    }
  };
}

export type OneAtATime = ReturnType<typeof oneAtATime>;
