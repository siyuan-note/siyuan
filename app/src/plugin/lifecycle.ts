import type {TPluginDataChangeReason} from "./index";

export type TPluginLifecycleState =
    "absent" |
    "loading" |
    "loaded" |
    "layouting" |
    "ready" |
    "unloading" |
    "uninstalling";

export type TPluginLifecycleHook =
    "create" |
    "attach" |
    "loadData" |
    "onload" |
    "kernelInit" |
    "onLayoutReady" |
    "mount" |
    "onDataChanged" |
    "onunload" |
    "uninstall" |
    "dispose";

export interface IPluginLifecycleAdapter<TData, TPlugin> {
    create(data: TData): TPlugin | undefined;
    attach(plugin: TPlugin): void;
    onload(plugin: TPlugin): Promise<void> | void;
    init(plugin: TPlugin): Promise<void> | void;
    onLayoutReady(plugin: TPlugin): Promise<void> | void;
    mount(plugin: TPlugin): void;
    shouldReloadOnDataChange(plugin: TPlugin): boolean;
    onDataChanged(plugin: TPlugin, reason?: TPluginDataChangeReason): Promise<void> | void;
    onunload(plugin: TPlugin): Promise<void> | void;
    uninstall(plugin: TPlugin): Promise<void> | void;
    markDisposed(plugin: TPlugin): void;
    dispose(plugin: TPlugin, uninstall: boolean): void;
    onError(name: string, hook: TPluginLifecycleHook, error: unknown): void;
}

type TPluginLifecycleTaskKind = "load" | "reload" | "unload" | "uninstall" | "layout" | "dataChange";
type TPluginStructuralTaskKind = "load" | "reload" | "unload" | "uninstall";

interface IDeferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
}

interface IPluginLifecycleTask<TData> {
    kind: TPluginLifecycleTaskKind;
    sequence: number;
    dataProvider?: () => Promise<TData | undefined>;
    dataChangeReason?: TPluginDataChangeReason;
    uninstallHandled?: boolean;
    waiters: Array<() => void>;
}

interface IPluginLifecycleInterrupt {
    promise: Promise<number>;
    resolve: (deadline: number) => void;
    resolved: boolean;
}

interface IPluginLifecycleRecord<TData, TPlugin> {
    name: string;
    state: TPluginLifecycleState;
    instance?: TPlugin;
    tasks: IPluginLifecycleTask<TData>[];
    currentTask?: IPluginLifecycleTask<TData>;
    processing: boolean;
    lastStructuralSequence: number;
    latestStructuralKind?: TPluginStructuralTaskKind;
    interrupt: IPluginLifecycleInterrupt;
    removalDeadline?: number;
}

export interface IPluginLifecycleOptions {
    teardownTimeout?: number;
    now?: () => number;
    setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface IPluginLoadBatch {
    id: number;
    sequence: number;
}

const createDeferred = <T>(): IDeferred<T> => {
    let resolve: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return {promise, resolve};
};

const createInterrupt = (): IPluginLifecycleInterrupt => {
    const deferred = createDeferred<number>();
    return {
        promise: deferred.promise,
        resolve: deferred.resolve,
        resolved: false,
    };
};

export class PluginLifecycleCoordinator<TData, TPlugin> {
    private readonly adapter: IPluginLifecycleAdapter<TData, TPlugin>;
    private readonly records = new Map<string, IPluginLifecycleRecord<TData, TPlugin>>();
    private readonly teardownTimeout: number;
    private readonly now: () => number;
    private readonly setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    private readonly clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
    private sequence = 0;
    private loadBatchSequence = 0;
    private latestLoadBatch = 0;
    private started = false;
    private layoutReady = false;

    constructor(adapter: IPluginLifecycleAdapter<TData, TPlugin>, options: IPluginLifecycleOptions = {}) {
        this.adapter = adapter;
        this.teardownTimeout = options.teardownTimeout ?? 5000;
        this.now = options.now ?? Date.now;
        this.setTimeout = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
        this.clearTimeout = options.clearTimeout ?? ((timer) => clearTimeout(timer));
    }

    public start() {
        if (this.started) {
            return;
        }
        this.started = true;
        this.records.forEach((record) => this.schedule(record));
    }

    public isStarted() {
        return this.started;
    }

