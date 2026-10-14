const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");
const {createSettingsWindows} = require("../electron/settingsWindows");

const compile = file => ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;
const interfaceCode = compile("src/config/setting/interface.ts");
const nativeCode = compile("src/config/setting/nativeWindow.ts");

const setup = () => {
    const handlers = new Map();
    const messages = [];
    const targets = new Map();
    const windows = [];
    const children = [];
    const renderers = [];
    let sequence = 0;
    const policy = createSettingsWindows({
        ipcMain: {on: (name, callback) => handlers.set(name, callback), handle: (name, callback) => handlers.set(name, callback)},
        getTarget: id => targets.get(id), getWindows: () => windows,
        initialize: (win, target) => { targets.set(win.webContents.id, target); windows.push(win); },
        screen: {}, show() {}, log() {},
    });
    const renderer = (origin = "https://example.com") => {
        const id = ++sequence;
        let held = false;
        const replies = [];
        const ipcRenderer = new EventEmitter();
        const owner = Object.assign(new EventEmitter(), {id, mainFrame: {}, isDestroyed: () => false,
            getURL: () => origin + "/stage/build/app/window.html",
            send: (name, ...args) => messages.push({id, name, args})});
        targets.set(id, {origin, mode: "remote"});
        windows.push({webContents: owner, isDestroyed: () => false});
        const event = () => ({sender: owner, senderFrame: owner.mainFrame});
        Object.assign(ipcRenderer, {
            sendSync: name => {
                const request = event();
                let replied = false;
                let response;
                Object.defineProperty(request, "returnValue", {set: value => {
                    assert.equal(replied, false, "synchronous IPC must reply exactly once");
                    replied = true;
                    response = value;
                }});
                handlers.get(name)(request);
                assert.equal(replied, true);
                return response;
            },
            send: (name, ...args) => handlers.get(name)(event(), ...args),
            invoke: (name, data) => {
                const prepared = handlers.get(name)(event(), data);
                return held ? new Promise(resolve => replies.push(() => resolve(prepared))) : Promise.resolve(prepared);
            },
        });
        const events = new EventEmitter();
        const window = {siyuan: {dialogs: [], storage: {}, languages: {config: "Settings"}},
            addEventListener: (...args) => events.on(...args), removeEventListener: (...args) => events.removeListener(...args),
            open: (url, frameName) => {
                assert.equal(policy(owner, {url, frameName}).action, "allow");
                let destroyed = false;
                const contents = Object.assign(new EventEmitter(), {id: ++sequence, mainFrame: {},
                    getURL: () => url, send() {}});
                const win = Object.assign(new EventEmitter(), {webContents: contents, setMenu() {}, isDestroyed: () => destroyed,
                    destroy() { destroyed = true; this.emit("closed"); }});
                owner.emit("did-create-window", win, {url});
                children.push(win);
                return {};
            },
        };
        const load = (code, modules) => {
            const exports = {};
            runInNewContext(code, {exports, window, console, require: name => {
                assert.ok(modules[name], name);
                return modules[name];
            }});
            return exports;
        };
        const settingInterface = load(interfaceCode, {electron: {ipcRenderer}});
        const native = load(nativeCode, {
            electron: {ipcRenderer}, "../../util/genID": {genUUID: () => "token-" + (++sequence)},
            "../../protyle/util/compatibility": {}, "../../layout/util": {}, "../../dialog/processSystem": {},
            "../../plugin/globalState": {}, "../../plugin/loader": {},
            "../../boot/globalEvent/globalShortcut": {}, "../../constants": {Constants: {}}, "../../plugin": {},
            "../../util/processTitle": {getWorkspaceName: () => "Workspace"}, "../entryVisibility/dockOrder": {},
            "../../protyle/toolbar/catalogSnapshot": {}, "./taskBlocker": {}, "../bazaar/openPath": {},
            "./interface": settingInterface,
        });
        const app = {plugins: []};
        const dialog = (builtin = true) => {
            let destroyed = false;
            const item = {element: {querySelector: () => builtin ? {} : null}, isDestroyed: () => destroyed,
                destroy() { destroyed = true; window.siyuan.dialogs.splice(window.siyuan.dialogs.indexOf(this), 1); }};
            window.siyuan.dialogs.push(item);
            return item;
        };
        const result = {id, owner, ipcRenderer, window, native, settingInterface, dialog,
            openDialog: () => { settingInterface.prepareSettingDialog(); settingInterface.closeSettingDialog(); return dialog(); },
            openNative: () => { settingInterface.closeSettingDialog(); return native.openNativeSettings(app); },
            hold: () => { held = true; }, reply: () => replies.shift()(), event};
        renderers.push(result);
        return result;
    };
    const flush = () => {
        while (messages.length) {
            const {id, name, args} = messages.shift();
            renderers.find(item => item.id === id)?.ipcRenderer.emit(name, {}, ...args);
        }
    };
    return {renderer, flush, handlers, children};
};

