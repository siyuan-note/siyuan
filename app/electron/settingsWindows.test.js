const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {test} = require("node:test");
const {createSettingsWindows} = require("./settingsWindows");

const setup = (platform = "win32") => {
    let prepare;
    let close;
    let closeSelf;
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
            if (name === "siyuan-settings-close-self") closeSelf = callback;
            if (name === "siyuan-settings-ready") ready = callback;
        }},
        screen: {}, getTarget: id => [1, 2].includes(id) ? target : undefined,
        initialize: (...args) => initialized.push(args), show: win => shown.push(win), log() {},
    });
    const event = {sender: owner, senderFrame: owner.mainFrame};
    const open = (data = {}) => prepare(event, {key: "builtin", token: "first-token", command: {tab: "editor"}, ...data});
    return {policy, owner, event, open, close, closeSelf, ready, shown, initialized, prepare, target};
};

const setupGeometry = (key = "builtin") => {
    const {policy, owner, open} = setup();
    const prepared = open({key});
    policy(owner, prepared);
    const geometry = {x: 10, y: 20, width: 1000, height: 760, maximized: false, fullscreen: false};
    let destroyed = false;
    const win = Object.assign(new EventEmitter(), {
        webContents: new EventEmitter(), isDestroyed: () => destroyed, setMenu() {},
        getNormalBounds: () => {
            assert.equal(destroyed, false);
            const {x, y, width, height} = geometry;
            return {x, y, width, height};
        },
        isMaximized: () => geometry.maximized, isFullScreen: () => geometry.fullscreen,
        destroy() { destroyed = true; this.emit("closed"); },
    });
    owner.emit("did-create-window", win, {url: prepared.url});
    const saved = () => owner.sent.filter(message => message[0] === "siyuan-settings-geometry");
    return {owner, win, geometry, saved};
};

test("settings geometry coalesces continuous changes and skips unchanged states", t => {
    const {win, geometry, saved} = setupGeometry();
    t.mock.timers.enable({apis: ["setTimeout"]});
    for (let i = 0; i < 20; i++) {
        geometry.x++;
        geometry.width++;
        win.emit("move");
        win.emit("resize");
        t.mock.timers.tick(100);
        assert.equal(saved().length, 0);
    }
    t.mock.timers.tick(200);
    assert.deepEqual(saved(), [["siyuan-settings-geometry", {version: 1, ...geometry}]]);
    win.emit("move");
    win.emit("resize");
    t.mock.timers.tick(300);
    win.emit("close");
    assert.equal(saved().length, 1);
});

test("settings geometry preserves maximize and restore changes with identical normal bounds", t => {
    const {win, geometry, saved} = setupGeometry();
    t.mock.timers.enable({apis: ["setTimeout"]});
    for (const maximized of [false, true, false]) {
        geometry.maximized = maximized;
        win.emit(maximized ? "maximize" : "unmaximize");
        win.emit("resize");
        t.mock.timers.tick(300);
    }
    assert.deepEqual(saved().map(message => message[1].maximized), [false, true, false]);
});

test("closing settings immediately flushes the latest geometry and cancels deferred saves", t => {
    const {win, geometry, saved} = setupGeometry();
    t.mock.timers.enable({apis: ["setTimeout"]});
    win.emit("move");
    t.mock.timers.tick(100);
    geometry.x = 200;
    geometry.fullscreen = true;
    win.emit("close");
    assert.deepEqual(saved(), [["siyuan-settings-geometry", {version: 1, ...geometry}]]);
    win.destroy();
    t.mock.timers.tick(1000);
    assert.equal(saved().length, 1);
});

test("destroying settings or their owner cancels pending geometry saves", t => {
    const fixtures = [setupGeometry(), setupGeometry()];
    t.mock.timers.enable({apis: ["setTimeout"]});
    fixtures.forEach(({win}) => win.emit("resize"));
    fixtures[0].win.destroy();
    fixtures[1].owner.isDestroyed = () => true;
    fixtures[1].owner.emit("destroyed");
    t.mock.timers.tick(1000);
    fixtures.forEach(({saved}) => assert.equal(saved().length, 0));
});

