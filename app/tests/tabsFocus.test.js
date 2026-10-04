const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    const compile = (file, names) => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
            ts.ScriptTarget.Latest, true);
        const statements = source.statements.filter(statement => names ? ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))) :
            !ts.isImportDeclaration(statement));
        return ts.transpileModule(statements.map(statement => statement.getText(source)).join("\n")
            .replace(/^export /gm, ""), {compilerOptions: {target: ts.ScriptTarget.ES2021}}).outputText;
    };
    return [
        compile("protyle/render/tabsState.ts"),
        compile("protyle/render/tabsDrag.ts"),
        compile("protyle/render/tabsAttributes.ts"),
        compile("util/escape.ts", ["escapeHtml"]),
        compile("protyle/render/tabsVisibility.ts", ["isHiddenTabContent"]),
        compile("protyle/render/tabsRender.ts"),
        compile("protyle/wysiwyg/tabsFocus.ts"),
        compile("protyle/wysiwyg/tabsRemoval.ts", ["repairActiveTab"]),
        compile("protyle/util/tabsCopy.ts", ["preserveTabTask"]),
        compile("protyle/wysiwyg/transactionUpdate.ts"),
        compile("protyle/wysiwyg/transaction.ts", ["onTransaction"]),
        compile("protyle/wysiwyg/tabs.ts", ["boundFocusedTitles", "canEdit", "changeTabs", "renameTab", "openTabsMenu", "initEditorTabs"]),
        compile("protyle/util/selection.ts", ["selectAll"]),
    ].join("\n");
};

