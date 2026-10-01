const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");

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
    const renderMenu = find(workspace, node => ts.isVariableDeclaration(node) &&
        node.name.getText(workspace) === "renderMenu").initializer;
    const popupIndex = renderMenu.body.statements.findIndex(node =>
        node.getText(workspace).startsWith("window.siyuan.menus.menu.popup("));
    assert.ok(popupIndex >= 0);
    const menu = sourceFile("menus/Menu.ts");
    const declaration = name => find(menu, node => ts.isVariableDeclaration(node) &&
        node.name.getText(menu) === name).getText(menu);
    return {
        escape: compile(`function editorEscape(protyle, event, range, isCrossBlock, nodeElement) {
            const blockSelectionModeElement = undefined;
            ${escape.getText(keyboard)}
        }` + sourceFile("protyle/toolbar/subElementLifecycle.ts").text.replaceAll("export ", "")),
        card: compile(`const openCardByData = ${openCard.getText(card)};`),
        menu: compile(`function openWorkspaceMenu(openOnly) {
            const rect = {left: 0, bottom: 0, height: 0};
            ${renderMenu.body.statements.slice(popupIndex).map(node => node.getText(workspace)).join("\n")}
        }
        const ${declaration("getActionMenu")};
        const ${declaration("bindMenuKeydown")};`),
    };
};

const cases = async compiled => {
    const check = require("node:assert/strict");
    const Constants = {DIALOG_OPENCARD: "card"};
    const menu = document.createElement("div");
    menu.className = "fn__none";
    window.siyuan = {dialogs: [], menus: {menu: {element: menu}}, languages: {}};
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
    const setup = () => {
        document.body.innerHTML = '<div class="protyle-wysiwyg" tabindex="0"><div data-node-id="first"><div contenteditable="true">First text</div></div><div data-node-id="last"><div contenteditable="true">Last text</div></div></div>';
        const root = document.body.firstElementChild;
        const element = document.createElement("div");
        const subElement = document.createElement("div");
        const hint = document.createElement("div");
        return {wysiwyg: {element: root}, toolbar: {element, subElement}, hint: {element: hint}};
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
        root.addEventListener("keydown", event => editorEscape(protyle, event, range, crossBlock, first));
        const before = blockSelections;
        const event = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true});
        first.firstElementChild.dispatchEvent(event);
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
    const menuBindings = new Function("window", "Constants", compiled.menu +
        "\nreturn {openWorkspaceMenu, bindMenuKeydown};")(window, {KEYCODELIST: {38: "↑", 40: "↓"}});
    for (const openOnly of [true, false]) {
        const protyle = setup();
        const editor = protyle.wysiwyg.element.firstElementChild.firstElementChild;
        editor.focus();
        const menuElement = document.createElement("div");
        menuElement.className = "b3-menu fn__none";
        menuElement.innerHTML = '<div></div><div class="b3-menu__items"><button class="b3-menu__item" style="display: none">Hidden</button><button class="b3-menu__item b3-menu__item--readonly">Readonly</button><button class="b3-menu__item" disabled>Disabled</button><button class="b3-menu__item" id="firstAction">First</button><button class="b3-menu__item" id="nextAction">Next</button></div>';
        document.body.append(menuElement);
        const menu = {element: menuElement, popup: () => menuElement.classList.remove("fn__none"),
            remove() {this.removeCB?.(); this.removeCB = undefined; menuElement.classList.add("fn__none");}};
        window.siyuan.menus.menu = menu;
        let editorArrows = 0;
        editor.addEventListener("keydown", event => {
            if (event.key.startsWith("Arrow")) {
                editorArrows++;
                event.stopPropagation();
            }
        });
        const listener = event => {
            if (menuBindings.bindMenuKeydown(event)) {
                event.preventDefault();
            } else if (event.key === "Escape") {
                menu.remove();
                event.preventDefault();
            }
        };
        document.body.addEventListener("keydown", listener);
        try {
            menuBindings.openWorkspaceMenu(openOnly);
            check.equal(document.activeElement, openOnly ? menuElement.querySelector("#firstAction") : editor);
            document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {
                key: "ArrowDown", keyCode: 40, bubbles: true, cancelable: true,
            }));
            check.equal(editorArrows, openOnly ? 0 : 1);
            if (openOnly) {
                check.equal(menuElement.querySelector(".b3-menu__item--current").id, "nextAction");
                document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {
                    key: "Escape", bubbles: true, cancelable: true,
                }));
                check.equal(menuElement.classList.contains("fn__none"), true);
                check.equal(document.activeElement, editor);
                menuBindings.openWorkspaceMenu(true);
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
