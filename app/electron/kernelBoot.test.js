const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "main.js"), "utf8");
const startup = source.slice(source.indexOf("const initKernel ="), source.indexOf("const fetchWithTimeout ="));
const certificateChange = () => new Error("net::ERR_CERT_DATABASE_CHANGED");

const setup = (progress, options = {}) => {
    const events = [];
    const waits = [];
    const timers = new Map();
    let now = 0;
    let timerId = 0;
    let requests = 0;
    let versionRequests = 0;
    let closeKernel;
    const window = {
        destroyed: false,
        isDestroyed() { return this.destroyed; },
        destroy() { this.destroyed = true; events.push("destroy"); },
    };
    const fixture = {events, waits, window, closeKernel: code => closeKernel(code, null),
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
        process: {platform: "win32", env: {}},
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
        kernelProcesses: new Map(), expectedKernelExitPorts: new Set(),
        createBootWindow: () => {}, showLocalBootWindow: () => {}, showAppleSiliconWarning: async () => true,
        getAvailablePort: async () => 6806, getServer: port => "https://127.0.0.1:" + port,
        writeLog: message => events.push(message),
        requestKernelExit: port => events.push(["exit-kernel", port]),
        showErrorWindow: (...args) => { events.push(["error-window", args[1]]); return 1; },
        exitApp: () => events.push("exit-app"),
        childProcess: {spawn: () => ({pid: 123, on: (event, callback) => {
            assert.equal(event, "close");
            closeKernel = callback;
        }}), execFile: (file, args, options, callback) => {
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
                const value = options.version ? await options.version(versionRequests, fixture) : null;
                if (value?.hang) return await hangUntilAbort(requestOptions.signal);
                if (value instanceof Error) throw value;
                return {json: async () => value || {code: 0, data: "3.8.6"}};
            }
            assert.equal(url, "https://127.0.0.1:6806/api/system/bootProgress");
            requests++;
            const result = await progress(requests, fixture);
            if (result?.hang) return await hangUntilAbort(requestOptions.signal);
            if (result instanceof Error) throw result;
            return {json: async () => ({code: 0, data: {progress: result}})};
        }},
    });
    fixture.context = context;
    vm.runInContext(startup, context);
    fixture.run = () => vm.runInContext("initKernel('', '', '', false)", context);
    return fixture;
};

const exits = fixture => fixture.events.filter(event => Array.isArray(event) && event[0] === "exit-kernel");

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

test("closing or replacing the boot window stops retrying without destroying another window", async () => {
    for (const replace of [false, true]) {
        const fixture = setup(certificateChange, {onSleep: (ms, state) => {
            if (replace) {
                state.context.bootWindow = {isDestroyed: () => false, destroy: () => assert.fail("unrelated window")};
            } else {
                state.window.destroyed = true;
            }
        }});
        assert.equal(await fixture.run(), false);
        assert.equal(fixture.requests(), 1);
        assert.equal(exits(fixture).length, 0);
        assert.equal(fixture.events.includes("destroy"), false);
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
    assert.equal(exits(fixture).length, 0);
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