test("plugin settings do not save built-in settings geometry", t => {
    const {win, saved} = setupGeometry("plugin-example");
    t.mock.timers.enable({apis: ["setTimeout"]});
    win.emit("move");
    win.emit("resize");
    win.emit("maximize");
    t.mock.timers.tick(300);
    win.emit("close");
    win.destroy();
    assert.equal(saved().length, 0);
});

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
    assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.webviewTag, false);
    assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.backgroundThrottling, false);
    assert.equal(policy(owner, prepared), undefined);
    event.senderFrame = {};
    assert.equal(open({token: "second-token"}).create, false);
});

test("settings windows reuse their workspace instance and close with the owning renderer", () => {
    const {policy, owner, open, ready, shown, initialized} = setup();
    const prepared = open();
    assert.equal(open({token: "second-token", command: {tab: "appearance"}}).create, false);
    policy(owner, prepared);
    const contents = Object.assign(new EventEmitter(), {mainFrame: {}, sent: [], setBackgroundThrottling() {},
        send(...message) { this.sent.push(message); }});
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
    assert.deepEqual(owner.sent.at(-1), ["siyuan-settings-closed", "first-token", true]);
    assert.equal(open({token: "fourth-token"}).create, true);
});

for (const rendererFirst of [false, true]) {
    test(`settings wait for the renderer and first paint before maximizing or showing (rendererFirst=${rendererFirst})`, () => {
        const {policy, owner, open, ready, shown} = setup();
        const prepared = open({geometry: {maximized: true}});
        policy(owner, prepared);
        let maximized = 0;
        const throttling = [];
        const contents = Object.assign(new EventEmitter(), {mainFrame: {}, sent: [],
            send(...message) {
                if (message[0] === "siyuan-settings-shown") assert.deepEqual(shown, [win]);
                this.sent.push(message);
            }, setBackgroundThrottling: value => throttling.push(value)});
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
        assert.deepEqual(throttling, []);
        const rendererReady = () => ready({sender: contents, senderFrame: contents.mainFrame});
        const paintReady = () => win.emit("ready-to-show");
        (rendererFirst ? rendererReady : paintReady)();
        assert.equal(maximized, 0);
        assert.equal(shown.length, 0);
        (rendererFirst ? paintReady : rendererReady)();
        assert.equal(maximized, 1);
        assert.deepEqual(shown, [win]);
        assert.deepEqual(throttling, [true]);
        assert.deepEqual(contents.sent.at(-1), ["siyuan-settings-shown"]);
        rendererReady();
        assert.equal(shown.length, 1);
        assert.equal(contents.sent.filter(message => message[0] === "siyuan-settings-shown").length, 1);
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
    close(event, {key: "plugin-other", token: "canceled-token"});
    assert.equal(policy(owner, canceled), undefined);
    assert.deepEqual(owner.sent.at(-1), ["siyuan-settings-closed", "canceled-token", false]);
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

const createWindow = (owner, prepared) => {
    let destroyed = false;
    const webContents = Object.assign(new EventEmitter(), {mainFrame: {}, send() {}});
    const win = Object.assign(new EventEmitter(), {
        webContents, setMenu() {}, isDestroyed: () => destroyed,
        destroy() { destroyed = true; this.emit("closed"); },
    });
    owner.emit("did-create-window", win, {url: prepared.url});
    return win;
};

for (const invalidation of ["navigation", "render-process-gone", "destroyed"]) {
    test(`owner ${invalidation} invalidates windows, reservations and authorized late children`, () => {
        const {owner, open, policy, initialized} = setup();
        const builtin = open();
        policy(owner, builtin);
        const win = createWindow(owner, builtin);
        const pending = open({key: "plugin-pending", token: "pending-token"});
        const late = open({key: "plugin-late", token: "late-token"});
        policy(owner, late);
        if (invalidation === "navigation") owner.emit("did-start-navigation", {isSameDocument: false, isMainFrame: true});
        else owner.emit(invalidation);
        assert.equal(win.isDestroyed(), true);
        assert.equal(policy(owner, pending), undefined);
        assert.equal(createWindow(owner, late).isDestroyed(), true);
        assert.equal(initialized.length, 1);
        assert.deepEqual(owner.sent.filter(item => item[0] === "siyuan-settings-closed").map(item => item.slice(1)),
            [["first-token", true], ["pending-token", true], ["late-token", true]]);
        assert.equal(open({token: "manually-reopened"}).create, true);
    });
}

test("same-document and subframe navigations preserve the settings owner", () => {
    const {owner, open, policy} = setup();
    const prepared = open();
    policy(owner, prepared);
    const win = createWindow(owner, prepared);
    owner.emit("did-start-navigation", {isSameDocument: true, isMainFrame: true});
    owner.emit("did-start-navigation", {isSameDocument: false, isMainFrame: false});
    assert.equal(win.isDestroyed(), false);
    assert.equal(open({token: "reuse-token"}).create, false);
});

test("workspace reuse keeps the original creator as owner until it is invalidated", () => {
    const {owner, open, policy, prepare, target} = setup();
    const secondOwner = Object.assign(new EventEmitter(), {id: 2, mainFrame: {}, getURL: () => target.origin + "/stage/build/app/",
        isDestroyed: () => false, send() {}});
    const event = {sender: secondOwner, senderFrame: secondOwner.mainFrame};
    const prepared = open();
    policy(owner, prepared);
    const win = createWindow(owner, prepared);
    assert.equal(prepare(event, {key: "builtin", token: "second-owner", command: {tab: "appearance"}}).create, false);
    secondOwner.emit("did-start-navigation", {isSameDocument: false, isMainFrame: true});
    assert.equal(win.isDestroyed(), false);
    owner.emit("did-start-navigation", {isSameDocument: false, isMainFrame: true});
    assert.equal(win.isDestroyed(), true);
    const reopened = prepare(event, {key: "builtin", token: "new-owner"});
    assert.equal(reopened.create, true);
    policy(secondOwner, reopened);
    const replacement = createWindow(secondOwner, reopened);
    owner.emit("render-process-gone");
    assert.equal(replacement.isDestroyed(), false);
    secondOwner.emit("render-process-gone");
    assert.equal(replacement.isDestroyed(), true);
});

test("stale token cancellation cannot close a reopened plugin session", () => {
    const {owner, event, open, close, policy} = setup();
    const old = open({key: "plugin-example", token: "old-token"});
    policy(owner, old);
    close(event, {key: "plugin-example", token: "old-token"});
    const replacement = open({key: "plugin-example", token: "new-token"});
    close(event, {key: "plugin-example", token: "old-token"});
    assert.equal(policy(owner, replacement).action, "allow");
    const win = createWindow(owner, replacement);
    assert.equal(createWindow(owner, old).isDestroyed(), true);
    close(event, {key: "plugin-example", token: "old-token"});
    assert.equal(win.isDestroyed(), false);
    close(event, {key: "plugin-example", token: "new-token"});
    assert.equal(win.isDestroyed(), true);
});

test("only the creating owner and matching token may cancel built-in settings", () => {
    const {owner, event, open, close, policy} = setup();
    const prepared = open();
    policy(owner, prepared);
    const win = createWindow(owner, prepared);
    const other = Object.assign(new EventEmitter(), {id: 2, mainFrame: {}});
    close({sender: other, senderFrame: other.mainFrame}, {key: "builtin", token: "first-token"});
    assert.equal(win.isDestroyed(), false);
    close(event, {key: "builtin", token: "wrong-token"});
    assert.equal(win.isDestroyed(), false);
    close(event, {key: "builtin", token: "first-token"});
    assert.equal(win.isDestroyed(), true);
});

test("forced child close validates the sender and skips geometry persistence", () => {
    const {owner, event, open, closeSelf, policy} = setup();
    const prepared = open();
    policy(owner, prepared);
    const win = createWindow(owner, prepared);
    closeSelf(event);
    closeSelf({sender: win.webContents, senderFrame: {}});
    assert.equal(win.isDestroyed(), false);
    closeSelf({sender: win.webContents, senderFrame: win.webContents.mainFrame});
    assert.equal(win.isDestroyed(), true);
    assert.equal(owner.sent.some(item => item[0] === "siyuan-settings-geometry"), false);
});

for (const failure of ["did-fail-load", "render-process-gone"]) {
    test(`child ${failure} releases its owner session and singleton reservation`, () => {
        const {owner, open, policy} = setup();
        const prepared = open();
        policy(owner, prepared);
        const win = createWindow(owner, prepared);
        if (failure === "did-fail-load") {
            win.webContents.emit(failure, {}, -105, "failed", prepared.url, false);
            assert.equal(win.isDestroyed(), false);
            win.webContents.emit(failure, {}, -105, "failed", prepared.url, true);
        } else win.webContents.emit(failure);
        assert.equal(win.isDestroyed(), true);
        assert.equal(open({token: "retry-token"}).create, true);
    });
}