    public beginLoadBatch(initial = false): IPluginLoadBatch {
        this.latestLoadBatch = ++this.loadBatchSequence;
        return {
            id: this.latestLoadBatch,
            sequence: initial ? 0 : ++this.sequence,
        };
    }

    public isLatestLoadBatch(batch: IPluginLoadBatch) {
        return batch.id === this.latestLoadBatch;
    }

    public requestBatchLoad(name: string, data: TData, batch: IPluginLoadBatch) {
        this.sequence = Math.max(this.sequence, batch.sequence);
        const record = this.getRecord(name);
        if (batch.id !== this.latestLoadBatch || record.lastStructuralSequence > batch.sequence) {
            return Promise.resolve();
        }
        return this.enqueueStructural(record, "load", async () => data, batch.sequence);
    }

    public requestLoad(name: string, dataProvider: () => Promise<TData | undefined>) {
        return this.enqueueStructural(this.getRecord(name), "load", dataProvider);
    }

    public requestReload(name: string, dataProvider: () => Promise<TData | undefined>) {
        return this.enqueueStructural(this.getRecord(name), "reload", dataProvider);
    }

    public requestUnload(name: string) {
        return this.enqueueStructural(this.getRecord(name), "unload");
    }

    public requestUninstall(name: string) {
        return this.enqueueStructural(this.getRecord(name), "uninstall");
    }

    public requestDataChange(name: string, dataProvider: () => Promise<TData | undefined>,
                             reason?: TPluginDataChangeReason) {
        const record = this.getRecord(name);
        const finalStructuralKind = this.getFinalStructuralKind(record);
        if (finalStructuralKind === "unload" || finalStructuralKind === "uninstall" ||
            !record.instance && finalStructuralKind !== "load" && finalStructuralKind !== "reload") {
            return Promise.resolve();
        }
        const existing = record.tasks.find((task) => task.kind === "dataChange");
        if (existing) {
            existing.dataChangeReason = reason;
            return new Promise<void>((resolve) => existing.waiters.push(resolve));
        }
        return this.enqueue(record, {
            kind: "dataChange",
            sequence: 0,
            dataProvider,
            dataChangeReason: reason,
            waiters: [],
        });
    }

    public setLayoutReady() {
        if (this.layoutReady) {
            return Promise.resolve();
        }
        this.layoutReady = true;
        const tasks: Promise<void>[] = [];
        this.records.forEach((record) => {
            if (record.instance && record.state === "loaded" &&
                !record.tasks.some((task) => task.kind === "layout")) {
                const pendingDataChange = this.takePendingDataChange(record);
                const task = this.enqueue(record, {
                    kind: "layout",
                    sequence: 0,
                    waiters: [],
                });
                if (pendingDataChange) {
                    record.tasks.push(pendingDataChange);
                }
                tasks.push(task);
            }
        });
        return Promise.all(tasks).then(() => undefined);
    }

    public getState(name: string): TPluginLifecycleState {
        return this.records.get(name)?.state ?? "absent";
    }

    public getInstance(name: string) {
        return this.records.get(name)?.instance;
    }

    private getRecord(name: string) {
        let record = this.records.get(name);
        if (!record) {
            record = {
                name,
                state: "absent",
                tasks: [],
                processing: false,
                lastStructuralSequence: 0,
                interrupt: createInterrupt(),
            };
            this.records.set(name, record);
        }
        return record;
    }

    private enqueueStructural(record: IPluginLifecycleRecord<TData, TPlugin>, kind: TPluginStructuralTaskKind,
                              dataProvider?: () => Promise<TData | undefined>, sequence = ++this.sequence) {
        record.lastStructuralSequence = sequence;
        record.latestStructuralKind = kind;
        const pendingDataChange = this.takePendingDataChange(record);
        const task: IPluginLifecycleTask<TData> = {
            kind,
            sequence,
            dataProvider,
            waiters: [],
        };
        if (kind === "reload" || kind === "unload" || kind === "uninstall") {
            this.signalRemoval(record, this.now() + this.teardownTimeout);
        }
        const promise = this.enqueue(record, task);
        if (pendingDataChange) {
            if (kind === "load" || kind === "reload") {
                record.tasks.push(pendingDataChange);
            } else {
                pendingDataChange.waiters.forEach((resolve) => resolve());
            }
        }
        return promise;
    }

