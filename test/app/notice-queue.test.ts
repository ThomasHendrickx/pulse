import { describe, expect, it } from "vitest";
import {
  createNoticeQueue,
  enterNoticeQueue,
  isNoticeShowing,
  leaveNoticeQueue,
  subscribeToNotices,
} from "@/modules/merchants/ui/notice-queue";

// M3-P11 fix round, finding HZ-M3P11-01. Every notice is drawn in the same
// fixed rectangle, so two at once means one is covered and unread. These
// rules are what makes that impossible: one on screen at a time, in the
// order raised, and nothing leaves until the reader dismisses it.

describe("the notice queue", () => {
  // WHICH ONE IS ON SCREEN (round two, finding HZ2-M3P11-02). It is the
  // notice from the reader's MOST RECENT action, not the oldest one
  // waiting: a reader who presses a control and is shown a sentence about
  // a different row has been answered about something they did not do.
  it("shows one notice at a time, and it is the one raised most recently", () => {
    const queue = createNoticeQueue();
    enterNoticeQueue(queue, "row-a");
    enterNoticeQueue(queue, "row-b");
    expect(isNoticeShowing(queue, "row-b")).toBe(true);
    expect(isNoticeShowing(queue, "row-a")).toBe(false);
  });

  it("reveals the waiting notice when the reader dismisses the one on screen", () => {
    const queue = createNoticeQueue();
    enterNoticeQueue(queue, "row-a");
    enterNoticeQueue(queue, "row-b");
    leaveNoticeQueue(queue, "row-b");
    expect(isNoticeShowing(queue, "row-a")).toBe(true);
  });

  // The sequence the finding walked: row A's notice is up, row B's is
  // waiting, and the reader acts on row A again. What appears must be
  // about row A.
  it("puts a row that raises again back on screen, keeping one entry for it", () => {
    const queue = createNoticeQueue();
    enterNoticeQueue(queue, "row-a");
    enterNoticeQueue(queue, "row-b");
    enterNoticeQueue(queue, "row-a");
    expect(isNoticeShowing(queue, "row-a")).toBe(true);
    expect(queue.waiting).toEqual(["row-b", "row-a"]);
    // ... and row B's notice is still there, waiting rather than lost.
    leaveNoticeQueue(queue, "row-a");
    expect(isNoticeShowing(queue, "row-b")).toBe(true);
  });

  it("never drops a notice the reader has not dismissed", () => {
    const queue = createNoticeQueue();
    enterNoticeQueue(queue, "row-a");
    enterNoticeQueue(queue, "row-b");
    enterNoticeQueue(queue, "row-c");
    // A row that raises again holds ONE entry, never two, so nothing is
    // duplicated and nothing is starved.
    enterNoticeQueue(queue, "row-b");
    expect(queue.waiting).toEqual(["row-a", "row-c", "row-b"]);
    leaveNoticeQueue(queue, "row-b");
    expect(queue.waiting).toEqual(["row-a", "row-c"]);
    expect(isNoticeShowing(queue, "row-c")).toBe(true);
  });

  it("wakes every row when the front of the queue changes, and stops when unsubscribed", () => {
    const queue = createNoticeQueue();
    let woken = 0;
    const unsubscribe = subscribeToNotices(queue, () => {
      woken += 1;
    });
    enterNoticeQueue(queue, "row-a");
    leaveNoticeQueue(queue, "row-a");
    expect(woken).toBe(2);
    unsubscribe();
    enterNoticeQueue(queue, "row-b");
    expect(woken).toBe(2);
  });

  it("leaves the queue untouched when a row that holds no notice leaves", () => {
    const queue = createNoticeQueue();
    enterNoticeQueue(queue, "row-a");
    leaveNoticeQueue(queue, "row-z");
    expect(queue.waiting).toEqual(["row-a"]);
  });
});
