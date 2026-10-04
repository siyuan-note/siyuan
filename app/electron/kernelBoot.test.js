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
    let now = 0;
    let requests = 0;
    let closeKernel;
    const window = {
        destroyed: false,
        isDestroyed() { return this.destroyed; },
        destroy() { this.destroyed = true; events.push("destroy"); },
    };
    const fixture = {events, waits, window, closeKernel: code => closeKernel(code, null),
        requests: () => requests, advance: ms => { now += ms; }};
    const context = vm.createContext({
        path,
        process: {platform: "win32", env: {}},
        Date: {now: () => now},
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
        }})},
        sleep: async ms => {
            waits.push(ms);
            now += ms;
            await options.onSleep?.(ms, fixture);
        },
        net: {fetch: async url => {
            if (url.endsWith("/version")) {
                return {json: async () => ({code: 0, data: "3.8.6"})};
            }
            assert.equal(url, "https://127.0.0.1:6806/api/system/bootProgress");
            requests++;
            const result = await progress(requests, fixture);
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
