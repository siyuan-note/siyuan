const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {transpileModule, ModuleKind, ScriptTarget} = require("typescript");
const {parse} = require("ifdef-loader/preprocessor");

const createEnvironment = ({browser = false, mobile = false, remote = true} = {}) => {
    const menus = [];
    const requests = [];
    const saved = [];
    const messages = [];
    const hidden = [];
    const capabilities = {remoteKernel: remote, documentImportExport: true, importExport: !remote, localFileSystem: !remote};
    const window = {navigator: {userAgent: "Desktop"}, location: {origin: "https://notes.example.com"}, siyuan: {
        languages: new Proxy({}, {get: (_, key) => String(key)}), notebooks: [], storage: {},
        menus: {menu: {append: menu => menus.push(menu)}},
        config: {readonly: false, repo: {}, system: {container: "std"}, appearance: {mode: 0, themeLight: "daylight", themeDark: "midnight"}, editor: {}, export: {}},
    }};
    const dependencies = {
        "util/hostCapabilities": {getHostCapabilities: () => capabilities},
        "util/functions": {isBrowser: () => browser, isMobile: () => mobile, getFrontend: () => "desktop"},
        "util/pathName": {isEncryptedBox: () => false},
        "util/assets": {getThemeMode: () => 0, setInlineStyle: async () => ""},
        "constants": {Constants: {SIYUAN_GET: "siyuan-get", HELP_PATH: {}}},
        "menus/Menu": {MenuItem: class {constructor(options) {this.element = options;}}},
        "dialog/message": {showMessage: (...args) => {messages.push(args); return "message";}, hideMessage: id => hidden.push(id)},
        "dialog/confirmDialog": {confirmDialog: (_title, _text, callback) => callback()},
        "util/fetch": {fetchPost: (...args) => requests.push(args), fetchSyncPost: async () => ({code: 0, data: []})},
        "protyle/util/compatibility": {
            saveExportFile: uri => saved.push(uri), isInMobileApp: () => mobile, getScreenWidth: () => 800,
        },
        "electron": {ipcRenderer: {invoke: async (_channel, data) => {
            assert.equal(data.cmd, "saveRemoteExport");
            saved.push(data.uri);
            return {status: "success"};
        }}},
    };
    const load = name => {
        const source = fs.readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8");
        const code = transpileModule(parse(source, {BROWSER: browser, MOBILE: mobile}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
        }).outputText;
        const exports = {};
        runInNewContext(code, {
            exports, window, navigator: window.navigator, location: window.location, console, URL, Map, FormData,
            document: {querySelectorAll: () => []},
            fetch: () => assert.fail("Unexpected kernel file-copy request"),
            require: relative => {
                const id = relative.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(name), relative)) : relative;
                return dependencies[id] || {};
            },
        });
        return exports;
    };
    dependencies["util/contractFormData"] = load("util/contractFormData");
    return {load, window, dependencies, capabilities, menus, requests, saved, messages, hidden};
};

test("remote document menus expose archive transfers, images and HTML without local-only operations", () => {
    const env = createEnvironment();
    const menu = env.load("menus/commonMenuItem").exportMd("doc");
    assert.deepEqual(Array.from(menu.submenu.filter(item => !item.ignore), item => item.id), [
        "exportSiYuanZip", "exportMarkdown", "exportImage", "exportHTML_SiYuan", "exportHTML_Markdown",
    ]);
    env.load("menus/navigation").genImportMenu("notebook", "/doc.sy");
    const items = env.menus[0].submenu.filter(item => !item.ignore);
    assert.deepEqual(Array.from(items, item => item.id), ["importSiYuanZip", "importMarkdownZip"]);
    const file = new File(["archive"], "notes.zip", {type: "application/zip"});
    items.forEach(item => {
        let change;
        item.bind({querySelector: () => ({addEventListener: (_type, callback) => {change = callback;}})});
        change({target: {files: [file]}});
    });
    assert.deepEqual(env.requests.map(request => request[0]), ["/api/import/importSY", "/api/import/importZipMd"]);
    env.requests.forEach(([, form]) => {
        assert.equal(form.get("file"), file);
        assert.equal(form.get("notebook"), "notebook");
        assert.equal(form.get("toPath"), "/doc.sy");
        assert.equal(form.has("localPath"), false);
    });
    env.window.siyuan.config.readonly = true;
    env.load("menus/navigation").genImportMenu("notebook", "/");
    assert.equal(env.menus.length, 1);
});

