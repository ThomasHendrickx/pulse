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
  it("shows one notice at a time, and it is the one raised first", () => {
    const queue = createNoticeQueue();
    enterNoticeQueue(queue, "row-a");
    enterNoticeQueue(queue, "row-b");
    expect(isNoticeShowing(queue, "row-a")).toBe(true);
    expect(isNoticeShowing(queue, "row-b")).toBe(false);
  });

  it("reveals the waiting notice when the reader dismisses the one in front", () => {
    const queue = createNoticeQueue();
    enterNoticeQueue(queue, "row-a");
    enterNoticeQueue(queue, "row-b");
    leaveNoticeQueue(queue, "row-a");
    expect(isNoticeShowing(queue, "row-b")).toBe(true);
  });

  it("never drops a notice the reader has not dismissed", () => {
    const queue = createNoticeQueue();
    enterNoticeQueue(queue, "row-a");
    enterNoticeQueue(queue, "row-b");
    enterNoticeQueue(queue, "row-c");
    // A second failure on the row already waiting keeps its place rather
    // than sending it to the back, so no notice can be starved.
    enterNoticeQueue(queue, "row-b");
    expect(queue.waiting).toEqual(["row-a", "row-b", "row-c"]);
    leaveNoticeQueue(queue, "row-a");
    expect(queue.waiting).toEqual(["row-b", "row-c"]);
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
