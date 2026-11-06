import {test} from "node:test";
import {EventEmitter} from "node:events";
import type {BrowserWindow, MessageBoxOptions} from "electron";
import type {KernelExitOptions, Workspace} from "../shared/types";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import {resetRuntimeState} from "../shared/runtime";
const assert = require("node:assert/strict");

const setup = (t: any) => {
    resetRuntimeState();
    resetElectronStub();
    mockElectron(t);
    const {installWindowCloseRecovery, requestWindowClose} = require("./closeRecovery") as typeof import("./closeRecovery");
    let destroyed = false;
    let responsive = false;
    let decision = 0;
    let code = 0;
    let rejectRequest = false;
    let hangRequest = false;
    let finishDecision: ((value: {response: number}) => void) | undefined;
    let deferDecision = false;
    const timers = new Map<object, {callback: () => void; ms: number}>();
    const sent: boolean[] = [];
    const dialogs: MessageBoxOptions[] = [];
    const exits: Workspace[] = [];
    const kernel: {port: string | number; options?: KernelExitOptions; signal?: AbortSignal}[] = [];
    const window = Object.assign(new EventEmitter(), {
        isDestroyed: () => destroyed,
        webContents: {id: 1, send: (_channel: string, quit: boolean) => sent.push(quit),
            executeJavaScript: () => responsive ? Promise.resolve() : new Promise(() => {})},
    });
    const workspace = {webContentsId: 1, port: "6806", ownsKernel: true,
        browserWindow: window as unknown as BrowserWindow} as Workspace;
    installWindowCloseRecovery(window as unknown as BrowserWindow, {
        languages: {windowCloseTimeout: "unsaved edits", cancel: "wait", confirm: "exit", exitWaitFailed: "failed"},
        scheduleTimer: (callback, ms) => { const key = {}; timers.set(key, {callback, ms}); return key; },
        cancelTimer: key => { timers.delete(key as object); },
        showMessage: async options => {
            dialogs.push(options);
            if (deferDecision && dialogs.length === 1) return new Promise(resolve => { finishDecision = resolve; });
            return {response: decision};
        },
        requestExit: async (port, options, signal) => {
            kernel.push({port, options, signal});
            if (hangRequest) return new Promise((_resolve, reject) => {
                signal?.addEventListener("abort", () => reject(new Error("aborted")), {once: true});
            });
            if (rejectRequest) throw new Error("offline");
            return {json: async () => ({code, msg: "busy"})};
        },
        findWorkspace: () => workspace,
        exit: item => { exits.push(item); },
    });
    const settle = () => new Promise<void>(resolve => setImmediate(resolve));
    const fire = async (ms: number) => {
        const entry = Array.from(timers).find(([, value]) => value.ms === ms);
        assert.ok(entry, "missing timer " + ms);
        timers.delete(entry[0]);
        entry[1].callback();
        await settle();
    };
    return {window, workspace, sent, dialogs, exits, kernel, timers, fire, settle,
        close: (quit = false) => requestWindowClose(window as unknown as BrowserWindow, quit),
        responsive: () => { responsive = true; },
        chooseExit: () => { decision = 1; },
        fail: (reject = false) => { code = 1; rejectRequest = reject; },
        hang: () => { hangRequest = true; },
        defer: () => { deferDecision = true; },
        finishDecision: () => finishDecision?.({response: 1}),
        destroy: () => { destroyed = true; window.emit("closed"); },
    };
};

test("responsive renderers keep their own hide, save and sync flow", async t => {
    const f = setup(t);
    f.responsive();
    f.close();
    await f.fire(15000);
    assert.deepEqual(f.sent, [false]);
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.kernel.length, 0);
});

test("unresponsive close offers waiting by default and permits another attempt", async t => {
    const f = setup(t);
    f.close();
    await f.fire(15000);
    await f.fire(1000);
    assert.equal(f.dialogs[0].defaultId, 0);
    assert.equal(f.exits.length, 0);
    assert.equal(f.kernel.length, 0);
    f.close(true);
    assert.equal(f.timers.size, 1);
});

test("confirmed recovery waits for a non-forced kernel exit and deduplicates prompts", async t => {
    const f = setup(t);
    f.chooseExit();
    f.defer();
    f.close();
    f.close(true);
    assert.deepEqual(f.sent, [false, true]);
    await f.fire(15000);
    await f.fire(1000);
    f.close();
    assert.equal(f.dialogs.length, 1);
    assert.equal(f.exits.length, 0);
    f.finishDecision();
    await f.settle();
    assert.deepEqual(f.kernel[0].options, {force: false, setCurrentWorkspace: true, execInstallPkg: 1});
    assert.deepEqual(f.exits, [f.workspace]);
    assert.equal(f.timers.size, 0);
});

test("remote recovery closes the client without stopping the server", async t => {
    const f = setup(t);
    f.workspace.ownsKernel = false;
    f.chooseExit();
    f.close(true);
    await f.fire(15000);
    await f.fire(1000);
    assert.equal(f.kernel.length, 0);
    assert.deepEqual(f.exits, [f.workspace]);
});

test("kernel refusal and transport failures preserve the window and allow retry", async t => {
    for (const reject of [false, true]) {
        const f = setup(t);
        f.chooseExit();
        f.fail(reject);
        f.close();
        await f.fire(15000);
        await f.fire(1000);
        assert.equal(f.exits.length, 0);
        assert.equal(f.dialogs[1].message, "failed");
        f.close();
        assert.equal(f.timers.size, 1);
    }
});

test("window closure cancels timers and invalidates pending confirmation", async t => {
    const f = setup(t);
    f.defer();
    f.close();
    await f.fire(15000);
    await f.fire(1000);
    f.destroy();
    f.finishDecision();
    await f.settle();
    assert.equal(f.kernel.length, 0);
    assert.equal(f.exits.length, 0);
    assert.equal(f.timers.size, 0);
});

test("kernel exit timeout and window destruction abort the in-flight request", async t => {
    for (const destroyed of [false, true]) {
        const f = setup(t);
        f.hang();
        f.chooseExit();
        f.close();
        await f.fire(15000);
        await f.fire(1000);
        assert.equal(f.kernel[0].signal?.aborted, false);
        if (destroyed) f.destroy();
        else await f.fire(30000);
        await f.settle();
        assert.equal(f.kernel[0].signal?.aborted, true);
        assert.equal(f.exits.length, 0);
        assert.equal(f.timers.size, 0);
        assert.equal(f.dialogs.length, destroyed ? 1 : 2);
    }
});
