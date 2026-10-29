import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    check.ok(Math.abs(window.innerWidth - 1500) <= 2 && Math.abs(window.innerHeight - 1200) <= 2,
        `unexpected drag test viewport: ${window.innerWidth}x${window.innerHeight}`);
    Object.assign(window, {siyuan: {config: {editor: {}}, languages: {database: "Database"}, dialogs: []}});
    document.head.innerHTML = `<style>${css}
        :root {--b3-theme-primary:#1565c0}
        .av__row {display:flex; min-height:40px; position:relative} .fn__hr {height:8px}
        .fn__none {display:none} .block__icon {width:20px} .custom-attr__avheader {height:30px}
    </style>`;
    const operations: IOperation[][][] = [];
    const tables = ["first", "second"].map(avID => ({avID, avName: avID, blockIDs: ["carrier"],
        keyValues: ["A", "B", "C", "D", "E", "F"].map(id => ({key: {id, name: id, type: "text"}, values: [{text: {content: id}}]}))}));
    const render = new Function("fetchPost", "createEmptyAVValue", "getColIconByType", "cellValueIsEmpty", "genAVAttributeRowHTML",
        "preserveAVBindingRange", "renderAVRichTextElements", "hasClosestBlock", "hasClosestByClassName", "transaction", "hasDataTransferFiles",
        source + "\nreturn {renderAVAttribute, getAVAttributeDropTarget, getAVAttributeSort};")(
        (url: string, _body: unknown, callback: (response: {data: unknown}) => void) =>
            callback({data: url.endsWith("getAttributeViewKeys") ? tables : {total: 0}}),
        () => ({}), () => "iconText", () => false,
        ({keyID}: {keyID: string}) => `<div class="av__row block__icons" data-col-id="${keyID}" data-id="item">
            <div class="block__icon" draggable="true">drag</div><div class="block__logo">${keyID}</div></div>`,
        () => () => {}, () => {}, (element: HTMLElement) => element?.closest('[data-type="NodeAttributeView"]'),
        (element: HTMLElement, className: string) => element?.closest("." + className),
        (_protyle: unknown, forward: IOperation[], undo: IOperation[]) => operations.push([forward, undo]),
        (types: string[]) => types.includes("Files"));
    const fixture = (className = "protyle-db-attr__body", width = 1100) => {
        document.body.innerHTML = "";
        operations.length = 0;
        const panel = document.createElement("div");
        panel.className = "custom-attr " + className;
        panel.style.width = width + "px";
        document.body.append(panel);
        const protyle = {disabled: false, options: {history: {}}};
        render.renderAVAttribute(panel, "item", protyle);
        const block = panel.querySelector<HTMLElement>('[data-av-id="first"]');
        const row = (id: string) => block.querySelector<HTMLElement>(`.av__row[data-col-id="${id}"]`);
        const order = () => Array.from(block.querySelectorAll<HTMLElement>(".av__row")).map(item => item.dataset.colId);
        const transfer = new DataTransfer();
        const event = (type: string, target: HTMLElement, x = 0, y = 0) => {
            const e = new DragEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer});
            target.dispatchEvent(e);
            return e;
        };
        const begin = (id: string) => event("dragstart", row(id).firstElementChild as HTMLElement);
        const at = (id: string, x: number, y = .5) => {
            const rect = row(id).getBoundingClientRect();
            return {x: rect.left + rect.width * x, y: rect.top + rect.height * y};
        };
        let lastPoint: {x: number, y: number};
        const over = (id: string, x: number, y = .5) => {
            lastPoint = at(id, x, y);
            return event("dragover", row(id), lastPoint.x, lastPoint.y);
        };
        const drop = (id: string, x: number, y = .5) => {
            const p = lastPoint || at(id, x, y);
            return event("drop", document.elementFromPoint(p.x, p.y) as HTMLElement, p.x, p.y);
        };
        return {panel, block, protyle, row, order, event, begin, over, drop, at};
    };
    for (const className of ["protyle-db-attr__body", "protyle-db-row__body"]) {
        for (const [source, destination, expected] of [
            ["B", "D", ["A", "C", "D", "B", "E", "F"]],
            ["F", "D", ["A", "B", "C", "F", "D", "E"]],
            ["A", "C", ["B", "C", "A", "D", "E", "F"]],
            ["E", "C", ["A", "B", "E", "C", "D", "F"]],
        ] as const) {
            for (const fraction of [.1, .5, .9]) {
                for (const vertical of [.1, .5, .9]) {
                    const f = fixture(className);
                    const point = f.at(destination, fraction, vertical);
                    const slot = f.row(destination).getBoundingClientRect();
                    f.begin(source);
                    f.event("dragover", f.row(destination), point.x, point.y);
                    check.deepEqual(f.order(), expected, `${source} to ${destination} occupies the hovered slot`);
                    check.equal(f.row(source).getBoundingClientRect().left, slot.left, "vertical dragging keeps the hovered column");
                    check.equal(operations.length, 0);
                    f.event("drop", document.elementFromPoint(point.x, point.y) as HTMLElement, point.x, point.y);
                    check.deepEqual(f.order(), expected, "drop preserves the previewed slot");
                    check.equal(operations.length, 1);
                }
            }
        }
    }
    const continuous = fixture();
    continuous.begin("B");
    for (const target of ["D", "F", "E"]) {
        const point = continuous.at(target, .1);
        const slot = continuous.row(target).getBoundingClientRect();
        continuous.event("dragover", continuous.row(target), point.x, point.y);
        check.equal(continuous.row("B").getBoundingClientRect().left, slot.left, "continuous vertical dragging keeps the hovered column");
        check.equal(operations.length, 0, "intermediate previews do not create transactions");
    }
    const release = continuous.at("B", .1);
    continuous.event("drop", continuous.row("B"), release.x, release.y);
    check.equal(operations.length, 1);
    check.equal(operations[0][1][0].previousID, "A", "undo uses the position at drag start");
    for (const className of ["protyle-db-attr__body", "protyle-db-row__body"]) {
        for (const columns of [2, 1]) {
            document.documentElement.style.setProperty("--b3-database-attr-columns", String(columns));
            const f = fixture(className);
            const a = f.row("A").getBoundingClientRect(), b = f.row("B").getBoundingClientRect();
            check.equal(a.top === b.top, columns === 2, className);
            const expected = columns === 2 ? ["E", "A", "B", "C", "D", "F"] : ["A", "E", "B", "C", "D", "F"];
            f.begin("E");
            f.over("A", .9, .9);
            if (columns === 2) {
                check.deepEqual(f.order(), expected, "dragging previews the complete order");
                check.equal(getComputedStyle(f.row("E")).outlineWidth, "2px");
                check.equal(operations.length, 0, "preview does not save field order");
            } else {
                check.equal(f.row("A").classList.contains("dragover__bottom"), true);
                check.deepEqual(f.order(), ["A", "B", "C", "D", "E", "F"]);
            }
            f.drop("A", .9, .9);
            check.deepEqual(f.order(), expected);
            check.deepEqual(operations[0], [[{action: "sortAttrViewKey", avID: "first", previousID: columns === 2 ? "" : "A", id: "E"}],
                [{action: "sortAttrViewKey", avID: "first", previousID: "D", id: "E"}]]);
            check.equal(f.panel.querySelector('[class*="dragover__"]'), null);
            check.equal(window.siyuan.dragElement, undefined);
            // 用实际撤销操作的字段 ID 和前驱重建顺序，再执行重做。
            const undo = operations[0][1][0];
            f.row(undo.previousID).after(f.row(undo.id));
            check.deepEqual(f.order(), ["A", "B", "C", "D", "E", "F"]);
            f.begin("E"); f.over("A", .9, .9); f.drop("A", .9, .9);
            check.deepEqual(f.order(), expected);
        }
        document.documentElement.style.setProperty("--b3-database-attr-columns", "2");
        const narrow = fixture(className, 800);
        check.ok(narrow.row("B").getBoundingClientRect().top > narrow.row("A").getBoundingClientRect().top);
        narrow.begin("F"); narrow.over("A", .9, .1); narrow.drop("A", .9, .1);
        check.deepEqual(narrow.order(), ["F", "A", "B", "C", "D", "E"]);
        check.equal(operations[0][0][0].previousID, "");
    }
    const f = fixture();
    f.row("A").style.minHeight = "120px";
    f.row("C").dataset.panelVisibility = "hide";
    check.equal(f.row("C").getClientRects().length, 0);
    f.begin("F"); f.over("D", .1);
    check.deepEqual(f.order(), ["A", "B", "C", "F", "D", "E"], "preview preserves hidden fields in the full order");
    f.drop("D", .1);
    check.deepEqual(f.order(), ["A", "B", "C", "F", "D", "E"]);
    const gap = fixture();
    const left = gap.row("A").getBoundingClientRect(), right = gap.row("B").getBoundingClientRect();
    gap.begin("F");
    gap.event("dragover", gap.block, left.right + 2, left.top + 10);
    check.deepEqual(gap.order(), ["A", "F", "B", "C", "D", "E"]);
    gap.event("drop", gap.block, right.left - 2, right.top + 10);
    check.deepEqual(gap.order(), ["A", "F", "B", "C", "D", "E"]);
    const odd = fixture();
    odd.row("F").remove();
    odd.begin("A");
    const last = odd.row("E").getBoundingClientRect(), bounds = odd.block.getBoundingClientRect();
    odd.event("dragover", odd.block, bounds.right - 10, last.top + 10);
    odd.event("drop", odd.block, bounds.right - 10, last.top + 10);
    check.deepEqual(odd.order(), ["B", "C", "D", "E", "A"]);
    for (const invalid of ["same", "self", "other", "footer", "readonly", "end", "leave", "removed"]) {
        const h = fixture();
        h.begin("E"); h.over(invalid === "self" ? "E" : "A", .9);
        if (invalid === "same") {
            h.event("dragend", h.row("E"));
            h.begin("B"); h.over("A", .9); h.over("A", .9); h.drop("B", .9);
        }
        if (invalid === "self") { h.over("E", .9); h.drop("E", .9); }
        if (invalid === "other") {
            const target = h.panel.querySelector<HTMLElement>('[data-av-id="second"] .av__row');
            const rect = target.getBoundingClientRect();
            h.event("dragover", target, rect.left + 10, rect.top + 10);
            h.event("drop", target, rect.left + 10, rect.top + 10);
        }
        if (invalid === "footer") h.event("drop", h.block, bounds.left + 20, h.block.getBoundingClientRect().bottom - 1);
        if (invalid === "readonly") { h.protyle.disabled = true; h.drop("A", .9); }
        if (invalid === "end") h.event("dragend", h.row("E"));
        if (invalid === "leave") { h.event("dragleave", h.panel); }
        if (invalid === "removed") {
            const source = h.row("E").firstElementChild as HTMLElement;
            h.block.remove(); h.event("dragend", source);
        }
        check.equal(operations.length, 0, invalid);
        check.equal(h.panel.querySelector('[class*="dragover__"]'), null, invalid);
        h.event("dragend", h.panel);
        check.equal(window.siyuan.dragElement, undefined, invalid);
        if (invalid !== "removed") check.deepEqual(h.order(), ["A", "B", "C", "D", "E", "F"], invalid + " restores the original order");
    }
    const handle = fixture();
    handle.begin("F");
    const handleRect = handle.row("A").firstElementChild.getBoundingClientRect();
    const x = handleRect.left + handleRect.width / 2, y = handleRect.top + handleRect.height / 2;
    handle.event("dragover", handle.row("A").firstElementChild as HTMLElement, x, y);
    check.equal(handle.row("F").dataset.avDragPreview, "true", "the handle gutter remains a valid target");
    handle.event("dragend", handle.panel);
    check.deepEqual(handle.order(), ["A", "B", "C", "D", "E", "F"]);
    const tall = fixture();
    tall.row("A").style.minHeight = "140px";
    const point = tall.at("D", .9);
    tall.begin("A");
    tall.event("dragover", tall.row("D"), point.x, point.y);
    const preview = tall.order();
    for (let i = 0; i < 5; i++) {
        const target = document.elementFromPoint(point.x, point.y) as HTMLElement;
        tall.event("dragover", target, point.x, point.y);
        check.deepEqual(tall.order(), preview, "stationary dragging must not oscillate when row heights change");
    }
    tall.event("drop", document.elementFromPoint(point.x, point.y) as HTMLElement, point.x, point.y);
    check.deepEqual(tall.order(), preview, "dropping commits exactly the visible preview");
    check.equal(operations.length, 1);
    const external = fixture();
    const link = document.createElement("a");
    link.draggable = true;
    external.row("A").lastElementChild.append(link);
    check.equal(external.event("dragstart", link).defaultPrevented, false, "non-field dragging remains available to other handlers");
    check.equal(window.siyuan.dragElement, undefined);
    for (const className of ["protyle-db-attr__body", "protyle-db-row__body"]) {
        document.documentElement.style.setProperty("--b3-database-attr-column-flow", "1");
        const col = fixture(className);
        const rect = (id: string) => col.row(id).getBoundingClientRect();
        check.equal(rect("A").left, rect("B").left);
        check.equal(rect("A").left, rect("C").left);
        check.ok(rect("D").left > rect("A").left);
        check.equal(rect("A").top, rect("D").top);
        check.ok(rect("B").top > rect("A").top);
        check.ok(rect("C").top > rect("B").top);
        check.deepEqual(col.order(), ["A", "B", "C", "D", "E", "F"], "column layout preserves the underlying field sequence");
        check.ok(col.block.querySelector(".custom-attr__avheader").getBoundingClientRect().bottom <= rect("A").top);
        check.ok(col.block.querySelector('[data-type="addColumn"]').getBoundingClientRect().top >= rect("C").bottom);
        col.row("C").dataset.panelVisibility = "hide";
        await Promise.resolve();
        check.equal(rect("D").left, rect("A").left, "visible fields are split by count with the extra field on the left");
        check.ok(rect("E").left > rect("A").left);
        col.block.dataset.panelShowAll = "true";
        await Promise.resolve();
        check.ok(rect("D").left > rect("A").left, "revealing fields recalculates both columns");
        col.block.dataset.panelShowAll = "false";
        col.row("C").dataset.panelVisibility = "";
        col.row("B").dataset.panelVisibility = "hide-empty";
        col.row("B").dataset.empty = "true";
        await Promise.resolve();
        check.equal(rect("D").left, rect("A").left);
        col.row("B").dataset.empty = "false";
        await Promise.resolve();
        check.ok(rect("D").left > rect("A").left, "value changes recalculate hidden-empty fields");
        const rightColumn = rect("D").left;
        col.row("A").style.minHeight = "160px";
        check.equal(rect("D").left, rightColumn, "editing content height does not move fields between columns");
        col.panel.style.width = "800px";
        check.equal(rect("A").left, rect("D").left);
        check.ok(rect("D").top > rect("C").top, "narrow column layout follows the complete single-column sequence");
        col.panel.style.width = "1100px";
        col.begin("B"); col.over("E", .1, .9);
        check.equal(col.row("E").classList.contains("dragover__bottom"), true, "column layout uses vertical insertion");
        check.equal(operations.length, 0);
        col.drop("E", .1, .9);
        check.deepEqual(col.order(), ["A", "C", "D", "E", "B", "F"]);
        check.deepEqual(operations[0], [[{action: "sortAttrViewKey", avID: "first", previousID: "E", id: "B"}],
            [{action: "sortAttrViewKey", avID: "first", previousID: "A", id: "B"}]]);
        check.ok(rect("B").left > rect("A").left);
        document.documentElement.style.setProperty("--b3-database-attr-column-flow", "0");
        check.equal(rect("A").top, rect("C").top, "switching to row layout reuses the same data without reordering it");
        check.deepEqual(col.order(), ["A", "C", "D", "E", "B", "F"]);
    }
    return "Database panel layout and drag cases passed";
};

test("database attribute panels render responsive columns with stable drag previews, cancellation and undo", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = ["attributePanelLayout.ts", "attributePanelDrag.ts", "blockAttr.ts"].map(file => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
    {compilerOptions: {target: ScriptTarget.ES2022}}).outputText).join("\n");
    const css = compileString(readFileSync("src/assets/scss/business/_custom.scss", "utf8")).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-panel-drag-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(source) + "," + JSON.stringify(css) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 1500, height: 1200, useContentSize: true,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    // 显式设置内容尺寸，避免初始窗口受屏幕工作区限制而裁掉拖放命中目标。
    win.setContentSize(1500, 1200);
    win.webContents.on("console-message", event => console.error(event.message));
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("try {" + code + "} catch (error) {console.error(error.stack); throw error;} ")}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Database panel layout and drag cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-panel-drag-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
