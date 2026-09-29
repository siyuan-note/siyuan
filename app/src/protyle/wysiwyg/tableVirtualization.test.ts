import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const api = new Function("Constants", "isInEmbedBlock", source +
        "\nreturn {LargeTableVirtualizer, cleanTableVirtualizationHTML, protectLuteTableVirtualization, " +
        "restoreTableVirtualizationDOM, getTableVirtualizationHTML, getTableVirtualCellIndex, setTableCellRichEventTarget, " +
        "getTableVirtualRowIndex, getVirtualTableGrid, setTableVirtualSelection, TableGridCache, buildTableGrid, getTableGridRect, searchMarkRender, " +
        "cleanBlockSelectionModeOperations, createEditor: protyle => new VirtualizedEditor(protyle)};")({TIMEOUT_TRANSITION: 0}, () => false) as
        typeof import("./tableVirtualization") & typeof import("../util/tableVirtualizationDOM") &
        typeof import("../util/tableCellRichContext") & typeof import("../util/tableGridCache") &
        typeof import("../util/table") & typeof import("../render/searchMarkRender") & {
            cleanBlockSelectionModeOperations: (operations: IOperation[]) => void,
            createEditor: (protyle: IProtyle) => {
                prepareBlockVirtualization: (content: Element, replace: boolean) => void,
                virtualizer: import("./tableVirtualization").LargeTableVirtualizer,
                pending: Map<number, () => void>,
            },
        };
    Object.assign(window, {siyuan: {}});
    const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))));
    const style = document.createElement("style");
    style.textContent = css + `
body {margin:0; --b3-theme-surface-lighter:#ddd; --b3-font-size-editor:16px; --b3-border-radius-s:4px;}
.test-viewport {height:420px;width:640px;overflow:auto;}
.protyle-wysiwyg {font-size:16px;line-height:26px;padding:0;}
.table > div {overflow:auto;}
.table[custom-pinthead="true"] > div {max-height:300px;}
.table[custom-pinthead="true"] thead {position:sticky;top:0;}
.table tbody > tr:nth-child(even) {background-color:rgb(12, 34, 56);}
.test-relative-table table {width:100%;}
`;
    document.head.appendChild(style);
    const fixture = (count = 2000, pinned = false, mutate?: (table: HTMLTableElement) => void) => {
        getSelection().removeAllRanges();
        const root = document.createElement("div");
        root.innerHTML = '<div class="test-viewport protyle-content"><div class="protyle-wysiwyg" contenteditable="true">' +
            '<div class="table" data-type="NodeTable" data-node-id="20260927000000-testtbl"' +
            (pinned ? ' custom-pinthead="true"' : "") + '><div contenteditable="true"><table><thead><tr>' +
            Array.from({length: 5}, (_, index) => `<th>Column ${index}</th>`).join("") +
            "</tr></thead><tbody>" + Array.from({length: count}, (_, row) => "<tr>" +
                Array.from({length: 5}, (_, col) => `<td><span data-type="a" data-href="https://example.com/${row}/${col}">` +
                    `Row ${row} cell ${col}${row % 19 === 0 && col === 2 ? "<br>Second line<br>Third line" : ""}</span></td>`).join("") +
                "</tr>").join("") + "</tbody></table></div></div></div></div>";
        document.body.appendChild(root);
        const viewport = root.firstElementChild as HTMLElement;
        const editor = viewport.firstElementChild as HTMLElement;
        const table = editor.querySelector("table");
        mutate?.(table);
        const original = editor.innerHTML;
        const originalLastRow = table.rows[table.rows.length - 1];
        const height = table.getBoundingClientRect().height;
        const widths = Array.from(table.rows[1].cells).map(cell => cell.getBoundingClientRect().width);
        const scroller = pinned ? table.parentElement : viewport;
        const highlight = {ranges: [] as Range[], mark: new Highlight(), markHL: new Highlight(),
            rangeIndex: 0, styleElement: document.createElement("style")};
        highlight.styleElement.dataset.uuid = "table-test";
        const owner = {element: root, wysiwyg: {element: editor}, contentElement: viewport, highlight,
            options: {}, block: {rootID: "root"}} as unknown as IProtyle;
        const editorController = api.createEditor(owner);
        editorController.prepareBlockVirtualization(editor, true);
        const virtualizer = editorController.virtualizer;
        return {root, viewport, editor, table, original, originalLastRow, height, widths, scroller, virtualizer, highlight,
            owner, editorController,
            destroy: () => { virtualizer.destroy(); root.remove(); }};
    };
    const reduced = (table: HTMLTableElement, phase = "") => {
        check.ok(table.querySelectorAll("tr[data-sy-table-virtual-rows]").length > 0,
            `screen-external chunks are serialized ${phase}: id=${table.getAttribute("data-sy-table-virtual-id")}, rows=${table.rows.length}`);
        check.ok(table.querySelectorAll("tr").length < 240, `bounded rendered rows: ${table.rows.length}`);
    };
    const rowsMatch = (html: string, count = 2000) => {
        const holder = document.createElement("div");
        holder.innerHTML = html;
        check.equal(holder.querySelectorAll("tbody > tr").length, count, `complete body: ${html.slice(0, 300)}`);
        check.ok(holder.textContent.includes(`Row ${count - 1} cell 4`));
        check.doesNotMatch(html, /data-sy-table-virtual/);
    };
    {
        const f = fixture(1000, false, table => {
            const block = table.parentElement.parentElement;
            block.after(block.cloneNode(true), block.cloneNode(true));
        });
        await tick();
        const tables = Array.from(f.editor.querySelectorAll("table"));
        tables.forEach(table => reduced(table));
        const ids = tables.map(table => table.getAttribute("data-sy-table-virtual-id"));
        let restores = 0;
        const restore = f.virtualizer.restore.bind(f.virtualizer);
        f.virtualizer.restore = table => { restores++; restore(table); };
        const outside = document.createElement("input");
        document.body.appendChild(outside);
        for (const type of ["pointerdown", "keydown", "beforeinput", "copy", "cut", "paste", "contextmenu"]) {
            outside.dispatchEvent(new Event(type, {bubbles: true}));
        }
        outside.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, buttons: 1, pointerType: "mouse"}));
        for (const width of [600, 540, 460, 380, 640]) {
            f.editor.dispatchEvent(new PointerEvent("pointermove", {
                bubbles: true, buttons: 1, pointerType: "mouse", movementX: 10,
            }));
            tables.forEach(table => reduced(table, "external divider drag crosses the editor"));
            f.viewport.style.width = `${width}px`;
            f.editor.style.paddingLeft = `${(640 - width) / 10}px`;
            f.root.dispatchEvent(new Event("touchmove", {bubbles: true}));
            await tick();
            tables.forEach(table => reduced(table, "sidebar animation keeps all table windows"));
        }
        outside.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, pointerType: "mouse"}));
        await new Promise(resolve => setTimeout(resolve, 250));
        await tick();
        check.equal(restores, 0, "outside interactions and viewport resizing do not materialize intrinsic-width tables");
        check.deepEqual(tables.map(table => table.getAttribute("data-sy-table-virtual-id")), ids,
            "sidebar animation does not rebuild table windows");
        tables.forEach(table => {
            check.ok(Math.abs(table.getBoundingClientRect().height - f.height) < 2);
            Array.from(table.rows[0].cells).forEach((cell, index) => {
                check.ok(Math.abs(cell.getBoundingClientRect().width - f.widths[index]) < 1);
            });
        });
        const other = fixture(300);
        await tick();
        other.editor.dispatchEvent(new Event("copy", {bubbles: true}));
        rowsMatch(other.editor.innerHTML, 300);
        tables.forEach(table => reduced(table, "another editor's clipboard events leave this editor virtualized"));
        other.destroy();
        outside.dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, key: "f", ctrlKey: true}));
        tables.forEach(table => check.equal(table.tBodies[0].rows.length, 1000, "browser find restores every table"));
        outside.dispatchEvent(new KeyboardEvent("keyup", {bubbles: true, key: "f", ctrlKey: true}));
        outside.remove();
        f.destroy();
    }
    {
        const f = fixture(600);
        await tick();
        const cell = f.table.querySelector("tbody td");
        cell.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, buttons: 1, pointerType: "mouse"}));
        reduced(f.table);
        f.editor.dispatchEvent(new PointerEvent("pointermove", {
            bubbles: true, buttons: 1, pointerType: "mouse", movementX: 10,
        }));
        rowsMatch(f.editor.innerHTML, 600);
        f.editor.dispatchEvent(new PointerEvent("pointercancel", {bubbles: true, pointerType: "mouse"}));
        f.root.dispatchEvent(new WheelEvent("wheel", {bubbles: true}));
        await tick();
        reduced(f.table, "cancelled editor drag can virtualize again");
        f.editor.dispatchEvent(new PointerEvent("pointermove", {
            bubbles: true, buttons: 1, pointerType: "mouse", movementX: 10,
        }));
        reduced(f.table, "cancelled editor drag does not affect a subsequent external drag");
        f.destroy();
    }
    for (const sizing of ["inline", "theme", "fallback"]) {
        const f = fixture(600, false, table => {
            if (sizing !== "theme") {
                table.style.width = "100%";
            }
            if (sizing === "fallback") {
                Object.defineProperty(table, "computedStyleMap", {value: undefined});
            }
            table.querySelectorAll("th, td").forEach(cell => { cell.textContent = "Cell"; });
        });
        await tick();
        let restores = 0;
        const restore = f.virtualizer.restore.bind(f.virtualizer);
        f.virtualizer.restore = table => { restores++; restore(table); };
        if (sizing === "theme") {
            f.root.classList.add("test-relative-table");
        }
        for (const width of [600, 520, 440, 360]) {
            f.viewport.style.width = `${width}px`;
            await tick();
            reduced(f.table);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
        await tick();
        check.equal(restores, 1, "container-dependent tables are measured once after resizing settles");
        check.ok(Math.abs(f.table.getBoundingClientRect().width - f.table.parentElement.clientWidth) < 2,
            "percentage widths follow the final container size");
        reduced(f.table);
        f.viewport.style.width = "500px";
        await tick();
        f.destroy();
        await new Promise(resolve => setTimeout(resolve, 250));
        check.equal(restores, 2, "destroy cancels the pending layout refresh");
    }
    for (const pinned of [false, true]) {
        const f = fixture(2000, pinned, table => {
            // 自动识别的虚拟块引用可出现在表头和任意正文行中。
            table.rows[0].cells[0].innerHTML = '<span data-type="virtual-block-ref">Column</span> 0';
            Array.from(table.tBodies[0].rows).forEach(row => {
                const link = row.cells[0].firstElementChild;
                link.innerHTML = link.innerHTML.replace("Row", '<span data-type="virtual-block-ref">Row</span>');
            });
        });
        await tick();
        reduced(f.table, `initial pinned=${pinned}`);
        f.table.querySelector("tbody td").dispatchEvent(new PointerEvent("pointermove", {
            bubbles: true, pointerType: "mouse", movementX: 10, movementY: 5,
        }));
        await tick();
        reduced(f.table, "hover does not materialize offscreen rows");
        check.equal(api.cleanTableVirtualizationHTML(f.editor.innerHTML), f.original, "source round trip is lossless");
        check.equal(api.getTableVirtualizationHTML(f.editor.firstElementChild), f.original,
            "a complete snapshot is serialized directly without mounting cached rows");
        reduced(f.table, "snapshot preserves the live window");
        check.ok(Math.abs(f.table.getBoundingClientRect().height - f.height) < 2, "initial height is retained");
        for (const progress of [0.4, 0.95, 0.1, 0.7, 0]) {
            f.scroller.scrollTop = (f.scroller.scrollHeight - f.scroller.clientHeight) * progress;
            await tick();
            reduced(f.table, `progress=${progress}, pinned=${pinned}`);
            check.ok(f.table.querySelector('tbody [data-type="virtual-block-ref"]'), "restored rows retain virtual references");
            check.ok(Math.abs(f.table.getBoundingClientRect().height - f.height) < 2, "scrolling retains variable row heights");
            const row = f.table.querySelector<HTMLTableRowElement>("tbody > tr:not([data-sy-table-virtual-rows])");
            Array.from(row.cells).forEach((cell, index) => {
                check.ok(Math.abs(cell.getBoundingClientRect().width - f.widths[index]) < 1, "column widths stay stable");
            });
            const rowIndex = Number(/Row (\d+)/.exec(row.textContent)[1]);
            check.equal(api.getTableVirtualRowIndex(row), rowIndex + 1, "cell editor indexes include offscreen rows");
            check.equal(api.getTableVirtualCellIndex(row.cells[3]), (rowIndex + 1) * 5 + 3);
            check.equal(getComputedStyle(row).backgroundColor, rowIndex % 2 === 1 ? "rgb(12, 34, 56)" : "rgba(0, 0, 0, 0)",
                "window changes retain alternating row backgrounds");
        }
        const snapshot = f.editor.innerHTML;
        const lute = Lute.New();
        lute.SetSpin(true);
        lute.SetKramdownIAL(true);
        lute.SetHTMLTag2TextMark(true);
        lute.SetProtyleWYSIWYG(true);
        lute.SetTextMark(true);
        const protectedLute = api.protectLuteTableVirtualization(lute);
        check.ok(lute.BlockDOM2StdMd(f.original).includes("Row 1999 cell 4"));
        check.equal(protectedLute.BlockDOM2StdMd(snapshot), lute.BlockDOM2StdMd(f.original), "copy/export retains all rows");
        const reference = f.table.querySelector('tbody [data-type="virtual-block-ref"]');
        reference.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: pinned ? "touch" : "mouse"}));
        check.ok(reference.isConnected, "reference interaction retains its event target");
        reduced(f.table, "single-cell interaction keeps offscreen rows detached");
        reference.dispatchEvent(new Event("copy", {bubbles: true}));
        check.equal(f.table.tBodies[0].rows.length, 2000, "copy restores the complete table");
        check.equal(f.table.rows[f.table.rows.length - 1], f.originalLastRow,
            "interaction reuses offscreen row nodes without parsing the table again");
        reference.dispatchEvent(new PointerEvent("pointerup", {bubbles: true}));
        rowsMatch(protectedLute.SpinBlockDOM(snapshot));
        const operations: IOperation[] = [{action: "update", id: "table", data: snapshot},
            {action: "insert", id: "copy", data: snapshot}];
        api.cleanBlockSelectionModeOperations(operations);
        operations.forEach(operation => {
            check.equal(typeof operation.data, "string");
            if (typeof operation.data === "string") {
                rowsMatch(operation.data);
            }
        });
        f.virtualizer.destroy();
        rowsMatch(f.editor.innerHTML);
        check.equal(api.cleanTableVirtualizationHTML(snapshot), f.original, "snapshots outlive the editor and its caches");
        f.root.remove();
    }
    {
        const f = fixture(600, false, table => {
            const columns = document.createElement("colgroup");
            columns.innerHTML = '<col style="width:60px;background:rgb(20, 30, 40)">' + '<col style="width:60px">'.repeat(4);
            table.prepend(columns);
        });
        await tick();
        check.equal(api.cleanTableVirtualizationHTML(f.editor.innerHTML), f.original, "authored column styles survive virtualization");
        check.equal(f.table.querySelector("col").style.backgroundColor, "rgb(20, 30, 40)");
        f.editorController.pending.set(1, () => {});
        f.root.dispatchEvent(new WheelEvent("wheel", {bubbles: true}));
        await tick();
        rowsMatch(f.editor.innerHTML, 600);
        f.editorController.pending.clear();
        f.viewport.style.width = "320px";
        f.editor.style.fontSize = "28px";
        f.editor.style.lineHeight = "42px";
        await tick();
        check.ok(f.table.hasAttribute("data-sy-table-virtual-id"), "narrow layouts and large fonts rebuild the window");
        f.editor.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch"}));
        rowsMatch(f.editor.innerHTML, 600);
        f.editor.dispatchEvent(new Event("touchmove", {bubbles: true}));
        await tick();
        check.ok(f.table.hasAttribute("data-sy-table-virtual-id"), "touch scrolling uses the shared window");
        f.editor.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, pointerType: "touch"}));
        const cells = f.table.querySelectorAll("tbody > tr:not([data-sy-table-virtual-rows]) td");
        const range = document.createRange();
        range.setStart(cells[0], 0);
        range.setEnd(cells[cells.length - 1], 1);
        getSelection().addRange(range);
        await tick();
        rowsMatch(f.editor.innerHTML, 600);
        f.destroy();
    }
    {
        const f = fixture();
        await tick();
        const cell = f.table.querySelector<HTMLTableCellElement>("tbody td");
        const range = document.createRange();
        range.selectNodeContents(cell);
        range.collapse(true);
        getSelection().addRange(range);
        f.scroller.scrollTop = f.scroller.scrollHeight / 2;
        await tick();
        check.ok(cell.isConnected, "caret chunk stays connected outside the viewport");
        check.equal(getSelection().anchorNode, range.startContainer);
        reduced(f.table);
        cell.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "mouse"}));
        reduced(f.table, "click does not materialize the entire table");
        cell.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, pointerType: "mouse", buttons: 1, movementX: 10}));
        reduced(f.table, "dragging inside the table does not materialize offscreen rows");
        const logical = api.getVirtualTableGrid(f.table);
        check.equal(logical.rowCount, 2001);
        check.equal(logical.cellInfos.length, 10005);
        check.equal(logical.grid[2000][0].parentElement, f.originalLastRow);
        const renderedCells = f.table.querySelectorAll<HTMLTableCellElement>("tbody > tr:not([data-sy-table-virtual-rows]) td");
        const endpoint = renderedCells[renderedCells.length - 1];
        api.setTableVirtualSelection(f.table, [cell, endpoint]);
        f.scroller.scrollTop = f.scroller.scrollHeight * 0.9;
        await tick();
        reduced(f.table, "drag scrolling retains a bounded window");
        check.ok(cell.isConnected && endpoint.isConnected, "selection endpoints stay connected across scrolling");
        cell.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, pointerType: "mouse"}));
        cell.dispatchEvent(new Event("copy", {bubbles: true}));
        check.equal(f.table.tBodies[0].rows.length, 2000, "copy restores all selected rows");
        check.ok(logical.grid[2000][0].isConnected, "logical selection identities survive materialization");
        api.setTableVirtualSelection(f.table);
        cell.textContent = "Edited cell";
        f.root.dispatchEvent(new WheelEvent("wheel", {bubbles: true}));
        await tick();
        reduced(f.table);
        const after = api.cleanTableVirtualizationHTML(f.editor.innerHTML);
        rowsMatch(after);
        check.ok(after.includes("Edited cell"));
        const next = f.table.querySelector<HTMLTableCellElement>("tbody > tr:not([data-sy-table-virtual-rows]) td");
        const tableWidth = f.table.getBoundingClientRect().width;
        next.textContent = "Programmatic edit " + "Long cell content ".repeat(40);
        await tick();
        check.ok(Math.abs(f.table.getBoundingClientRect().width - tableWidth) < 1,
            "cell edits preserve the column widths used by offscreen row measurements");
        rowsMatch(api.cleanTableVirtualizationHTML(f.editor.innerHTML));
        check.ok(f.editor.textContent.includes("Programmatic edit"), "source updates keep visible edits and offscreen rows");
        f.destroy();
    }
    {
        const f = fixture();
        await tick();
        reduced(f.table);
        const owner = {wysiwyg: {element: f.editor}, contentElement: f.viewport, highlight: f.highlight,
            block: {rootID: "root"}} as unknown as IProtyle;
        await new Promise<void>(resolve => api.searchMarkRender(owner, ["Row 1999 cell 4"], undefined, resolve));
        check.equal(f.highlight.ranges.length, 1, "search includes rows outside the virtual window");
        check.equal(f.highlight.ranges[0].toString(), "Row 1999 cell 4");
        f.scroller.scrollTop = f.scroller.scrollHeight / 2;
        await tick();
        rowsMatch(f.editor.innerHTML);
        f.destroy();
    }
    {
        const f = fixture();
        await tick();
        const cell = f.table.querySelector<HTMLTableCellElement>("tbody td");
        cell.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        cell.innerHTML = '<div class="table__cell-editor table__cell--inline"><div class="protyle-wysiwyg" contenteditable="true">Editing</div>' +
            '<button class="fn__none"><svg></svg></button></div>';
        const host = cell.firstElementChild;
        cell.style.verticalAlign = "top";
        f.editor.classList.add("protyle-wysiwyg--hiderange");
        cell.dispatchEvent(new PointerEvent("pointerup", {bubbles: true}));
        await tick();
        reduced(f.table, "cell and selection styles do not materialize the table");
        const editable = host.querySelector('[contenteditable="true"]');
        const textRange = document.createRange();
        textRange.selectNodeContents(editable);
        getSelection().addRange(textRange);
        document.dispatchEvent(new Event("selectionchange"));
        for (const type of ["keydown", "beforeinput", "copy", "cut", "paste", "compositionstart", "compositionend"]) {
            editable.dispatchEvent(new Event(type, {bubbles: true}));
            await tick();
            reduced(f.table, `cell-local ${type} keeps the window`);
        }
        const forwarded = new KeyboardEvent("keydown", {bubbles: true, key: "a"});
        api.setTableCellRichEventTarget(forwarded, host as HTMLElement);
        f.root.dispatchEvent(forwarded);
        reduced(f.table, "forwarded shortcuts retain their cell editor origin");
        editable.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, buttons: 1, movementX: 10}));
        reduced(f.table, "text selection inside the editor keeps the window");
        for (const progress of [0.5, 1, 0]) {
            f.scroller.scrollTop = (f.scroller.scrollHeight - f.scroller.clientHeight) * progress;
            f.root.dispatchEvent(new WheelEvent("wheel", {bubbles: true}));
            await tick();
            reduced(f.table, "scrolling with an inline cell editor");
            host.querySelector("button").style.top = `${progress * 100}px`;
            await tick();
            reduced(f.table, "inline editor overlay updates after scrolling");
            check.ok(host.isConnected, "the active editor survives scrolling outside the viewport");
            check.equal(cell.firstElementChild, host, "the editor is never recreated from serialized HTML");
            check.ok(Array.from(f.table.querySelectorAll("tr[data-sy-table-virtual-rows]")).every(row =>
                !row.getAttribute("data-sy-table-virtual-rows").includes("table__cell-editor")));
        }
        f.destroy();
    }
    for (const event of ["copy", "cut", "paste", "keydown", "beforeinput", "compositionstart", "beforeprint"]) {
        const f = fixture(300);
        await tick();
        check.ok(f.table.hasAttribute("data-sy-table-virtual-id"));
        f.editor.dispatchEvent(new Event(event, {bubbles: true}));
        rowsMatch(f.editor.innerHTML, 300);
        f.destroy();
    }
    for (const mutate of [
        (table: HTMLTableElement) => { table.rows[2].cells[0].rowSpan = 2; },
        (table: HTMLTableElement) => { table.rows[2].cells[0].colSpan = 2; },
        (table: HTMLTableElement) => { table.rows[2].cells[0].innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">'; },
        (table: HTMLTableElement) => { table.rows[2].cells[0].innerHTML = '<span class="table__cell-rich">Rich</span>'; },
    ]) {
        const f = fixture(300, false, mutate);
        await tick();
        check.equal(f.editor.innerHTML, f.original, "complex tables retain their complete rendering");
        f.destroy();
    }
    {
        const f = fixture(120);
        await tick();
        check.equal(f.editor.innerHTML, f.original, "small tables are unchanged");
        let builds = 0;
        const cache = new api.TableGridCache(table => { builds++; return api.buildTableGrid(table); });
        const grid = cache.get(f.table);
        for (let i = 0; i < 100; i++) {
            check.equal(cache.get(f.table), grid);
        }
        check.equal(builds, 1, "scroll/hover reads reuse the grid");
        f.table.rows[1].cells[0].textContent = "Changed";
        check.equal(cache.get(f.table), grid, "text changes do not invalidate cell structure");
        f.table.rows[1].cells[0].colSpan = 2;
        check.notEqual(cache.get(f.table), grid, "synchronous span changes invalidate the grid");
        const beforeRowInsert = cache.get(f.table);
        const row = f.table.tBodies[0].insertRow();
        row.insertCell();
        check.notEqual(cache.get(f.table), beforeRowInsert);
        let rowMeasurements = 0;
        Array.from(f.table.rows).forEach(row => {
            const measure = row.getBoundingClientRect.bind(row);
            row.getBoundingClientRect = () => { rowMeasurements++; return measure(); };
        });
        check.ok(api.getTableGridRect(f.table).height > 0);
        check.equal(rowMeasurements, 0, "bounds calculation does not visit individual rows");
        cache.destroy();
        f.destroy();
    }
    return "Large table virtualization cases passed";
};

