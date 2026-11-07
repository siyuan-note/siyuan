import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, css: string, typographyCSS: string) => {
    const check: typeof assert = require("node:assert/strict");
    const nodePath: typeof path = require("node:path");
    const noop = () => {};
    const lute = Lute.New();
    lute.SetProtyleWYSIWYG(true);
    lute.SetKramdownIAL(true);
    const fixtureStyle = document.createElement("style");
    fixtureStyle.textContent = ".protyle-util{position:fixed;top:8px;left:8px;right:8px}.block__icons{display:flex;height:42px}" +
        ".block__icons svg,.protyle-table-control svg{width:16px;height:16px}.fn__none{display:none}" +
        ".protyle-table-control__handle,.protyle-table-control__add,.protyle-table-control__touch-button{" +
        "position:fixed;width:28px;height:28px;transform:translate(-50%,-50%)}" +
        ".protyle-table-control__width-guide,.protyle-table-control__selection{position:fixed}";
    document.head.append(fixtureStyle);
    const transactions: {before: string, after: string}[] = [];
    const clipboard: {textPlain: string, textHTML?: string, textSiyuan?: string}[] = [];
    const pasted: {target: HTMLTableCellElement, textPlain: string}[] = [];
    const items: IMenu[] = [];
    let mobile = true;
    let clipboardFailure = false;
    let clipboardWait: Promise<void> | undefined;
    const menuElement = document.createElement("div");
    menuElement.id = "commonMenu";
    document.body.append(menuElement);
    const menuScrim = document.createElement("div");
    menuScrim.id = "commonMenuScrim";
    document.body.append(menuScrim);
    const menu = {element: menuElement, append: (element: HTMLElement) => menuElement.append(element),
        remove: () => { items.length = 0; menuElement.replaceChildren(); }, fullscreen: noop, popup: noop};
    const languages = new Proxy({}, {get: (_target, key: string) => key === "insertRowBefore" ||
        key === "insertRowAfter" || key === "insertColumnLeft1" || key === "insertColumnRight1" ? "${x}" : key});
    const hotkeys = new Proxy({}, {get: () => ({custom: ""})});
    Object.assign(window, {Lute: {NewNodeID: () => "20261017120000-newnode", Caret: ""},
        siyuan: {languages, zIndex: 10, menus: {menu}, config: {editor: {fontSize: 16},
        keymap: {editor: {general: hotkeys, table: hotkeys, insert: hotkeys}}}}});
    const focusByRange = (range: Range) => {
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    };
    const getEditorRange = (element: HTMLElement) => {
        const selection = getSelection();
        if (selection.rangeCount && element.contains(selection.anchorNode)) {
            return selection.getRangeAt(0);
        }
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(true);
        return range;
    };
    const constants = new Proxy<Record<string, string | number>>({ZWSP: "\u200b", TIMEOUT_LONGPRESS: 20,
        SIZE_DRAG_THRESHOLD: 5}, {get: (target, key: string) => target[key] || key});
    const stubs: Record<string, object | (() => object)> = {
        "src/constants.ts": {Constants: constants},
        "src/menus/menuToggle.ts": {toggleMenu: (options: {build: (menu: object, session: object) => void}) => {
            menu.remove();
            options.build(menu, {show: (show: () => void) => show()});
        }},
        "src/menus/Menu.ts": {MenuItem: class {
            element = document.createElement("button");
            constructor(item: IMenu) {
                items.push(item);
                this.element.innerHTML = item.label || "";
                item.bind?.(this.element);
                this.element.addEventListener("click", () => {
                    if (!item.disabled) {
                        item.click?.(this.element, undefined);
                    }
                });
            }
        }},
        "src/util/functions.ts": {isMobile: () => mobile},
        "src/util/escape.ts": {escapeAttr: (text: string) => text, escapeHtmlTextAndAttr: (text: string) => text},
        "src/protyle/wysiwyg/transaction.ts": {updateTransaction: (_protyle: object, node: HTMLElement, before: string) => {
            transactions.push({before, after: node.outerHTML});
        }},
        "src/protyle/util/selection.ts": {getEditorRange, getUndoFocusContext: () => ({}), focusByWbr: (node: HTMLElement) => {
            node.querySelector("wbr")?.remove();
        }},
        "src/protyle/util/selectionOffsets.ts": {focusByRange},
        "src/protyle/util/compatibility.ts": {isMac: () => false, encodeBase64: (value: string) => Buffer.from(value, "utf8").toString("base64"),
            copyPlainText: noop, readClipboard: async () => {
                await clipboardWait;
                return {textPlain: "pasted"};
            },
            writeClipboardData: async (value: {textPlain: string}) => {
                await clipboardWait;
                clipboard.push(value);
                return {status: clipboardFailure ? "failed" : "rich"};
            }},
        "src/protyle/util/normalizeText.ts": {removeZWJ: (value: string) => value},
        "src/protyle/util/paste.ts": {paste: (_protyle: object, value: {target: HTMLTableCellElement, textPlain: string}) =>
            pasted.push(value)},
        "src/protyle/util/inlineElementMarker.ts": {getTextWithoutSemanticMarkers: (node: Node) => node.textContent},
        "src/protyle/toolbar/tableCell.ts": {getTableCellTextStyleMenus: (): IMenu[] => [], applyTableCellStyleHotkey: () => false},
        "src/protyle/toolbar/inlineStyle.ts": {getInlineStylesCache: () => ({}), getVisibleOrderedStyleKeys: (): string[] => [],
            getInlineStyleIDFromValue: () => ""},
        "src/protyle/util/hotKey.ts": {matchHotKey: () => false},
        "src/protyle/render/tableCellRich.ts": {renderTableCellRichElements: noop},
        "src/protyle/util/blockDOMClipboard.ts": {buildBlockDOMClipboardRichData: (_lute: object, html: string) =>
            ({textHTML: html, textSiyuan: html})},
        "src/protyle/util/hasClosest.ts": {hasClosestByClassName: (node: Element, name: string) => node?.closest("." + name),
            hasClosestBlock: (node: Element) => node?.closest("[data-node-id]")},
        "src/dialog/message.ts": {showMessage: noop},
        "src/util/highlightById.ts": {scrollCenter: noop},
        "dayjs": () => ({format: () => "20261017120000"}),
    };
    const cache: Record<string, {exports: object}> = {};
    const load = (id: string): object => {
        if (stubs[id]) {
            return stubs[id];
        }
        if (cache[id]) {
            return cache[id].exports;
        }
        if (!sources[id]) {
            return {};
        }
        const module = {exports: {}};
        cache[id] = module;
        new Function("require", "module", "exports", sources[id])((name: string) => load(name.startsWith(".") ?
            nodePath.posix.normalize(nodePath.posix.join(nodePath.posix.dirname(id), name + ".ts")) : name), module, module.exports);
        return module.exports;
    };
    const {TableControl} = load("src/protyle/util/tableControl.ts") as typeof import("./tableControl");
    const context = load("src/protyle/util/tableCellRichContext.ts") as typeof import("./tableCellRichContext");
    const virtual = load("src/protyle/util/tableVirtualizationDOM.ts") as typeof import("./tableVirtualizationDOM");
    const rowHeight = load("src/protyle/util/tableRowHeight.ts") as typeof import("./tableRowHeight");
    const tableAPI = load("src/protyle/util/table.ts") as typeof import("./table");
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    const frames = async (count: number) => {
        for (let frame = 0; frame < count; frame++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
    };
    const pointer = (target: EventTarget, type: string, x = 0, y = 0, id = 1) => target.dispatchEvent(new PointerEvent(type,
        {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: id, pointerType: "touch"}));
    const touchEvent = (target: Element, type: string, x = 60, y = 110, count = 1) => {
        const points = Array.from({length: count}, (_, identifier) => new Touch({identifier, target, clientX: x, clientY: y}));
        const event = new TouchEvent(type, {bubbles: true, cancelable: true, changedTouches: points,
            touches: type === "touchend" || type === "touchcancel" ? [] : points});
        target.dispatchEvent(event);
        return event;
    };
    const fixture = (mindmap = false) => {
        const root = document.createElement("div");
        const editor = document.createElement("div");
        root.style.cssText = "position:absolute;left:0;top:0;width:360px;height:500px;overflow:auto";
        editor.className = "protyle-wysiwyg";
        editor.innerHTML = '<div data-node-id="20261017120000-tableaa" data-type="NodeTable" class="table"><div style="overflow:auto">' +
            '<table style="border-collapse:collapse;margin:40px 30px"><colgroup><col style="width:90px"><col style="width:90px"><col style="width:90px"></colgroup>' +
            "<thead><tr><th>H1</th><th>H2</th><th>H3</th></tr></thead><tbody>" +
            "<tr><td>A1</td><td>A2</td><td>A3</td></tr><tr><td>B1</td><td>B2</td><td>B3</td></tr>" +
            '<tr><td></td><td></td><td></td></tr></tbody></table><div class="protyle-action__table"><div class="table__select"></div></div></div></div>';
        root.append(editor);
        const scrollContainer = document.createElement("div");
        const map = document.createElement("div");
        if (mindmap) {
            scrollContainer.style.cssText = "position:fixed;left:0;top:0;width:500px;height:300px;overflow:auto";
            map.className = "mindmap-view";
            map.style.cssText = "position:relative;width:500px;height:700px";
            map.innerHTML = '<div class="mindmap-view__world" style="transform:translate(20px,20px) scale(.75);transform-origin:0 0">' +
                '<div class="mindmap-view__node" style="position:absolute;left:10px;top:10px"></div></div>';
            map.querySelector(".mindmap-view__node").append(root);
            scrollContainer.append(map);
            document.body.append(scrollContainer);
        } else {
            document.body.append(root);
        }
        editor.querySelectorAll<HTMLElement>("td, th").forEach(cell => cell.style.height = "42px");
        let blockMultiSelect = false;
        const owner = {element: root, contentElement: root, disabled: false,
            toolbar: {isMultiSelectMode: () => blockMultiSelect}, options: {},
            wysiwyg: {element: editor}, lute: {}, block: {rootID: "root"}} as unknown as IProtyle;
        const core = new TableControl(owner, editor);
        owner.wysiwyg.tableControl = core;
        const cell = (row: number, col: number) => editor.querySelector("table").rows[row].cells[col];
        const render = () => Reflect.get(core, "render").call(core);
        const invoke = (name: string, ...args: unknown[]) => Reflect.get(core, name).apply(core, args);
        const touch = (selector: string) => root.querySelector<HTMLElement>(selector);
        const dispose = () => { core.destroy(); root.remove(); scrollContainer.remove(); getSelection().removeAllRanges(); };
        return {root, editor, owner, core, map, scrollContainer, get table() { return editor.querySelector("table"); }, cell, render, invoke, touch, dispose,
            setBlockMultiSelect: (value: boolean) => { blockMultiSelect = value; }};
    };
    {
        const f = fixture();
        const cell = f.cell(1, 0);
        touchEvent(cell, "touchstart");
        await tick();
        check.equal(f.core.hasTouchSelection(), true, "holding an inactive cell enters cell selection");
        check.deepEqual(f.core.getSelectedCells(), [cell]);
        check.equal(touchEvent(cell, "touchend").defaultPrevented, true, "release consumes the long press instead of editing");
        check.equal(cell.classList.contains("table__cell--touch-selecting"), false);
        const menu = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
        cell.dispatchEvent(menu);
        check.equal(menu.defaultPrevented, true, "the same long press cannot open another context menu");
        f.core.clear();
        const range = document.createRange();
        range.selectNodeContents(cell);
        range.collapse(true);
        focusByRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        f.render();
        check.equal(f.touch("[data-action='select']"), null, "cell selection no longer adds a checkmark button");
        check.equal(f.touch("[data-action='width']"), null, "an editing caret does not expose a ruler button");
        f.dispose();
    }
    {
        const f = fixture();
        const focus = (cell: HTMLTableCellElement) => {
            const range = document.createRange();
            range.selectNodeContents(cell);
            range.collapse(true);
            focusByRange(range);
            document.dispatchEvent(new Event("selectionchange"));
            f.render();
        };
        for (const [row, col] of [[1, 1], [2, 2]]) {
            const cell = f.cell(row, col);
            focus(cell);
            const handles = f.root.querySelectorAll(".protyle-table-control__touch-handle");
            check.equal(handles.length, 2, "only the focused row and column expose handles");
            handles.forEach(handle => {
                check.equal(handle.classList.contains("protyle-table-control__handle--active"), true,
                    "focused handles always use the shared blue dotted style");
                check.equal(handle.getAttribute("aria-pressed"), "false", "focus does not imply a row or column selection");
            });
            const rect = cell.getBoundingClientRect();
            const rowHandle = f.touch("[data-mode='row']").getBoundingClientRect();
            const columnHandle = f.touch("[data-mode='column']").getBoundingClientRect();
            check.equal(rowHandle.top + rowHandle.height / 2, rect.top + rect.height / 2);
            check.equal(columnHandle.left + columnHandle.width / 2, rect.left + rect.width / 2);
        }
        for (const mode of ["row", "column"] as const) {
            f.core.clear();
            const cell = f.cell(2, 2);
            focus(cell);
            const handle = f.touch(`[data-mode='${mode}']`);
            const rect = handle.getBoundingClientRect();
            pointer(handle, "pointerdown", rect.left + rect.width / 2, rect.top + rect.height / 2);
            pointer(document, "pointerup", rect.left + rect.width / 2, rect.top + rect.height / 2);
            f.render();
            check.equal(f.invoke("getTouchState").cell, cell, "selecting an axis preserves the focused cell on the other axis");
            check.equal(f.touch(`[data-mode='${mode}']`).getAttribute("aria-pressed"), "true");
        }
        f.dispose();
    }
    {
        const f = fixture();
        const merged = f.cell(1, 1);
        merged.colSpan = 2;
        f.cell(1, 2).remove();
        merged.rowSpan = 2;
        f.cell(2, 2).remove();
        f.cell(2, 1).remove();
        f.core.startTouchSelection(merged);
        f.render();
        const state = f.invoke("getTouchState");
        const row = f.table.rows[1].getBoundingClientRect();
        const col = f.table.querySelectorAll("col")[1].getBoundingClientRect();
        check.deepEqual(state.row, {index: 1, top: row.top, bottom: row.bottom});
        check.deepEqual(state.column, {index: 1, left: col.left, right: col.right},
            "merged cells use logical row and column geometry shared with desktop");
        f.table.style.minWidth = "270px";
        f.table.parentElement.style.width = "90px";
        f.render();
        check.equal(f.touch("[data-mode='column']"), null, "an offscreen focused column has no misplaced handle");
        check.notEqual(f.touch("[data-mode='row']"), null, "the visible focused row retains its handle");
        f.table.parentElement.scrollLeft = 150;
        f.render();
        check.notEqual(f.touch("[data-mode='column']"), null, "scrolling the focused column into view restores its handle");
        f.dispose();
    }
    for (const kind of ["tap", "move", "cancel", "scroll", "multiple", "blur", "disabled", "block", "removed"]) {
        const f = fixture();
        const cell = f.cell(1, 0);
        if (kind === "disabled") f.owner.disabled = true;
        if (kind === "block") f.setBlockMultiSelect(true);
        touchEvent(cell, "touchstart");
        if (kind === "tap") check.equal(touchEvent(cell, "touchend").defaultPrevented, false);
        if (kind === "move") check.equal(touchEvent(cell, "touchmove", 66, 110).defaultPrevented, false);
        if (kind === "cancel") touchEvent(cell, "touchcancel");
        if (kind === "scroll") f.root.dispatchEvent(new Event("scroll"));
        if (kind === "multiple") touchEvent(cell, "touchstart", 60, 110, 2);
        if (kind === "blur") window.dispatchEvent(new Event("blur"));
        if (kind === "removed") cell.parentElement.remove();
        await tick();
        check.equal(f.core.hasTouchSelection(), false, `${kind} leaves the table unselected`);
        check.equal(cell.classList.contains("table__cell--touch-selecting"), false, `${kind} clears temporary touch state`);
        f.dispose();
    }
    for (const kind of ["editing", "link"]) {
        const f = fixture();
        const cell = f.cell(1, 0);
        const target = document.createElement(kind === "editing" ? "div" : "a");
        if (kind === "editing") target.className = "table__cell-editor";
        cell.append(target);
        touchEvent(target, "touchstart");
        await tick();
        check.equal(f.core.hasTouchSelection(), false, `${kind} retains its own long-press behavior`);
        check.equal(touchEvent(target, "touchend").defaultPrevented, false);
        f.dispose();
    }
    {
        const f = fixture();
        check.equal(f.core.startTouchSelection(f.cell(1, 0)), true);
        f.render();
        const toolbar = f.touch(".protyle-table-control__toolbar");
        check.equal(toolbar.querySelector(".multiSelectCount").textContent, "1");
        check.equal(toolbar.classList.contains("protyle-util--mobile"), true);
        const active = f.core.getSelectedCells()[0];
        pointer(f.cell(2, 2), "pointerdown", 210, 150);
        pointer(f.cell(2, 2), "pointermove", 200, 100);
        pointer(f.cell(2, 2), "pointercancel", 200, 100);
        check.equal(f.core.getSelectedCells()[0], active, "scroll gestures preserve the selection");
        const multi = f.touch("[data-type='multi']");
        pointer(multi, "pointerdown");
        check.equal(f.core.hasTouchSelection(), true, "touching the top toolbar retains the table selection");
        pointer(multi, "pointerup");
        multi.click();
        f.cell(2, 2).click();
        f.render();
        check.equal(f.core.getSelectedCells().length, 2);
        check.equal(toolbar.querySelector(".multiSelectCount").textContent, "2");
        check.equal((f.touch("[data-type='copy']") as HTMLButtonElement).disabled, true, "nonrectangular copying stays disabled");
        f.cell(2, 2).click();
        check.equal(f.core.getSelectedCells().length, 1);
        f.touch("[data-type='selectAll']").click();
        check.equal(f.core.getSelectedCells().length, 12);
        f.touch("[data-type='menu']").click();
        check.equal(items.some(item => item.label === "mergeCell"), true, "the shared menu button opens table operations");
        pointer(menuScrim, "pointerdown");
        check.equal(f.core.hasTouchSelection(), true, "dismissing the menu sheet preserves the selection");
        f.touch("[data-type='exitMultiSelectMode']").click();
        check.equal(f.core.hasTouchSelection(), false);
        f.render();
        check.equal(toolbar.classList.contains("fn__none"), true);
        check.equal(f.table.rows.length, 4);
        f.dispose();
    }
    for (const mode of ["cell", "row", "column"] as const) {
        const f = fixture();
        f.editor.style.minHeight = "1400px";
        f.core.startTouchSelection(f.cell(3, 1), mode);
        f.render();
        const endpoint = f.touch("[data-endpoint='end']");
        const rect = endpoint.getBoundingClientRect();
        const count = f.core.getSelectedCells().length;
        pointer(endpoint, "pointerdown", rect.left + rect.width / 2, rect.top + rect.height / 2);
        await frames(4);
        check.equal(f.root.scrollTop, 0, `${mode} endpoints do not scroll while held still`);
        check.equal(f.core.getSelectedCells().length, count, "holding an endpoint does not change the selection");
        pointer(document, "pointermove", rect.left + rect.width / 2 - 10, rect.top + rect.height / 2 - 5);
        await frames(4);
        check.equal(f.root.scrollTop, 0, "dragging near a fully visible table edge does not scroll the document");
        f.root.scrollTop = 20;
        await frames(4);
        const focusedRow = f.cell(3, 1).parentElement.getBoundingClientRect();
        const column = f.touch("[data-mode='column']").getBoundingClientRect();
        const row = f.touch("[data-mode='row']").getBoundingClientRect();
        check.equal(row.top + row.height / 2,
            (Math.max(focusedRow.top, column.top + column.height / 2) + focusedRow.bottom) / 2,
            "row handles follow scrolling while an endpoint is being dragged");
        pointer(document, "pointercancel");
        f.dispose();
    }
    {
        const f = fixture();
        f.editor.style.minHeight = "1400px";
        f.editor.querySelectorAll<HTMLElement>("td, th").forEach(cell => cell.style.height = "150px");
        const maxScroll = f.table.getBoundingClientRect().bottom - f.root.getBoundingClientRect().bottom;
        f.core.startTouchSelection(f.cell(1, 0));
        f.render();
        const endpoint = f.touch("[data-endpoint='end']");
        const rect = endpoint.getBoundingClientRect();
        pointer(endpoint, "pointerdown", rect.left + rect.width / 2, rect.top + rect.height / 2);
        pointer(document, "pointermove", 165, 490);
        await frames(8);
        check.ok(f.root.scrollTop > 0, "dragging to the editor viewport edge reveals hidden table rows");
        const selection = f.touch(".protyle-table-control__selection:not(.fn__none)").getBoundingClientRect();
        check.ok(Math.abs(selection.top - f.core.getSelectedCells()[0].getBoundingClientRect().top) <= 12,
            "selection painting keeps up with continuous automatic scrolling");
        await frames(24);
        check.ok(f.root.scrollTop <= maxScroll + 10, "automatic scrolling stops after the last table row becomes visible");
        const stopped = f.root.scrollTop;
        await frames(4);
        check.equal(f.root.scrollTop, stopped);
        pointer(document, "pointerup");
        f.dispose();
    }
    for (const axis of ["horizontal", "vertical"]) {
        const f = fixture();
        f.editor.style.minHeight = "1400px";
        const wrapper = f.table.parentElement;
        wrapper.style[axis === "horizontal" ? "width" : "height"] = axis === "horizontal" ? "180px" : "130px";
        if (axis === "horizontal") f.table.style.minWidth = "270px";
        f.core.startTouchSelection(f.cell(1, 0));
        f.render();
        const endpoint = f.touch("[data-endpoint='end']");
        const rect = endpoint.getBoundingClientRect();
        pointer(endpoint, "pointerdown", rect.left + rect.width / 2, rect.top + rect.height / 2);
        pointer(document, "pointermove", axis === "horizontal" ? 175 : 110, axis === "horizontal" ? 110 : 128);
        await frames(6);
        check.ok((axis === "horizontal" ? wrapper.scrollLeft : wrapper.scrollTop) > 0,
            `${axis} scrolling uses the table's own scroll container`);
        check.equal(f.root.scrollTop, 0, "scrolling inside a table leaves the surrounding document in place");
        pointer(document, "pointercancel");
        const stopped = axis === "horizontal" ? wrapper.scrollLeft : wrapper.scrollTop;
        await frames(3);
        check.equal(axis === "horizontal" ? wrapper.scrollLeft : wrapper.scrollTop, stopped,
            "canceling an endpoint drag stops automatic scrolling");
        f.dispose();
    }
    {
        const f = fixture();
        f.core.startTouchSelection(f.cell(1, 0));
        f.render();
        const endpoint = f.touch("[data-endpoint='end']");
        const rect = f.cell(2, 1).getBoundingClientRect();
        pointer(endpoint, "pointerdown", 120, 120);
        pointer(document, "pointermove", rect.left + rect.width / 2, rect.top + rect.height / 2);
        pointer(document, "pointerup");
        check.equal(f.core.getSelectedCells().length, 4, "range endpoints expand a rectangular selection");
        f.invoke("openMenu", 0, 0);
        const merge = items.find(item => item.label === "mergeCell");
        check.equal(merge.disabled, false);
        merge.click(undefined, undefined);
        check.equal(f.cell(1, 0).rowSpan, 2);
        check.equal(f.cell(1, 0).colSpan, 2);
        check.match(f.cell(1, 0).innerHTML, /A1.*A2.*B1.*B2/);
        f.core.splitCell(f.cell(1, 0));
        check.equal(f.cell(1, 0).rowSpan, 1);
        check.equal(f.table.querySelectorAll(".fn__none").length, 0);
        f.core.selectCellRange(f.cell(0, 0), f.cell(1, 0));
        f.invoke("openMenu", 0, 0);
        check.equal(items.find(item => item.label === "mergeCell").disabled, false,
            "header and body cells can form a multi-row header");
        f.dispose();
    }
    {
        mobile = false;
        const geometryStyle = document.createElement("style");
        geometryStyle.textContent = css;
        document.head.append(geometryStyle);
        const f = fixture(true);
        const controls = f.root.querySelector<HTMLElement>(".protyle-table-control");
        f.map.append(controls);
        const cell = f.cell(1, 0);
        f.core.selectCellRange(cell, cell);
        await frames(2);
        const aligned = () => {
            const selection = controls.querySelector<HTMLElement>(".protyle-table-control__selection");
            const rect = cell.getBoundingClientRect();
            check.ok(selection && !selection.classList.contains("fn__none"));
            const painted = selection.getBoundingClientRect();
            for (const edge of ["left", "top", "right", "bottom"] as const) {
                check.ok(Math.abs(painted[edge] - rect[edge]) < 1, `selection ${edge} follows the table screen coordinates`);
            }
        };
        aligned();
        for (const scale of [.65, 1, 1.5]) {
            f.map.querySelector<HTMLElement>(".mindmap-view__world").style.transform = `translate(30px, 15px) scale(${scale})`;
            await frames(2);
            aligned();
        }
        f.map.querySelector<HTMLElement>(".mindmap-view__node").style.left = "45px";
        f.map.querySelector<HTMLElement>(".mindmap-view__node").style.top = "20px";
        await frames(2);
        aligned();
        f.scrollContainer.scrollTop = 30;
        await frames(2);
        check.equal(f.scrollContainer.scrollTop, 30, "the outer document actually scrolls");
        aligned();
        let renders = 0;
        Reflect.set(f.core, "render", () => renders++);
        f.core.destroy();
        f.map.querySelector<HTMLElement>(".mindmap-view__world").style.transform = "scale(.5)";
        f.scrollContainer.scrollTop = 50;
        await frames(2);
        check.equal(renders, 0, "destroy disconnects geometry observers and scroll listeners");
        check.equal(controls.isConnected, false);
        f.root.remove();
        f.scrollContainer.remove();
        geometryStyle.remove();
        getSelection().removeAllRanges();
    }
    for (const touchMode of [true, false]) {
        mobile = touchMode;
        {
            const typographyStyle = document.createElement("style");
            typographyStyle.textContent = typographyCSS;
            document.head.append(typographyStyle);
            for (const fontSize of [16, 32]) {
                for (const dark of [false, true]) {
                    const f = fixture();
                    f.root.style.width = touchMode ? "360px" : "800px";
                    f.root.style.setProperty("--b3-font-size-editor", `${fontSize}px`);
                    f.root.style.setProperty("--b3-theme-surface-lighter", dark ? "#444" : "#ddd");
                    f.root.style.color = dark ? "#eee" : "#222";
                    f.root.style.backgroundColor = dark ? "#222" : "#fff";
                    f.table.removeAttribute("style");
                    f.table.innerHTML = '<thead><tr><th colspan="2">Before</th><th class="fn__none"></th>' +
                        '<th colspan="2">After</th><th class="fn__none"></th></tr>' +
                        "<tr><th>Usage</th><th>Price</th><th>Usage</th><th>Price</th></tr></thead><tbody>" +
                        "<tr><td>0-360</td><td>2.53</td><td>0-360</td><td>2.91</td></tr>" +
                        '<tr><td>360-600</td><td>2.78</td><td rowspan="2">360-1100</td><td rowspan="2">3.49</td></tr>' +
                        '<tr><td>600+</td><td>3.54</td><td class="fn__none"></td><td class="fn__none"></td></tr>' +
                        "<tr><td></td><td></td><td>1100+</td><td>4.37</td></tr></tbody>";
                    const node = f.table.closest<HTMLElement>('[data-type="NodeTable"]');
                    const heights = () => Array.from(f.table.rows).map(row => row.getBoundingClientRect().height);
                    const before = heights();
                    const count = transactions.length;
                    for (const column of [0, 1]) {
                        check.equal(f.core.selectCellRange(f.cell(4, column), f.cell(5, column)), true);
                        f.invoke("openMenu", 0, 0);
                        const merge = items.find(item => item.label === "mergeCell");
                        check.equal(merge.disabled, false);
                        merge.click(undefined, undefined);
                        check.deepEqual(heights(), before, "staggered vertical merges retain every logical row's height");
                    }
                    check.equal(transactions.length, count + 2, "each merge remains a single undoable transaction");
                    check.equal(before[4], fontSize * 1.625 + 9, "the row minimum follows the editor font size");
                    check.equal(f.cell(3, 2).rowSpan, 2, "adjacent merged cells retain their span");
                    check.equal(f.cell(4, 1).rowSpan, 2);
                    check.equal(f.cell(4, 1).textContent, "3.54");
                    const preview = document.createElement("div");
                    preview.className = "b3-typography";
                    preview.style.lineHeight = "1.625";
                    f.root.append(preview);
                    for (const html of [lute.SpinBlockDOM(node.outerHTML),
                        lute.Md2BlockDOM(lute.BlockDOM2Md(node.outerHTML)), lute.BlockDOM2HTML(node.outerHTML)]) {
                        preview.innerHTML = html;
                        check.equal(preview.querySelectorAll("tr").length, 6);
                        const previewHeights = Array.from(preview.querySelectorAll("tr"))
                            .map(row => row.getBoundingClientRect().height);
                        check.ok(previewHeights[0] >= parseFloat(getComputedStyle(preview).fontSize),
                            "previews and exports keep a visible minimum at their own font size");
                        check.ok(previewHeights.every(height => height === previewHeights[0]),
                            "internal and HTML conversions retain every logical row's height");
                    }
                    preview.remove();
                    const row = f.table.rows[4];
                    for (const height of [12, 90]) {
                        row.style.height = `${height}px`;
                        check.equal(row.getBoundingClientRect().height, height, "explicit row heights override the automatic minimum");
                    }
                    row.removeAttribute("style");
                    const multiline = f.cell(2, 0);
                    multiline.innerHTML = "first<br>second<br>third";
                    check.ok(f.table.rows[2].getBoundingClientRect().height > before[2],
                        "multiline content can grow beyond the automatic row height");
                    const content = document.createRange();
                    content.selectNodeContents(multiline);
                    check.ok(content.getBoundingClientRect().bottom <= multiline.getBoundingClientRect().bottom -
                        parseFloat(getComputedStyle(multiline).paddingBottom), "expanded rows contain their final text line");
                    f.dispose();
                }
            }
            typographyStyle.remove();
        }
        {
            const f = fixture();
            const node = f.table.closest<HTMLElement>('[data-type="NodeTable"]');
            node.setAttribute("custom-pinthead", "true");
            const rich = Buffer.from(JSON.stringify({spec: 1, format: "kramdown", content: "kept"})).toString("base64url");
            f.cell(1, 2).setAttribute("data-sy-table-cell-rich", rich);
            f.cell(1, 2).style.textAlign = "right";
            f.cell(1, 2).rowSpan = 2;
            f.cell(2, 2).classList.add("fn__none");
            const count = transactions.length;
            f.core.selectCellRange(f.cell(1, 0), f.cell(0, 0));
            f.invoke("openMenu", 0, 0);
            const merge = items.find(item => item.label === "mergeCell");
            check.equal(merge.disabled, false);
            merge.click(undefined, undefined);
            check.equal(transactions.length, count + 1, "merging and promoting rows form one undoable transaction");
            check.equal(f.table.tHead.rows.length, 3, "header expansion includes other vertical spans in promoted rows");
            check.equal(f.table.tBodies[0].rows.length, 1);
            check.equal(f.cell(0, 0).rowSpan, 2);
            check.match(f.cell(0, 0).innerHTML, /H1.*A1/);
            check.equal(f.cell(1, 0).classList.contains("fn__none"), true);
            check.equal(f.cell(1, 2).getAttribute("data-sy-table-cell-rich"), rich);
            check.equal(f.cell(1, 2).style.textAlign, "right");
            check.equal(f.cell(1, 2).tagName, "TH");
            check.equal(node.getAttribute("custom-pinthead"), "true");
            const restored = document.createElement("div");
            restored.innerHTML = lute.Md2BlockDOM(lute.BlockDOM2Md(node.outerHTML));
            check.equal(restored.querySelector("thead").children.length, 3);
            check.equal(restored.querySelector("th").rowSpan, 2);
            check.equal(restored.querySelectorAll("th")[5].getAttribute("data-sy-table-cell-rich"), rich,
                "the operation result retains rich sources after an internal format round trip");
            const before = document.createElement("div");
            before.innerHTML = transactions[count].before;
            check.equal(before.querySelector("thead").children.length, 1, "undo retains the original header boundary");
            check.equal(before.querySelector("tbody td").textContent, "A1");
            f.invoke("selectFromCell", "cell", f.cell(2, 1), false, true);
            check.equal(f.core.getSelectedCells().length, 5, "Shift selection continues from the merged cell after promotion");
            f.core.splitCell(f.cell(0, 0));
            check.equal(f.table.tHead.rows.length, 3, "splitting retains the explicit multi-row header");
            check.equal(f.cell(1, 0).classList.contains("fn__none"), false);
            check.equal(f.cell(1, 2).rowSpan, 2, "splitting leaves adjacent merged cells intact");
            tableAPI.splitTableCell(f.cell(1, 2));
            check.equal(f.table.tHead.rows.length, 3, "the context menu fallback also retains header rows");
            check.equal(f.cell(2, 2).classList.contains("fn__none"), false);
            f.dispose();
        }
        {
            const f = fixture();
            const node = f.table.closest<HTMLElement>('[data-type="NodeTable"]');
            f.cell(1, 0).rowSpan = 2;
            f.cell(2, 0).classList.add("fn__none");
            tableAPI.normalizeTableSections(f.table, 3);
            const original = node.outerHTML;
            const count = transactions.length;
            for (const [row, offset] of [[1, -1], [1, 1], [2, -1], [2, 1], [0, 1]]) {
                const move = offset < 0 ? tableAPI.moveRowToUp : tableAPI.moveRowToDown;
                move(f.owner, getEditorRange(f.cell(row, 1)), f.cell(row, 1), node);
                check.equal(node.outerHTML, original, "moving an anchor, covered row or its neighbor cannot cut a rowspan");
                check.equal(transactions.length, count);
            }
            f.table.tBodies[0].replaceChildren();
            const headerOnly = node.outerHTML;
            tableAPI.moveRowToDown(f.owner, getEditorRange(f.cell(2, 1)), f.cell(2, 1), node);
            check.equal(node.outerHTML, headerOnly, "the last header row cannot move into an empty body");
            f.dispose();
        }
        for (const source of ["control", "cell"]) {
            const f = fixture();
            const node = f.table.closest<HTMLElement>('[data-type="NodeTable"]');
            f.cell(0, 0).style.textAlign = "right";
            const range = getEditorRange(f.cell(0, 0));
            const before = transactions.length;
            if (source === "control") {
                f.invoke("insertRowAt", node, f.table, 0, 2, true);
            } else {
                tableAPI.insertRowAbove(f.owner, range, f.cell(0, 0), node, 2, true);
            }
            check.equal(transactions.length, before + 1);
            check.equal(f.table.tHead.rows.length, 3, "prepending rows expands rather than replaces the header");
            check.equal(f.cell(2, 0).textContent, "H1");
            check.equal(f.cell(0, 0).style.textAlign, "right");
            check.equal(f.cell(3, 0).textContent, "A1");
            tableAPI.insertRow(f.owner, getEditorRange(f.cell(0, 0)), f.cell(0, 0), node, 2);
            check.equal(f.table.tHead.rows.length, 5, "inserting inside the header stays in the header");
            check.equal(f.cell(1, 0).tagName, "TH");
            tableAPI.insertRow(f.owner, getEditorRange(f.cell(4, 0)), f.cell(4, 0), node);
            check.equal(f.table.tHead.rows.length, 5, "inserting after the last header row creates a body row");
            check.equal(f.cell(5, 0).tagName, "TD");
            f.dispose();
        }
        for (const source of ["control", "cell"]) {
            const f = fixture();
            const node = f.table.closest<HTMLElement>('[data-type="NodeTable"]');
            f.invoke("selectFromCell", "row", f.cell(0, 1), false, false);
            f.invoke("openMenu", 0, 0);
            const insertHeader = items.find(item => item.id === "insertTableHeaderRow");
            check.ok(insertHeader, "header row menus expose explicit header insertion on both platforms");
            if (source === "control") {
                insertHeader.click(undefined, undefined);
            } else {
                tableAPI.insertTableHeaderRow(f.owner, getEditorRange(f.cell(0, 1)), f.cell(0, 1), node);
            }
            check.equal(f.table.tHead.rows.length, 2);
            check.equal(f.cell(1, 0).textContent, "H1");
            if (source === "control") {
                f.invoke("insertRowAt", node, f.table, 0, 2);
            } else {
                tableAPI.insertRowAbove(f.owner, getEditorRange(f.cell(0, 1)), f.cell(0, 1), node, 2);
                const caret = getSelection().anchorNode;
                check.equal((caret instanceof Element ? caret : caret.parentElement).closest("th"), f.cell(0, 1),
                    "ordinary insertion retains the caret column after changing cell tags");
            }
            check.equal(f.table.tHead.rows.length, 1, "ordinary insertion replaces the header instead of expanding it");
            check.equal(f.cell(3, 0).textContent, "H1");
            check.equal(f.cell(3, 0).tagName, "TD");
            f.invoke("selectFromCell", "row", f.cell(3, 0), false, false);
            f.invoke("openMenu", 0, 0);
            check.equal(items.some(item => item.id === "insertTableHeaderRow"), false, "body menus omit header insertion");
            const original = node.outerHTML;
            tableAPI.insertTableHeaderRow(f.owner, getEditorRange(f.cell(3, 0)), f.cell(3, 0), node);
            check.equal(node.outerHTML, original, "header insertion rejects body targets");
            f.owner.disabled = true;
            tableAPI.insertTableHeaderRow(f.owner, getEditorRange(f.cell(0, 0)), f.cell(0, 0), node);
            check.equal(node.outerHTML, original, "header insertion respects readonly mode");
            f.dispose();
        }
        {
            const f = fixture();
            const node = f.table.closest<HTMLElement>('[data-type="NodeTable"]');
            f.cell(0, 0).rowSpan = 2;
            f.cell(1, 0).classList.add("fn__none");
            tableAPI.normalizeTableSections(f.table);
            tableAPI.insertRowAbove(f.owner, getEditorRange(f.cell(1, 1)), f.cell(1, 1), node, 2);
            check.equal(f.table.tHead.rows.length, 4);
            check.equal(f.cell(0, 0).rowSpan, 4, "batch insertion extends an existing vertical merge by the whole count");
            check.equal(f.cell(3, 1).textContent, "A2");
            check.equal(f.cell(4, 0).textContent, "B1");
            f.dispose();
        }
        {
            const f = fixture();
            const node = f.table.closest<HTMLElement>('[data-type="NodeTable"]');
            f.invoke("insertRowAt", node, f.table, 0, 1, true);
            f.cell(0, 0).textContent = "top";
            const rich = Buffer.from(JSON.stringify({spec: 1, format: "kramdown", content: "kept"})).toString("base64url");
            f.cell(1, 0).setAttribute("data-sy-table-cell-rich", rich);
            f.cell(1, 0).style.textAlign = "right";
            f.invoke("selectFromCell", "row", f.cell(2, 0), false, false);
            f.invoke("moveSelection", 1);
            check.equal(f.table.tHead.rows.length, 2, "moving rows retains the header row count");
            check.equal(f.cell(1, 0).textContent, "A1");
            check.equal(f.cell(2, 0).getAttribute("data-sy-table-cell-rich"), rich);
            check.equal(f.cell(2, 0).style.textAlign, "right");
            tableAPI.moveRowToUp(f.owner, getEditorRange(f.cell(2, 0)), f.cell(2, 0), node);
            check.equal(f.cell(0, 0).textContent, "top", "the cell menu exchanges the last header row at the boundary");
            check.equal(f.cell(1, 0).textContent, "H1");
            check.equal(f.cell(1, 0).getAttribute("data-sy-table-cell-rich"), rich);
            tableAPI.moveRowToUp(f.owner, getEditorRange(f.cell(1, 0)), f.cell(1, 0), node);
            check.equal(f.cell(0, 0).textContent, "H1", "header rows can move within the header");
            tableAPI.moveRowToDown(f.owner, getEditorRange(f.cell(1, 0)), f.cell(1, 0), node);
            check.equal(f.table.tHead.rows.length, 2);
            check.equal(f.cell(1, 0).textContent, "A1");
            check.equal(f.cell(2, 0).textContent, "top");
            f.invoke("selectFromCell", "row", f.cell(0, 0), false, false);
            f.invoke("duplicateRowsOrColumns");
            check.equal(f.table.tHead.rows.length, 3, "duplicating an interior header row keeps it in the header");
            check.equal(f.cell(1, 0).tagName, "TH");
            check.equal(f.cell(1, 0).getAttribute("data-sy-table-cell-rich"), rich);
            f.invoke("selectFromCell", "row", f.cell(2, 0), false, false);
            f.invoke("duplicateRowsOrColumns");
            check.equal(f.table.tHead.rows.length, 3, "duplicating the last header row inserts into the body");
            check.equal(f.cell(3, 0).textContent, "A1");
            check.equal(f.core.getSelectedCells()[0], f.cell(3, 0), "the duplicate stays selected at its actual position");
            f.dispose();
        }
    }
    mobile = true;
    {
        const f = fixture();
        f.core.startTouchSelection(f.cell(1, 0), "row");
        f.core.startTouchSelection(f.cell(2, 0), "row", false, true);
        check.equal(f.core.getSelectedCells().length, 6);
        f.invoke("duplicateRowsOrColumns");
        check.equal(f.table.rows.length, 6);
        check.equal(f.table.rows[3].textContent, "A1A2A3");
        check.equal(f.table.rows[4].textContent, "B1B2B3");
        f.core.startTouchSelection(f.cell(1, 0), "column");
        f.core.startTouchSelection(f.cell(1, 2), "column", true);
        check.equal(f.core.getSelectedCells().length, 12);
        f.invoke("setSelectedColumnWidth");
        check.equal(f.table.querySelectorAll("col")[0].getAttribute("style"), null);
        f.invoke("distributeSelectedColumnWidths");
        check.equal((f.table.querySelectorAll("col")[0] as HTMLElement).style.width,
            (f.table.querySelectorAll("col")[2] as HTMLElement).style.width);
        f.dispose();
    }
    {
        const f = fixture();
        const header = f.cell(0, 0);
        const headerRect = header.getBoundingClientRect();
        check.equal(f.touch("[data-action='width']"), null, "column resizing has no persistent ruler button");
        header.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true,
            clientX: headerRect.right, clientY: headerRect.top + headerRect.height / 2}));
        f.render();
        const width = f.touch("[data-action='width']");
        check.ok(width, "tapping a header divider activates its width control");
        check.equal(f.core.hasTouchSelection(), false, "activating a divider does not select the column's cells");
        check.equal(width.querySelector("svg"), null);
        check.equal(width.getBoundingClientRect().left + width.getBoundingClientRect().width / 2, headerRect.right);
        check.equal(width.getBoundingClientRect().top, headerRect.top);
        check.equal(width.getBoundingClientRect().bottom, f.cell(3, 0).getBoundingClientRect().bottom,
            "the active divider spans all visible rows");
        const before = f.table.querySelector("col").getAttribute("style");
        const count = transactions.length;
        pointer(width, "pointerdown", 120, 60);
        pointer(document, "pointermove", 180, 60);
        pointer(document, "pointercancel", 180, 60);
        check.equal(f.table.querySelector("col").getAttribute("style"), before);
        check.equal(transactions.length, count, "cancelled resizing creates no transaction");
        f.render();
        pointer(f.touch("[data-action='width']"), "pointerdown", 120, 60);
        pointer(document, "pointermove", 180, 60);
        check.equal(f.touch(".protyle-table-control__width-guide").getBoundingClientRect().left,
            f.table.querySelector("col").getBoundingClientRect().right, "the divider guide follows the resized boundary");
        pointer(document, "pointerup", 180, 60);
        check.equal((f.table.querySelector("col") as HTMLElement).style.width, "150px");
        check.equal(transactions.length, count + 1);
        check.match(transactions.at(-1).before, /width:90px/);
        pointer(f.cell(1, 1), "pointerdown", 180, 110);
        f.render();
        check.equal(f.touch("[data-action='width']"), null, "touching cell content dismisses the active divider");
        const bodyRect = f.cell(1, 0).getBoundingClientRect();
        f.cell(1, 0).dispatchEvent(new MouseEvent("click", {bubbles: true,
            clientX: bodyRect.right, clientY: bodyRect.top + bodyRect.height / 2}));
        f.render();
        const bodyWidth = f.touch("[data-action='width']");
        check.ok(bodyWidth, "body dividers can activate column width adjustment");
        const y = bodyRect.top + bodyRect.height / 2;
        check.equal(document.elementFromPoint(bodyRect.right, y)?.closest('[data-action="width"]'), bodyWidth,
            "the active divider receives pointer input in body rows");
        const bodyColumnWidth = f.table.querySelector("col").getBoundingClientRect().width;
        pointer(bodyWidth, "pointerdown", bodyRect.right, y);
        pointer(document, "pointermove", bodyRect.right + 30, y);
        pointer(document, "pointerup", bodyRect.right + 30, y);
        check.equal((f.table.querySelector("col") as HTMLElement).style.width, `${Math.round(bodyColumnWidth + 30)}px`);
        check.equal(transactions.length, count + 2, "dragging from a body row creates one width transaction");
        f.dispose();
    }
    for (const columnWidth of [12, 16]) {
        const f = fixture();
        f.table.querySelector<HTMLTableColElement>("col").style.width = `${columnWidth}px`;
        Array.from(f.table.rows).forEach(row => row.cells[0].textContent = "");
        const cell = f.cell(1, 0);
        const rect = cell.getBoundingClientRect();
        const middle = new MouseEvent("click", {bubbles: true, cancelable: true,
            clientX: (rect.left + rect.right) / 2, clientY: (rect.top + rect.bottom) / 2});
        cell.dispatchEvent(middle);
        check.equal(middle.defaultPrevented, false, "narrow cell centers remain available for text editing");
        check.equal(f.touch("[data-action='width']"), null);
        cell.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true,
            clientX: rect.right, clientY: (rect.top + rect.bottom) / 2}));
        f.render();
        check.ok(f.touch("[data-action='width']"), "the narrow column divider can still be resized");
        f.dispose();
    }
    for (const kind of ["merged", "no-header", "disabled", "block", "link"]) {
        const f = fixture();
        const first = f.cell(0, 0);
        const rect = first.getBoundingClientRect();
        if (kind === "merged") {
            first.colSpan = 2;
            f.cell(0, 1).remove();
        }
        if (kind === "no-header") {
            f.table.tBodies[0].prepend(f.table.tHead.rows[0]);
            f.table.tHead.remove();
        }
        if (kind === "disabled") f.owner.disabled = true;
        if (kind === "block") f.setBlockMultiSelect(true);
        const link = document.createElement("a");
        if (kind === "link") first.append(link);
        (kind === "link" ? link : first).dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true,
            clientX: rect.right, clientY: rect.top + rect.height / 2}));
        f.render();
        check.equal(!!f.touch("[data-action='width']"), kind === "no-header",
            `${kind} only exposes real, editable cell dividers`);
        f.dispose();
    }
    {
        const f = fixture();
        f.core.startTouchSelection(f.cell(1, 0));
        f.render();
        const initial = f.table.rows.length;
        const add = f.touch("[data-action='add-row']");
        pointer(add, "pointerdown", 150, 220);
        pointer(document, "pointerup", 150, 220);
        add.click();
        check.equal(f.table.rows.length, initial + 1);
        f.core.startTouchSelection(f.cell(1, 0));
        f.render();
        pointer(f.touch("[data-action='add-row']"), "pointerdown", 150, 260);
        pointer(document, "pointermove", 150, 70);
        pointer(document, "pointerup", 150, 70);
        check.equal(f.table.rows.length, 3, "shrinking preserves all nonempty rows");
        f.dispose();
    }
    for (const action of ["add-row", "add-column", "add-both"]) {
        const f = fixture();
        f.table.style.marginBottom = "0";
        const focus = f.cell(1, 1);
        const range = document.createRange();
        range.selectNodeContents(focus);
        range.collapse(true);
        focusByRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        f.render();
        let handles = ["add-row", "add-column", "add-both"].map(type => f.touch(`[data-action='${type}']`));
        const active = f.touch(`[data-action='${action}']`);
        const rect = active.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const before = f.table.innerHTML;
        const count = transactions.length;
        pointer(active, "pointerdown", x, y);
        pointer(document, "pointermove", x + 60, y + 90);
        await frames(3);
        const checkPositions = () => {
            const table = f.table.getBoundingClientRect();
            const row = f.touch("[data-action='add-row']").getBoundingClientRect();
            const column = f.touch("[data-action='add-column']").getBoundingClientRect();
            const both = f.touch("[data-action='add-both']").getBoundingClientRect();
            if (action !== "add-column") {
                check.equal(row.top + row.height / 2, Math.round(table.bottom + 18), `${action}: row + follows the bottom edge during drag`);
                check.equal(row.width, table.width);
            } else {
                check.equal(f.touch("[data-action='add-row']").classList.contains("fn__none"), true);
            }
            if (action !== "add-row") {
                check.equal(column.left + column.width / 2, Math.round(table.right + 18), `${action}: column + follows the right edge during drag`);
                check.equal(column.height, table.height);
            } else {
                check.equal(f.touch("[data-action='add-column']").classList.contains("fn__none"), true);
            }
            if (action === "add-both") {
                check.equal(both.left + both.width / 2, Math.round(table.right + 18));
                check.equal(both.top + both.height / 2, Math.round(table.bottom + 18));
            } else {
                check.equal(f.touch("[data-action='add-both']").classList.contains("fn__none"), true);
            }
            check.equal(f.touch(".protyle-table-control__touch-handle:not(.fn__none)"), null,
                "size dragging hides row and column selection handles like desktop");
            handles.forEach(handle => check.equal(handle.isConnected, true, "dragging retains the original input targets"));
        };
        checkPositions();
        pointer(document, "pointermove", x - 30, y - 20);
        await frames(3);
        checkPositions();
        pointer(document, "pointercancel", x - 30, y - 20);
        await frames(3);
        check.equal(f.table.innerHTML, before, "canceling a size drag restores the original table");
        check.equal(transactions.length, count);
        const restored = f.touch("[data-action='add-both']").getBoundingClientRect();
        check.equal(restored.left + restored.width / 2, f.table.getBoundingClientRect().right + 18);
        check.equal(restored.top + restored.height / 2, f.table.getBoundingClientRect().bottom + 18);
        if (action === "add-both") {
            handles = ["add-row", "add-column", "add-both"].map(type => f.touch(`[data-action='${type}']`));
            const button = f.touch("[data-action='add-both']");
            pointer(button, "pointerdown", x, y);
            f.root.style.width = "300px";
            pointer(document, "pointermove", x + 180, y + 90);
            await frames(3);
            check.equal(button.classList.contains("fn__none"), true, "an offscreen right edge does not leave controls over cells");
            f.root.style.width = "360px";
            pointer(document, "pointermove", x + 60, y + 90);
            await frames(3);
            check.equal(button.classList.contains("fn__none"), false, "controls return when the right edge fits again");
            checkPositions();
            pointer(document, "pointerup", x + 60, y + 90);
            button.click();
            await frames(3);
            check.equal(transactions.length, count + 1, "a finished size drag creates one transaction without an extra add click");
            check.equal(f.table.rows.length, 6);
            check.equal(f.table.rows[0].cells.length, 4);
        }
        f.dispose();
    }
    {
        const f = fixture();
        f.root.style.height = `${window.innerHeight}px`;
        f.table.style.margin = "100px 0 0";
        f.table.parentElement.style.width = "180px";
        f.table.parentElement.scrollLeft = 45;
        f.core.startTouchSelection(f.cell(0, 0));
        f.render();
        const cellRect = f.cell(0, 0).getBoundingClientRect();
        const wrapperRect = f.table.parentElement.getBoundingClientRect();
        const row = f.touch("[data-mode='row']").getBoundingClientRect();
        const column = f.touch("[data-mode='column']").getBoundingClientRect();
        check.equal(row.left + row.width / 2, wrapperRect.left, "row handles follow the clipped grid border at the screen edge");
        check.equal(column.top + column.height / 2, cellRect.top, "column handles sit on the top grid border");
        check.equal(column.left + column.width / 2, (wrapperRect.left + cellRect.right) / 2,
            "column handles stay centered on the visible portion when horizontally scrolled");
        f.table.style.marginTop = `${window.innerHeight - 70}px`;
        f.render();
        const bottomCell = f.cell(0, 0).getBoundingClientRect();
        const bottomRow = f.touch("[data-mode='row']").getBoundingClientRect();
        const bottomColumn = f.touch("[data-mode='column']").getBoundingClientRect();
        check.equal(bottomRow.top + bottomRow.height / 2, bottomCell.top + bottomCell.height / 2,
            "row handles remain aligned near the bottom of the viewport");
        check.equal(bottomColumn.top + bottomColumn.height / 2, bottomCell.top,
            "column handles remain on the grid border near the bottom of the viewport");
        f.dispose();
    }
    for (const mode of ["row", "column"] as const) {
        const f = fixture();
        f.core.startTouchSelection(f.cell(1, 0), mode);
        f.render();
        const handle = f.touch(`[data-mode='${mode}'][aria-pressed='true']`);
        const rect = handle.getBoundingClientRect();
        pointer(handle, "pointerdown", rect.left + rect.width / 2, rect.top + rect.height / 2);
        const x = mode === "row" ? rect.left : 350;
        const y = mode === "row" ? 490 : rect.top;
        pointer(document, "pointermove", x, y);
        pointer(document, "pointerup", x, y);
        await tick();
        check.equal(mode === "row" ? f.table.rows[3].textContent : f.table.rows[1].textContent,
            mode === "row" ? "A1A2A3" : "A2A3A1", "touch row and column dragging uses the shared reorder transaction");
        f.dispose();
    }
    {
        const f = fixture();
        const cell = f.cell(1, 0);
        const host = document.createElement("div");
        host.className = "table__cell-editor";
        cell.append(host);
        let composing = true;
        context.setTableCellRichContext({element: host} as unknown as IProtyle, {cell, owner: f.owner, finish: () => {
            if (!composing) {
                host.remove();
                cell.innerHTML = "committed";
            }
        }});
        check.equal(f.core.startTouchSelection(cell), false);
        check.equal(cell.contains(host), true, "composition retains the live editor");
        composing = false;
        check.equal(f.core.startTouchSelection(cell), true);
        await f.invoke("writeTouchClipboard");
        await tick();
        check.equal(clipboard.at(-1).textPlain, "committed");
        clipboardFailure = true;
        f.invoke("execClipboardCommand", "cut");
        await tick();
        check.equal(cell.textContent, "committed", "failed clipboard writes preserve source content");
        clipboardFailure = false;
        let release: () => void;
        clipboardWait = new Promise(resolve => { release = resolve; });
        f.invoke("execClipboardCommand", "cut");
        cell.textContent = "newer content";
        release();
        await tick();
        check.equal(cell.textContent, "newer content", "clipboard permission delays cannot cut newer content");
        clipboardWait = undefined;
        clipboardWait = new Promise(resolve => { release = resolve; });
        f.invoke("execClipboardCommand", "cut");
        f.core.startTouchSelection(f.cell(2, 2), "cell", true);
        release();
        await tick();
        check.equal(cell.textContent, "newer content", "changing a selection in place cancels a pending cut");
        check.equal(f.cell(2, 2).textContent, "B3");
        clipboardWait = undefined;
        f.owner.disabled = true;
        check.equal(f.core.startTouchSelection(f.cell(2, 0)), false);
        f.invoke("clearCells");
        check.equal(f.cell(2, 2).textContent, "B3", "disabled editors reject stale toolbar actions");
        f.dispose();
    }
    {
        const f = fixture();
        f.core.startTouchSelection(f.cell(1, 0));
        f.core.selectCellRange(f.cell(1, 0), f.cell(2, 1));
        const selected = f.core.getSelectedCells();
        f.invoke("setCellStyle", "background-color", "rgb(255, 0, 0)");
        f.invoke("setCellStyle", "text-align", "center");
        f.invoke("setCellStyle", "vertical-align", "bottom");
        check.equal(selected.every(cell => cell.style.backgroundColor === "rgb(255, 0, 0)" &&
            cell.style.textAlign === "center" && cell.style.verticalAlign === "bottom"), true);
        check.equal(f.cell(1, 2).getAttribute("style").includes("text-align"), false, "batch styles preserve other cells");
        await f.invoke("writeTouchClipboard", false, true);
        check.equal(clipboard.at(-1).textSiyuan, undefined, "rich text copying uses standard HTML");
        check.match(clipboard.at(-1).textHTML, /A1.*A2.*B1.*B2/);
        await f.invoke("writeTouchClipboard", true);
        check.equal(selected.every(cell => cell.textContent === ""), true, "successful cutting clears only the selected cells");
        check.equal(f.cell(1, 2).textContent, "A3");
        f.dispose();
    }
    {
        const f = fixture();
        f.core.startTouchSelection(f.cell(1, 0));
        await f.invoke("paste");
        check.equal(pasted.at(-1).target, f.cell(1, 0), "touch paste targets the selection's first cell");
        check.equal(pasted.at(-1).textPlain, "pasted");
        const count = pasted.length;
        let release: () => void;
        clipboardWait = new Promise(resolve => { release = resolve; });
        const pending = f.invoke("paste");
        f.core.startTouchSelection(f.cell(2, 2));
        release();
        await pending;
        check.equal(pasted.length, count, "a delayed clipboard read cannot paste into a changed selection");
        clipboardWait = undefined;
        f.dispose();
    }
    for (const mode of ["row", "column"] as const) {
        const f = fixture();
        f.core.startTouchSelection(f.cell(1, 1), mode);
        f.invoke("duplicateRowsOrColumns");
        check.equal(mode === "row" ? f.table.rows.length : f.table.rows[1].cells.length, mode === "row" ? 5 : 4);
        f.invoke("deleteSelection", false);
        check.equal(f.table.rows.length, 4);
        check.equal(f.table.rows[1].cells.length, 3);
        check.equal(f.cell(1, 1).textContent, "A2", "deleting duplicates preserves the original row or column");
        f.core.startTouchSelection(f.cell(1, 1), mode);
        await f.invoke("writeTouchClipboard", true);
        check.equal(mode === "row" ? f.table.rows.length : f.table.rows[1].cells.length, mode === "row" ? 3 : 2);
        check.equal(f.cell(0, 0).textContent, "H1", "cutting a body row or column preserves the header");
        f.dispose();
    }
    {
        const f = fixture();
        f.core.startTouchSelection(f.cell(1, 0));
        f.render();
        f.touch("[data-action='add-column']").click();
        check.equal(f.table.rows[1].cells.length, 4);
        f.core.startTouchSelection(f.cell(1, 0));
        f.render();
        f.touch("[data-action='add-both']").click();
        check.equal(f.table.rows.length, 5);
        check.equal(f.table.rows[1].cells.length, 5);
        check.equal(f.cell(1, 0).textContent, "A1");
        f.dispose();
    }
    {
        const f = fixture();
        const detached = Array.from(f.table.tBodies[0].rows).slice(1);
        const placeholder = document.createElement("tr");
        detached[0].before(placeholder);
        virtual.cacheTableVirtualizationRows(placeholder, detached);
        detached.forEach(row => row.remove());
        f.table.setAttribute(virtual.TABLE_VIRTUAL_ID, "test");
        check.equal(f.table.rows.length, 3);
        f.core.startTouchSelection(f.cell(1, 0), "column");
        check.equal(f.core.getSelectedCells().length, 4, "column selection restores cached source rows");
        check.equal(f.table.rows.length, 4);
        check.equal(f.cell(2, 2).textContent, "B3");
        f.dispose();
        let ran = false;
        const item: IMenu = {label: "blocked", click: () => { ran = true; }};
        context.prepareTableCellMenuItems([item], () => false);
        item.click(undefined, undefined);
        check.equal(ran, false, "unfinished composition blocks structural menu actions");
    }
    mobile = false;
    {
        const f = fixture();
        await frames(2);
        const query = f.editor.querySelectorAll.bind(f.editor);
        f.editor.querySelectorAll = ((selector: string) => {
            check.notEqual(selector, '[data-type="NodeTable"] table', "hover never scans the whole editor for tables");
            return query(selector);
        }) as typeof f.editor.querySelectorAll;
        const rect = f.table.getBoundingClientRect();
        const wrapper = f.table.parentElement.getBoundingClientRect();
        for (const [x, y, type] of [
            [rect.right + 5, rect.top + 20, "add-column"],
            [rect.left + 20, wrapper.bottom + 5, "add-row"],
            [rect.right + 5, wrapper.bottom + 5, "add-both"],
        ] as const) {
            Reflect.set(f.core, "hoverCell", undefined);
            check.equal(f.invoke("getEdgeHover", x, y)?.type, type,
                "edge controls can be approached directly from outside the table");
        }
        const paragraph = document.createElement("div");
        paragraph.textContent = "Ordinary document text";
        paragraph.style.height = "100px";
        f.editor.append(paragraph);
        Reflect.set(f.core, "hoverCell", undefined);
        const originalRect = f.table.getBoundingClientRect.bind(f.table);
        f.table.getBoundingClientRect = () => check.fail("ordinary text hover must not measure unrelated tables");
        const p = paragraph.getBoundingClientRect();
        check.equal(f.invoke("getEdgeHover", p.left + 100, p.top + 70), undefined);
        f.table.getBoundingClientRect = originalRect;
        f.dispose();
    }
    {
        const f = fixture();
        const rightClick = (target: Element, shiftKey = false) => {
            const event = new MouseEvent("contextmenu", {bubbles: true, cancelable: true, shiftKey});
            target.dispatchEvent(event);
            return event;
        };
        getSelection().removeAllRanges();
        check.equal(rightClick(f.cell(1, 1)).defaultPrevented, true);
        check.equal(menuElement.dataset.name, "table-cell");
        check.deepEqual(f.core.getSelectedCells(), [f.cell(1, 1)], "right click selects a previously inactive cell");
        f.core.selectCellRange(f.cell(1, 0), f.cell(2, 1));
        rightClick(f.cell(2, 1));
        check.equal(f.core.getSelectedCells().length, 4, "right click inside a selected range keeps the range");
        rightClick(f.cell(1, 2));
        check.deepEqual(f.core.getSelectedCells(), [f.cell(1, 2)], "right click outside the range selects the target");
        check.equal(rightClick(f.table.parentElement).defaultPrevented, false, "table block padding retains the block menu");
        check.equal(f.core.getSelectedCells().length, 0);
        check.equal(rightClick(f.cell(1, 1), true).defaultPrevented, false, "Shift preserves the native menu");
        f.setBlockMultiSelect(true);
        check.equal(rightClick(f.cell(1, 1)).defaultPrevented, false, "block multiselection retains its menu");
        f.setBlockMultiSelect(false);
        const cell = f.cell(1, 1);
        cell.innerHTML = '<div class="table__cell-editor"><div class="protyle-wysiwyg"><div contenteditable="true">Text</div></div></div>';
        const editable = cell.querySelector('[contenteditable="true"]');
        check.equal(rightClick(editable).defaultPrevented, false, "rich text editing retains its own context menu");
        cell.textContent = "A2";
        f.owner.disabled = true;
        rightClick(cell);
        check.ok(items.some(item => item.label === "copy" && !item.disabled));
        check.ok(!items.some(item => item.label === "paste" && !item.disabled), "readonly cell menus cannot paste");
        f.dispose();
    }
    for (const mode of ["row", "column", "both"]) {
        const f = fixture();
        f.table.style.marginBottom = "0";
        Reflect.set(f.core, "hoverCell", f.cell(1, 1));
        const before = f.table.innerHTML;
        const event = new PointerEvent("pointerdown", {pointerId: 10, button: 0, clientX: 300, clientY: 226});
        f.invoke("startResize", event, `add-${mode}`);
        pointer(document, "pointermove", 360, 316, 10);
        await frames(3);
        const row = f.touch("[data-type='add-row']");
        const column = f.touch("[data-type='add-column']");
        check.equal(row.classList.contains("fn__none"), mode === "column");
        check.equal(column.classList.contains("fn__none"), mode === "row");
        if (mode !== "column") {
            const rect = row.getBoundingClientRect();
            check.equal(rect.top + rect.height / 2, Math.round(f.table.getBoundingClientRect().bottom + 18));
        }
        if (mode !== "row") {
            const rect = column.getBoundingClientRect();
            check.equal(rect.left + rect.width / 2, Math.round(f.table.getBoundingClientRect().right + 18));
        }
        pointer(document, "pointercancel", 360, 316, 10);
        await frames(3);
        check.equal(f.table.innerHTML, before, "desktop size-drag cancellation preserves the table");
        f.dispose();
    }
    {
        const f = fixture();
        check.equal(f.touch(".protyle-table-control__toolbar"), null, "desktop retains its existing controls");
        f.core.selectCellRange(f.cell(1, 0), f.cell(2, 1));
        check.equal(f.core.getSelectedCells().length, 4);
        f.invoke("selectFromCell", "row", f.cell(1, 0), false, false);
        const before = f.table.textContent;
        const event = new PointerEvent("pointerdown", {pointerId: 10, button: 0, clientX: 30, clientY: 110});
        f.invoke("startRowColumnDrag", event, "row", new DOMRect(16, 100, 28, 28));
        pointer(document, "pointermove", 30, 490, 10);
        pointer(document, "pointercancel", 30, 490, 10);
        check.equal(f.table.textContent, before, "desktop drag cancellation preserves row order");
        f.invoke("startRowColumnDrag", event, "row", new DOMRect(16, 100, 28, 28));
        pointer(document, "pointermove", 30, 490, 10);
        pointer(document, "pointerup", 30, 490, 10);
        await tick();
        check.equal(f.table.rows[3].textContent, "A1A2A3", "desktop row dragging retains its existing behavior");
        f.dispose();
    }
    for (const touchMode of [true, false]) {
        mobile = touchMode;
        const f = fixture();
        const cell = f.cell(1, 1);
        const row = f.table.rows[1];
        row.style.backgroundColor = "red";
        const rect = cell.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.bottom;
        if (touchMode) {
            cell.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, clientX: x, clientY: y}));
            f.render();
        } else {
            pointer(cell, "pointermove", x, y);
            f.render();
        }
        const handle = f.touch(touchMode ? '[data-action="height"]' : ".protyle-table-control__height");
        check.ok(handle && !handle.classList.contains("fn__none"), "a horizontal boundary exposes the row height handle");
        if (!touchMode) {
            handle.parentElement.dispatchEvent(new PointerEvent("pointerleave", {relatedTarget: document.body}));
            check.ok(handle.classList.contains("fn__none"), "leaving the controls hides the row divider");
            pointer(cell, "pointermove", x, y);
        }
        const before = transactions.length;
        const oldHeight = row.getBoundingClientRect().height;
        pointer(handle, "pointerdown", x, y, 71);
        pointer(document, "pointermove", x, y + 40, 72);
        check.equal(row.style.height, "", "another pointer cannot resize the row");
        pointer(document, "pointermove", x, y + 40, 71);
        check.equal(row.style.height, `${Math.round(oldHeight + 40)}px`);
        check.equal(transactions.length, before, "height preview does not create transactions");
        pointer(document, "pointerup", x, y + 40, 71);
        check.equal(transactions.length, before + 1, "a completed drag creates one undoable transaction");
        check.equal(row.style.backgroundColor, "red");
        for (const cancel of ["pointercancel", "Escape", "blur"]) {
            const saved = row.getAttribute("style");
            f.invoke("startRowResize", new PointerEvent("pointerdown", {button: 0, pointerId: 73, clientY: y}), cell, row);
            pointer(document, "pointermove", x, y + 90, 73);
            if (cancel === "Escape") {
                document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
            } else if (cancel === "blur") {
                window.dispatchEvent(new Event("blur"));
            } else {
                pointer(document, cancel, x, y + 90, 73);
            }
            check.equal(row.getAttribute("style"), saved, `${cancel} restores all original row styles`);
            check.equal(transactions.length, before + 1);
        }
        f.invoke("selectFromCell", "row", cell, false, false);
        f.invoke("openMenu", 0, 0);
        const reset = items.find(item => item.id === "autoFitRowHeight");
        check.ok(reset && !reset.disabled);
        reset.click(undefined, undefined);
        check.equal(row.style.height, "", "auto-fit clears explicit row height");
        check.equal(row.style.backgroundColor, "red", "auto-fit preserves unrelated style");
        const minimumHeight = row.getBoundingClientRect().height;
        f.invoke("startRowResize", new PointerEvent("pointerdown", {button: 0, pointerId: 75, clientY: y}), cell, row);
        pointer(document, "pointermove", x, y - 500, 75);
        pointer(document, "pointerup", x, y - 500, 75);
        check.equal(row.style.height, "1px");
        check.ok(row.getBoundingClientRect().height >= minimumHeight, "content determines the minimum rendered height");
        f.owner.disabled = true;
        reset.click(undefined, undefined);
        check.equal(row.style.height, "1px", "a menu opened before readonly mode cannot reset row height");
        f.invoke("startRowResize", new PointerEvent("pointerdown", {button: 0, pointerId: 74, clientY: y}), cell, row);
        pointer(document, "pointermove", x, y + 90, 74);
        pointer(document, "pointerup", x, y + 90, 74);
        check.equal(row.style.height, "1px", "readonly tables cannot change height");
        f.dispose();
    }
    {
        const f = fixture();
        const merged = f.cell(1, 0);
        merged.rowSpan = 2;
        f.cell(2, 0).remove();
        const rect = merged.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        check.equal(rowHeight.getTableRowBoundary(merged, x, f.table.rows[1].getBoundingClientRect().bottom, 4), undefined,
            "a merged cell has no internal row divider");
        check.equal(rowHeight.getTableRowBoundary(merged, x, rect.bottom, 4), f.table.rows[2],
            "the merged cell bottom targets its last logical row");
        check.equal(rowHeight.getTableRowBoundary(merged, rect.right, rect.bottom, 4), undefined,
            "column corners retain their column resize hit area");
        f.dispose();
    }
    {
        mobile = false;
        const f = fixture();
        f.table.rows[1].style.height = "80px";
        f.table.rows[3].style.height = "100px";
        f.core.selectCellRange(f.cell(1, 0), f.cell(2, 2));
        let copied = f.invoke("getSelectionClipboardContent");
        check.match(copied.textSiyuan, /<tr style="height: 80px;">/, "rectangular clipboard retains row height");
        f.invoke("selectFromCell", "row", f.cell(1, 0), false, false);
        f.invoke("selectFromCell", "row", f.cell(3, 0), true, false);
        copied = f.invoke("getSelectionClipboardContent");
        check.match(copied.textSiyuan, /height: 80px/);
        check.match(copied.textSiyuan, /height: 100px/, "noncontiguous row clipboard retains each source height");
        f.dispose();
    }
    // 用实际共享样式验证尺寸反馈，覆盖简化手势夹具未包含的层级、颜色和定位。
    const realStyle = document.createElement("style");
    realStyle.textContent = css;
    document.head.append(realStyle);
    document.documentElement.style.setProperty("--b3-theme-primary", "#5078ff");
    document.documentElement.style.setProperty("--b3-tooltips-background", "#222");
    document.documentElement.style.setProperty("--b3-tooltips-color", "#fff");
    const delay = () => new Promise(resolve => setTimeout(resolve, 240));
    mobile = false;
    {
        const f = fixture();
        const cell = f.cell(1, 1);
        const rect = cell.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        pointer(cell, "pointermove", x, rect.bottom);
        const guide = Reflect.get(f.core, "dimensionGuide") as HTMLElement;
        check.ok(guide.classList.contains("fn__none"), "hover starts with an invisible guide");
        await delay();
        check.equal(guide.classList.contains("fn__none"), false, "hover reveals the guide after its delay");
        check.equal(getComputedStyle(guide).backgroundColor, "rgb(80, 120, 255)");
        pointer(f.cell(2, 1), "pointermove", x, f.cell(2, 1).getBoundingClientRect().bottom);
        check.ok(guide.classList.contains("fn__none"), "crossing to a different boundary restarts the delay");
        f.editor.dispatchEvent(new PointerEvent("pointerleave", {relatedTarget: document.body}));
        await delay();
        check.ok(guide.classList.contains("fn__none"), "leaving cancels a pending boundary reveal");
        pointer(cell, "pointermove", rect.right, rect.top + rect.height / 2);
        await delay();
        check.equal(guide.className, "protyle-table-control__width-guide");
        check.ok(Math.abs(guide.getBoundingClientRect().left + 1 - rect.right) <= 1,
            "column hover identifies the actual column boundary");
        f.dispose();
    }
    for (const touchMode of [false, true]) {
        mobile = touchMode;
        const f = fixture();
        const cell = f.cell(1, 1);
        const row = cell.parentElement as HTMLTableRowElement;
        f.core.selectCellRange(cell, f.cell(2, 2));
        f.render();
        check.ok(f.core.getSelectedCells().length > 1);
        const rect = cell.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.bottom;
        const saved = row.getAttribute("style");
        const count = transactions.length;
        f.invoke("startRowResize", new PointerEvent("pointerdown", {button: 0, pointerId: 99, clientX: x, clientY: y}), cell, row);
        check.equal(f.core.getSelectedCells().length, 0, "starting a height drag clears cell selection");
        const label = f.touch(".protyle-table-control__size");
        const guide = Reflect.get(f.core, "dimensionGuide") as HTMLElement;
        check.ok(label.getBoundingClientRect().bottom <= y - (touchMode ? 47 : 11), "height values appear above the pointer");
        check.ok(label.getBoundingClientRect().right <= x - 11, "height values appear to the left of the pointer");
        pointer(document, "pointermove", x, y + 33, 99);
        f.render();
        check.equal(guide.classList.contains("fn__none"), false, "height feedback survives rendering during drag");
        const guideRect = guide.getBoundingClientRect();
        check.equal(guideRect.top + guideRect.height / 2, row.getBoundingClientRect().bottom,
            "the guide is centered on the actual row boundary");
        check.equal(label.textContent, `${Math.round(row.getBoundingClientRect().height)}px`);
        check.ok(label.getBoundingClientRect().right <= x - 11, "height values stay left of the pointer during dragging");
        pointer(document, "pointermove", 1, 1, 99);
        check.ok(label.getBoundingClientRect().left >= 4 && label.getBoundingClientRect().top >= 4,
            "desktop and touch labels remain visible near the top-left viewport corner");
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        check.equal(row.getAttribute("style"), saved);
        check.equal(transactions.length, count);
        check.ok(guide.classList.contains("fn__none") && label.classList.contains("fn__none"));
        f.dispose();
    }
    mobile = false;
    for (const mode of ["left", "center", "center-scroll"]) {
        const f = fixture();
        const node = f.table.closest<HTMLElement>('[data-type="NodeTable"]');
        node.style.textAlign = mode === "left" ? "left" : "center";
        if (mode === "center-scroll") {
            (f.table.parentElement as HTMLElement).style.width = "180px";
            f.table.style.minWidth = "270px";
            check.ok(f.table.parentElement.scrollWidth > f.table.parentElement.clientWidth,
                "the centered scroll fixture must actually overflow");
        }
        const cell = f.cell(1, 0);
        const column = f.table.querySelector("col");
        const startWidth = column.getBoundingClientRect().width;
        const rect = cell.getBoundingClientRect();
        const handle = document.createElement("div");
        handle.className = "table__resize";
        handle.dataset.colIndex = "0";
        node.querySelector(".protyle-action__table").append(handle);
        f.core.selectCellRange(cell, f.cell(2, 1));
        const start = () => {
            const event = new MouseEvent("mousedown", {button: 0, clientX: rect.right, clientY: rect.top + 12, cancelable: true});
            new Function("event", "customElement", "protyle", "target", "nodeElement", sources["desktop-column-resize"])
                .call({tableControl: f.core}, event, false, f.owner, handle, node);
        };
        start();
        check.equal(f.core.getSelectedCells().length, 0, "desktop column resizing clears cell selection");
        const count = transactions.length;
        document.dispatchEvent(new MouseEvent("mousemove", {buttons: 1, clientX: rect.right + 20, clientY: rect.top + 12}));
        check.equal(parseFloat(column.style.width), Math.round(startWidth + (mode === "center" ? 40 : 20)),
            `${mode}: centered tables retain double movement only without horizontal overflow`);
        const label = f.touch(".protyle-table-control__size");
        const guide = Reflect.get(f.core, "dimensionGuide") as HTMLElement;
        check.equal(label.textContent, `${Math.round(column.getBoundingClientRect().width)}px`);
        check.ok(label.getBoundingClientRect().bottom < rect.top + 12);
        check.ok(label.getBoundingClientRect().right <= rect.right + 20 - 11,
            "column values appear to the left of the pointer");
        check.equal(guide.classList.contains("fn__none"), false, "dragging keeps the column guide visible");
        document.dispatchEvent(new MouseEvent("mouseup", {button: 0}));
        check.equal(transactions.length, count + 1, "desktop drag commits exactly one undoable transaction");
        const committed = node.outerHTML;
        document.dispatchEvent(new MouseEvent("mousemove", {buttons: 1, clientX: rect.right + 80}));
        check.equal(node.outerHTML, committed, "release removes drag listeners");
        for (const cancel of ["Escape", "blur", "pointercancel", "hide"]) {
            start();
            document.dispatchEvent(new MouseEvent("mousemove", {buttons: 1, clientX: rect.right + 40, clientY: 1}));
            check.ok(label.getBoundingClientRect().top >= 0 && label.getBoundingClientRect().right <= innerWidth,
                "size labels remain visible at viewport edges");
            if (cancel === "Escape") {
                document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
            } else if (cancel === "blur") {
                window.dispatchEvent(new Event("blur"));
            } else if (cancel === "hide") {
                f.core.setHidden(true);
                f.core.setHidden(false);
            } else {
                pointer(document, "pointercancel");
            }
            check.equal(node.outerHTML, committed, `${cancel} restores widths and cell styles`);
            check.equal(transactions.length, count + 1);
            check.ok(label.classList.contains("fn__none") && guide.classList.contains("fn__none"));
        }
        f.dispose();
    }
    realStyle.remove();
    menuElement.remove();
    menuScrim.remove();
    fixtureStyle.remove();
    return "Mobile table interaction cases passed";
};

