const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");

const code = transpileModule(readFileSync("src/config/setting/nativeWindow.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = () => {
    let sequence = 0;
    let nativeTask = false;
    const calls = [];
    const requests = [];
    const subscriptions = [];
    const events = new EventEmitter();
    const window = {
        siyuan: {storage: {}, languages: {config: "Settings"}},
        addEventListener: (...args) => events.on(...args),
        removeEventListener: (...args) => events.removeListener(...args),
        open: (...args) => { calls.push(["open", ...args]); return {}; },
    };
    const ipcRenderer = Object.assign(new EventEmitter(), {
        send: (...args) => calls.push(args),
        invoke: (channel, data) => {
            calls.push(["prepare", data.token]);
            return new Promise((resolve, reject) => requests.push({channel, data, resolve, reject}));
        },
    });
    const record = name => (...args) => { calls.push([name, ...args]); };
    const modules = {
        electron: {ipcRenderer},
        "../../util/genID": {genUUID: () => "token-" + (++sequence)},
        "../../protyle/util/compatibility": {setStorageVal: record("storage")},
        "../../layout/util": {exportLayout: record("export"), reloadUI: record("reload"), resetLayout: record("reset")},
        "../../dialog/processSystem": {exitSiYuan: record("exit")},
        "../../plugin/globalState": {
            subscribeGlobalPluginState: (_app, callback) => {
                const subscription = {callback, disposed: 0, throwOnDispose: false};
                subscriptions.push(subscription);
                callback({pending: false});
                return () => {
                    subscription.disposed++;
                    if (subscription.throwOnDispose) throw new Error("unsubscribe failed");
                };
            },
            applyPluginReload: record("applyPluginReload"),
        },
        "../../plugin/loader": {loadPlugin: record("loadPlugin"), unloadPlugin: record("unloadPlugin")},
        "../../boot/globalEvent/globalShortcut": {
            sendGlobalShortcut: record("restore"), sendUnregisterGlobalShortcut: record("suspend"),
        },
        "../../constants": {Constants: {SIYUAN_CMD: "siyuan-cmd"}},
        "../../plugin": {hasPluginSetting: () => true},
        "../../util/processTitle": {getWorkspaceName: () => "Workspace"},
        "../entryVisibility/dockOrder": {getDockEntryOrderSnapshot: () => ({left: ["outline"]})},
        "../../protyle/toolbar/catalogSnapshot": {getEditorToolbarCatalogSnapshot: () => []},
        "./taskBlocker": {hasNativeSettingTasks: () => nativeTask},
        "../bazaar/openPath": {openBazaarPath: record("openBazaarPath")},
    };
    const context = {exports: {}, window, console: {error: record("error")}, require: name => {
        assert.ok(modules[name], name);
        return modules[name];
    }};
    runInNewContext(code, context);
    const app = {plugins: []};
    const plugin = name => ({name, isOpen: () => true, mount: record("mount"), closed: record("closed")});
    const prepare = (index = requests.length - 1, create = true) => {
        const request = requests[index];
        request.resolve({create, token: request.data.token, url: "/settings?token=" + request.data.token, frameName: request.data.token});
    };
    const host = (index = requests.length - 1) => {
        let value;
        events.emit("siyuan-settings-host-" + requests[index].data.token, {detail: candidate => { value = candidate; }});
        return value;
    };
    return {native: context.exports, app, plugin, prepare, host, calls, requests, events, window, ipcRenderer, subscriptions,
        setTask: active => { nativeTask = active; }};
};

test("host cleanup removes the token before throwing plugin callbacks and disposes every subscription", async () => {
    const fixture = setup();
    const {native, app, prepare, host, requests, calls, ipcRenderer, subscriptions, plugin} = fixture;
    const settings = plugin("Plugin");
    settings.closed = () => {
        calls.push(["closed"]);
        assert.equal(host(), undefined);
        native.closeNativeSettings("plugin-example");
        throw new Error("plugin destroy failed");
    };
    const opened = native.openNativeSettings(app, {}, settings, "plugin-example");
    prepare();
    await opened;
    const owner = host();
    let notifications = 0;
    owner.subscribePlugins(() => notifications++);
    owner.subscribePlugins(() => notifications++);
    subscriptions[0].throwOnDispose = true;
    owner.suspendShortcuts();
    owner.openBazaarPath("plugins", "example", true);
    assert.deepEqual(calls.find(item => item[0] === "openBazaarPath"), ["openBazaarPath", "plugins", "example", true]);
    ipcRenderer.emit("siyuan-settings-closed", {}, requests[0].data.token, false);
    assert.equal(owner.isActive(), false);
    assert.deepEqual(subscriptions.map(item => item.disposed), [1, 1]);
    subscriptions.forEach(item => item.callback({pending: true}));
    assert.equal(notifications, 2);
    assert.equal(calls.filter(item => item[0] === "restore").length, 1);
    assert.equal(calls.filter(item => item[0] === "closed").length, 1);
    ipcRenderer.emit("siyuan-settings-closed", {}, requests[0].data.token, false);
    owner.dispose();
    assert.equal(calls.filter(item => item[0] === "closed").length, 1);
    assert.throws(() => owner.reload(), /no longer available/);
    assert.throws(() => owner.openBazaarPath("plugins", "example"), /no longer available/);
    assert.throws(() => owner.plugin.mount(() => {}), /no longer available/);
    await assert.rejects(owner.loadPlugin({}), /no longer available/);
});

test("owner unload disposes all hosts without restoring stale shortcuts even when a plugin throws", async () => {
    const {native, app, plugin, prepare, host, events, calls} = setup();
    const first = plugin("First");
    first.closed = () => { throw new Error("first failed"); };
    const openFirst = native.openNativeSettings(app, {}, first, "plugin-first");
    prepare();
    await openFirst;
    const firstHost = host();
    firstHost.suspendShortcuts();
    const openSecond = native.openNativeSettings(app, {}, plugin("Second"), "plugin-second");
    prepare();
    await openSecond;
    const secondHost = host();
    secondHost.suspendShortcuts();
    events.emit("unload");
    assert.equal(firstHost.isActive(), false);
    assert.equal(secondHost.isActive(), false);
    assert.equal(calls.filter(item => item[0] === "closed").length, 1);
    assert.equal(calls.filter(item => item[0] === "restore").length, 0);
});

test("pending close and rapid reopen cancel only the captured old token", async () => {
    const {native, app, plugin, prepare, host, calls} = setup();
    const first = native.openNativeSettings(app, {}, plugin("First"), "plugin-example");
    native.closeNativeSettings("plugin-example");
    const second = native.openNativeSettings(app, {}, plugin("Second"), "plugin-example");
    prepare(1);
    await second;
    const activeHost = host(1);
    prepare(0);
    await first;
    assert.equal(activeHost.isActive(), true);
    assert.equal(host(0), undefined);
    assert.equal(calls.filter(item => item[0] === "open").length, 1);
    assert.deepEqual(calls.filter(item => item[0] === "siyuan-settings-close").map(item => item[1].token), ["token-1", "token-1"]);
    assert.equal(calls.filter(item => item[0] === "closed").length, 1);
});

test("reusing a singleton does not close the live plugin session", async () => {
    const {native, app, plugin, prepare, host, calls} = setup();
    const settings = plugin("Plugin");
    const first = native.openNativeSettings(app, {}, settings, "plugin-example");
    prepare();
    await first;
    const activeHost = host();
    const second = native.openNativeSettings(app, {}, settings, "plugin-example");
    prepare(1, false);
    await second;
    assert.equal(activeHost.isActive(), true);
    assert.equal(calls.some(item => item[0] === "closed"), false);
    assert.equal(calls.filter(item => item[0] === "open").length, 1);
});

test("plugin close callbacks may reopen immediately after cancellation is sent", async () => {
    const {native, app, plugin, prepare, host, calls} = setup();
    let reopened;
    const settings = plugin("Plugin");
    settings.closed = () => {
        assert.equal(host(0), undefined);
        reopened = native.openNativeSettings(app, {}, plugin("Reopened"), "plugin-example");
    };
    const opened = native.openNativeSettings(app, {}, settings, "plugin-example");
    prepare();
    await opened;
    native.closeNativeSettings("plugin-example");
    const cancellation = calls.findIndex(item => item[0] === "siyuan-settings-close");
    const replacement = calls.findIndex(item => item[0] === "prepare" && item[1] === "token-2");
    assert.ok(cancellation < replacement);
    prepare(1);
    await reopened;
    assert.equal(host(1).isActive(), true);
});

for (const failure of ["blocked", "throws", "prepare"]) {
    test(`failed ${failure} popup boot disposes the plugin and cancels its reservation`, async () => {
        const {native, app, plugin, prepare, requests, host, calls, window} = setup();
        window.open = () => {
            if (failure === "throws") throw new Error("window.open failed");
            return null;
        };
        const opened = native.openNativeSettings(app, {}, plugin("Plugin"), "plugin-example");
        if (failure === "prepare") requests[0].reject(new Error("prepare failed"));
        else prepare();
        await assert.rejects(opened, /failed|Could not open/);
        assert.equal(host(), undefined);
        assert.equal(calls.filter(item => item[0] === "closed").length, 1);
        assert.equal(calls.find(item => item[0] === "siyuan-settings-close")[1].token, "token-1");
    });
}

test("owner invalidation while prepare is pending rejects the old session without opening a child", async () => {
    const {native, app, plugin, prepare, ipcRenderer, calls, requests} = setup();
    const opened = native.openNativeSettings(app, {}, plugin("Plugin"), "plugin-example");
    ipcRenderer.emit("siyuan-settings-closed", {}, requests[0].data.token, true);
    prepare();
    await opened;
    assert.equal(calls.some(item => item[0] === "open"), false);
    assert.equal(calls.some(item => item[0] === "restore"), false);
    assert.equal(calls.filter(item => item[0] === "closed").length, 1);
    await native.openNativeSettings(app);
    assert.equal(requests.length, 1);
});

test("closing one host preserves another host's shortcut suspension and native reset blocks geometry", async () => {
    const {native, app, plugin, prepare, host, calls, ipcRenderer, setTask} = setup();
    for (const key of ["plugin-first", "plugin-second"]) {
        const opened = native.openNativeSettings(app, {}, plugin(key), key);
        prepare();
        await opened;
        host().suspendShortcuts();
    }
    native.closeNativeSettings("plugin-first");
    assert.equal(calls.some(item => item[0] === "restore"), false);
    setTask(true);
    native.closeNativeSettings("plugin-second");
    ipcRenderer.emit("siyuan-settings-geometry", {}, {width: 1000});
    assert.equal(calls.some(item => item[0] === "restore"), false);
    assert.equal(calls.some(item => item[0] === "storage"), false);
    setTask(false);
    ipcRenderer.emit("siyuan-settings-geometry", {}, {width: 900});
    assert.equal(calls.filter(item => item[0] === "storage").length, 1);
});

test("a subscription created during its immediate close notification is still disposed exactly once", async () => {
    const {native, app, prepare, host, subscriptions} = setup();
    const opened = native.openNativeSettings(app);
    prepare();
    await opened;
    const owner = host();
    const remove = owner.subscribePlugins(() => owner.dispose());
    remove();
    assert.equal(owner.isActive(), false);
    assert.equal(subscriptions[0].disposed, 1);
});

test("a plugin dialog finishing asynchronously cannot focus an invalidated owner", async () => {
    const {native, app, prepare, host, ipcRenderer, requests, calls} = setup();
    let finish;
    app.plugins.push({name: "legacy", openSetting: () => new Promise(resolve => { finish = resolve; })});
    const opened = native.openNativeSettings(app);
    prepare();
    await opened;
    const dialog = host().openPluginSetting("legacy");
    ipcRenderer.emit("siyuan-settings-closed", {}, requests[0].data.token, true);
    finish();
    await dialog;
    assert.equal(calls.some(item => item[0] === "siyuan-cmd"), false);
});
