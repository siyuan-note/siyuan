import {test} from "node:test";
import {EventEmitter} from "node:events";
import type {createKernelBoot} from "./kernelBoot";
import type {App} from "electron";
import {queueSecondInstance, startSecondInstance} from "../startup/secondInstance";
import {paths as runtimePaths, state as runtimeState, resetRuntimeState, configureRuntime} from "../shared/runtime";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
const assert = require("node:assert/strict");
const path = require("node:path");

// 被测模块在测试内 require：它从 electron 取值，首次加载时必须已经换成替身。
const kernelBootModule = () => require("./kernelBoot");

// 注入面类型直接从被测函数派生，桩只需实现被访问的成员。
type KernelBootDeps = Parameters<typeof createKernelBoot>[0];
type KernelBootSeams = Parameters<typeof createKernelBoot>[1];
type BootOption = KernelBootDeps["boot"];

const certificateChange = () => new Error("net::ERR_CERT_DATABASE_CHANGED");

// 版本响应体上的挂起标记：hang 表示请求挂起，bodyHang 表示响应体挂起。
type ProbeFlags = {hang?: boolean; bodyHang?: boolean};
const probeFlags = (value: unknown): ProbeFlags | undefined =>
    value && typeof value === "object" ? value as ProbeFlags : undefined;

// previousExit 注入的回调面，由 previousKernelExit 在等待与恢复时调用。
type PreviousExitOptions = {
    onWaiting: () => unknown;
    onRecoveryFailed: (syncFailed: boolean) => unknown;
    hasActiveWindow: () => boolean;
    watchProcess: (marker: unknown, signal: AbortSignal) => Promise<unknown>;
    recover: (marker: unknown, signal: AbortSignal, force?: boolean) => Promise<unknown>;
};

// 启动页窗口假对象：用例通过 previousExitWaiting 观察待退出提示的写入与清空。
type BootWindowStub = {
    destroyed: boolean;
    previousExitWaiting?: string;
    isDestroyed(): boolean;
    destroy(): void;
    // 复用已开工作空间时窗口会被前置，夹具需要满足 showWindow 的最小接口。
    isMinimized(): boolean;
    show(): void;
    loadFile(file: string, options: {query?: Record<string, unknown>}): Promise<void>;
    webContents: {executeJavaScript(script: string): Promise<unknown>};
};

// 内核启动的注入面。字段类型跟随入参用途，避免测试往无类型袋子里挂字段。
type KernelBootContext = {
    path: typeof path;
    process: {platform: string; env: Record<string, string>};
    // 第二个实例与退出事件通过 app 发布，用例建监听后手动 emit。
    app: {
        getPreferredSystemLanguages: () => string[];
        on: (event: string, listener: (...args: any[]) => void) => unknown;
        emit: (event: string, ...args: any[]) => unknown;
        listenerCount: (event: string) => number;
    };
    fs: {existsSync: (target: string) => boolean};
    lastWorkspacePath: string;
    kernelPort: string | number;
    workspaces: unknown[];
    localKernelStartups: Map<unknown, unknown>;
    showWindow: () => void;
    loadBootWindow: () => void;
    kernelProcesses: Map<unknown, unknown>;
    expectedKernelExitPorts: Set<string>;
    exitedKernelPorts: Set<string>;
    createBootWindow: () => BootWindowStub;
    // 用例自行替换成只实现所需方法的最小假对象，因此不做结构约束。
    bootWindow?: unknown;
    showLocalBootWindow: (window: BootWindowStub, port: string | number, lang?: string) => void;
    showAppleSiliconWarning: () => Promise<boolean>;
    waitForPreviousWorkspaceExit: (workspace: string, options: unknown) => Promise<unknown>;
    watchWorkspaceExitProcess: (kernelPath: string, marker: unknown, signal: AbortSignal) => Promise<unknown>;
    requestWorkspaceExitRecovery: (workspace: unknown, marker: {pid: number}, signal: unknown,
        fetch: unknown, readFile: unknown, force: boolean) => Promise<number>;
    dialog: {showMessageBox: (window: unknown, message: string) => Promise<{response: number}>};
    getAvailablePort: () => Promise<string | number>;
    writeLog: (message: string) => void;
    requestKernelExit: (port: string | number) => void;
    showErrorWindow: (...args: unknown[]) => number;
    exitApp: () => void;
    childProcess: {
        spawn: (file: string, args: string[]) => {pid: number; on: (event: string, callback: () => void) => void};
        execFile: (file: string, args: string[], options: {timeout?: number}, callback: (error: unknown,
            stdout: string) => void) => void;
    };
    sleep: (ms: number) => Promise<void>;
    net: {fetch: (url: string, options?: {signal?: AbortSignal}) => Promise<unknown>};
    // 以下字段只在第二个实例用例里用到，通过 Object.assign 注入。
    updateInstallPromise?: unknown;
    remoteKernelArgError?: unknown;
    remoteKernelTarget?: unknown;
    getArgFrom?: (argv: string[], key: string) => string | undefined;
    initMainWindow?: (port: string | number) => void;
};
type KernelBootRun = (workspace?: string, port?: string | number, lang?: string) => Promise<unknown>;
type KernelBootFixtureBase = {
    events: unknown[];
    waits: number[];
    window: BootWindowStub;
    windows: BootWindowStub[];
    closeKernel: (code: number, port?: number) => void;
    spawns: () => number;
    requests: () => number;
    versionRequests: () => number;
    timerCount: () => number;
    timerDelays: () => number[];
    settleMicrotasks: () => Promise<void>;
    advance: (ms: number) => void;
};
type KernelBootFixture = KernelBootFixtureBase & {
    context: KernelBootContext;
    kernelBoot: ReturnType<typeof createKernelBoot>;
    run: KernelBootRun;
};

