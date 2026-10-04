const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");

const createBoot = (plugin = false, failed = "", waitForStyles = false) => {
    const source = readFileSync("src/config/setting/window.ts", "utf8");
    const code = transpileModule(source.slice(0, source.indexOf("void startSettingsWindow(")) + "\nexport {initialize};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const pending = new Map();
    const calls = [];
    let luteLoaded = false;
    let command;
    let shown;
    const wait = name => {
        calls.push(name);
        return new Promise(resolve => pending.set(name, resolve));
    };
    let active = true;
    const events = new Map();
    const eventOptions = new Map();
    const documentEvents = new Map();
    const menu = {hidden: true, handledKey: false,
        element: {style: {zIndex: "12"}, classList: {contains: () => menu.hidden}},
        remove: isKey => { calls.push(isKey ? "close-menu-key" : "close-menu"); menu.hidden = true; },
    };
    const host = {app: {}, isActive: () => active, dispose: () => { active = false; calls.push("dispose"); },
        plugin: plugin ? {name: "Plugin", mount: create => {
        assert.equal(luteLoaded, true);
        create({items: []});
    }} : undefined};
    const window = {
        opener: {location: {origin: "http://localhost"}, dispatchEvent: event => event.detail(host)},
        addEventListener: (name, callback, options) => { events.set(name, callback); eventOptions.set(name, options); },
        close: () => calls.push("close"),
        DOMPurify: undefined,
    };
    const constants = {PROTYLE_CDN: "/stage/protyle", SIYUAN_VERSION: "test", LOCAL_ZOOM: "zoom", SIZE_ZOOM: []};
    const modules = {
        "electron": {ipcRenderer: {on: (name, callback) => {
            if (name === "siyuan-settings-command") command = callback;
            if (name === "siyuan-settings-shown") shown = callback;
        }, removeListener() {}, send: name => calls.push(name), invoke: async () => false}, webFrame: {setZoomFactor() {}}},
        "../../constants": {Constants: constants},
        "../../layout/Model": {Model: class {
            ws = {close() {}};
            connect() {}
            flushMainMessages() {}
            destroy() { calls.push("disconnect"); }
        }},
        "../../menus": {Menus: class {menu = menu;}},
        "../../menus/Menu": {bindMenuKeydown: () => { calls.push("menu-keydown"); return menu.handledKey; }},
        "../../menus/menuClick": {globalClickHideMenu: target => calls.push(target)},
        "../../util/zIndex": {isAbove: (element, reference) => Number(element.style.zIndex) > Number(reference.style.zIndex)},
        "../../dialog/tooltip": {initTooltips: () => calls.push("tooltips"), hideTooltip() {}},
        "../../util/genID": {genUUID: () => "id"},
        "../../util/fetch": {fetchSyncPost: async (url, data) => {
            if (url === "/api/system/getConf") return {code: 0, data: {conf: {appearance: {lang: "en"}}}};
            if (url === "/api/setting/getCloudUser") {
                assert.equal(data.cached, true);
                await wait("user");
                return {data: {userId: "user"}};
            }
            assert.equal(url, "/api/system/getEmojiConf");
            await wait("emoji");
            return {data: []};
        }},
        "../../util/pathName": {addBaseURL() {}, setNoteBook: () => wait("notebooks")},
        "../../protyle/util/compatibility": {getLocalStorage: callback => {
            void wait("storage").then(() => { window.siyuan.storage = {zoom: 1}; callback(); });
        }, isWindows: () => true, isMac: () => false, initNativeDialogOverride() {}, initWindowOpenOverride() {}},
        "../../protyle/util/addScript": {addScriptSync: async (_path, id) => {
            assert.equal(id, "protyleWcHtmlScript");
            await wait("html");
            if (failed !== "html") window.DOMPurify = {};
            return failed !== "html";
        }},
        "../../protyle/util/lute": {ensureLute: async () => { await wait("lute"); luteLoaded = true; }},
        "../../boot/onGetConfig": {loadDesktopHostConnection: async () => {}, initDesktopHost: async () => {}},
        "../../boot/loadLanguages": {loadLanguages: async (_lang, _version, callback) => {
            await wait("languages");
            if (failed !== "languages") callback({config: "Settings"});
        }},
        "../systemConfig": {systemConfig: config => config},
        "../index": {openSettingDialog: () => {
            assert.equal(window.siyuan.user.userId, "user");
            calls.push("render");
            const dialog = {element: {querySelectorAll: () => [], querySelector: () => ({style: {zIndex: "11"}})},
                destroy: () => calls.push("close-settings"),
            };
            window.siyuan.dialogs.push(dialog);
            return dialog;
        }},
        "./tabs": {getSettingTabDefs: () => []},
        "../search/dialog": {switchSettingTab: () => wait("assets")},
        "./windowPaint": {waitForSettingsWindowPaint: async render => render()},
        "./windowRuntime": {resolveSettingsWindowHost: () => host, createSettingsWindowRuntime: (_active, deferScripts) => {
            assert.equal(deferScripts, true);
            return {
                refreshNotebooks: () => wait("notebooks"),
                refreshSnippets: async () => { if (waitForStyles) await wait("snippet-styles"); },
                enableSnippetScripts: async () => calls.push("snippet-scripts"), applyZoom() {}, handleMessage() {},
            };
        }},
        "../../plugin/Setting": {Setting: class {addItem() {} open() { calls.push("render"); }}},
    };
    const context = {exports: {}, window, document: {body: {classList: {toggle() {}}},
        addEventListener: (name, callback) => documentEvents.set(name, callback)},
        location: {search: "?settingsWindowToken=test", origin: "http://localhost", href: "http://localhost/settings"},
        URL, URLSearchParams, history: {replaceState() {}},
        CustomEvent: class {constructor(_name, options) { this.detail = options.detail; }},
        require: name => modules[name] || new Proxy({}, {get: () => () => {}})};
    window.location = context.location;
    runInNewContext(code, context);
    return {initialize: context.exports.initialize, calls, pending, command: next => command({}, next),
        shown: () => shown({}),
        unload: () => events.get("unload")(), deactivate: () => { active = false; },
        window, menu, events, eventOptions, documentEvents};
};

test("settings wait for snippet styles and start scripts only after the native window is shown", async () => {
    const boot = createBoot(false, "", true);
    const initialized = boot.initialize();
    await new Promise(resolve => setImmediate(resolve));
    for (const complete of boot.pending.values()) complete();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(boot.calls.includes("snippet-styles"), true);
    assert.equal(boot.calls.includes("siyuan-settings-ready"), false);
    assert.equal(boot.calls.includes("snippet-scripts"), false);
    boot.pending.get("snippet-styles")();
    await initialized;
    assert.equal(boot.calls.includes("siyuan-settings-ready"), true);
    assert.equal(boot.calls.includes("snippet-scripts"), false);
    boot.shown();
    assert.equal(boot.calls.includes("snippet-scripts"), true);
});

test("a late native show notification cannot start scripts after disposal", async () => {
    const boot = await bootReady();
    boot.unload();
    boot.shown();
    assert.equal(boot.calls.includes("snippet-scripts"), false);
});

const bootReady = async () => {
    const boot = createBoot();
    const initialized = boot.initialize();
    await new Promise(resolve => setImmediate(resolve));
    for (const complete of boot.pending.values()) complete();
    await initialized;
    boot.calls.length = 0;
    return boot;
};

const keydown = (boot, options = {}) => {
    const event = {key: "Escape", isComposing: false, repeat: false, ...options,
        preventDefault: () => boot.calls.push("prevent-default")};
    boot.documentEvents.get("keydown")(event);
};

test("settings bind lightweight outside-click handling even while a font menu is pending", async () => {
    const boot = await bootReady();
    const target = {};
    boot.events.get("click")({target});
    assert.deepEqual(boot.calls, [target]);
    const options = boot.eventOptions.get("click");
    assert.equal(typeof options === "boolean" ? options : Boolean(options?.capture), false);
});

test("Escape closes the topmost menu before the settings window", async () => {
    const boot = await bootReady();
    boot.menu.hidden = false;
    keydown(boot);
    assert.deepEqual(boot.calls, ["menu-keydown", "close-menu-key", "prevent-default"]);
    boot.calls.length = 0;
    keydown(boot);
    assert.deepEqual(boot.calls, ["close-settings", "prevent-default"]);
});

test("menu keyboard navigation suppresses the default action", async () => {
    const boot = await bootReady();
    boot.menu.hidden = false;
    boot.menu.handledKey = true;
    keydown(boot, {key: "ArrowDown"});
    assert.deepEqual(boot.calls, ["menu-keydown", "prevent-default"]);
});

test("an upper confirmation dialog keeps keyboard priority over the menu", async () => {
    const boot = await bootReady();
    boot.menu.hidden = false;
    boot.menu.handledKey = true;
    boot.window.siyuan.dialogs.push({element: {querySelector: () => ({style: {zIndex: "13"}})},
        destroy: () => boot.calls.push("close-confirm")});
    keydown(boot, {key: "ArrowDown"});
    assert.deepEqual(boot.calls, []);
    keydown(boot);
    assert.deepEqual(boot.calls, ["close-confirm", "prevent-default"]);
    assert.equal(boot.menu.hidden, false);
});

for (const options of [{isComposing: true}, {repeat: true}]) {
    test(`settings do not dismiss menus or dialogs on guarded Escape ${JSON.stringify(options)}`, async () => {
        const boot = await bootReady();
        for (const hidden of [true, false]) {
            boot.menu.hidden = hidden;
            keydown(boot, options);
        }
        assert.deepEqual(boot.calls, ["menu-keydown"]);
    });
}

for (const plugin of [false, true]) {
    test(`settings start independent requests together and wait before showing (plugin=${plugin})`, async () => {
        const boot = createBoot(plugin);
        const initialized = boot.initialize();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(boot.calls, ["user", "emoji", "notebooks", "storage", "html", "languages", ...(plugin ? ["lute"] : [])]);
        for (const [name, complete] of boot.pending) if (name !== "user") complete();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(boot.calls.includes("render"), false);
        boot.pending.get("user")();
        await initialized;
        assert.ok(boot.calls.indexOf("render") < boot.calls.indexOf("siyuan-settings-ready"));
        assert.ok(boot.calls.indexOf("render") < boot.calls.indexOf("tooltips"));
        assert.ok(boot.calls.indexOf("tooltips") < boot.calls.indexOf("siyuan-settings-ready"));
    });
}

for (const dispose of ["unload", "deactivate"]) {
    test(`settings ignore dependency completions after ${dispose}`, async () => {
        const boot = createBoot();
        const initialized = boot.initialize();
        await new Promise(resolve => setImmediate(resolve));
        boot[dispose]();
        for (const complete of boot.pending.values()) complete();
        await initialized;
        assert.equal(boot.calls.includes("render"), false);
        assert.equal(boot.calls.includes("siyuan-settings-ready"), false);
        assert.equal(boot.calls.filter(call => call === "disconnect").length, 1);
        assert.equal(boot.calls.filter(call => call === "dispose").length, 1);
    });
}

test("opening directly into assets waits for its preview before showing settings", async () => {
    const boot = createBoot();
    const initialized = boot.initialize();
    await new Promise(resolve => setImmediate(resolve));
    boot.command({tab: "assets"});
    for (const complete of boot.pending.values()) complete();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(boot.calls.includes("assets"), true);
    assert.equal(boot.calls.includes("siyuan-settings-ready"), false);
    boot.pending.get("assets")();
    await initialized;
    assert.equal(boot.calls.includes("siyuan-settings-ready"), true);
});

for (const failed of ["html", "languages"]) {
    test(`settings initialization stops when ${failed} fails`, async () => {
        const boot = createBoot(false, failed);
        const initialized = boot.initialize();
        await new Promise(resolve => setImmediate(resolve));
        for (const complete of boot.pending.values()) complete();
        await assert.rejects(initialized, /Could not load settings window dependencies/);
        assert.equal(boot.calls.includes("render"), false);
        assert.equal(boot.calls.includes("siyuan-settings-ready"), false);
    });
}
