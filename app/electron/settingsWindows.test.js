const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {test} = require("node:test");
const {createSettingsWindows} = require("./settingsWindows");

const setup = (platform = "win32") => {
    let prepare;
    let close;
    const shown = [];
    const initialized = [];
    const target = {origin: "https://example.com", mode: "remote"};
    const owner = Object.assign(new EventEmitter(), {
        id: 1, mainFrame: {}, getURL: () => target.origin + "/stage/build/app/", isDestroyed: () => false,
        sent: [], send(...message) { this.sent.push(message); },
    });
    const policy = createSettingsWindows({
        platform,
        ipcMain: {handle: (_name, callback) => { prepare = callback; }, on: (_name, callback) => { close = callback; }},
        screen: {}, getTarget: id => id === 1 ? target : undefined,
        initialize: (...args) => initialized.push(args), show: win => shown.push(win), log() {},
    });
    const event = {sender: owner, senderFrame: owner.mainFrame};
    const open = (data = {}) => prepare(event, {key: "builtin", token: "first-token", command: {tab: "editor"}, ...data});
    return {policy, owner, event, open, close, shown, initialized};
};

test("settings popup authorization requires the registered top-level page and exact URL and frame", () => {
    const {policy, owner, event, open} = setup();
    const prepared = open();
    assert.equal(prepared.create, true);
    assert.equal(new URL(prepared.url).pathname, "/stage/build/app/settings.html");
    assert.equal(new URL(prepared.url).searchParams.get("remote"), "1");
    assert.equal(new URL(prepared.url).searchParams.has("token"), false);
    assert.equal(new URL(prepared.url).searchParams.get("settingsWindowToken"), "first-token");
    assert.equal(policy(owner, {url: prepared.url + "x", frameName: prepared.frameName}), undefined);
    assert.equal(policy(owner, {url: prepared.url, frameName: "other-frame"}), undefined);
    const allowed = policy(owner, prepared);
    assert.equal(allowed.action, "allow");
    assert.equal(allowed.overrideBrowserWindowOptions.frame, false);
    assert.equal(allowed.overrideBrowserWindowOptions.titleBarStyle, "hidden");
    assert.equal(allowed.overrideBrowserWindowOptions.autoHideMenuBar, true);
    assert.equal(allowed.overrideBrowserWindowOptions.parent, undefined);
    assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.webSecurity, true);
    assert.equal(policy(owner, prepared), undefined);
    event.senderFrame = {};
    assert.equal(open({token: "second-token"}).create, false);
});

test("settings windows reuse their workspace instance and close with the owning renderer", () => {
    const {policy, owner, open, shown, initialized} = setup();
    const prepared = open();
    assert.equal(open({token: "second-token", command: {tab: "appearance"}}).create, false);
    policy(owner, prepared);
    const contents = Object.assign(new EventEmitter(), {sent: [], send(...message) { this.sent.push(message); }});
    let destroyed = false;
    const win = Object.assign(new EventEmitter(), {
        webContents: contents, isDestroyed: () => destroyed,
        menu: "default", setMenu(menu) { this.menu = menu; },
        destroy() { destroyed = true; this.emit("closed"); },
    });
    owner.emit("did-create-window", win, {url: prepared.url});
    assert.equal(win.menu, null);
    assert.equal(initialized.length, 1);
    contents.emit("did-finish-load");
    assert.deepEqual(contents.sent[0], ["siyuan-settings-command", {tab: "appearance"}]);
    assert.equal(open({token: "third-token", command: {tab: "search"}}).create, false);
    assert.equal(shown[0], win);
    assert.deepEqual(contents.sent[1], ["siyuan-settings-command", {tab: "search"}]);
    owner.emit("destroyed");
    assert.equal(destroyed, true);
    assert.deepEqual(owner.sent.at(-1), ["siyuan-settings-closed", "first-token"]);
    assert.equal(open({token: "fourth-token"}).create, true);
});

test("plugin windows are distinct from built-in settings and reject other origins", () => {
    const {open, owner} = setup();
    assert.equal(open().create, true);
    assert.equal(open({token: "plugin-token", key: "plugin-example"}).create, true);
    owner.getURL = () => "https://attacker.example/stage/build/app/";
    assert.equal(open({token: "other-token", key: "plugin-other"}).create, false);
});

test("simultaneous popups initialize their own windows and canceled reservations cannot open", () => {
    const {policy, owner, event, open, close, initialized} = setup();
    const builtin = open();
    const plugin = open({token: "plugin-token", key: "plugin-example"});
    policy(owner, builtin);
    policy(owner, plugin);
    const create = prepared => {
        const contents = Object.assign(new EventEmitter(), {send() {}});
        const win = Object.assign(new EventEmitter(), {webContents: contents, isDestroyed: () => false, setMenu() {}});
        owner.emit("did-create-window", win, {url: prepared.url});
        return win;
    };
    const pluginWindow = create(plugin);
    const builtinWindow = create(builtin);
    assert.deepEqual(initialized.map(args => args[0]), [pluginWindow, builtinWindow]);
    const canceled = open({token: "canceled-token", key: "plugin-other"});
    close(event, "plugin-other");
    assert.equal(policy(owner, canceled), undefined);
    assert.deepEqual(owner.sent.at(-1), ["siyuan-settings-closed", "canceled-token"]);
    assert.equal(open({token: "reopened-token", key: "plugin-other"}).create, true);
});

test("macOS settings windows retain native traffic lights with the main window title bar style", () => {
    const {policy, owner, open} = setup("darwin");
    const allowed = policy(owner, open());
    assert.equal(allowed.overrideBrowserWindowOptions.frame, true);
    assert.equal(allowed.overrideBrowserWindowOptions.titleBarStyle, "hidden");
    assert.deepEqual(allowed.overrideBrowserWindowOptions.trafficLightPosition, {x: 8, y: 8});
});