    private enqueue(record: IPluginLifecycleRecord<TData, TPlugin>, task: IPluginLifecycleTask<TData>) {
        const promise = new Promise<void>((resolve) => task.waiters.push(resolve));
        record.tasks.push(task);
        this.schedule(record);
        return promise;
    }

    private schedule(record: IPluginLifecycleRecord<TData, TPlugin>) {
        if (!this.started || record.processing || record.tasks.length === 0 ||
            this.isDataChangeWaitingForReady(record)) {
            return;
        }
        record.processing = true;
        queueMicrotask(() => void this.process(record));
    }

    private async process(record: IPluginLifecycleRecord<TData, TPlugin>) {
        try {
            while (record.tasks.length > 0) {
                if (this.isDataChangeWaitingForReady(record)) {
                    break;
                }
                const task = record.tasks.shift()!;
                record.currentTask = task;
                try {
                    await this.runTask(record, task);
                } catch (error) {
                    this.adapter.onError(record.name, "dispose", error);
                } finally {
                    task.waiters.forEach((resolve) => resolve());
                    record.currentTask = undefined;
                }
            }
        } finally {
            record.processing = false;
            this.schedule(record);
        }
    }

    private async runTask(record: IPluginLifecycleRecord<TData, TPlugin>, task: IPluginLifecycleTask<TData>) {
        switch (task.kind) {
            case "load":
                await this.runLoad(record, task, false);
                break;
            case "reload":
                await this.runLoad(record, task, true);
                break;
            case "unload":
                await this.teardown(record, task, false);
                break;
            case "uninstall":
                if (!task.uninstallHandled) {
                    await this.teardown(record, task, true);
                }
                break;
            case "layout":
                await this.runLayout(record);
                break;
            case "dataChange":
                await this.runDataChange(record, task);
                break;
        }
    }

    private async runLoad(record: IPluginLifecycleRecord<TData, TPlugin>, task: IPluginLifecycleTask<TData>,
                          reload: boolean) {
        if (this.isLoadTaskObsolete(record, task, reload)) {
            return;
        }
        if (reload && record.instance) {
            await this.teardown(record, task, false);
        }
        if (task.sequence < record.lastStructuralSequence) {
            return;
        }
        if (record.instance) {
            return;
        }
        this.resetInterrupt(record);
        record.state = "loading";
        const data = await this.resolveLoadData(record, task);
        if (!data || task.sequence < record.lastStructuralSequence || record.removalDeadline !== undefined) {
            record.state = "absent";
            return;
        }
        let plugin: TPlugin | undefined;
        try {
            plugin = this.adapter.create(data);
        } catch (error) {
            this.adapter.onError(record.name, "create", error);
            record.state = "absent";
            return;
        }
        if (!plugin) {
            record.state = "absent";
            return;
        }
        record.instance = plugin;
        try {
            this.adapter.attach(plugin);
        } catch (error) {
            this.adapter.onError(record.name, "attach", error);
            this.markDisposed(record.name, plugin);
            record.instance = undefined;
            record.state = "absent";
            try {
                this.adapter.dispose(plugin, false);
            } catch (disposeError) {
                this.adapter.onError(record.name, "dispose", disposeError);
            }
            this.resetInterrupt(record);
            return;
        }
        const loaded = await this.runInterruptibleHook(record, "onload", () => this.adapter.onload(plugin));
        if (!loaded || record.instance !== plugin) {
            record.state = "loaded";
            return;
        }
        const initialized = await this.runInterruptibleHook(record, "kernelInit", () => this.adapter.init(plugin));
        record.state = "loaded";
        if (!initialized || record.instance !== plugin || this.hasPendingTeardown(record)) {
            return;
        }
        if (this.layoutReady) {
            await this.runLayout(record);
        }
    }

    private async resolveLoadData(record: IPluginLifecycleRecord<TData, TPlugin>, task: IPluginLifecycleTask<TData>) {
        const provider = this.observe(record.name, "loadData", () => task.dataProvider?.());
        const result = await Promise.race([
            provider.then((data) => ({type: "data" as const, data})),
            record.interrupt.promise.then(() => ({type: "interrupt" as const, data: undefined})),
        ]);
        return result.type === "data" ? result.data : undefined;
    }

