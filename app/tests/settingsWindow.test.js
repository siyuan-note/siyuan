const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const loadRendererModule = (source, modules) => {
    const exports = {};
    new Function("require", "exports", source)(name => {
        if (!modules[name]) throw new Error("unexpected module: " + name);
        return modules[name];
    }, exports);
    return exports;
};

const rendererModules = (sources) => {
    let sequence = 0;
    window.siyuan = {dialogs: [], zIndex: 1, storage: {}, languages: {cancel: "Cancel", save: "Save", config: "Settings"},
        menus: {menu: {element: document.createElement("div"), remove() {}}}, ws: {app: {plugins: [], appId: "test"}}};
    const genUUID = () => "test-" + (++sequence);
    const {Dialog} = loadRendererModule(sources.dialog, {
        "../util/genID": {genUUID}, "../util/zIndex": {isAbove: () => false}, "./moveResize": {moveResize() {}},
        "../util/functions": {isMobile: () => false}, "../protyle/util/compatibility": {isNotCtrl: () => true},
        "../constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
    });
    const context = {isSettingsWindow: () => document.body.classList.contains("body--settings")};
    const fit = loadRendererModule(sources.fit, {});
    return {Dialog, genUUID, context, fit};
};

const bootChild = async (sources) => {
    const {Dialog, genUUID, context, fit} = rendererModules(sources);
    const host = await new Promise(resolve => {
        const token = new URLSearchParams(location.search).get("token");
        window.opener.dispatchEvent(new CustomEvent("siyuan-settings-host-" + token, {detail: resolve}));
    });
    if (host.plugin) {
        const {Setting} = loadRendererModule(sources.setting, {
            "../util/functions": {isMobile: () => false, getFrontend: () => "desktop-window"},
            "../dialog": {Dialog}, "../config/setting/nativeWindow": {},
            "../config/setting/windowContext": context, "../config/setting/windowDialog": fit,
            "../util/genID": {genUUID},
        });
        host.plugin.mount(options => {
            const setting = new Setting(options);
            options.items.forEach(item => setting.addItem(item));
            setting.open(host.plugin.name);
            return setting.dialog;
        });
        window.addEventListener("unload", () => host.plugin.closed());
    }
    require("electron").ipcRenderer.send("test-settings-ready");
};

