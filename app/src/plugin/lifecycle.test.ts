import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    PluginLifecycleCoordinator,
    type IPluginLifecycleAdapter,
    type IPluginLifecycleOptions,
} from "./lifecycle";

interface ITestPluginData {
    name: string;
    revision: number;
}

interface ITestPlugin extends ITestPluginData {
    disposed: boolean;
}

const deferred = <T>() => {
    let resolve: (value: T) => void;
    let reject: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return {promise, resolve, reject};
};

const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const flushMicrotasks = async () => {
    for (let i = 0; i < 8; i++) {
        await Promise.resolve();
    }
};

class FakeClock {
    public now = 0;
    private nextTimer = 1;
    private readonly timers = new Map<number, {at: number, callback: () => void}>();

    public setTimeout = (callback: () => void, delay: number) => {
        const timer = this.nextTimer++;
        this.timers.set(timer, {at: this.now + delay, callback});
        return timer as unknown as ReturnType<typeof setTimeout>;
    };

    public clearTimeout = (timer: ReturnType<typeof setTimeout>) => {
        this.timers.delete(timer as unknown as number);
    };

    public advance(milliseconds: number) {
        this.now += milliseconds;
        Array.from(this.timers.entries())
            .filter(([, timer]) => timer.at <= this.now)
            .sort((first, second) => first[1].at - second[1].at)
            .forEach(([id, timer]) => {
                this.timers.delete(id);
                timer.callback();
            });
    }
}

const createHarness = (overrides: Partial<IPluginLifecycleAdapter<ITestPluginData, ITestPlugin>> = {},
                       teardownTimeout = 20, options: IPluginLifecycleOptions = {}) => {
    const events: string[] = [];
    const instances: ITestPlugin[] = [];
    const adapter: IPluginLifecycleAdapter<ITestPluginData, ITestPlugin> = {
        create(data) {
            events.push(`create:${data.name}:${data.revision}`);
            return {...data, disposed: false};
        },
        attach(plugin) {
            assert.equal(instances.some(item => item.name === plugin.name && !item.disposed), false);
            instances.push(plugin);
            events.push(`attach:${plugin.name}`);
        },
        onload(plugin) {
            events.push(`onload:${plugin.name}`);
        },
        init(plugin) {
            events.push(`init:${plugin.name}`);
        },
        onLayoutReady(plugin) {
            events.push(`layout:${plugin.name}`);
        },
        mount(plugin) {
            events.push(`mount:${plugin.name}`);
        },
        onDataChanged(plugin) {
            events.push(`data:${plugin.name}`);
        },
        onunload(plugin) {
            events.push(`onunload:${plugin.name}`);
        },
        uninstall(plugin) {
            events.push(`uninstall:${plugin.name}`);
        },
        markDisposed(plugin) {
            plugin.disposed = true;
            events.push(`markDisposed:${plugin.name}`);
        },
        dispose(plugin, uninstall) {
            events.push(`dispose:${plugin.name}:${uninstall}`);
        },
        onError(name, hook) {
            events.push(`error:${name}:${hook}`);
        },
        ...overrides,
    };
    return {
        coordinator: new PluginLifecycleCoordinator(adapter, {...options, teardownTimeout}),
        events,
        instances,
    };
};

