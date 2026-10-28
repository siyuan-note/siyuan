const test = require("node:test");
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {bindWebviewDevToolsShortcut} = require("./webviewDevTools");

const createContents = (id, type = "window") => Object.assign(new EventEmitter(), {
    id,
    destroyed: false,
    toggled: 0,
    devToolsOpened: false,
    getType() { return type; },
    isDestroyed() { return this.destroyed; },
    isDevToolsOpened() { return this.devToolsOpened; },
    openDevTools() { this.toggled++; this.devToolsOpened = true; },
    closeDevTools() { this.toggled++; this.devToolsOpened = false; },
    toggleDevTools() { this.toggled++; this.devToolsOpened = !this.devToolsOpened; },
    destroy() { this.destroyed = true; this.emit("destroyed"); },
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; },
});

const key = (platform = "linux") => ({
    type: "keyDown", key: "I", code: "KeyI", isAutoRepeat: false,
    control: platform !== "darwin", shift: platform !== "darwin",
    meta: platform === "darwin", alt: platform === "darwin",
});

const press = (contents, input = key()) => {
    let prevented = 0;
    contents.emit("before-input-event", {preventDefault() { prevented++; }}, input);
    return prevented;
};

const setup = (platform = "linux") => {
    const host = createContents(1);
    const guest = createContents(2, "webview");
    const targets = new Map([[host.id, {mode: "local"}]]);
    guest.hostWebContents = host;
    bindWebviewDevToolsShortcut(guest, id => targets.get(id), platform);
    return {host, guest, targets};
};

for (const platform of ["win32", "linux", "darwin"]) {
    test(`webview shortcut toggles only its host on ${platform}`, () => {
        const {host, guest} = setup(platform);
        assert.equal(press(guest, key(platform)), 1);
        assert.equal(host.devToolsOpened, true);
        assert.equal(guest.toggled, 0);
        assert.equal(press(guest, {...key(platform), key: "i"}), 1);
        assert.equal(host.devToolsOpened, false);
        assert.equal(host.toggled, 2);
        assert.equal(guest.toggled, 0);
        assert.equal(host.listenerCount("before-input-event"), 0);
    });

    test(`webview shortcut leaves unrelated inputs alone on ${platform}`, () => {
        const {host, guest} = setup(platform);
        const unrelated = [
            {type: "keyUp"}, {key: "F12", code: "F12"}, {key: "j", code: "KeyJ"},
            {key: undefined, code: undefined},
            ...(platform === "darwin" ? [
                {meta: false}, {alt: false}, {control: true}, {shift: true},
                {control: true, shift: true, meta: false, alt: false},
            ] : [
                {control: false}, {shift: false}, {meta: true}, {alt: true},
                {control: false, shift: false, meta: true, alt: true},
            ]),
        ];
        for (const input of unrelated) assert.equal(press(guest, {...key(platform), ...input}), 0);
        assert.equal(host.toggled, 0);
    });

    test(`holding the webview shortcut suppresses guest/menu repeats on ${platform}`, () => {
        const {host, guest} = setup(platform);
        assert.equal(press(guest, key(platform)), 1);
        for (let repeat = 0; repeat < 3; repeat++) {
            assert.equal(press(guest, {...key(platform), isAutoRepeat: true}), 1);
        }
        assert.equal(host.toggled, 1);
        assert.equal(press(guest, key(platform)), 1);
        assert.equal(host.toggled, 2);
    });
}

test("macOS Option-modified characters still match the physical I key", () => {
    const {host, guest} = setup("darwin");
    assert.equal(press(guest, {...key("darwin"), key: "ˆ"}), 1);
    assert.equal(host.toggled, 1);
});

test("plugin guests route to their own main, detached or settings window", () => {
    const hosts = [1, 2, 3].map(id => createContents(id));
    const targets = new Map(hosts.map(host => [host.id, {mode: "local"}]));
    for (const mode of ["local", "remote"]) {
        for (const host of hosts) {
            targets.set(host.id, {mode});
            for (const partition of ["plugin-test", "persist:plugin-test"]) {
                const guest = createContents(10 + host.id, "webview");
                guest.hostWebContents = host;
                guest.partition = partition;
                bindWebviewDevToolsShortcut(guest, id => targets.get(id), "linux");
                const before = hosts.map(item => item.toggled);
                assert.equal(press(guest), 1);
                hosts.forEach((item, index) => assert.equal(item.toggled, before[index] + (item === host ? 1 : 0)));
                assert.equal(guest.toggled, 0);
            }
        }
    }
});

