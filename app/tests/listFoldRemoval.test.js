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
    // 使用实际删除、折叠和选区代码，只替代网络提交及无关的渲染副作用。
    const source = `
        const Constants = {ZWSP: "\\u200b", ATTRIBUTE_EDITING: "data-editing"};
        const isMobile = () => false, isHiddenTabContent = () => false;
        const getEmbedChildOperationContext = () => undefined;
        const getEmbedChildOperationParentID = () => undefined;
        const confirmRefRemoval = async () => true;
        const preventScroll = () => {}, mathRender = () => {}, scrollCenter = () => {};
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
        extract("util/blockFold", ["applyFoldState", "toggleListFold"]);
    return ts.transpileModule(source, {compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    }}).outputText;
};

const runCases = async () => {
    const assert = require("node:assert/strict");
    const {removeBlock, toggleListFold, focusByRange, getContenteditableElement} = window.listFoldRemoval;
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
    for (const viewFold of [false, true]) {
        const {protyle} = setup(list("mixed",
            item("leaf", "leaf") + item("expanded", "expanded", paragraph("expanded-child", "child")) +
            item("folded", "folded", paragraph("folded-child", "child"), true) +
            item("missing", "missing children", "", true)), viewFold);
        toggleListFold(protyle, byID("mixed"));
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
        toggleListFold(protyle, byID("mixed"));
        assert.equal(byID("mixed").querySelectorAll('[fold="1"]').length, 0);
        if (viewFold) {
            assert.equal(protyle.transactions.length, 0, "view folding must not write document data");
            assert.deepEqual(protyle.viewChanges.map(change => change.id),
                ["expanded", "folded", "leaf", "expanded", "folded", "missing"].map(nodeID));
        } else {
            const unfolded = protyle.transactions[1];
            assert.deepEqual(unfolded.doOperations.map(operation => operation.id), ["expanded", "folded", "missing"].map(nodeID));
            applyOperations(unfolded.undoOperations);
            applyOperations(unfolded.doOperations);
        }
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
            assert.match(stdout, /6 Electron cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-list-fold-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
