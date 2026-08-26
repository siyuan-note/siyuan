import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getViewStateKey,
    type IViewStateTransport,
    type TViewStateData,
    ViewStateService
} from "./viewState";

const deferred = <T>() => {
    let resolve: (value: T | PromiseLike<T>) => void;
    let reject: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve: resolve!, reject: reject!};
};

const createTransport = (options?: {
    get?: (key: string) => Promise<TViewStateData>,
    patch?: (key: string, values: TViewStateData, removeKeys: string[]) => Promise<void>,
}): IViewStateTransport => ({
    get: options?.get || (async () => ({})),
    patch: options?.patch || (async () => undefined),
});

const identity = {
    scope: "backlink",
    surface: "bottom",
    hostID: "20260820000000-host",
};

describe("getViewStateKey", () => {
    it("builds an unambiguous stable key from the complete identity", () => {
        assert.equal(getViewStateKey(identity), "backlink:bottom:20260820000000-host");
        assert.equal(getViewStateKey({
            scope: "scope:one",
            surface: "surface/two",
            hostID: "host three",
        }), "scope%3Aone:surface%2Ftwo:host%20three");
        assert.notEqual(
            getViewStateKey({scope: "a:b", surface: "c", hostID: "d"}),
            getViewStateKey({scope: "a", surface: "b:c", hostID: "d"}),
        );
    });

    it("rejects incomplete identities", () => {
        assert.throws(() => getViewStateKey({...identity, scope: ""}));
        assert.throws(() => getViewStateKey({...identity, surface: ""}));
        assert.throws(() => getViewStateKey({...identity, hostID: ""}));
    });
});

