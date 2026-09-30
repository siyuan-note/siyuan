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
    window.siyuan = {dialogs: [], zIndex: 1, storage: {zoom: 1}, languages: {cancel: "Cancel", save: "Save", config: "Settings",
        min: "Minimize", max: "Maximize", restore: "Restore", close: "Close"},
        menus: {menu: {element: document.createElement("div"), remove() {}}}, ws: {app: {plugins: [], appId: "test"}}};
    const genUUID = () => "test-" + (++sequence);
    const {Dialog} = loadRendererModule(sources.dialog, {
        "../util/genID": {genUUID}, "../util/zIndex": {isAbove: () => false}, "./moveResize": {moveResize() {}},
        "../util/functions": {isMobile: () => false}, "../protyle/util/compatibility": {isNotCtrl: () => true},
        "../constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
    });
    const context = {isSettingsWindow: () => document.body.classList.contains("body--settings")};
    const {ipcRenderer} = require("electron");
    const controls = loadRendererModule(sources.controls, {
        electron: {ipcRenderer}, "../constants": {Constants: {SIYUAN_CMD: "siyuan-cmd", LOCAL_ZOOM: "zoom"}},
        "../util/functions": {setToolbarLeftMac() {}},
    });
    document.body.classList.toggle("body--win32", process.platform !== "darwin");
    const fit = loadRendererModule(sources.fit, {
        "../../boot/windowControls": controls, "../../protyle/util/compatibility": {isMac: () => process.platform === "darwin"},
    });
    return {Dialog, genUUID, context, fit, controls};
};

const bootChild = async (sources) => {
    const {Dialog, genUUID, context, fit} = rendererModules(sources);
    const host = await new Promise(resolve => {
        const token = new URLSearchParams(location.search).get("settingsWindowToken");
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
    assert.equal(setting.dialog.element.querySelector(".toolbar #drag").textContent, "Plugin");
    if (process.platform !== "darwin") {
        assert.ok(setting.dialog.element.querySelector("#minWindow"));
        assert.ok(setting.dialog.element.querySelector("#maxWindow"));
        assert.ok(setting.dialog.element.querySelector("#closeWindow"));
        for (const id of ["minWindow", "maxWindow", "restoreWindow"]) {
            setting.dialog.element.querySelector("#" + id).click();
        }
        await wait();
        assert.deepEqual(await ipcRenderer.invoke("test-settings-commands"), ["minimize", "maximize", "restore"]);
    }
    await ipcRenderer.invoke("test-settings-size", 493, 376);
    await wait();
    const childDocument = control.ownerDocument;
    for (const theme of ["daylight", "midnight"]) {
        const link = childDocument.getElementById("fixtureTheme");
        await new Promise(resolve => {
            link.onload = resolve;
            link.href = "/fixture/" + theme + ".css?v=" + Date.now();
        });
        for (const fontSize of [14, 32]) {
            childDocument.documentElement.style.setProperty("--b3-font-size", fontSize + "px");
            const toolbar = setting.dialog.element.querySelector(".toolbar");
            assert.equal(childDocument.defaultView.getComputedStyle(toolbar).height, "32px");
            assert.equal(childDocument.defaultView.getComputedStyle(toolbar.querySelector("#drag")).getPropertyValue("-webkit-app-region"), "drag");
            if (process.platform !== "darwin") {
                const close = toolbar.querySelector("#closeWindow").getBoundingClientRect();
                assert.ok(close.right <= childDocument.defaultView.innerWidth);
                assert.ok(close.height >= 30);
            }
        }
    }
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
    if (process.platform === "darwin") setting.close();
    else setting.dialog.element.querySelector("#closeWindow").click();
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
        const commands = [];
        const ts = require("typescript");
        const sources = {};
        const styles = require("sass").compile(path.join(__dirname, "../src/assets/scss/base.scss"), {
            logger: {warn() {}, debug() {}},
        }).css;
        const themes = Object.fromEntries(["daylight", "midnight"].map(name => [name,
            fs.readFileSync(path.join(__dirname, "../appearance/themes", name, "theme.css"), "utf8")]));
        for (const [key, file] of Object.entries({dialog: "dialog/index.ts", setting: "plugin/Setting.ts",
            native: "config/setting/nativeWindow.ts", fit: "config/setting/windowDialog.ts", controls: "boot/windowControls.ts"})) {
            sources[key] = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
            }).outputText;
        }
        const server = createServer((request, response) => {
            const pathname = new URL(request.url, "http://localhost").pathname;
            if (pathname.startsWith("/fixture/")) {
                response.setHeader("Content-Type", "text/css; charset=utf-8");
                response.end(pathname === "/fixture/base.css" ? styles : themes[path.basename(pathname, ".css")]);
                return;
            }
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            const child = request.url.startsWith("/stage/build/app/settings.html");
            if (child && (new URL(request.url, "http://localhost").searchParams.has("token") ||
                !request.headers.cookie?.includes("settings-auth=authenticated"))) {
                response.writeHead(401);
                response.end(JSON.stringify({code: -1, msg: "Auth failed [query token]"}));
                return;
            }
            if (!child) response.setHeader("Set-Cookie", "settings-auth=authenticated; HttpOnly; SameSite=Strict; Path=/");
            response.end(`<html><head><link rel="stylesheet" href="/fixture/base.css"><link id="fixtureTheme" rel="stylesheet" href="/fixture/daylight.css"></head><body class="${child ? "body--settings" : ""}">${child ?
                `<script>const loadRendererModule = ${loadRendererModule.toString()}; const rendererModules = ${rendererModules.toString()}; (${bootChild.toString()})(${JSON.stringify(sources)});</script>` : ""}</body></html>`);
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const origin = "http://127.0.0.1:" + server.address().port;
        const policy = createSettingsWindows({ipcMain, screen, getTarget: id => owner?.webContents.id === id ? {origin, mode: "local"} : undefined,
            initialize: win => {
                children.add(win);
                assert.equal(win.getParentWindow(), null);
                assert.equal(win.isModal(), false);
                if (process.platform !== "darwin") assert.equal(win.isMenuBarVisible(), false);
                win.on("closed", () => children.delete(win));
            }, show() {}, log() {}});
        ipcMain.on("test-settings-ready", () => {
            if (waiting) { waiting(); waiting = undefined; } else ready++;
        });
        ipcMain.handle("test-settings-wait", () => ready ? (--ready, Promise.resolve()) : new Promise(resolve => { waiting = resolve; }));
        ipcMain.handle("test-settings-window-count", () => children.size);
        ipcMain.on("siyuan-cmd", (event, command) => {
            assert.ok([...children].some(child => child.webContents === event.sender));
            commands.push(command);
        });
        ipcMain.handle("test-settings-commands", () => commands);
        ipcMain.handle("test-settings-size", (_event, width, height) => {
            for (const child of children) child.setSize(width, height);
        });
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