const runCases = async (sources) => {
    const assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const {Dialog, genUUID, context, fit} = rendererModules(sources);
    const native = loadRendererModule(sources.native, {
        electron: {ipcRenderer}, "../../util/genID": {genUUID}, "../../protyle/util/compatibility": {setStorageVal() {}},
        "../../layout/util": {exportLayout: async options => options.cb()}, "../../dialog/processSystem": {exitSiYuan: async () => {}},
        "../../plugin/globalState": {subscribeGlobalPluginState: () => () => {}, applyPluginReload: async () => {}},
        "../../plugin/loader": {loadPlugin: async () => {}, unloadPlugin: async () => {}},
        "../../boot/globalEvent/globalShortcut": {sendGlobalShortcut() {}, sendUnregisterGlobalShortcut() {}},
    });
    const {Setting} = loadRendererModule(sources.setting, {
        "../util/functions": {isMobile: () => false, getFrontend: () => "desktop"}, "../dialog": {Dialog},
        "../config/setting/nativeWindow": native, "../config/setting/windowContext": context,
        "../config/setting/windowDialog": fit, "../util/genID": {genUUID},
    });
    const wait = () => new Promise(resolve => setTimeout(resolve, 50));
    const legacy = new Setting({});
    legacy.open("Legacy");
    assert.equal(legacy.dialog.element.ownerDocument, document);
    legacy.dialog.destroy();
    await wait();

    let confirmed = 0;
    let destroyed = 0;
    let created = 0;
    const control = document.createElement("input");
    control.value = "original";
    const setting = new Setting({openInWindow: true, confirmCallback: () => {
        assert.equal(control.value, "changed");
        confirmed++;
    }, destroyCallback: () => destroyed++});
    setting.addItem({title: "Control", createActionElement: () => { created++; return control; }});
    setting.open("Plugin");
    await ipcRenderer.invoke("test-settings-wait");
    assert.equal(created, 1);
    assert.notEqual(control.ownerDocument, document);
    assert.equal(setting.dialog.element.querySelector("input"), control);
    setting.open("Plugin");
    await wait();
    assert.equal(created, 1);
    control.value = "changed";
    setting.dialog.element.querySelectorAll(".b3-dialog__action button")[1].click();
    await wait();
    assert.equal(confirmed, 1);
    assert.equal(destroyed, 1);
    assert.equal(setting.dialog, undefined);

    setting.open("Plugin");
    await ipcRenderer.invoke("test-settings-wait");
    setting.close();
    await wait();
    assert.equal(confirmed, 1);
    assert.equal(destroyed, 2);
    await native.openNativeSettings(window.siyuan.ws.app, {tab: "appearance"});
    await ipcRenderer.invoke("test-settings-wait");
    await native.openNativeSettings(window.siyuan.ws.app, {tab: "editor"});
    assert.equal(await ipcRenderer.invoke("test-settings-window-count"), 1);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, ipcMain, screen} = require("electron");
    const {createServer} = require("node:http");
    const {createSettingsWindows} = require("../electron/settingsWindows");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        let owner;
        let code = 0;
        let ready = 0;
        let waiting;
        const children = new Set();
        const ts = require("typescript");
        const sources = {};
        for (const [key, file] of Object.entries({dialog: "dialog/index.ts", setting: "plugin/Setting.ts",
            native: "config/setting/nativeWindow.ts", fit: "config/setting/windowDialog.ts"})) {
            sources[key] = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
            }).outputText;
        }
        const server = createServer((request, response) => {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            const child = request.url.startsWith("/stage/build/app/settings.html");
            response.end(`<html><body class="${child ? "body--settings" : ""}">${child ?
                `<script>const loadRendererModule = ${loadRendererModule.toString()}; const rendererModules = ${rendererModules.toString()}; (${bootChild.toString()})(${JSON.stringify(sources)});</script>` : ""}</body></html>`);
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const origin = "http://127.0.0.1:" + server.address().port;
        const policy = createSettingsWindows({ipcMain, screen, getTarget: id => owner?.webContents.id === id ? {origin, mode: "local"} : undefined,
            initialize: win => {
                children.add(win);
                assert.equal(win.getParentWindow(), null);
                assert.equal(win.isModal(), false);
                win.on("closed", () => children.delete(win));
            }, show() {}, log() {}});
        ipcMain.on("test-settings-ready", () => {
            if (waiting) { waiting(); waiting = undefined; } else ready++;
        });
        ipcMain.handle("test-settings-wait", () => ready ? (--ready, Promise.resolve()) : new Promise(resolve => { waiting = resolve; }));
        ipcMain.handle("test-settings-window-count", () => children.size);
        try {
            owner = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
            owner.webContents.setWindowOpenHandler(details => {
                const result = policy(owner.webContents, details);
                return result ? {...result, overrideBrowserWindowOptions: {...result.overrideBrowserWindowOptions, show: false}} : {action: "deny"};
            });
            await owner.loadURL(origin + "/stage/build/app/");
            await owner.webContents.executeJavaScript(`const loadRendererModule = ${loadRendererModule.toString()}; const rendererModules = ${rendererModules.toString()}; (${runCases.toString()})(${JSON.stringify(sources)})`);
            const closed = [...children].map(child => new Promise(resolve => child.once("closed", resolve)));
            owner.destroy();
            await Promise.all(closed);
            assert.equal(children.size, 0);
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            for (const child of children) child.destroy();
            if (owner && !owner.isDestroyed()) owner.destroy();
            server.close();
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("native settings preserve plugin controls, callbacks, default dialogs and owning-window lifecycle", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-settings-window-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 30000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
