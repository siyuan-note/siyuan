import {test} from "node:test";
import {createLocalKernelRequest} from "./localKernelRequest";
import {isLocalKernelRequestTimeout} from "./kernelBootBudget";
const assert = require("node:assert/strict");

const createTimers = () => {
    const timers = [];
    return {
        timers,
        scheduleTimer: (callback, ms) => {
            timers.push({callback, ms});
            return timers.length;
        },
        cancelTimer: () => {},
    };
};

test("a request that outlives the timeout is reported as a local kernel timeout", async () => {
    const clock = createTimers();
    let rejectRequest;
    const fetchJSON = createLocalKernelRequest({
        fetch: () => new Promise((resolve, reject) => {
            rejectRequest = reject;
        }),
        timeoutMs: 5000,
        scheduleTimer: clock.scheduleTimer,
        cancelTimer: clock.cancelTimer,
    });
    const pending = fetchJSON("http://127.0.0.1:6806/api/system/version");
    assert.equal(clock.timers.length, 1);
    assert.equal(clock.timers[0].ms, 5000);
    clock.timers[0].callback();
    rejectRequest(new Error("aborted"));
    await assert.rejects(pending, error => isLocalKernelRequestTimeout(error));
});

test("transport failures keep their own message and always cancel the timer", async () => {
    let cancelled = 0;
    const fetchJSON = createLocalKernelRequest({
        fetch: async () => {
            throw new Error("ECONNREFUSED");
        },
        timeoutMs: 5000,
        scheduleTimer: () => 1,
        cancelTimer: () => {
            cancelled++;
        },
    });
    await assert.rejects(fetchJSON("http://127.0.0.1:6806/api/system/bootProgress"), /ECONNREFUSED/);
    assert.equal(isLocalKernelRequestTimeout({name: "LocalKernelRequestTimeoutError"}), true);
    assert.equal(cancelled, 1);
});