const setup = (t: any, progress, options: {
    platform?: string;
    allocatePort?: () => Promise<string | number>;
    version?: (request: number, fixture: KernelBootFixture, port: string) => unknown;
    previousExit?: (workspace: string, options: PreviousExitOptions) => Promise<unknown>;
    recoveryResponse?: number;
    onSleep?: (ms: number, fixture: KernelBootFixture) => unknown;
} = {}) => {
    const events: unknown[] = [];
    const waits: number[] = [];
    const timers = new Map<number, {callback: () => void; ms: number; at: number}>();
    let now = 0;
    let timerId = 0;
    let requests = 0;
    let versionRequests = 0;
    const closeKernels = new Map<string, (code: number, signal: unknown) => void>();
    let spawns = 0;
    const makeWindow = (): BootWindowStub => ({
        destroyed: false,
        isDestroyed() { return this.destroyed; },
        destroy() { this.destroyed = true; events.push("destroy"); },
        // 复用已开工作空间时窗口会被前置，夹具需要满足 showWindow 的最小接口。
        isMinimized() { return false; },
        show() { events.push("show"); },
        loadFile: async (file, options) => { events.push(["load-file", file, options]); },
        webContents: {executeJavaScript: async script => { events.push(["boot-script", script]); }},
    });
    const window = makeWindow();
    const windows: BootWindowStub[] = [];
    // 闭环依赖：context.sleep 与 net.fetch 需要完整夹具，夹具又包含 context，因此先声明后回填。
    let complete!: KernelBootFixture;
    const fixture: KernelBootFixtureBase = {events, waits, window, windows,
        closeKernel: (code, port = 6806) => closeKernels.get(String(port))(code, null),
        spawns: () => spawns,
        requests: () => requests, versionRequests: () => versionRequests,
        timerCount: () => timers.size, timerDelays: () => Array.from(timers.values()).map(timer => timer.ms),
        settleMicrotasks: () => new Promise<void>(resolve => setImmediate(resolve)),
        advance: ms => {
            now += ms;
            for (const [id, timer] of Array.from(timers)) {
                if (timer.at <= now) {
                    timers.delete(id);
                    timer.callback();
                }
            }
        }};
    const hangUntilAbort = (signal: AbortSignal) => new Promise<never>((resolve, reject) => {
        // 模拟请求既不会成功也不会失败：只有超时中止才拒绝。
        signal.addEventListener("abort", () => reject(new Error("The operation was aborted")), {once: true});
    });
    const context: KernelBootContext = {
        path,
        process: {platform: options.platform || "win32", env: {}},
        app: Object.assign(new EventEmitter(), {
            getPreferredSystemLanguages: () => ["en"], quit: () => events.push("app-quit"),
        }),
        fs: {existsSync: () => true},
        lastWorkspacePath: "workspace",
        kernelPort: 6806, workspaces: [],
        localKernelStartups: new Map(), showWindow: () => events.push("show-existing"),        loadBootWindow: () => events.push("resume-boot"),
        kernelProcesses: new Map(), expectedKernelExitPorts: new Set(), exitedKernelPorts: new Set(),
        createBootWindow: () => {
            events.push("create-boot");
            const current = windows.length ? makeWindow() : window;
            windows.push(current);
            context.bootWindow = current;
            return current;
        },
        showLocalBootWindow: (window, port, lang) => { events.push("show-boot"); events.push(["show-boot", window, port, lang]); },
        showAppleSiliconWarning: async () => true,
        waitForPreviousWorkspaceExit: options.previousExit || (async () => true),
        watchWorkspaceExitProcess: async (kernelPath, marker, signal) => {
            events.push(["watch-exit-process", kernelPath, marker, signal]);
        },
        requestWorkspaceExitRecovery: async (workspace, marker, signal, _fetch, _readFile, force) => {
            events.push(["recover-exit", workspace, marker.pid, signal, force]);
            return 1;
        },
        dialog: {showMessageBox: async (_window, message) => {
            events.push(["recovery-dialog", message]);
            return {response: options.recoveryResponse ?? 1};
        }},
        getAvailablePort: options.allocatePort || (async () => 6806),
        writeLog: message => events.push(message),
        requestKernelExit: port => events.push(["exit-kernel", port]),
        showErrorWindow: (...args) => { events.push(["error-window", args[1]]); return 1; },
        exitApp: () => events.push("exit-app"),
        childProcess: {spawn: (_file, args) => {
            events.push(["spawn-args", Array.from(args)]);
            return {pid: 123 + spawns++, on: (event, callback) => {
                assert.equal(event, "close");
                closeKernels.set(String(args[args.indexOf("--port") + 1]), callback);
            }};
        }, execFile: (file, args, options, callback) => {
            events.push(["exec-file", file, args.join(" "), options.timeout]);
            callback(null, "");
        }},
        sleep: async ms => {
            waits.push(ms);
            fixture.advance(ms);
            await options.onSleep?.(ms, complete);
        },
        net: {fetch: async (url, requestOptions = {}) => {
            if (url.endsWith("/version")) {
                versionRequests++;
                const value = options.version ? await options.version(versionRequests, complete, new URL(url).port) : null;
                if (value instanceof Error) throw value;
                const flags = probeFlags(value);
                if (flags?.hang) return await hangUntilAbort(requestOptions.signal);
                return {json: async () => flags?.bodyHang ? await hangUntilAbort(requestOptions.signal) :
                    value || {code: 0, data: "3.8.6"}};
            }
            assert.equal(new URL(url).pathname, "/api/system/bootProgress");
            requests++;
            const result = await progress(requests, fixture, new URL(url).port);
            if (result?.hang) return await hangUntilAbort(requestOptions.signal);
            if (result instanceof Error) throw result;
            return {json: async () => result?.bodyHang ? await hangUntilAbort(requestOptions.signal) :
                {code: 0, data: {progress: result}}};
        }},
    };
    // 夹具保持扁平字段便于断言，这些字段桥接回共享运行期状态，模块与用例读写同一份数据。
    resetRuntimeState();
    resetElectronStub();
    mockElectron(t, {
        app: context.app as unknown as App,
        net: context.net as unknown as Record<string, unknown>,
        dialog: context.dialog as unknown as Record<string, unknown>,
    });
    const {createKernelBoot} = kernelBootModule();
    // 路径与写日志由共享运行期承载：appDir 指向 app/ 根，语言包不依赖当前工作目录。
    configureRuntime({
        ...runtimePaths, appDir: path.join(__dirname, "../.."), confDir: "conf", appVer: "3.8.6", isDevEnv: false,
        writeLog: context.writeLog,
    });
    runtimeState.kernel.port = 6806;
    runtimeState.startup = Object.freeze({...runtimeState.startup, lastWorkspacePath: "workspace"});
    Object.defineProperties(context, {
        kernelPort: {
            get: () => runtimeState.kernel.port,
            set: value => { runtimeState.kernel.port = value; },
        },
        localKernelStartups: {get: () => runtimeState.kernel.startups},
        kernelProcesses: {get: () => runtimeState.kernel.processes},
        expectedKernelExitPorts: {get: () => runtimeState.kernel.expectedExitPorts},
        exitedKernelPorts: {get: () => runtimeState.kernel.exitedPorts},
        workspaces: {get: () => runtimeState.workspaces},
        lastWorkspacePath: {
            get: () => runtimeState.startup.lastWorkspacePath,
            set: value => { runtimeState.startup = Object.freeze({...runtimeState.startup, lastWorkspacePath: value}); },
        },
    });
    const kernelBoot = createKernelBoot({
        boot: {
            createBootWindow: context.createBootWindow as unknown as BootOption["createBootWindow"],
            getAvailablePort: context.getAvailablePort,
            showLocalBootWindow: context.showLocalBootWindow as unknown as BootOption["showLocalBootWindow"],
        },
        ui: {
            showWindow: context.showWindow,
            exitApp: context.exitApp,
            showErrorWindow: context.showErrorWindow,
        },
    }, {
        // 这几个成员都是只实现被测路径用到的最小桩，与 Node 的完整类型不一致。
        path: context.path,
        process: context.process as unknown as KernelBootSeams["process"],
        fs: context.fs,
        childProcess: context.childProcess as unknown as KernelBootSeams["childProcess"],
        // 本地内核请求超时由计时器驱动，测试通过 advance 推进虚拟时间触发超时。
        now: () => now,
        scheduleTimer: (callback, ms) => {
            const id = ++timerId;
            timers.set(id, {callback, ms, at: now + ms});
            return id;
        },
        cancelTimer: id => timers.delete(id as number),
        sleep: context.sleep,
        requestKernelExit: context.requestKernelExit,
        waitForPreviousWorkspaceExit: context.waitForPreviousWorkspaceExit as unknown as
            KernelBootSeams["waitForPreviousWorkspaceExit"],
        watchWorkspaceExitProcess: context.watchWorkspaceExitProcess as unknown as
            KernelBootSeams["watchWorkspaceExitProcess"],
        requestWorkspaceExitRecovery: context.requestWorkspaceExitRecovery,
        showAppleSiliconWarning: context.showAppleSiliconWarning,
    });
    const run: KernelBootRun = (workspace = "", port = "", lang = "") =>
        kernelBoot.initKernel({workspace, port, lang});
    return (complete = Object.assign(fixture, {context, kernelBoot, run}));
};

