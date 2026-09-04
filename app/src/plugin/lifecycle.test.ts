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
const getSampleData = (revision = 1) => async () => ({name: "sample", revision});

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
        shouldReloadOnDataChange() {
            return false;
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

    it("continues teardown when pending onload reaches the removal deadline", async () => {
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
        assert.equal(events.includes("error:sample:onunload"), false);
        assert.equal(events.includes("dispose:sample:false"), true);
        assert.equal(coordinator.getState("sample"), "absent");
    });

    it("continues teardown when pending kernel initialization reaches the removal deadline", async () => {
        const never = new Promise<void>(() => undefined);
        const {coordinator, events} = createHarness({
            init(plugin) {
                events.push(`init:${plugin.name}`);
                return never;
            },
        }, 10);
        coordinator.start();
        const loading = coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));
        await nextTurn();

        const unloading = coordinator.requestUnload("sample");
        await Promise.all([loading, unloading]);

        assert.equal(events.includes("error:sample:kernelInit"), true);
        assert.equal(events.includes("error:sample:onunload"), false);
        assert.equal(events.includes("dispose:sample:false"), true);
    });

    it("shares one removal deadline across loading and teardown", async () => {
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
        assert.equal(events.includes("error:sample:onload"), true);
        assert.equal(events.includes("error:sample:onunload"), false);
        assert.equal(events.includes("dispose:sample:false"), true);
        await Promise.all([loading, unloading]);

        assert.equal(clock.now, 5000);
        assert.equal(events.includes("dispose:sample:false"), true);
    });

    it("uses only the remaining removal budget after onload completes", async () => {
        const clock = new FakeClock();
        const loaded = deferred<void>();
        const never = new Promise<void>(() => undefined);
        const {coordinator, events} = createHarness({
            onload(plugin) {
                events.push(`onload:${plugin.name}`);
                return loaded.promise;
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

        clock.advance(3000);
        loaded.resolve();
        await loading;
        await flushMicrotasks();
        assert.equal(events.includes("onunload:sample"), true);
        clock.advance(1999);
        await flushMicrotasks();
        assert.equal(events.includes("dispose:sample:false"), false);
        clock.advance(1);
        await flushMicrotasks();
        await Promise.all([loading, unloading]);

        assert.equal(clock.now, 5000);
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
        assert.equal(events.includes("error:sample:uninstall"), false);
        assert.equal(events.includes("dispose:sample:true"), true);
    });

    it("observes an uninstall rejection after the shared deadline without reporting another timeout", async () => {
        const never = new Promise<void>(() => undefined);
        const uninstalled = deferred<void>();
        const errors: Array<{hook: string, message: string}> = [];
        const {coordinator, events} = createHarness({
            onunload(plugin) {
                events.push(`onunload:${plugin.name}`);
                return never;
            },
            uninstall(plugin) {
                events.push(`uninstall:${plugin.name}`);
                return uninstalled.promise;
            },
            onError(name, hook, error) {
                events.push(`error:${name}:${hook}`);
                errors.push({hook, message: error instanceof Error ? error.message : String(error)});
            },
        }, 10);
        coordinator.start();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        await coordinator.requestUninstall("sample");

        assert.deepEqual(events.filter((event) => [
            "onunload:sample",
            "uninstall:sample",
            "markDisposed:sample",
            "dispose:sample:true",
        ].includes(event)), [
            "onunload:sample",
            "uninstall:sample",
            "markDisposed:sample",
            "dispose:sample:true",
        ]);
        assert.equal(errors.some((error) => error.hook === "uninstall"), false);
        uninstalled.reject(new Error("late uninstall failure"));
        await nextTurn();
        assert.deepEqual(errors.filter((error) => error.hook === "uninstall").map((error) => error.message), [
            "late uninstall failure",
        ]);
    });

    it("does not treat synchronous hook work as Promise waiting", async () => {
        const clock = new FakeClock();
        const never = new Promise<void>(() => undefined);
        const {coordinator, events} = createHarness({
            onunload(plugin) {
                events.push(`onunload:${plugin.name}`);
                clock.advance(5000);
                return never;
            },
        }, 5000, {
            now: () => clock.now,
            setTimeout: clock.setTimeout,
            clearTimeout: clock.clearTimeout,
        });
        coordinator.start();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        await coordinator.requestUnload("sample");

        assert.equal(clock.now, 5000);
        assert.equal(events.includes("error:sample:onunload"), false);
        assert.equal(events.includes("dispose:sample:false"), true);
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
        assert.equal(events.includes("error:sample:onunload"), true);
        assert.equal(events.includes("error:sample:uninstall"), false);
        assert.equal(events.includes("dispose:sample:true"), true);
        await uninstalling;

        assert.equal(clock.now, 5000);
        assert.equal(events.includes("dispose:sample:true"), true);
    });

    it("starts the removal deadline when a ready-instance request is enqueued", async () => {
        const clock = new FakeClock();
        const never = new Promise<void>(() => undefined);
        const {coordinator, events} = createHarness({
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
        await coordinator.setLayoutReady();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));
        assert.equal(coordinator.getState("sample"), "ready");

        const uninstalling = coordinator.requestUninstall("sample");
        clock.advance(1000);
        await flushMicrotasks();
        assert.equal(events.includes("onunload:sample"), true);
        clock.advance(3999);
        await flushMicrotasks();
        assert.equal(events.includes("dispose:sample:true"), false);
        clock.advance(1);
        await flushMicrotasks();
        await uninstalling;

        assert.equal(clock.now, 5000);
        assert.equal(events.includes("error:sample:onunload"), true);
        assert.equal(events.includes("uninstall:sample"), true);
        assert.equal(events.includes("error:sample:uninstall"), false);
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

    it("delivers coalesced data changes after a pending load creates the instance", async () => {
        const data = deferred<ITestPluginData>();
        const {coordinator, events} = createHarness({
            onDataChanged(plugin) {
                events.push(`data:${plugin.name}:${plugin.revision}`);
            },
        });
        coordinator.start();
        await coordinator.setLayoutReady();
        const loading = coordinator.requestLoad("sample", () => data.promise);
        await nextTurn();

        const firstChange = coordinator.requestDataChange("sample", getSampleData());
        const secondChange = coordinator.requestDataChange("sample", getSampleData());
        data.resolve({name: "sample", revision: 1});
        await Promise.all([loading, firstChange, secondChange]);

        assert.equal(events.filter(item => item === "data:sample:1").length, 1);
        const mountIndex = events.indexOf("mount:sample");
        assert.ok(mountIndex >= 0 && mountIndex < events.indexOf("data:sample:1"));
    });

    it("passes the latest coalesced data change reason to onDataChanged", async () => {
        const {coordinator, events} = createHarness({
            onDataChanged(plugin, reason) {
                events.push(`data:${plugin.name}:${reason}`);
            },
        });
        coordinator.start();
        await coordinator.requestLoad("sample", getSampleData());
        await coordinator.setLayoutReady();

        const syncChange = coordinator.requestDataChange("sample", getSampleData(), "sync");
        const overwriteChange = coordinator.requestDataChange("sample", getSampleData(), "overwrite");
        await Promise.all([syncChange, overwriteChange]);

        assert.equal(events.filter(event => event === "data:sample:overwrite").length, 1);
        assert.equal(events.includes("data:sample:sync"), false);
    });

    it("decides the default data-change reload after the pending instance reaches ready", async () => {
        const data = deferred<ITestPluginData>();
        const inspectedRevisions: number[] = [];
        const {coordinator, events} = createHarness({
            shouldReloadOnDataChange(plugin) {
                inspectedRevisions.push(plugin.revision);
                return true;
            },
        });
        coordinator.start();
        await coordinator.setLayoutReady();
        const loading = coordinator.requestLoad("sample", () => data.promise);
        await nextTurn();
        const dataChange = coordinator.requestDataChange("sample", getSampleData(2));

        data.resolve({name: "sample", revision: 1});
        await Promise.all([loading, dataChange]);

        assert.deepEqual(inspectedRevisions, [1]);
        assert.deepEqual(events.filter((event) => event.startsWith("create:sample")), [
            "create:sample:1",
            "create:sample:2",
        ]);
        assert.equal(events.includes("data:sample"), false);
        assert.equal(coordinator.getInstance("sample")?.revision, 2);
        assert.equal(coordinator.getState("sample"), "ready");
    });

    it("holds data changes until layout mounting reaches ready", async () => {
        const {coordinator, events} = createHarness();
        coordinator.start();
        await coordinator.requestLoad("sample", getSampleData());

        let dataChangeCompleted = false;
        const dataChange = coordinator.requestDataChange("sample", getSampleData()).then(() => {
            dataChangeCompleted = true;
        });
        await flushMicrotasks();
        assert.equal(coordinator.getState("sample"), "loaded");
        assert.equal(events.includes("data:sample"), false);
        assert.equal(dataChangeCompleted, false);

        await coordinator.setLayoutReady();
        await dataChange;

        assert.deepEqual(events.filter((event) => [
            "layout:sample",
            "mount:sample",
            "data:sample",
        ].includes(event)), [
            "layout:sample",
            "mount:sample",
            "data:sample",
        ]);
    });

    it("waits for an active asynchronous data change before unloading", async () => {
        const changed = deferred<void>();
        const {coordinator, events} = createHarness({
            onDataChanged(plugin) {
                events.push(`data:${plugin.name}`);
                return changed.promise;
            },
        }, 5000);
        coordinator.start();
        await coordinator.setLayoutReady();
        await coordinator.requestLoad("sample", getSampleData());
        const dataChange = coordinator.requestDataChange("sample", getSampleData());
        await flushMicrotasks();

        const unloading = coordinator.requestUnload("sample");
        await flushMicrotasks();
        assert.equal(events.includes("onunload:sample"), false);
        changed.resolve();
        await Promise.all([dataChange, unloading]);

        assert.ok(events.indexOf("data:sample") < events.indexOf("onunload:sample"));
    });

    it("uses the removal deadline while waiting for an active data change", async () => {
        const clock = new FakeClock();
        const never = new Promise<void>(() => undefined);
        const {coordinator, events} = createHarness({
            onDataChanged(plugin) {
                events.push(`data:${plugin.name}`);
                return never;
            },
        }, 5000, {
            now: () => clock.now,
            setTimeout: clock.setTimeout,
            clearTimeout: clock.clearTimeout,
        });
        coordinator.start();
        await coordinator.setLayoutReady();
        await coordinator.requestLoad("sample", getSampleData());
        const dataChange = coordinator.requestDataChange("sample", getSampleData());
        await flushMicrotasks();
        const unloading = coordinator.requestUnload("sample");
        await flushMicrotasks();

        clock.advance(4999);
        await flushMicrotasks();
        assert.equal(events.includes("onunload:sample"), false);
        clock.advance(1);
        await flushMicrotasks();
        await Promise.all([dataChange, unloading]);

        assert.equal(clock.now, 5000);
        assert.equal(events.includes("error:sample:onDataChanged"), true);
        assert.equal(events.includes("onunload:sample"), true);
        assert.equal(events.includes("error:sample:onunload"), false);
        assert.equal(events.includes("dispose:sample:false"), true);
    });

    it("moves a pending data change behind a later reload", async () => {
        const {coordinator, events} = createHarness({
            onDataChanged(plugin) {
                events.push(`data:${plugin.name}:${plugin.revision}`);
            },
        });
        coordinator.start();
        await coordinator.setLayoutReady();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        const dataChange = coordinator.requestDataChange("sample", getSampleData());
        const reload = coordinator.requestReload("sample", async () => ({name: "sample", revision: 2}));
        await Promise.all([dataChange, reload]);

        assert.equal(events.includes("data:sample:1"), false);
        assert.equal(events.filter(item => item === "data:sample:2").length, 1);
    });

    it("coalesces data changes while the reloaded instance is still in onload", async () => {
        const loaded = deferred<void>();
        const {coordinator, events} = createHarness({
            onload(plugin) {
                events.push(`onload:${plugin.name}:${plugin.revision}`);
                if (plugin.revision === 2) {
                    return loaded.promise;
                }
            },
            init(plugin) {
                events.push(`init:${plugin.name}:${plugin.revision}`);
            },
            onDataChanged(plugin) {
                events.push(`data:${plugin.name}:${plugin.revision}`);
            },
        });
        coordinator.start();
        await coordinator.setLayoutReady();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        const reload = coordinator.requestReload("sample", async () => ({name: "sample", revision: 2}));
        await nextTurn();
        assert.equal(coordinator.getState("sample"), "loading");
        const firstChange = coordinator.requestDataChange("sample", getSampleData());
        const secondChange = coordinator.requestDataChange("sample", getSampleData());
        loaded.resolve();
        await Promise.all([reload, firstChange, secondChange]);

        assert.equal(events.filter(item => item === "data:sample:2").length, 1);
        const mountIndex = events.lastIndexOf("mount:sample");
        assert.ok(mountIndex >= 0 && mountIndex < events.indexOf("data:sample:2"));
    });

    it("delivers data changes after a queued unload and load leave a new instance", async () => {
        const unloaded = deferred<void>();
        const {coordinator, events} = createHarness({
            onDataChanged(plugin) {
                events.push(`data:${plugin.name}:${plugin.revision}`);
            },
            onunload(plugin) {
                events.push(`onunload:${plugin.name}`);
                return unloaded.promise;
            },
        });
        coordinator.start();
        await coordinator.setLayoutReady();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        const unloading = coordinator.requestUnload("sample");
        await nextTurn();
        const loading = coordinator.requestLoad("sample", async () => ({name: "sample", revision: 2}));
        const dataChange = coordinator.requestDataChange("sample", getSampleData());
        unloaded.resolve();
        await Promise.all([unloading, loading, dataChange]);

        assert.equal(events.includes("data:sample:1"), false);
        assert.equal(events.filter(item => item === "data:sample:2").length, 1);
    });

    it("completes a pending data change when loading produces no instance", async () => {
        const {coordinator, events} = createHarness();
        coordinator.start();
        const loading = coordinator.requestLoad("sample", async () => undefined);
        const dataChange = coordinator.requestDataChange("sample", getSampleData());

        await Promise.all([loading, dataChange]);

        assert.equal(events.includes("data:sample"), false);
        assert.equal(coordinator.getState("sample"), "absent");
    });

    it("drops data changes when the final structural intent is unload", async () => {
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
        await coordinator.requestDataChange("sample", getSampleData());
        unloaded.resolve();
        await unloading;

        assert.equal(events.includes("data:sample"), false);
    });

    it("drops a queued data change before unload and resolves every waiter", async () => {
        const {coordinator, events} = createHarness();
        coordinator.start();
        await coordinator.requestLoad("sample", getSampleData());

        const firstChange = coordinator.requestDataChange("sample", getSampleData());
        const secondChange = coordinator.requestDataChange("sample", getSampleData());
        const unloading = coordinator.requestUnload("sample");
        await Promise.all([firstChange, secondChange, unloading]);

        assert.equal(events.includes("data:sample"), false);
        assert.equal(events.includes("dispose:sample:false"), true);
    });

    it("drops a queued data change before uninstall and resolves every waiter", async () => {
        const {coordinator, events} = createHarness();
        coordinator.start();
        await coordinator.requestLoad("sample", async () => ({name: "sample", revision: 1}));

        const firstChange = coordinator.requestDataChange("sample", getSampleData());
        const secondChange = coordinator.requestDataChange("sample", getSampleData());
        const uninstalling = coordinator.requestUninstall("sample");
        await Promise.all([firstChange, secondChange, uninstalling]);

        assert.equal(events.includes("data:sample"), false);
        assert.equal(events.includes("uninstall:sample"), true);
        assert.equal(events.includes("dispose:sample:true"), true);
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