test("desktop and mobile table selection, resize feedback and gesture cancellation", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const files = ["tableControl", "tableTouch", "table", "tableSelection", "tableResize", "tableRowHeight", "tableColumnWidth", "tableGridCache",
        "tableCellRich", "tableCellRichValue", "tableCellRichContext", "tableVirtualizationDOM"]
        .map(file => "src/protyle/util/" + file + ".ts");
    files.push("src/mobile/util/multiSelectToolbar.ts");
    const sources = Object.fromEntries(files.map(file => [file, transpileModule(
        readFileSync(path.resolve(process.cwd(), file), "utf8"),
        {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022}}).outputText]));
    const wysiwyg = readFileSync(path.resolve("src/protyle/wysiwyg/index.ts"), "utf8");
    sources["desktop-column-resize"] = transpileModule(wysiwyg.slice(wysiwyg.indexOf("// table col resize"),
        wysiwyg.indexOf("// 编辑器底部反链仅用于浏览和编辑，不参与块、数据库或表格框选")),
        {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const css = require("sass").compile(path.resolve("src/assets/scss/protyle/_protyle.scss"),
        {silenceDeprecations: ["legacy-js-api"]}).css;
    const typographyCSS = require("sass").compile(path.resolve("src/assets/scss/component/_typography.scss")).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-table-touch-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 390, height: 640, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
    }});
    try {
        await win.loadURL("data:text/html,<!DOCTYPE html><html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
            browserCases.toString() + ")(" + JSON.stringify(sources) + "," + JSON.stringify(css) + "," +
            JSON.stringify(typographyCSS) + ").catch(error => { throw new Error(error.stack || String(error)); })")}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Mobile table interaction cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-table-touch-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
