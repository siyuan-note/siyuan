const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    const compile = source => ts.transpileModule(source.replace(/export /g, ""), {
        compilerOptions: {target: ts.ScriptTarget.ES2021},
    }).outputText;
    const extract = (file, names) => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
            ts.ScriptTarget.Latest, true);
        const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
        assert.equal(statements.length, names.length);
        return compile(statements.map(statement => statement.getText(source)).join("\n"));
    };
    const renderSource = readFileSync(path.join(__dirname, "../src/protyle/render/tabsRender.ts"), "utf8");
    const wysiwygSource = ts.createSourceFile("index.ts", readFileSync(path.join(__dirname,
        "../src/protyle/wysiwyg/index.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    let contextMenu;
    const visit = node => {
        if (ts.isCallExpression(node) && node.expression.getText(wysiwygSource) === "this.element.addEventListener" &&
            node.arguments[0]?.text === "contextmenu") {
            contextMenu = compile(`const handleContextMenu = ${node.arguments[1].getText(wysiwygSource)};`);
        }
        ts.forEachChild(node, visit);
    };
    visit(wysiwygSource);
    assert.ok(contextMenu);
    return {
        contextMenu,
        icons: ["unchecked", "in-progress", "canceled"].map(name =>
            readFileSync(path.join(__dirname, `../src/assets/icon/task-${name}.svg`), "utf8")),
        actions: extract("protyle/render/tabsRender.ts", ["getTabTask", "getTabItems", "hasTabsTasks"]) +
            extract("protyle/render/listMindmap/model.ts", ["isRecord", "invalidMetadata",
                "parseListMindmapMetadata", "cleanListMindmapDOM", "remapListMindmapIDs"]) +
            extract("protyle/util/tabsCopy.ts", ["preserveTabTask", "preserveCopiedTabTask", "remapTabsDOMIDs", "wrapPastedTabItems"]) +
            extract("protyle/wysiwyg/tabsRemoval.ts", ["repairActiveTab"]) +
            extract("protyle/wysiwyg/taskListMarker.ts", ["getTaskListMarker", "isTaskListMarker", "nextTaskListMarker"]) +
            extract("protyle/wysiwyg/tabs.ts", ["canEdit", "changeTabs", "toggleTabsTasks", "setTabTask", "moveTab"]) +
            extract("protyle/wysiwyg/list.ts", ["setTaskListItemMarker", "toggleTaskListItem"]) +
            extract("protyle/util/editorCommonEvent.ts", ["moveTo"]),
        renderer: compile(renderSource.replace(/^import .*;\r?\n/gm, "")) +
            extract("protyle/render/tabsState.ts", ["resolveTabID", "tabKeyboardTarget"]) +
            extract("protyle/render/tabsAttributes.ts", ["clearTabsAttributes", "renderTabsAttributes"]),
        menu: extract("protyle/wysiwyg/taskStatusDialog.ts", ["getTaskStatusItems"]),
        tabMenu: extract("protyle/wysiwyg/tabs.ts", ["canEdit", "openTabsMenu"]),
        normalizeSeparators: extract("config/entryVisibility/runtime.ts", ["normalizeSeparators"]),
        css: require("sass").compile(path.join(__dirname, "../src/assets/scss/protyle/_wysiwyg.scss")).css +
            require("sass").compile(path.join(__dirname, "../src/assets/scss/component/_typography.scss")).css,
    };
};

const cases = async source => {
    const check = require("node:assert/strict");
    // 列表遮罩与页签引用的图标保持同一外框和图形，防止两处资源发生偏差。
    const symbols = ["iconUncheck", "iconTaskInProgress", "iconIndeterminateCheck"];
    source.icons.forEach((svg, index) => {
        const icon = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
        const symbol = document.getElementById(symbols[index]);
        for (const attribute of ["viewBox", "stroke-width", "stroke-linecap", "stroke-linejoin"]) {
            check.equal(icon.getAttribute(attribute), symbol.getAttribute(attribute));
        }
        const shape = element => Array.from(element.children).map(child => [child.localName,
            Array.from(child.attributes).map(attribute => [attribute.name, attribute.value])]);
        check.deepEqual(shape(icon), shape(symbol));
        check.equal(icon.querySelector("rect").getAttribute("width"), "18");
    });
    const lute = window.Lute.New();
    lute.SetTabs(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetSpin(true);
    lute.SetArbitraryTaskListItemMarker(true);
    lute.SetDataTask(true);
    lute.SetExportNormalizeTaskListMarker(true);
    let lastTransaction;
    const api = new Function("Constants", "transaction", "updateTransaction", "dayjs", "getParentBlock",
        "getPreviousBlockSibling", "getTopAloneElement", source.actions +
        "; return {canEdit, getTabTask, hasTabsTasks, preserveCopiedTabTask, wrapPastedTabItems, moveTo, moveTab, toggleTabsTasks, setTabTask, setTaskListItemMarker, toggleTaskListItem};")(
        {CB_GET_HISTORY: "history", ATTRIBUTE_EDITING: "data-editing", ZWSP: "\u200b",
            CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap",
            CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data"},
        (_protyle, forward, backward) => { lastTransaction = {forward, backward}; },
        (_protyle, item, html) => { lastTransaction = {forward: item.outerHTML, backward: html}; },
        () => ({format: () => "20260915120000"}), item => item.parentElement,
        item => item.previousElementSibling, item => item);
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    document.body.append(root);
    const protyle = {lute, disabled: false, options: {action: []}, block: {rootID: "doc"}, wysiwyg: {element: root}};
    const taskStyle = document.createElement("style");
    taskStyle.textContent = source.css;
    document.head.append(taskStyle);
    window.siyuan = {languages: {}};
    let customMarker;
    const getMenu = new Function("openTaskStatusDialog", source.menu + "; return getTaskStatusItems;")(
        marker => { customMarker = marker; });
    let chosenMarker;
    const menuItems = getMenu("x", marker => { chosenMarker = marker; });
    check.equal(menuItems.length, 5);
    check.equal(menuItems[2].icon, "iconCheck");
    for (let index = 0; index < 4; index++) {
        menuItems[index].click();
        check.equal(chosenMarker, [" ", "/", "X", "-"][index]);
    }
    menuItems[4].click();
    check.equal(customMarker, "x");
    const markdown = "::: tabs\n@tab Keep\n\nA\n@tab Task\n\nB\n:::\n{: tabs-task=\"true\"}\n\n::: tabs\n@tab Target\n\nC\n:::\n";
    const reset = () => {
        root.innerHTML = lute.Md2BlockDOM(markdown);
        const groups = root.querySelectorAll(".tabs");
        return {from: groups[0], to: groups[1], item: groups[0].querySelectorAll(":scope > .tab-item")[1],
            target: groups[1].querySelector(".tab-item")};
    };
    const find = id => root.querySelector(`[data-node-id="${id}"]`);
    // 完整页签菜单保留其他块操作，状态直接展开且自定义入口只有一个。
    let openedMenu;
    class TestMenu {
        constructor() {
            this.items = [];
            openedMenu = {items: this.items};
        }
        addItem(item) { this.items.push(item); }
        addSeparator(item) { this.items.push({...item, type: "separator"}); }
        open() {}
    }
    const openTabMenu = new Function("Menu", "Constants", "getTabTask", "getTaskStatusItems", "setTabTask", "copySubMenu",
        source.tabMenu + "; return openTabsMenu;")(
        TestMenu, {CB_GET_HISTORY: "history"}, api.getTabTask, getMenu, api.setTabTask, () => []);
    const menuFixture = reset();
    openTabMenu(protyle, menuFixture.from, menuFixture.item, menuFixture.item);
    const expectedStates = ["taskStatusTodo", "taskStatusInProgress", "taskStatusDone", "taskStatusCanceled", "customTaskStatus"];
    check.deepEqual(openedMenu.items.filter(item => expectedStates.includes(item.id)).map(item => item.id), expectedStates);
    check.equal(openedMenu.items.filter(item => item.id === "customTaskStatus").length, 1);
    check.equal(openedMenu.items.some(item => item.id === "taskStatus"), false);
    const normalizeSeparators = new Function(source.normalizeSeparators + "; return normalizeSeparators;")();
    for (const hidden of [[], expectedStates, ["prependListItem", "appendListItem", "pluginItem"]]) {
        const container = document.createElement("div");
        document.body.append(container);
        for (const id of [...expectedStates, "separator_taskStatus", "separator_plugin", "pluginItem", "prependListItem", "appendListItem"]) {
            if (hidden.includes(id)) {
                continue;
            }
            const entry = document.createElement("button");
            entry.dataset.id = id;
            entry.className = id.startsWith("separator_") ? "b3-menu__separator" : "b3-menu__item";
            container.append(entry);
        }
        normalizeSeparators(container);
        const entries = Array.from(container.children);
        check.equal(entries[0].classList.contains("b3-menu__separator"), false);
        check.equal(entries[entries.length - 1].classList.contains("b3-menu__separator"), false);
        entries.forEach((entry, index) => {
            if (entry.classList.contains("b3-menu__separator")) {
                check.equal(entries[index - 1].classList.contains("b3-menu__separator"), false);
            }
        });
        if (!hidden.includes("pluginItem")) {
            check.ok(container.querySelector('[data-id="pluginItem"]'));
        }
        container.remove();
    }
    check.ok(openedMenu.items.some(item => item.icon === "iconCopy"));
    check.ok(openedMenu.items.some(item => item.icon === "iconTrashcan"));
    openedMenu.items.find(item => item.id === "taskStatusInProgress").click();
    check.equal(api.getTabTask(menuFixture.item), "/");
    protyle.disabled = true;
    openTabMenu(protyle, menuFixture.from, menuFixture.item, menuFixture.item);
    check.deepEqual(openedMenu.items.map(item => item.icon), ["iconCopy"]);
    protyle.disabled = false;
    const apply = operations => operations.forEach(operation => {
        const item = find(operation.id);
        if (operation.action === "setAttrs") {
            Object.entries(JSON.parse(operation.data)).forEach(([name, value]) => {
                if (value === "") {
                    item.removeAttribute(name);
                } else {
                    item.setAttribute(name, value);
                }
            });
        } else if (operation.action === "move") {
            if (operation.previousID) {
                find(operation.previousID).after(item);
            } else {
                find(operation.parentID).prepend(item);
            }
        } else if (operation.action === "update") {
            item.outerHTML = operation.data;
        } else {
            check.fail(`Unexpected operation ${operation.action}`);
        }
    });

    // 同一继承状态覆盖块标移动、复制、剪贴板和导航移动，真实应用事务检查撤销及重做。
    for (const marker of [null, " ", "X", "/"]) {
        for (const copy of [false, true]) {
            const {from, to, item, target} = reset();
            if (marker !== null) {
                item.setAttribute("tabs-task", marker);
            }
            const id = item.dataset.nodeId;
            const positions = new Map([[id, {parentID: from.dataset.nodeId, previousID: item.previousElementSibling.dataset.nodeId}]]);
            const operations = await api.moveTo(protyle, [item], target, true, "afterend", copy, positions);
            const moved = to.querySelectorAll(":scope > .tab-item")[1];
            check.equal(api.getTabTask(moved), marker ?? " ");
            if (copy) {
                check.equal(item.getAttribute("tabs-task"), marker);
                check.ok(operations.doOperations.some(operation => operation.action === "insert" &&
                    operation.data.includes("tabs-task=")));
            } else {
                apply(operations.undoOperations);
                check.equal(find(id).parentElement.dataset.nodeId, from.dataset.nodeId);
                check.equal(find(id).getAttribute("tabs-task"), marker);
                apply(operations.doOperations);
                check.equal(find(id).parentElement.dataset.nodeId, to.dataset.nodeId);
                check.equal(api.getTabTask(find(id)), marker ?? " ");
            }
        }
        const {from, item, target} = reset();
        if (marker !== null) {
            item.setAttribute("tabs-task", marker);
        }
        const clipboard = document.createElement("div");
        clipboard.innerHTML = api.preserveCopiedTabTask(item, item.outerHTML);
        api.wrapPastedTabItems(clipboard, lute);
        check.equal(api.getTabTask(clipboard.querySelector(".tab-item")), marker ?? " ");
        check.equal(item.getAttribute("tabs-task"), marker);
        const id = item.dataset.nodeId;
        api.moveTab(protyle, item, target, true);
        const saved = lastTransaction;
        check.equal(api.getTabTask(item), marker ?? " ");
        apply(saved.backward);
        check.equal(find(id).parentElement.dataset.nodeId, from.dataset.nodeId);
        check.equal(find(id).getAttribute("tabs-task"), marker);
        apply(saved.forward);
        check.equal(api.getTabTask(find(id)), marker ?? " ");
    }
    let {from, item} = reset();
    const ordinaryItem = root.querySelectorAll(".tabs")[1].querySelector(".tab-item");
    const ordinaryClipboard = api.preserveCopiedTabTask(ordinaryItem, ordinaryItem.outerHTML);
    check.equal(ordinaryClipboard, ordinaryItem.outerHTML);
    const reorderID = item.dataset.nodeId;
    const reorder = await api.moveTo(protyle, [item], from.querySelector(".tab-item"), true, "beforebegin", false,
        new Map([[reorderID, {parentID: from.dataset.nodeId, previousID: item.previousElementSibling.dataset.nodeId}]]));
    check.equal(item.hasAttribute("tabs-task"), false);
    apply(reorder.undoOperations);
    item = find(reorderID);
    api.setTabTask(protyle, item, "/");
    check.equal(item.getAttribute("tabs-task"), "/");
    apply(lastTransaction.backward);
    from = find(from.dataset.nodeId);
    item = from.querySelectorAll(":scope > .tab-item")[1];
    check.equal(item.hasAttribute("tabs-task"), false);
    api.toggleTabsTasks(protyle, from);
    check.equal(api.hasTabsTasks(from), false);
    api.toggleTabsTasks(protyle, from);
    check.equal(from.getAttribute("tabs-task"), "true");
    check.equal(api.getTabTask(item), " ");
    const nested = document.createElement("div");
    nested.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab Nested\n\nBody\n:::\n");
    item.querySelector(".tab-item-content").append(nested.firstElementChild);
    check.equal(api.getTabTask(item.querySelector(".tab-item")), null);

    // 列表自定义状态保留原始字符，并沿用点击切换、只读保护和撤销快照。
    root.innerHTML = lute.Md2BlockDOM("* [ ] Task\n");
    const taskItem = root.querySelector(".li");
    // 图标右键必须进入完整块菜单，即使仍有文本选区或编辑器为只读，也不能被状态菜单截获。
    let blockMenuTarget;
    const selectionRange = document.createRange();
    selectionRange.selectNodeContents(taskItem.querySelector(".p"));
    const contextProtyle = {...protyle, toolbar: {range: selectionRange, element: document.createElement("div"),
        isMultiSelectMode: () => false}, gutter: {renderMenu: (_protyle, block) => { blockMenuTarget = block; }}};
    window.siyuan.menus = {menu: {popup() {}, fullscreen() {}, remove() {}}};
    const contextMenu = new Function("protyle", "getBlockSelectionModeElement", "isInEmbedBlock", "hasClosestBlock",
        "hasClosestByClassName", "getEditorRange", "isNotEditBlock", "hasClosestByAttribute", "hideElements",
        source.contextMenu + "; return handleContextMenu;")(
        contextProtyle, () => null, () => null, target => target.closest("[data-node-id]"),
        (target, name) => target.closest(`.${name}`), () => selectionRange, () => false,
        (target, name, value) => target.closest(`[${name}~="${value}"]`), () => {});
    for (const readonly of [false, true]) {
        contextProtyle.disabled = readonly;
        for (const target of taskItem.querySelectorAll(".protyle-action, svg, use")) {
            blockMenuTarget = undefined;
            const html = taskItem.outerHTML;
            await contextMenu({target, detail: {}, clientX: 1, clientY: 1, preventDefault() {}, stopPropagation() {}});
            check.equal(blockMenuTarget, taskItem);
            check.equal(taskItem.outerHTML, html);
        }
    }
    for (const marker of ["/", "-", "?", "X", "x", " ", "\"", "&", "<"]) {
        const before = taskItem.outerHTML;
        api.setTaskListItemMarker(protyle, taskItem, marker);
        check.equal(taskItem.getAttribute("data-task"), marker);
        check.equal(lastTransaction.backward, before);
        const imported = document.createElement("div");
        imported.innerHTML = lute.SpinBlockDOM(root.innerHTML);
        check.equal(imported.querySelector(".li").getAttribute("data-task"), marker === "x" ? "X" : marker);
        const action = taskItem.querySelector(".protyle-action--task");
        if (![" ", "X", "x", "/", "-"].includes(marker)) {
            check.equal(JSON.parse(getComputedStyle(action, "::before").content), marker);
            check.equal(getComputedStyle(action.querySelector("use")).visibility, "hidden");
        }
        if (marker === "/" || marker === "-") {
            check.equal(getComputedStyle(action, "::before").content, "none");
            check.ok(getComputedStyle(action.querySelector("svg")).maskImage.includes(
                marker === "/" ? "task-in-progress.svg" : "task-canceled.svg"));
        }
        if (marker === "/" || marker === "-") {
            check.equal(getComputedStyle(taskItem.querySelector(".p")).textDecorationLine,
                marker === "/" ? "none" : "line-through");
        }
        api.toggleTaskListItem(protyle, taskItem);
        check.equal(taskItem.getAttribute("data-task"), marker === " " || marker === "/" ? "X" : " ");
    }
    const before = taskItem.outerHTML;
    for (const marker of ["ab", "[", "]"]) {
        api.setTaskListItemMarker(protyle, taskItem, marker);
        check.equal(taskItem.outerHTML, before);
    }
    protyle.disabled = true;
    api.setTaskListItemMarker(protyle, taskItem, "/");
    check.equal(taskItem.outerHTML, before);
    protyle.disabled = false;
    protyle.options.action = ["history"];
    api.setTaskListItemMarker(protyle, taskItem, "/");
    check.equal(taskItem.outerHTML, before);
    protyle.options.action = [];

    // 各状态复用同一 SVG 画布尺寸，预设状态不再绘制字符或 CSS 边框。
    for (const fontSize of [16, 20, 28]) {
        root.style.fontSize = `${fontSize}px`;
        api.setTaskListItemMarker(protyle, taskItem, "/");
        const action = taskItem.querySelector(".protyle-action--task");
        const iconSize = action.querySelector("svg").getBoundingClientRect().height;
        for (const marker of [" ", "-", "X", "?"]) {
            api.setTaskListItemMarker(protyle, taskItem, marker);
            check.equal(action.querySelector("svg").getBoundingClientRect().height, iconSize);
        }
    }
    root.style.fontSize = "";

    // 重载、嵌套列表和导出结构使用各自标记，不能继承外层任务字符。
    for (const exportDOM of [false, true]) {
        root.innerHTML = lute.Md2BlockDOM("* [-] Canceled\n  * [/] Working\n  * [?] Custom\n");
        if (exportDOM) {
            root.querySelectorAll(".li").forEach(entry => {
                entry.querySelector(":scope > .protyle-action--task").setAttribute("data-task", entry.getAttribute("data-task"));
                entry.removeAttribute("data-task");
            });
        }
        const entries = root.querySelectorAll(".li");
        ["-", "/", "?"].forEach((marker, index) => {
            const action = entries[index].querySelector(":scope > .protyle-action--task");
            check.equal(getComputedStyle(action, "::before").content, marker === "?" ? '"?"' : "none");
        });
        check.equal(getComputedStyle(entries[1].querySelector(".p")).textDecorationLine, "none");
    }

    // 真实导航渲染验证三种状态共用图标轮廓，右键入口和只读行为保持一致。
    const renderer = new Function("bindTabsDrag", "cancelTabsDrag", "isDraggingTabs", "escapeHtml",
        source.renderer + "; return {tabsRender, destroyTabsRender};")(() => {}, () => {}, () => false, value => value);
    const style = document.createElement("style");
    style.textContent = source.css;
    document.head.append(style);
    ({from} = reset());
    const items = from.querySelectorAll(":scope > .tab-item");
    items[1].setAttribute("tabs-task", "?");
    const completed = items[0].cloneNode(true);
    completed.dataset.nodeId = window.Lute.NewNodeID();
    completed.setAttribute("tabs-task", "X");
    from.insertBefore(completed, from.querySelector(":scope > .protyle-attr"));
    let edited;
    let toggled;
    renderer.tabsRender(root, {readonly: () => false, taskMenu: entry => { edited = entry; }, task: entry => { toggled = entry; }});
    const custom = from.querySelector(".tabs-task--custom");
    const incomplete = from.querySelector(".tabs-task:not(.tabs-task--custom)");
    check.equal(custom.querySelector("use").getAttribute("xlink:href"), incomplete.querySelector("use").getAttribute("xlink:href"));
    check.equal(custom.querySelector("span").textContent, "?");
    check.equal(custom.getBoundingClientRect().width, incomplete.getBoundingClientRect().width);
    check.equal(custom.getBoundingClientRect().height, incomplete.getBoundingClientRect().height);
    const checked = from.querySelector('.tabs-task[data-task="X"]');
    check.equal(checked.querySelector("use").getAttribute("xlink:href"), "#iconCheck");
    check.equal(custom.getBoundingClientRect().width, checked.getBoundingClientRect().width);
    for (const [marker, icon] of [["/", "iconTaskInProgress"], ["-", "iconIndeterminateCheck"]]) {
        items[0].setAttribute("tabs-task", marker);
        renderer.tabsRender(root, {readonly: () => false, taskMenu: entry => { edited = entry; }, task: entry => { toggled = entry; }});
        const preset = from.querySelector(`.tabs-task[data-task="${marker}"]`);
        check.equal(preset.querySelector("use").getAttribute("xlink:href"), `#${icon}`);
        check.equal(preset.querySelector("span"), null);
    }
    const active = from.getAttribute("tabs-active-id");
    custom.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
    check.equal(edited, items[1]);
    check.equal(from.getAttribute("tabs-active-id"), active);
    custom.click();
    check.equal(toggled, items[1]);
    check.equal(from.getAttribute("tabs-active-id"), active);
    renderer.tabsRender(root, {readonly: () => true});
    check.equal(from.querySelector(".tabs-task--custom").getAttribute("aria-disabled"), "true");
    // 任务图标右键与标题右键共用完整菜单，只读时仍允许复制，且不切换任务标记。
    for (const readonly of [false, true]) {
        let menuTarget;
        renderer.tabsRender(root, {readonly: () => readonly, menu: (_tabs, entry) => { menuTarget = entry; },
            taskMenu: () => check.fail("the task-only menu must not intercept the full item menu"),
            task: () => check.fail("right-click must not toggle task status")});
        const task = from.querySelector(".tabs-task--custom");
        task.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
        check.equal(menuTarget, items[1]);
        check.equal(api.getTabTask(items[1]), "?");
    }
    // 展示副本可以切换页签，但任务操作不能提交空块 ID；内嵌编辑器由自身接管。
    const preview = from.cloneNode(true);
    preview.classList.add("list-mindmap__preview-block");
    preview.querySelectorAll(".tabs-header, .tabs-divider").forEach(element => element.remove());
    [preview, ...preview.querySelectorAll("[data-node-id]")].forEach(element => element.removeAttribute("data-node-id"));
    const previewItems = Array.from(preview.querySelectorAll(":scope > .tab-item"));
    previewItems.forEach((item, index) => { item.id = `preview-tab-${index}`; });
    root.append(preview);
    const options = {readonly: tabs => !api.canEdit(protyle, tabs),
        task: entry => api.setTabTask(protyle, entry, "X")};
    renderer.tabsRender(root, options);
    const previewBefore = previewItems[0].getAttribute("tabs-task");
    lastTransaction = undefined;
    preview.querySelector(".tabs-task").click();
    api.setTabTask(protyle, previewItems[0], "X");
    check.equal(lastTransaction, undefined);
    check.equal(previewItems[0].getAttribute("tabs-task"), previewBefore);
    preview.querySelectorAll(".tabs-tab")[1].click();
    check.equal(previewItems[1].getAttribute("data-tabs-hidden"), "false");
    check.equal(previewItems[0].getAttribute("data-tabs-hidden"), "true");
    const inner = document.createElement("div");
    inner.className = "protyle-wysiwyg";
    inner.innerHTML = lute.Md2BlockDOM(markdown);
    root.append(inner);
    const innerBefore = inner.innerHTML;
    renderer.tabsRender(root, options);
    check.equal(inner.innerHTML, innerBefore);
    const innerOwner = {...protyle, wysiwyg: {element: inner}};
    renderer.tabsRender(inner, {readonly: tabs => !api.canEdit(innerOwner, tabs),
        task: entry => api.setTabTask(innerOwner, entry, "X")});
    inner.querySelector(".tabs-task").click();
    check.ok(lastTransaction.forward[0].id);
    renderer.destroyTabsRender(inner);
    renderer.destroyTabsRender(root);
    root.remove();
    return "Task status cases passed";
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
        await win.webContents.executeJavaScript(readFileSync(path.join(__dirname,
            "../appearance/icons/litheness/icon.js"), "utf8"));
        const result = await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(sources())})`);
        assert.equal(result, "Task status cases passed");
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
    require("node:test").test("task status editing, inherited transfers, undo and rendering", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-task-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Task status cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