    private async runLayout(record: IPluginLifecycleRecord<TData, TPlugin>) {
        if (!this.layoutReady || !record.instance || record.state === "ready" || this.hasPendingTeardown(record)) {
            return;
        }
        const plugin = record.instance;
        record.state = "layouting";
        const completed = await this.runInterruptibleHook(record, "onLayoutReady",
            () => this.adapter.onLayoutReady(plugin));
        if (!completed || record.instance !== plugin || this.hasPendingTeardown(record)) {
            record.state = "loaded";
            return;
        }
        try {
            this.adapter.mount(plugin);
        } catch (error) {
            this.adapter.onError(record.name, "mount", error);
        }
        record.state = "ready";
    }

    private async runDataChange(record: IPluginLifecycleRecord<TData, TPlugin>, task: IPluginLifecycleTask<TData>) {
        const plugin = record.instance;
        if (!plugin || record.state !== "ready") {
            return;
        }
        // 是否覆盖基类实现只能在 Ready 实例上判断；未覆盖时将当前任务原位提升为重载，并保留原有等待者。
        if (this.adapter.shouldReloadOnDataChange(plugin)) {
            task.kind = "reload";
            task.sequence = ++this.sequence;
            record.lastStructuralSequence = task.sequence;
            record.latestStructuralKind = "reload";
            this.signalRemoval(record, this.now() + this.teardownTimeout);
            await this.runLoad(record, task, true);
            return;
        }
        await this.runInterruptibleHook(record, "onDataChanged",
            () => this.adapter.onDataChanged(plugin, task.dataChangeReason));
    }

    private async teardown(record: IPluginLifecycleRecord<TData, TPlugin>,
                           task: IPluginLifecycleTask<TData>, uninstall: boolean) {
        const plugin = record.instance;
        if (!plugin) {
            record.state = "absent";
            return;
        }
        // 加载阶段收到的拆除请求与后续拆除钩子共用首次请求建立的超时预算。
        // Promise 无法取消；预算耗尽后仍尽力调用后续钩子，但不再为它们追加等待时间。
        const deadline = record.removalDeadline ?? this.now() + this.teardownTimeout;
        record.state = "unloading";
        if (!await this.runTeardownHook(record.name, "onunload", () => this.adapter.onunload(plugin), deadline)) {
            this.reportTimeout(record.name, "onunload");
        }
        uninstall = uninstall || this.hasPendingUninstall(record);
        if (uninstall) {
            record.state = "uninstalling";
            if (!await this.runTeardownHook(record.name, "uninstall", () => this.adapter.uninstall(plugin), deadline)) {
                this.reportTimeout(record.name, "uninstall");
            }
            this.markPendingUninstallsHandled(record, task);
        }
        this.markDisposed(record.name, plugin);
        record.instance = undefined;
        record.state = "absent";
        try {
            this.adapter.dispose(plugin, uninstall);
        } catch (error) {
            this.adapter.onError(record.name, "dispose", error);
        }
        this.resetInterrupt(record);
    }

    private runTeardownHook(name: string, hook: "onunload" | "uninstall",
                            callback: () => Promise<void> | void, deadline: number) {
        try {
            const result = callback();
            if (!result || typeof result.then !== "function") {
                return Promise.resolve(true);
            }
            const promise = Promise.resolve(result).catch((error) => {
                this.adapter.onError(name, hook, error);
            });
            if (deadline <= this.now()) {
                return Promise.resolve(true);
            }
            return this.waitUntilDeadline(promise, deadline);
        } catch (error) {
            this.adapter.onError(name, hook, error);
            return Promise.resolve(true);
        }
    }

