const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {pathToFileURL} = require("node:url");

const createExitDialog = (sources, languages, mobile) => {
    const load = (source, dependencies) => {
        const exports = {};
        new Function("require", "exports", source)(name => dependencies[name] || {}, exports);
        return exports;
    };
    window.siyuan = {languages, storage: {}, dialogs: [], zIndex: 1,
        menus: {menu: {element: document.createElement("div")}}};
    const escapeHtml = value => {
        const span = document.createElement("span");
        span.textContent = value;
        return span.innerHTML;
    };
    const progress = load(sources.progress, {"../util/escape": {escapeHtml}});
    const {Dialog} = load(sources.dialog, {
        "../util/genID": {genUUID: () => "exit-test"},
        "../util/zIndex": {isAbove: () => false},
        "./moveResize": {moveResize() {}},
        "../util/functions": {isMobile: () => mobile},
        "../constants": {Constants: {TIMEOUT_DBLCLICK: 0}},
        "../block/panelOwnership": {destroyDialogBlockPanels() {}, getDialogBlockPanel() {}},
        "./anchoredInput": {getAnchoredInputMask() {}},
    });
    const {requestSystemExit} = load(sources.exit, {
        "./index": {Dialog},
        "./progress": progress,
        "../util/fetch": {fetchSyncPost: () => new Promise((resolve, reject) => {
            window.finishExit = resolve;
            window.failExit = reject;
        })},
        "../util/fetchTimeout": {withFetchTimeout: request => request()},
        "../util/escape": {escapeHtml},
    });
    window.exitResult = requestSystemExit({force: false, setCurrentWorkspace: true}, response => {
        window.exitResponse = response;
    });
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, nativeTheme} = require("electron");
    app.disableHardwareAcceleration();
    app.setPath("userData", process.argv[2]);
    app.on("window-all-closed", () => {});
    app.whenReady().then(async () => {
        const watchdog = setTimeout(() => app.exit(1), 45000);
        const root = path.join(__dirname, "..");
        const ts = require("typescript");
        const sources = Object.fromEntries(Object.entries({dialog: "dialog/index.ts", exit: "dialog/exitRequest.ts", progress: "dialog/progress.ts"})
            .map(([key, file]) => [key, ts.transpileModule(fs.readFileSync(path.join(root, "src", file), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
            }).outputText]));
        const css = require("sass").compile(path.join(root, "src/assets/scss/base.scss"), {logger: {warn() {}, debug() {}}}).css;
        const icons = pathToFileURL(path.join(root, "appearance/icons/litheness/icon.js")).href;
        const languages = JSON.parse(fs.readFileSync(path.join(root, "appearance/langs/zh-CN.json"), "utf8"));
        for (const mode of ["light", "dark"]) {
            nativeTheme.themeSource = mode;
            const theme = fs.readFileSync(path.join(root, "appearance/themes", mode === "light" ? "daylight" : "midnight", "theme.css"), "utf8");
            for (const width of [360, 960]) {
                const win = new BrowserWindow({show: false, width, height: 640, webPreferences: {nodeIntegration: true, contextIsolation: false}});
                win.webContents.on("console-message", event => {
                    if (event.level === "error") console.error(event.message);
                });
                await win.loadFile(path.join(root, "electron/boot.html"), {query: {lang: "zh-CN", v: "test",
                    previousExitWaiting: languages.previousExitWaiting}});
                const startup = await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
                    logo: !!document.querySelector("#bg svg"), message: document.getElementById("details").textContent,
                    progress: document.getElementById("progress").style.width,
                    dialog: !!document.querySelector(".b3-dialog__loading"),
                    width: document.documentElement.scrollWidth, viewport: innerWidth, background: getComputedStyle(document.body).backgroundColor
                }))))`);
                assert.equal(startup.logo, true);
                assert.ok(parseFloat(startup.progress) >= 15);
                assert.equal(startup.dialog, false);
                assert.equal(startup.message, languages.previousExitWaiting);
                assert.ok(startup.width <= startup.viewport);
                assert.equal(startup.background, "rgb(30, 30, 30)");
                const capture = async name => {
                    if (process.env.SIYUAN_EXIT_WAIT_SCREENSHOTS) {
                        await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
                        fs.mkdirSync(process.env.SIYUAN_EXIT_WAIT_SCREENSHOTS, {recursive: true});
                        fs.writeFileSync(path.join(process.env.SIYUAN_EXIT_WAIT_SCREENSHOTS, `${name}-${mode}-${width}.png`),
                            (await win.webContents.capturePage()).toPNG());
                    }
                };
                await win.webContents.executeJavaScript("new Promise(resolve => setTimeout(resolve, 2200))");
                await capture("restart");
                const resumed = await win.webContents.executeJavaScript(`(() => {
                    const sources = [];
                    let appearanceRequests = 0;
                    window.EventSource = class {
                        constructor() { sources.push(this); }
                        close() { this.closed = true; }
                    };
                    window.fetch = () => { appearanceRequests++; return new Promise(() => {}); };
                    const url = location.href;
                    window.setPreviousExitWaiting("");
                    const booting = document.getElementById("details").textContent;
                    window.setPreviousExitWaiting(${JSON.stringify(languages.previousExitWaiting)});
                    sources[0].onmessage({data: JSON.stringify({progress: 100, details: "stale"})});
                    const waiting = document.getElementById("details").textContent;
                    const requestsWhileWaiting = appearanceRequests;
                    window.setPreviousExitWaiting("");
                    sources[1].onmessage({data: JSON.stringify({progress: 100, details: "ready"})});
                    return {booting, waiting, requestsWhileWaiting, appearanceRequests, sources: sources.length,
                        paused: sources[0].closed, completed: sources[1].closed,
                        details: document.getElementById("details").textContent,
                        progress: document.getElementById("progress").style.width, samePage: location.href === url};
                })()`);
                assert.equal(resumed.booting, "vtest Booting kernel...");
                assert.equal(resumed.waiting, languages.previousExitWaiting);
                assert.equal(resumed.requestsWhileWaiting, 1);
                assert.equal(resumed.appearanceRequests, 2);
                assert.equal(resumed.sources, 2);
                assert.equal(resumed.paused, true);
                assert.equal(resumed.completed, true);
                assert.equal(resumed.details, "ready");
                assert.equal(resumed.progress, "100%");
                assert.equal(resumed.samePage, true);
                const html = `<html><head><style>${theme}\n${css}</style></head><body><script src="${icons}"></script></body></html>`;
                const file = path.join(process.argv[2], "dialog.html");
                fs.writeFileSync(file, html);
                await win.loadFile(file);
                await win.webContents.executeJavaScript(`(${createExitDialog.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(languages)}, ${width === 360})`);
                await win.webContents.executeJavaScript("new Promise(resolve => setTimeout(resolve, 200))");
                const waiting = await win.webContents.executeJavaScript(`(() => {
                    const container = document.querySelector("#exitProgress .b3-dialog__loading");
                    const bounds = container.getBoundingClientRect();
                    const status = container.lastElementChild;
                    const mask = document.querySelector(".b3-dialog__scrim");
                    const maskBounds = mask.getBoundingClientRect();
                    const stripe = getComputedStyle(container.firstElementChild.firstElementChild);
                    const key = new KeyboardEvent("keydown", {key: "a", bubbles: true, cancelable: true});
                    document.body.dispatchEvent(key);
                    return {visible: bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth,
                        globalMask: maskBounds.left === 0 && maskBounds.top === 0 && maskBounds.width === innerWidth && maskBounds.height === innerHeight,
                        overflow: status.scrollWidth > status.clientWidth, text: status.textContent,
                        endless: stripe.animationName === "stripMove" && stripe.animationIterationCount === "infinite",
                        noDialog: !document.querySelector(".b3-dialog__container"), inputBlocked: key.defaultPrevented};
                })()`);
                assert.equal(waiting.visible, true);
                assert.equal(waiting.globalMask, true);
                assert.equal(waiting.overflow, false);
                assert.equal(waiting.endless, true);
                assert.equal(waiting.noDialog, true);
                assert.equal(waiting.inputBlocked, true);
                assert.ok(waiting.text.includes(languages.exitWaiting));
                await capture("exit");
                await win.webContents.executeJavaScript("window.failExit(new Error('offline')); window.exitResult;");
                const failed = await win.webContents.executeJavaScript(`(() => {
                    const buttons = [...document.querySelectorAll("button")];
                    const key = new KeyboardEvent("keydown", {key: "a", bubbles: true, cancelable: true});
                    document.body.dispatchEvent(key);
                    return {count: buttons.length, focus: document.activeElement === buttons[1],
                        waiting: !!document.getElementById("exitProgress"), inputBlocked: key.defaultPrevented,
                        message: document.querySelector('[role="alert"]').textContent, response: window.exitResponse};
                })()`);
                assert.equal(failed.count, 2);
                assert.equal(failed.waiting, false);
                assert.equal(failed.inputBlocked, false);
                assert.equal(failed.focus, true);
                assert.equal(failed.message, languages.exitWaitFailed);
                assert.equal(failed.response, undefined);
                await capture("failure");
                win.destroy();
            }
        }
        clearTimeout(watchdog);
        app.exit(0);
    }).catch(error => { console.error(error); app.exit(1); });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("exit uses endless progress and boot resumes in place after waiting in light, dark and narrow layouts", {timeout: 60000}, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-exit-wait-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
        } finally {
            const relative = path.relative(os.tmpdir(), profile);
            assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative) && relative.startsWith("siyuan-exit-wait-test-"));
            fs.rmSync(profile, {recursive: true, force: true});
        }
    });
}