describe("plugin lifecycle coordinator", () => {
    it("keeps one instance and one layout hook for repeated loads", async () => {
        const {coordinator, events, instances} = createHarness();
        coordinator.start();
        await coordinator.setLayoutReady();

        await Promise.all([
            coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1})),
            coordinator.requestLoad("sample", async () => ({name: "sample", revision: 2})),
        ]);
        await coordinator.setLayoutReady();

        assert.equal(instances.length, 1);
        assert.equal(instances[0].revision, 2);
        assert.equal(events.filter(item => item === "layout:sample").length, 1);
        assert.equal(events.filter(item => item === "mount:sample").length, 1);
        assert.equal(coordinator.getState("sample"), "ready");
    });

    it("disposes a created instance when attaching it fails", async () => {
        const {coordinator, events} = createHarness({
            attach() {
                throw new Error("duplicate instance");
            },
        });
        coordinator.start();

        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        assert.equal(coordinator.getState("sample"), "absent");
        assert.deepEqual(events.slice(-3), [
            "error:sample:attach",
            "markDisposed:sample",
            "dispose:sample:false",
        ]);
    });

    it("discards stale and out-of-order batch responses", async () => {
        const {coordinator, events} = createHarness();
        coordinator.start();
        const firstBatch = coordinator.beginLoadBatch();
        const secondBatch = coordinator.beginLoadBatch();

        await coordinator.requestBatchLoad("sample", {name: "sample", revision: 1}, firstBatch);
        await coordinator.requestUnload("sample");
        await coordinator.requestBatchLoad("sample", {name: "sample", revision: 2}, secondBatch);

        assert.deepEqual(events.filter(item => item.startsWith("create:")), []);
        assert.equal(coordinator.getState("sample"), "absent");
    });

    it("keeps buffered structural intent ahead of the initial catalog", async () => {
        const {coordinator, events} = createHarness();
        const unloading = coordinator.requestUnload("sample");
        const initialBatch = coordinator.beginLoadBatch(true);
        const loading = coordinator.requestBatchLoad("sample", {name: "sample", revision: 1}, initialBatch);

        coordinator.start();
        await Promise.all([unloading, loading]);

        assert.deepEqual(events.filter(item => item.startsWith("create:")), []);
        assert.equal(coordinator.getState("sample"), "absent");
    });

    it("accepts the latest load batch", async () => {
        const {coordinator} = createHarness();
        coordinator.start();
        coordinator.beginLoadBatch();
        const latestBatch = coordinator.beginLoadBatch();

        await coordinator.requestBatchLoad("sample", {name: "sample", revision: 2}, latestBatch);

        assert.equal(coordinator.getInstance("sample")?.revision, 2);
    });

    it("latches layout readiness while onload is pending", async () => {
        const loaded = deferred<void>();
        const {coordinator, events} = createHarness({
            onload(plugin) {
                events.push(`onload:${plugin.name}`);
                return loaded.promise;
            },
        });
        coordinator.start();
        const loading = coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));
        await nextTurn();

        await coordinator.setLayoutReady();
        loaded.resolve();
        await loading;

        assert.deepEqual(events.slice(-3), ["init:sample", "layout:sample", "mount:sample"]);
        assert.equal(coordinator.getState("sample"), "ready");
    });

    it("continues initialization and mounting after load hook rejections", async () => {
        const {coordinator, events} = createHarness({
            onload(plugin) {
                events.push(`onload:${plugin.name}`);
                return Promise.reject(new Error("onload failed"));
            },
            onLayoutReady(plugin) {
                events.push(`layout:${plugin.name}`);
                return Promise.reject(new Error("layout failed"));
            },
        });
        coordinator.start();
        await coordinator.setLayoutReady();

        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        assert.equal(events.includes("error:sample:onload"), true);
        assert.equal(events.includes("init:sample"), true);
        assert.equal(events.includes("error:sample:onLayoutReady"), true);
        assert.equal(events.includes("mount:sample"), true);
        assert.equal(coordinator.getState("sample"), "ready");
    });

    it("skips construction when unload arrives while load data is pending", async () => {
        const never = new Promise<ITestPluginData>(() => undefined);
        const {coordinator, events} = createHarness();
        coordinator.start();
        const loading = coordinator.requestLoad("sample", () => never);
        await nextTurn();

        const unloading = coordinator.requestUnload("sample");
        await Promise.all([loading, unloading]);

        assert.deepEqual(events.filter(item => item.startsWith("create:")), []);
        assert.equal(coordinator.getState("sample"), "absent");
    });

    it("waits for onload before unloading and skips layout", async () => {
        const loaded = deferred<void>();
        const {coordinator, events} = createHarness({
            onload(plugin) {
                events.push(`onload:${plugin.name}`);
                return loaded.promise;
            },
        });
        coordinator.start();
        await coordinator.setLayoutReady();
        const loading = coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));
        await nextTurn();
        const unloading = coordinator.requestUnload("sample");
        loaded.resolve();

        await Promise.all([loading, unloading]);

        assert.equal(events.includes("layout:sample"), false);
        assert.ok(events.indexOf("init:sample") < events.indexOf("onunload:sample"));
        assert.equal(coordinator.getState("sample"), "absent");
    });

    it("abandons a pending layout hook before unloading", async () => {
        const never = new Promise<void>(() => undefined);
        const {coordinator, events} = createHarness({
            onLayoutReady(plugin) {
                events.push(`layout:${plugin.name}`);
                return never;
            },
        }, 10);
        coordinator.start();
        await coordinator.setLayoutReady();
        const loading = coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));
        await nextTurn();

        const unloading = coordinator.requestUnload("sample");
        await Promise.all([loading, unloading]);

        assert.equal(events.includes("error:sample:onLayoutReady"), true);
        assert.equal(events.includes("mount:sample"), false);
        assert.equal(events.includes("dispose:sample:false"), true);
    });

    it("abandons pending onload before applying the teardown timeout", async () => {
        const never = new Promise<void>(() => undefined);
        const {coordinator, events} = createHarness({
            onload(plugin) {
                events.push(`onload:${plugin.name}`);
                return never;
            },
            onunload(plugin) {
                events.push(`onunload:${plugin.name}`);
                return never;
            },
        }, 10);
        coordinator.start();
        const loading = coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));
        await nextTurn();

        const unloading = coordinator.requestUnload("sample");
        await Promise.all([loading, unloading]);

        assert.equal(events.includes("init:sample"), false);
        assert.equal(events.includes("error:sample:onload"), true);
        assert.equal(events.includes("error:sample:onunload"), true);
        assert.equal(events.includes("dispose:sample:false"), true);
        assert.equal(coordinator.getState("sample"), "absent");
    });

    it("uses separate loading and teardown timeout budgets", async () => {
        const clock = new FakeClock();
        const never = new Promise<void>(() => undefined);
        const {coordinator, events} = createHarness({
            onload(plugin) {
                events.push(`onload:${plugin.name}`);
                return never;
            },
            onunload(plugin) {
                events.push(`onunload:${plugin.name}`);
                return never;
            },
        }, 5000, {
            now: () => clock.now,
            setTimeout: clock.setTimeout,
            clearTimeout: clock.clearTimeout,
        });
        coordinator.start();
        const loading = coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));
        await flushMicrotasks();
        const unloading = coordinator.requestUnload("sample");
        await flushMicrotasks();

        clock.advance(4999);
        await flushMicrotasks();
        assert.equal(events.includes("onunload:sample"), false);
        clock.advance(1);
        await flushMicrotasks();
        assert.equal(events.includes("onunload:sample"), true);
        assert.equal(events.includes("dispose:sample:false"), false);

        clock.advance(4999);
        await flushMicrotasks();
        assert.equal(events.includes("dispose:sample:false"), false);
        clock.advance(1);
        await flushMicrotasks();
        await Promise.all([loading, unloading]);

        assert.equal(clock.now, 10000);
        assert.equal(events.includes("dispose:sample:false"), true);
    });

    it("observes a load rejection that arrives after timeout", async () => {
        const loaded = deferred<void>();
        const {coordinator, events} = createHarness({
            onload(plugin) {
                events.push(`onload:${plugin.name}`);
                return loaded.promise;
            },
        }, 10);
        coordinator.start();
        const loading = coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));
        await nextTurn();

        const unloading = coordinator.requestUnload("sample");
        await Promise.all([loading, unloading]);
        loaded.reject(new Error("late failure"));
        await nextTurn();

        assert.equal(events.filter(item => item === "error:sample:onload").length, 2);
    });

    it("invokes uninstall even when onunload exhausts the shared deadline", async () => {
        const never = new Promise<void>(() => undefined);
        let uninstallCalls = 0;
        const {coordinator, events} = createHarness({
            onunload(plugin) {
                events.push(`onunload:${plugin.name}`);
                return never;
            },
            uninstall(plugin) {
                events.push(`uninstall:${plugin.name}`);
                uninstallCalls++;
                return never;
            },
        }, 10);
        coordinator.start();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        await coordinator.requestUninstall("sample");

        assert.equal(uninstallCalls, 1);
        assert.equal(events.includes("error:sample:onunload"), true);
        assert.equal(events.includes("error:sample:uninstall"), true);
        assert.equal(events.includes("dispose:sample:true"), true);
    });

    it("shares one teardown deadline between onunload and uninstall", async () => {
        const clock = new FakeClock();
        const never = new Promise<void>(() => undefined);
        const {coordinator, events} = createHarness({
            onunload(plugin) {
                events.push(`onunload:${plugin.name}`);
                return never;
            },
            uninstall(plugin) {
                events.push(`uninstall:${plugin.name}`);
                return never;
            },
        }, 5000, {
            now: () => clock.now,
            setTimeout: clock.setTimeout,
            clearTimeout: clock.clearTimeout,
        });
        coordinator.start();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));
        const uninstalling = coordinator.requestUninstall("sample");
        await flushMicrotasks();

        clock.advance(4999);
        await flushMicrotasks();
        assert.equal(events.includes("uninstall:sample"), false);
        clock.advance(1);
        await flushMicrotasks();
        assert.equal(events.includes("uninstall:sample"), true);
        assert.equal(events.includes("dispose:sample:true"), false);
        clock.advance(0);
        await flushMicrotasks();
        await uninstalling;

        assert.equal(clock.now, 5000);
        assert.equal(events.includes("dispose:sample:true"), true);
    });

    it("disposes after teardown hook rejections", async () => {
        const {coordinator, events} = createHarness({
            onunload(plugin) {
                events.push(`onunload:${plugin.name}`);
                return Promise.reject(new Error("onunload failed"));
            },
            uninstall(plugin) {
                events.push(`uninstall:${plugin.name}`);
                return Promise.reject(new Error("uninstall failed"));
            },
        });
        coordinator.start();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        await coordinator.requestUninstall("sample");

        assert.equal(events.includes("error:sample:onunload"), true);
        assert.equal(events.includes("error:sample:uninstall"), true);
        assert.equal(events.includes("dispose:sample:true"), true);
        assert.equal(coordinator.getState("sample"), "absent");
    });

    it("recovers from a host cleanup error", async () => {
        let disposeCalls = 0;
        const {coordinator, events} = createHarness({
            dispose() {
                disposeCalls++;
                if (disposeCalls === 1) {
                    throw new Error("cleanup failed");
                }
            },
        });
        coordinator.start();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));
        await coordinator.requestUnload("sample");

        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 2}));

        assert.equal(events.includes("error:sample:dispose"), true);
        assert.equal(coordinator.getInstance("sample")?.revision, 2);
    });

    it("keeps uninstall as a barrier before a later load", async () => {
        const unloaded = deferred<void>();
        const {coordinator, events} = createHarness({
            onunload(plugin) {
                events.push(`onunload:${plugin.name}`);
                return unloaded.promise;
            },
        });
        coordinator.start();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        const unloading = coordinator.requestUnload("sample");
        await nextTurn();
        const uninstalling = coordinator.requestUninstall("sample");
        const loading = coordinator.requestLoad("sample", async () => ({name: "sample", revision: 2}));
        unloaded.resolve();
        await Promise.all([unloading, uninstalling, loading]);

        assert.ok(events.indexOf("uninstall:sample") < events.indexOf("create:sample:2"));
        assert.equal(events.includes("dispose:sample:true"), true);
        assert.equal(coordinator.getInstance("sample")?.revision, 2);
    });

    it("coalesces a reload waiting for data into the latest reload", async () => {
        const never = new Promise<ITestPluginData>(() => undefined);
        const {coordinator, events} = createHarness();
        coordinator.start();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 0}));

        const firstReload = coordinator.requestReload("sample", () => never);
        await nextTurn();
        const secondReload = coordinator.requestReload("sample",
            async () => ({name: "sample", revision: 2}));
        await Promise.all([firstReload, secondReload]);

        assert.deepEqual(events.filter(item => item.startsWith("create:")), [
            "create:sample:0",
            "create:sample:2",
        ]);
        assert.equal(coordinator.getInstance("sample")?.revision, 2);
    });

    it("drops data changes when a structural task is pending", async () => {
        const unloaded = deferred<void>();
        const {coordinator, events} = createHarness({
            onunload(plugin) {
                events.push(`onunload:${plugin.name}`);
                return unloaded.promise;
            },
        });
        coordinator.start();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        const unloading = coordinator.requestUnload("sample");
        await coordinator.requestDataChange("sample");
        unloaded.resolve();
        await unloading;

        assert.equal(events.includes("data:sample"), false);
    });

    it("runs different plugin queues in parallel", async () => {
        const loads = new Map(["first", "second"].map(name => [name, deferred<void>()]));
        const {coordinator} = createHarness({
            onload(plugin) {
                return loads.get(plugin.name).promise;
            },
        });
        coordinator.start();
        const first = coordinator.requestLoad("first", async () => ({name: "first", revision: 1}));
        const second = coordinator.requestLoad("second", async () => ({name: "second", revision: 1}));
        await nextTurn();

        assert.equal(coordinator.getState("first"), "loading");
        assert.equal(coordinator.getState("second"), "loading");
        loads.get("first").resolve();
        loads.get("second").resolve();
        await Promise.all([first, second]);
    });
});
