const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {dispatchWindowMessage} = require("./windowMessaging");

const createFixture = (senderId) => {
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
            getKernelTarget: (id) => windows.has(id) && windows.get(id) ? {origin: windows.get(id)} : undefined,
            getAllWindows,
        }),
    };
};

test("远端内核发送方无法向本地工作区投递窗口消息", () => {
    const f = createFixture(1101);
    assert.equal(f.dispatch({cmd: "closetab", data: "tab-1"}), true);
    assert.deepEqual(f.deliveries.map(item => item.id), [1102]);
});

test("本地发送方无法向另一个工作区投递窗口消息", () => {
    const f = createFixture(2101);
    f.dispatch({cmd: "setTabDragData", data: {title: "文档"}});
    assert.deepEqual(f.deliveries, []);
});

test("渲染进程无法伪造主进程的 lockscreenByMode 通知", () => {
    const f = createFixture(2101);
    assert.equal(f.dispatch({cmd: "lockscreenByMode"}), false);
    assert.deepEqual(f.deliveries, []);
});

test("非法命令与非法载荷一律拒绝", () => {
    const f = createFixture(1101);
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

test("合法命令仍按同工作区投递", () => {
    const f = createFixture(1101);
    assert.equal(f.dispatch({cmd: "closetab", data: "tab-1"}), true);
    assert.equal(f.dispatch({cmd: "resetTabsStyle", data: "addRegionStyle"}), true);
    assert.equal(f.dispatch({cmd: "resetTabsStyle", data: "rmDragStyle"}), true);
    assert.equal(f.dispatch({cmd: "setTabDragData", data: {title: "文档"}}), true);
    assert.deepEqual(f.deliveries.map(item => [item.id, item.channel]), [
        [1102, "siyuan-send-windows"], [1102, "siyuan-send-windows"],
        [1102, "siyuan-send-windows"], [1102, "siyuan-send-windows"],
    ]);
});

test("未登记内核目标的窗口既不能发送也不能接收", () => {
    const unregistered = createFixture(3201);
    assert.equal(unregistered.dispatch({cmd: "closetab", data: "tab-1"}), false);
    assert.deepEqual(unregistered.deliveries, []);
    // 已登记发送方只投递给同工作区窗口，未登记的 3201 不接收
    const registered = createFixture(1101);
    registered.dispatch({cmd: "closetab", data: "tab-1"});
    assert.deepEqual(registered.deliveries.map(item => item.id), [1102]);
});

test("主进程 handler 按发送方与内核目标接线到 dispatchWindowMessage", () => {
    const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
    const marker = "ipcMain.on(\"siyuan-send-windows\", (event, data) => {";
    const markerOffset = source.indexOf(marker);
    assert.notEqual(markerOffset, -1);
    const opening = source.indexOf("{", markerOffset + marker.length - 1);
    const closing = source.indexOf("\n    });\n", opening);
    assert.notEqual(closing, -1);
    // 去掉 handler 自身的外层花括号，保留 (event, data) => {...} 的函数体
    const body = source.slice(opening + 1, closing + 5).replace(/\n {4}\}$/, "\n");
    const entries = ["senderWebContentsId: event.sender.id", "getKernelTarget: getWindowKernelTarget",
        "getAllWindows: () => BrowserWindow.getAllWindows()"];
    entries.forEach(entry => assert.equal(body.includes(entry), true, entry));
    assert.equal(body.includes("BrowserWindow.getAllWindows().forEach"), false);

    const deliveries = [];
    const handlers = new Map();
    const calls = [];
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
    vm.runInNewContext(`(function (ipcMain, BrowserWindow, dispatchWindowMessage, getWindowKernelTarget) {
        ipcMain.on("siyuan-send-windows", (event, data) => {${body}});
    })`, {filename: "app/electron/main.js"})(
        {on: (channel, handler) => handlers.set(channel, handler)},
        {getAllWindows: () => windows},
        (data, options) => {
            calls.push(options);
            return dispatchWindowMessage(data, options);
        },
        (id) => ({origin: origins.get(id)}),
    );

    const handler = handlers.get("siyuan-send-windows");
    assert.equal(typeof handler, "function");

    // 远端内核发送方被拒绝：不投递给本机任何工作区窗口
    handler({sender: {id: 1101}}, {cmd: "lockscreenByMode"});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].senderWebContentsId, 1101);
    assert.equal(calls[0].getKernelTarget(1101).origin, "https://remote.example.com:6806");
    assert.deepEqual(calls[0].getAllWindows(), windows);
    assert.deepEqual(deliveries, []);

    // 本地发送方仍能同步同工作区的兄弟窗口，且不投递给远端窗口
    handler({sender: {id: 2101}}, {cmd: "closetab", data: "tab-1"});
    assert.deepEqual(deliveries.map(item => [item.id, item.channel]), [[2102, "siyuan-send-windows"]]);
});
