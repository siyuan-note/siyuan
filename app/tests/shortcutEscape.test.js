const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");
const {parse} = require("ifdef-loader/preprocessor");

const sourceFile = file => ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
    ts.ScriptTarget.Latest, true);
const find = (source, predicate) => {
    let result;
    const visit = node => {
        if (!result && predicate(node)) {
            result = node;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(result);
    return result;
};
const sources = () => {
    const keyboard = sourceFile("protyle/wysiwyg/keydown.ts");
    const escape = find(keyboard, node => ts.isIfStatement(node) &&
        node.expression.getText(keyboard) === 'event.key === "Escape"');
    const card = sourceFile("card/openCard.ts");
    const openCard = find(card, node => ts.isVariableDeclaration(node) &&
        node.name.getText(card) === "openCardByData").initializer;
    const compile = text => ts.transpileModule(text, {compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    }}).outputText;
    const workspace = sourceFile("menus/workspace.ts");
    const workspaceMenu = find(workspace, node => ts.isVariableDeclaration(node) &&
        node.name.getText(workspace) === "workspaceMenu").initializer;
    const renderMenu = find(workspace, node => ts.isVariableDeclaration(node) &&
        node.name.getText(workspace) === "renderMenu").initializer;
    const popupIndex = renderMenu.body.statements.findIndex(node =>
        node.getText(workspace).startsWith("window.siyuan.menus.menu.popup("));
    assert.ok(popupIndex >= 0);
    const menu = sourceFile("menus/Menu.ts");
    const declaration = name => find(menu, node => ts.isVariableDeclaration(node) &&
        node.name.getText(menu) === name).getText(menu);
    return {
        editor: compile(parse(keyboard.text, {MOBILE: false, BROWSER: true}, false, true)),
        hide: compile(sourceFile("protyle/ui/hideElements.ts").text),
        lifecycle: compile(sourceFile("protyle/toolbar/subElementLifecycle.ts").text),
        globalKeyboard: compile(parse(sourceFile("boot/globalEvent/keydown.ts").text,
            {MOBILE: false, BROWSER: true}, false, true)),
        keymap: compile(sourceFile("util/keymapBindings.ts").text),
        hotkey: compile(sourceFile("protyle/util/hotKey.ts").text),
        escape: compile(`function editorEscape(protyle, event, range, isCrossBlock, nodeElement) {
            const blockSelectionModeElement = undefined;
            ${escape.getText(keyboard)}
        }` + sourceFile("protyle/toolbar/subElementLifecycle.ts").text.replaceAll("export ", "")),
        card: compile(`const openCardByData = ${openCard.getText(card)};`),
        menu: compile(`async function workspaceMenu(app, rect, openOnly = false) {
            ${workspaceMenu.body.statements[0].getText(workspace)}
            ${renderMenu.body.statements.slice(popupIndex).map(node => node.getText(workspace)).join("\n")}
        }
        const ${declaration("getActionMenu")};
        const ${declaration("bindMenuKeydown")};`),
    };
};

const cases = async compiled => {
    const check = require("node:assert/strict");
    const Constants = {DIALOG_OPENCARD: "card", KEYCODELIST: {27: "Esc"}};
    const menu = document.createElement("div");
    menu.className = "fn__none";
    const keys = new Proxy({}, {get: () => ({})});
    window.siyuan = {dialogs: [], menus: {menu: {element: menu}}, languages: {},
        config: {keymap: {general: keys, editor: {general: keys, insert: keys, heading: keys, list: keys, table: keys}}}};
    let blockSelections = 0;
    const hideElements = (panels, protyle) => {
        for (const name of ["toolbar", "hint", "util"]) {
            if (panels.includes(name)) {
                (name === "util" ? protyle.toolbar.subElement : protyle[name].element).classList.add("fn__none");
            }
        }
        if (panels.includes("select")) {
            protyle.wysiwyg.element.querySelectorAll(".selected-block").forEach(item => item.classList.remove("selected-block"));
        }
    };
    const editorEscape = new Function("hideElements", "formatPainter", "hasClosestByClassName",
        "setBlockSelectionModeElement", "selectBlocksByRange", "clearBlockSelectionMode", "countBlockWord",
        "BLOCK_SELECTION_CLASS", compiled.escape + "\nreturn editorEscape;")(hideElements, {deactivate: () => false},
        (node, name) => (node.nodeType === 1 ? node : node.parentElement).closest(`.${name}`),
        (root, block) => {block.classList.add("selected-block"); root.focus(); blockSelections++;},
        () => blockSelections++, () => {}, () => {}, "selected-block");
    const load = (text, imports) => {
        const exports = {};
        new Function("require", "exports", text)(name =>
            new Proxy(imports[name] || {}, {get: (target, key) => target[key] || (() => false)}), exports);
        return exports;
    };
    const lifecycle = load(compiled.lifecycle, {});
    const selectionMode = {clearBlockSelectionMode: root => {
        root.querySelectorAll(".selected-block").forEach(item => item.classList.remove("selected-block"));
    }};
    const actualHide = load(compiled.hide, {"../toolbar/subElementLifecycle": lifecycle,
        "../wysiwyg/blockSelection": selectionMode});
    const fullEditor = load(compiled.editor, {"../ui/hideElements": actualHide,
        "../toolbar/subElementLifecycle": lifecycle,
        "../util/hasClosest": {hasClosestBlock: node => (node.nodeType === 1 ? node : node.parentElement).closest("[data-node-id]"),
            hasClosestByAttribute: () => false},
        "../util/selection": {getEditorRange: () => getSelection().getRangeAt(0)},
        "../../constants": {Constants},
        "./blockSelection": {getBlockSelectionModeElement: () => undefined},
        "../toolbar/FormatPainter": {formatPainter: {deactivate: () => false}},
    });
    const setup = () => {
        document.body.innerHTML = '<div class="protyle-wysiwyg" tabindex="0"><div data-node-id="first"><div contenteditable="true">First text</div></div><div data-node-id="last"><div contenteditable="true">Last text</div></div></div>';
        const root = document.body.firstElementChild;
        const element = document.createElement("div");
        const subElement = document.createElement("div");
        const hint = document.createElement("div");
        const selectElement = document.createElement("div");
        selectElement.classList.add("fn__none");
        return {element: root, selectElement, wysiwyg: {element: root},
            toolbar: {element, subElement, isMultiSelectMode: () => false},
            hint: {element: hint, deactivateEmojiPanel() {}}};
    };
    // 行内外观先独立关闭，跨块文本选区和工具栏保持不变。
    for (const crossBlock of [false, true]) {
        const protyle = setup();
        const root = protyle.wysiwyg.element;
        const first = root.firstElementChild;
        const range = document.createRange();
        range.setStart(first.firstElementChild.firstChild, 0);
        range.setEnd((crossBlock ? root.lastElementChild : first).firstElementChild.firstChild, 4);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        const selected = getSelection().toString();
        let cleaned = 0;
        protyle.toolbar.subElement.dataset.subElementSource = "selection-toolbar";
        protyle.toolbar.subElementCloseCB = () => cleaned++;
        protyle.hint.element.classList.add("fn__none");
        const pending = [];
        const addEventListener = root.addEventListener.bind(root);
        root.addEventListener = (name, listener, options) => addEventListener(name,
            event => pending.push(listener(event)), options);
        fullEditor.keydown(protyle, root);
        root.addEventListener = addEventListener;
        const before = blockSelections;
        const event = new KeyboardEvent("keydown", {key: "Escape", code: "Escape", bubbles: true, cancelable: true});
        first.firstElementChild.dispatchEvent(event);
        await Promise.all(pending);
        check.equal(event.defaultPrevented, true);
        check.equal(protyle.toolbar.subElement.classList.contains("fn__none"), true);
        check.equal(protyle.toolbar.element.classList.contains("fn__none"), false);
        check.equal(getSelection().toString(), selected);
        check.equal(blockSelections, before);
        check.equal(cleaned, 1);
        check.equal(protyle.toolbar.subElement.dataset.subElementSource, undefined);
    }
    // 使用复习弹窗的实际打开函数，验证捕获阶段不会抢走正文的 Esc。
    for (const mobile of [false, true]) {
        const protyle = setup();
        for (const element of [protyle.toolbar.element, protyle.toolbar.subElement, protyle.hint.element]) {
            element.classList.add("fn__none");
        }
        const root = protyle.wysiwyg.element;
        const first = root.firstElementChild;
        const editor = {protyle, resize() {}, destroy() {}};
        class Dialog {
            constructor() {
                this.element = document.createElement("div");
                this.element.dataset.key = "card";
                this.element.innerHTML = '<div class="b3-dialog__scrim"></div><div class="b3-dialog__container"><div class="card__main"><div class="block__icons card__action"><button class="block__icon">Review</button></div></div></div>';
                this.element.querySelector(".card__main").append(root);
                document.body.append(this.element);
                window.siyuan.dialogs.push(this);
                this.destroyed = false;
            }
            destroy() {this.destroyed = true;}
        }
        const focusByRange = range => {getSelection().removeAllRanges(); getSelection().addRange(range);};
        const openCard = new Function("window", "Dialog", "Constants", "genCardHTML", "isMobile", "bindCardEvent",
            "focusByRange", "updateCardHV", compiled.card + "\nreturn openCardByData;")(
            window, Dialog, Constants, () => "", () => mobile, async () => editor, focusByRange, () => {});
        window.siyuan.dialogs = [];
        await openCard({plugins: []}, {}, "all");
        const dialog = window.siyuan.dialogs[0];
        const range = document.createRange();
        range.selectNodeContents(first.firstElementChild);
        range.collapse();
        focusByRange(range);
        first.firstElementChild.focus();
        root.addEventListener("keydown", event => editorEscape(protyle, event, range, false, first));
        const before = blockSelections;
        first.firstElementChild.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        check.equal(dialog.destroyed, false);
        check.equal(blockSelections, before + 1);
        check.equal(first.classList.contains("selected-block"), true);
        root.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", repeat: true, bubbles: true, cancelable: true}));
        check.equal(dialog.destroyed, false);
        check.equal(document.activeElement, dialog.element.querySelector(".card__action button"));
        check.equal(first.classList.contains("selected-block"), false);
    }
    // 快捷键将焦点移到可操作菜单项，方向键不再被编辑器截获。
    const menuConstants = {MENU_BAR_WORKSPACE: "workspace", KEYCODELIST: {38: "↑", 40: "↓", 220: "\\"}};
    const menuBindings = new Function("window", "Constants", compiled.menu +
        "\nreturn {workspaceMenu, bindMenuKeydown};")(window, menuConstants);
    const keymap = load(compiled.keymap, {});
    const hotkey = load(compiled.hotkey, {"../../util/keymapBindings": keymap, "../../constants": {Constants: menuConstants},
        "./compatibility": {isNotCtrl: event => !event.ctrlKey && !event.metaKey, isMac: () => false,
            isOnlyMeta: event => event.ctrlKey && !event.metaKey}});
    const globalKeyboard = load(compiled.globalKeyboard, {"../../menus/Menu": menuBindings,
        "../../menus/workspace": menuBindings, "../../protyle/util/hotKey": hotkey,
        "../../constants": {Constants: menuConstants},
        "../../util/keymapBindings": {getKeymapBindings: () => []},
        "../../layout/getAll": {getAllEditor: () => [], getAllDocks: () => []},
    });
    for (const openOnly of [true, false]) {
        const protyle = setup();
        const editor = protyle.wysiwyg.element.firstElementChild.firstElementChild;
        editor.focus();
        const menuElement = document.createElement("div");
        const bar = document.createElement("button");
        bar.id = "barWorkspace";
        document.body.append(bar);
        menuElement.className = "b3-menu fn__none";
        menuElement.innerHTML = '<div></div><div class="b3-menu__items"><button class="b3-menu__item" style="display: none">Hidden</button><button class="b3-menu__item b3-menu__item--readonly">Readonly</button><button class="b3-menu__item" disabled>Disabled</button><button class="b3-menu__item" id="firstAction">First</button><button class="b3-menu__item" id="nextAction">Next</button></div>';
        document.body.append(menuElement);
        let opens = 0;
        const menu = {element: menuElement, popup: () => {
            opens++;
            menuElement.setAttribute("data-name", "workspace");
            menuElement.classList.remove("fn__none");
        },
            remove() {this.removeCB?.(); this.removeCB = undefined; menuElement.classList.add("fn__none");}};
        window.siyuan.menus.menu = menu;
        window.siyuan.config.keymap.general = {...window.siyuan.config.keymap.general, mainMenu: {custom: "⌥\\"}};
        let editorArrows = 0;
        editor.addEventListener("keydown", event => {
            if (event.key.startsWith("Arrow")) {
                editorArrows++;
                event.stopPropagation();
            }
        });
        const listener = event => {
            if (event.altKey) {
                globalKeyboard.windowKeyDown({}, event);
            } else if (menuBindings.bindMenuKeydown(event)) {
                event.preventDefault();
            } else if (event.key === "Escape") {
                menu.remove();
                event.preventDefault();
            }
        };
        document.body.addEventListener("keydown", listener);
        try {
            if (openOnly) {
                const event = new KeyboardEvent("keydown", {key: "\\", code: "Backslash", keyCode: 220,
                    altKey: true, bubbles: true, cancelable: true});
                editor.dispatchEvent(event);
                check.equal(event.defaultPrevented, true);
            } else {
                await menuBindings.workspaceMenu({}, {}, false);
            }
            check.equal(document.activeElement, openOnly ? menuElement.querySelector("#firstAction") : editor);
            document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {
                key: "ArrowDown", keyCode: 40, bubbles: true, cancelable: true,
            }));
            check.equal(editorArrows, openOnly ? 0 : 1);
            if (openOnly) {
                document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "\\", code: "Backslash", keyCode: 220,
                    altKey: true, repeat: true, bubbles: true, cancelable: true}));
                check.equal(opens, 1);
                check.equal(menuElement.classList.contains("fn__none"), false);
                check.equal(menuElement.querySelector(".b3-menu__item--current").id, "nextAction");
                document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {
                    key: "Escape", bubbles: true, cancelable: true,
                }));
                check.equal(menuElement.classList.contains("fn__none"), true);
                check.equal(document.activeElement, editor);
                await menuBindings.workspaceMenu({}, {}, true);
                const newFocus = document.createElement("button");
                document.body.append(newFocus);
                newFocus.focus();
                menu.remove();
                check.equal(document.activeElement, newFocus);
            }
        } finally {
            document.body.removeEventListener("keydown", listener);
        }
    }
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow} = require("electron");
        app.setPath("userData", process.argv[2]);
        await app.whenReady();
        const win = new BrowserWindow({show: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, backgroundThrottling: false,
        }});
        let result = 0;
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(sources())})`);
            console.log("Shortcut Escape and menu focus cases passed");
        } catch (error) {
            console.error(error);
            result = 1;
        } finally {
            win.destroy();
            app.exit(result);
        }
    })();
} else {
    require("node:test").test("shortcut menu focus and Escape preserve editor behavior", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 35000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-shortcut-escape-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 30000});
            assert.match(stdout, /Shortcut Escape and menu focus cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-shortcut-escape-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
