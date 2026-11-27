import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import * as ts from "typescript";

const {parse} = require("ifdef-loader/preprocessor");
const source = ts.createSourceFile("index.ts", readFileSync("src/protyle/wysiwyg/index.ts", "utf8"), ts.ScriptTarget.Latest, true);
const handlers = new Map<string, ts.ArrowFunction>();
const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "this.element.addEventListener" &&
        ts.isStringLiteral(node.arguments[0]) && ts.isArrowFunction(node.arguments[1])) {
        handlers.set(node.arguments[0].text, node.arguments[1]);
    }
    node.forEachChild(visit);
};
visit(source);
const clickBody = handlers.get("click").body;
assert.ok(ts.isBlock(clickBody));
const preventClick = clickBody.statements.find(node => ts.isIfStatement(node) && node.expression.getText(source) === "this.preventClick");
assert.ok(preventClick);
const action = ts.createSourceFile("action.ts", readFileSync("src/protyle/render/av/action.ts", "utf8"), ts.ScriptTarget.Latest, true);
const avClick = action.statements.find(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(declaration => declaration.name.getText(action) === "avClick"));
assert.ok(avClick);
const rowSource = ts.createSourceFile("row.ts", readFileSync("src/protyle/render/av/row.ts", "utf8"), ts.ScriptTarget.Latest, true);
const selectionSource = ts.createSourceFile("selection.ts", readFileSync("src/protyle/util/selection.ts", "utf8"), ts.ScriptTarget.Latest, true);
const keydownSource = ts.createSourceFile("keydown.ts", readFileSync("src/protyle/render/av/keydown.ts", "utf8"), ts.ScriptTarget.Latest, true);
const avSelectionSource = ts.createSourceFile("selectionState.ts", readFileSync("src/protyle/render/av/selectionState.ts", "utf8"), ts.ScriptTarget.Latest, true);
const declaration = (file: ts.SourceFile, name: string) => {
    const statement = file.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(item => item.name.getText(file) === name));
    assert.ok(statement);
    return statement.getText(file).replace(/^export /, "");
};

