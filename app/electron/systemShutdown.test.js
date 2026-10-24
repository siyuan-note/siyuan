const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "main.js"), "utf8");
const handler = source.slice(source.indexOf("const requestGracefulKernelExit ="),
    source.indexOf("const resetSystemShutdown ="));

const setup = () => {
    const timers = new Map();
    const context = vm.createContext({
        exitedKernelPorts: new Set(), AbortController, systemShutdownExitTimeout: 30000,
        setTimeout: callback => { timers.set(1, callback); return 1; },
        clearTimeout: id => timers.delete(id), writeLog() {},
        requestKernelExit: async () => ({json: async () => ({code: 0})}),
    });
    vm.runInContext(handler, context);
    return {context, timers, run: () => vm.runInContext("requestGracefulKernelExit(6806)", context)};
};

test("system shutdown accepts an observed kernel exit without requesting its closed port", async () => {
    const state = setup();
    state.context.exitedKernelPorts.add("6806");
    state.context.requestKernelExit = () => { throw new Error("closed port was requested"); };
    assert.equal(await state.run(), true);
    assert.equal(state.timers.size, 0);
});

test("transport and response failures require an observed exit of the same kernel", async () => {
    for (const failed of ["transport", "parse", "api", "timeout"]) {
        for (const exited of [false, true]) {
            const state = setup();
            state.context.exitedKernelPorts.add("6807");
            state.context.requestKernelExit = async (_port, _options, signal) => {
                if (exited) state.context.exitedKernelPorts.add("6806");
                if (failed === "transport") return undefined;
                if (failed === "timeout") {
                    state.timers.get(1)();
                    assert.equal(signal.aborted, true);
                    return undefined;
                }
                return {json: async () => {
                    if (failed === "parse") throw new Error("closed response");
                    return {code: 1};
                }};
            };
            assert.equal(await state.run(), exited, `${failed}, exited=${exited}`);
            assert.equal(state.timers.size, 0);
        }
    }
});

test("successful graceful exits still use the non-forced API request", async () => {
    const state = setup();
    state.context.requestKernelExit = async (port, options, signal) => {
        assert.equal(port, 6806);
        assert.deepEqual(JSON.parse(JSON.stringify(options)), {
            force: false, setCurrentWorkspace: false, execInstallPkg: 1,
        });
        assert.equal(signal.aborted, false);
        return {json: async () => ({code: 0})};
    };
    assert.equal(await state.run(), true);
    assert.equal(state.timers.size, 0);
});