test("large tables retain complete source, editing, selection, search and layout with bounded rendered rows", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 60000,
}, async () => {
    const read = (file: string) => readFileSync(path.join(__dirname, file), "utf8");
    const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const extract = (file: string, name: string) => {
        const source = createSourceFile(file, read(file), ScriptTarget.Latest, true);
        return compile(source.statements.filter(isVariableStatement).find(statement =>
            statement.declarationList.declarations.some(declaration => declaration.name.getText(source) === name)).getText(source));
    };
    const source = ["../util/tableVirtualizationDOM.ts", "../util/tableCellRichContext.ts", "../util/tableGridCache.ts", "tableVirtualization.ts",
        "../render/searchMarkRender.ts"].map(file => compile(read(file))).join("\n") +
        "\nconst cleanListMindmapHTML = value => value; const cleanTableCellRichHTML = value => value; " +
        "const cleanBlockSelectionModeHTML = value => value;\n" +
        extract("../util/table.ts", "buildTableGrid") + extract("transaction.ts", "cleanBlockSelectionModeOperations");
    const wysiwyg = createSourceFile("index.ts", read("index.ts"), ScriptTarget.Latest, true);
    const prepare = wysiwyg.statements.find(isClassDeclaration).members.find(member =>
        member.name?.getText(wysiwyg) === "prepareBlockVirtualization");
    const integration = compile(`class VirtualizedEditor {
        tableControl = {getSelectedCells: () => [], hasVirtualCellSelection: () => false};
        pendingInputTimeouts = new Map();
        runningInputTasks = new Set();
        constructor(protyle) {this.protyle = protyle; this.element = protyle.wysiwyg.element;}
        get virtualizer() {return this.largeTableVirtualizer;}
        get pending() {return this.pendingInputTimeouts;}
        ${prepare.getText(wysiwyg)}
    }`);
    const css = require("sass").compile(path.resolve(__dirname, "../../assets/scss/component/_typography.scss")).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-table-virtualization-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:900, height:700,
        webPreferences:{nodeIntegration:true, contextIsolation:false, backgroundThrottling:false, offscreen:true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(source + integration) + "," + JSON.stringify(css) + ")")}));
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
            {env, timeout: 55000, windowsHide: true});
        assert.match(result.stdout, /Large table virtualization cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-table-virtualization-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
