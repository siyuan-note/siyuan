const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    const extract = (file, names) => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
            ts.ScriptTarget.Latest, true);
        const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
        assert.equal(statements.length, names.length);
        return ts.transpileModule(statements.map(statement => statement.getText(source)).join("\n")
            .replace(/export const /g, "const "), {
            compilerOptions: {target: ts.ScriptTarget.ES2021},
        }).outputText;
    };
    return {
        navigation: extract("editor/util.ts", ["switchEditor"]),
        visibility: extract("protyle/render/tabsVisibility.ts", ["isHiddenTabContent"]),
    };
};

const cases = (source) => {
    const check = require("node:assert/strict");
    const lute = window.Lute.New();
    lute.SetTabs(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetParagraphBeginningSpace(true);
    lute.SetSpin(true);
    window.siyuan = {config: {editor: {spellcheck: false}}};
    const root = document.createElement("div");
    document.body.append(root);
    root.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab Original\n\nBody\n:::\n");
    const item = root.querySelector(".tab-item");
    const id = item.dataset.nodeId;
    for (const value of [" leading", "trailing ", "two  spaces", "   "]) {
        item.querySelector(".tab-item-title").textContent = value;
        const roundtrip = document.createElement("div");
        roundtrip.innerHTML = lute.SpinBlockDOM(root.innerHTML);
        check.equal(roundtrip.querySelector(".tab-item-title").textContent.replace(/\u00a0/g, " "), value, roundtrip.innerHTML);
        check.equal(roundtrip.querySelector(".tab-item").dataset.nodeId, id);
        const markdown = lute.BlockDOM2StdMd(roundtrip.innerHTML);
        const imported = document.createElement("div");
        imported.innerHTML = lute.Md2BlockDOM(markdown);
        check.equal(imported.querySelector(".tab-item-title").textContent.replace(/\u00a0/g, " "), value);
    }

    // 使用真实的编辑器跳转入口和 DOM，手动派发尺寸回调以覆盖返回和点击切换。
    let resizeCallback;
    let disconnected;
    let scrolls;
    class Observer {
        constructor(callback) { resizeCallback = callback; }
        observe() {}
        disconnect() { disconnected = true; }
    }
    const navigation = new Function("ResizeObserver", "Constants", "isInEmbedBlock", "revealTabsForTarget",
        "preventScroll", "focusBlock", "scrollCenter", "pushBack", "setTimeout",
        source.visibility + source.navigation + "; return switchEditor;")(
        Observer, {CB_GET_FOCUS: "focus"}, () => false,
        target => { target.dataset.tabsHidden = "false"; }, () => {}, () => document.createRange(),
        (_protyle, target) => { scrolls++; target.dataset.tabsHidden = "false"; }, () => {}, () => {});
    root.innerHTML = '<div class="tab-item" data-node-id="target" data-tabs-hidden="false">Target</div>';
    const target = root.firstElementChild;
    const protyle = {wysiwyg: {element: root}, contentElement: root,
        preview: {element: {classList: {contains: () => true}}}, toolbar: {}, block: {rootID: "doc"}};
    const editor = {editor: {protyle}, parent: {parent: {switchTab() {}, showHeading() {}}}};
    const start = () => {
        disconnected = false;
        scrolls = 0;
        navigation(editor, {id: "target", action: ["focus"], scrollPosition: "start"}, {});
        check.equal(scrolls, 1);
    };
    start();
    resizeCallback();
    check.equal(scrolls, 2);
    target.dataset.tabsHidden = "true";
    resizeCallback();
    check.equal(scrolls, 2);
    check.equal(disconnected, true);
    check.equal(target.dataset.tabsHidden, "true");
    start();
    root.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
    check.equal(disconnected, true);
    root.remove();
    return "Tabs title and navigation cases passed";
};

const run = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true,
    }});
    let code = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(readFileSync(path.join(__dirname,
            "../stage/protyle/js/lute/lute.min.js"), "utf8"));
        const result = await win.webContents.executeJavaScript(`(() => { try {
            return (${cases.toString()})(${JSON.stringify(sources())});
        } catch (error) { return error.stack; } })()`);
        assert.equal(result, "Tabs title and navigation cases passed");
        console.log(result);
    } catch (error) {
        console.error(error);
        code = 1;
    } finally {
        win.destroy();
        app.exit(code);
    }
};

if (process.versions.electron && process.type === "browser") {
    run().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("preserves tab title spaces and stops navigation after leaving a tab", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-tabs-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Tabs title and navigation cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
