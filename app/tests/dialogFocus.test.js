const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async (source) => {
    const assert = require("node:assert/strict");
    const tick = () => new Promise(resolve => setTimeout(resolve, 20));
    let id = 0;
    window.siyuan = {dialogs: [], zIndex: 1, menus: {menu: {element: document.createElement("div"), remove() {}}}};
    const modules = {
        "../util/genID": {genUUID: () => String(++id)},
        "../util/zIndex": {isAbove: () => false},
        "./moveResize": {moveResize() {}},
        "../util/functions": {isMobile: () => false},
        "../protyle/util/compatibility": {isNotCtrl: () => true},
        "../constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
        "../block/panelOwnership": {getDialogBlockPanel() {}, destroyDialogBlockPanels() {}},
    };
    const exports = {};
    new Function("require", "exports", source)(name => {
        assert.ok(name in modules, name);
        return modules[name];
    }, exports);
    const {Dialog} = exports;
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.append(trigger);
    const open = (options = {}) => {
        const dialog = new Dialog({content: "<input>", ...options});
        dialog.element.querySelector("input").focus();
        return dialog;
    };
    trigger.focus();
    let dialog = open();
    dialog.destroy();
    await tick();
    assert.equal(document.activeElement, trigger);

    const parent = open();
    const parentInput = document.activeElement;
    const child = open();
    child.destroy();
    await tick();
    assert.equal(document.activeElement, parentInput);
    parent.destroy();
    await tick();
    assert.equal(document.activeElement, trigger);

    const other = document.createElement("button");
    document.body.append(other);
    dialog = open({destroyCallback: () => other.focus()});
    dialog.destroy();
    await tick();
    assert.equal(document.activeElement, other);

    trigger.focus();
    dialog = open();
    dialog.destroy();
    other.focus();
    await tick();
    assert.equal(document.activeElement, other);

    trigger.focus();
    const lower = open();
    const upper = open();
    const upperInput = document.activeElement;
    lower.destroy();
    await tick();
    assert.equal(document.activeElement, upperInput);
    upper.destroy();
    await tick();
    assert.equal(document.activeElement, document.body);

    for (const unavailable of ["hidden", "disabled", "removed"]) {
        trigger.hidden = false;
        trigger.disabled = false;
        document.body.append(trigger);
        trigger.focus();
        dialog = open();
        if (unavailable === "removed") {
            trigger.remove();
        } else {
            trigger[unavailable] = true;
        }
        dialog.destroy();
        await tick();
        assert.equal(document.activeElement, document.body);
    }

    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "Editor content";
    document.body.append(editor);
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.firstChild, 3);
    range.collapse(true);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    let callbacks = 0;
    dialog = open({destroyCallback: () => callbacks++});
    dialog.destroy();
    dialog.destroy();
    await tick();
    assert.equal(callbacks, 1);
    assert.equal(document.activeElement, editor);
    assert.equal(window.getSelection().anchorOffset, 3);
    assert.equal(window.siyuan.dialogs.length, 0);

    const errors = [];
    document.body.append(trigger);
    const onError = event => {
        errors.push(event.error);
        event.preventDefault();
    };
    window.addEventListener("error", onError);
    const drag = document.createElement("div");
    drag.id = "drag";
    document.body.append(drag);
    try {
        for (const replacement of [false, true]) {
            trigger.focus();
            drag.classList.add("fn__hidden");
            const error = new Error("Dialog cleanup failed");
            let next;
            let calls = 0;
            dialog = open({destroyCallback: () => {
                calls++;
                if (replacement) {
                    next = open();
                }
                throw error;
            }});
            dialog.destroy();
            dialog.destroy();
            await tick();
            assert.equal(errors.pop(), error);
            assert.equal(calls, 1);
            assert.equal(dialog.element.isConnected, false);
            assert.equal(window.siyuan.dialogs.includes(dialog), false);
            assert.equal(drag.classList.contains("fn__hidden"), false);
            assert.equal(document.activeElement, replacement ? next.element.querySelector("input") : trigger);
            assert.equal(window.siyuan.dialogs.length, replacement ? 1 : 0);
            next?.destroy();
            await tick();
        }
    } finally {
        window.removeEventListener("error", onError);
        drag.remove();
    }

    dialog = new Dialog({content: '<button id="first">First</button><input disabled><button hidden>Hidden</button><button id="last">Last</button>'});
    const container = dialog.element.querySelector(".b3-dialog__container");
    assert.equal(document.activeElement, container);
    const tab = (shiftKey = false) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Tab", shiftKey, bubbles: true, cancelable: true,
    }));
    tab();
    assert.equal(document.activeElement.id, "first");
    tab(true);
    assert.equal(document.activeElement.id, "last");
    tab();
    assert.equal(document.activeElement.id, "first");
    editor.focus();
    tab();
    assert.equal(document.activeElement.id, "first");
    for (const shift of [false, true]) {
        for (let i = 0; i < 6; i++) {
            await require("electron").ipcRenderer.invoke("dialog-test-tab", shift);
            assert.ok(container.contains(document.activeElement));
        }
    }
    assert.equal(editor.textContent, "Editor content");
    const empty = new Dialog({content: "No controls"});
    tab(true);
    assert.equal(document.activeElement, empty.element.querySelector(".b3-dialog__container"));
    empty.destroy();
    await tick();
    assert.equal(document.activeElement.id, "first");
    dialog.destroy();
    await tick();
};

