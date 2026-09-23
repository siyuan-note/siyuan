const {test} = require("node:test");
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {WindowWorkspaceRegistry, flushWindowWorkspaces} = require("./windowWorkspaces");

const id = "20260922100000-abcdefg";
const origin = "http://127.0.0.1:6806";
const createWindow = () => Object.assign(new EventEmitter(), {isDestroyed: () => false});

test("加载中的窗口也只能与一个工作区关联", () => {
    const registry = new WindowWorkspaceRegistry();
    const first = createWindow();
    const second = createWindow();
    assert.equal(registry.associate(first, origin, id), true);
    assert.equal(registry.associate(second, origin, id), false);
    assert.equal(registry.get(origin, id), first);
    assert.deepEqual(registry.list(origin), [id]);
});

test("不同内核的同名工作区互不干扰", () => {
    const registry = new WindowWorkspaceRegistry();
    const local = createWindow();
    const remote = createWindow();
    registry.associate(local, origin, id);
    registry.associate(remote, "https://notes.example.com", id);
    assert.equal(registry.get(origin, id), local);
    assert.equal(registry.get("https://notes.example.com", id), remote);
    assert.deepEqual(registry.list("http://127.0.0.1:6807"), []);
});

test("移除关联保留窗口，关闭后允许重新打开", () => {
    const registry = new WindowWorkspaceRegistry();
    const window = createWindow();
    registry.associate(window, origin, id);
    registry.associate(window, origin, "");
    assert.equal(window.isDestroyed(), false);
    assert.equal(registry.get(origin, id), undefined);
    registry.associate(window, origin, id);
    window.emit("closed");
    assert.equal(registry.get(origin, id), undefined);
    const reopened = createWindow();
    assert.equal(registry.associate(reopened, origin, id), true);
});

test("销毁窗口与非法标识不会占用工作区", () => {
    const registry = new WindowWorkspaceRegistry();
    const window = createWindow();
    for (const invalid of [undefined, null, 123, "../layout", "bad\nkey"]) {
        assert.equal(registry.associate(window, origin, invalid), false);
    }
    assert.equal(registry.associate(window, "", id), false);
    registry.associate(window, origin, id);
    window.isDestroyed = () => true;
    assert.deepEqual(registry.list(origin), []);
    assert.equal(registry.get(origin, id), undefined);
});

test("退出前等待所有窗口保存，忽略其他窗口和子帧的确认", async () => {
    const ipc = new EventEmitter();
    const messages = [];
    const windows = [1, 2].map(id => ({isDestroyed: () => false,
        webContents: {id, mainFrame: {}, send: (_channel, message) => messages.push(message)},
    }));
    const task = flushWindowWorkspaces(windows, ipc);
    let completed = false;
    void task.then(() => completed = true);
    const respond = (index, saved, frame = windows[index].webContents.mainFrame) => {
        ipc.emit("siyuan-window-workspace-saved", {sender: windows[index].webContents, senderFrame: frame},
            {id: messages[index].data, saved});
    };
    respond(0, true);
    respond(1, true, {});
    ipc.emit("siyuan-window-workspace-saved", {sender: {id: 3, mainFrame: 1}, senderFrame: 1},
        {id: messages[0].data, saved: true});
    await Promise.resolve();
    assert.equal(completed, false);
    respond(1, true);
    assert.equal(await task, true);
    assert.equal(ipc.listenerCount("siyuan-window-workspace-saved"), 0);
    assert.equal(messages[0].cmd, "flushWindowWorkspace");
});

test("保存失败或窗口无响应时取消退出并清理监听器", async () => {
    for (const timeout of [false, true]) {
        const ipc = new EventEmitter();
        let requestID;
        const contents = {id: 1, mainFrame: {}, send: (_channel, message) => requestID = message.data};
        const task = flushWindowWorkspaces([{isDestroyed: () => false, webContents: contents}], ipc, 10);
        if (!timeout) {
            ipc.emit("siyuan-window-workspace-saved", {sender: contents, senderFrame: contents.mainFrame},
                {id: requestID, saved: false});
        }
        assert.equal(await task, false);
        assert.equal(ipc.listenerCount("siyuan-window-workspace-saved"), 0);
    }
});