const exits = fixture => fixture.events.filter(event => Array.isArray(event) && event[0] === "exit-kernel");

test("kernel startup clears stale exit evidence and records its own process closure", async (t) => {
    const state = setup(t, () => 100);
    state.context.exitedKernelPorts.add("6806");
    assert.equal(await state.run(), 6806);
    assert.equal(state.context.exitedKernelPorts.has("6806"), false);
    state.closeKernel(0);
    assert.equal(state.context.exitedKernelPorts.has("6806"), true);
    assert.equal(state.context.kernelProcesses.has("6806"), false);
});

test("repeated requests reuse startup before port allocation and during kernel boot", async (t) => {
    let allocate;
    let version;
    const state = setup(t, () => 100, {
        allocatePort: () => new Promise(resolve => { allocate = resolve; }),
        version: () => new Promise(resolve => { version = resolve; }),
    });
    const run = state.run();
    assert.equal(await state.run(path.resolve("WORKSPACE", "child", "..") + path.sep), undefined);
    assert.equal(state.windows.length, 1);
    assert.equal(state.spawns(), 0);
    await state.settleMicrotasks();
    allocate(6806);
    await state.settleMicrotasks();
    assert.equal(await state.run("workspace"), undefined);
    assert.equal(state.spawns(), 1);
    assert.equal(state.windows.length, 1);
    assert.equal(state.events.filter(event => event === "show-existing").length, 2);
    version();
    assert.equal(await run, 6806);
    assert.equal(await state.run("workspace"), undefined);
    assert.equal(state.windows.length, 1);
});

