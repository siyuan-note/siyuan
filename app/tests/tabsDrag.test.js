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
    return [
        extract("protyle/util/editorCommonEvent.ts", ["getDragSourceParentID", "moveTo"]),
        extract("protyle/wysiwyg/getBlock.ts", ["getParentBlock", "getPreviousBlockSibling", "getTopAloneElement"]),
        (() => {
            const file = ts.createSourceFile("tabsRender.ts", readFileSync(path.join(__dirname,
                "../src/protyle/render/tabsRender.ts"), "utf8"), ts.ScriptTarget.Latest, true);
            return ts.transpileModule(file.statements.filter(statement => !ts.isImportDeclaration(statement))
                .map(statement => statement.getText(file)).join("\n").replace(/^export /gm, ""), {
                compilerOptions: {target: ts.ScriptTarget.ES2021},
            }).outputText;
        })(),
        extract("protyle/wysiwyg/tabsRemoval.ts", ["repairActiveTab"]),
        extract("protyle/render/tabsState.ts", ["adjacentTabID", "resolveTabID", "tabKeyboardTarget"]),
        extract("protyle/render/tabsAttributes.ts", ["clearTabsAttributes", "renderTabsAttributes"]),
        extract("util/escape.ts", ["escapeHtml"]),
        extract("protyle/wysiwyg/transaction.ts", ["syncBlockAttrs"]),
        ts.transpileModule(readFileSync(path.join(__dirname, "../src/protyle/render/tabsDrag.ts"), "utf8")
            .replace(/export const /g, "const "), {compilerOptions: {target: ts.ScriptTarget.ES2021}}).outputText,
    ].join("\n");
};

