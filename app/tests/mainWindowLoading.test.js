const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCase = async (sources, options) => {
    const assert = require("node:assert/strict");
    const load = (source, modules = {}) => {
        const exports = {};
        new Function("require", "exports", source)(name => modules[name] || {}, exports);
        return exports;
    };
    const deferred = () => {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        return {promise, resolve};
    };
    const state = deferred();
    const appearance = deferred();
    const snippets = deferred();
    const calls = [];
    const constants = {LOCAL_ZOOM: "zoom", SIZE_ZOOM: [{zoom: 1, position: {x: 8, y: 8}}],
        SIYUAN_INIT: "init", SIYUAN_CMD: "cmd", SIYUAN_SAVE_CLOSE: "save-close",
        SIYUAN_READY_TO_SHOW: "siyuan-ready-to-show", TIMEOUT_SNIPPET_LOAD: 5000, TIMEOUT_TRANSITION: 300};
    window.siyuan = {languages: {loading: "Loading...", min: "Min", max: "Max", restore: "Restore", close: "Close"},
        storage: {zoom: 1}, dialogs: [], config: {appearance: {hideToolbar: options.fused, mode: options.dark ? 1 : 0},
            editor: {spellcheckLanguages: ["en-US"]}, system: {os: "windows"}}, menus: {menu: {element: document.createElement("div")}}};
    const app = {layout: {layout: {element: document.getElementById("layouts")}}};
    window.siyuan.layout = app.layout;
    let wnd;
    let registered = false;
    let animation;
    const getAllWnds = (_layout, wnds) => { if (wnd) wnds.push(wnd); };
    const functions = {isWindow: () => false, setToolbarLeftMac() {}};
    const tabs = load(sources.tabs, {"../util/functions": functions, "./getAll": {getAllWnds}});
    const compatibility = {isMac: () => false, isWindows: () => true,
        applyPlatformClasses() { document.body.classList.add(options.native ? "body--windows" : "body--linux"); },
        initWindowOpenOverride() {}, initNativeDialogOverride() {}};
    const listeners = {};
    const electron = {ipcRenderer: {send(channel, data) {
        if (channel === constants.SIYUAN_READY_TO_SHOW) {
            assert.equal(document.getElementById("loading"), null, "native controls appear after the loading screen is removed");
        }
        if (channel === constants.SIYUAN_READY_TO_SHOW || channel === constants.SIYUAN_CMD) {
            require("electron").ipcRenderer.send(channel, data);
        }
    }, on(channel, callback) { listeners[channel] = callback; }, invoke: async (channel, data) => {
        if (channel === "init") return {};
        return data.cmd === "isFullScreen" ? state.promise : false;
    }}, webFrame: require("electron").webFrame};
    const overlay = load(sources.overlay, {electron, "../constants": {Constants: constants},
        "../util/color": load(sources.color),
        "../layout/util": {resizeTopBar() {}}});
    const controls = load(sources.controls, {electron, "../constants": {Constants: constants},
        "../util/functions": functions, "./windowControlsOverlay": overlay});
    const createLayout = () => {
        const element = document.createElement("div");
        element.className = "fn__flex-1 fn__flex";
        element.innerHTML = `<div data-type="wnd" class="fn__flex-column fn__flex fn__flex-1">
<div class="fn__flex"><ul class="fn__flex layout-tab-bar"><li class="item item--focus">Document</li></ul>
<ul class="layout-tab-bar layout-tab-bar--readonly fn__flex-1"><li class="item item--readonly"><span class="fn__flex-1"></span></li></ul></div>
<div class="layout-tab-container fn__flex-1"><div class="protyle" id="initialEditor"></div></div></div>`;
        app.layout.layout.element.appendChild(element);
        app.layout.centerLayout = app.layout.layout;
        wnd = {element, headersElement: element.querySelector(".layout-tab-bar"), children: [{}]};
    };
    const {onGetConfig} = load(options.browser ? sources.browserHost : sources.host, {
        electron, "../constants": {Constants: constants}, "../util/functions": functions,
        "../protyle/util/compatibility": compatibility, "./windowControls": controls,
        "./globalEvent/commonHotkey": {correctHotkey() {}, syncAppMenuShortcuts() {}},
        "./globalEvent/globalShortcut": {sendGlobalShortcut() {}}, "../util/ensureUILayout": {ensureUILayout() {}},
        "./globalEvent/event": {initWindowEvent() { if (!options.browser) assert.equal(registered, true); }},
        "../util/hostCapabilities": {getHostCapabilities: () => ({}), setHostConnection: () => { registered = true; }},
        "../layout/topBar": {initBar() {
            document.body.classList.toggle("body--toolbar-hide", options.fused);
            document.getElementById("toolbar").innerHTML = '<div id="drag" class="fn__flex-1"></div><div id="windowControls" class="fn__flex"></div>';
        }}, "../layout/status": {initStatus() {}}, "../onboarding": {openDesktopOnboarding() {}},
        "./openChangelog": {openChangelog() {}}, "../layout/tabUtil": tabs,
        "../layout/util": {JSONToLayout: createLayout, adjustLayout() { calls.push("adjust"); },
            exportLayout: options => options.cb()}, "../dialog/processSystem": {exitSiYuan: () => calls.push("close")},
        "../config/util/snippets": {renderSnippet: timeout => { assert.equal(timeout, 5000); return snippets.promise; }},
        "../util/fetch": {fetchPost: (_url, _data, callback) => { window.releaseEmoji = () => callback({data: []}); }},
        "../util/assets": {initAssets: keep => assert.equal(keep, true), enqueueAppearanceUpdate: apply => apply(),
            setInlineStyle: () => appearance.promise},
        "../config/tabs/appearanceRuntime": {appearanceConfigApi: {apply() {
            document.documentElement.setAttribute("data-theme-mode", options.dark ? "dark" : "light");
            const theme = document.createElement("link");
            theme.rel = "stylesheet";
            theme.href = "/theme.css";
            document.head.appendChild(theme);
        }}},
    });
    const {waitForWindowPaint} = load(sources.paint);
    const {initWindowWithLoading} = load(sources.loading, {"../util/windowPaint": {waitForWindowPaint},
        "../constants": {Constants: constants}});
    let renderDone = false;
    let renderError;
    let done = false;
    const result = new Function("initWindowWithLoading", "onGetConfig", "response", "setTabPosition", "ipcRenderer", "Constants",
        "return (async function(){" + sources.ready[options.browser ? "browser" : "app"] + "}).call(this);")
        .call(app, initWindowWithLoading, (...args) => onGetConfig(...args).then(() => { renderDone = true; }, error => {
            renderError = error;
            throw error;
        }),
            {data: {start: false}}, tabs.setTabPosition, electron.ipcRenderer, constants)
        .then(() => { done = true; });
    await new Promise(resolve => setTimeout(resolve, 40));
    window.releaseEmoji();
    const gates = {state, appearance, snippets};
    Object.entries(gates).forEach(([name, gate]) => { if (name !== options.gate) gate.resolve(false); });
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(renderDone, false, options.gate + " pending");
    assert.ok(document.getElementById("loading"), "loading is not removed after a fixed 160ms");
    gates[options.gate].resolve(false);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(renderDone, true, renderError?.stack);
    if (!options.browser && !options.native) {
        const close = document.getElementById("closeWindow");
        const bounds = close.getBoundingClientRect();
        assert.ok(document.getElementById("loading").contains(document.elementFromPoint(bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2)), "main loading covers self-drawn window buttons");
    }
    const modal = document.createElement("div");
    modal.className = "b3-dialog b3-dialog--open";
    modal.style.zIndex = "11";
    modal.innerHTML = '<div class="b3-dialog__container"><button class="b3-button">Continue</button></div>';
    document.body.appendChild(modal);
    const button = modal.querySelector("button");
    const bounds = button.getBoundingClientRect();
    assert.ok(button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)),
        "startup dialogs remain operable above loading");
    modal.remove();
    const refresh = document.getElementById("loadingRefresh");
    if (refresh) {
        refresh.style.display = "";
        const bounds = refresh.getBoundingClientRect();
        assert.ok(refresh.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)));
    }
    window.releaseDocument = () => {
        const dock = document.getElementById("dockLeft");
        dock.className = "layout__dockl";
        animation = dock.animate([{width: "42px"}, {width: "160px"}], {duration: 120, fill: "forwards"});
        document.getElementById("initialEditor").dataset.loading = "finished";
    };
    window.assertReady = () => {
        assert.equal(done, true);
        assert.equal(animation.playState, "finished", "Dock layout completes before tab positioning");
        assert.equal(wnd.element.classList.contains("layout__wnd--center"), options.fused);
        assert.equal(calls[0], "adjust");
        if (!options.browser) {
            if (options.native) {
                assert.equal(document.getElementById("closeWindow"), null);
                assert.ok(document.getElementById("windowControls").getBoundingClientRect().width > 0);
                listeners[constants.SIYUAN_SAVE_CLOSE]({}, true);
            } else {
                document.getElementById("closeWindow").click();
            }
            assert.equal(calls.at(-1), "close");
        }
    };
    window.mainLoadingResult = result;
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, ipcMain} = require("electron");
    const {getTitleBarOverlayOptions, updateTitleBarOverlay} = require("../electron/windowControlsOverlay");
    const {createServer} = require("node:http");
    const {once} = require("node:events");
    app.on("window-all-closed", () => {});
    app.disableHardwareAcceleration();
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const watchdog = setTimeout(() => app.exit(1), 45000);
        const sources = {};
        const ts = require("typescript");
        for (const [key, file] of Object.entries({host: "boot/onGetConfig.ts", browserHost: "boot/onGetConfig.ts",
            loading: "boot/loading.ts", paint: "util/windowPaint.ts", controls: "boot/windowControls.ts",
            overlay: "boot/windowControlsOverlay.ts", tabs: "layout/tabUtil.ts", color: "util/color.ts"})) {
            const source = require("ifdef-loader/preprocessor").parse(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"),
                {BROWSER: key === "browserHost", MOBILE: false}, false, true);
            sources[key] = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022}}).outputText;
        }
        sources.ready = {};
        for (const [name, browser] of [["app", false], ["browser", true]]) {
            const source = require("ifdef-loader/preprocessor").parse(fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf8"),
                {BROWSER: browser, MOBILE: false}, false, true);
            const entry = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
            assert.doesNotMatch(entry.statements.filter(statement => !ts.isClassDeclaration(statement))
                .map(statement => statement.getText(entry)).join("\n"), /ipcRenderer\.send\(Constants\.SIYUAN_READY_TO_SHOW/,
            "module evaluation must not show a window while its loading screen is present");
            sources.ready[name] = source.slice(source.indexOf("await initWindowWithLoading("), source.indexOf("                        onSetaccount();"));
        }
        const main = fs.readFileSync(path.join(__dirname, "../electron/main.js"), "utf8");
        const bindReady = new Function("ipcMain", "isOpenAsHidden", "writeLog",
            main.slice(main.indexOf("const bindMainWindowReady ="), main.indexOf("const showWindow =")) + ";return bindMainWindowReady;")(
            ipcMain, () => false, () => {});
        ipcMain.on("cmd", (event, data) => {
            if (data?.cmd === "setTitleBarOverlay") updateTitleBarOverlay(BrowserWindow.fromWebContents(event.sender), data);
        });
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/base.scss"), {logger: {warn() {}, debug() {}}}).css;
        const templates = Object.fromEntries(["app", "desktop"].map(name => [name,
            fs.readFileSync(path.join(__dirname, "../src/assets/template", name, "index.tpl"), "utf8")
                .replace("</head>", '<link rel="stylesheet" href="/base.css"></head>')]));
        const pending = [];
        const server = createServer((request, response) => {
            const pathname = new URL(request.url, "http://localhost").pathname;
            if (pathname === "/theme.css") {
                pending.push(response);
                server.emit("theme-request");
                return;
            }
            if (pathname === "/base.css") {
                response.setHeader("Content-Type", "text/css");
                response.end(css);
            } else if (pathname === "/stage/icon.svg") {
                response.setHeader("Content-Type", "image/svg+xml");
                response.end(fs.readFileSync(path.join(__dirname, "../stage/icon.svg")));
            } else if (pathname.endsWith("/index.html")) {
                response.setHeader("Content-Type", "text/html");
                response.end(templates[pathname.includes("desktop") ? "desktop" : "app"]);
            } else { response.statusCode = 404; response.end(); }
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        let win;
        let boot;
        let code = 0;
        try {
            for (const options of [{fused: false, dark: false, browser: false, gate: "state"},
                {fused: true, dark: true, browser: false, gate: "appearance"},
                {fused: true, dark: false, browser: true, gate: "snippets"}]) {
                options.native = !options.browser && process.platform === "win32";
                boot = new BrowserWindow({show: false, frame: false});
                win = new BrowserWindow({show: false, width: 640, height: 480, frame: false,
                    titleBarStyle: "hidden", titleBarOverlay: options.native ? getTitleBarOverlayOptions() : false,
                    webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true}});
                win.webContents.on("console-message", event => {
                    if (event.level === "error") console.error(event.message);
                });
                let shown = false;
                const show = win.show.bind(win);
                win.show = () => { shown = true; show(); };
                if (!options.browser) bindReady(win, boot, {});
                await win.loadURL(`http://127.0.0.1:${server.address().port}/stage/build/${options.browser ? "desktop" : "app"}/index.html`);
                // 渲染进程插入样式后，请求仍需异步到达主进程中的测试服务器。
                const themeRequested = once(server, "theme-request", {signal: AbortSignal.timeout(10000)});
                await Promise.all([
                    win.webContents.executeJavaScript(`(${runCase.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(options)})`),
                    themeRequested,
                ]);
                assert.equal(pending.length, 1);
                assert.equal(win.isVisible(), false, "main window and native captions stay hidden during initialization");
                assert.equal(shown, false);
                assert.equal(boot.isDestroyed(), false, "the frameless boot window remains until the UI is ready");
                pending.pop().writeHead(200, {"Content-Type": "text/css"}).end(
                    ":root{--b3-font-size:14px;--b3-toolbar-left-mac:5px;--b3-body-background:#234567;--b3-theme-background:#234567;}");
                await new Promise(resolve => setTimeout(resolve, 300));
                assert.equal(await win.webContents.executeJavaScript('!!document.getElementById("loading")'), true);
                assert.equal(win.isVisible(), false, "appearance completion alone must not expose the loading screen captions");
                assert.equal(shown, false);
                await win.webContents.executeJavaScript("window.releaseDocument()");
                await win.webContents.executeJavaScript("window.mainLoadingResult");
                assert.equal(await win.webContents.executeJavaScript('!!document.getElementById("loading")'), false);
                assert.equal(await win.webContents.executeJavaScript('document.body.hasAttribute("aria-busy")'), false);
                await win.webContents.executeJavaScript("window.assertReady()");
                if (!options.browser) {
                    await new Promise(resolve => setImmediate(resolve));
                    assert.equal(shown, true);
                    assert.equal(boot.isDestroyed(), true);
                }
                win.destroy();
                if (!boot.isDestroyed()) boot.destroy();
            }
            console.log("Verified 3 main window loading cases");
        } catch (error) { console.error(error); code = 1; }
        finally {
            if (win && !win.isDestroyed()) win.destroy();
            if (boot && !boot.isDestroyed()) boot.destroy();
            pending.forEach(response => response.end());
            server.close();
            clearTimeout(watchdog);
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {promisify} = require("node:util");
    const {execFile} = require("node:child_process");
    test("main windows wait for controls, appearance, documents and Dock layout while keeping startup dialogs usable", {timeout: 60000}, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-main-loading-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.ok(stdout.includes("Verified 3 main window loading cases"));
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