test("a main window awaiting frontend initialization also prevents duplicate startup", async (t) => {
    const state = setup(t, () => 100);
    state.context.workspaces.push({workspaceDir: path.resolve("workspace"), browserWindow: state.window});
    assert.equal(await state.run("WORKSPACE"), undefined);
    assert.equal(state.windows.length, 0);
    assert.equal(state.spawns(), 0);
    assert.deepEqual(state.events, ["show-existing"]);
});

test("different workspaces retain their own windows, ports and languages in either completion order", async (t) => {
    for (const first of ["6806", "6807"]) {
        const versions = new Map();
        const allocations = [];
        const state = setup(t, () => 100, {
            allocatePort: () => new Promise(resolve => allocations.push(resolve)),
            version: (_request, _fixture, port) => new Promise(resolve => versions.set(port, resolve)),
        });
        const a = state.run("workspace-a", "", "en");
        const b = state.run("workspace-b", "", "ja");
        await state.settleMicrotasks();
        allocations[1](6807);
        allocations[0](6806);
        await state.settleMicrotasks();
        assert.equal(state.spawns(), 2);
        assert.equal(state.windows.length, 2);
        assert.equal(state.context.kernelProcesses.size, 2);
        const shown = state.events.filter(event => Array.isArray(event) && event[0] === "show-boot");
        assert.ok(shown.some(event => event[1] === state.windows[0] && event[2] === 6806 && event[3] === "en"));
        assert.ok(shown.some(event => event[1] === state.windows[1] && event[2] === 6807 && event[3] === "ja"));
        versions.get(first)();
        await state.settleMicrotasks();
        assert.equal(await (first === "6806" ? a : b), Number(first));
        assert.equal(state.windows.some(window => window.destroyed), false);
        versions.get(first === "6806" ? "6807" : "6806")();
        assert.deepEqual(await Promise.all([a, b]), [6806, 6807]);
        assert.equal(exits(state).length, 0);
    }
});

test("a failing startup destroys only its own window and exits only its own kernel", async (t) => {
    let port = 6805;
    let finishOther;
    const state = setup(t, (_request, _state, port) => port === "6806" ? new Error("failed progress") : 100, {
        allocatePort: async () => ++port,
        version: (_request, _state, port) => port === "6807" ? new Promise(resolve => { finishOther = resolve; }) : null,
    });
    const a = state.run("workspace-a");
    const b = state.run("workspace-b");
    assert.equal(await a, undefined);
    assert.deepEqual(exits(state), [["exit-kernel", 6806]]);
    assert.equal(state.windows[0].destroyed, true);
    assert.equal(state.windows[1].destroyed, false);
    finishOther();
    assert.equal(await b, 6807);
});

test("quitting cancels every startup and requests each owned kernel to exit once", async (t) => {
    let port = 6805;
    const versions = [];
    const state = setup(t, () => 100, {
        allocatePort: async () => ++port,
        version: () => new Promise(resolve => versions.push(resolve)),
    });
    const runs = [state.run("workspace-a"), state.run("workspace-b")];
    await state.settleMicrotasks();
    state.context.app.emit("before-quit");
    assert.deepEqual(exits(state), [["exit-kernel", 6806], ["exit-kernel", 6807]]);
    assert.equal(state.windows.every(window => window.destroyed), true);
    versions.forEach(resolve => resolve());
    assert.deepEqual(await Promise.all(runs), [undefined, undefined]);
    assert.equal(exits(state).length, 2);
    assert.equal(state.context.localKernelStartups.size, 0);
});

test("canceling while allocating a port never spawns a kernel", async (t) => {
    let allocate;
    const state = setup(t, () => 100, {allocatePort: () => new Promise(resolve => { allocate = resolve; })});
    const run = state.run();
    await state.settleMicrotasks();
    state.context.app.emit("before-quit");
    allocate(6806);
    assert.equal(await run, undefined);
    assert.equal(state.spawns(), 0);
    assert.equal(exits(state).length, 0);
    assert.equal(state.window.destroyed, true);
});

test("second-instance reuses the default workspace startup and independently opens a different workspace", async (t) => {
    let port = 6805;
    const versions = new Map();
    const mainPorts = [];
    const state = setup(t, () => 100, {
        allocatePort: async () => ++port,
        version: (_request, _fixture, port) => new Promise(resolve => versions.set(port, resolve)),
    });
    Object.assign(state.context, {
        updateInstallPromise: undefined, remoteKernelArgError: undefined, remoteKernelTarget: undefined,
        getArgFrom: (argv, key) => argv.find(arg => arg.startsWith(key + "="))?.slice(key.length + 1),
        initMainWindow: port => mainPorts.push(port),
    });
    state.context.app.on("second-instance", queueSecondInstance);
    startSecondInstance({initKernel: state.kernelBoot.initKernel, initMainWindow: state.context.initMainWindow});
    const run = state.run();
    state.context.app.emit("second-instance", {}, ["siyuan", "--workspace=workspace"]);
    state.context.app.emit("second-instance", {}, ["siyuan"]);
    assert.equal(state.windows.length, 1);
    state.context.app.emit("second-instance", {}, ["siyuan", "--workspace=workspace-b"]);
    await state.settleMicrotasks();
    assert.equal(state.spawns(), 2);
    versions.get("6807")();
    await state.settleMicrotasks();
    assert.deepEqual(mainPorts, [6807]);
    assert.equal(state.window.destroyed, false);
    versions.get("6806")();
    assert.equal(await run, 6806);
    assert.equal(exits(state).length, 0);
});

