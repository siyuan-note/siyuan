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

    it("aborts a running search when a newer search is scheduled", async () => {
        const element = {isConnected: true} as Element;
        const firstStarted = deferred();
        const secondStarted = deferred();
        const idle = deferred();
        let firstSignal!: AbortSignal;

        scheduleSearchRequest({
            element,
            delay: 0,
            onIdle: idle.resolve,
            createTask(version) {
                return {
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
            onIdle: idle.resolve,
            createTask(version) {
                return {
                    version,
                    run() {
                        secondStarted.resolve();
                    },
                };
            },
        });

        assert.equal(firstSignal.aborted, true);
        await secondStarted.promise;
        await idle.promise;
    });

    it("keeps non-cancelable backend searches serialized while invalidating their response", async () => {
        const element = {isConnected: true} as Element;
        const started = deferred();
        const done = deferred();
        const idle = deferred();
        let signal: AbortSignal;
        let isCurrent: () => boolean;
        let nextRuns = 0;
        scheduleSearchRequest({
            element, delay: 0, onIdle: idle.resolve,
            createTask: version => ({version, abortable: false, run(currentSignal, current) {
                signal = currentSignal;
                isCurrent = current;
                started.resolve();
                return done.promise;
            }}),
        });
        await started.promise;
        scheduleSearchRequest({
            element, delay: 0, onIdle: idle.resolve,
            createTask: version => ({version, run() { nextRuns++; }}),
        });
        await nextTimer();
        assert.equal(signal.aborted, false);
        assert.equal(isCurrent(), false);
        assert.equal(nextRuns, 0);
        done.resolve();
        await idle.promise;
        assert.equal(nextRuns, 1);
    });

    it("continues with the newest request after an aborted request rejects", async () => {
        const element = {isConnected: true} as Element;
        const started = deferred();
        const idle = deferred();
        let obsoleteRuns = 0;
        let currentRuns = 0;
        scheduleSearchRequest({
            element, delay: 0, onIdle: idle.resolve,
            createTask: version => ({version, run(signal) {
                started.resolve();
                return new Promise<void>((_resolve, reject) => {
                    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once: true});
                });
            }}),
        });
        await started.promise;
        scheduleSearchRequest({
            element, delay: 10, onIdle: idle.resolve,
            createTask: version => ({version, run() { obsoleteRuns++; }}),
        });
        scheduleSearchRequest({
            element, delay: 0, onIdle: idle.resolve,
            createTask: version => ({version, run(_signal, isCurrent) {
                assert.equal(isCurrent(), true);
                currentRuns++;
            }}),
        });
        await idle.promise;
        assert.equal(obsoleteRuns, 0);
        assert.equal(currentRuns, 1);
    });

    it("does not dispatch a search after its scope is disconnected", async () => {
        const element = {isConnected: true} as Element;
        let runs = 0;
        scheduleSearchRequest({
            element, delay: 0, onIdle() { /* 已销毁的作用域无需更新 */ },
            createTask: version => ({version, run() { runs++; }}),
        });
        Object.assign(element, {isConnected: false});
        await nextTimer();
        assert.equal(runs, 0);
        cancelSearchRequest(element);
    });

    it("aborts the active request and drops the queued request when canceled", async () => {
        const element = {isConnected: true} as Element;
        const firstStarted = deferred();
        const firstDone = deferred();
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
                    version,
                    run(signal) {
                        firstSignal = signal;
                        firstStarted.resolve();
                        // 保持旧请求未结束，让新任务真正排队后再销毁作用域。
                        return firstDone.promise;
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
                    version,
                    run() {
                        secondStarted = true;
                    },
                };
            },
        });
        await nextTimer();
        cancelSearchRequest(element);
        firstDone.resolve();
        await nextTimer();

        assert.equal(firstSignal.aborted, true);
        assert.equal(secondStarted, false);
    });
});
