const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");

const createBoot = (plugin = false, failed = "") => {
    const source = readFileSync("src/config/setting/window.ts", "utf8");
    const code = transpileModule(source.slice(0, source.indexOf("void initialize().catch")) + "\nexport {initialize};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const pending = new Map();
    const calls = [];
    let luteLoaded = false;
    let command;
    const wait = name => {
        calls.push(name);
        return new Promise(resolve => pending.set(name, resolve));
    };
    const host = {app: {}, plugin: plugin ? {name: "Plugin", mount: create => {
        assert.equal(luteLoaded, true);
        create({items: []});
    }} : undefined};
    const window = {
        opener: {location: {origin: "http://localhost"}, dispatchEvent: event => event.detail(host)},
        addEventListener() {},
        DOMPurify: undefined,
    };
    const constants = {PROTYLE_CDN: "/stage/protyle", SIYUAN_VERSION: "test", LOCAL_ZOOM: "zoom", SIZE_ZOOM: []};
    const modules = {
        "electron": {ipcRenderer: {on: (name, callback) => {
            if (name === "siyuan-settings-command") command = callback;
        }, send: name => calls.push(name), invoke: async () => false}, webFrame: {setZoomFactor() {}}},
        "../../constants": {Constants: constants},
        "../../layout/Model": {Model: class {
            ws = {close() {}};
            connect() {}
            flushMainMessages() {}
        }},
        "../../menus": {Menus: class {}},
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
            return {element: {querySelectorAll: () => []}};
        }},
        "./tabs": {getSettingTabDefs: () => []},
        "../search/dialog": {switchSettingTab: () => wait("assets")},
        "./windowPaint": {waitForSettingsWindowPaint: async render => render()},
        "../../plugin/Setting": {Setting: class {addItem() {} open() { calls.push("render"); }}},
    };
    const context = {exports: {}, window, document: {body: {classList: {toggle() {}}}, addEventListener() {}},
        location: {search: "?settingsWindowToken=test", origin: "http://localhost", href: "http://localhost/settings"},
        URL, URLSearchParams, history: {replaceState() {}},
        CustomEvent: class {constructor(_name, options) { this.detail = options.detail; }},
        require: name => modules[name] || new Proxy({}, {get: () => () => {}})};
    window.location = context.location;
    runInNewContext(code, context);
    return {initialize: context.exports.initialize, calls, pending, command: next => command({}, next)};
};

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
