const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const rendererSource = () => {
    const ts = require("typescript");
    const extract = (file, names) => {
        const source = ts.createSourceFile(file,
            readFileSync(path.join(__dirname, "../src/protyle", `${file}.ts`), "utf8"),
            ts.ScriptTarget.Latest, true);
        const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
        assert.equal(statements.length, names.length, file);
        return statements.map(statement => statement.getText(source)).join("\n");
    };
    const extractClick = (file, condition, call = "toggleListFold(") => {
        const source = ts.createSourceFile(file,
            readFileSync(path.join(__dirname, "../src/protyle", `${file}.ts`), "utf8"),
            ts.ScriptTarget.Latest, true);
        const matches = [];
        const visit = node => {
            if (ts.isIfStatement(node) && condition(node.expression.getText(source)) &&
                node.thenStatement.getText(source).includes(call)) {
                matches.push(node.thenStatement.getText(source));
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        assert.equal(matches.length, 1, file);
        return matches[0];
    };
    const editorSource = readFileSync(path.join(__dirname, "../src/protyle/wysiwyg/index.ts"), "utf8");
    const foldStart = editorSource.indexOf('            const actionElement = hasClosestByClassName(event.target, "protyle-action");');
    const foldEnd = editorSource.indexOf("            const range = getEditorRange(this.element);", foldStart);
    assert.ok(foldStart >= 0 && foldEnd > foldStart);
    const foldClick = editorSource.slice(foldStart, foldEnd);
    const embedStart = editorSource.indexOf('            const embedItemElement = hasClosestByClassName(event.target, "protyle-wysiwyg__embed");');
    const embedEnd = editorSource.indexOf("            if (commonClick(event, protyle))", embedStart);
    assert.ok(embedStart >= 0 && embedEnd > embedStart);
    const embedClick = editorSource.slice(embedStart, embedEnd)
        .replace(/\/\/\/ #if MOBILE[\s\S]*?\/\/\/ #else/g, "");
    // 使用实际删除、折叠和选区代码，只替代网络提交及无关的渲染副作用。
    const source = `
        const Constants = {ZWSP: "\\u200b", ATTRIBUTE_EDITING: "data-editing"};
        const isMobile = () => false, isHiddenTabContent = () => false;
        const getEmbedChildOperationContext = () => undefined;
        const getEmbedChildOperationParentID = () => undefined;
        const confirmRefRemoval = async () => true;
        const preventScroll = () => {}, mathRender = () => {}, scrollCenter = () => {};
        const hideElements = () => {};
        const lineNumberRender = () => {}, clearSelect = () => {}, revealTabsForTarget = () => {};
        const getTextWithoutSemanticMarkers = element => element.textContent;
        const getSemanticMarkerPrefixLengthForNode = () => 0;
        const hasViewFoldContext = protyle => !!protyle.viewFold;
        const setViewFold = (protyle, element, folded) => {
            protyle.viewChanges.push({id: element.getAttribute("data-node-id"), folded});
            if (folded) { element.setAttribute("fold", "1"); } else { element.removeAttribute("fold"); }
        };
        const transaction = (protyle, doOperations, undoOperations) => {
            protyle.transactions.push({doOperations, undoOperations});
        };
    ` + extract("util/hasClosest", ["hasClosestBlock", "hasClosestByClassName", "isInEmbedBlock",
        "hasTopClosestByAttribute", "hasClosestByAttribute", "isBlockElement"]) +
        extract("wysiwyg/getBlock", ["getParentBlock", "getPreviousBlock", "getPreviousBlockSibling",
            "getNextBlockSibling", "getLastBlock", "getContenteditableElement", "isContainerBlock",
            "isNotEditBlock", "getTopEmptyElement", "hasPreviousSibling"]) +
        extract("util/selection", ["focusByRange", "focusByWbr"]) +
        extract("wysiwyg/verticalVisibility", ["getFoldedNavigationOwner"]) +
        extract("wysiwyg/remove", ["getOperationParentID", "removeBlock"]) +
        extract("util/blockFold", ["applyFoldState", "toggleListFold"]) + `
        ${extract("wysiwyg/transaction", ["canSyncListFoldInPlace", "syncBlockAttrs"])}
        export const syncEmbeddedAttrs = (protyle, operation) => {
            const pendingEmbedElements = new Set();
            ${extractClick("wysiwyg/transaction", condition => condition === 'operation.action === "setAttrs"', "pendingEmbedElements.add(item)")}
            return pendingEmbedElements;
        };
        ${extract("wysiwyg/listContext", ["isListItemActionElement", "shouldFoldEmbeddedListByAlt"])}
        export const embeddedMouseDown = (protyle, event) => {
            const target = event.target;
            if (shouldFoldEmbeddedListByAlt(event, protyle.disabled, hasClosestByClassName(target, "protyle-action")))
                ${extractClick("wysiwyg/index", condition => condition.includes("shouldFoldEmbeddedListByAlt") && condition.includes("hasClosestByClassName(target"), "event.preventDefault()")}
        };
        export const clickGutter = (protyle, foldElement, buttonElement) => ${extractClick("gutter/index",
        condition => condition.includes('buttonElement.getAttribute("data-type") === "NodeListItem"'))};
        export const clickArrow = (protyle, foldElement, buttonElement) => ${extractClick("gutter/index",
        condition => condition === "event.altKey", 'toggleListFold(protyle, foldElement, "children")')};
        export const clickDot = (protyle, actionElement) => ${extractClick("wysiwyg/index",
        condition => condition === "event.altKey && !protyle.disabled")};
        export const clickEmbed = (protyle, event) => {
            const ctrlIsPressed = event.ctrlKey || event.metaKey;
            const checkFold = (id, callback) => callback(false, []);
            const openFileById = options => protyle.opened.push(options);
            ${foldClick}
            protyle.rangeReads = (protyle.rangeReads || 0) + 1;
            ${embedClick}
            if (event.altKey && !protyle.disabled && actionElement && actionElement.parentElement.classList.contains("li")) {
                clickDot(protyle, actionElement);
            }
        };
    `;
    return ts.transpileModule(source, {compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    }}).outputText;
};

const runCases = async () => {
    const assert = require("node:assert/strict");
    const {removeBlock, toggleListFold, clickGutter, clickArrow, clickDot, clickEmbed, embeddedMouseDown, syncEmbeddedAttrs,
        focusByRange, getContenteditableElement} = window.listFoldRemoval;
    const ids = new Map();
    const nodeID = name => {
        if (!ids.has(name)) {
            ids.set(name, `20260909000000-${ids.size.toString(36).padStart(7, "0")}`);
        }
        return ids.get(name);
    };
    const attr = '<div class="protyle-attr" contenteditable="false"></div>';
    const paragraph = (id, text) => `<div class="p" data-type="NodeParagraph" data-node-id="${nodeID(id)}"><div contenteditable="true">${text}</div>${attr}</div>`;
    const item = (id, text, children = "", folded = false) =>
        `<div class="li" data-type="NodeListItem" data-node-id="${nodeID(id)}"${folded ? ' fold="1"' : ""}><div class="protyle-action" contenteditable="false">•</div>${paragraph(`${id}-text`, text)}${children}${attr}</div>`;
    const list = (id, children) => `<div class="list" data-type="NodeList" data-node-id="${nodeID(id)}">${children}${attr}</div>`;
    const setup = (html, viewFold = false) => {
        document.body.innerHTML = `<style>
            .li { margin-left: 20px; }
            .li[fold="1"] > div:nth-child(3):not(.protyle-attr),
            .li[fold="1"] > div:nth-child(3) ~ div:not(.protyle-attr) { display: none; }
            .protyle-action { float: left; }
        </style><div class="protyle-wysiwyg" contenteditable="true">${html}</div>`;
        const element = document.querySelector(".protyle-wysiwyg");
        const protyle = {wysiwyg: {element}, contentElement: element, scroll: {},
            block: {parentID: "document"}, transactions: [], viewFold, viewChanges: [],
            lute: window.Lute.New()};
        protyle.lute.SetKramdownIAL(true);
        return {element, protyle};
    };
    const byID = id => document.querySelector(`[data-node-id="${ids.get(id) || id}"]`);
    const applyOperations = operations => operations.forEach(operation => {
        assert.equal(operation.action, "setAttrs", "folding must never replace list content");
        const attrs = JSON.parse(operation.data);
        assert.deepEqual(Object.keys(attrs), ["fold"]);
        Object.entries(attrs).forEach(([name, value]) => {
            if (value) { byID(operation.id).setAttribute(name, value); } else { byID(operation.id).removeAttribute(name); }
        });
    });
    let cases = 0;
    for (const trailing of [false, true]) {
        for (const outerFolded of [false, true]) {
            const hidden = list("third", item("third-1", "child one") + item("third-2", "child two"));
            const nested = list("second", item("second-1", "second one") + item("second-3", "second three", hidden, true));
            const {element, protyle} = setup(list("top", item("first", "first one", nested, outerFolded)) +
                paragraph("empty", "") + (trailing ? paragraph("after", "following block") : ""));
            const subtree = byID("third").outerHTML;
            const empty = byID("empty");
            const range = document.createRange();
            range.selectNodeContents(getContenteditableElement(empty));
            range.collapse(true);
            focusByRange(range);
            await removeBlock(protyle, empty, range, "Backspace");
            const expectedID = outerFolded ? "first-text" : "second-3-text";
            assert.ok(byID(expectedID), element.outerHTML);
            assert.ok(byID(expectedID).contains(getSelection().anchorNode), "caret must stay in the visible folded summary");
            assert.ok(getContenteditableElement(byID(expectedID)).getBoundingClientRect().height > 0);
            assert.equal(byID("empty"), null);
            assert.equal(byID("third").outerHTML, subtree, "removing the following paragraph must not edit hidden children");
            assert.deepEqual(protyle.transactions[0].doOperations.map(operation => [operation.action, operation.id]),
                [["delete", nodeID("empty")], ["update", nodeID(expectedID)]]);
            await require("electron").ipcRenderer.invoke("list-fold-backspace");
            assert.equal(byID("third").outerHTML, subtree, "continued native Backspace must preserve hidden children");
            assert.ok(byID(expectedID).contains(getSelection().anchorNode));
            if (!outerFolded) {
                toggleListFold(protyle, byID("second"));
                assert.equal(byID("second-3").hasAttribute("fold"), false);
                assert.equal(byID("third").outerHTML, subtree);
                const foldTransaction = protyle.transactions[1];
                assert.deepEqual(foldTransaction.doOperations.map(operation => operation.id), [nodeID("second-3")]);
                applyOperations(foldTransaction.undoOperations);
                assert.equal(byID("second-3").getAttribute("fold"), "1");
                applyOperations(foldTransaction.doOperations);
                assert.equal(byID("third").outerHTML, subtree);
            }
            assert.equal(element.querySelectorAll("wbr").length, 0);
            cases++;
        }
    }
    for (const entry of ["gutter", "dot", "arrow"]) {
        for (const viewFold of [false, true]) {
            const mixed = list("mixed",
                item("leaf", "leaf") + item("expanded", "expanded", paragraph("expanded-child", "child")) +
                item("folded", "folded", paragraph("folded-child", "child"), true) +
                item("missing", "missing children", "", true));
            const {protyle} = setup(entry === "arrow" ? list("outer", item("parent", "parent", mixed +
                list("extra", item("extra-folded", "extra", paragraph("extra-child", "child"), true)))) : mixed, viewFold);
            const gutter = document.createElement("div");
            gutter.innerHTML = '<button></button><button data-type="fold"><svg></svg></button>';
            const button = gutter.firstElementChild;
            const toggle = () => {
                if (entry === "gutter") {
                    clickGutter(protyle, byID("expanded"), button);
                    assert.equal(gutter.querySelector("svg").style.transform,
                        byID("expanded").getAttribute("fold") === "1" ? "" : "rotate(90deg)");
                } else if (entry === "dot") {
                    clickDot(protyle, byID("expanded").firstElementChild);
                } else {
                    clickArrow(protyle, byID("parent"), button);
                    assert.equal(byID("parent").hasAttribute("fold"), false);
                }
            };
            toggle();
            assert.equal(byID("leaf").hasAttribute("fold"), false);
            assert.equal(byID("expanded").getAttribute("fold"), "1");
            assert.equal(byID("folded").getAttribute("fold"), "1");
            if (!viewFold) {
                assert.equal(protyle.transactions.length, 1, "batch folding must be one undo step");
                assert.deepEqual(protyle.transactions[0].doOperations.map(operation => operation.id), [nodeID("expanded")]);
                applyOperations(protyle.transactions[0].undoOperations);
                assert.equal(byID("expanded").hasAttribute("fold"), false);
                assert.equal(byID("folded").getAttribute("fold"), "1", "undo must restore mixed fold states");
                applyOperations(protyle.transactions[0].doOperations);
            }
            toggle();
            assert.equal(byID("mixed").querySelectorAll('[fold="1"]').length, 0);
            if (viewFold) {
                assert.equal(protyle.transactions.length, 0, "view folding must not write document data");
                assert.deepEqual(protyle.viewChanges.map(change => change.id),
                    ["expanded", "folded", ...(entry === "arrow" ? ["extra-folded"] : []),
                        "leaf", "expanded", "folded", "missing", ...(entry === "arrow" ? ["extra-folded"] : [])].map(nodeID));
            } else {
                const unfolded = protyle.transactions[1];
                assert.deepEqual(unfolded.doOperations.map(operation => operation.id),
                    ["expanded", "folded", "missing", ...(entry === "arrow" ? ["extra-folded"] : [])].map(nodeID));
                applyOperations(unfolded.undoOperations);
                assert.equal(byID("missing").getAttribute("fold"), "1");
                applyOperations(unfolded.doOperations);
                assert.equal(byID("missing").hasAttribute("fold"), false);
            }
            cases++;
        }
    }
    for (const marker of ["bullet", "number", "task"]) {
        const embeddedList = list("embedded-list", item("embedded-leaf", "leaf") +
            item("embedded-parent", "parent", list("embedded-children", item("embedded-child", "child"))));
        const {protyle} = setup(list("source-list", item("source-parent", "source", paragraph("source-child", "child"))) +
            `<div data-type="NodeBlockQueryEmbed" data-node-id="${nodeID("embed")}">
                <div class="protyle-wysiwyg__embed" data-id="${nodeID("embedded-list")}">${embeddedList}${paragraph("embedded-after", "after")}</div>
                <div class="protyle-wysiwyg__embed" data-id="${nodeID("other-result")}">
                    ${list("other-result", item("other-parent", "other", paragraph("other-child", "child")))}
                </div>
            </div>`);
        protyle.opened = [];
        protyle.gutter = {element: document.createElement("div")};
        const action = byID("embedded-leaf").firstElementChild;
        action.innerHTML = "<span>marker</span>";
        if (marker === "task") {
            action.classList.add("protyle-action--task");
        }
        byID("embedded-list").setAttribute("data-subtype", marker === "number" ? "o" : marker === "task" ? "t" : "u");
        const click = (target, modifiers = {}) => clickEmbed(protyle, {
            target, button: 0, altKey: true, shiftKey: false, ctrlKey: false, metaKey: false,
            stopPropagation() {}, preventDefault() {}, ...modifiers,
        });
        const caret = byID("embedded-after").querySelector('[contenteditable="true"]').firstChild;
        getSelection().collapse(caret, 2);
        const mouseDown = new MouseEvent("mousedown", {button: 0, altKey: true, bubbles: true, cancelable: true});
        action.addEventListener("mousedown", event => embeddedMouseDown(protyle, event), {once: true});
        action.firstElementChild.dispatchEvent(mouseDown);
        assert.equal(mouseDown.defaultPrevented, true, "folding must suppress native caret placement");
        click(action.firstElementChild);
        assert.equal(getSelection().anchorNode, caret);
        assert.equal(getSelection().anchorOffset, 2);
        assert.equal(protyle.rangeReads || 0, 0, "folding must run before editor range fallback");
        assert.equal(protyle.opened.length, 0, "Alt-clicking embedded markers must not open a split");
        assert.equal(byID("embedded-parent").getAttribute("fold"), "1");
        assert.equal(byID("embedded-leaf").hasAttribute("fold"), false);
        assert.equal(byID("source-parent").hasAttribute("fold"), false);
        assert.equal(byID("other-parent").hasAttribute("fold"), false);
        assert.deepEqual(protyle.transactions[0].doOperations.map(operation => operation.id), [nodeID("embedded-parent")]);
        const listBeforeSync = byID("embedded-list");
        for (const operations of [protyle.transactions[0].doOperations,
            protyle.transactions[0].undoOperations, protyle.transactions[0].doOperations]) {
            operations.forEach(operation => {
                assert.equal(syncEmbeddedAttrs(protyle, operation).size, 0,
                    "list folding must not schedule a full embed reload after the transaction");
            });
            assert.equal(byID("embedded-list"), listBeforeSync);
            assert.equal(getSelection().anchorNode, caret);
            assert.equal(getSelection().anchorOffset, 2);
        }
        assert.equal(syncEmbeddedAttrs(protyle, {
            action: "setAttrs", id: nodeID("embedded-parent"), data: JSON.stringify({fold: "1", name: "named"}),
        }).size, 1, "other attributes must retain embed refresh behavior");
        assert.equal(syncEmbeddedAttrs(protyle, {
            action: "setAttrs", id: nodeID("embedded-leaf"), data: JSON.stringify({fold: ""}),
        }).size, 1, "expanding fragments without loaded children must still query their content");
        applyOperations(protyle.transactions[0].undoOperations);
        assert.equal(byID("embedded-parent").hasAttribute("fold"), false);
        applyOperations(protyle.transactions[0].doOperations);
        click(action);
        assert.equal(byID("embedded-parent").hasAttribute("fold"), false);
        getSelection().removeAllRanges();
        click(action);
        assert.equal(getSelection().rangeCount, 0, "folding without a caret must not focus the document start");
        assert.equal(protyle.rangeReads || 0, 0);
        const count = protyle.transactions.length;
        const embedResult = action.closest(".protyle-wysiwyg__embed");
        click(embedResult);
        click(byID("embedded-leaf-text"));
        click(action, {altKey: false, shiftKey: true});
        click(action, {shiftKey: true});
        click(action, {altKey: false, ctrlKey: true});
        click(action, {altKey: false, metaKey: true});
        protyle.disabled = true;
        click(action);
        assert.deepEqual(protyle.opened.map(options => options.position),
            ["right", "right", "bottom", "bottom", undefined, undefined, "right"]);
        assert.equal(protyle.transactions.length, count, "navigation and read-only clicks must not fold source blocks");
        cases++;
    }
    return cases;
};

const runElectron = async () => {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 1000, height: 800, webPreferences: {
        nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true,
    }});
    ipcMain.handle("list-fold-backspace", async () => {
        for (const type of ["keyDown", "keyUp"]) {
            await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
                type, key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8,
            });
        }
    });
    let exitCode = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
        await win.webContents.executeJavaScript(readFileSync(
            path.join(__dirname, "../stage/protyle/js/lute/lute.min.js"), "utf8"));
        await win.webContents.executeJavaScript(`window.siyuan = {config: {editor: {markdown: {}}}};
            window.listFoldRemoval = {};
            new Function("exports", ${JSON.stringify(rendererSource())})(window.listFoldRemoval);`);
        const cases = await win.webContents.executeJavaScript(`(${runCases.toString()})()`);
        console.log(`List fold removal: ${cases} Electron cases passed`);
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    const {it} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    it("preserves folded list children when deleting and toggling sibling folds", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-list-fold-"));
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 40000,
            });
            assert.match(stdout, /13 Electron cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-list-fold-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