const checkClicks = (code: string, mobile: boolean) => {
    const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
    document.body.innerHTML = `<div class="protyle-wysiwyg" contenteditable="true" style="height:600px"><div class="av" data-type="NodeAttributeView" data-av-type="table" data-node-id="database">
<div class="av__scroll"><div class="av__body" data-group-id=""><div class="av__row av__row--header"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div></div>
<div class="av__row" data-id="row"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>
<div class="av__cell" data-id="empty" data-col-id="empty" data-dtype="text"><span class="av__celltext"></span></div>
<div class="av__cell" data-id="filled" data-col-id="filled" data-dtype="text"><span class="av__celltext">value</span></div>
<div class="av__cell" data-id="select" data-col-id="select" data-dtype="select"><span class="av__celltext"></span></div>
<div class="av__cell" data-id="rich" data-col-id="rich" data-dtype="text"><div class="av__celltext av__celltext--rich"><p><strong>formatted</strong><a href="https://example.com">link</a></p></div></div>
</div><div class="av__row av__row--footer"><div class="av__firstcol" aria-hidden="true"><svg></svg></div></div></div></div>
<div class="av__cursor" contenteditable="true">&#8203;</div></div><div class="p"><span>ordinary text</span></div></div>`;
    const element = document.querySelector<HTMLElement>(".protyle-wysiwyg");
    const block = element.querySelector<HTMLElement>(".av");
    const opened: HTMLElement[] = [];
    const navigated: string[] = [];
    const selected: HTMLElement[] = [];
    let keyboardSelection: {cells: HTMLElement[], focus: {groupID: string, rowID: string, colID: string}};
    let anchorCell: HTMLElement;
    let focusCell: HTMLElement;
    const closest = (target: Node, name: string) =>
        (target?.nodeType === Node.TEXT_NODE ? target.parentElement : target as Element)?.closest("." + name);
    const clear = () => {
        selected.length = 0;
        anchorCell = undefined;
        focusCell = undefined;
        element.querySelectorAll(".av__cell--select, .av__cell--active").forEach(cell =>
            cell.classList.remove("av__cell--select", "av__cell--active"));
        element.querySelectorAll(".av__drag-fill").forEach(handle => handle.remove());
    };
    const point = (cell: HTMLElement) => {
        const row = cell.closest<HTMLElement>(".av__row[data-id]");
        return {groupID: "", rowID: row.dataset.id, colID: cell.dataset.colId,
            rowIndex: Array.from(row.parentElement.querySelectorAll(".av__row[data-id]")).indexOf(row),
            colIndex: Array.from(row.querySelectorAll(".av__cell")).indexOf(cell)};
    };
    const selectedRange = () => {
        if (!anchorCell || !focusCell) {
            return;
        }
        const anchor = point(anchorCell);
        const focus = point(focusCell);
        const cells = Array.from(block.querySelectorAll<HTMLElement>(".av__cell")).map(point).filter(cell =>
            cell.rowIndex >= Math.min(anchor.rowIndex, focus.rowIndex) && cell.rowIndex <= Math.max(anchor.rowIndex, focus.rowIndex) &&
            cell.colIndex >= Math.min(anchor.colIndex, focus.colIndex) && cell.colIndex <= Math.max(anchor.colIndex, focus.colIndex));
        return {anchor, focus, cells};
    };
    const protyle = {element, contentElement: element, wysiwyg: {element}, toolbar: {isMultiSelectMode: () => false}};
    const menu = document.createElement("div");
    menu.className = "fn__none";
    window.siyuan = {menus: {menu: {element: menu}}, config: {keymap: {editor: {general: {}}}},
        languages: {dragFill: "Drag to fill"}} as any;
    const closestAV = (target: Element) => closest(target, "av");
    const dependencies = {
        Constants: {SIZE_DRAG_THRESHOLD: 5, KEYCODELIST: {32: " "}},
        protyle, isMobile: () => mobile, isOnlyMeta: (event: MouseEvent) => event.ctrlKey || event.metaKey,
        hasClosestByClassName: closest, hasClosestBlock: closestAV, getAVHost: closestAV,
        hasClosestByTag: (target: Element, tag: string) => target?.closest(tag),
        hasClosestByAttribute: (target: Element, name: string, value: string) => target.closest(`[${name}="${value}"]`),
        getBlockSelectionModeElement: (): HTMLElement => null, getAVTemplateInteractiveElement: (): HTMLElement => null,
        isCardCoverPositioning: () => false,
        shouldFoldEmbeddedListByAlt: () => false, repairHiddenTabSelection() {}, prepareAVColumnWindow() {},
        getAVSelectionRoot: (target: Element) => closest(target, "av"),
        getBlockDragSelectContentBounds: (left: number, right: number) => ({left, right}),
        shouldOpenListItemAttr: () => false, hideElements() {}, clearSelect: clear, isInEmbedBlock: () => false,
        isTableLikeView: (type: string) => type === "table" || type === "list",
        setAVCellAnchor: (_block: HTMLElement, cell: HTMLElement) => {
            selected.push(cell);
            anchorCell = focusCell = cell;
            harness.restore(_block);
            return true;
        },
        selectAVCellRange: (_block: HTMLElement, cell: HTMLElement) => {
            selected.push(cell);
            focusCell = cell;
            harness.restore(_block);
        },
        addDragFill(cell: HTMLElement) {
            if (!cell.querySelector(".av__drag-fill")) {
                cell.insertAdjacentHTML("beforeend", '<div class="av__drag-fill"></div>');
            }
        },
        resetAVRowSelect() {}, updateHeader() {}, clearAVItemSelectionState() {}, isAVReadonlyType: () => false,
        getAvBodyData: () => ({rows: [{id: "row"}]}),
        getAVCellSelection: () => keyboardSelection || selectedRange(), getAVItemSelection() {}, getAVSelectedItems: (): never[] => [],
        openAVRangeInput: (_protyle: unknown, _block: HTMLElement, open: (cell: HTMLElement) => void) => {
            open(keyboardSelection.cells[0]);
            return true;
        },
        matchHotKey: () => false,
        focusByRange: (range: Range) => {getSelection().removeAllRanges(); getSelection().addRange(range);},
        getTypeByCellElement: (cell: HTMLElement) => cell.dataset.dtype,
        popTextCell: (_protyle: unknown, cells: HTMLElement[]) => opened.push(...cells),
        getAVRichTextSafeURL: (href: string) => href,
        openLink: (_app: unknown, href: string) => navigated.push(href),
    };
    const harness = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
    harness.element = element;
    let failure: Error;
    let lastClickResult: unknown;
    const listen = (type: string, callback: (event: MouseEvent) => void) => element.addEventListener(type, event => {
        try { callback(event as MouseEvent); } catch (error) { failure = error; }
    });
    listen("mousedown", event => harness.down(event));
    listen("click", event => { lastClickResult = harness.click(event); });
    element.addEventListener("keydown", event => harness.key(event));
    const send = (type: string, target: Element, clientX = 100, clientY = 20) => {
        target.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, clientX, clientY, button: 0}));
        if (failure) throw failure;
    };
    for (const view of ["table", "list"]) {
        block.dataset.avType = view;
        const header = block.querySelector<HTMLElement>(".av__row--header .av__firstcol");
        const row = block.querySelector<HTMLElement>('.av__row[data-id="row"]');
        const footer = block.querySelector<HTMLElement>(".av__row--footer");
        harness.selectRows(header, "toggle");
        check(row.classList.contains("av__row--select"), `${view}: select-all includes data rows beside calculation placeholders`);
        check(!footer.classList.contains("av__row--select"), `${view}: select-all excludes the calculation row`);
        harness.selectRows(header, "toggle");
        check(!row.classList.contains("av__row--select"), `${view}: toggling select-all clears data rows`);
        harness.selectRows(footer.querySelector(".av__firstcol"), "toggle");
        check(!footer.classList.contains("av__row--select"), `${view}: calculation placeholders do not act as row checkboxes`);
        for (const id of ["empty", "filled", "rich", "select"]) {
            clear();
            const cell = element.querySelector<HTMLElement>(`[data-id="${id}"]`);
            const target = cell.querySelector("strong, span");
            const previous = opened.length;
            send("mousedown", target);
            send("mouseup", target);
            send("click", target);
            check(opened.length === previous + 1 && opened.at(-1) === cell, `${view}/${id}: first click opens the field`);
            send("mousedown", target);
            send("mouseup", target);
            send("click", target);
            check(opened.length === previous + 2, `${view}/${id}: selected cells still open`);
            for (const [clientX, clientY] of [[110, 20], [100, 30]]) {
                send("mousedown", target);
                send("mousemove", target, clientX, clientY);
                send("mouseup", target, clientX, clientY);
                send("click", target, clientX, clientY);
                check(opened.length === previous + 2 && selected.includes(cell), `${view}/${id}: moving within a cell selects without editing`);
            }
            send("mousedown", target);
            send("mousemove", target, 101, 21);
            send("mouseup", target, 102, 21);
            send("click", target, 102, 21);
            check(opened.length === previous + 3, `${view}/${id}: slight pointer movement still opens the editor`);
        }
        const start = element.querySelector<HTMLElement>('[data-id="filled"]');
        const end = element.querySelector<HTMLElement>('[data-id="rich"]');
        const previous = opened.length;
        send("mousedown", start);
        send("mousemove", end, 110);
        send("mouseup", end, 110);
        send("click", block);
        check(opened.length === previous && selected.includes(start) && selected.includes(end), `${view}: dragging selects without editing`);
        check(end.querySelector(".av__drag-fill"), `${view}: drag selection retains the fill handle`);
        const nextRow = row.cloneNode(true) as HTMLElement;
        nextRow.dataset.id = "next";
        row.after(nextRow);
        clear();
        const bottomRight = nextRow.querySelector<HTMLElement>('[data-col-id="rich"]');
        send("mousedown", bottomRight);
        send("mousemove", start, 110);
        send("mouseup", start, 110);
        send("click", block);
        const handles = block.querySelectorAll(".av__drag-fill");
        check(handles.length === 1 && handles[0].parentElement === bottomRight,
            `${view}: a selection dragged upward and left keeps a single fill handle at the bottom right`);
        check(focusCell === start, `${view}: the selection focus stays at the pointer endpoint`);
        nextRow.remove();
        clear();
        send("mousedown", start);
        send("mouseup", start, 110);
        send("click", start, 110);
        check(opened.length === previous, `${view}: releasing at a moved position selects without a mousemove event`);
        send("mousedown", start);
        send("mousemove", block, 110);
        send("mouseup", start);
        send("click", start);
        check(opened.length === previous && selected.includes(start), `${view}: leaving the body and returning keeps the starting cell selected`);
        send("mousedown", start);
        send("mousemove", start, 110);
        start.addEventListener("mouseup", event => event.stopPropagation(), {once: true});
        send("mouseup", start, 110);
        send("click", start, 110);
        check(opened.length === previous, `${view}: an intercepted release cannot turn a drag into editing`);
        send("mousedown", start);
        send("mousemove", start, 110);
        send("mouseup", document.body, 110);
        check(document.onmousemove === null && document.onmouseup === null, `${view}: releasing outside cleans up selection handlers`);
        const ordinaryText = element.querySelector(".p span");
        send("mousedown", ordinaryText);
        send("mouseup", ordinaryText);
        send("click", ordinaryText);
        check(lastClickResult === false, `${view}: an ordinary editor click continues after an interrupted cell drag`);
        send("mousedown", start);
        send("mouseup", start);
        send("click", start);
        check(opened.length === previous + 1, `${view}: a new click opens after an interrupted drag with no click event`);
        const link = end.querySelector("a");
        send("mousedown", link);
        send("mouseup", link);
        send("click", link);
        check(navigated.at(-1) === "https://example.com" && opened.length === previous + 1, `${view}: links navigate without editing`);
        if (!mobile) {
            const range = document.createRange();
            range.selectNodeContents(ordinaryText);
            range.collapse(true);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            send("mousedown", start);
            send("mousemove", start, 110);
            send("mouseup", start, 110);
            send("click", start, 110);
            check(block.contains(getSelection().anchorNode), `${view}: dragging a single cell transfers the native caret into the database`);
            const press = (key: string, options?: KeyboardEventInit) => {
                const event = new KeyboardEvent("keydown", {key, keyCode: key === " " ? 32 : 13,
                    bubbles: true, cancelable: true, ...options});
                element.dispatchEvent(event);
                return event;
            };
            const activate = (key: string, message: string) => {
                const before = opened.length;
                check(press(key).defaultPrevented && opened.length === before + 1 && opened.at(-1) === start,
                    `${view}: ${JSON.stringify(key)} ${message}`);
            };
            activate("Enter", "edits the selected cell after calculation row cleanup");
            keyboardSelection = {cells: [start, end], focus: {groupID: "", rowID: "row", colID: end.dataset.colId}};
            activate("Enter", "starts range entry at the first editable cell");
            activate(" ", "starts range entry at the first editable cell");
            keyboardSelection = undefined;
            activate(" ", "edits the selected cell");
            const before = opened.length;
            press(" ", {ctrlKey: true});
            press(" ", {isComposing: true});
            check(opened.length === before, `${view}: modified space and IME composition do not open the cell`);
        }
    }
    return "av-cell-click-ok";
};

