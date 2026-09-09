module.exports = async () => {
    const assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const load = window.navigationModules;
    const navigation = load("wysiwyg/verticalNavigation");
    const state = load("wysiwyg/verticalNavigationState");
    const selection = load("util/selection");
    const targets = load("wysiwyg/verticalTarget");
    const table = load("util/tableNavigation");
    const documentRange = load("util/documentRange");
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const select = (element, offset = 0) => {
        const range = document.createRange();
        range.setStart(element.firstChild || element, offset);
        range.collapse(true);
        selection.focusByRange(range);
    };
    const p = (id, text = id) =>
        `<div data-node-id="${id}" data-type="NodeParagraph"><div contenteditable="true">${text}</div></div>`;
    const setup = html => {
        document.body.innerHTML = `<div class="protyle" style="height:180px;width:500px;overflow:hidden">
            <div class="protyle-content" style="height:180px;overflow:auto">
            <div class="protyle-title__input" contenteditable="true">title</div>
            <div class="protyle-wysiwyg" contenteditable="true" style="font:20px/30px monospace">${html}</div></div></div>`;
        const element = document.querySelector(".protyle");
        const editor = element.querySelector(".protyle-wysiwyg");
        const protyle = {element, contentElement: element.firstElementChild, wysiwyg: {element: editor},
            title: {editElement: element.querySelector(".protyle-title__input")},
            scroll: {lastScrollTop: 0, shouldKeepLoadedContent: () => false}};
        editor.firstElementChild?.setAttribute("data-eof", "1");
        editor.focus();
        return {protyle, editor};
    };
    window.siyuan.languages = {dragFill: "fill"};
    let cases = 0;
    // 自定义块内部形态不能改变外部所有者，连续按键必须经过外壳再离开。
    for (const content of ["plugin", '<input value="plugin">', '<div contenteditable="true">plugin editor</div>',
        `<div class="protyle-wysiwyg" contenteditable="true">${p("plugin")}</div>`]) {
        const {protyle, editor} = setup(p("before") +
            `<div class="custom-block" contenteditable="false" data-type="NodeCustomBlock" data-node-id="custom">${content}</div>` +
            p("after"));
        const [before, custom, after] = editor.children;
        assert.equal(targets.getAdjacentVerticalBlock(before, "down"), custom);
        assert.equal(targets.getAdjacentVerticalBlock(after, "up"), custom);
        navigation.bindVerticalNavigationReset(editor);
        window.navigationKeyup.bind(protyle);
        editor.addEventListener("keydown", event => {
            if (!["ArrowUp", "ArrowDown"].includes(event.key) || event.shiftKey) { return; }
            const range = selection.getEditorRange(editor);
            const owner = state.getAtomicVerticalNavigationOwner(range) ||
                load("util/hasClosest").hasClosestBlock(range.startContainer);
            assert.equal(navigation.focusAdjacentVerticalRegion(protyle, owner,
                event.key === "ArrowUp" ? "up" : "down", 20), "moved");
            protyle.wysiwyg.preventKeyup = true;
            event.preventDefault();
        });
        select(before.firstElementChild);
        for (const [key, expected] of [["Down", custom], ["Down", after], ["Up", custom], ["Up", before]]) {
            await ipcRenderer.invoke("vertical-navigation-key", key);
            await frame();
            const range = selection.getEditorRange(editor);
            assert.ok(expected === range.startContainer || expected.contains(range.startContainer), content);
            assert.equal(document.activeElement, editor);
            if (expected === custom) {
                assert.equal(state.getAtomicVerticalNavigationOwner(getSelection().getRangeAt(0)), custom);
                assert.equal(documentRange.containsCurrentSelection(custom), true);
            }
        }
        // 点击插件编辑区后不能再把其内部选区解释为外壳位置。
        custom.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        assert.equal(custom.classList.contains("protyle-wysiwyg--navigation"), false);
        cases++;
    }
    for (const loaded of [true, false]) {
        const {protyle, editor} = setup(p("first"));
        if (!loaded) {
            editor.firstElementChild.removeAttribute("data-eof");
            editor.firstElementChild.setAttribute("data-node-index", "200");
        }
        select(protyle.title.editElement);
        assert.equal(navigation.focusFirstVerticalRegion(protyle, 20), loaded ? "moved" : "blocked");
        select(editor.firstElementChild.firstElementChild);
        assert.equal(navigation.focusAdjacentVerticalRegion(protyle, editor.firstElementChild, "up", 20),
            loaded ? "moved" : "blocked");
        cases++;
    }
    for (const mode of [false, true]) {
        const {protyle, editor} = setup(p("before") +
            `<div class="custom-block" contenteditable="false" data-type="NodeCustomBlock" data-node-id="custom">
                <div class="protyle-wysiwyg" contenteditable="true">${p("plugin")}</div></div>` + p("after"));
        const [before, custom, after] = editor.children;
        const className = mode ? "protyle-wysiwyg--select-mode" : "protyle-wysiwyg--select";
        before.classList.add(className);
        navigation.bindVerticalNavigationReset(editor);
        load("wysiwyg/selectedNavigationKeydown").bind(protyle);
        select(before.firstElementChild);
        for (const [key, expected] of [["Down", custom], ["Down", after], ["Up", custom], ["Up", before]]) {
            await ipcRenderer.invoke("vertical-navigation-key", key);
            await frame();
            assert.equal(editor.querySelector("." + className), expected,
                mode + "/" + key + " expected " + expected.dataset.nodeId + " got " +
                editor.querySelector("." + className)?.dataset.nodeId);
            assert.equal(custom.querySelector("." + className), null);
        }
        cases++;
    }
    for (const span of [2, 3]) {
        const prefix = Array.from({length: span}, (_, i) => `<td>A${i}</td>`).join("");
        const {editor} = setup(`<div data-node-id="table"><table><tbody>
            <tr>${prefix}<td id="upper" rowspan="2">C0</td></tr>
            <tr><td colspan="${span}">AB1</td>${'<td class="fn__none" style="display:none"></td>'.repeat(span)}</tr>
            <tr>${prefix}<td id="lower">C2</td></tr></tbody></table></div>`);
        const upper = editor.querySelector("#upper");
        const lower = editor.querySelector("#lower");
        assert.equal(table.getVerticalTableCell(lower, "up"), upper);
        assert.equal(table.getVerticalTableCell(upper, "down"), lower);
        assert.equal(table.getVerticalTableCell(upper, "up"), undefined);
        assert.equal(table.getVerticalTableCell(lower, "down"), undefined);
        cases++;
    }
    // 序号始终基于整个编辑器，嵌入只校验作用域，不重新编号。
    for (const external of [true, false]) {
        for (const reverse of [true, false]) {
            const embedded = `<div data-node-id="heading">${p("same", "under heading")}</div>`;
            const separate = p("same", "separate");
            const {protyle, editor} = setup((external ? p("same", "source") : "") +
                `<div data-node-id="embed" data-type="NodeBlockQueryEmbed">${reverse ? separate + embedded : embedded + separate}</div>`);
            const copies = Array.from(editor.querySelectorAll('[data-node-id="same"]'));
            const expected = copies.find(element => element.textContent === "separate");
            const context = {undoFocusId: "same", undoFocusEndId: "same", undoFocusStart: "0", undoFocusEnd: "0",
                undoFocusIndex: String(copies.indexOf(expected)), undoFocusEndIndex: String(copies.indexOf(expected)),
                undoFocusEmbedId: "embed"};
            assert.equal(load("util/restoreNavigationFocus").restoreFocusContext(protyle, context), true);
            assert.equal(window.restoredFocusElement, expected);
            context.undoFocusIndex = "99";
            assert.equal(load("util/restoreNavigationFocus").restoreFocusContext(protyle, context), false);
            cases++;
        }
    }
    for (const count of [1, 2, 3]) {
        const {protyle, editor} = setup(Array.from({length: count}, (_, i) =>
            `<div data-type="NodeBlockQueryEmbed" data-node-id="outer${i}"><div data-node-id="container">
                <div data-type="NodeBlockQueryEmbed" data-node-id="embed">${p("same", "copy" + i)}</div>
            </div></div>`).join(""));
        const copies = Array.from(editor.querySelectorAll('[data-node-id="same"]'));
        copies.forEach((expected, index) => {
            const context = {undoFocusId: "same", undoFocusEndId: "same", undoFocusStart: "0", undoFocusEnd: "0",
                undoFocusIndex: String(index), undoFocusEndIndex: String(index), undoFocusEmbedId: "embed"};
            const restore = load("util/restoreNavigationFocus").restoreFocusContext;
            assert.equal(restore(protyle, context), true);
            assert.equal(window.restoredFocusElement, expected);
            assert.equal(restore(protyle, {...context, undoFocusEmbedId: "outer" + index}), false);
            if (count > 1) {
                assert.equal(restore(protyle, {...context, undoFocusEndIndex: String((index + 1) % count)}), false);
            }
            cases++;
        });
        copies.at(-1).parentElement.remove();
        assert.equal(load("util/restoreNavigationFocus").restoreFocusContext(protyle, {
            undoFocusId: "same", undoFocusIndex: String(count - 1), undoFocusEndIndex: String(count - 1),
            undoFocusStart: "0", undoFocusEnd: "0", undoFocusEmbedId: "embed",
        }), false);
    }
    for (const before of [true, false]) {
        for (const protect of [true, false]) {
            const {protyle, editor} = setup(Array.from({length: 100}, (_, i) => p("p" + i)).join(""));
            const target = before ? editor.lastElementChild : editor.firstElementChild;
            if (protect) {
                select(target.firstElementChild);
            } else {
                select(protyle.title.editElement);
            }
            const node = getSelection().anchorNode;
            const offset = getSelection().anchorOffset;
            protyle.contentElement.scrollTop = before ? 0 : 2500;
            load("util/navigationTrim").run(protyle, p("loaded"), before);
            assert.equal(target.isConnected, protect, "trim " + before + "/" + protect);
            if (protect) {
                assert.equal(getSelection().anchorNode, node);
                assert.equal(getSelection().anchorOffset, offset);
            }
            cases++;
        }
    }
    const virtual = load("render/av/virtualScroll");
    const avState = load("render/av/selectionState");
    const constants = load("../constants").Constants;
    const createAV = (id, protyle, editor, count = 100, offset = 0) => {
        const block = document.createElement("div");
        block.className = "av";
        block.dataset.avId = id;
        block.dataset.avType = "table";
        block.dataset.type = "NodeAttributeView";
        block.dataset.nodeId = id;
        block.setAttribute(constants.ATTRIBUTE_V_SCROLL, "true");
        block.setAttribute(constants.CUSTOM_SY_AV_VIEW, "view");
        const data = {viewType: "table", view: {id: "view", columns: [{id: "c0", type: "text"}],
            rows: Array.from({length: count}, (_, i) => ({id: "r" + i, cells: [{id: "v" + i}]}))},
            target: {offset}};
        block.innerHTML = '<div class="av__cursor"> </div><div class="av__header"></div><div class="av__body">' +
            '<div class="av__row av__row--header" style="position:sticky;top:0;height:30px"></div>' +
            data.view.rows.slice(0, 100).map((row, rowIndex) =>
                load("render/av/row").getRowHTML({row, rowIndex: rowIndex + offset})).join("") +
            '<div class="av__row av__row--util"></div></div>';
        editor.append(block);
        if (offset) {
            block.querySelector(".av__body").dataset.avLocateWindow = "true";
        }
        virtual.initVirtualScroll({protyle, blockElement: block, data});
        return block;
    };
    for (const count of [200, 1000]) {
        for (const offset of [0, 500]) {
            const {protyle, editor} = setup("");
            const block = createAV("boundary", protyle, editor, count, offset);
            assert.equal(load("render/av/focus").focusAVVerticalRegion(block, "up", 20, false), true);
            assert.equal(avState.getAVCellSelection(block).anchor.rowID, "r" + (count - 1));
            assert.equal(Number(block.querySelector(".av__cell--select").parentElement.dataset.index), count - 1 + offset);
            assert.ok(block.querySelectorAll(".av__row[data-id]").length < 100);
            assert.ok(protyle.contentElement.scrollTop > 0, "entry reveals the loaded boundary");
            virtual.trimAVRowsSync(block, protyle.contentElement.getBoundingClientRect());
            await new Promise(resolve => requestAnimationFrame(resolve));
            assert.equal(avState.getAVCellSelection(block).anchor.rowID, "r" + (count - 1));
            load("render/av/navigationKeydown").run(block, new KeyboardEvent("keydown", {key: "ArrowUp"}));
            assert.equal(avState.getAVCellSelection(block).anchor.rowID, "r" + (count - 2));
            assert.equal(load("render/av/focus").focusAVVerticalRegion(block, "down", 20, false), true);
            assert.equal(avState.getAVCellSelection(block).anchor.rowID, "r0");
            cases++;
        }
    }
    {
        const {protyle, editor} = setup("");
        const block = createAV("groups", protyle, editor, 200);
        const data = virtual.getAVData(block);
        const body = block.querySelector(".av__body");
        body.dataset.groupId = "visible";
        const hidden = body.cloneNode(true);
        hidden.dataset.groupId = "hidden";
        hidden.classList.add("fn__none");
        hidden.style.display = "none";
        const empty = body.cloneNode(true);
        empty.dataset.groupId = "empty";
        empty.querySelectorAll(".av__row[data-id]").forEach(row => row.remove());
        block.append(hidden, empty);
        data.view.groups = [{...data.view, id: "visible"}, {...data.view, id: "hidden", groupFolded: true},
            {...data.view, id: "empty", rows: []}];
        virtual.initVirtualScroll({protyle, blockElement: block, data});
        const last = virtual.ensureAVTableBoundaryRow(block, "up");
        assert.equal(last.dataset.id, "r199");
        assert.equal(last.closest(".av__body"), body);
        assert.ok(body.querySelectorAll(".av__row[data-id]").length < 100);
        virtual.setAVData(block, {...data, view: {...data.view, groups: [{...data.view.groups[0]}]}});
        hidden.remove();
        empty.remove();
        assert.equal(virtual.ensureAVTableBoundaryRow(block, "up"), undefined, "reject stale body state");
        cases++;
    }
    // 相同持久 ID 的副本也必须独立；不同数据库交错 trim 不得污染滚动方向。
    const {protyle, editor} = setup("");
    const block = createAV("database", protyle, editor);
    const cell = block.querySelector(".av__cell");
    assert.equal(load("render/av/focus").focusAVVerticalRegion(block, "down", 20, false,
        protyle.contentElement), true);
    assert.equal(avState.getAVCellSelection(block).anchor.rowID, "r0");
    load("render/av/navigationKeydown").run(block, new KeyboardEvent("keydown", {key: "ArrowDown"}));
    assert.equal(avState.getAVCellSelection(block).anchor.rowID, "r1");
    load("render/av/navigationKeydown").run(block, new KeyboardEvent("keydown", {key: "ArrowUp"}));
    assert.equal(avState.getAVCellSelection(block).anchor.rowID, "r0");
    const secondHost = protyle.element.cloneNode(false);
    secondHost.innerHTML = '<div style="height:180px;overflow:auto"><div class="protyle-wysiwyg"></div></div>';
    document.body.append(secondHost);
    const second = {element: secondHost, contentElement: secondHost.firstElementChild,
        wysiwyg: {element: secondHost.querySelector(".protyle-wysiwyg")}};
    const duplicate = createAV("database", second, second.wysiwyg.element);
    const other = createAV("other", second, second.wysiwyg.element);
    const trim = (target, owner) => virtual.trimAVRowsSync(target, owner.contentElement.getBoundingClientRect());
    protyle.contentElement.scrollTop = 2400;
    trim(block, protyle);
    assert.equal(cell.isConnected, false, "actual row trim");
    assert.equal(avState.getAVCellSelection(block).anchor.rowID, "r0");
    second.contentElement.scrollTop = 100;
    trim(duplicate, second);
    trim(other, second);
    protyle.contentElement.scrollTop = 0;
    trim(block, protyle);
    assert.equal(block.querySelector(".av__cell--select")?.parentElement.dataset.id, "r0");
    assert.equal(avState.getAVCellSelection(duplicate), undefined);
    assert.equal(avState.getAVCellSelection(other), undefined);
    cases++;
    const windowAfterScroll = (otherID) => {
        const {protyle: primary, editor: primaryEditor} = setup("");
        const primaryBlock = createAV("database", primary, primaryEditor);
        let otherBlock;
        let secondary;
        if (otherID) {
            const host = primary.element.cloneNode(false);
            host.style.position = "absolute";
            host.style.top = "0";
            host.style.left = "510px";
            host.innerHTML = '<div style="height:180px;overflow:auto"><div class="protyle-wysiwyg"></div></div>';
            document.body.append(host);
            secondary = {element: host, contentElement: host.firstElementChild,
                wysiwyg: {element: host.querySelector(".protyle-wysiwyg")}};
            otherBlock = createAV(otherID, secondary, secondary.wysiwyg.element);
        }
        primary.contentElement.scrollTop = 2400;
        trim(primaryBlock, primary);
        if (secondary) {
            secondary.contentElement.scrollTop = 1000;
            trim(otherBlock, secondary);
        }
        primary.contentElement.scrollTop = 2100;
        trim(primaryBlock, primary);
        return Array.from(primaryBlock.querySelectorAll(".av__row[data-id]"), row => row.dataset.id);
    };
    const standalone = windowAfterScroll();
    assert.deepEqual(windowAfterScroll("database"), standalone, "same database in two editors");
    assert.deepEqual(windowAfterScroll("other"), standalone, "interleaved independent databases");
    cases += 2;
    return cases;
};
