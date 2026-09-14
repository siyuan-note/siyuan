const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {test} = require("node:test");
const {createNotebookSystemLock, prepareNotebookSystemLock} = require("./notebookSystemLock");

const workspace = (port, ownsKernel = true) => ({
    ownsKernel,
    workspaceDir: ownsKernel ? "D:/workspace" : "",
    kernelTarget: {origin: "http://127.0.0.1:" + port},
});
const config = JSON.stringify({system: {encryptedNotebookFollowSystemLock: true}, api: {token: "secret"}});

test("system lock submits pending edits before authenticated local requests without renderer windows", async () => {
    const events = [];
    const controller = createNotebookSystemLock({
        getWorkspaces: () => [workspace(6806), workspace(6806), workspace(6807), workspace(6808, false)],
        readFile: async () => config,
        prepare: async item => { events.push("prepare:" + item.kernelTarget.origin); },
        fetch: async (url, options) => {
            assert.ok(events.includes("prepare:" + new URL(url).origin));
            assert.equal(options.headers.Authorization, "Token secret");
            assert.equal(options.credentials, "omit");
            assert.equal(options.redirect, "error");
            assert.equal(options.body, "{}");
            events.push(url);
            return {ok: true, json: async () => ({code: 0})};
        },
        writeLog: assert.fail,
    });
    await controller.lock();
    assert.equal(events.length, 4);
    await controller.retry();
    assert.equal(events.length, 4);
});

test("disabled system lock does not flush editors or request a lock", async () => {
    const controller = createNotebookSystemLock({
        getWorkspaces: () => [workspace(6806)],
        readFile: async () => "{}",
        prepare: assert.fail,
        fetch: assert.fail,
        writeLog: assert.fail,
    });
    await controller.lock();
    await controller.retry();
});

test("an editor disappearing during preparation cannot suppress the kernel lock", async () => {
    let requests = 0;
    const controller = createNotebookSystemLock({
        getWorkspaces: () => [workspace(6806)],
        readFile: async () => config,
        prepare: async () => { throw new Error("destroyed"); },
        fetch: async () => {
            requests++;
            return {ok: true, json: async () => ({code: 0})};
        },
        writeLog: () => {},
    });
    await controller.lock();
    assert.equal(requests, 1);
});

test("unlock retries failed requests and reads current credentials without logging secrets", async () => {
    let attempts = 0;
    const logs = [];
    const controller = createNotebookSystemLock({
        getWorkspaces: () => [workspace(6806)],
        readFile: async () => config,
        fetch: async () => {
            if (++attempts === 1) {
                throw new Error("secret");
            }
            return {ok: true, json: async () => ({code: 0})};
        },
        writeLog: message => logs.push(message),
    });
    await controller.lock();
    assert.equal(attempts, 1);
    assert.equal(logs.length, 1);
    assert.ok(!logs[0].includes("secret"));
    await controller.retry();
    await controller.retry();
    assert.equal(attempts, 2);
});

test("resume waits for an in-flight failure and does not retry closed workspaces", async () => {
    let reject;
    let attempts = 0;
    let workspaces = [workspace(6806)];
    const controller = createNotebookSystemLock({
        getWorkspaces: () => workspaces,
        readFile: async () => config,
        fetch: () => {
            attempts++;
            return new Promise((_resolve, fail) => { reject = fail; });
        },
        writeLog: () => {},
    });
    const locking = controller.lock();
    await new Promise(resolve => setImmediate(resolve));
    const retrying = controller.retry();
    workspaces = [];
    reject(new Error("suspended"));
    await Promise.all([locking, retrying]);
    assert.equal(attempts, 1);
});

test("editor preparation waits for every main frame and removes its listener", async () => {
    const ipc = new EventEmitter();
    const messages = [];
    const windows = [1, 2].map(id => ({
        isDestroyed: () => false,
        webContents: {id, mainFrame: {}, send: (_channel, message) => messages.push(message)},
    }));
    let completed = false;
    const preparation = prepareNotebookSystemLock(windows, ipc).then(() => { completed = true; });
    const id = messages[0].data;
    ipc.emit("siyuan-notebook-system-lock-ready", {sender: windows[0].webContents, senderFrame: {}}, id);
    await Promise.resolve();
    assert.equal(completed, false);
    for (const window of windows) {
        ipc.emit("siyuan-notebook-system-lock-ready", {
            sender: window.webContents, senderFrame: window.webContents.mainFrame,
        }, id);
    }
    await preparation;
    assert.equal(completed, true);
    assert.equal(ipc.listenerCount("siyuan-notebook-system-lock-ready"), 0);
});

test("unresponsive editors cannot prevent system lock indefinitely", async () => {
    const ipc = new EventEmitter();
    await prepareNotebookSystemLock([{isDestroyed: () => false, webContents: {id: 1, send: () => {}}}], ipc);
    assert.equal(ipc.listenerCount("siyuan-notebook-system-lock-ready"), 0);
});
