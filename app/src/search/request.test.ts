import {after, before, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {cancelSearchRequest, scheduleSearchRequest} from "./request";

const nextTimer = () => new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
});

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return {
        promise,
        resolve: () => resolve(),
    };
};

describe("search request scheduling", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

    before(() => {
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                clearTimeout,
                setTimeout,
            },
        });
    });

    after(() => {
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    });

    it("runs one request at a time and invalidates stale responses", async () => {
        const element = {isConnected: true} as Element;
        const firstDone = deferred();
        const firstStarted = deferred();
        const secondStarted = deferred();
        const idle = deferred();
        let firstIsCurrent!: () => boolean;
        let activeRequests = 0;
        let maxActiveRequests = 0;

        scheduleSearchRequest({
            element,
            delay: 0,
            onIdle: idle.resolve,
            createTask(version) {
                return {
                    method: 0,
                    version,
                    run(_signal, isCurrent) {
                        firstIsCurrent = isCurrent;
                        activeRequests++;
                        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
                        firstStarted.resolve();
                        return firstDone.promise.finally(() => {
                            activeRequests--;
                        });
                    },
                };
            },
        });
        await firstStarted.promise;

        scheduleSearchRequest({
            element,
            delay: 0,
            onIdle: idle.resolve,
            createTask(version) {
                return {
                    method: 0,
                    version,
                    run() {
                        activeRequests++;
                        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
                        secondStarted.resolve();
                        activeRequests--;
                    },
                };
            },
        });
        await nextTimer();

        assert.equal(firstIsCurrent(), false);
        assert.equal(activeRequests, 1);
        firstDone.resolve();
        await secondStarted.promise;
        await idle.promise;
        assert.equal(maxActiveRequests, 1);
    });

    it("aborts a running SQL request when a newer search is scheduled", async () => {
        const element = {isConnected: true} as Element;
        const firstStarted = deferred();
        const secondStarted = deferred();
        const idle = deferred();
        let sqlSignal!: AbortSignal;

        scheduleSearchRequest({
            element,
            delay: 0,
            onIdle: idle.resolve,
            createTask(version) {
                return {
                    method: 2,
                    version,
                    run(signal) {
                        sqlSignal = signal;
                        firstStarted.resolve();
                        return new Promise<void>((resolve) => {
                            signal.addEventListener("abort", () => resolve(), {once: true});
                        });
                    },
                };
            },
        });
        await firstStarted.promise;

        scheduleSearchRequest({
            element,
            delay: 0,
            onIdle: idle.resolve,
            createTask(version) {
                return {
                    method: 0,
                    version,
                    run() {
                        secondStarted.resolve();
                    },
                };
            },
        });

        assert.equal(sqlSignal.aborted, true);
        await secondStarted.promise;
        await idle.promise;
    });

    it("aborts the active request and drops the queued request when canceled", async () => {
        const element = {isConnected: true} as Element;
        const firstStarted = deferred();
        let firstSignal!: AbortSignal;
        let secondStarted = false;

        scheduleSearchRequest({
            element,
            delay: 0,
            onIdle() {
                // 搜索作用域销毁后无需更新界面
            },
            createTask(version) {
                return {
                    method: 0,
                    version,
                    run(signal) {
                        firstSignal = signal;
                        firstStarted.resolve();
                        return new Promise<void>((resolve) => {
                            signal.addEventListener("abort", () => resolve(), {once: true});
                        });
                    },
                };
            },
        });
        await firstStarted.promise;

        scheduleSearchRequest({
            element,
            delay: 0,
            onIdle() {
                // 搜索作用域销毁后无需更新界面
            },
            createTask(version) {
                return {
                    method: 0,
                    version,
                    run() {
                        secondStarted = true;
                    },
                };
            },
        });
        await nextTimer();
        cancelSearchRequest(element);
        await nextTimer();

        assert.equal(firstSignal.aborted, true);
        assert.equal(secondStarted, false);
    });
});
