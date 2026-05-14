/**
 * missedNotifQueue — shared sequential execution queue for missed-notification
 * replay functions.
 *
 * Both `useMissedOrderNotifications` and `useMissedPushLogNotifications` call
 * this to ensure their async replay functions never overlap. Sequential
 * execution prevents the cold-start race where both hooks fire a local
 * notification for the same order status change before either has a chance to
 * write the updated status to AsyncStorage.
 *
 * Usage:
 *   queueMissedNotifReplay(() => replayMissedNotifications(uid));
 *
 * The queue is a promise chain: each call appends a new task to the tail. If
 * the previous task throws, the error is swallowed and the next task still
 * runs (both slots are handled: then + catch).
 */

let _tail: Promise<void> = Promise.resolve();

/**
 * Enqueue an async replay function. Returns immediately; the function runs
 * after all previously queued functions have settled.
 */
export function queueMissedNotifReplay(fn: () => Promise<void>): void {
  _tail = _tail.then(() => fn(), () => fn());
}