for (const mobile of [false, true]) {
    test(`database cell selection skips calculation placeholders${mobile ? "" : " and routes Enter and Space to editing"} (${mobile ? "mobile" : "desktop"})`, {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const directory = mkdtempSync(path.join(tmpdir(), "siyuan-av-cell-click-"));
        const script = path.join(directory, "main.cjs");
        const code = ts.transpileModule(parse(`${declaration(selectionSource, "focusBlock")}
${declaration(rowSource, "selectRow")}
${declaration(keydownSource, "avKeydown")}
${declaration(avSelectionSource, "restoreAVCellSelection")}
${avClick.getText(action).replace(/^export /, "")}
class Harness {
    down = ${handlers.get("mousedown").getText(source)};
    click(event) { ${preventClick.getText(source)} return avClick(protyle, event); }
    selectRows = selectRow;
    restore = restoreAVCellSelection;
    key(event) { return avKeydown(event, hasClosestBlock(getSelection().anchorNode), protyle, () => false); }
}
return new Harness();`, {MOBILE: mobile}, false, true), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
        const execute = ts.transpileModule(`const __name = (value) => value; try { (${checkClicks.toString()})(${JSON.stringify(code)}, ${mobile}); } catch (error) { String(error.stack); }`, {
            compilerOptions: {target: ts.ScriptTarget.ES2022},
        }).outputText;
        writeFileSync(script, `const {app,BrowserWindow}=require("electron");app.setPath("userData",${JSON.stringify(path.join(directory, "profile"))});
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{offscreen:true}});
try{await win.loadURL("about:blank");console.log(await win.webContents.executeJavaScript(${JSON.stringify(execute)}));app.exit(0)}
catch(error){console.error(error);app.exit(1)}});`);
        try {
            const env = {...process.env};
            delete env.ELECTRON_RUN_AS_NODE;
            const result = await promisify(execFile)(require("electron") as unknown as string, [script, "--no-sandbox"], {env, timeout: 25000});
            assert.match(result.stdout, /av-cell-click-ok/);
        } finally {
            if (path.dirname(path.resolve(directory)) === path.resolve(tmpdir()) && path.basename(directory).startsWith("siyuan-av-cell-click-")) {
                rmSync(directory, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
            }
        }
    });
}
