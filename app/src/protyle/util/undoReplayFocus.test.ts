import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import test from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const compile = (source: string) => transpileModule(source
    .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const extract = (file: string, names: string[]) => {
    const source = createSourceFile(file, readFileSync(path.join(__dirname, file), "utf8"), ScriptTarget.Latest, true);
    const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
    assert.equal(declarations.length, names.length);
    return compile(declarations.map(statement => statement.getText(source)).join("\n"));
};

const moduleSource = (file: string, names: string[]) => `const {${names.join(",")}} = (() => {
${compile(readFileSync(path.join(__dirname, file), "utf8"))}
return {${names.join(",")}};
})();`;

const browserCases = async (source: string) => {
    const check = require("node:assert/strict");
    const noop = (): void => undefined;
    const openedCells: {cell: HTMLTableCellElement, saved: unknown}[] = [];
    const highlightedCarets: Element[] = [];
    const transactions: {before: string, after: string, undoContext: Record<string, string>,
        context: Record<string, string>}[] = [];
    const dependencies = {
        Constants: {ZWSP: "\u200b"},
        revealTabsForTarget: (): void => undefined,
        captureBlockSelectionModeState: noop,
        disposeCustomBlocksInElement: noop,
        getVisibleFoldHeadingHTML: (html: string) => html,
        restoreBlockSelectionModeState: noop,
        focusRestoredBlockSelectionMode: noop,
        processRender: noop,
        avRender: noop,
        blockRender: noop,
        highlightRender: (element: Element) => {
            if (element.getAttribute("data-type") === "NodeCodeBlock" && element.querySelector("wbr")) {
                highlightedCarets.push(element);
                api.focusByWbr(element, document.createRange());
            }
        },
        loadRichCellEditor: async () => ({openTableCellRichEditor: (_owner: unknown, cell: HTMLTableCellElement,
            _navigation: unknown, _point: unknown, saved: unknown) => openedCells.push({cell, saved})}),
        updateTransaction: (_protyle: unknown, node: Element, before: string, undoContext: Record<string, string>,
                            operations?: {context: Record<string, string>}) => {
            if (node.outerHTML === before && !operations) {
                return;
            }
            transactions.push({before, after: node.outerHTML, undoContext, context: operations?.context});
        },
    };
    const api = new Function(...Object.keys(dependencies), source.replace('import("../render/tableCellRichEditor")',
        "loadRichCellEditor()") +
        "return {TableCutControl, getUndoFocusContext, restoreUndoFocus, focusByRange, focusByWbr, updateBlock};")(...Object.values(dependencies));
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    editor.contentEditable = "true";
    document.body.append(editor);
    const protyle = {wysiwyg: {element: editor}, element: editor, contentElement: editor,
        scroll: {lastScrollTop: 0}, toolbar: {}};
    const focus = (element: Element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        api.focusByRange(range);
        return range;
    };
    const assertCaret = (cell: Element, offset: number) => {
        const selection = getSelection();
        check.ok(cell.contains(selection.focusNode), "caret must return to the operation's recorded location");
        const prefix = document.createRange();
        prefix.selectNodeContents(cell);
        prefix.setEnd(selection.focusNode, selection.focusOffset);
        check.equal(prefix.toString().length, offset);
        check.equal(selection.isCollapsed, true);
    };
    for (const activeHTML of ["two", "", "<strong>two</strong>"]) {
        editor.innerHTML = '<div data-node-id="table" data-type="NodeTable" class="table">' +
            '<div contenteditable="true"><table><thead><tr><th>head</th><th></th></tr></thead>' +
            "<tbody><tr><td>one</td><td>" + activeHTML + "</td></tr></tbody></table></div></div>" +
            '<div data-node-id="other" data-type="NodeParagraph"><div contenteditable="true">destination</div></div>';
        const node = editor.firstElementChild;
        const cells = Array.from(node.querySelectorAll("td"));
        const control = new api.TableCutControl();
        Object.assign(control, {
            protyle, wysiwygElement: editor, element: document.createElement("div"),
            abortController: new AbortController(), selectedCells: cells,
            selection: {node, mode: "cell", activeCell: cells[1]},
            scheduleRender: () => undefined, isRectangle: () => true,
            writeClipboard: () => true,
        });
        control.bindEvents();
        getSelection().removeAllRanges();
        const oldCount = transactions.length;
        const cut = new ClipboardEvent("cut", {bubbles: true, cancelable: true});
        editor.dispatchEvent(cut);
        check.equal(cut.defaultPrevented, true);
        check.equal(transactions.length, oldCount + 1);
        check.deepEqual(cells.map(cell => cell.textContent), ["", ""]);
        editor.dispatchEvent(new ClipboardEvent("cut", {bubbles: true, cancelable: true}));
        check.equal(transactions.length, oldCount + 1, "clearing empty cells must not add undo entries");
        control.abortController.abort();

        // 模拟粘贴及其撤销后，光标留在目标段落，再回放源表格的剪切事务。
        const pasted = node.cloneNode(true) as Element;
        pasted.setAttribute("data-node-id", "pasted");
        editor.append(pasted);
        focus(pasted.querySelector("td"));
        pasted.remove();
        focus(editor.querySelector('[data-node-id="other"] > div'));
        const operation = transactions[transactions.length - 1];
        node.outerHTML = operation.before;
        check.equal(api.restoreUndoFocus(protyle, [{context: operation.undoContext}]), true);
        assertCaret(editor.querySelectorAll("td")[1], activeHTML ? 3 : 0);

        // 重做清空后仍应定位到同一个空单元格，而非相邻单元格的末尾。
        focus(editor.querySelector('[data-node-id="other"] > div'));
        editor.firstElementChild.outerHTML = operation.after;
        check.equal(api.restoreUndoFocus(protyle, [{context: operation.context}]), true);
        assertCaret(editor.querySelectorAll("td")[1], 0);
    }
    editor.innerHTML = '<div data-node-id="paragraph" data-type="NodeParagraph"><div contenteditable="true">text</div></div>';
    const context = api.getUndoFocusContext(editor, focus(editor.firstElementChild.firstElementChild), true);
    check.equal(context.undoFocusTableCell, undefined);
    check.equal(api.restoreUndoFocus(protyle, [{context}]), true);
    assertCaret(editor.firstElementChild.firstElementChild, 4);

    editor.innerHTML = '<div data-node-id="rich" data-type="NodeTable" class="table">' +
        '<div contenteditable="true"><table><tbody><tr><td>before</td><td contenteditable="false">' +
        '<div data-type="NodeParagraph"><div contenteditable="false">first</div></div>' +
        '<div data-type="NodeParagraph"><div contenteditable="false">second</div></div>' +
        "</td></tr></tbody></table></div></div>";
    const richCell = editor.querySelectorAll("td")[1];
    const richContext = api.getUndoFocusContext(editor, focus(richCell), true);
    getSelection().removeAllRanges();
    check.equal(api.restoreUndoFocus(protyle, [{context: richContext}]), true);
    await Promise.resolve();
    check.equal(openedCells[0].cell, richCell, "rich cells must reopen the cell editor");
    check.equal(openedCells[0].saved, undefined);
    assertCaret(richCell, 11);
    const saved = {startIndex: 1, endIndex: 1, start: 2, end: 4, backward: true};
    check.equal(api.restoreUndoFocus(protyle, [{context: {...richContext,
        undoFocusTableSelection: JSON.stringify(saved)}}]), true);
    await Promise.resolve();
    check.deepEqual(openedCells[1].saved, saved, "existing rich text selections must be preserved");
    check.equal(api.restoreUndoFocus(protyle, [{context: {...richContext,
        undoFocusTableSelection: "null"}}]), false);

    const paragraph = (id: string, html: string) => `<div data-node-id="${id}" data-type="NodeParagraph">` +
        `<div contenteditable="true">${html}</div></div>`;
    const replay = (id: string, html: string, isUndo = true) => {
        api.updateBlock(Array.from(editor.querySelectorAll(`[data-node-id="${id}"]`)), protyle,
            {action: "update", id, data: html}, isUndo);
        check.equal(editor.querySelectorAll("wbr").length, 0);
    };
    editor.innerHTML = paragraph("a", "first12") + paragraph("b", "second34") + paragraph("c", "destination");
    focus(editor.lastElementChild.firstElementChild);
    for (const [id, html, offset] of [
        ["b", "second3<wbr>", 7], ["b", "second<wbr>", 6],
        ["a", "first1<wbr>", 6], ["a", "first<wbr>", 5],
        ["a", "first12<wbr>", 7], ["b", "second34<wbr>", 8],
    ] as const) {
        replay(id, paragraph(id, html));
        assertCaret(editor.querySelector(`[data-node-id="${id}"] > div`), offset);
    }
    getSelection().removeAllRanges();
    replay("a", paragraph("a", "fi<wbr>rst"));
    assertCaret(editor.firstElementChild.firstElementChild, 2);
    focus(editor.lastElementChild.firstElementChild);
    replay("a", paragraph("a", "sync<wbr>update"), false);
    assertCaret(editor.lastElementChild.firstElementChild, 11);
    replay("a", paragraph("a", "no caret"));
    assertCaret(editor.lastElementChild.firstElementChild, 11);

    // 嵌入副本按当前选区定位，光标在其他块时优先恢复源块，且只聚焦一次。
    editor.innerHTML = '<div data-node-id="embed" data-type="NodeBlockQueryEmbed">' + paragraph("a", "copy") +
        "</div>" + paragraph("a", "source") + paragraph("c", "destination");
    focus(editor.lastElementChild.firstElementChild);
    replay("a", paragraph("a", "ab<wbr>cd"));
    assertCaret(editor.children[1].firstElementChild, 2);
    focus(editor.firstElementChild.firstElementChild.firstElementChild);
    replay("a", paragraph("a", "abc<wbr>d"));
    assertCaret(editor.firstElementChild.firstElementChild.firstElementChild, 3);

    // 代码块重建高亮前必须保留目标副本的标记，其他副本不能抢走光标。
    const code = (html: string) => '<div data-node-id="code" data-type="NodeCodeBlock" class="code-block">' +
        '<div class="hljs"><div contenteditable="true">' + html + "</div></div></div>";
    editor.innerHTML = '<div data-node-id="embed" data-type="NodeBlockQueryEmbed">' + code("copy") +
        "</div>" + code("source") + paragraph("c", "destination");
    focus(editor.lastElementChild.firstElementChild);
    replay("code", code("ab<wbr>cd"));
    check.equal(highlightedCarets.length, 1);
    check.equal(highlightedCarets[0], editor.children[1]);
    assertCaret(editor.children[1].querySelector("[contenteditable]"), 2);
    editor.remove();
    return "Undo replay focus cases passed";
};

test("undo replay restores recorded carets across paragraphs, table cells and embedded copies", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const tableSource = createSourceFile("tableControl.ts", readFileSync(path.join(__dirname,
        "tableControl.ts"), "utf8"), ScriptTarget.Latest, true);
    const tableClass = tableSource.statements.find(isClassDeclaration);
    const methodNames = ["bindEvents", "deleteSelection", "clearCells", "canMutateSelection", "getSelectedCells"];
    const methods = tableClass.members.filter(member => methodNames.includes(member.name?.getText(tableSource)));
    assert.equal(methods.length, methodNames.length);
    const source = compile(`class TableCutControl {${methods.map(method => method.getText(tableSource)).join("\n")}}`) +
        extract("tableCellRich.ts", ["clearTableCellContent"]) +
        compile(readFileSync(path.join(__dirname, "hasClosest.ts"), "utf8")) +
        moduleSource("longTextWrap.ts", ["unwrapLongTextRuns"]) +
        moduleSource("inlineElementBoundary.ts", ["getInlineElementBoundaryOffset", "getTextWithLegacyInlineBoundary",
            "hasInlineElementBoundary", "normalizeInlineElementBoundary", "restoreInlineElementBoundary",
            "restoreInlineElementBoundaries", "restoreInlineElementBoundaryHTML", "SEMANTIC_INLINE_HTML_REGEXP"]) +
        moduleSource("inlineElementMarker.ts", ["stripSemanticMarkersFromRangeText", "getMarkerAwareTextLength",
            "getSemanticMarkerPrefixLengthForNode"]) +
        extract("tableCellRichValue.ts", ["TABLE_CELL_RICH_ATTRIBUTE"]) +
        extract("selectionFocus.ts", ["getUndoFocusElement"]) +
        extract("../wysiwyg/getBlock.ts", ["getContenteditableElement", "isEndOfBlock", "hasNextSibling",
            "isNotEditBlock", "isContainerBlock", "hasPreviousSibling"]) +
        extract("../wysiwyg/transaction.ts", ["updateBlock"]) +
        extract("../wysiwyg/transactionUpdate.ts", ["shouldDeferCodeBlockCaretRestore"]) +
        extract("selection.ts", ["getSelectionOffset", "getUndoFocusContext", "restoreFocusContext", "restoreUndoFocus",
            "focusByOffset", "focusByRange", "focusByWbr", "searchNode", "getDOMOffset", "setLastNodeRange"]);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-table-cut-undo-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (async () => {try {return await (${browserCases.toString()})(${JSON.stringify(source)});}
catch (error) {return error.stack;}})()`)}));
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
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Undo replay focus cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        rmSync(temporary, {recursive: true, force: true});
    }
});