test("concurrent development startup keeps the external kernel and spawns only the additional workspace", async (t) => {
    const versions = new Map();
    const state = setup(t, () => 100, {
        allocatePort: async () => 6807,
        version: (_request, _fixture, port) => new Promise(resolve => versions.set(port, resolve)),
    });
    runtimePaths.isDevEnv = true;
    const runs = [state.run("workspace-a"), state.run("workspace-b")];
    await state.settleMicrotasks();
    assert.equal(state.spawns(), 1);
    const args = state.events.find(event => Array.isArray(event) && event[0] === "spawn-args")[1];
    assert.equal(args[args.indexOf("--workspace") + 1], "workspace-b");
    versions.forEach(resolve => resolve());
    assert.deepEqual(await Promise.all(runs), [6806, 6807]);
});

test("workspace lock retries retain one window and port until startup succeeds", async (t) => {
    let previousExitChecks = 0;
    const state = setup(t, () => 100, {
        platform: "linux",
        previousExit: async () => { previousExitChecks++; return true; },
        version: (request, fixture) => {
            if (request <= 3) {
                fixture.closeKernel(24);
                return new Error("net::ERR_CONNECTION_REFUSED");
            }
        },
    });
    assert.equal(await state.run(), 6806);
    assert.equal(state.spawns(), 4);
    assert.equal(previousExitChecks, 4);
    assert.equal(state.events.filter(event => event === "create-boot").length, 1);
    assert.equal(state.events.filter(event => event === "show-boot").length, 1);
    assert.equal(state.events.some(event => Array.isArray(event) && event[0] === "error-window"), false);
    assert.equal(state.context.kernelProcesses.size, 1);
    assert.equal(state.window.previousExitWaiting, "");
    assert.equal(exits(state).length, 0);
    assert.equal(state.context.app.listenerCount("before-quit"), 0);
});

test("lock retries have a fixed deadline and report one terminal error", async (t) => {
    const state = setup(t, () => 100, {version: (_request, fixture) => {
        fixture.closeKernel(24);
        return new Error("net::ERR_CONNECTION_REFUSED");
    }});
    assert.equal(await state.run(), undefined);
    assert.equal(state.spawns(), 90);
    assert.equal(state.events.filter(event => Array.isArray(event) && event[0] === "error-window").length, 1);
    assert.equal(state.events.filter(event => event === "exit-app").length, 1);
    assert.equal(state.context.kernelProcesses.size, 0);
    assert.equal(exits(state).length, 0);
});

test("closing, canceling or quitting during lock retry prevents another spawn", async (t) => {
    for (const action of ["close", "cancel", "quit"]) {
        const state = setup(t, () => 100, {
            version: (_request, fixture) => {
                fixture.closeKernel(24);
                return new Error("net::ERR_CONNECTION_REFUSED");
            },
            onSleep: (_ms, fixture) => {
                if (action === "close") fixture.window.destroyed = true;
                if (action === "cancel") {
                    fixture.context.bootWindow = {isDestroyed: () => false, destroy: () => assert.fail("unrelated window")};
                    fixture.context.localKernelStartups.values().next().value.canceled = true;
                }
                if (action === "quit") {
                    fixture.context.app.on("before-quit", event => event.preventDefault());
                    const event: {prevented?: boolean; preventDefault(): void} =
                        {preventDefault() { this.prevented = true; }};
                    fixture.context.app.emit("before-quit", event);
                    assert.equal(event.prevented, true);
                }
            },
        });
        assert.equal(await state.run(), undefined);
        assert.equal(state.spawns(), 1);
        assert.equal(exits(state).length, 0);
        assert.equal(state.events.some(event => Array.isArray(event) && event[0] === "error-window"), false);
        assert.equal(state.window.destroyed, true);
    }
});

test("a marker appearing on retry retains long graceful exit recovery", async (t) => {
    let checks = 0;
    const state = setup(t, () => 100, {
        previousExit: async (_workspace, options) => {
            if (++checks === 2) {
                assert.equal(state.spawns(), 1);
                await options.onWaiting();
                state.advance(120000);
            }
            return true;
        },
        version: (request, fixture) => {
            if (request === 1) {
                fixture.closeKernel(24);
                return new Error("net::ERR_CONNECTION_REFUSED");
            }
        },
    });
    assert.equal(await state.run(), 6806);
    assert.equal(state.spawns(), 2);
    assert.equal(exits(state).length, 0);
});

test("late responses from a locked attempt cannot settle its replacement", async (t) => {
    for (const reject of [false, true]) {
        let finishOld;
        let finishNew;
        const state = setup(t, () => 100, {version: request => new Promise<void>((resolve, rejectRequest) => {
            if (request === 1) finishOld = () => reject ? rejectRequest(new Error("late failure")) : resolve();
            else finishNew = resolve;
        })});
        let settled = false;
        const run = state.run().then(result => { settled = true; return result; });
        await state.settleMicrotasks();
        state.closeKernel(24);
        await state.settleMicrotasks();
        assert.equal(state.spawns(), 2);
        finishOld();
        await state.settleMicrotasks();
        assert.equal(settled, false);
        assert.equal(state.window.destroyed, false);
        finishNew();
        assert.equal(await run, 6806);
        assert.equal(exits(state).length, 0);
    }
});