const cases = async (source) => {
    const check = require("node:assert/strict");
    const lute = window.Lute.New();
    lute.SetTabs(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    const genEmptyElement = (_wbr, _start, id) => {
        const template = document.createElement("template");
        template.innerHTML = lute.Md2BlockDOM("\u200b");
        const paragraph = template.content.firstElementChild;
        paragraph.dataset.nodeId = id;
        return paragraph;
    };
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    document.body.append(root);
    root.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab Title\n\nBody\n:::\n\nTarget");
    const tabs = root.querySelector(".tabs");
    tabs.setAttribute("tabs-position", "left");
    const item = tabs.querySelector(".tab-item");
    const constants = {ZWSP: "\u200b", SIYUAN_DROP_BLOCK: "application/siyuan-block", SIYUAN_DROP_GUTTER: "application/siyuan-gutter"};
    const protyle = {lute, wysiwyg: {element: root}, notebookId: "notebook", block: {rootID: "doc"}};
    window.siyuan = {config: {system: {workspaceDir: "workspace"}}};
    const {moveTo, bindTabsDrag, isDraggingTabs, syncBlockAttrs, tabsRender, destroyTabsRender} = new Function("Constants", "genEmptyElement", "root", "protyle",
        source + "; return {moveTo, bindTabsDrag, isDraggingTabs, syncBlockAttrs, tabsRender, destroyTabsRender};")(
        constants, genEmptyElement, root, protyle);
    const list = document.createElement("div");
    const button = document.createElement("button");
    button.className = "tabs-tab";
    button.dataset.tabId = item.dataset.nodeId;
    list.append(button);
    tabs.prepend(list);
    let readonly = false;
    bindTabsDrag(list, {tabs, readonly: () => readonly, render: () => {}, move: () => {}});
    const transfer = new DataTransfer();
    button.dispatchEvent(new DragEvent("dragstart", {bubbles: true, cancelable: true, dataTransfer: transfer}));
    check.equal(isDraggingTabs(root), true);
    check.equal(window.siyuan.dragElement, undefined);
    check.equal(transfer.getData(constants.SIYUAN_DROP_BLOCK), "");
    check.equal(transfer.types.some(value => value.startsWith(constants.SIYUAN_DROP_GUTTER)), false);
    check.equal(transfer.getData("application/x-siyuan-tab"), item.dataset.nodeId);
    button.dispatchEvent(new DragEvent("dragend", {bubbles: true}));
    check.equal(isDraggingTabs(root), false);
    check.equal(window.siyuan.dragElement, undefined);
    readonly = true;
    const rejected = new DragEvent("dragstart", {bubbles: true, cancelable: true, dataTransfer: new DataTransfer()});
    button.dispatchEvent(rejected);
    check.equal(rejected.defaultPrevented, true);
    check.equal(isDraggingTabs(root), false);
    readonly = false;
    protyle.lite = true;
    const liteTransfer = new DataTransfer();
    button.dispatchEvent(new DragEvent("dragstart", {bubbles: true, cancelable: true, dataTransfer: liteTransfer}));
    check.equal(liteTransfer.getData(constants.SIYUAN_DROP_BLOCK), "");
    check.equal(window.siyuan.dragElement, undefined);
    button.dispatchEvent(new DragEvent("dragend", {bubbles: true}));
    protyle.lite = false;
    list.remove();
    const originalID = item.dataset.nodeId;
    const originalHTML = root.innerHTML;
    const result = await moveTo(protyle,
        [item], root.lastElementChild, true, "afterend", false);
    const stored = document.createElement("div");
    stored.innerHTML = originalHTML;
    const find = id => id === "doc" ? stored : stored.querySelector(`[data-node-id="${id}"]`);
    const replay = operations => operations.forEach(operation => {
        const node = find(operation.id);
        if (operation.action === "setAttrs") {
            const attrs = JSON.parse(operation.data);
            if (attrs["tabs-active-id"]) {
                check.ok(Array.from(node.children).some(child => child.dataset.nodeId === attrs["tabs-active-id"]),
                    JSON.stringify(operation));
            }
            syncBlockAttrs(stored, operation);
        } else if (operation.action === "delete") {
            node?.remove();
        } else if (operation.action === "update") {
            node.outerHTML = lute.SpinBlockDOM(operation.data);
        } else {
            let moving = node;
            if (operation.action === "insert") {
                const template = document.createElement("template");
                template.innerHTML = lute.SpinBlockDOM(operation.data);
                moving = template.content.firstElementChild;
            }
            if (operation.previousID) {
                find(operation.previousID).after(moving);
            } else {
                find(operation.parentID).prepend(moving);
            }
        }
    });
    replay(result.doOperations);
    replay(result.undoOperations);
    root.innerHTML = stored.innerHTML;
    const secondItem = root.querySelector(`[data-node-id="${originalID}"]`);
    const secondResult = await moveTo(protyle, [secondItem], root.lastElementChild, true, "afterend", false);
    replay(secondResult.doOperations);
    replay(secondResult.undoOperations);
    check.equal(find(originalID).parentElement.getAttribute("tabs-active-id"), originalID);
    check.equal(find(originalID).parentElement.dataset.nodeId, tabs.dataset.nodeId);
    check.equal(find(tabs.dataset.nodeId).getAttribute("tabs-position"), "left");
    replay(secondResult.doOperations);
    replay(secondResult.undoOperations);
    check.equal(find(originalID).parentElement.getAttribute("tabs-active-id"), originalID);
    const restoredTabs = find(tabs.dataset.nodeId);
    const syncAttrs = attrs => syncBlockAttrs(stored, {
        action: "setAttrs", id: tabs.dataset.nodeId, data: JSON.stringify(attrs),
    });
    syncAttrs({"tabs-position": "top", "tabs-task": "true", fold: "1", style: "color: red"});
    check.equal(restoredTabs.getAttribute("tabs-position"), "top");
    check.equal(restoredTabs.getAttribute("tabs-task"), "true");
    check.equal(restoredTabs.getAttribute("fold"), "1");
    check.equal(restoredTabs.style.color, "red");
    check.equal(restoredTabs.getAttribute("tabs-active-id"), originalID);
    syncAttrs({"tabs-position": "", "tabs-task": "", fold: "0", style: ""});
    for (const name of ["tabs-position", "tabs-task", "fold", "style"]) {
        check.equal(restoredTabs.hasAttribute(name), false);
    }
    check.equal(restoredTabs.getAttribute("tabs-active-id"), originalID);
    root.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab First\n\nFirst body\n@tab Second\n\nSecond body\n:::\n");
    tabsRender(root);
    const layoutTabs = root.querySelector(".tabs");
    const header = layoutTabs.querySelector(".tabs-header");
    const firstPanel = layoutTabs.querySelector(".tab-item");
    // 撤销将首个页签项插回容器前部，复用的导航栏必须恢复到正文之前。
    layoutTabs.prepend(firstPanel);
    tabsRender(root);
    check.equal(layoutTabs.firstElementChild, header);
    check.equal(layoutTabs.querySelectorAll(":scope > .tabs-header").length, 1);
    destroyTabsRender(root);
    root.remove();
    return "Tabs drag cases passed";
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
        const result = await win.webContents.executeJavaScript(`(async () => { try {
            return await (${cases.toString()})(${JSON.stringify(sources())});
        } catch (error) { return error.stack; } })()`);
        assert.equal(result, "Tabs drag cases passed");
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
    require("node:test").test("repeated tab drags preserve active IDs through attribute replay, undo and redo", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-tabs-drag-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Tabs drag cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