describe("ViewStateService", () => {
    it("loads only its exact key and sends field-level changes including false", async () => {
        const getKeys: string[] = [];
        const patches: Array<{key: string, values: TViewStateData, removeKeys: string[]}> = [];
        const service = new ViewStateService(identity, {
            flushDelay: 60_000,
            transport: createTransport({
                async get(key) {
                    getKeys.push(key);
                    return {unchanged: "remote", folded: true};
                },
                async patch(key, values, removeKeys) {
                    patches.push({key, values, removeKeys});
                },
            }),
        });

        await service.ready;
        assert.deepEqual(getKeys, [service.key]);
        assert.equal(service.get<boolean>("folded"), true);
        service.set("folded", false);
        await service.flush();

        assert.equal(service.has("folded"), true);
        assert.equal(service.get<boolean>("folded"), false);
        assert.deepEqual(patches, [{
            key: service.key,
            values: {folded: false},
            removeKeys: [],
        }]);
        await service.destroy();
    });

    it("preserves local sets and removals made while loading", async () => {
        const loading = deferred<TViewStateData>();
        const patches: Array<{values: TViewStateData, removeKeys: string[]}> = [];
        const service = new ViewStateService(identity, {
            flushDelay: 60_000,
            transport: createTransport({
                get: async () => loading.promise,
                async patch(_key, values, removeKeys) {
                    patches.push({values, removeKeys});
                },
            }),
        });

        service.set("folded", false);
        service.remove("removed");
        loading.resolve({folded: true, removed: "remote", untouched: 42});
        await service.ready;

        assert.equal(service.get<boolean>("folded"), false);
        assert.equal(service.has("removed"), false);
        assert.equal(service.get<number>("untouched"), 42);
        await service.flush();
        assert.deepEqual(patches, [{
            values: {folded: false},
            removeKeys: ["removed"],
        }]);
        await service.destroy();
    });

    it("serializes flushes and carries changes made during an active request", async () => {
        const firstStarted = deferred<void>();
        const firstRelease = deferred<void>();
        const calls: TViewStateData[] = [];
        let active = 0;
        let maxActive = 0;
        const service = new ViewStateService(identity, {
            flushDelay: 60_000,
            transport: createTransport({
                async patch(_key, values) {
                    active++;
                    maxActive = Math.max(maxActive, active);
                    calls.push(values);
                    if (calls.length === 1) {
                        firstStarted.resolve();
                        await firstRelease.promise;
                    }
                    active--;
                },
            }),
        });
        await service.ready;

        service.set("first", 1);
        const firstFlush = service.flush();
        await firstStarted.promise;
        service.set("second", 2);
        const secondFlush = service.flush();
        await Promise.resolve();
        assert.equal(calls.length, 1);
        firstRelease.resolve();
        await Promise.all([firstFlush, secondFlush]);

        assert.equal(maxActive, 1);
        assert.deepEqual(calls, [{first: 1}, {second: 2}]);
        await service.destroy();
    });

    it("debounces adjacent changes into one patch", async () => {
        const patched = deferred<void>();
        const calls: TViewStateData[] = [];
        const service = new ViewStateService(identity, {
            flushDelay: 10,
            transport: createTransport({
                async patch(_key, values) {
                    calls.push(values);
                    patched.resolve();
                },
            }),
        });
        await service.ready;

        service.set("first", 1);
        service.set("first", 2);
        service.set("second", false);
        await patched.promise;

        assert.deepEqual(calls, [{first: 2, second: false}]);
        await service.destroy();
    });

    it("requeues a failed patch without overwriting newer changes", async () => {
        const firstStarted = deferred<void>();
        const firstRelease = deferred<void>();
        const calls: TViewStateData[] = [];
        let failFirst = true;
        const service = new ViewStateService(identity, {
            flushDelay: 60_000,
            transport: createTransport({
                async patch(_key, values) {
                    calls.push(values);
                    if (failFirst) {
                        failFirst = false;
                        firstStarted.resolve();
                        await firstRelease.promise;
                        throw new Error("temporary failure");
                    }
                },
            }),
        });
        await service.ready;

        service.set("value", 1);
        const failedFlush = service.flush();
        await firstStarted.promise;
        service.set("value", 2);
        firstRelease.resolve();
        await assert.rejects(failedFlush);
        await service.flush();

        assert.deepEqual(calls, [{value: 1}, {value: 2}]);
        await service.destroy();
    });

    it("waits for loading and flushes pending changes on destroy", async () => {
        const loading = deferred<TViewStateData>();
        const patches: TViewStateData[] = [];
        const service = new ViewStateService(identity, {
            flushDelay: 60_000,
            transport: createTransport({
                get: async () => loading.promise,
                async patch(_key, values) {
                    patches.push(values);
                },
            }),
        });

        service.set("expanded", false);
        const destroying = service.destroy();
        await Promise.resolve();
        assert.deepEqual(patches, []);
        loading.resolve({expanded: true});
        await destroying;

        assert.deepEqual(patches, [{expanded: false}]);
        assert.throws(() => service.set("expanded", true));
    });

    it("continues with in-memory state when the initial read fails", async () => {
        const patches: TViewStateData[] = [];
        const originalConsoleError = console.error;
        console.error = () => undefined;
        const service = new ViewStateService(identity, {
            flushDelay: 60_000,
            transport: createTransport({
                get: async () => Promise.reject(new Error("unavailable")),
                async patch(_key, values) {
                    patches.push(values);
                },
            }),
        });
        try {
            await service.ready;
            service.set("expanded", false);
            await service.flush();
            assert.deepEqual(patches, [{expanded: false}]);
            await service.destroy();
        } finally {
            console.error = originalConsoleError;
        }
    });

    it("splits large pending changes by the kernel patch limits", async () => {
        const patches: Array<{values: TViewStateData, removeKeys: string[]}> = [];
        const service = new ViewStateService(identity, {
            flushDelay: 60_000,
            transport: createTransport({
                async patch(_key, values, removeKeys) {
                    patches.push({values, removeKeys});
                },
            }),
        });
        await service.ready;

        for (let index = 0; index < 1001; index++) {
            service.set(`field-${index}`, index);
        }
        await service.flush();

        assert.equal(patches.length, 2);
        assert.equal(Object.keys(patches[0].values).length, 1000);
        assert.equal(Object.keys(patches[1].values).length, 1);
        await service.destroy();
    });

    it("splits values by serialized byte size and rejects a single oversized value", async () => {
        const patches: TViewStateData[] = [];
        const service = new ViewStateService(identity, {
            flushDelay: 60_000,
            transport: createTransport({
                async patch(_key, values) {
                    patches.push(values);
                },
            }),
        });
        await service.ready;

        service.set("first", "a".repeat(140 * 1024));
        service.set("second", "b".repeat(140 * 1024));
        await service.flush();
        assert.equal(patches.length, 2);
        assert.throws(() => service.set("oversized", "c".repeat(300 * 1024)));
        await service.destroy();
    });
});
