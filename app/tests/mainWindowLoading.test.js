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
        SIYUAN_INIT: "init", TIMEOUT_SNIPPET_LOAD: 5000, TIMEOUT_TRANSITION: 300};
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
    const compatibility = {isMac: () => false, isWindows: () => true, initWindowOpenOverride() {}, initNativeDialogOverride() {}};
    const electron = {ipcRenderer: {send() {}, on() {}, invoke: async (channel, data) => {
        if (channel === "init") return {};
        return data.cmd === "isFullScreen" ? state.promise : false;
    }}, webFrame: {setZoomFactor() {}}};
    const controls = load(sources.controls, {electron, "../constants": {Constants: constants}, "../util/functions": functions});
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
    let done = false;
    const result = initWindowWithLoading(() => onGetConfig(false, app).then(() => { renderDone = true; }), tabs.setTabPosition)
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
    assert.equal(renderDone, true);
    if (!options.browser) {
        const close = document.getElementById("closeWindow");
        const bounds = close.getBoundingClientRect();
        assert.ok(document.getElementById("loading").contains(document.elementFromPoint(bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2)), "main loading covers native window buttons");
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
            document.getElementById("closeWindow").click();
            assert.equal(calls.at(-1), "close");
        }
    };
    window.mainLoadingResult = result;
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    const {createServer} = require("node:http");
    app.on("window-all-closed", () => {});
    app.disableHardwareAcceleration();
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const watchdog = setTimeout(() => app.exit(1), 45000);
        const sources = {};
        const ts = require("typescript");
        for (const [key, file] of Object.entries({host: "boot/onGetConfig.ts", browserHost: "boot/onGetConfig.ts",
            loading: "boot/loading.ts", paint: "util/windowPaint.ts", controls: "boot/windowControls.ts", tabs: "layout/tabUtil.ts"})) {
            const source = require("ifdef-loader/preprocessor").parse(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"),
                {BROWSER: key === "browserHost", MOBILE: false}, false, true);
            sources[key] = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022}}).outputText;
        }
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/base.scss"), {logger: {warn() {}, debug() {}}}).css;
        const templates = Object.fromEntries(["app", "desktop"].map(name => [name,
            fs.readFileSync(path.join(__dirname, "../src/assets/template", name, "index.tpl"), "utf8")
                .replace("</head>", '<link rel="stylesheet" href="/base.css"></head>')]));
        const pending = [];
        const server = createServer((request, response) => {
            const pathname = new URL(request.url, "http://localhost").pathname;
            if (pathname === "/theme.css") { pending.push(response); return; }
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
        let code = 0;
        try {
            for (const options of [{fused: false, dark: false, browser: false, gate: "state"},
                {fused: true, dark: true, browser: false, gate: "appearance"},
                {fused: true, dark: false, browser: true, gate: "snippets"}]) {
                win = new BrowserWindow({show: false, width: 640, height: 480,
                    webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
                await win.loadURL(`http://127.0.0.1:${server.address().port}/stage/build/${options.browser ? "desktop" : "app"}/index.html`);
                await win.webContents.executeJavaScript(`(${runCase.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(options)})`);
                assert.equal(pending.length, 1);
                pending.pop().writeHead(200, {"Content-Type": "text/css"}).end(
                    ":root{--b3-font-size:14px;--b3-toolbar-left-mac:5px;--b3-body-background:#234567;--b3-theme-background:#234567;}");
                await new Promise(resolve => setTimeout(resolve, 300));
                assert.equal(await win.webContents.executeJavaScript('!!document.getElementById("loading")'), true);
                await win.webContents.executeJavaScript("window.releaseDocument()");
                await win.webContents.executeJavaScript("window.mainLoadingResult");
                assert.equal(await win.webContents.executeJavaScript('!!document.getElementById("loading")'), false);
                assert.equal(await win.webContents.executeJavaScript('document.body.hasAttribute("aria-busy")'), false);
                await win.webContents.executeJavaScript("window.assertReady()");
                win.destroy();
            }
            console.log("Verified 3 main window loading cases");
        } catch (error) { console.error(error); code = 1; }
        finally {
            if (win && !win.isDestroyed()) win.destroy();
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