    private runInterruptibleHook(record: IPluginLifecycleRecord<TData, TPlugin>, hook: TPluginLifecycleHook,
                                 callback: () => Promise<void> | void) {
        const hookPromise = this.observe(record.name, hook, callback).then(() => true);
        return new Promise<boolean>((resolve) => {
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            hookPromise.then(() => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timer !== undefined) {
                    this.clearTimeout(timer);
                }
                resolve(true);
            });
            record.interrupt.promise.then((deadline) => {
                if (settled) {
                    return;
                }
                const remaining = Math.max(0, deadline - this.now());
                timer = this.setTimeout(() => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    this.reportTimeout(record.name, hook);
                    resolve(false);
                }, remaining);
            });
        });
    }

    private waitUntilDeadline(promise: Promise<unknown>, deadline: number) {
        const remaining = deadline - this.now();
        if (remaining <= 0) {
            return Promise.resolve(false);
        }
        return new Promise<boolean>((resolve) => {
            let settled = false;
            const timer = this.setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(false);
            }, remaining);
            promise.then(() => {
                if (settled) {
                    return;
                }
                settled = true;
                this.clearTimeout(timer);
                resolve(true);
            });
        });
    }

    private observe<T>(name: string, hook: TPluginLifecycleHook, callback: () => Promise<T> | T): Promise<T | undefined> {
        try {
            return Promise.resolve(callback()).catch((error) => {
                this.adapter.onError(name, hook, error);
                return undefined;
            });
        } catch (error) {
            this.adapter.onError(name, hook, error);
            return Promise.resolve(undefined);
        }
    }

    private reportTimeout(name: string, hook: TPluginLifecycleHook) {
        this.adapter.onError(name, hook,
            new Error(`plugin lifecycle removal deadline reached while waiting for ${hook}`));
    }

    private markDisposed(name: string, plugin: TPlugin) {
        try {
            this.adapter.markDisposed(plugin);
        } catch (error) {
            this.adapter.onError(name, "dispose", error);
        }
    }

    private signalRemoval(record: IPluginLifecycleRecord<TData, TPlugin>, deadline: number) {
        record.removalDeadline = Math.min(record.removalDeadline ?? Number.POSITIVE_INFINITY, deadline);
        if (record.state !== "loading" && record.state !== "layouting" &&
            record.currentTask?.kind !== "dataChange") {
            return;
        }
        if (!record.interrupt.resolved) {
            record.interrupt.resolved = true;
            record.interrupt.resolve(record.removalDeadline);
        }
    }

    private resetInterrupt(record: IPluginLifecycleRecord<TData, TPlugin>) {
        record.interrupt = createInterrupt();
        record.removalDeadline = undefined;
    }

    private hasPendingTeardown(record: IPluginLifecycleRecord<TData, TPlugin>) {
        return record.removalDeadline !== undefined || record.tasks.some((task) =>
            task.kind === "reload" || task.kind === "unload" || task.kind === "uninstall");
    }

    private hasPendingUninstall(record: IPluginLifecycleRecord<TData, TPlugin>) {
        return record.tasks.some((task) => task.kind === "uninstall" && !task.uninstallHandled);
    }

    private markPendingUninstallsHandled(record: IPluginLifecycleRecord<TData, TPlugin>,
                                         current: IPluginLifecycleTask<TData>) {
        if (current.kind === "uninstall") {
            current.uninstallHandled = true;
        }
        record.tasks.forEach((task) => {
            if (task.kind === "uninstall") {
                task.uninstallHandled = true;
            }
        });
    }

    private isLoadTaskObsolete(record: IPluginLifecycleRecord<TData, TPlugin>,
                               task: IPluginLifecycleTask<TData>, reload: boolean) {
        if (task.sequence >= record.lastStructuralSequence) {
            return false;
        }
        if (!reload) {
            return true;
        }
        return record.latestStructuralKind !== "load";
    }

    private getFinalStructuralKind(record: IPluginLifecycleRecord<TData, TPlugin>) {
        let kind = record.currentTask && this.isStructural(record.currentTask.kind) ? record.currentTask.kind : undefined;
        record.tasks.forEach((task) => {
            if (this.isStructural(task.kind)) {
                kind = task.kind;
            }
        });
        return kind;
    }

    private takePendingDataChange(record: IPluginLifecycleRecord<TData, TPlugin>) {
        let pending: IPluginLifecycleTask<TData> | undefined;
        record.tasks = record.tasks.filter((task) => {
            if (task.kind !== "dataChange") {
                return true;
            }
            if (pending) {
                pending.waiters.push(...task.waiters);
            } else {
                pending = task;
            }
            return false;
        });
        return pending;
    }

    private isDataChangeWaitingForReady(record: IPluginLifecycleRecord<TData, TPlugin>) {
        // 数据变更保留在队列中，待布局挂载完成，期间仍可由后续结构任务重排或丢弃。
        return record.tasks[0]?.kind === "dataChange" && record.state !== "ready" && record.state !== "absent";
    }

    private isStructural(kind: TPluginLifecycleTaskKind): kind is TPluginStructuralTaskKind {
        return kind === "load" || kind === "reload" || kind === "unload" || kind === "uninstall";
    }
}
