const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "main.js"), "utf8");
const helpers = source.slice(source.indexOf("const getAvailablePort ="), source.indexOf("const initKernel ="));
const startup = source.slice(source.indexOf("    const startupStartedAt ="), source.indexOf("    connectionManager = createConnectionManager"));

const setup = (overrides = {}) => {
    const events = [];
    const window = {
        isDestroyed: () => false,
        setOpacity: value => events.push(["opacity", value]),
        once: (name, callback) => { window[name] = callback; },
        show: () => events.push("show"),
        minimize: () => events.push("minimize"),
    };
    const context = vm.createContext({
        Date, Promise, process: {platform: "win32"}, setImmediate: callback => callback(),
        isDevEnv: false, workspaces: ["workspace"], kernelPort: 6806,
        openAsHidden: false, bootWindow: window,
        remoteKernelArgError: false, remoteKernelTarget: false, firstOpen: false, lastWorkspaceMissing: false,
        readAppCrashInfo: () => undefined, getArg: () => "",
        writeLog: () => {},
        createBootWindow: () => events.push("create"),
        loadBootWindow: () => events.push(["load", context.kernelPort]),
        gNet: {createServer: () => ({
            on() {}, listen: (port, callback) => callback(),
            address: () => ({port: 7421}), close: callback => callback(),
        })},
        ...overrides,
    });
    vm.runInContext(helpers, context);
    return {context, events, window};
};

test("ordinary startup creates synchronously and loads once with the allocated port before showing", async () => {
    const {context, events, window} = setup();
    vm.runInContext(startup, context);
    assert.deepEqual(events, ["create"]);
    assert.equal(await vm.runInContext("preparedBoot.ready", context), 7421);
    assert.deepEqual(events, ["create", ["opacity", 0], ["load", 7421]]);
    window["ready-to-show"]();
    assert.deepEqual(events.slice(-2), ["show", ["opacity", 1]]);
});

test("special startup branches do not create a boot window", () => {
    for (const overrides of [
        {remoteKernelArgError: true}, {remoteKernelTarget: {}}, {firstOpen: true},
        {readAppCrashInfo: () => ({})}, {lastWorkspaceMissing: true},
    ]) {
        const {context, events} = setup(overrides);
        vm.runInContext(startup, context);
        assert.deepEqual(events, []);
    }
});

test("explicit ports and workspace-free development skip allocation", async () => {
    for (const [overrides, expected] of [[{}, "9000"], [{isDevEnv: true, workspaces: []}, 6806]]) {
        const {context} = setup({...overrides, gNet: {createServer: () => assert.fail("unexpected allocation")}});
        assert.equal(await vm.runInContext("getAvailablePort('9000')", context), expected);
    }
});

test("port allocation failure does not load or show the boot window", async () => {
    const {context, events} = setup({gNet: {createServer: () => {
        let fail;
        return {on: (name, callback) => { fail = callback; }, listen: () => fail(new Error("port unavailable"))};
    }}});
    vm.runInContext(startup, context);
    assert.equal(await vm.runInContext("preparedBoot.ready", context), "");
    assert.deepEqual(events, ["create"]);
});

test("hidden startup stays minimized and destroyed windows are not shown", async () => {
    const hidden = setup({openAsHidden: true});
    vm.runInContext(startup, hidden.context);
    await vm.runInContext("preparedBoot.ready", hidden.context);
    assert.deepEqual(hidden.events, ["create", ["load", 7421], "minimize"]);
    const destroyed = setup();
    vm.runInContext(startup, destroyed.context);
    destroyed.window.isDestroyed = () => true;
    await vm.runInContext("preparedBoot.ready", destroyed.context);
    assert.deepEqual(destroyed.events, ["create"]);
});