for (const reuse of [false, true]) {
    test(`a different renderer closes workspace builtin settings before opening its dialog (reuse=${reuse})`, async () => {
        const {renderer, flush, children} = setup();
        const a = renderer();
        const b = renderer();
        await a.openNative();
        if (reuse) await b.openNative();
        const dialog = b.openDialog();
        assert.equal(children[0].isDestroyed(), true);
        flush();
        assert.equal(dialog.isDestroyed(), false);
    });
}

test("native settings close sibling builtin dialogs and preserve plugin dialogs and other workspaces", async () => {
    const {renderer, flush} = setup();
    const a = renderer();
    const b = renderer();
    const other = renderer("https://other.example.com");
    const dialog = a.openDialog();
    const plugin = a.dialog(false);
    const otherDialog = other.openDialog();
    await b.openNative();
    flush();
    assert.equal(dialog.isDestroyed(), true);
    assert.equal(plugin.isDestroyed(), false);
    assert.equal(otherDialog.isDestroyed(), false);
});

test("late switch notifications preserve the latest dialog across alternating renderers", () => {
    const {renderer, flush} = setup();
    const a = renderer();
    const b = renderer();
    const first = a.openDialog();
    const second = b.openDialog();
    const latest = a.openDialog();
    flush();
    assert.equal(first.isDestroyed(), true);
    assert.equal(second.isDestroyed(), true);
    assert.equal(latest.isDestroyed(), false);
});

test("a canceled native prepare reply cannot replace a newer dialog", async () => {
    const {renderer, flush, children} = setup();
    const a = renderer();
    a.hold();
    const opening = a.openNative();
    const latest = a.openDialog();
    a.reply();
    await opening;
    flush();
    assert.equal(children.length, 0);
    assert.equal(latest.isDestroyed(), false);
});

test("concurrent native reuse preserves the creator's pending reservation", async () => {
    const {renderer, flush, children} = setup();
    const a = renderer();
    const b = renderer();
    a.hold();
    const opening = a.openNative();
    await b.openNative();
    flush();
    a.reply();
    await opening;
    assert.equal(children.length, 1);
    assert.equal(children[0].isDestroyed(), false);
});

test("switching to dialogs leaves plugin native windows and other workspace native settings open", async () => {
    const {renderer, flush, children} = setup();
    const a = renderer();
    const b = renderer();
    const other = renderer("https://other.example.com");
    await a.native.openNativeSettings({plugins: []}, {}, undefined, "plugin-example");
    await other.openNative();
    await a.openNative();
    b.openDialog();
    flush();
    assert.deepEqual(children.map(win => win.isDestroyed()), [false, false, true]);
});

test("dialog switching rejects subframes, unregistered senders and non-app pages", async () => {
    const {renderer, handlers, children} = setup();
    const a = renderer();
    const b = renderer();
    await a.openNative();
    const subframe = {...b.event(), senderFrame: {}};
    handlers.get("siyuan-settings-open-dialog")(subframe);
    assert.equal(subframe.returnValue, false);
    b.owner.getURL = () => "https://example.com/stage/build/app/settings.html";
    assert.throws(() => b.openDialog(), /Could not coordinate/);
    b.owner.getURL = () => "https://attacker.example/stage/build/app/";
    assert.throws(() => b.openDialog(), /Could not coordinate/);
    const unknown = {sender: {id: -1, mainFrame: {}}, senderFrame: {}};
    handlers.get("siyuan-settings-open-dialog")(unknown);
    assert.equal(unknown.returnValue, false);
    assert.equal(children[0].isDestroyed(), false);
});