test("retry remains bound to its original workspace when the last workspace changes", async (t) => {
    const checked = [];
    const state = setup(t, () => 100, {
        previousExit: async workspace => { checked.push(workspace); return true; },
        version: (request, fixture) => {
            if (request === 1) {
                fixture.closeKernel(24);
                return new Error("net::ERR_CONNECTION_REFUSED");
            }
        },
        onSleep: (_ms, fixture) => { fixture.context.lastWorkspacePath = "other-workspace"; },
    });
    assert.equal(await state.run(), 6806);
    assert.deepEqual(checked, ["workspace", "workspace"]);
    const args = state.events.filter(event => Array.isArray(event) && event[0] === "spawn-args")[1][1];
    assert.equal(args[args.indexOf("--workspace") + 1], "workspace");
});

test("canceling retry marker recovery or declining its sync failure does not respawn", async (t) => {
    for (const action of ["cancel", "sync-failure"]) {
        let checks = 0;
        const state = setup(t, () => 100, {
            previousExit: async (_workspace, options) => {
                if (++checks === 1) return true;
                await options.onWaiting();
                if (action === "sync-failure") return options.onRecoveryFailed(true);
                state.context.bootWindow = {isDestroyed: () => false};
                state.context.localKernelStartups.values().next().value.canceled = true;
                return true;
            },
            version: (_request, fixture) => {
                fixture.closeKernel(24);
                return new Error("net::ERR_CONNECTION_REFUSED");
            },
        });
        assert.equal(await state.run(), undefined);
        assert.equal(state.spawns(), 1);
        assert.equal(exits(state).length, 0);
        assert.equal(state.window.destroyed, true);
    }
});

test("expected exits and other error codes do not retry kernel spawning", async (t) => {
    for (const code of [0, 20, 21, 25, 26, 24]) {
        const state = setup(t, () => 100, {version: (_request, fixture) => {
            if (code === 24) fixture.context.expectedKernelExitPorts.add("6806");
            fixture.closeKernel(code);
            return new Error("net::ERR_CONNECTION_REFUSED");
        }});
        assert.equal(await state.run(), undefined);
        assert.equal(state.spawns(), 1);
    }
});

test("code 24 after startup success retains runtime failure handling", async (t) => {
    const state = setup(t, () => 100);
    assert.equal(await state.run(), 6806);
    state.closeKernel(24);
    await state.settleMicrotasks();
    assert.equal(state.spawns(), 1);
    assert.equal(state.events.filter(event => Array.isArray(event) && event[0] === "error-window").length, 1);
});

test("startup shows previous-exit waiting and spawns only after it completes", async (t) => {
    const marker = {pid: 123, startedAt: 1000, processStartedAt: 800};
    const signal = new AbortController().signal;
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const state = setup(t, () => 100, {previousExit: async (_workspace, options) => {
        await options.watchProcess(marker, signal);
        await options.onWaiting();
        return pending;
    }});
    const run = state.run();
    await state.settleMicrotasks();
    const observation = state.events.find(event => Array.isArray(event) && event[0] === "watch-exit-process");
    assert.ok(observation[1].includes("SiYuan-Kernel"));
    assert.equal(observation[2], marker);
    assert.equal(observation[3], signal);
    assert.equal(state.versionRequests(), 0);
    assert.equal(state.events.some(event => typeof event === "string" && event.startsWith("spawned kernel")), false);
    assert.equal(state.window.previousExitWaiting, "Waiting for the previous shutdown to finish...");
    assert.ok(state.events.some(event => Array.isArray(event) && event[0] === "boot-script" &&
        event[1].includes(JSON.stringify(state.window.previousExitWaiting))));
    assert.equal(state.events.some(event => Array.isArray(event) && event[0] === "load-file"), false);
    finish(true);
    assert.equal(await run, 6806);
    assert.equal(state.window.previousExitWaiting, "");
    assert.ok(state.events.some(event => Array.isArray(event) && event[0] === "boot-script" &&
        event[1] === 'window.setPreviousExitWaiting("")'));
    assert.equal(state.events.includes("resume-boot"), false);
});

test("canceled or failed previous-exit waiting never spawns or kills a kernel", async (t) => {
    for (const failure of [false, true]) {
        const state = setup(t, () => 100, {previousExit: async () => {
            if (failure) throw new Error("timeout");
            return false;
        }});
        assert.equal(await state.run(), undefined);
        assert.equal(state.versionRequests(), 0);
        assert.equal(exits(state).length, 0);
        assert.equal(state.events.some(event => typeof event === "string" && event.startsWith("spawned kernel")), false);
    }
});

test("boot recovery reports sync failure and cancel closes only the waiting window", async (t) => {
    const signal = new AbortController().signal;
    const state = setup(t, () => 100, {previousExit: async (workspace, options) => {
        assert.equal(options.hasActiveWindow(), false);
        assert.equal(await options.recover({pid: 123}, signal), 1);
        return options.onRecoveryFailed(true);
    }});
    assert.equal(await state.run(), undefined);
    assert.ok(state.events.some(event => Array.isArray(event) && event[0] === "recover-exit" && event[3] === signal));
    const prompt = state.events.find(event => Array.isArray(event) && event[0] === "recovery-dialog")[1];
    assert.match(prompt.message, /Synchronization failed/);
    assert.deepEqual(Array.from(prompt.buttons), ["Retry", "Cancel", "Force exit"]);
    assert.equal(state.window.destroyed, true);
    assert.equal(state.versionRequests(), 0);
    assert.equal(exits(state).length, 0);
});