const runPositionCases = async (dialogSource, positionSource, dialogCSS) => {
    const assert = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = dialogCSS;
    document.head.append(style);
    window.siyuan = {dialogs: [], zIndex: 1, menus: {menu: {element: document.createElement("div"), remove() {}}}};
    const modules = {
        "../util/genID": {genUUID: () => "position"},
        "../util/zIndex": {isAbove: () => false},
        "./moveResize": {moveResize() {}},
        "../util/functions": {isMobile: () => false},
        "../constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
        "../block/panelOwnership": {getDialogBlockPanel() {}, destroyDialogBlockPanels() {}},
        "../layout/getTopBarHeight": {getTopBarHeight: () => 0},
    };
    const load = source => {
        const exports = {};
        new Function("require", "exports", source)(name => modules[name] || {}, exports);
        return exports;
    };
    const {Dialog} = load(dialogSource);
    const {setPosition} = load(positionSource);
    try {
        for (const position of [
            {x: 80, y: 100},
            {x: window.innerWidth - 180, y: 100},
            {x: window.innerWidth - 180, y: window.innerHeight - 10},
        ]) {
            const dialog = new Dialog({content: "<input>", width: "368px", height: "50vh", disableAnimation: true});
            const container = dialog.element.querySelector(".b3-dialog__container");
            const panel = dialog.element.querySelector(".b3-dialog");
            panel.style.justifyContent = "inherit";
            panel.style.alignItems = "inherit";
            assert.equal(document.activeElement, container);
            assert.equal(container.getBoundingClientRect().width, container.offsetWidth);
            assert.equal(getComputedStyle(container).transform, "none");
            setPosition(container, position.x, position.y, 24, 24);
            await new Promise(resolve => setTimeout(resolve, 200));
            const rect = container.getBoundingClientRect();
            assert.equal(rect.width, container.offsetWidth);
            assert.ok(rect.left >= 0 && rect.right <= window.innerWidth, JSON.stringify(rect));
            assert.ok(rect.top >= 0 && rect.bottom <= window.innerHeight, JSON.stringify(rect));
            dialog.destroy();
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        const animated = new Dialog({content: "<input>", width: "368px"});
        const container = animated.element.querySelector(".b3-dialog__container");
        assert.ok(container.getBoundingClientRect().width < container.offsetWidth);
        assert.notEqual(getComputedStyle(container).transitionDuration, "0s");
        animated.destroy();
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(window.siyuan.dialogs.length, 0);
    } finally {
        style.remove();
    }
};

const runFlashcardCases = async (dialogSource, cardSource, mobile) => {
    const assert = require("node:assert/strict");
    const tick = () => new Promise(resolve => setTimeout(resolve, 20));
    let id = 0;
    const constants = {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0, DIALOG_OPENCARD: "card", LOCAL_DIALOGPOSITION: "positions"};
    window.siyuan = {
        dialogs: [], zIndex: 1, config: {}, storage: {positions: {}},
        mobile: mobile ? {popEditor: null} : undefined,
        menus: {menu: {element: document.createElement("div"), remove() {}}},
    };
    const modules = {
        "../util/genID": {genUUID: () => String(++id)},
        "../util/zIndex": {isAbove: () => false},
        "./moveResize": {moveResize() {}},
        "../util/functions": {isMobile: () => mobile},
        "../constants": {Constants: constants},
        "../block/panelOwnership": {getDialogBlockPanel() {}, destroyDialogBlockPanels() {}},
        "../protyle/util/selectionOffsets": {focusByRange: range => {
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
        }},
        "./util": {updateCardHV() {}},
    };
    const load = source => {
        const exports = {};
        new Function("require", "exports", source)(name => modules[name] || {}, exports);
        return exports;
    };
    modules["../dialog"] = load(dialogSource);
    const cards = load(cardSource);
    const app = {plugins: []};
    const data = {cards: []};
    const errors = [];
    const error = new Error("Flashcard editor cleanup failed");
    let destroyError = error;
    let destroyCount = 0;
    let replacement;
    cards.genCardHTML = () => '<div class="block__icons"><button class="block__icon">Review</button></div>';
    cards.bindCardEvent = async ({element}) => {
        element.setAttribute("data-key", constants.DIALOG_OPENCARD);
        const editor = {resize() {}, destroy() {
            destroyCount++;
            if (replacement) {
                window.siyuan.mobile.popEditor = replacement;
            }
            if (destroyError) {
                throw destroyError;
            }
        }};
        if (mobile) {
            window.siyuan.mobile.popEditor = editor;
        }
        return editor;
    };
    const onError = event => {
        errors.push(event.error);
        event.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
        await cards.openCardByData(app, data, "all");
        const first = window.siyuan.dialogs[0];
        first.destroy();
        first.destroy();
        await tick();
        assert.equal(errors.pop(), error);
        assert.equal(destroyCount, 1);
        assert.equal(first.element.isConnected, false);
        assert.equal(window.siyuan.dialogs.length, 0);
        if (mobile) {
            assert.equal(window.siyuan.mobile.popEditor, null);
        }

        destroyError = undefined;
        await cards.openCardByData(app, data, "all");
        const second = window.siyuan.dialogs[0];
        assert.notEqual(second, first);
        assert.equal(second.element.isConnected, true);
        await cards.openCardByData(app, data, "all", undefined, undefined, true);
        assert.equal(window.siyuan.dialogs[0], second);
        assert.equal(destroyCount, 1);
        if (mobile) {
            replacement = {};
        }
        await cards.openCardByData(app, data, "all");
        await tick();
        assert.equal(destroyCount, 2);
        assert.equal(window.siyuan.dialogs.length, 0);
        if (mobile) {
            assert.equal(window.siyuan.mobile.popEditor, replacement);
        }
        assert.equal(errors.length, 0);
    } finally {
        window.removeEventListener("error", onError);
    }
};

const runSearchCases = async (dialogSource, focusSource, searchSource, mobileSource) => {
    const assert = require("node:assert/strict");
    const tick = () => new Promise(resolve => setTimeout(resolve, 20));
    const constants = {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0, DIALOG_SEARCH: "search",
        LOCAL_SEARCHDATA: "search", LOCAL_DIALOGPOSITION: "positions"};
    window.siyuan = {dialogs: [], zIndex: 1, config: {}, storage: {search: {}, positions: {}},
        menus: {menu: {element: document.createElement("div"), remove() {}}}};
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    editor.contentEditable = "true";
    editor.textContent = "before after";
    const other = document.createElement("input");
    document.body.append(editor, other);
    const placeCaret = () => {
        editor.focus();
        getSelection().setBaseAndExtent(editor.firstChild, 7, editor.firstChild, 7);
    };
    let resolvePath;
    let rejectPath;
    let ios = true;
    let mobileOpened = false;
    window.webkit = {messageHandlers: {finishKeyboardComposition: {postMessage: async () => true}}};
    const modules = {
        "../util/genID": {genUUID: () => String(Math.random())},
        "../util/zIndex": {isAbove: () => false},
        "./moveResize": {moveResize() {}},
        "../util/functions": {isMobile: () => false},
        "../constants": {Constants: constants},
        "../block/panelOwnership": {getDialogBlockPanel() {}, destroyDialogBlockPanels() {}},
        "../protyle/util/compatibility": {isInIOS: () => ios, isDisabledFeature: () => false},
        "../protyle/util/selectionOffsets": {focusByRange: range => {
            getSelection().removeAllRanges();
            getSelection().addRange(range);
        }},
        "../util/fetch": {fetchSyncPost: () => new Promise((resolve, reject) => {
            resolvePath = resolve;
            rejectPath = reject;
        })},
        "../util/pathName": {getNotebookName: () => "Notebook", pathPosix: () => ({join: (...parts) => parts.join("/")})},
        "./config": {hasExplicitSearchScope: () => true, setSearchConfigTemporaryPath() {}},
        "./request": {cancelSearchRequest() {}},
        "./util": {genSearch: (_app, _config, element) => {
            element.innerHTML = '<input id="searchInput" value="previous query"><div id="searchList"></div>';
            return {edit: {destroy() {}}, unRefEdit: {destroy() {}}};
        }},
        "../boot/globalEvent/command/global": {globalCommand: () => false},
        "../boot/globalEvent/command/protyle": {onlyProtyleCommand: () => false},
        "../mobile/menu/search": {popSearch: (_app, config, focusInput) => {
            assert.equal(document.activeElement, editor);
            assert.equal(focusInput, true);
            assert.deepEqual(config.idPath, ["box//doc.sy"]);
            mobileOpened = true;
        }},
    };
    const load = source => {
        const exports = {};
        new Function("require", "exports", source)(name => modules[name] || {}, exports);
        return exports;
    };
    modules["../dialog"] = load(dialogSource);
    modules["./focus"] = modules["../search/focus"] = load(focusSource);
    const {openSearch} = load(searchSource);
    const mobile = load(mobileSource);
    const search = () => openSearch({app: {}, hotkey: "search", notebookId: "box", searchPath: "/doc.sy"});
    const mobileSearch = () => mobile.executeLegacyNativeCommand("search", {
        app: {}, source: "shortcut", focus: "editor", range: getSelection().getRangeAt(0),
        protyle: {notebookId: "box", path: "/doc.sy"},
    });
    for (const start of [search]) {
        for (const failure of ["invalid", "network", "changed-focus"]) {
            placeCaret();
            const pending = start();
            assert.equal(document.activeElement, editor);
            if (failure === "changed-focus") {
                other.focus();
            }
            if (failure === "network") {
                rejectPath(new Error("offline"));
                await assert.rejects(pending, /offline/);
            } else {
                resolvePath({code: -1, data: null});
                await pending;
            }
            assert.equal(document.activeElement, failure === "changed-focus" ? other : editor);
            if (failure !== "changed-focus") {
                assert.equal(getSelection().anchorOffset, 7);
            }
            assert.equal(editor.textContent, "before after");
        }
    }
    placeCaret();
    const pending = search();
    assert.equal(document.activeElement, editor);
    assert.equal(window.siyuan.dialogs.length, 0);
    // 异步期间原生选区可以变化，关闭搜索仍需恢复按键时的位置。
    getSelection().collapse(editor.firstChild, 0);
    resolvePath({code: 0, data: "/Document"});
    await pending;
    const dialog = window.siyuan.dialogs[0];
    assert.ok(dialog.element.contains(document.activeElement));
    dialog.destroy();
    await tick();
    assert.equal(document.activeElement, editor);
    assert.equal(getSelection().anchorOffset, 7);
    assert.equal(editor.textContent, "before after");

    // iOS 外接键盘必须在按键事件内接管焦点，不能等待路径名称接口。
    placeCaret();
    const keyboardPending = openSearch({app: {}, hotkey: "search", notebookId: "box",
        searchPath: "/doc.sy", focusInput: true});
    assert.equal(window.siyuan.dialogs.length, 1);
    const keyboardDialog = window.siyuan.dialogs[0];
    assert.equal(document.activeElement.id, "searchInput");
    assert.deepEqual(keyboardDialog.data.idPath, ["box//doc.sy"]);
    assert.equal(document.activeElement.selectionStart, 0);
    assert.equal(document.activeElement.selectionEnd, "previous query".length);
    const input = document.activeElement;
    const compositionCalls = [];
    window.webkit.messageHandlers.finishKeyboardComposition.postMessage = async data => {
        compositionCalls.push(data);
        if (data === "") {
            // WKWebView 结束原生会话会通知 blur，但仍保留网页 activeElement。
            input.dispatchEvent(new FocusEvent("blur"));
        }
        return true;
    };
    let inputs = 0;
    input.addEventListener("input", () => inputs++);
    input.value = "f";
    input.dispatchEvent(new InputEvent("input", {bubbles: true, isComposing: true}));
    assert.equal(inputs, 0);
    input.dispatchEvent(new KeyboardEvent("keyup", {key: "Meta"}));
    await tick();
    assert.equal(input.value, "previous query");
    assert.equal(document.activeElement, input);
    assert.deepEqual(compositionCalls, ["", "restore"]);
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "n"}));
    input.value = "new query";
    input.dispatchEvent(new InputEvent("input", {bubbles: true, isComposing: true}));
    assert.equal(input.value, "new query");
    assert.equal(inputs, 1);
    // 原生回调返回前用户继续输入时，不覆盖新输入，也不继续拦截组词事件。
    let finishComposition;
    window.webkit.messageHandlers.finishKeyboardComposition.postMessage = () => new Promise(resolve => {
        finishComposition = resolve;
    });
    modules["./focus"].focusSearchInput(input);
    input.value = "p";
    input.dispatchEvent(new InputEvent("input", {bubbles: true, isComposing: true}));
    input.dispatchEvent(new KeyboardEvent("keyup", {key: "Meta"}));
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "n"}));
    input.value = "newer query";
    input.dispatchEvent(new InputEvent("input", {bubbles: true, isComposing: true}));
    finishComposition(true);
    await tick();
    assert.equal(input.value, "newer query");
    assert.equal(inputs, 2);
    await keyboardPending;
    keyboardDialog.destroy();
    await tick();
    assert.equal(document.activeElement, editor);
    assert.equal(getSelection().anchorOffset, 7);

    placeCaret();
    const mobilePending = mobileSearch();
    assert.equal(document.activeElement, editor);
    await mobilePending;
    assert.equal(mobileOpened, true);

    ios = false;
    placeCaret();
    const desktopPending = search();
    assert.equal(document.activeElement, editor);
    resolvePath({code: -1, data: null});
    await desktopPending;
    assert.equal(document.activeElement, editor);
    editor.remove();
    other.remove();
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        let code = 0;
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            win.webContents.debugger.attach("1.3");
            await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
            ipcMain.handle("dialog-test-tab", async (_event, shift) => {
                for (const type of ["keyDown", "keyUp"]) {
                    await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
                        type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0,
                    });
                }
            });
            const ts = require("typescript");
            const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/dialog/index.ts"), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
            }).outputText;
            await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(source)})`);
            const positionSource = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/util/setPosition.ts"), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
            }).outputText;
            const dialogCSS = require("sass").compile(path.join(__dirname, "../src/assets/scss/component/_dialog.scss")).css;
            await win.webContents.executeJavaScript(
                `(${runPositionCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(positionSource)}, ${JSON.stringify(dialogCSS)})`);
            const {parse} = require("ifdef-loader/preprocessor");
            const compileSearch = (file, mobile = false) => ts.transpileModule(parse(
                fs.readFileSync(path.join(__dirname, "../src", file), "utf8"),
                {MOBILE: mobile, BROWSER: true}, false, true), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
            }).outputText;
            await win.webContents.executeJavaScript(`(${runSearchCases.toString()})(
                ${JSON.stringify(source)}, ${JSON.stringify(compileSearch("search/focus.ts"))},
                ${JSON.stringify(compileSearch("search/spread.ts"))},
                ${JSON.stringify(compileSearch("command/nativeRuntime.ts", true))})`);
            const cardSource = fs.readFileSync(path.join(__dirname, "../src/card/openCard.ts"), "utf8");
            for (const mobile of [false, true]) {
                const compiled = ts.transpileModule(parse(cardSource, {MOBILE: mobile, BROWSER: true}, false, true), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
                }).outputText;
                await win.webContents.executeJavaScript(
                    `(${runFlashcardCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(compiled)}, ${mobile})`);
            }
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("dialogs preserve positioning and focus, and flashcards reopen after cleanup failures on desktop and mobile", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-dialog-focus-"));
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
