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

const checkClicks = (code: string, mobile: boolean) => {
    const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
    document.body.innerHTML = `<div class="protyle-wysiwyg" style="height:600px"><div class="av" data-av-type="table" data-node-id="database">
<div class="av__scroll"><div class="av__body"><div class="av__row" data-id="row">
<div class="av__cell" data-id="empty" data-dtype="text"><span class="av__celltext"></span></div>
<div class="av__cell" data-id="filled" data-dtype="text"><span class="av__celltext">value</span></div>
<div class="av__cell" data-id="rich" data-dtype="text"><div class="av__celltext av__celltext--rich"><p><strong>formatted</strong><a href="https://example.com">link</a></p></div></div>
</div></div></div></div></div>`;
    const element = document.querySelector<HTMLElement>(".protyle-wysiwyg");
    const block = element.querySelector<HTMLElement>(".av");
    const opened: HTMLElement[] = [];
    const navigated: string[] = [];
    const selected: HTMLElement[] = [];
    let filled = 0;
    const closest = (target: Element, name: string) => target?.closest("." + name);
    const clear = () => {
        selected.length = 0;
        element.querySelectorAll(".av__cell--select, .av__cell--active").forEach(cell =>
            cell.classList.remove("av__cell--select", "av__cell--active"));
    };
    const protyle = {element, contentElement: element, wysiwyg: {element}, toolbar: {isMultiSelectMode: () => false}};
    const dependencies = {
        protyle, isMobile: () => mobile, isOnlyMeta: (event: MouseEvent) => event.ctrlKey || event.metaKey,
        hasClosestByClassName: closest, hasClosestBlock: (target: Element) => closest(target, "av"),
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
            cell.classList.add("av__cell--select");
            return true;
        },
        selectAVCellRange: (_block: HTMLElement, cell: HTMLElement) => {
            selected.push(cell);
            cell.classList.add("av__cell--active");
        },
        focusBlock() {}, selectRow() {}, addDragFill() { filled++; }, resetAVRowSelect() {}, updateHeader() {},
        getTypeByCellElement: (cell: HTMLElement) => cell.dataset.dtype,
        popTextCell: (_protyle: unknown, cells: HTMLElement[]) => opened.push(...cells),
        getAVRichTextSafeURL: (href: string) => href,
        openLink: (_app: unknown, href: string) => navigated.push(href),
    };
    const harness = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
    harness.element = element;
    let failure: Error;
    const listen = (type: string, callback: (event: MouseEvent) => void) => element.addEventListener(type, event => {
        try { callback(event as MouseEvent); } catch (error) { failure = error; }
    });
    listen("mousedown", event => harness.down(event));
    listen("click", event => harness.click(event));
    const send = (type: string, target: Element, clientX = 100) => {
        target.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, clientX, clientY: 20, button: 0}));
        if (failure) throw failure;
    };
    for (const view of ["table", "list"]) {
        block.dataset.avType = view;
        for (const id of ["empty", "filled", "rich"]) {
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
        }
        const start = element.querySelector<HTMLElement>('[data-id="filled"]');
        const end = element.querySelector<HTMLElement>('[data-id="rich"]');
        const previous = opened.length;
        send("mousedown", start);
        send("mousemove", end, 110);
        send("mouseup", end, 110);
        send("click", block);
        check(opened.length === previous && selected.includes(start) && selected.includes(end), `${view}: dragging selects without editing`);
        check(filled > 0, `${view}: drag selection retains the fill handle`);
        const link = end.querySelector("a");
        send("mousedown", link);
        send("mouseup", link);
        send("click", link);
        check(navigated.at(-1) === "https://example.com" && opened.length === previous, `${view}: links navigate without editing`);
    }
    return "av-cell-click-ok";
};

for (const mobile of [false, true]) {
    test(`database text fields open on the first click and preserve drag selection and links (${mobile ? "mobile" : "desktop"})`, {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const directory = mkdtempSync(path.join(tmpdir(), "siyuan-av-cell-click-"));
        const script = path.join(directory, "main.cjs");
        const code = ts.transpileModule(parse(`${avClick.getText(action).replace(/^export /, "")}
class Harness {
    down = ${handlers.get("mousedown").getText(source)};
    click(event) { ${preventClick.getText(source)} return avClick(protyle, event); }
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