test("boot recovery forwards an explicit forced exit before starting a replacement kernel", async (t) => {
    const signal = new AbortController().signal;
    const state = setup(t, () => 100, {recoveryResponse: 2, previousExit: async (_workspace, options) => {
        assert.equal(await options.onRecoveryFailed(true), "force");
        await options.recover({pid: 123}, signal, true);
        return true;
    }});
    assert.equal(await state.run(), 6806);
    const recovered = state.events.findIndex(event => Array.isArray(event) && event[0] === "recover-exit" && event[4] === true);
    const spawned = state.events.findIndex(event => Array.isArray(event) && event[0] === "spawn-args");
    assert.ok(recovered >= 0 && spawned > recovered);
    assert.equal(state.window.destroyed, false);
});

test("boot recovery offers only retry and cancel after a transport failure", async (t) => {
    const state = setup(t, () => 100, {previousExit: async (_workspace, options) => options.onRecoveryFailed(false)});
    assert.equal(await state.run(), undefined);
    const prompt = state.events.find(event => Array.isArray(event) && event[0] === "recovery-dialog")[1];
    assert.deepEqual(Array.from(prompt.buttons), ["Retry", "Cancel"]);
});

test("boot progress recovers from certificate and network changes without exiting the kernel", async (t) => {
    for (const error of ["CERT_DATABASE_CHANGED", "CERT_VERIFIER_CHANGED", "NETWORK_CHANGED"]) {
        const fixture = setup(t, request => request === 1 ? new Error("net::ERR_" + error) : 100);
        assert.equal(await fixture.run(), 6806);
        assert.equal(fixture.requests(), 2);
        assert.deepEqual(fixture.waits, [500, 200]);
        assert.equal(exits(fixture).length, 0);
        assert.equal(fixture.window.destroyed, false);
    }
});

test("boot progress limits consecutive transient failures to fifteen requests", async (t) => {
    const fixture = setup(t, certificateChange);
    assert.equal(await fixture.run(), undefined);
    assert.equal(fixture.requests(), 15);
    assert.deepEqual(fixture.waits, Array(14).fill(500));
    assert.equal(exits(fixture).length, 1);
    assert.equal(fixture.window.destroyed, true);
});

test("a successful progress response resets the consecutive failure budget", async (t) => {
    const fixture = setup(t, request => request === 15 ? 50 : request === 30 ? 100 : certificateChange());
    assert.equal(await fixture.run(), 6806);
    assert.equal(fixture.requests(), 30);
    assert.equal(exits(fixture).length, 0);
});

test("retries preserve the overall boot timeout", async (t) => {
    const fixture = setup(t, certificateChange, {onSleep: (ms, state) => state.advance(300000)});
    assert.equal(await fixture.run(), undefined);
    assert.equal(fixture.requests(), 1);
    assert.equal(exits(fixture).length, 1);
    assert.ok(fixture.events.some(event => Array.isArray(event) && event[1] === "Boot timeout"));
});

test("ordinary progress polling still waits for completion", async (t) => {
    const fixture = setup(t, request => request === 1 ? 50 : 100);
    assert.equal(await fixture.run(), 6806);
    assert.deepEqual(fixture.waits, [100, 200]);
    assert.equal(exits(fixture).length, 0);
});

test("non-transient connection, certificate and response errors retain failure handling", async (t) => {
    for (const error of [new Error("net::ERR_CONNECTION_REFUSED"), new Error("net::ERR_CERT_AUTHORITY_INVALID"),
        new SyntaxError("Unexpected end of JSON input")]) {
        const fixture = setup(t, () => error);
        assert.equal(await fixture.run(), undefined);
        assert.equal(fixture.requests(), 1);
        assert.deepEqual(fixture.waits, []);
        assert.equal(exits(fixture).length, 1);
        assert.equal(fixture.window.destroyed, true);
    }
});

test("closing or canceling startup exits its kernel without destroying another window", async (t) => {
    for (const cancel of [false, true]) {
        const fixture = setup(t, certificateChange, {onSleep: (ms, state) => {
            if (cancel) {
                state.context.bootWindow = {isDestroyed: () => false, destroy: () => assert.fail("unrelated window")};
                state.context.localKernelStartups.values().next().value.canceled = true;
            } else {
                state.window.destroyed = true;
            }
        }});
        assert.equal(await fixture.run(), undefined);
        assert.equal(fixture.requests(), 1);
        assert.equal(exits(fixture).length, 1);
        assert.equal(fixture.window.destroyed, true);
        assert.equal(fixture.context.localKernelStartups.size, 0);
    }
});

test("kernel exit during retry stops polling even with a zero exit code", async (t) => {
    const fixture = setup(t, certificateChange, {onSleep: (ms, state) => state.closeKernel(0)});
    assert.equal(await fixture.run(), undefined);
    assert.equal(fixture.requests(), 1);
    assert.equal(exits(fixture).length, 0);
});

test("a late successful response cannot complete a canceled startup", async (t) => {
    const fixture = setup(t, (request, state) => {
        state.window.destroyed = true;
        return 100;
    });
    assert.equal(await fixture.run(), undefined);
    assert.deepEqual(fixture.waits, []);
    assert.equal(exits(fixture).length, 1);
});

test("kernel exit while finishing the startup animation does not open the main window", async (t) => {
    const fixture = setup(t, () => 100, {onSleep: (ms, state) => state.closeKernel(0)});
    assert.equal(await fixture.run(), undefined);
    assert.equal(exits(fixture).length, 0);
});

