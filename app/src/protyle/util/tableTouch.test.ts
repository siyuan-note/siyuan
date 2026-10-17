import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const nodePath: typeof path = require("node:path");
    const noop = () => {};
    const fixtureStyle = document.createElement("style");
    fixtureStyle.textContent = ".protyle-util{position:fixed;top:8px;left:8px;right:8px}.block__icons{display:flex;height:42px}" +
        ".block__icons svg,.protyle-table-control svg{width:16px;height:16px}.fn__none{display:none}" +
        ".protyle-table-control__handle,.protyle-table-control__add,.protyle-table-control__touch-button{" +
        "position:fixed;width:28px;height:28px;transform:translate(-50%,-50%)}";
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
    const constants = new Proxy<Record<string, string>>({ZWSP: "\u200b"}, {get: (target, key: string) => target[key] || key});
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
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    const pointer = (target: EventTarget, type: string, x = 0, y = 0, id = 1) => target.dispatchEvent(new PointerEvent(type,
        {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: id, pointerType: "touch"}));
    const fixture = () => {
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
        document.body.append(root);
        editor.querySelectorAll<HTMLElement>("td, th").forEach(cell => cell.style.height = "42px");
        const owner = {element: root, contentElement: root, disabled: false, toolbar: {}, options: {},
            wysiwyg: {element: editor}, lute: {}, block: {rootID: "root"}} as unknown as IProtyle;
        const core = new TableControl(owner, editor);
        owner.wysiwyg.tableControl = core;
        const cell = (row: number, col: number) => editor.querySelector("table").rows[row].cells[col];
        const render = () => Reflect.get(core, "render").call(core);
        const invoke = (name: string, ...args: unknown[]) => Reflect.get(core, name).apply(core, args);
        const touch = (selector: string) => root.querySelector<HTMLElement>(selector);
        const dispose = () => { core.destroy(); root.remove(); getSelection().removeAllRanges(); };
        return {root, editor, owner, core, get table() { return editor.querySelector("table"); }, cell, render, invoke, touch, dispose};
    };
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
        check.equal(items.find(item => item.label === "mergeCell").disabled, true, "header and body merging stays disabled");
        f.dispose();
    }
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
        f.core.startTouchSelection(f.cell(1, 0));
        f.render();
        const width = f.touch("[data-action='width']");
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
        pointer(document, "pointerup", 180, 60);
        check.equal((f.table.querySelector("col") as HTMLElement).style.width, "150px");
        check.equal(transactions.length, count + 1);
        check.match(transactions.at(-1).before, /width:90px/);
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
    menuElement.remove();
    menuScrim.remove();
    fixtureStyle.remove();
    return "Mobile table interaction cases passed";
};

test("mobile table selection, editing handoff, operations and gesture cancellation", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const files = ["tableControl", "tableTouch", "table", "tableSelection", "tableResize", "tableColumnWidth", "tableGridCache",
        "tableCellRich", "tableCellRichValue", "tableCellRichContext", "tableVirtualizationDOM"]
        .map(file => "src/protyle/util/" + file + ".ts");
    files.push("src/mobile/util/multiSelectToolbar.ts");
    const sources = Object.fromEntries(files.map(file => [file, transpileModule(
        readFileSync(path.resolve(process.cwd(), file), "utf8"),
        {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022}}).outputText]));
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
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
            browserCases.toString() + ")(" + JSON.stringify(sources) + ").catch(error => { throw new Error(error.stack || String(error)); })")}));
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
