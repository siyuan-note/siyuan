import {test} from "node:test";
import {EventEmitter} from "node:events";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import type {BrowserWindow, IpcMain} from "electron";
const assert = require("node:assert/strict");

const id = "20260922100000-abcdefg";
const origin = "http://127.0.0.1:6806";
// 窗口桩按 BrowserWindow 的真实签名派生，只实现被测路径读取的成员与 closed 事件。
type WindowStub = EventEmitter & Pick<BrowserWindow, "isDestroyed">;

// 被测函数要求完整的 BrowserWindow；用例只实现被读取的成员，因此在工厂内做一次显式转换。
const createWindow = (): WindowStub & BrowserWindow =>
    Object.assign(new EventEmitter(), {isDestroyed: () => false}) as unknown as WindowStub & BrowserWindow;

// ipcMain 桩只需 on/removeListener，事件由 EventEmitter 提供。
const createIpc = (): IpcMain => new EventEmitter() as unknown as IpcMain;

// 被测模块从 electron 取 ipcMain，首次加载前必须把它换成这条用例的事件总线。
const workspacesModule = (t: any) => {
    const ipc = createIpc();
    resetElectronStub();
    mockElectron(t, {ipcMain: ipc});
    return {ipc, ...require("./windowWorkspaces")};
};

// 注册表不读 ipcMain，但模块已在上面第一次用例里加载完成，后续用例沿用同一实例。
const loadRegistry = (t: any) => {
    resetElectronStub();
    mockElectron(t, {ipcMain: createIpc()});
    return require("./windowWorkspaces").WindowWorkspaceRegistry;
};

test("加载中的窗口也只能与一个工作区关联", (t) => {
    const WindowWorkspaceRegistry = loadRegistry(t);
    const registry = new WindowWorkspaceRegistry();
    const first = createWindow();
    const second = createWindow();
    assert.equal(registry.associate(first, origin, id), true);
    assert.equal(registry.associate(second, origin, id), false);
    assert.equal(registry.get(origin, id), first);
    assert.deepEqual(registry.list(origin), [id]);
});

test("不同内核的同名工作区互不干扰", (t) => {
    const WindowWorkspaceRegistry = loadRegistry(t);
    const registry = new WindowWorkspaceRegistry();
    const local = createWindow();
    const remote = createWindow();
    registry.associate(local, origin, id);
    registry.associate(remote, "https://notes.example.com", id);
    assert.equal(registry.get(origin, id), local);
    assert.equal(registry.get("https://notes.example.com", id), remote);
    assert.deepEqual(registry.list("http://127.0.0.1:6807"), []);
});

test("移除关联保留窗口，关闭后允许重新打开", (t) => {
    const WindowWorkspaceRegistry = loadRegistry(t);
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

test("销毁窗口与非法标识不会占用工作区", (t) => {
    const WindowWorkspaceRegistry = loadRegistry(t);
    const registry = new WindowWorkspaceRegistry();
    const window = createWindow();
    // 非法标识含非字符串与含换行的键，用例断言运行期校验不依赖类型系统。
    const invalidIds: unknown[] = [undefined, null, 123, "../layout", "bad\nkey"];
    for (const invalid of invalidIds) {
        assert.equal(registry.associate(window, origin, invalid as string), false);
    }
    assert.equal(registry.associate(window, "", id), false);
    registry.associate(window, origin, id);
    window.isDestroyed = () => true;
    assert.deepEqual(registry.list(origin), []);
    assert.equal(registry.get(origin, id), undefined);
});

test("退出前等待所有窗口保存，忽略其他窗口和子帧的确认", async (t) => {
    const {ipc, flushWindowWorkspaces} = workspacesModule(t);
    const messages = [];
    const windows = [1, 2].map(id => ({isDestroyed: () => false,
        webContents: {id, mainFrame: {}, send: (_channel, message) => messages.push(message)},
    }));
    const task = flushWindowWorkspaces(windows as unknown as BrowserWindow[]);
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
    assert.equal(messages[0].cmd, "siyuan-window-workspace-flush");
});

test("保存失败或窗口无响应时取消退出并清理监听器", async (t) => {
    for (const timeout of [false, true]) {
        const {ipc, flushWindowWorkspaces} = workspacesModule(t);
        let requestID;
        const contents = {id: 1, mainFrame: {}, send: (_channel, message) => requestID = message.data};
        const task = flushWindowWorkspaces([{isDestroyed: () => false, webContents: contents}] as unknown as BrowserWindow[], 10);
        if (!timeout) {
            ipc.emit("siyuan-window-workspace-saved", {sender: contents, senderFrame: contents.mainFrame},
                {id: requestID, saved: false});
        }
        assert.equal(await task, false);
        assert.equal(ipc.listenerCount("siyuan-window-workspace-saved"), 0);
    }
});