test("a hanging kernel version request fails boot after the retry budget instead of waiting forever", async (t) => {
    const fixture = setup(t, certificateChange, {version: () => ({hang: true})});
    const run = fixture.run();
    await fixture.settleMicrotasks();
    assert.deepEqual(fixture.timerDelays(), [5000]);
    for (let attempt = 0; attempt < 15; attempt++) {
        fixture.advance(5000);
        await fixture.settleMicrotasks();
    }
    assert.equal(await run, undefined);
    assert.equal(fixture.versionRequests(), 15);
    assert.equal(fixture.requests(), 0);
    assert.equal(exits(fixture).length, 1);
    assert.equal(fixture.window.destroyed, true);
    assert.ok(fixture.events.some(event => Array.isArray(event) && event[1] === "The kernel is not responding"));
});

test("a hanging kernel version request logs the local TCP configuration for diagnosis", async (t) => {
    const fixture = setup(t, certificateChange, {version: () => ({hang: true})});
    const run = fixture.run();
    await fixture.settleMicrotasks();
    for (let attempt = 0; attempt < 15; attempt++) {
        fixture.advance(5000);
        await fixture.settleMicrotasks();
    }
    assert.equal(await run, undefined);
    await fixture.settleMicrotasks();
    const commands = fixture.events.filter(event => Array.isArray(event) && event[0] === "exec-file");
    assert.deepEqual(commands.map(event => event[2]),
        ["int tcp show supplemental", "int ipv4 show global", "int ipv6 show global"]);
    assert.ok(commands.every(event => event[3] === 5000));
    assert.equal(fixture.events.filter(event => typeof event === "string" && event.startsWith("[tcp config] ")).length, 3);
});

test("a hanging progress request cannot block the startup deadline", async (t) => {
    const fixture = setup(t, () => ({hang: true}));
    const run = fixture.run();
    await fixture.settleMicrotasks();
    assert.deepEqual(fixture.timerDelays(), [5000]);
    for (let attempt = 0; attempt < 15; attempt++) {
        fixture.advance(5000);
        await fixture.settleMicrotasks();
    }
    assert.equal(await run, undefined);
    assert.equal(fixture.requests(), 15);
    assert.equal(exits(fixture).length, 1);
    assert.equal(fixture.window.destroyed, true);
    assert.ok(fixture.events.some(event => Array.isArray(event) && event[1] === "The kernel is not responding"));
});

test("completed local kernel requests clear their timeouts", async (t) => {
    const fixture = setup(t, () => 100);
    assert.equal(await fixture.run(), 6806);
    assert.equal(fixture.timerCount(), 0);
});

test("body reads retain the timeout for both startup queries", async (t) => {
    for (const version of [false, true]) {
        const fixture = setup(t, () => ({bodyHang: true}), version ? {version: () => ({bodyHang: true})} : {});
        const run = fixture.run();
        await fixture.settleMicrotasks();
        assert.deepEqual(fixture.timerDelays(), [5000]);
        for (let attempt = 0; attempt < 15; attempt++) {
            fixture.advance(5000);
            await fixture.settleMicrotasks();
        }
        assert.equal(await run, undefined);
        assert.equal(version ? fixture.versionRequests() : fixture.requests(), 15);
        assert.equal(exits(fixture).length, 1);
        assert.equal(fixture.timerCount(), 0);
    }
});

test("startup recovers when a stalled version or progress request succeeds on retry", async (t) => {
    for (const version of [false, true]) {
        const fixture = setup(t, request => !version && request === 1 ? {hang: true} : 100,
            version ? {version: request => request === 1 ? {bodyHang: true} : null} : {});
        const run = fixture.run();
        await fixture.settleMicrotasks();
        fixture.advance(5000);
        await fixture.settleMicrotasks();
        assert.equal(await run, 6806);
        assert.equal(exits(fixture).length, 0);
        assert.equal(fixture.timerCount(), 0);
    }
});

test("cancellation during a stalled version request stops retries without touching another window", async (t) => {
    for (const cancel of ["close", "cancel", "exit"]) {
        const fixture = setup(t, () => 100, {version: () => ({bodyHang: true})});
        const run = fixture.run();
        await fixture.settleMicrotasks();
        if (cancel === "close") {
            fixture.window.destroyed = true;
        } else if (cancel === "cancel") {
            fixture.context.bootWindow = {isDestroyed: () => false, destroy: () => assert.fail("unrelated window")};
            fixture.context.localKernelStartups.values().next().value.canceled = true;
        } else {
            fixture.closeKernel(0);
        }
        fixture.advance(5000);
        await fixture.settleMicrotasks();
        assert.equal(await run, undefined);
        assert.equal(fixture.versionRequests(), 1);
        assert.equal(exits(fixture).length, cancel === "exit" ? 0 : 1);
        assert.equal(fixture.window.destroyed, true);
        assert.equal(fixture.timerCount(), 0);
    }
});

test("closing the boot window between version retries stops before another request", async (t) => {
    const fixture = setup(t, () => 100, {version: certificateChange, onSleep: (ms, state) => {
        state.context.bootWindow = {isDestroyed: () => false, destroy: () => assert.fail("unrelated window")};
        state.window.destroyed = true;
    }});
    assert.equal(await fixture.run(), undefined);
    assert.equal(fixture.versionRequests(), 1);
    assert.equal(fixture.events.includes("destroy"), false);
});

test("TCP diagnosis does not delay boot failure or run on other platforms", async (t) => {
    for (const platform of ["win32", "linux", "darwin"]) {
        const fixture = setup(t, () => 100, {platform});
        let commands = 0;
        fixture.context.childProcess.execFile = () => { commands++; };
        await fixture.kernelBoot.showKernelUnresponsiveWindow("en");
        assert.ok(fixture.events.some(event => Array.isArray(event) && event[1] === "The kernel is not responding"));
        assert.equal(commands, platform === "win32" ? 1 : 0);
    }
});