const cases = async (source) => {
    const check = require("node:assert/strict");
    const lute = window.Lute.New();
    lute.SetTabs(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    window.siyuan = {languages: {enter: "Zoom in", copy: "Copy", delete: "Delete", rename: "Rename"},
        config: {editor: {spellcheck: false}}};
    const style = document.createElement("style");
    style.textContent = ".fn__none, .tab-item[data-tabs-hidden=\"true\"] {display: none !important;} " +
        ".tabs {width: 600px;} .tabs-list {display: flex;}";
    document.head.append(style);
    let menu;
    let navigations;
    let transactions;
    let selectedIDs;
    class Menu {
        constructor() { this.items = []; menu = this.items; }
        addItem(item) { this.items.push(item); }
        addSeparator() {}
        open() {}
    }
    const api = new Function("Constants", "Menu", "copySubMenu", "transaction", "zoomOut", "hideElements",
        "focusBlock", "focusByRange", "queueTransaction", "fetchPost", "openAttr", "processRender", "avRender",
        "getSelectAllBlockAction", "countBlockWord", "getTaskStatusItems", "replayDeps",
        "const {invalidateTrackedRangesByOperations, invalidateViewFoldRequests, handleViewFoldSourceOperation, " +
        "updateBlock, syncTrackedRanges, applyViewFoldStates, queueHeadingNumberRefresh, refreshHeadingFoldIndicators} = replayDeps;" +
        source + "; return {initEditorTabs, openTabsMenu, changeTabs, selectAll, destroyTabsRender, onTransaction};")(
        {CB_GET_HISTORY: "history", ATTRIBUTE_EDITING: "data-editing"}, Menu, () => [],
        (_protyle, forward, undo) => { transactions.push({forward, undo}); },
        options => { navigations.push(options.id); }, () => {}, () => {}, range => {
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
        }, (_protyle, task) => task(), () => {}, () => {}, () => {}, () => {},
        () => "expand", ids => { selectedIDs = ids; }, () => [], {
            invalidateTrackedRangesByOperations: () => {}, invalidateViewFoldRequests: () => {},
            handleViewFoldSourceOperation: () => false, syncTrackedRanges: () => {},
            applyViewFoldStates: () => {}, queueHeadingNumberRefresh: () => {}, refreshHeadingFoldIndicators: () => {},
            updateBlock: (items, _protyle, operation) => items.forEach(item => { item.outerHTML = operation.data; }),
        });

    for (const readonly of [false, true]) {
        for (const position of ["top", "left"]) {
            navigations = [];
            transactions = [];
            const element = document.createElement("div");
            const root = document.createElement("div");
            root.className = "protyle-wysiwyg";
            let genericContextMenus = 0;
            root.addEventListener("contextmenu", () => genericContextMenus++);
            element.append(root);
            document.body.append(element);
            root.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab A\n\nBody A\n@tab B\n\nBody B\n:::\n");
            const tabs = root.firstElementChild;
            const [a, b] = Array.from(tabs.children).filter(item => item.classList.contains("tab-item"));
            check.ok(a && b);
            a.querySelector(".tab-item-content").insertAdjacentHTML("beforeend", lute.Md2BlockDOM(
                "::: tabs\n@tab Inner A\n\nInner body A\n@tab Inner B\n\nInner body B\n:::\n"));
            const protyle = {element, wysiwyg: {element: root}, disabled: readonly, options: {action: []},
                toolbar: {isMultiSelectMode: () => false}, block: {id: "doc", rootID: "doc", showAll: false}};
            tabs.setAttribute("tabs-position", position);
            tabs.setAttribute("tabs-active-id", b.dataset.nodeId);
            const fullGroup = tabs.outerHTML;
            api.initEditorTabs(protyle);
            const replayGroup = tabs.outerHTML;
            api.openTabsMenu(protyle, tabs, a, tabs);
            menu.find(item => item.label === "Zoom in").click();
            check.deepEqual(navigations, [a.dataset.nodeId]);

            // 聚焦编辑器只加载目标项，原始组的其他内容仍保留在来源数据中。
            protyle.block.id = a.dataset.nodeId;
            protyle.block.showAll = true;
            api.initEditorTabs(protyle);
            check.equal(root.children.length, 1);
            check.equal(root.firstElementChild, a);
            check.equal(root.contains(b), false);
            check.equal(a.hasAttribute("data-tabs-hidden"), false);
            check.equal(a.querySelector(".tab-item-content").hasAttribute("aria-labelledby"), false);
            check.equal(root.querySelector(":scope > .tabs-header"), null);
            check.equal(a.querySelector(".tab-item-title").getAttribute("contenteditable"), String(!readonly));
            check.equal(tabs.getAttribute("tabs-active-id"), b.dataset.nodeId);
            root.append(b.cloneNode(true));
            api.initEditorTabs(protyle);
            check.equal(root.children.length, 1);
            check.equal(root.firstElementChild, a);
            const serialized = lute.BlockDOM2StdMd(root.innerHTML);
            check.match(serialized, /Body A/);
            check.doesNotMatch(serialized, /Body B/);
            check.match(fullGroup, /Body B/);
            const roundtrip = document.createElement("div");
            roundtrip.innerHTML = lute.SpinBlockDOM(root.innerHTML);
            check.equal(roundtrip.firstElementChild.dataset.nodeId, a.dataset.nodeId);
            check.equal(roundtrip.firstElementChild.dataset.type, "NodeTabItem");

            api.selectAll(protyle, a, document.createRange());
            check.deepEqual(selectedIDs, [a.dataset.nodeId]);
            a.classList.remove("protyle-wysiwyg--select");
            a.querySelector(".tab-item-title").dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
            check.equal(genericContextMenus, 0);
            check.equal(menu.some(item => item.label === "Delete"), false);
            const focusedMenu = menu;
            a.querySelector(".tab-item-title").dispatchEvent(
                new MouseEvent("contextmenu", {bubbles: true, cancelable: true, shiftKey: true}));
            check.equal(genericContextMenus, 1);
            check.equal(menu, focusedMenu);
            protyle.toolbar.isMultiSelectMode = () => true;
            a.querySelector(".tab-item-title").dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
            check.equal(genericContextMenus, 2);
            check.equal(menu, focusedMenu);
            protyle.toolbar.isMultiSelectMode = () => false;
            genericContextMenus = 0;
            if (!readonly) {
                menu.find(item => item.label === "Rename").click();
                api.changeTabs(protyle, [a], () => { a.querySelector(".tab-item-title").textContent = "Edited A"; });
                check.equal(transactions.length, 1);
                check.equal(transactions[0].forward[0].id, a.dataset.nodeId);
                check.doesNotMatch(transactions[0].forward[0].data, /Body B/);
                check.match(transactions[0].undo[0].data, /Body A/);
            }

            const inner = a.querySelector(".tabs");
            const innerButtons = inner.querySelectorAll(":scope > .tabs-header > .tabs-list > .tabs-tab");
            check.equal(innerButtons.length, 2);
            innerButtons[1].click();
            check.equal(innerButtons[1].getAttribute("aria-selected"), "true");

            // 其他窗口和撤销回放按聚焦 ID 提取页签项，可能带回组内的隐藏标记和标题定位样式。
            const replay = document.createElement("template");
            replay.innerHTML = replayGroup;
            const replayItem = replay.content.querySelector(`[data-node-id="${a.dataset.nodeId}"]`);
            const replayInfo = replayItem.querySelector(".tab-item-info");
            replayInfo.classList.add("tabs-title-editor");
            replayInfo.style.left = "100px";
            root.firstElementChild.replaceWith(replayItem);
            await new Promise(resolve => setTimeout(resolve, 0));
            check.equal(root.firstElementChild, replayItem);
            check.equal(replayItem.hasAttribute("data-tabs-hidden"), false);
            check.notEqual(getComputedStyle(replayItem).display, "none");
            check.equal(replayInfo.classList.contains("tabs-title-editor"), false);
            check.equal(replayInfo.hasAttribute("style"), false);
            replayItem.querySelector(".tab-item-content > [data-node-id]").dispatchEvent(
                new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
            check.equal(genericContextMenus, 1);

            for (const isUndo of [false, true]) {
                const update = document.createElement("template");
                update.innerHTML = replayGroup;
                update.content.firstElementChild.setAttribute("tabs-task", "true");
                const operation = {action: "update", id: tabs.dataset.nodeId, data: update.innerHTML};
                api.onTransaction(protyle, [operation], isUndo);
                await new Promise(resolve => setTimeout(resolve, 0));
                check.equal(operation.id, a.dataset.nodeId);
                check.equal(root.firstElementChild.getAttribute("tabs-task"), " ");
                check.equal(root.firstElementChild.hasAttribute("data-tabs-hidden"), false);
                check.notEqual(getComputedStyle(root.firstElementChild).display, "none");
                check.doesNotMatch(root.innerHTML, /Body B/);
            }

            // 重新加载容器时继续提取目标项，并保留从容器继承的任务状态。
            root.innerHTML = fullGroup;
            root.firstElementChild.setAttribute("tabs-task", "true");
            api.initEditorTabs(protyle);
            check.equal(root.firstElementChild.dataset.nodeId, a.dataset.nodeId);
            check.equal(root.firstElementChild.dataset.type, "NodeTabItem");
            check.equal(root.firstElementChild.getAttribute("tabs-task"), " ");
            check.doesNotMatch(root.innerHTML, /Body B/);

            root.innerHTML = inner.outerHTML;
            protyle.block.id = innerButtons[1].dataset.tabId;
            api.initEditorTabs(protyle);
            check.equal(root.firstElementChild.dataset.nodeId, protyle.block.id);
            check.equal(root.firstElementChild.dataset.type, "NodeTabItem");
            check.match(root.innerHTML, /Inner body B/);
            check.doesNotMatch(root.innerHTML, /Inner body A/);

            protyle.block.id = "doc";
            protyle.block.showAll = false;
            root.innerHTML = fullGroup;
            api.initEditorTabs(protyle);
            const restoredTabs = root.firstElementChild;
            check.equal(restoredTabs.querySelectorAll(":scope > .tabs-header > .tabs-list > .tabs-tab").length, 2);
            check.equal(restoredTabs.querySelector(`[data-node-id="${b.dataset.nodeId}"]`).dataset.tabsHidden, "false");
            check.equal(restoredTabs.dataset.tabsOrientation, position === "left" ? "vertical" : "horizontal");

            for (const surface of ["preview", "backlink", "lite", "history"]) {
                root.innerHTML = fullGroup;
                protyle.block.id = a.dataset.nodeId;
                protyle.block.showAll = true;
                element.classList.toggle("block__popover", surface === "preview");
                protyle.options.backlinkData = surface === "backlink" ? {} : undefined;
                protyle.lite = surface === "lite";
                protyle.options.action = surface === "history" ? ["history"] : [];
                api.initEditorTabs(protyle);
                const group = root.firstElementChild;
                check.equal(group.dataset.type, "NodeTabs");
                check.equal(group.querySelectorAll(":scope > .tabs-header > .tabs-list > .tabs-tab").length, 2);
                api.openTabsMenu(protyle, group, group.querySelector(".tab-item"), group);
                check.equal(menu.some(item => item.label === "Zoom in"), false);
            }
            api.destroyTabsRender(root);
            element.remove();
        }
    }
    style.remove();
    return "Tab item focus cases passed";
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
        assert.equal(result, "Tab item focus cases passed");
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
    require("node:test").test("tab item focus isolates display, preserves data, and restores navigation", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-tabs-focus-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Tab item focus cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
