const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {test} = require("node:test");
const {createSettingsTaskBridge} = require("./settingsTasks");

const setup = () => {
    const handlers = {};
    const windows = [1, 2].map(id => {
        const contents = Object.assign(new EventEmitter(), {id, mainFrame: {}, sent: [],
            send(...args) { this.sent.push(args); }});
        let enabled = true;
        return {webContents: contents, isDestroyed: () => false, isEnabled: () => enabled,
            setEnabled(value) { enabled = value; }};
    });
    createSettingsTaskBridge({
        ipcMain: {handle(name, handler) { handlers[name] = handler; }, on(name, handler) { handlers[name] = handler; }},
        getTarget: id => id === 1 || id === 2 ? {origin: "https://example.com"} : undefined,
        getWindows: () => windows,
    });
    const event = id => ({sender: windows[id - 1].webContents, senderFrame: windows[id - 1].webContents.mainFrame});
    const ready = (id, task, saved = true) => handlers["siyuan-settings-task-ready"](event(id), {id: task, saved});
    const start = id => handlers["siyuan-settings-task-start"](event(id));
    const end = (id, task) => handlers["siyuan-settings-task-end"](event(id), task);
    return {handlers, windows, event, ready, start, end};
};

test("maintenance waits for every registered window and rejects subframe acknowledgments", async () => {
    const {handlers, windows, event, ready, start, end} = setup();
    const prepared = start(1);
    assert.equal(windows.every(win => !win.isEnabled()), true);
    const id = windows[0].webContents.sent[0][1].data;
    let completed = false;
    prepared.then(() => { completed = true; });
    ready(1, id);
    handlers["siyuan-settings-task-ready"]({...event(2), senderFrame: {}}, {id, saved: true});
    await Promise.resolve();
    assert.equal(completed, false);
    ready(2, id);
    assert.equal(await prepared, id);
    end(2, id);
    assert.equal(windows.every(win => !win.isEnabled()), true);
    end(1, id);
    assert.equal(windows.every(win => win.isEnabled()), true);
});

test("a failed save releases only its own block while concurrent maintenance continues", async () => {
    const {windows, ready, start, end} = setup();
    const first = start(1);
    const firstID = windows[0].webContents.sent[0][1].data;
    const second = start(2);
    const secondID = windows[0].webContents.sent[1][1].data;
    ready(1, firstID, false);
    await assert.rejects(first, /Could not save/);
    assert.equal(windows.every(win => !win.isEnabled()), true);
    ready(1, secondID);
    ready(2, secondID);
    await second;
    end(2, secondID);
    assert.equal(windows.every(win => win.isEnabled()), true);
});

test("partial preparation failure preserves blocks owned by another task and original disabled state", async () => {
    const {windows, ready, start, end} = setup();
    windows[1].setEnabled(false);
    const first = start(1);
    const id = windows[0].webContents.sent[0][1].data;
    ready(1, id);
    ready(2, id);
    await first;
    const send = windows[0].webContents.send;
    windows[0].webContents.send = function (...args) {
        if (args[1].cmd === "prepareSettingTask") throw new Error("Renderer unavailable");
        send.apply(this, args);
    };
    await assert.rejects(start(2), /Renderer unavailable/);
    assert.equal(windows[0].isEnabled(), false);
    assert.equal(windows[1].isEnabled(), false);
    end(1, id);
    assert.equal(windows[0].isEnabled(), true);
    assert.equal(windows[1].isEnabled(), false);
});

test("closing a maintenance owner releases windows and rejects the pending preparation", async () => {
    const {windows, start} = setup();
    const prepared = start(1);
    windows[0].webContents.emit("destroyed");
    await assert.rejects(prepared, /owner closed/);
    assert.equal(windows.every(win => win.isEnabled()), true);
});
