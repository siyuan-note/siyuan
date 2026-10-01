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
    const focusRequests = [];
    let undoCalls = 0;
    const inserts = [];
    const commands = [];
    const nativeKeyboard = platform === "android" || platform === "harmony";
    const visible = new Set(["mobile-copy", "mobile-cut", "mobile-undo", "mobile-redo", "mobile-indent",
        "mobile-outdent", "mobile-block", "mobile-add", "mobile-heading1", "strong", "em", "a", "block-ref", "text",
        "mobile-separator"]);
    const order = ["strong", "mobile-undo", "mobile-separator", "mobile-heading1", "em", "mobile-indent", "mobile-outdent"];
    const constants = {INLINE_TYPE: ["a", "block-ref", "strong", "em", "u", "s", "code"], ZWSP: "\u200b",
        TIMEOUT_TRANSITION: 20, TIMEOUT_COUNT: 50};
    class LocalUndo {}
    const stubs = {
        "constants": {Constants: constants},
        "mobile/editor": {getCurrentEditor: () => current && {protyle: current}},
        "protyle/lite/mobileToolbar": {getMobileToolbarProtyle: () => undefined, getMobileToolbarUndo: () => undefined,
            getMobileToolbarPaddingElement: protyle => protyle.element},
        "protyle/util/compatibility": {isInAndroid: () => platform === "android", isInHarmony: () => platform === "harmony",
            isInMobileApp: () => platform !== "browser",
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
        "protyle/util/selection": {
            getSelectionPosition: () => ({top: 100, left: 0}),
            focusByRange: range => {
                editable.focus();
                getSelection().removeAllRanges();
                getSelection().addRange(range);
            },
        },
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
                load(relative.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(name), relative)) : relative), cache[name]);
        }
        return cache[name];
    };
    document.body.innerHTML = '<div id="editor"><div class="protyle-content"><div class="protyle-wysiwyg" data-readonly="false" contenteditable="false"><div data-node-id="one" data-type="NodeParagraph"><div contenteditable="true">Alpha beta gamma</div></div></div></div></div><div id="model"></div><div id="keyboardToolbar" class="keyboard fn__none"></div>';
    const root = document.querySelector(".protyle-wysiwyg");
    const editable = root.querySelector('[contenteditable="true"]');
    const toolbar = document.getElementById("keyboardToolbar");
    const preview = document.createElement("div");
    preview.className = "fn__none";
    window.siyuan = {zIndex: 1, languages: {}, mobile: {size: {}}, config: {readonly: false, editor: {fontSize: 16}},
        menus: {menu: {element: document.createElement("div"), remove() {}}}};
    if (nativeKeyboard) {
        window[platform === "android" ? "JSAndroid" : "JSHarmony"] = {
            showKeyboard: () => keyboardShows++, hideKeyboard: () => keyboardHides++,
            setWebViewFocusable: focusable => focusRequests.push(focusable),
        };
    }
    window.addEventListener("siyuan-mobile-keyboard-change", event => {
        document.body.classList.toggle("mobile-keyboard--open", event.detail);
        if (event.detail) {
            inputRequests++;
        }
    });
    document.execCommand = command => {
        commands.push({command, text: getSelection().toString()});
        return true;
    };
    window.Lute = {Caret: "‸"};
    current = {element: document.getElementById("editor"), editable, contentElement: root.parentElement,
        wysiwyg: {element: root}, preview: {element: preview},
        options: {toolbar: load("protyle/toolbar/defaults").getDefaultToolbar(true)},
        toolbar: {isMultiSelectMode: () => false, getCurrentToolbarType: () => [], setInlineMark: () => editable.focus()},
        gutter: {}, undo: {undo: () => undoCalls++}, hint: {fillCommand: value => inserts.push(value)}};
    const keyboard = load("mobile/util/keyboardToolbar");
    keyboard.initKeyboardToolbar();
    load("mobile/inputBindings");
    const settle = async () => {
        document.dispatchEvent(new Event("selectionchange"));
        // 文档编辑器和原生键盘回调会刷新工具栏，此处复用同一入口。
        keyboard.showKeyboardToolbar();
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
    // 键盘尚未打开时选字，不覆盖输入类型，也不要求先点击独立的编辑按钮。
    editable.dispatchEvent(new Event("touchstart", {bubbles: true}));
    assert.deepEqual(focusRequests, platform === "android" ? [true] : []);
    assert.equal(getSelection().isCollapsed, true);
    touch("pointerdown");
    assert.equal(editable.hasAttribute("inputmode"), false);
    editable.focus();
    assert.equal(keyboardShows > 0, nativeKeyboard);
    select();
    touch("pointerup");
    editable.click();
    await settle();
    assert.equal(keyboardHides, 0);
    assert.equal(toolbar.classList.contains("fn__none"), false);
    assert.equal(toolbar.classList.contains("keyboard--selection"), false);
    assert.equal(toolbar.querySelector('[data-type="done"] use').getAttribute("xlink:href"), "#iconKeyboardHide");
    assert.equal(getSelection().toString(), "Alpha");
    assert.equal(document.activeElement, editable);
    assert.ok(inputRequests > 0);
    assert.equal(toolbar.querySelector('[data-type="copy"]').classList.contains("fn__none"), false);
    assert.equal(toolbar.querySelector('[data-type="cut"]').classList.contains("fn__none"), false);
    const hidden = name => toolbar.querySelector(`[data-type="${name}"]`).classList.contains("fn__none");
    assert.equal(hidden("indent"), true);
    assert.equal(hidden("outdent"), true);
    for (const name of ["strong", "em", "a", "block-ref", "text"]) {
        assert.equal(hidden(name), false);
    }
    const contextMenu = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
    editable.dispatchEvent(contextMenu);
    assert.equal(contextMenu.defaultPrevented, false);
    assert.equal(getSelection().toString(), "Alpha");

    // 正在输入时重新选字或拖动端点，选区变化不能关闭键盘。
    assert.equal(document.body.classList.contains("mobile-keyboard--open"), true);
    touch("pointerdown");
    select(10);
    touch("pointerup");
    await settle();
    assert.equal(getSelection().toString(), "Alpha beta");
    assert.equal(keyboardHides, 0);
    assert.equal(editable.hasAttribute("inputmode"), false);
    select();
    editable.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    await settle();
    assert.equal(getSelection().toString(), "Alpha");
    assert.equal(keyboardHides, 0);
    const action = name => toolbar.querySelector(`[data-type="${name}"]`).dispatchEvent(
        new Event(nativeKeyboard ? "touchend" : "click", {bubbles: true, cancelable: true}));
    action("copy");
    action("cut");
    assert.deepEqual(commands, [{command: "copy", text: "Alpha"}, {command: "cut", text: "Alpha"}]);
    action("strong");
    await settle();
    assert.equal(keyboardHides, 0);
    assert.equal(editable.hasAttribute("inputmode"), false);
    assert.equal(document.activeElement, editable);
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
    // 代码块选中内容时可缩进，列表首项保留禁用状态，外观配置仍可隐藏按钮。
    const block = editable.parentElement;
    block.classList.add("code-block");
    select();
    await settle();
    assert.equal(hidden("indent"), false);
    assert.equal(hidden("outdent"), false);
    assert.equal(toolbar.querySelector('[data-type="indent"]').hasAttribute("disabled"), false);
    assert.equal(hidden("strong"), true);
    select(0);
    await settle();
    assert.equal(hidden("indent"), true);
    block.classList.remove("code-block");
    const listItem = document.createElement("div");
    listItem.className = "li";
    root.append(listItem);
    listItem.append(block);
    editable.focus();
    select(0);
    await settle();
    assert.equal(hidden("indent"), false);
    assert.equal(hidden("outdent"), false);
    assert.equal(toolbar.querySelector('[data-type="indent"]').hasAttribute("disabled"), true);
    visible.delete("mobile-outdent");
    await settle();
    assert.equal(hidden("outdent"), true);
    root.append(block);
    listItem.remove();
    editable.focus();
    select(0);
    await settle();
    const showsBeforeClose = keyboardShows;
    action("done");
    assert.equal(document.activeElement, document.body);
    assert.equal(editable.hasAttribute("inputmode"), false);
    assert.equal(keyboardHides, nativeKeyboard ? 1 : 0);
    assert.equal(keyboardShows, showsBeforeClose);
    assert.equal(toolbar.classList.contains("fn__none"), true);
    // 短按继续输入时保留已有 inputmode，折叠选区不显示复制与剪切。
    editable.setAttribute("inputmode", "text");
    touch("pointerdown");
    editable.focus();
    select(0);
    touch("pointerup");
    editable.click();
    await settle();
    assert.equal(editable.getAttribute("inputmode"), "text");
    assert.equal(toolbar.querySelector('[data-type="copy"]').classList.contains("fn__none"), true);
    assert.equal(toolbar.querySelector('[data-type="cut"]').classList.contains("fn__none"), true);
    for (const name of ["indent", "outdent", "strong", "em", "a", "block-ref", "text"]) {
        assert.equal(hidden(name), true);
    }
    // 输入框不会因残留文档选区恢复文档工具栏。
    const input = document.createElement("input");
    document.body.append(input);
    select();
    input.focus();
    await settle();
    assert.equal(toolbar.classList.contains("fn__none"), true);
    assert.equal(editable.getAttribute("inputmode"), "text");
    assert.equal(document.activeElement, input);
    // 只读编辑器不通过全局点击与焦点逻辑请求输入。
    keyboard.hideKeyboardToolbar();
    root.setAttribute("data-readonly", "true");
    current.disabled = true;
    const showsBeforeReadonly = keyboardShows;
    const focusRequestsBeforeReadonly = focusRequests.length;
    editable.dispatchEvent(new Event("touchstart", {bubbles: true}));
    assert.equal(focusRequests.length, focusRequestsBeforeReadonly);
    document.body.dispatchEvent(new Event("touchstart", {bubbles: true}));
    assert.equal(focusRequests.length, focusRequestsBeforeReadonly);
    touch("pointerdown");
    editable.focus();
    select();
    touch("pointerup");
    editable.click();
    assert.equal(keyboardShows, showsBeforeReadonly);
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
        const modules = ["mobile/util/keyboardToolbar", "mobile/util/toolbarActions",
            "mobile/util/toolbarEntries", "mobile/util/mobileAppUtil", "mobile/util/mobileKeyboardChange",
            "mobile/util/touchSelection", "mobile/util/visibleViewport", "protyle/util/hasClosest",
            "protyle/toolbar/defaults", "protyle/toolbar/entryVisibility", "config/entryVisibility/order"];
        const sources = Object.fromEntries(modules.map(name => [name, ts.transpileModule(
            readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"),
            {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText]));
        // 直接使用移动端 App 的点击与 focus 绑定，避免测试替身漏掉输入抑制逻辑。
        const appSource = ts.createSourceFile("mobile/index.ts",
            readFileSync(path.join(__dirname, "../src/mobile/index.ts"), "utf8"), ts.ScriptTarget.Latest, true);
        const appClass = appSource.statements.find(node => ts.isClassDeclaration(node) && node.name.text === "App");
        const statements = appClass.members.find(ts.isConstructorDeclaration).body.statements;
        const touchBinding = statements.find(node => node.getText(appSource).startsWith('document.addEventListener("touchstart",'));
        const clickBinding = statements.find(node => node.getText(appSource).startsWith('window.addEventListener("click",'));
        const focusBinding = statements.find(node => ts.isBlock(node) && node.getText(appSource).includes("__siyuan_original_focus"));
        assert.ok(touchBinding && clickBinding && focusBinding);
        sources["mobile/inputBindings"] = ts.transpileModule(`
            const {canInput, armKeyboardLock, callMobileAppShowKeyboard} = require("mobile/util/mobileAppUtil");
            const {hideKeyboardToolbarUtilOnEditorClick} = require("mobile/util/keyboardToolbar");
            const {hasClosestByClassName, hasClosestByAttribute, hasTopClosestByClassName} = require("protyle/util/hasClosest");
            const {Constants} = require("constants");
            const scrollInputIntoView = () => {};
            const hideAllElements = () => {};
            ${touchBinding.getText(appSource)}
            ${clickBinding.getText(appSource)}
            ${focusBinding.getText(appSource)}
        `, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/mobile.scss"), {logger: {warn() {}}}).css;
        for (const platform of ["android", "harmony", "ios", "browser"]) {
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
    require("node:test").it("keeps touch selections in the input flow and shares toolbar configuration", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 125000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-mobile-editing-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 120000});
            assert.match(stdout, /Mobile editing toolbar cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-mobile-editing-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