test("host is resolved after attachment and rechecked for each input", () => {
    const {host, guest, targets} = setup();
    guest.hostWebContents = null;
    assert.equal(press(guest), 0);
    guest.hostWebContents = host;
    assert.equal(press(guest), 1);
    const detachedHost = createContents(3);
    targets.set(detachedHost.id, {mode: "local"});
    guest.hostWebContents = detachedHost;
    assert.equal(press(guest), 1);
    assert.equal(host.toggled, 1);
    assert.equal(detachedHost.toggled, 1);
    targets.delete(detachedHost.id);
    assert.equal(press(guest), 0);
    assert.equal(detachedHost.toggled, 1);
});

test("missing, unregistered, non-window and destroyed hosts are ignored", () => {
    const {host, guest, targets} = setup();
    for (const invalid of [null, createContents(3), createContents(1, "webview"), createContents(1, "remote")]) {
        guest.hostWebContents = invalid;
        assert.equal(press(guest), 0);
    }
    guest.hostWebContents = host;
    targets.delete(host.id);
    assert.equal(press(guest), 0);
    targets.set(host.id, {mode: "local"});
    host.destroy();
    assert.equal(press(guest), 0);
    assert.equal(host.toggled, 0);
});

test("guest destruction removes only the shortcut listener", () => {
    const {host, guest} = setup();
    const otherInput = () => {};
    guest.on("before-input-event", otherInput);
    assert.equal(guest.listenerCount("before-input-event"), 2);
    guest.destroy();
    assert.deepEqual(guest.listeners("before-input-event"), [otherInput]);
    assert.equal(press(guest), 0);
    assert.equal(host.toggled, 0);
});

test("destroyed contents and non-webview contents keep their existing handling", () => {
    for (const type of ["window", "remote", "browserView", "offscreen", "backgroundPage"]) {
        const contents = createContents(1, type);
        bindWebviewDevToolsShortcut(contents, () => ({mode: "local"}));
        assert.equal(contents.listenerCount("before-input-event"), 0);
    }
    const guest = createContents(2, "webview");
    guest.destroy();
    bindWebviewDevToolsShortcut(guest, () => ({mode: "local"}));
    assert.equal(guest.listenerCount("before-input-event"), 0);
});

test("native destruction races do not escape the input handler", () => {
    const {host, guest} = setup();
    Object.defineProperty(guest, "hostWebContents", {get() { throw new Error("Object has been destroyed"); }, configurable: true});
    assert.equal(press(guest), 0);
    Object.defineProperty(guest, "hostWebContents", {value: host});
    host.openDevTools = () => { throw new Error("Object has been destroyed"); };
    assert.equal(press(guest), 1);
});

test("guest DevTools APIs and other keys do not acquire host behavior", () => {
    const {host, guest} = setup();
    guest.toggleDevTools();
    guest.emit("devtools-opened");
    assert.equal(guest.devToolsOpened, true);
    assert.equal(host.toggled, 0);
    assert.equal(press(guest, {...key(), key: "F12", code: "F12"}), 0);
    assert.equal(guest.devToolsOpened, true);
});

test("main installs the generic hook while retaining the window-open policy", () => {
    const source = readFileSync(path.join(__dirname, "main.js"), "utf8");
    const start = source.indexOf("app.on(\"web-contents-created\",");
    const end = source.indexOf("\napp.on(\"before-quit\",", start);
    assert.ok(start > 0 && end > start);
    const app = new EventEmitter();
    const host = createContents(1);
    const guest = createContents(2, "webview");
    guest.hostWebContents = host;
    const opened = [];
    vm.runInNewContext(source.slice(start, end), {
        app,
        bindWebviewDevToolsShortcut: (contents, getTarget) => bindWebviewDevToolsShortcut(contents, getTarget, "linux"),
        getWindowKernelTarget: id => id === host.id ? {mode: "local"} : undefined,
        settingsWindowPolicy: () => undefined,
        shell: {openExternal: url => opened.push(url)},
    });
    app.emit("web-contents-created", {}, guest);
    assert.equal(press(guest), 1);
    assert.equal(host.toggled, 1);
    assert.equal(guest.windowOpenHandler({url: "https://example.com"}).action, "deny");
    assert.deepEqual(opened, ["https://example.com"]);
});