test("local desktop and mobile retain their document export choices", () => {
    for (const options of [{remote: false}, {remote: false, browser: true, mobile: true}]) {
        const env = createEnvironment(options);
        const items = env.load("menus/commonMenuItem").exportMd("doc").submenu.filter(item => !item.ignore);
        assert.ok(items.some(item => item.id === "exportPDF"));
        assert.ok(items.some(item => item.id === "exportTemplate"));
        assert.equal(items.some(item => item.id === "exportWord"), !options.mobile);
    }
});

test("remote saves use IPC and preserve canceled/error outcomes without kernel path copying", async () => {
    const env = createEnvironment();
    const {saveExportFile} = env.load("protyle/util/compatibility");
    for (const status of ["success", "canceled", "error"]) {
        env.dependencies.electron.ipcRenderer.invoke = async (_channel, data) => {
            assert.equal(data.cmd, "saveRemoteExport");
            assert.equal(data.uri, "/export/doc.zip");
            return {status};
        };
        const result = await saveExportFile("/export/doc.zip", "progress");
        assert.equal(result.status, status);
    }
    assert.deepEqual(env.hidden, ["progress", "progress", "progress"]);
    assert.deepEqual(env.messages.map(message => message[0]), ["exported", "exportFileSaveFailed"]);
});

test("browser and native mobile continue to save through their own download handlers", async () => {
    const browser = createEnvironment({remote: false, browser: true});
    browser.window.open = uri => browser.saved.push(uri);
    assert.equal((await browser.load("protyle/util/compatibility").saveExportFile("/export/doc.zip")).status, "success");
    assert.deepEqual(browser.saved, ["https://notes.example.com/export/doc.zip?download=true"]);
    const mobile = createEnvironment({remote: false, browser: true, mobile: true});
    mobile.window.siyuan.config.system.container = "android";
    mobile.window.JSAndroid = {saveExportFile: uri => mobile.saved.push(uri)};
    assert.equal((await mobile.load("protyle/util/compatibility").saveExportFile("/export/doc.zip")).status, "success");
    assert.deepEqual(mobile.saved, ["/export/doc.zip"]);
});

test("remote notebook and migration dialogs offer archive uploads without binding local file controls", () => {
    const env = createEnvironment();
    const contents = [];
    env.dependencies.dialog = {Dialog: class {
        constructor(options) {
            contents.push(options.content);
            this.element = {
                setAttribute() {}, addEventListener() {},
                querySelector: selector => {
                    const attribute = selector.match(/\[([^\]]+)\]/)?.[1];
                    if (!attribute || !options.content.includes(attribute)) {
                        return null;
                    }
                    return {value: "", addEventListener() {}, querySelector: () => ({})};
                },
            };
        }
        bindInput() {}
    }};
    env.load("util/mount").newNotebook();
    env.load("menus/dataMigration").openDataMigration();
    assert.equal(contents.length, 2);
    for (const content of contents) {
        assert.ok(content.includes("SiYuan .sy.zip"));
        assert.ok(content.includes("Markdown .zip"));
        assert.ok(!content.includes("Obsidian"));
        assert.ok(!content.includes("Data.zip"));
        assert.ok(!content.includes('data-type="conf"'));
        assert.ok(!content.includes('data-type="markdown-file"'));
    }
});

test("remote and browser HTML exports package server artifacts without sending a local save path", async () => {
    for (const browser of [false, true]) {
        for (const type of ["html", "htmlmd"]) {
            const env = createEnvironment({browser, remote: !browser});
            let completed;
            const complete = new Promise(resolve => {completed = resolve;});
            env.dependencies["util/fetch"].fetchPost = async (url, payload, callback) => {
                env.requests.push([url, payload]);
                if (url === "/api/block/getBlockInfo") {
                    callback({code: 0, data: {box: "notebook"}});
                } else if (url === "/api/export/exportBrowserHTML") {
                    assert.equal(payload.folder, "artifact");
                    assert.ok(payload.html.includes("Document content"));
                    callback({code: 0, data: {zip: "/export/doc.zip"}});
                    completed();
                } else {
                    assert.equal(payload.savePath, "");
                    await callback({code: 0, data: {folder: "artifact", name: "Document", content: "Document content"}});
                }
            };
            const {saveExport} = env.load("protyle/export/index");
            saveExport({type, id: "doc"});
            await complete;
            assert.deepEqual(env.requests.map(request => request[0]), ["/api/block/getBlockInfo",
                type === "html" ? "/api/export/exportHTML" : "/api/export/exportMdHTML", "/api/export/exportBrowserHTML"]);
            assert.deepEqual(env.saved, ["/export/doc.zip"]);
        }
    }
});
