import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import type {BrowserWindow, IpcMain} from "electron";
import type {KernelTarget} from "../shared/types";
const test = require("node:test");
const assert = require("node:assert/strict");

// 被测模块从 electron 取 ipcMain 与 BrowserWindow，首次加载前必须先换成替身。
const messagingModule = (t: any, overrides: {ipcMain?: unknown; BrowserWindow?: unknown} = {}) => {
    resetElectronStub();
    mockElectron(t, overrides as never);
    return require("./windowMessaging");
};

const createFixture = (t: any, senderId) => {
    const {dispatchWindowMessage} = messagingModule(t);
    const windows = new Map([
        [1101, "https://remote.example.com:6806"],
        [1102, "https://remote.example.com:6806"],
        [2101, "http://127.0.0.1:6806"],
        [3201, undefined],
    ]);
    const deliveries = [];
    const getAllWindows = () => [...windows.entries()].map(([id]) => ({
        isDestroyed: () => false,
        webContents: {
            id,
            send: (channel, data) => deliveries.push({id, channel, data}),
        },
    }));
    return {
        deliveries,
        dispatch: (data) => dispatchWindowMessage(data, {
            senderWebContentsId: senderId,
            getKernelTarget: (id) => windows.has(id) && windows.get(id) ?
                {mode: "remote", origin: windows.get(id), ownsKernel: false, port: "6806"} as KernelTarget : undefined,
            getAllWindows: getAllWindows as unknown as () => BrowserWindow[],
        }),
    };
};

test("远端内核发送方无法向本地工作区投递窗口消息", (t) => {
    const f = createFixture(t, 1101);
    assert.equal(f.dispatch({cmd: "closetab", data: "tab-1"}), true);
    assert.deepEqual(f.deliveries.map(item => item.id), [1102]);
});

test("本地发送方无法向另一个工作区投递窗口消息", (t) => {
    const f = createFixture(t, 2101);
    f.dispatch({cmd: "setTabDragData", data: {title: "文档"}});
    assert.deepEqual(f.deliveries, []);
});

test("渲染进程无法伪造主进程的 lockscreenByMode 通知", (t) => {
    const f = createFixture(t, 2101);
    assert.equal(f.dispatch({cmd: "lockscreenByMode"}), false);
    assert.deepEqual(f.deliveries, []);
});

test("非法命令与非法载荷一律拒绝", (t) => {
    const f = createFixture(t, 1101);
    for (const data of [
        undefined,
        null,
        "closetab",
        {},
        {cmd: 1, data: "x"},
        {cmd: "unknown", data: "x"},
        {cmd: "closetab"},
        {cmd: "closetab", data: 1},
        {cmd: "resetTabsStyle", data: 1},
        {cmd: "setTabDragData", data: "not-an-object"},
        {cmd: "setTabDragData", data: null},
    ]) {
        assert.equal(f.dispatch(data), false, JSON.stringify(data));
    }
    assert.deepEqual(f.deliveries, []);
});

test("合法命令仍按同工作区投递", (t) => {
    const f = createFixture(t, 1101);
    assert.equal(f.dispatch({cmd: "closetab", data: "tab-1"}), true);
    assert.equal(f.dispatch({cmd: "resetTabsStyle", data: "addRegionStyle"}), true);
    assert.equal(f.dispatch({cmd: "resetTabsStyle", data: "rmDragStyle"}), true);
    assert.equal(f.dispatch({cmd: "setTabDragData", data: {title: "文档"}}), true);
    assert.deepEqual(f.deliveries.map(item => [item.id, item.channel]), [
        [1102, "siyuan-send-windows"], [1102, "siyuan-send-windows"],
        [1102, "siyuan-send-windows"], [1102, "siyuan-send-windows"],
    ]);
});

test("未登记内核目标的窗口既不能发送也不能接收", (t) => {
    const unregistered = createFixture(t, 3201);
    assert.equal(unregistered.dispatch({cmd: "closetab", data: "tab-1"}), false);
    assert.deepEqual(unregistered.deliveries, []);
    // 已登记发送方只投递给同工作区窗口，未登记的 3201 不接收
    const registered = createFixture(t, 1101);
    registered.dispatch({cmd: "closetab", data: "tab-1"});
    assert.deepEqual(registered.deliveries.map(item => item.id), [1102]);
});

test("document tab transfers retain workspace isolation and reject malformed editor payloads", (t) => {
    const f = createFixture(t, 1101);
    const data = {id: "source", children: {instance: "Editor", blockId: "block", notebookId: "box"}};
    assert.equal(f.dispatch({cmd: "moveTabToMainWindow", data}), true);
    assert.deepEqual(f.deliveries.map(item => item.id), [1102]);
    for (const invalid of [undefined, "source", {}, {...data, id: ""},
        {...data, children: {instance: "Custom", blockId: "block"}},
        {...data, children: {instance: "Editor", blockId: 1}},
        {...data, children: {instance: "Editor", blockId: "block", notebookId: {}}}]) {
        assert.equal(f.dispatch({cmd: "moveTabToMainWindow", data: invalid}), false);
    }
    const unregistered = createFixture(t, 3201);
    assert.equal(unregistered.dispatch({cmd: "moveTabToMainWindow", data}), false);
});

test("主进程 handler 按发送方与内核目标接线到 dispatchWindowMessage", (t) => {
    const deliveries = [];
    const handlers = new Map();
    const origins = new Map([
        [1101, "https://remote.example.com:6806"],
        [2101, "http://127.0.0.1:6806"],
        [2102, "http://127.0.0.1:6806"],
    ]);
    const windows = [...origins.keys()].map(id => ({
        isDestroyed: () => false,
        webContents: {
            id,
            send: (channel, data) => deliveries.push({id, channel, data}),
        },
    }));
    const {registerWindowMessageHandler} = messagingModule(t, {
        ipcMain: {on: (channel, handler) => handlers.set(channel, handler)} as unknown as IpcMain,
        BrowserWindow: {getAllWindows: () => windows} as unknown as typeof BrowserWindow,
    });
    registerWindowMessageHandler(id => ({mode: "local", origin: origins.get(id), ownsKernel: true, port: "6806"}) as KernelTarget);

    const handler = handlers.get("siyuan-send-windows");
    assert.equal(typeof handler, "function");

    // 远端内核发送方被拒绝：不投递给本机任何工作区窗口
    handler({sender: {id: 1101}}, {cmd: "lockscreenByMode"});
    assert.deepEqual(deliveries, []);

    // 本地发送方仍能同步同工作区的兄弟窗口，且不投递给远端窗口
    handler({sender: {id: 2101}}, {cmd: "closetab", data: "tab-1"});
    assert.deepEqual(deliveries.map(item => [item.id, item.channel]), [[2102, "siyuan-send-windows"]]);
});
