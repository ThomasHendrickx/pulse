// THE NOTICE QUEUE (M3-P11 fix round, finding HZ-M3P11-01).
//
// THE PROBLEM IT ANSWERS. Every notice is drawn in ONE fixed rectangle at
// the bottom of the viewport, so two notices raised at the same time
// occupy the same place and the later one paints over the earlier. That is
// the harm decision D-32 removed the timer to prevent: "a transient notice
// that is missed leaves no trace, and a reverted value on a screen full of
// figures then reads as a value the reader entered themselves". An
// occluded notice is a missed notice.
//
// WHY THE OBVIOUS FIX IS NOT AVAILABLE HERE, with the decision quoted
// rather than paraphrased. Decision D-32 settles the layout: "ONE HOST PER
// ROW, not a shared one: a shared toast host would need state above the
// rows, which means a provider, which means the rows' parent becomes a
// client component and the merchant review's list ships to the browser.
// Two simultaneous failures would overlap; at the failure rate the owner
// estimated that is a cosmetic risk this plan accepts rather than paying a
// boundary for, and a shared host is parked for the day a second surface
// needs one." Two further pins close the other routes: criterion 11.5
// requires the difference notice to be "present on that row", so the
// notice cannot be portalled out of its row into a shared region; and
// criterion 11.9 requires the stylesheet's px and rem line count to be
// unchanged while criterion 11.8 pins styles/tokens.css to an empty diff,
// so a stacking offset can be neither a literal length nor a new token.
//
// SO THE COLLISION IS MADE IMPOSSIBLE INSTEAD OF SURVIVABLE. At most one
// notice is displayed at a time, in the order the notices were raised. A
// notice that arrives while another is up WAITS rather than covering it,
// and appears when the reader dismisses the one in front. Nothing is
// removed that the reader has not dismissed, which is the property D-32
// bought with the timer, and nothing is hidden behind anything.
//
// It is a pure module, not React state above the rows, so D-32's reason
// for one host per row is untouched: no provider is introduced and the
// merchant review's list stays a server component. Its only consumer today
// is the merchants row leaf; if a second surface ever raises notices, this
// moves to src/platform/ui beside the toast it serves rather than being
// copied.

export type NoticeQueue = {
  waiting: readonly string[];
  listeners: Set<() => void>;
};

export const createNoticeQueue = (): NoticeQueue => ({
  waiting: [],
  listeners: new Set(),
});

const announce = (queue: NoticeQueue): void => {
  for (const listener of [...queue.listeners]) {
    listener();
  }
};

export const subscribeToNotices = (
  queue: NoticeQueue,
  listener: () => void,
): (() => void) => {
  queue.listeners.add(listener);
  return () => {
    queue.listeners.delete(listener);
  };
};

// Join the queue. Idempotent: a row that re-renders while its notice is up
// keeps its place rather than moving to the back.
export const enterNoticeQueue = (queue: NoticeQueue, id: string): void => {
  if (queue.waiting.includes(id)) {
    return;
  }
  queue.waiting = [...queue.waiting, id];
  announce(queue);
};

// Leave it, on dismissal or on unmount. Removes only this notice.
export const leaveNoticeQueue = (queue: NoticeQueue, id: string): void => {
  if (!queue.waiting.includes(id)) {
    return;
  }
  queue.waiting = queue.waiting.filter((entry) => entry !== id);
  announce(queue);
};

// The one notice on screen is the one that has waited longest.
export const isNoticeShowing = (queue: NoticeQueue, id: string): boolean =>
  queue.waiting[0] === id;

export const noticeQueue: NoticeQueue = createNoticeQueue();
