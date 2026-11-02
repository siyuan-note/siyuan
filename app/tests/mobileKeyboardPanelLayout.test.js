const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {promisify} = require("node:util");

const setupPanel = ({panelCode, heightCode, native}) => {
    document.documentElement.setAttribute("data-frontend", native ? "mobile" : "browser-mobile");
    document.body.className = native ? "body--android" : "";
    document.body.innerHTML = '<div id="editor"></div><div id="keyboardToolbar" class="keyboard"><div class="keyboard__bar" style="height:48px;min-height:48px;box-sizing:content-box"></div><div class="keyboard__util"></div></div>';
    const getHeight = new Function(`${heightCode};return getKeyboardPanelHeight;`)();
    const toolbar = document.getElementById("keyboardToolbar");
    const editor = document.getElementById("editor");
    const state = {hidden: 0};
    const update = new Function("getKeyboardPanelHeight", "getKeyboardViewportBottom", "isMobileLandscape", "isInMobileApp",
        "getCurrentEditor", "getMobileToolbarPaddingElement", "hideKeyboardToolbarUtil", `
        let keyboardPanelTop = 452;
        let keyboardPanelLandscape = false;
        let keyboardPanelClosing = false;
        ${panelCode}
        return closing => {keyboardPanelClosing = closing;updateKeyboardPanelHeight();};
    `)(getHeight, () => innerHeight, () => false, () => native,
        () => ({protyle: {}}), () => editor, () => state.hidden++);
    window.panelFixture = {toolbar, editor, state, update};
};

const checkPanel = ({inset, closing = false, update = true}) => {
    const check = require("node:assert/strict");
    document.documentElement.style.setProperty("--android-navigation-bar-height", `${inset}px`);
    const {toolbar, editor, state, update: render} = window.panelFixture;
    if (update) render(closing);
    if (state.hidden) return state.hidden;
    const rect = toolbar.getBoundingClientRect();
    const expectedHeight = Math.max(48, innerHeight - inset - 452);
    check.equal(rect.height, expectedHeight, "panel height excludes the native navigation inset");
    check.equal(rect.bottom, innerHeight - inset, "panel stays above the gesture region");
    check.equal(rect.top, Math.min(452, innerHeight - inset - 48), "handoff preserves the top until minimum toolbar height");
    const padding = parseFloat(getComputedStyle(editor).paddingBottom);
    check.equal(padding, expectedHeight + inset, "editor reserves both the panel and its bottom offset");
    check.equal(innerHeight - padding, rect.top, "editor boundary and panel top remain aligned");
    return state.hidden;
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.disableHardwareAcceleration();
    await app.whenReady();
    const watchdog = setTimeout(() => app.exit(1), 40000);
    const win = new BrowserWindow({show: false, width: 400, height: 800,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    let code = 0;
    try {
        const ts = require("typescript");
        const compileDeclaration = (file, name) => {
            const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, file), "utf8"),
                ts.ScriptTarget.Latest, true);
            const declaration = source.statements.find(node => ts.isVariableStatement(node) &&
                node.declarationList.declarations.some(item => item.name.getText(source) === name));
            assert.ok(declaration, name);
            return ts.transpileModule(declaration.getText(source).replace(/^export /, ""), {
                compilerOptions: {target: ts.ScriptTarget.ES2021},
            }).outputText;
        };
        const sources = {
            panelCode: compileDeclaration("../src/mobile/util/keyboardToolbar.ts", "updateKeyboardPanelHeight"),
            heightCode: compileDeclaration("../src/mobile/util/keyboardPanelHeight.ts", "getKeyboardPanelHeight"),
        };
        const sass = require("sass");
        const css = sass.compile(path.join(__dirname, "../src/assets/scss/mobile.scss"), {logger: sass.Logger.silent}).css;
        await win.loadURL("data:text/html,<html><head><meta name='viewport' content='width=device-width, initial-scale=1'></head><body></body></html>");
        await win.webContents.insertCSS(css);
        win.webContents.debugger.attach("1.3");
        const resize = height => win.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
            width: 400, height, deviceScaleFactor: 1, mobile: true,
        });
        const check = async options => {
            const result = await win.webContents.executeJavaScript(`(() => {
                try { return {hidden: (${checkPanel.toString()})(${JSON.stringify(options)})}; }
                catch (error) { return {error: error.stack}; }
            })()`);
            assert.equal(result.error, undefined, JSON.stringify(options));
            return result.hidden;
        };
        for (const native of [true, false]) {
            await win.webContents.executeJavaScript(`(${setupPanel.toString()})(${JSON.stringify({...sources, native})})`);
            for (const [height, inset] of [[500, 0], [550, 0], [700, 16], [800, 24], [700, 16], [550, 0], [500, 0]]) {
                await resize(height);
                assert.equal(await check({inset: native ? inset : 0}), 0);
            }
            if (native) {
                await resize(800);
                await check({inset: 24});
                // 原生属性可能晚于视口更新，CSS 表达式需要独立保持面板和占位同步。
                await check({inset: 15.75, update: false});
                await check({inset: 0, update: false});
                await resize(500);
                await check({inset: 24});
                await resize(400);
                await check({inset: 24});
            }
            await resize(800);
            assert.equal(await check({inset: native ? 24 : 0, closing: true}), 0);
            await resize(500);
            assert.equal(await check({inset: 0, closing: true}), 1, "panel closes once the returning keyboard reaches the toolbar");
        }
        console.log("Verified mobile keyboard panel navigation layout");
    } catch (error) {
        console.error(error);
        code = 1;
    } finally {
        win.destroy();
        clearTimeout(watchdog);
        app.exit(code);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {console.error(error); require("electron").app.exit(1);});
} else {
    require("node:test").test("keyboard panels align with editor padding across native navigation and IME transitions", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 50000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-keyboard-panel-layout-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 45000,
            });
            assert.match(stdout, /Verified mobile keyboard panel navigation layout/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-keyboard-panel-layout-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
