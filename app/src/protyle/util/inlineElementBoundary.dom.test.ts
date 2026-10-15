import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, entrySource: string, selectionSource: string,
                            siblingSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const modules: Record<string, {exports: any}> = {};
    const load = (name: string) => {
        if (modules[name]) {
            return modules[name].exports;
        }
        const module = {exports: {}};
        modules[name] = module;
        new Function("require", "module", "exports", sources[name])((dependency: string) => {
            const parts = name.split("/");
            parts.pop();
            dependency.split("/").forEach(part => {
                if (part === "..") {
                    parts.pop();
                } else if (part !== ".") {
                    parts.push(part);
                }
            });
            return load(parts.join("/"));
        }, module, module.exports);
        return module.exports;
    };
    const marker: typeof import("./inlineElementMarker") = load("util/inlineElementMarker");
    const boundary: typeof import("./inlineElementBoundary") = load("util/inlineElementBoundary");
    const Constants = {ZWSP: "\u200b", WORD_JOINER: "\u2060", ATTRIBUTE_EDITING: "data-editing"};
    const siblings = new Function(siblingSource + "return {hasPreviousSibling, hasNextSibling};")();
    const focusByRange = (range: Range) => {
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    };
    const selectionDeps = {Constants, ...marker, ...siblings, focusByRange,
        selectIsEditor: (element: Element, range: Range) => element.contains(range.startContainer)};
    const selection = new Function(...Object.keys(selectionDeps), selectionSource +
        "return {getSelectionOffset, focusByWbr};")(...Object.values(selectionDeps));
    const lute = boundary.protectLuteInlineElementBoundaries(Lute.New());
    lute.SetTextMark(true);
    lute.SetTag(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetSpin(true);
    const paragraph = (html: string) => `<div data-type="NodeParagraph" class="p" data-node-id="${Lute.NewNodeID()}">` +
        `<div contenteditable="true">${html}</div><div class="protyle-attr" contenteditable="false"></div></div>`;
    const dependencies = {
        Constants, ...marker, ...boundary, ...selection, ...siblings,
        BLOCK_SELECTION_CLASS: "protyle-wysiwyg--select", getBlockSelectionModeElement: (): undefined => undefined,
        hasClosestByClassName: (element: Element, name: string) => element.closest("." + name),
        hasClosestByAttribute: (node: Node, name: string, value: string) =>
            (node.nodeType === 1 ? node as Element : node.parentElement).closest(`[${name}~="${value}"]`),
        getEmbedChildOperationContext: (): undefined => undefined, isNotEditBlock: () => false,
        getContenteditableElement: (element: Element) => element.querySelector('[contenteditable="true"]'),
        canEnterCodeBlock: () => false, getParentBlock: (element: Element) => element.parentElement,
        getPreviousBlockSibling: (element: Element) => element.previousElementSibling,
        getUndoFocusContext: () => ({}), activateTrackedRangeInsertion() {},
        genEmptyElement: (_plain: boolean, withWbr: boolean) => {
            const element = document.createElement("div");
            element.innerHTML = paragraph(withWbr ? "<wbr>" : "");
            return element.firstElementChild;
        },
        genEmptyBlock: (_plain: boolean, withWbr: boolean) => paragraph(withWbr ? "<wbr>" : ""),
        isEmptyListItemBlock: () => false, shouldCreateListItemChildOnEnter: () => false,
        getFocusedParentOrderedList: async () => {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return document.createElement("div");
        },
        getFocusedOrderedListInsertOperations: (): {doOperations: IOperation[], undoOperations: IOperation[]} =>
            ({doOperations: [], undoOperations: []}),
        updateListOrder() {}, blockRender() {}, processRender() {}, updateTransaction() {},
        hasCodeBlockFence: () => false, transaction() {}, mathRender() {}, scrollCenter() {},
    };
    const {enter, softEnter} = new Function(...Object.keys(dependencies), entrySource +
        "return {enter, softEnter};")(...Object.values(dependencies));
    Object.assign(window, {siyuan: {config: {editor: {markdown: {}}}}});

    for (const type of ["code", "kbd", "tag"]) {
        for (const action of ["text", "enter", "soft-enter"]) {
            for (const location of ["text", "parent", "wbr", "selected"]) {
                if (action === "soft-enter" && location === "selected") {
                    continue;
                }
                const editor = document.createElement("div");
                editor.className = "protyle-wysiwyg";
                editor.contentEditable = "true";
                editor.innerHTML = paragraph(`<span data-type="${type}">one</span>`);
                document.body.append(editor);
                const block = editor.firstElementChild;
                const content = block.firstElementChild;
                marker.normalizeSemanticInlineElements(content);
                const inline = content.querySelector("span");
                const range = document.createRange();
                if (location === "selected") {
                    range.selectNode(inline);
                } else {
                    if (location === "wbr") {
                        inline.before(document.createElement("wbr"));
                    }
                    if (location === "text") {
                        range.setStart(content.firstChild, 1);
                    } else {
                        range.setStartBefore(inline);
                    }
                    range.collapse(true);
                }
                editor.focus();
                focusByRange(range);
                if (action === "text") {
                    editor.addEventListener("beforeinput", () =>
                        boundary.prepareInlineElementBoundaryMutation(getSelection().getRangeAt(0)));
                    editor.addEventListener("input", () => marker.normalizeSemanticInlineElements(editor));
                    await ipcRenderer.invoke("type-text", "x");
                    check.equal(marker.getTextWithoutSemanticMarkers(content).replace(/\u200b/g, ""),
                        location === "selected" ? "x" : "xone", `${type}/${action}/${location}`);
                } else if (action === "enter") {
                    await enter(block, range, {wysiwyg: {element: editor}, lute});
                    const firstContent = editor.querySelector('[contenteditable="true"]');
                    check.equal(firstContent.textContent, "", `${type}/${action}/${location}`);
                    check.equal(marker.getTextWithoutSemanticMarkers(editor).replace(/\u200b/g, ""),
                        location === "selected" ? "" : "one");
                    for (const [text, blockType] of [["- item", "NodeList"], ["> quote", "NodeBlockquote"]]) {
                        check.ok(lute.SpinBlockDOM(paragraph(firstContent.textContent + text)).includes(`data-type="${blockType}"`));
                    }
                } else {
                    check.equal(softEnter(range, block, {wysiwyg: {element: editor}, lute}), true);
                    check.equal(editor.children.length, 1);
                    check.equal(marker.getTextWithoutSemanticMarkers(content).replace(/\u200b/g, ""), "one");
                }
                editor.remove();
            }
        }
    }
    // 聚焦有序列表会异步读取父列表，等待期间恢复的显示边界仍需在分割前清理。
    for (const focused of [false, true]) {
        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        editor.contentEditable = "true";
        editor.innerHTML = lute.Md2BlockDOM("1. `one`");
        if (focused) {
            const item = editor.querySelector('[data-type="NodeListItem"]');
            editor.replaceChildren(item);
        }
        document.body.append(editor);
        marker.normalizeSemanticInlineElements(editor);
        const block = editor.querySelector('[data-type="NodeParagraph"]');
        const range = document.createRange();
        range.selectNode(block.querySelector("span"));
        focusByRange(range);
        await enter(block, range, {wysiwyg: {element: editor}, lute});
        const contents = editor.querySelectorAll('[contenteditable="true"]');
        check.equal(contents.length, 2);
        contents.forEach(content => check.equal(content.textContent, ""));
        editor.remove();
    }
    const authored = document.createElement("div");
    authored.textContent = "before\u2060after";
    const range = document.createRange();
    range.selectNodeContents(authored);
    boundary.prepareInlineElementBoundaryMutation(range);
    check.equal(authored.textContent, "before\u2060after");
    return "Inline boundary mutation cases passed";
};

