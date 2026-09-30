const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {test} = require("node:test");
const {createSettingsWindows} = require("./settingsWindows");

const setup = (platform = "win32") => {
    let prepare;
    let close;
    let ready;
    const shown = [];
    const initialized = [];
    const target = {origin: "https://example.com", mode: "remote"};
    const owner = Object.assign(new EventEmitter(), {
        id: 1, mainFrame: {}, getURL: () => target.origin + "/stage/build/app/", isDestroyed: () => false,
        sent: [], send(...message) { this.sent.push(message); },
    });
    const policy = createSettingsWindows({
        platform,
        ipcMain: {handle: (_name, callback) => { prepare = callback; }, on: (name, callback) => {
            if (name === "siyuan-settings-close") close = callback;
            if (name === "siyuan-settings-ready") ready = callback;
        }},
        screen: {}, getTarget: id => id === 1 ? target : undefined,
        initialize: (...args) => initialized.push(args), show: win => shown.push(win), log() {},
    });
    const event = {sender: owner, senderFrame: owner.mainFrame};
    const open = (data = {}) => prepare(event, {key: "builtin", token: "first-token", command: {tab: "editor"}, ...data});
    return {policy, owner, event, open, close, ready, shown, initialized};
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
    assert.equal(allowed.overrideBrowserWindowOptions.show, false);
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
    const {policy, owner, open, ready, shown, initialized} = setup();
    const prepared = open();
    assert.equal(open({token: "second-token", command: {tab: "appearance"}}).create, false);
    policy(owner, prepared);
    const contents = Object.assign(new EventEmitter(), {mainFrame: {}, sent: [], send(...message) { this.sent.push(message); }});
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
    assert.equal(shown.length, 0);
    assert.deepEqual(contents.sent[1], ["siyuan-settings-command", {tab: "search"}]);
    win.emit("ready-to-show");
    assert.equal(shown.length, 0);
    ready({sender: contents, senderFrame: contents.mainFrame});
    assert.equal(shown[0], win);
    assert.equal(open({token: "visible-token"}).create, false);
    assert.equal(shown.length, 2);
    owner.emit("destroyed");
    assert.equal(destroyed, true);
    assert.deepEqual(owner.sent.at(-1), ["siyuan-settings-closed", "first-token"]);
    assert.equal(open({token: "fourth-token"}).create, true);
});

for (const rendererFirst of [false, true]) {
    test(`settings wait for the renderer and first paint before maximizing or showing (rendererFirst=${rendererFirst})`, () => {
        const {policy, owner, open, ready, shown} = setup();
        const prepared = open({geometry: {maximized: true}});
        policy(owner, prepared);
        let maximized = 0;
        const contents = Object.assign(new EventEmitter(), {mainFrame: {}, sent: [],
            send(...message) { this.sent.push(message); }});
        const win = Object.assign(new EventEmitter(), {webContents: contents, isDestroyed: () => false,
            setMenu() {}, maximize() { maximized++; }});
        owner.emit("did-create-window", win, {url: prepared.url});
        assert.equal(open({token: "loading-token", command: {tab: "appearance"}}).create, false);
        ready({sender: owner, senderFrame: owner.mainFrame});
        ready({sender: contents, senderFrame: {}});
        contents.emit("did-finish-load");
        assert.deepEqual(contents.sent.at(-1), ["siyuan-settings-command", {tab: "appearance"}]);
        assert.equal(maximized, 0);
        assert.equal(shown.length, 0);
        const rendererReady = () => ready({sender: contents, senderFrame: contents.mainFrame});
        const paintReady = () => win.emit("ready-to-show");
        (rendererFirst ? rendererReady : paintReady)();
        assert.equal(maximized, 0);
        assert.equal(shown.length, 0);
        (rendererFirst ? paintReady : rendererReady)();
        assert.equal(maximized, 1);
        assert.deepEqual(shown, [win]);
        rendererReady();
        assert.equal(shown.length, 1);
    });
}

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

for (const platform of ["win32", "linux", "darwin"]) {
    test(`settings DevTools shortcut works without a menu on ${platform}`, () => {
        const {policy, owner, open} = setup(platform);
        const prepared = open();
        policy(owner, prepared);
        let toggled = 0;
        let prevented = 0;
        const contents = Object.assign(new EventEmitter(), {toggleDevTools() { toggled++; }});
        const win = Object.assign(new EventEmitter(), {webContents: contents, isDestroyed: () => false, setMenu() {}});
        owner.emit("did-create-window", win, {url: prepared.url});
        const input = {type: "keyDown", key: "I", isAutoRepeat: false, control: platform !== "darwin",
            shift: platform !== "darwin", meta: platform === "darwin", alt: platform === "darwin"};
        const press = data => contents.emit("before-input-event", {preventDefault() { prevented++; }}, {...input, ...data});
        press({key: "j"});
        press({type: "keyUp"});
        press({isAutoRepeat: true});
        press(platform === "darwin" ? {control: true} : {alt: true});
        assert.equal(toggled, 0);
        assert.equal(prevented, 0);
        press({});
        press({key: "i"});
        assert.equal(toggled, 2);
        assert.equal(prevented, 2);
    });
}
