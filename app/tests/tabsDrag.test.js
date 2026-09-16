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
        extract("protyle/render/tabsRender.ts", ["getTabItems", "getTabTask"]),
        extract("protyle/wysiwyg/tabsRemoval.ts", ["repairActiveTab"]),
        extract("protyle/render/tabsState.ts", ["adjacentTabID"]),
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
    const {moveTo, bindTabsDrag, isDraggingTabs} = new Function("Constants", "genEmptyElement", "root", "protyle",
        source + "; return {moveTo, bindTabsDrag, isDraggingTabs};")(
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
            Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
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
    check.equal(find(originalID).parentElement.dataset.nodeId, tabs.dataset.nodeId);
    check.equal(find(tabs.dataset.nodeId).getAttribute("tabs-position"), "left");
    replay(result.doOperations);
    replay(result.undoOperations);
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
    require("node:test").test("tab drag transactions preserve valid active IDs through undo and redo", {
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