test("input and line breaks preserve semantic inline boundary ownership", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (text: string) => transpileModule(text, {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    const read = (name: string) => readFileSync(path.join(__dirname, "..", name + ".ts"), "utf8");
    const extract = (file: string, names: string[]) => {
        const source = createSourceFile(file, read(file), ScriptTarget.Latest, true);
        return compile(names.map(name => {
            const declaration = source.statements.filter(isVariableStatement).flatMap(statement =>
                Array.from(statement.declarationList.declarations)).find(item => item.name.getText(source) === name);
            return `const ${name} = ${declaration.initializer.getText(source)};`;
        }).join("\n"));
    };
    const sources = Object.fromEntries(["wysiwyg/compositionInput", "util/longTextWrap", "util/inlineElementBoundary",
        "util/inlineElementMarker"].map(name => [name, compile(read(name))]));
    const args = [sources, extract("wysiwyg/enter", ["enter", "softEnter", "listEnter", "removeEmptyNode"]) +
        extract("wysiwyg/list", ["genListItemElement"]),
        (extract("util/selectionOffsets", ["getSelectionOffset"]) +
        extract("util/selection", ["focusByWbr"])),
        extract("wysiwyg/getBlock", ["hasPreviousSibling", "hasNextSibling"])];
    const source = `const __name = value => value; (${browserCases.toString()})(${args.map(value => JSON.stringify(value)).join(",")})`;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-inline-boundary-test-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    ipcMain.handle("type-text", async (_event, keyCode) => {
        win.webContents.sendInputEvent({type: "char", keyCode});
        await new Promise(resolve => setTimeout(resolve, 20));
    });
    try {
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(source)}));
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
        assert.match(result.stdout, /Inline boundary mutation cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-inline-boundary-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
