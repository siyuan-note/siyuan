const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = async (sources, platform) => {
    const assert = require("node:assert/strict");
    const path = require("node:path");
    const cache = {};
    let current;
    let keyboardShows = 0;
    let keyboardHides = 0;
    let inputRequests = 0;
    let undoCalls = 0;
    const inserts = [];
    const visible = new Set(["mobile-copy", "mobile-cut", "mobile-undo", "mobile-redo", "mobile-indent",
        "mobile-outdent", "mobile-block", "mobile-add", "mobile-heading1", "strong", "em", "mobile-separator"]);
    const order = ["strong", "mobile-undo", "mobile-separator", "mobile-heading1", "em", "mobile-indent", "mobile-outdent"];
    const constants = {INLINE_TYPE: ["a", "block-ref", "strong", "em", "u", "s", "code"], ZWSP: "\u200b",
        TIMEOUT_TRANSITION: 20, TIMEOUT_COUNT: 50};
    class LocalUndo {}
    const stubs = {
        "constants": {Constants: constants},
        "mobile/editor": {getCurrentEditor: () => current && {protyle: current}},
        "protyle/lite/mobileToolbar": {getMobileToolbarProtyle: () => undefined, getMobileToolbarUndo: () => undefined,
            getMobileToolbarPaddingElement: protyle => protyle.element},
        "protyle/util/compatibility": {isInAndroid: () => platform === "android", isInHarmony: () => false,
            isInMobileApp: () => platform === "android",
            isInEdge: () => false},
        "mobile/util/inlineMathSelection": {createInlineMathSelection: () => ({reset() {}, update() {}, prepareInput() {}})},
        "mobile/util/pluginToolbar": {getMobilePluginToolbarItems: () => []},
        "protyle/undo": {LocalUndo},
        "protyle/undo/globalUndo": {getUndoRootID: () => "doc", hasUndoStateMirror: () => true,
            getMirror: () => ({canUndo: true, canRedo: false})},
        "config/entryVisibility/runtime": {getEntryOrder: () => order, isEntryVisible: key => visible.has(key.slice("editor.toolbar.".length))},
        "util/functions": {isMobile: () => true},
        "mobile/util/menuKeyboard": {captureMenuKeyboard: () => () => {}},
        "protyle/util/tableCellRichContext": {getTableCellRichContext: () => undefined},
        "editor/getIcon": {getIconByType: () => "iconParagraph"},
        "plugin/EventBusCore": {forEachPluginSubscriber() {}},
        "protyle/util/inlineElementMarker": {stripSemanticMarkersFromRangeText: range => range.toString()},
        "protyle/util/editorFocus": {getEditorFocusRange: (_root, range, fallback) => range || fallback,
            restoreEditorFocusRange: (_root, range) => {
            current.editable.focus();
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            return true;
        }},
    };
    const load = (name) => {
        if (stubs[name]) {
            return stubs[name];
        }
        if (!sources[name]) {
            return new Proxy({}, {get: () => () => {}});
        }
        if (!cache[name]) {
            cache[name] = {};
            new Function("require", "exports", sources[name])(relative =>
                load(path.posix.normalize(path.posix.join(path.posix.dirname(name), relative))), cache[name]);
        }
        return cache[name];
    };
    document.body.innerHTML = '<div id="editor"><div class="protyle-content"><div class="protyle-wysiwyg" data-readonly="false" contenteditable="false"><div data-node-id="one" data-type="NodeParagraph"><div contenteditable="true">Alpha beta gamma</div></div></div></div></div><div id="model"></div><div id="keyboardToolbar" class="keyboard fn__none"></div>';
    const root = document.querySelector(".protyle-wysiwyg");
    const editable = root.querySelector('[contenteditable="true"]');
    const toolbar = document.getElementById("keyboardToolbar");
    const preview = document.createElement("div");
    preview.className = "fn__none";
    const selectionInput = load("mobile/util/selectionKeyboard");
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) {
        const suppressed = selectionInput.suppressMobileSelectionFocus(this);
        focus.apply(this, args);
        if (!suppressed && this === editable) {
            load("mobile/util/mobileAppUtil").callMobileAppShowKeyboard();
        }
    };
    window.siyuan = {zIndex: 1, languages: {}, mobile: {size: {}}, config: {readonly: false, editor: {fontSize: 16}},
        menus: {menu: {remove() {}}}};
    if (platform === "android") {
        window.JSAndroid = {showKeyboard: () => keyboardShows++, hideKeyboard: () => keyboardHides++};
    }
    window.addEventListener("siyuan-mobile-keyboard-change", event => {
        if (event.detail) {
            inputRequests++;
        }
    });
    window.Lute = {Caret: "‸"};
    current = {element: document.getElementById("editor"), editable, contentElement: root.parentElement,
        wysiwyg: {element: root}, preview: {element: preview},
        options: {toolbar: load("protyle/toolbar/defaults").getDefaultToolbar(true)},
        toolbar: {isMultiSelectMode: () => false, getCurrentToolbarType: () => [], setInlineMark: () => editable.focus()},
        gutter: {}, undo: {undo: () => undoCalls++}, hint: {fill: value => inserts.push(value)}};
    const keyboard = load("mobile/util/keyboardToolbar");
    keyboard.initKeyboardToolbar();
    const settle = async () => {
        document.dispatchEvent(new Event("selectionchange"));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    const select = (end = 5) => {
        const range = document.createRange();
        range.setStart(editable.firstChild, 0);
        range.setEnd(editable.firstChild, end);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    };
    const touch = type => editable.dispatchEvent(new PointerEvent(type, {bubbles: true, pointerType: "touch"}));
    touch("pointerdown");
    assert.equal(editable.getAttribute("inputmode"), "none");
    editable.focus();
    assert.equal(keyboardShows, 0);
    select();
    touch("pointerup");
    await settle();
    assert.equal(selectionInput.isMobileSelectionMode(), true);
    assert.equal(keyboardHides, platform === "android" ? 1 : 0);
    assert.equal(toolbar.classList.contains("fn__none"), false);
    assert.equal(toolbar.classList.contains("keyboard--selection"), true);
    assert.equal(getSelection().toString(), "Alpha");
    const contextMenu = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
    editable.dispatchEvent(contextMenu);
    assert.equal(contextMenu.defaultPrevented, true);
    assert.equal(getSelection().toString(), "Alpha");
    editable.blur();
    load("mobile/util/mobileAppUtil").callMobileAppShowKeyboard();
    assert.equal(keyboardShows, 0);
    assert.equal(selectionInput.isMobileSelectionMode(), true);
    assert.equal(keyboard.hideKeyboardToolbarByApp(false), load("mobile/util/touchSelection").KeyboardHideResult.PreserveSelection);
    assert.equal(getSelection().toString(), "Alpha");
    const action = name => toolbar.querySelector(`[data-type="${name}"]`).dispatchEvent(
        new Event(platform === "android" ? "touchend" : "click", {bubbles: true, cancelable: true}));
    action("strong");
    await settle();
    assert.equal(keyboardShows, 0);
    assert.equal(editable.getAttribute("inputmode"), "none");
    action("undo");
    assert.equal(undoCalls, 1);
    action("redo");
    assert.equal(undoCalls, 1);
    action("heading1");
    assert.equal(inserts[0], "# ‸");
    const actualOrder = [...toolbar.querySelector(".keyboard__dynamic").children]
        .filter(item => !item.classList.contains("fn__none")).map(item => item.dataset.id);
    assert.ok(actualOrder.indexOf("strong") < actualOrder.indexOf("mobile-undo"));
    assert.ok(actualOrder.indexOf("mobile-heading1") < actualOrder.indexOf("em"));
    // 显隐变化和编辑器切换不得恢复隐藏项，也不得向受限的字段编辑器插入文档块。
    visible.delete("mobile-undo");
    window.dispatchEvent(new Event("siyuan-entry-visibility"));
    await settle();
    assert.equal(toolbar.querySelector('[data-type="undo"]').classList.contains("fn__none"), true);
    current.lite = {};
    await settle();
    assert.equal(toolbar.querySelector('[data-type="heading1"]').classList.contains("fn__none"), true);
    current.lite = undefined;
    action("done");
    await settle();
    assert.equal(selectionInput.isMobileSelectionMode(), false);
    assert.equal(editable.hasAttribute("inputmode"), false);
    assert.ok(inputRequests > 0);
    assert.equal(keyboardShows > 0, platform === "android");
    assert.equal(toolbar.classList.contains("keyboard--selection"), false);
    // 短按折叠光标恢复输入，保留已有的 inputmode 属性。
    selectionInput.clearMobileSelectionInput();
    editable.setAttribute("inputmode", "text");
    touch("pointerdown");
    select(0);
    touch("pointerup");
    editable.click();
    assert.equal(editable.getAttribute("inputmode"), "text");
    assert.equal(selectionInput.isMobileSelectionMode(), false);
    // 输入框与数据库字段弹层不会继承文档的选择模式。
    touch("pointerdown");
    select();
    await settle();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    assert.equal(selectionInput.isMobileSelectionMode(), false);
    assert.equal(editable.getAttribute("inputmode"), "text");
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 400, height: 800,
        webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false}});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const modules = ["mobile/util/selectionKeyboard", "mobile/util/keyboardToolbar", "mobile/util/toolbarActions",
            "mobile/util/toolbarEntries", "mobile/util/mobileAppUtil", "mobile/util/mobileKeyboardChange",
            "mobile/util/touchSelection", "mobile/util/visibleViewport", "protyle/util/hasClosest",
            "protyle/toolbar/defaults", "protyle/toolbar/entryVisibility", "config/entryVisibility/order"];
        const sources = Object.fromEntries(modules.map(name => [name, ts.transpileModule(
            readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"),
            {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText]));
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/mobile.scss"), {logger: {warn() {}}}).css;
        for (const platform of ["android", "browser"]) {
            await win.loadURL("data:text/html,<html><body></body></html>");
            await win.webContents.insertCSS(css);
            await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(platform)})`);
        }
        console.log("Mobile editing toolbar cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {console.error(error); require("electron").app.exit(1);});
} else {
    require("node:test").it("keeps touch selections editable without opening the keyboard and shares toolbar configuration", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-mobile-editing-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Mobile editing toolbar cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-mobile-editing-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
