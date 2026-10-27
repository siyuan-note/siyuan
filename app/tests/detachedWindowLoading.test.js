const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runRendererCase = async (sources, expected) => {
    const assert = require("node:assert/strict");
    const load = (source, modules = {}) => {
        const exports = {};
        new Function("require", "exports", source)(name => modules[name] || {}, exports);
        return exports;
    };
    window.siyuan = {
        languages: {loading: "Loading...", pinWindow: "Pin", unpinWindow: "Unpin", min: "Minimize",
            max: "Maximize", restore: "Restore", close: "Close"},
        storage: {zoom: 1},
        config: {appearance: {mode: expected.mode === "dark" ? 1 : 0}, editor: {spellcheckLanguages: ["en-US"]}},
        menus: {menu: {element: document.createElement("div")}},
    };
    const assets = load(sources.assets);
    const appearance = load(sources.appearance, {"../util/assets": assets,
        "../config/tabs/compactMode": {isCompactModeEnabled: () => false}});
    const {waitForWindowPaint} = load(sources.paint);
    const {initWindowWithLoading} = load(sources.loading, {"../util/windowPaint": {waitForWindowPaint},
        "../constants": {Constants: {TIMEOUT_TRANSITION: 300}}});
    const deferred = () => {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        return {promise, resolve};
    };
    const windowState = deferred();
    const snippets = deferred();
    const workspace = deferred();
    const calls = [];
    const constants = {LOCAL_ZOOM: "zoom", SIZE_ZOOM: [{zoom: 1, position: {x: 0, y: 0}}],
        SIYUAN_CMD: "cmd", SIYUAN_GET: "get", TIMEOUT_SNIPPET_LOAD: 5000};
    const electron = {ipcRenderer: {send: (_channel, command) => calls.push(command), on() {},
        invoke: async (_channel, data) => data.cmd === "isFullScreen" ? windowState.promise : false},
        webFrame: {setZoomFactor() {}}};
    const functions = {isWindow: () => true, setToolbarLeftMac() {}};
    const compatibility = {isMac: () => false, applyPlatformClasses() {}};
    const overlay = load(sources.overlay, {electron, "../constants": {Constants: constants},
        "../util/color": load(sources.color)});
    const controls = load(sources.controls, {electron, "../constants": {Constants: constants}, "../util/functions": functions,
        "./windowControlsOverlay": overlay});
    const {initWindow} = load(sources.host, {
        electron, "../constants": {Constants: constants}, "../util/functions": functions,
        "../protyle/util/compatibility": compatibility, "./windowControls": controls,
        "./globalEvent/commonHotkey": {syncAppMenuShortcuts() {}},
        "../window/closeWin": {closeWindow: () => calls.push("close")},
        "../window/workspace": {initWindowWorkspace: async () => {
            await workspace.promise;
            const button = document.createElement("button");
            button.id = "windowWorkspace";
            button.textContent = "Workspace";
            document.querySelector(".toolbar__window").prepend(button);
        }},
    });
    let wnd;
    const getAllWnds = (_layout, wnds) => { if (wnd) wnds.push(wnd); };
    const tabUtil = load(sources.tabs, {"../util/functions": functions, "./getAll": {getAllWnds}});
    const app = {layout: {layout: {element: document.getElementById("layouts"), addWnd() {}}}};
    window.siyuan.layout = app.layout;
    const {init} = load(sources.init, {
        electron, "../constants": {Constants: constants},
        "../boot/onGetConfig": {initDesktopHost: async () => {}, initWindow},
        "../boot/globalEvent/event": {initWindowEvent() {}},
        "../layout/status": {initStatus() {}},
        "../layout/tabUtil": tabUtil,
        "../layout/getAll": {getAllWnds},
        "../layout/util": {JSONToCenter() {
            const element = document.createElement("div");
            element.className = "fn__flex-1 fn__flex";
            element.innerHTML = `<div data-type="wnd" class="fn__flex-column fn__flex fn__flex-1">
<div class="fn__flex"><ul class="fn__flex layout-tab-bar"><li class="item item--focus">Document</li></ul>
<ul class="layout-tab-bar layout-tab-bar--readonly fn__flex-1"><li class="item item--readonly"><span class="fn__flex-1"></span></li></ul></div>
<div class="layout-tab-container fn__flex-1"><div class="protyle" id="initialEditor"></div>
<div class="protyle fn__none" id="backgroundEditor"></div></div></div>`;
            app.layout.layout.element.appendChild(element);
            wnd = {element, headersElement: element.querySelector(".layout-tab-bar"), children: [{}]};
        }, adjustLayout() {}},
        "../util/functions": {getSearch: () => "[]"},
        "../protyle/util/compatibility": {initWindowOpenOverride() {}, initNativeDialogOverride() {}, applyPlatformClasses() {}},
        "../util/assets": {initAssets: keepLoading => assert.equal(keepLoading, true),
            enqueueAppearanceUpdate: apply => apply(), setInlineStyle: async () => {}},
        "../config/tabs/appearanceRuntime": {appearanceConfigApi: {apply: () => {
            const theme = document.createElement("link");
            theme.rel = "stylesheet";
            theme.href = "/pending-theme.css";
            document.head.appendChild(theme);
        }}},
        "../config/util/snippets": {renderSnippet: timeout => {
            assert.equal(timeout, 5000);
            return snippets.promise;
        }},
        "../util/fetch": {fetchPost: (_url, _data, callback) => {
            window.releaseLayout = () => callback({data: []});
        }},
        "../plugin/loader": {afterLayoutReady() {}},
        "./workspace": {getWindowWorkspaceLayout() {}, activateWindowWorkspace() {}},
    });
    const loader = document.getElementById("loading");
    assert.equal(getComputedStyle(loader).backgroundColor, expected.background);
    assert.equal(document.documentElement.getAttribute("data-theme-mode"), expected.mode);
    assert.equal(getComputedStyle(loader).getPropertyValue("-webkit-app-region"), "drag");
    const rect = loader.getBoundingClientRect();
    assert.deepEqual([rect.x, rect.y, rect.width, rect.height], [0, 0, innerWidth, innerHeight]);
    const spinner = loader.querySelector(".b3-loading");
    assert.equal(spinner.childElementCount, 0, "shared spinner needs no icon library or image");
    assert.equal(getComputedStyle(spinner).color, "rgb(171, 205, 239)", "startup foreground is available before the theme");
    assert.match(getComputedStyle(spinner, "::before").backgroundImage, /conic-gradient/);
    const spinnerRect = spinner.getBoundingClientRect();
    assert.equal(spinnerRect.width, 48);
    assert.equal(spinnerRect.height, 48);
    assert.ok(Math.abs(spinnerRect.x + spinnerRect.width / 2 - innerWidth / 2) < 1);
    assert.ok(Math.abs(spinnerRect.y + spinnerRect.height / 2 - innerHeight / 2) < 1);
    assert.equal(appearance.getWindowAppearance().backgroundColor, expected.hex);
    let done = false;
    let renderDone = false;
    const initialized = initWindowWithLoading(() => init(app).then(() => { renderDone = true; }, error => {
        window.initError = error.stack;
        throw error;
    }), tabUtil.setTabPosition)
        .then(() => { done = true; });
    assert.equal(loader.getAttribute("aria-label"), "Loading...");
    window.releaseInitialization = async () => {
        window.releaseLayout();
        const gates = {workspace, state: windowState, snippets};
        Object.entries(gates).forEach(([name, gate]) => {
            if (name !== expected.gate) gate.resolve(false);
        });
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(renderDone, false, expected.gate + " still pending");
        gates[expected.gate].resolve(false);
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(renderDone, true, window.initError);
        assert.ok(document.getElementById("closeWindow"));
        assert.ok(document.getElementById("windowWorkspace"));
        assert.equal(done, false, "theme stylesheet still pending");
        const close = document.getElementById("closeWindow");
        const bounds = close.getBoundingClientRect();
        assert.ok(loader.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)),
            "loading layer covers early window controls");
    };
    window.assertReadyControls = () => {
        const close = document.getElementById("closeWindow");
        const bounds = close.getBoundingClientRect();
        assert.ok(close.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)));
        close.click();
        assert.equal(calls.at(-1), "close");
        assert.ok(wnd.element.classList.contains("layout__wnd--center"), "tab position finalized before reveal");
        assert.equal(getComputedStyle(wnd.headersElement).backgroundColor, "rgba(0, 0, 0, 0)");
        assert.ok(document.getElementById("backgroundEditor"), "unloaded background editor does not hold loading");
    };
    window.releaseDocument = () => {
        const editor = document.getElementById("initialEditor");
        if (expected.document === "removed") editor.remove();
        else if (expected.document === "hidden") editor.classList.add("fn__none");
        else if (expected.document !== "timeout") {
            editor.textContent = "Document toolbar and content";
            editor.dataset.loading = "finished";
        }
    };
    window.loadingResult = initialized;
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(done, false);
    assert.ok(loader.isConnected);
    return true;
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
        for (const [key, file] of Object.entries({assets: "util/assets.ts", appearance: "window/appearance.ts",
            paint: "util/windowPaint.ts", loading: "boot/loading.ts", init: "window/init.ts",
            host: "boot/onGetConfig.ts", controls: "boot/windowControls.ts", overlay: "boot/windowControlsOverlay.ts",
            tabs: "layout/tabUtil.ts", color: "util/color.ts"})) {
            const source = require("ifdef-loader/preprocessor").parse(
                fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {MOBILE: false, BROWSER: false}, false, true);
            sources[key] = ts.transpileModule(source, {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
            }).outputText;
        }
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/base.scss"), {
            logger: {warn() {}, debug() {}},
        }).css;
        const template = fs.readFileSync(path.join(__dirname, "../src/assets/template/app/window.tpl"), "utf8")
            .replace("</head>", '<link rel="stylesheet" href="/base.css"></head>');
        const pending = [];
        const server = createServer((request, response) => {
            const pathname = new URL(request.url, "http://localhost").pathname;
            if (pathname === "/pending-theme.css") {
                pending.push(response);
                return;
            }
            if (pathname === "/base.css") {
                response.setHeader("Content-Type", "text/css");
                response.end(css);
                return;
            }
            if (pathname === "/stage/build/app/window.html") {
                response.setHeader("Content-Type", "text/html");
                response.end(template);
                return;
            }
            response.statusCode = 404;
            response.end();
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        let win;
        let code = 0;
        try {
            for (const expected of [
                {mode: "light", hex: "#ffffff", background: "rgb(255, 255, 255)", gate: "workspace", document: "finished"},
                {mode: "dark", hex: "#1e1e1e", background: "rgb(30, 30, 30)", gate: "state", document: "hidden"},
                {mode: "dark", hex: "#234567", background: "rgb(35, 69, 103)", gate: "snippets", document: "removed"},
                {mode: "dark", hex: "#1e1e1e", background: "rgb(30, 30, 30)", gate: "state", document: "timeout"},
            ]) {
                win = new BrowserWindow({show: false, backgroundColor: expected.hex, width: 640, height: 480,
                    webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
                win.webContents.debugger.attach("1.3");
                assert.equal(win.getBackgroundColor(), expected.hex.toUpperCase());
                const url = new URL(`http://127.0.0.1:${server.address().port}/stage/build/app/window.html`);
                url.searchParams.set("windowThemeMode", expected.mode);
                url.searchParams.set("windowBackground", expected.hex);
                url.searchParams.set("windowForeground", "#abcdef");
                await win.loadURL(url.href);
                await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
                    features: [{name: "prefers-reduced-motion", value: "no-preference"}],
                });
                await win.webContents.executeJavaScript(`(${runRendererCase.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(expected)})`);
                const first = await win.webContents.capturePage();
                const bitmap = first.toBitmap();
                assert.deepEqual([...bitmap.subarray(0, 3)], [parseInt(expected.hex.slice(5, 7), 16),
                    parseInt(expected.hex.slice(3, 5), 16), parseInt(expected.hex.slice(1, 3), 16)], "painted background");
                await new Promise(resolve => setTimeout(resolve, 180));
                const second = await win.webContents.capturePage();
                assert.equal(first.toPNG().equals(second.toPNG()), false, "spinner animates");
                await win.webContents.executeJavaScript("window.releaseInitialization()");
                assert.equal(await win.webContents.executeJavaScript('!!document.getElementById("loading")'), true,
                    "loader stays while theme stylesheet is pending");
                assert.equal(pending.length, 1);
                pending.pop().writeHead(200, {"Content-Type": "text/css"}).end(
                    ":root{--b3-theme-background:#567890;--b3-body-background:#567890;}");
                await new Promise(resolve => setTimeout(resolve, 300));
                assert.equal(await win.webContents.executeJavaScript('!!document.getElementById("loading")'), true,
                    "visible document is still loading after styles are ready");
                await win.webContents.executeJavaScript("window.releaseDocument()");
                await win.webContents.executeJavaScript("window.loadingResult");
                assert.equal(await win.webContents.executeJavaScript('document.getElementById("loading")'), null);
                assert.equal(await win.webContents.executeJavaScript('document.getElementById("windowAppearanceStyle")'), null);
                assert.equal(await win.webContents.executeJavaScript('document.body.hasAttribute("aria-busy")'), false);
                assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.body).backgroundColor"), "rgb(86, 120, 144)");
                await win.webContents.executeJavaScript("window.assertReadyControls()");
                win.destroy();
            }
            console.log("Verified 4 detached window loading cases");
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            if (win && !win.isDestroyed()) win.destroy();
            pending.forEach(response => response.end());
            server.close();
            clearTimeout(watchdog);
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("detached windows show themed backgrounds and animated loading until content and theme are painted", {timeout: 60000}, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-detached-loading-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile],
                {env, windowsHide: true, timeout: 55000});
            assert.ok(stdout.includes("Verified 4 detached window loading cases"));
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
