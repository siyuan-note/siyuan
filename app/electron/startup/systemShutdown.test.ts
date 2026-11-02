import {test} from "node:test";
import {requestGracefulKernelExit} from "../kernel/kernelExit";
import {state as runtime} from "../shared/runtime";
const assert = require("node:assert/strict");

// 退出观测集合由 runtime 持有，每个用例前清空避免互相影响。
// 退出请求的传输层契约：端口、选项与中止信号；桩函数只实现返回值。
type ExitRequest = (port: string | number, options: unknown, signal: AbortSignal) =>
    Promise<{json: () => Promise<{code: number}>}>;

const setup = () => {
    const timers = new Map<number, () => void>();
    runtime.kernel.exitedPorts.clear();
    const state: {exitedKernelPorts: Set<string>; requestKernelExit: ExitRequest} = {
        exitedKernelPorts: runtime.kernel.exitedPorts,
        requestKernelExit: async () => ({json: async () => ({code: 0})}),
    };
    const run = () => requestGracefulKernelExit(6806, {
        requestKernelExit: (port, options, signal) => state.requestKernelExit(port, options, signal),
        timeout: 30000,
        scheduleTimer: callback => { timers.set(1, callback); return 1; },
        cancelTimer: id => timers.delete(id as number),
    });
    return {state: Object.assign(state, {run}), timers};
};

test("system shutdown accepts an observed kernel exit without requesting its closed port", async () => {
    const {state, timers} = setup();
    state.exitedKernelPorts.add("6806");
    state.requestKernelExit = () => { throw new Error("closed port was requested"); };
    assert.equal(await state.run(), true);
    assert.equal(timers.size, 0);
});

test("transport and response failures require an observed exit of the same kernel", async () => {
    for (const failed of ["transport", "parse", "api", "timeout"]) {
        for (const exited of [false, true]) {
            const {state, timers} = setup();
            state.exitedKernelPorts.add("6807");
            state.requestKernelExit = async (_port, _options, signal) => {
                if (exited) state.exitedKernelPorts.add("6806");
                if (failed === "transport") return undefined;
                if (failed === "timeout") {
                    timers.get(1)();
                    assert.equal(signal.aborted, true);
                    return undefined;
                }
                return {json: async () => {
                    if (failed === "parse") throw new Error("closed response");
                    return {code: 1};
                }};
            };
            assert.equal(await state.run(), exited, `${failed}, exited=${exited}`);
            assert.equal(timers.size, 0);
        }
    }
});

test("successful graceful exits still use the non-forced API request", async () => {
    const {state, timers} = setup();
    state.requestKernelExit = async (port, options, signal) => {
        assert.equal(port, 6806);
        assert.deepEqual(JSON.parse(JSON.stringify(options)), {
            force: false, setCurrentWorkspace: false, execInstallPkg: 1,
        });
        assert.equal(signal.aborted, false);
        return {json: async () => ({code: 0})};
    };
    assert.equal(await state.run(), true);
    assert.equal(timers.size, 0);
});
