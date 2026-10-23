const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {test} = require("node:test");
const vm = require("node:vm");
const {EventEmitter} = require("node:events");

const source = readFileSync(path.join(__dirname, "main.js"), "utf8");
const startup = source.slice(source.indexOf("const getWorkspaceStartupKey ="), source.indexOf("const fetchWithTimeout ="));
const certificateChange = () => new Error("net::ERR_CERT_DATABASE_CHANGED");

const setup = (progress, options = {}) => {
    const events = [];
    const waits = [];
    const timers = new Map();
    let now = 0;
    let timerId = 0;
    let requests = 0;
    let versionRequests = 0;
    const closeKernels = new Map();
    let spawns = 0;
    const makeWindow = () => ({
        destroyed: false,
        isDestroyed() { return this.destroyed; },
        destroy() { this.destroyed = true; events.push("destroy"); },
        loadFile: async (file, options) => { events.push(["load-file", file, options]); },
        webContents: {executeJavaScript: async script => { events.push(["boot-script", script]); }},
    });
    const window = makeWindow();
    const windows = [];
    const fixture = {events, waits, window, windows, closeKernel: (code, port = 6806) => closeKernels.get(String(port))(code, null),
        spawns: () => spawns,
        requests: () => requests, versionRequests: () => versionRequests,
        timerCount: () => timers.size, timerDelays: () => Array.from(timers.values()).map(timer => timer.ms),
        settleMicrotasks: () => new Promise(resolve => setImmediate(resolve)),
        advance: ms => {
            now += ms;
            for (const [id, timer] of Array.from(timers)) {
                if (timer.at <= now) {
                    timers.delete(id);
                    timer.callback();
                }
            }
        }};
    const hangUntilAbort = signal => new Promise((resolve, reject) => {
        // 模拟请求既不会成功也不会失败：只有超时中止才拒绝。
        signal.addEventListener("abort", () => reject(new Error("The operation was aborted")), {once: true});
    });
    const context = vm.createContext({
        path,
        pathToFileURL,
        process: {platform: options.platform || "win32", env: {}},
        app: Object.assign(new EventEmitter(), {getPreferredSystemLanguages: () => ["en"]}),
        resolveAppLanguage: languages => languages[0],
        loadAppMenuLanguages: language => JSON.parse(readFileSync(path.join(__dirname, "../appearance/langs", language + ".json"), "utf8")),
        escapeHTML: value => String(value).replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        })[character]),
        Date: {now: () => now},
        AbortController,
        // 本地内核请求超时由计时器驱动，测试通过 advance 推进虚拟时间触发超时。
        setTimeout: (callback, ms) => {
            const id = ++timerId;
            timers.set(id, {callback, ms, at: now + ms});
            return id;
        },
        clearTimeout: id => timers.delete(id),
        fs: {existsSync: () => true},
        appDir: "app", confDir: "conf", lastWorkspacePath: "workspace", appVer: "3.8.6",
        bootWindow: window, kernelPort: 6806, isDevEnv: false, workspaces: [],
        localKernelStartups: new Map(), showWindow: () => events.push("show-existing"),
        bootIndexPath: "app/electron/boot.html",
        loadBootWindow: () => events.push("resume-boot"),
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
        requestWorkspaceExitRecovery: async (workspace, marker, signal, _fetch, _readFile, force) => {
            events.push(["recover-exit", workspace, marker.pid, signal, force]);
            return 1;
        },
        dialog: {showMessageBox: async (_window, message) => {
            events.push(["recovery-dialog", message]);
            return {response: options.recoveryResponse ?? 1};
        }},
        getAvailablePort: options.allocatePort || (async () => 6806), getServer: port => "https://127.0.0.1:" + port,
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
            await options.onSleep?.(ms, fixture);
        },
        net: {fetch: async (url, requestOptions = {}) => {
            if (url.endsWith("/version")) {
                versionRequests++;
                const value = options.version ? await options.version(versionRequests, fixture, new URL(url).port) : null;
                if (value?.hang) return await hangUntilAbort(requestOptions.signal);
                if (value instanceof Error) throw value;
                return {json: async () => value?.bodyHang ? await hangUntilAbort(requestOptions.signal) :
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
    });
    fixture.context = context;
    vm.runInContext(startup, context);
    fixture.run = (workspace = "", port = "", lang = "") => vm.runInContext(
        `initKernel(${JSON.stringify(workspace)}, ${JSON.stringify(port)}, ${JSON.stringify(lang)}, false)`, context);
    return fixture;
};

const exits = fixture => fixture.events.filter(event => Array.isArray(event) && event[0] === "exit-kernel");

test("kernel startup clears stale exit evidence and records its own process closure", async () => {
    const state = setup(() => 100);
    state.context.exitedKernelPorts.add("6806");
    assert.equal(await state.run(), 6806);
    assert.equal(state.context.exitedKernelPorts.has("6806"), false);
    state.closeKernel(0);
    assert.equal(state.context.exitedKernelPorts.has("6806"), true);
    assert.equal(state.context.kernelProcesses.has("6806"), false);
});

test("repeated requests reuse startup before port allocation and during kernel boot", async () => {
    let allocate;
    let version;
    const state = setup(() => 100, {
        allocatePort: () => new Promise(resolve => { allocate = resolve; }),
        version: () => new Promise(resolve => { version = resolve; }),
    });
    const run = state.run();
    assert.equal(await state.run(path.resolve("WORKSPACE", "child", "..") + path.sep), false);
    assert.equal(state.windows.length, 1);
    assert.equal(state.spawns(), 0);
    await state.settleMicrotasks();
    allocate(6806);
    await state.settleMicrotasks();
    assert.equal(await state.run("workspace"), false);
    assert.equal(state.spawns(), 1);
    assert.equal(state.windows.length, 1);
    assert.equal(state.events.filter(event => event === "show-existing").length, 2);
    version();
    assert.equal(await run, 6806);
    assert.equal(await state.run("workspace"), false);
    assert.equal(state.windows.length, 1);
});

test("a main window awaiting frontend initialization also prevents duplicate startup", async () => {
    const state = setup(() => 100);
    state.context.workspaces.push({workspaceDir: path.resolve("workspace"), browserWindow: state.window});
    assert.equal(await state.run("WORKSPACE"), false);
    assert.equal(state.windows.length, 0);
    assert.equal(state.spawns(), 0);
    assert.deepEqual(state.events, ["show-existing"]);
});

test("different workspaces retain their own windows, ports and languages in either completion order", async () => {
    for (const first of ["6806", "6807"]) {
        const versions = new Map();
        const allocations = [];
        const state = setup(() => 100, {
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

test("a failing startup destroys only its own window and exits only its own kernel", async () => {
    let port = 6805;
    let finishOther;
    const state = setup((_request, _state, port) => port === "6806" ? new Error("failed progress") : 100, {
        allocatePort: async () => ++port,
        version: (_request, _state, port) => port === "6807" ? new Promise(resolve => { finishOther = resolve; }) : null,
    });
    const a = state.run("workspace-a");
    const b = state.run("workspace-b");
    assert.equal(await a, false);
    assert.deepEqual(exits(state), [["exit-kernel", 6806]]);
    assert.equal(state.windows[0].destroyed, true);
    assert.equal(state.windows[1].destroyed, false);
    finishOther();
    assert.equal(await b, 6807);
});

test("quitting cancels every startup and requests each owned kernel to exit once", async () => {
    let port = 6805;
    const versions = [];
    const state = setup(() => 100, {
        allocatePort: async () => ++port,
        version: () => new Promise(resolve => versions.push(resolve)),
    });
    const runs = [state.run("workspace-a"), state.run("workspace-b")];
    await state.settleMicrotasks();
    state.context.app.emit("before-quit");
    assert.deepEqual(exits(state), [["exit-kernel", 6806], ["exit-kernel", 6807]]);
    assert.equal(state.windows.every(window => window.destroyed), true);
    versions.forEach(resolve => resolve());
    assert.deepEqual(await Promise.all(runs), [false, false]);
    assert.equal(exits(state).length, 2);
    assert.equal(state.context.localKernelStartups.size, 0);
});

test("canceling while allocating a port never spawns a kernel", async () => {
    let allocate;
    const state = setup(() => 100, {allocatePort: () => new Promise(resolve => { allocate = resolve; })});
    const run = state.run();
    await state.settleMicrotasks();
    state.context.app.emit("before-quit");
    allocate(6806);
    assert.equal(await run, false);
    assert.equal(state.spawns(), 0);
    assert.equal(exits(state).length, 0);
    assert.equal(state.window.destroyed, true);
});

test("second-instance reuses the default workspace startup and independently opens a different workspace", async () => {
    let port = 6805;
    const versions = new Map();
    const mainPorts = [];
    const state = setup(() => 100, {
        allocatePort: async () => ++port,
        version: (_request, _fixture, port) => new Promise(resolve => versions.set(port, resolve)),
    });
    Object.assign(state.context, {
        updateInstallPromise: undefined, remoteKernelArgError: undefined, remoteKernelTarget: undefined,
        getArgFrom: (argv, key) => argv.find(arg => arg.startsWith(key + "="))?.slice(key.length + 1),
        initMainWindow: port => mainPorts.push(port),
    });
    vm.runInContext(source.slice(source.indexOf('app.on("second-instance"'), source.indexOf('app.on("activate"')), state.context);
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

test("concurrent development startup keeps the external kernel and spawns only the additional workspace", async () => {
    const versions = new Map();
    const state = setup(() => 100, {
        allocatePort: async () => 6807,
        version: (_request, _fixture, port) => new Promise(resolve => versions.set(port, resolve)),
    });
    state.context.isDevEnv = true;
    const runs = [state.run("workspace-a"), state.run("workspace-b")];
    await state.settleMicrotasks();
    assert.equal(state.spawns(), 1);
    const args = state.events.find(event => Array.isArray(event) && event[0] === "spawn-args")[1];
    assert.equal(args[args.indexOf("--workspace") + 1], "workspace-b");
    versions.forEach(resolve => resolve());
    assert.deepEqual(await Promise.all(runs), [6806, 6807]);
});

test("workspace lock retries retain one window and port until startup succeeds", async () => {
    let previousExitChecks = 0;
    const state = setup(() => 100, {
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

test("lock retries have a fixed deadline and report one terminal error", async () => {
    const state = setup(() => 100, {version: (_request, fixture) => {
        fixture.closeKernel(24);
        return new Error("net::ERR_CONNECTION_REFUSED");
    }});
    assert.equal(await state.run(), false);
    assert.equal(state.spawns(), 90);
    assert.equal(state.events.filter(event => Array.isArray(event) && event[0] === "error-window").length, 1);
    assert.equal(state.events.filter(event => event === "exit-app").length, 1);
    assert.equal(state.context.kernelProcesses.size, 0);
    assert.equal(exits(state).length, 0);
});

test("closing, canceling or quitting during lock retry prevents another spawn", async () => {
    for (const action of ["close", "cancel", "quit"]) {
        const state = setup(() => 100, {
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
                    const event = {preventDefault() { this.prevented = true; }};
                    fixture.context.app.emit("before-quit", event);
                    assert.equal(event.prevented, true);
                }
            },
        });
        assert.equal(await state.run(), false);
        assert.equal(state.spawns(), 1);
        assert.equal(exits(state).length, 0);
        assert.equal(state.events.some(event => Array.isArray(event) && event[0] === "error-window"), false);
        assert.equal(state.window.destroyed, true);
    }
});

test("a marker appearing on retry retains long graceful exit recovery", async () => {
    let checks = 0;
    let state;
    state = setup(() => 100, {
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

test("late responses from a locked attempt cannot settle its replacement", async () => {
    for (const reject of [false, true]) {
        let finishOld;
        let finishNew;
        const state = setup(() => 100, {version: request => new Promise((resolve, rejectRequest) => {
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

test("retry remains bound to its original workspace when the last workspace changes", async () => {
    const checked = [];
    const state = setup(() => 100, {
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

test("canceling retry marker recovery or declining its sync failure does not respawn", async () => {
    for (const action of ["cancel", "sync-failure"]) {
        let checks = 0;
        let state;
        state = setup(() => 100, {
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
        assert.equal(await state.run(), false);
        assert.equal(state.spawns(), 1);
        assert.equal(exits(state).length, 0);
        assert.equal(state.window.destroyed, true);
    }
});

test("expected exits and other error codes do not retry kernel spawning", async () => {
    for (const code of [0, 20, 21, 25, 26, 24]) {
        const state = setup(() => 100, {version: (_request, fixture) => {
            if (code === 24) fixture.context.expectedKernelExitPorts.add("6806");
            fixture.closeKernel(code);
            return new Error("net::ERR_CONNECTION_REFUSED");
        }});
        assert.equal(await state.run(), false);
        assert.equal(state.spawns(), 1);
    }
});

test("code 24 after startup success retains runtime failure handling", async () => {
    const state = setup(() => 100);
    assert.equal(await state.run(), 6806);
    state.closeKernel(24);
    await state.settleMicrotasks();
    assert.equal(state.spawns(), 1);
    assert.equal(state.events.filter(event => Array.isArray(event) && event[0] === "error-window").length, 1);
});

test("startup shows previous-exit waiting and spawns only after it completes", async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const state = setup(() => 100, {previousExit: async (_workspace, options) => {
        await options.onWaiting();
        return pending;
    }});
    const run = state.run();
    await state.settleMicrotasks();
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

test("canceled or failed previous-exit waiting never spawns or kills a kernel", async () => {
    for (const failure of [false, true]) {
        const state = setup(() => 100, {previousExit: async () => {
            if (failure) throw new Error("timeout");
            return false;
        }});
        assert.equal(await state.run(), false);
        assert.equal(state.versionRequests(), 0);
        assert.equal(exits(state).length, 0);
        assert.equal(state.events.some(event => typeof event === "string" && event.startsWith("spawned kernel")), false);
    }
});

test("boot recovery reports sync failure and cancel closes only the waiting window", async () => {
    const signal = new AbortController().signal;
    const state = setup(() => 100, {previousExit: async (workspace, options) => {
        assert.equal(options.hasActiveWindow(), false);
        assert.equal(await options.recover({pid: 123}, signal), 1);
        return options.onRecoveryFailed(true);
    }});
    assert.equal(await state.run(), false);
    assert.ok(state.events.some(event => Array.isArray(event) && event[0] === "recover-exit" && event[3] === signal));
    const prompt = state.events.find(event => Array.isArray(event) && event[0] === "recovery-dialog")[1];
    assert.match(prompt.message, /Synchronization failed/);
    assert.deepEqual(Array.from(prompt.buttons), ["Retry", "Cancel", "Force exit"]);
    assert.equal(state.window.destroyed, true);
    assert.equal(state.versionRequests(), 0);
    assert.equal(exits(state).length, 0);
});

test("boot recovery forwards an explicit forced exit before starting a replacement kernel", async () => {
    const signal = new AbortController().signal;
    const state = setup(() => 100, {recoveryResponse: 2, previousExit: async (_workspace, options) => {
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

test("boot recovery offers only retry and cancel after a transport failure", async () => {
    const state = setup(() => 100, {previousExit: async (_workspace, options) => options.onRecoveryFailed(false)});
    assert.equal(await state.run(), false);
    const prompt = state.events.find(event => Array.isArray(event) && event[0] === "recovery-dialog")[1];
    assert.deepEqual(Array.from(prompt.buttons), ["Retry", "Cancel"]);
});

test("boot progress recovers from certificate and network changes without exiting the kernel", async () => {
    for (const error of ["CERT_DATABASE_CHANGED", "CERT_VERIFIER_CHANGED", "NETWORK_CHANGED"]) {
        const fixture = setup(request => request === 1 ? new Error("net::ERR_" + error) : 100);
        assert.equal(await fixture.run(), 6806);
        assert.equal(fixture.requests(), 2);
        assert.deepEqual(fixture.waits, [500, 200]);
        assert.equal(exits(fixture).length, 0);
        assert.equal(fixture.window.destroyed, false);
    }
});

test("boot progress limits consecutive transient failures to fifteen requests", async () => {
    const fixture = setup(certificateChange);
    assert.equal(await fixture.run(), false);
    assert.equal(fixture.requests(), 15);
    assert.deepEqual(fixture.waits, Array(14).fill(500));
    assert.equal(exits(fixture).length, 1);
    assert.equal(fixture.window.destroyed, true);
});

test("a successful progress response resets the consecutive failure budget", async () => {
    const fixture = setup(request => request === 15 ? 50 : request === 30 ? 100 : certificateChange());
    assert.equal(await fixture.run(), 6806);
    assert.equal(fixture.requests(), 30);
    assert.equal(exits(fixture).length, 0);
});

test("retries preserve the overall boot timeout", async () => {
    const fixture = setup(certificateChange, {onSleep: (ms, state) => state.advance(300000)});
    assert.equal(await fixture.run(), false);
    assert.equal(fixture.requests(), 1);
    assert.equal(exits(fixture).length, 1);
    assert.ok(fixture.events.some(event => Array.isArray(event) && event[1] === "Boot timeout"));
});

test("ordinary progress polling still waits for completion", async () => {
    const fixture = setup(request => request === 1 ? 50 : 100);
    assert.equal(await fixture.run(), 6806);
    assert.deepEqual(fixture.waits, [100, 200]);
    assert.equal(exits(fixture).length, 0);
});

test("non-transient connection, certificate and response errors retain failure handling", async () => {
    for (const error of [new Error("net::ERR_CONNECTION_REFUSED"), new Error("net::ERR_CERT_AUTHORITY_INVALID"),
        new SyntaxError("Unexpected end of JSON input")]) {
        const fixture = setup(() => error);
        assert.equal(await fixture.run(), false);
        assert.equal(fixture.requests(), 1);
        assert.deepEqual(fixture.waits, []);
        assert.equal(exits(fixture).length, 1);
        assert.equal(fixture.window.destroyed, true);
    }
});

test("closing or canceling startup exits its kernel without destroying another window", async () => {
    for (const cancel of [false, true]) {
        const fixture = setup(certificateChange, {onSleep: (ms, state) => {
            if (cancel) {
                state.context.bootWindow = {isDestroyed: () => false, destroy: () => assert.fail("unrelated window")};
                state.context.localKernelStartups.values().next().value.canceled = true;
            } else {
                state.window.destroyed = true;
            }
        }});
        assert.equal(await fixture.run(), false);
        assert.equal(fixture.requests(), 1);
        assert.equal(exits(fixture).length, 1);
        assert.equal(fixture.window.destroyed, true);
        assert.equal(fixture.context.localKernelStartups.size, 0);
    }
});

test("kernel exit during retry stops polling even with a zero exit code", async () => {
    const fixture = setup(certificateChange, {onSleep: (ms, state) => state.closeKernel(0)});
    assert.equal(await fixture.run(), false);
    assert.equal(fixture.requests(), 1);
    assert.equal(exits(fixture).length, 0);
});

test("a late successful response cannot complete a canceled startup", async () => {
    const fixture = setup((request, state) => {
        state.window.destroyed = true;
        return 100;
    });
    assert.equal(await fixture.run(), false);
    assert.deepEqual(fixture.waits, []);
    assert.equal(exits(fixture).length, 1);
});

test("kernel exit while finishing the startup animation does not open the main window", async () => {
    const fixture = setup(() => 100, {onSleep: (ms, state) => state.closeKernel(0)});
    assert.equal(await fixture.run(), false);
    assert.equal(exits(fixture).length, 0);
});

test("a hanging kernel version request fails boot after the retry budget instead of waiting forever", async () => {
    const fixture = setup(certificateChange, {version: () => ({hang: true})});
    const run = fixture.run();
    await fixture.settleMicrotasks();
    assert.deepEqual(fixture.timerDelays(), [5000]);
    for (let attempt = 0; attempt < 15; attempt++) {
        fixture.advance(5000);
        await fixture.settleMicrotasks();
    }
    assert.equal(await run, false);
    assert.equal(fixture.versionRequests(), 15);
    assert.equal(fixture.requests(), 0);
    assert.equal(exits(fixture).length, 1);
    assert.equal(fixture.window.destroyed, true);
    assert.ok(fixture.events.some(event => Array.isArray(event) && event[1] === "The kernel is not responding"));
});

test("a hanging kernel version request logs the local TCP configuration for diagnosis", async () => {
    const fixture = setup(certificateChange, {version: () => ({hang: true})});
    const run = fixture.run();
    await fixture.settleMicrotasks();
    for (let attempt = 0; attempt < 15; attempt++) {
        fixture.advance(5000);
        await fixture.settleMicrotasks();
    }
    assert.equal(await run, false);
    await fixture.settleMicrotasks();
    const commands = fixture.events.filter(event => Array.isArray(event) && event[0] === "exec-file");
    assert.deepEqual(commands.map(event => event[2]),
        ["int tcp show supplemental", "int ipv4 show global", "int ipv6 show global"]);
    assert.ok(commands.every(event => event[3] === 5000));
    assert.equal(fixture.events.filter(event => typeof event === "string" && event.startsWith("[tcp config] ")).length, 3);
});

test("a hanging progress request cannot block the startup deadline", async () => {
    const fixture = setup(() => ({hang: true}));
    const run = fixture.run();
    await fixture.settleMicrotasks();
    assert.deepEqual(fixture.timerDelays(), [5000]);
    for (let attempt = 0; attempt < 15; attempt++) {
        fixture.advance(5000);
        await fixture.settleMicrotasks();
    }
    assert.equal(await run, false);
    assert.equal(fixture.requests(), 15);
    assert.equal(exits(fixture).length, 1);
    assert.equal(fixture.window.destroyed, true);
    assert.ok(fixture.events.some(event => Array.isArray(event) && event[1] === "The kernel is not responding"));
});

test("completed local kernel requests clear their timeouts", async () => {
    const fixture = setup(() => 100);
    assert.equal(await fixture.run(), 6806);
    assert.equal(fixture.timerCount(), 0);
});

test("body reads retain the timeout for both startup queries", async () => {
    for (const version of [false, true]) {
        const fixture = setup(() => ({bodyHang: true}), version ? {version: () => ({bodyHang: true})} : {});
        const run = fixture.run();
        await fixture.settleMicrotasks();
        assert.deepEqual(fixture.timerDelays(), [5000]);
        for (let attempt = 0; attempt < 15; attempt++) {
            fixture.advance(5000);
            await fixture.settleMicrotasks();
        }
        assert.equal(await run, false);
        assert.equal(version ? fixture.versionRequests() : fixture.requests(), 15);
        assert.equal(exits(fixture).length, 1);
        assert.equal(fixture.timerCount(), 0);
    }
});

test("startup recovers when a stalled version or progress request succeeds on retry", async () => {
    for (const version of [false, true]) {
        const fixture = setup(request => !version && request === 1 ? {hang: true} : 100,
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

test("cancellation during a stalled version request stops retries without touching another window", async () => {
    for (const cancel of ["close", "cancel", "exit"]) {
        const fixture = setup(() => 100, {version: () => ({bodyHang: true})});
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
        assert.equal(await run, false);
        assert.equal(fixture.versionRequests(), 1);
        assert.equal(exits(fixture).length, cancel === "exit" ? 0 : 1);
        assert.equal(fixture.window.destroyed, true);
        assert.equal(fixture.timerCount(), 0);
    }
});

test("closing the boot window between version retries stops before another request", async () => {
    const fixture = setup(() => 100, {version: certificateChange, onSleep: (ms, state) => {
        state.context.bootWindow = {isDestroyed: () => false, destroy: () => assert.fail("unrelated window")};
        state.window.destroyed = true;
    }});
    assert.equal(await fixture.run(), false);
    assert.equal(fixture.versionRequests(), 1);
    assert.equal(fixture.events.includes("destroy"), false);
});

test("TCP diagnosis does not delay boot failure or run on other platforms", async () => {
    for (const platform of ["win32", "linux", "darwin"]) {
        const fixture = setup(() => 100, {platform});
        let commands = 0;
        fixture.context.childProcess.execFile = () => { commands++; };
        await vm.runInContext("showKernelUnresponsiveWindow('en')", fixture.context);
        assert.ok(fixture.events.some(event => Array.isArray(event) && event[1] === "The kernel is not responding"));
        assert.equal(commands, platform === "win32" ? 1 : 0);
    }
});
