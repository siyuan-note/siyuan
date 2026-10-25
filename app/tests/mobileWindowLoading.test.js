const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCase = (sources, options) => {
    const check = require("node:assert/strict");
    const load = (source, modules = {}) => {
        const exports = {};
        new Function("require", "exports", source)(name => modules[name] || {}, exports);
        return exports;
    };
    window.siyuan = {isReady: false, languages: {loading: "Loading"}, config: {readonly: false, appearance: {}},
        mobile: {docks: {}}};
    document.body.classList.add("body--" + options.platform);
    const {waitForWindowPaint} = load(sources.paint);
    const startup = load(sources.startup, {"../../util/windowPaint": {waitForWindowPaint}});
    const view = load(sources.view, {
        "./startup": startup, "../../util/processTitle": {setTitle() {}},
        "./mobileBars": {clearMobileBarsScroll() {}}, "./mobileTopBar": {updateMobileTopBarLayout() {}},
        "../../protyle/render/av/cellEditor": {closeAVCellEditor() {}},
        "./bottomBacklink": {closeMobileBottomBacklinkPanel() {}},
    });
    let renderComplete;
    const render = new Promise(resolve => { renderComplete = resolve; });
    const dependencies = {
        initMobileWithLoading: startup.initMobileWithLoading,
        appearanceConfigApi: {apply() {
            const theme = document.createElement("link");
            theme.rel = "stylesheet";
            theme.href = "/theme.css";
            document.head.appendChild(theme);
        }},
        initAssets() {}, initFramework: () => render, initRightMenu() {}, openChangelog() {}, confResponse: {data: {start: true}},
    };
    window.mobileLoadingResult = new Function(...Object.keys(dependencies),
        "return (async function(){" + sources.entry + "}).call(this);")(...Object.values(dependencies));
    window.releaseFramework = () => {
        view.setEditor(false);
        check.ok(document.getElementById("loading"), "showing a pending editor must not dismiss startup");
        renderComplete();
    };
    window.releaseInitialView = () => {
        if (options.empty) {
            view.setEmpty({});
        } else {
            document.getElementById("editor").textContent = "First document";
            view.setEditor();
        }
        check.ok(document.getElementById("loading"), "the initial view still waits for theme loading and paint");
        check.equal(window.siyuan.isReady, false, "native startup remains visible until painting finishes");
    };
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    const {createServer} = require("node:http");
    const {once} = require("node:events");
    app.disableHardwareAcceleration();
    app.setPath("userData", process.argv[2]);
    app.on("window-all-closed", () => {});
    app.whenReady().then(async () => {
        const ts = require("typescript");
        const sources = {};
        for (const [key, file] of Object.entries({paint: "util/windowPaint.ts", startup: "mobile/util/startup.ts",
            view: "mobile/util/setEmpty.ts"})) {
            sources[key] = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
            }).outputText;
        }
        const entry = fs.readFileSync(path.join(__dirname, "../src/mobile/index.ts"), "utf8");
        sources.entry = entry.slice(entry.indexOf("await initMobileWithLoading("), entry.indexOf("                            finishMobileSystemUris(this);"));
        const template = fs.readFileSync(path.join(__dirname, "../src/assets/template/mobile/index.tpl"), "utf8");
        const pending = [];
        const server = createServer((request, response) => {
            if (request.url === "/theme.css") {
                pending.push(response);
                server.emit("theme-request");
            } else {
                response.setHeader("Content-Type", "text/html");
                response.end(template);
            }
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        let win;
        let code = 0;
        try {
            for (const platform of ["android", "ios", "harmony"]) for (const empty of [true, false]) for (const dark of [true, false]) {
                win = new BrowserWindow({show: false, width: 390, height: 844,
                    webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
                win.webContents.on("console-message", event => {
                    if (event.level === "error") console.error(event.message);
                });
                await win.loadURL(`http://127.0.0.1:${server.address().port}/mobile.html`);
                const themeRequest = once(server, "theme-request", {signal: AbortSignal.timeout(5000)});
                await win.webContents.executeJavaScript(`(${runCase.toString()})(${JSON.stringify(sources)},${JSON.stringify({platform, empty})})`);
                await themeRequest;
                await win.webContents.executeJavaScript("window.releaseFramework()");
                await win.webContents.executeJavaScript("window.releaseInitialView()");
                assert.equal(await win.webContents.executeJavaScript("window.siyuan.isReady"), false);
                pending.pop().writeHead(200, {"Content-Type": "text/css"}).end(`body{color:${dark ? "#ddd" : "#222"}}`);
                await win.webContents.executeJavaScript("window.mobileLoadingResult");
                assert.equal(await win.webContents.executeJavaScript("window.siyuan.isReady"), true);
                assert.equal(await win.webContents.executeJavaScript('!!document.getElementById("loading")'), false);
                assert.equal(await win.webContents.executeJavaScript('document.body.hasAttribute("aria-busy")'), false);
                assert.equal(await win.webContents.executeJavaScript("document.body.style.backgroundColor"), "");
                win.destroy();
            }
            console.log("Verified 12 mobile startup cases");
        } catch (error) { console.error(error); code = 1; }
        finally {
            if (win && !win.isDestroyed()) win.destroy();
            pending.forEach(response => response.end());
            server.close();
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("mobile startup acknowledges readiness after the theme and initial document or empty view are painted", {timeout: 45000}, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-mobile-startup-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Verified 12 mobile startup cases/);
        } finally {
            assert.equal(path.dirname(profile), os.tmpdir());
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
