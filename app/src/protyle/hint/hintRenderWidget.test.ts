import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, contextSource: string, closestSource: string, lutePath: string) => {
    const check: typeof assert = require("node:assert/strict");
    require(lutePath);
    const load = (code: string) => {
        const exports = {};
        new Function("exports", code)(exports);
        return exports;
    };
    const closest = load(closestSource) as typeof import("../util/hasClosest");
    const listContext = load(contextSource);
    const focusByRange = (range: Range) => {
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    };
    const getEditorRange = () => getSelection().rangeCount ? getSelection().getRangeAt(0) : document.createRange();
    const lute = Lute.New();
    lute.SetProtyleWYSIWYG(true);
    lute.SetKramdownIAL(true);
    lute.SetTextMark(true);
    lute.SetSpin(true);
    const paragraph = (withWbr = false) => `<div data-node-id="${Lute.NewNodeID()}" data-type="NodeParagraph" class="p">` +
        `<div contenteditable="true">${withWbr ? "<wbr>" : ""}</div><div class="protyle-attr" contenteditable="false"></div></div>`;
    let widgetsEnabled = true;
    const dependencies = {
        ...closest, ...listContext, focusByRange, getEditorRange,
        Constants: {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing", SIYUAN_VERSION: "test"},
        getHostCapabilities: () => ({widgets: widgetsEnabled}),
        addWidgetCacheVersion: (src: string, version: string) => src + "?siyuan-version=" + version,
        hideElements() {}, isHiddenTabContent: () => false,
        getBlockSelectionModeElement: (): undefined => undefined,
        getEmbedChildOperationContext: (): undefined => undefined,
        BLOCK_SELECTION_CLASS: "protyle-wysiwyg--select",
        prepareInlineElementBoundaryMutation() {}, activateTrackedRangeInsertion() {},
        canEnterCodeBlock: () => false,
        getTextWithoutSemanticMarkers: (element: Element) => element.textContent,
        genEmptyBlock: (_plain: boolean, withWbr: boolean) => paragraph(withWbr),
        updateTransaction() {}, scrollCenter() {},
        insertHTML: (html: string) => {
            const oldBlock = closest.hasClosestBlock(getEditorRange().startContainer);
            check.ok(oldBlock);
            const template = document.createElement("template");
            template.innerHTML = html;
            const widget = template.content.firstElementChild;
            oldBlock.replaceWith(widget);
            api.focusInsertedBlock(widget);
        },
    };
    const api: typeof import("./extend") & typeof import("../wysiwyg/enter") & {
        focusInsertedBlock: (element: Element) => void;
    } = new Function(...Object.keys(dependencies), source + "return {hintRenderWidget, focusInsertedBlock, enter};")(
        ...Object.values(dependencies));
    Object.assign(window, {siyuan: {config: {editor: {markdown: {}}}}});

    for (const marker of ["-", "1.", "- [ ]"]) {
        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        editor.contentEditable = "true";
        editor.innerHTML = lute.Md2BlockDOM(`${marker} 1\n    ${marker} placeholder`);
        document.body.append(editor);
        const parent = editor.querySelector(".p") as HTMLElement;
        const child = editor.querySelector(".li .li .p") as HTMLElement;
        check.ok(child, marker);
        child.firstElementChild.textContent = "";
        const range = document.createRange();
        range.selectNodeContents(child.firstElementChild);
        range.collapse(false);
        focusByRange(range);
        const protyle = {wysiwyg: {element: editor}, toolbar: {range}, lute} as IProtyle;
        api.hintRenderWidget("inline-elements", protyle);
        const widget = editor.querySelector('[data-type="NodeWidget"]');
        const widgetHTML = widget.outerHTML;
        const caret = getEditorRange();
        check.equal(parent.firstElementChild.contains(caret.startContainer), true, marker);
        check.equal(caret.startOffset, 1, marker);
        // 不重新点击父项，直接使用插入命令留下的选区执行回车。
        const selectedBlock = closest.hasClosestBlock(caret.startContainer);
        check.ok(selectedBlock);
        await api.enter(selectedBlock, caret, protyle);
        const subList = parent.nextElementSibling;
        const items = Array.from(subList.children).filter(item => item.getAttribute("data-type") === "NodeListItem");
        check.equal(items.length, 2, marker);
        check.equal(items[0].querySelector("[data-type]").getAttribute("data-type"), "NodeParagraph", marker);
        check.equal(items[1].querySelector("[data-type]"), widget, marker);
        check.equal(widget.outerHTML, widgetHTML, marker);
        if (marker === "1.") {
            check.deepEqual(items.map(item => item.getAttribute("data-marker")), ["1.", "2."]);
        }
        editor.remove();
    }

    for (const markdown of ["placeholder", "- placeholder", "- 1\n  - before\n  - placeholder", "- 1\n  - before\n\n    placeholder"]) {
        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        editor.contentEditable = "true";
        editor.innerHTML = lute.Md2BlockDOM(markdown);
        document.body.append(editor);
        const child = Array.from(editor.querySelectorAll(".p")).find(item => item.textContent.includes("placeholder"));
        child.firstElementChild.textContent = "";
        const range = document.createRange();
        range.selectNodeContents(child.firstElementChild);
        range.collapse(false);
        focusByRange(range);
        api.hintRenderWidget("widget-sample", {wysiwyg: {element: editor}, toolbar: {range}, lute} as IProtyle);
        check.equal(getEditorRange().startContainer, editor.querySelector('[data-type="NodeWidget"]'), markdown);
        editor.remove();
    }
    const editor = document.createElement("div");
    editor.innerHTML = paragraph();
    widgetsEnabled = false;
    const before = editor.innerHTML;
    api.hintRenderWidget("widget-sample", {wysiwyg: {element: editor}} as IProtyle);
    check.equal(editor.innerHTML, before);
    return "widget-focus-ok";
};

test("widget insertion keeps the visible parent caret and immediate Enter creates the first child", {
    timeout: 30000,
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
}, async () => {
    const compile = (source: string, module = ModuleKind.None) => transpileModule(source, {
        compilerOptions: {target: ScriptTarget.ES2021, module},
    }).outputText;
    const extract = (filename: string, names: string[]) => {
        const source = createSourceFile(filename, readFileSync(filename, "utf8"), ScriptTarget.Latest);
        return names.map(name => {
            const declaration = source.statements.find(statement => isVariableStatement(statement) &&
                statement.declarationList.declarations.some(item => item.name.getText(source) === name));
            assert.ok(declaration, name);
            return declaration.getText(source).replace(/^export /, "");
        }).join("\n");
    };
    const source = compile([
        extract("src/protyle/hint/extend.ts", ["hintRenderWidget"]),
        extract("src/protyle/util/insertHTML.ts", ["focusInsertedBlock"]),
        extract("src/protyle/util/selection.ts", ["focusBlock", "focusByWbr"]),
        extract("src/protyle/util/selectionOffsets.ts", ["selectIsEditor", "getSelectionOffset", "setLastNodeRange"]),
        extract("src/protyle/wysiwyg/getBlock.ts", ["getContenteditableElement", "isContainerBlock", "isNotEditBlock"]),
        extract("src/protyle/wysiwyg/list.ts", ["genListItemElement", "getOrderedListItemElements", "getOrderedListStart", "updateListOrder"]),
        extract("src/protyle/wysiwyg/enter.ts", ["enter", "listEnter", "removeEmptyNode"]),
    ].join("\n"));
    const context = compile(readFileSync("src/protyle/wysiwyg/listContext.ts", "utf8"), ModuleKind.CommonJS);
    const closest = compile(readFileSync("src/protyle/util/hasClosest.ts", "utf8"), ModuleKind.CommonJS);
    const execute = compile(`const __name = (value) => value; (${browserCases.toString()})(${JSON.stringify(source)},
        ${JSON.stringify(context)}, ${JSON.stringify(closest)}, ${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))})`);
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-widget-focus-"));
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(execute)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`);
    try {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron") as unknown as string, [script, "--no-sandbox"],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /widget-focus-ok/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
