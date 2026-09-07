import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {createMobileKeyboardChangeNotifier} from "./mobileKeyboardChange";

const createNotifier = () => {
    const changes: boolean[] = [];
    const timers = new Map<number, () => void>();
    let timer = 0;
    const notify = createMobileKeyboardChangeNotifier({
        dispatch: (open) => changes.push(open),
        setTimer: (callback) => {
            timer++;
            timers.set(timer, callback);
            return timer;
        },
        clearTimer: (timerID) => timers.delete(timerID),
        closeDelay: 300,
    });
    return {
        changes,
        notify,
        runTimers: () => {
            const callbacks = [...timers.values()];
            timers.clear();
            callbacks.forEach(callback => callback());
        },
        timers,
    };
};

describe("mobile keyboard change", () => {
    it("reports opening immediately and closing after the transition", () => {
        const notifier = createNotifier();

        notifier.notify(true);
        assert.deepEqual(notifier.changes, [true]);

        notifier.notify(false);
        assert.deepEqual(notifier.changes, [true]);
        assert.equal(notifier.timers.size, 1);

        notifier.runTimers();
        assert.deepEqual(notifier.changes, [true, false]);
    });

    it("cancels a pending close when the keyboard opens again", () => {
        const notifier = createNotifier();

        notifier.notify(false);
        notifier.notify(true);
        notifier.runTimers();

        assert.deepEqual(notifier.changes, [true]);
    });

    it("restarts the close delay when another close notification arrives", () => {
        const notifier = createNotifier();

        notifier.notify(false);
        notifier.notify(false);
        assert.equal(notifier.timers.size, 1);

        notifier.runTimers();
        assert.deepEqual(notifier.changes, [false]);
    });
});
