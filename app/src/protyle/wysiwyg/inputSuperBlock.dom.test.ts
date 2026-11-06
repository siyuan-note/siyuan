import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isImportDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check = require("node:assert/strict");
    const noop = (): undefined => undefined;
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.contentEditable = "true";
    document.body.append(root);
    const batches: {doOperations: IOperation[], undoOperations: IOperation[]}[] = [];
    window.siyuan = {config: {editor: {markdown: {}}}, storage: {}} as any;
    const dependencies = {
        Constants: {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing"},
        dayjs: () => ({format: () => "20261105000000"}),
        transaction: (_protyle: unknown, doOperations: IOperation[], undoOperations: IOperation[]) => {
            batches.push({doOperations, undoOperations});
        },
        mathRender: noop, highlightRender: noop, hideElements: noop, blockRender: noop,
        turnIntoTaskList: () => false, headingTurnIntoList: () => false,
        getBlockquoteContext: noop, isProtyleListItemFirstParagraph: () => false,
        normalizeSemanticInlineElements: noop,
        normalizeInlineFontFamilyStyle: (value: string) => value,
        restoreInlineElementBoundaryHTML: (value: string) => value,
        getSemanticMarkerPrefixLengthForNode: () => 0,
        isMobile: () => false, revealTabsForTarget: noop,
        suspendLongTextRuns: () => noop,
    };
    const {input} = new Function(...Object.keys(dependencies), source + "; return {input};")(...Object.values(dependencies));
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetSpin(true);
    lute.SetTextMark(true);
    lute.SetSuperBlock(true);
    lute.SetParagraphBeginningSpace(true);
    lute.SetSetext(false);
    lute.SetIndentCodeBlock(false);
    const paragraph = (id: string, text: string, style = "") =>
        `<div data-node-id="${id}" data-type="NodeParagraph" class="p" style="${style}"><div contenteditable="true" spellcheck="false">${text}</div><div class="protyle-attr" contenteditable="false"></div></div>`;
    const children = (element: Element) => Array.from(element.children).filter(item => item.hasAttribute("data-node-id"));
    const shape = (element: Element): unknown => children(element).map((item: HTMLElement) => ({
        id: item.dataset.nodeId, type: item.dataset.type, layout: item.dataset.sbLayout,
        width: item.style.width, flex: item.style.flex,
        text: item.dataset.type === "NodeParagraph" ? item.firstElementChild.textContent : undefined,
        children: shape(item),
    }));
    // 用最小块操作回放校验顺序和锚点；不替代内核事务或完整撤销界面测试。
    const replay = (target: HTMLElement, operations: IOperation[]) => {
        const find = (id: string) => id === "document" ? target : target.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
        operations.forEach(operation => {
            const current = find(operation.id);
            if (operation.action === "delete") {
                check.ok(current, `delete target ${operation.id}`);
                current.remove();
            } else if (operation.action === "update") {
                check.ok(current, `update target ${operation.id}`);
                current.outerHTML = operation.data;
            } else if (operation.action === "setAttrs") {
                check.ok(current, `attribute target ${operation.id}`);
                Object.entries(JSON.parse(operation.data)).forEach(([key, value]) => current.setAttribute(key, String(value)));
            } else {
                check.ok(["insert", "move"].includes(operation.action), operation.action);
                let element = current;
                if (operation.action === "insert") {
                    const template = document.createElement("template");
                    template.innerHTML = operation.data;
                    element = template.content.firstElementChild as HTMLElement;
                }
                check.ok(element, `move target ${operation.id}`);
                if (operation.previousID) {
                    const previous = find(operation.previousID);
                    check.ok(previous, `previous anchor ${operation.previousID}`);
                    previous.after(element);
                } else if (operation.nextID) {
                    const next = find(operation.nextID);
                    check.ok(next, `next anchor ${operation.nextID}`);
                    next.before(element);
                } else {
                    const parent = find(operation.parentID);
                    check.ok(parent, `parent anchor ${operation.parentID}`);
                    parent.prepend(element);
                }
            }
        });
    };
    const cases = [
        {name: "soft break creates middle blank line", before: "alpha\nbeta", after: "alpha\n\nbeta", offset: 7, inputType: "insertLineBreak", count: 2},
        {name: "delete middle text leaves blank line", before: "alpha\nx\nbeta", after: "alpha\n\nbeta", offset: 6, inputType: "deleteContentForward", count: 2},
        {name: "backspace middle text leaves blank line", before: "alpha\nx\nbeta", after: "alpha\n\nbeta", offset: 6, inputType: "deleteContentBackward", count: 2},
        {name: "ordered marker interrupts paragraph", before: "alpha\n1.\nbeta", after: "alpha\n1. \nbeta", offset: 9, inputType: "insertText", count: 2},
        {name: "three generated paragraphs", before: "alpha\nx\nbeta\n\ngamma", after: "alpha\n\nbeta\n\ngamma", offset: 6, inputType: "deleteContentBackward", count: 3},
        {name: "single soft newline", before: "alphabeta", after: "alpha\nbeta", offset: 6, inputType: "insertLineBreak", count: 1},
        {name: "single list conversion", before: "1.", after: "1. ", offset: 3, inputType: "insertText", count: 1},
    ];
    const failures: string[] = [];
    for (const fixture of [
        {layout: "col", firstColumn: false, unstyled: false},
        {layout: "row", firstColumn: false, unstyled: false},
        {layout: "document", firstColumn: false, unstyled: false},
        {layout: "col", firstColumn: true, unstyled: false},
        {layout: "col", firstColumn: false, unstyled: true},
    ]) {
        const {layout, firstColumn, unstyled} = fixture;
        for (const scenario of firstColumn ? cases.filter(item => item.count === 3) : unstyled ? cases.slice(0, 1) : cases) {
            try {
                const left = firstColumn ? "" : paragraph("20261105000000-left000", "left", "width: 20%; flex: 0 0 auto;");
                const original = paragraph("20261105000000-target0", scenario.before, unstyled ? "" : "width: 60%; flex: 0 0 auto;");
                const right = paragraph("20261105000000-right00", "right", "width: 20%; flex: 0 0 auto;");
                root.innerHTML = layout === "document" ? left + original + right :
                    `<div data-node-id="20261105000000-parent0" data-type="NodeSuperBlock" class="sb" data-sb-layout="${layout}">${left + original + right}<div class="protyle-attr" contenteditable="false"></div></div>`;
                const originalHTML = root.innerHTML;
                const originalShape = shape(root);
                const parent = layout === "document" ? root : root.firstElementChild;
                const columnIndex = firstColumn ? 0 : 1;
                const block = children(parent)[columnIndex] as HTMLElement;
                const beforeLeft = firstColumn ? undefined : children(parent)[0].outerHTML;
                const beforeRight = children(parent)[columnIndex + 1].outerHTML;
                const id = block.dataset.nodeId;
                const protyle = {lute, wysiwyg: {element: root, lastHTMLs: {[id]: block.outerHTML}},
                    hint: {render: noop}, toolbar: {showRender: noop}, block: {parentID: "document"},
                    options: {typewriterMode: false}, contentElement: root, scroll: {}};
                block.firstElementChild.textContent = scenario.after;
                const expected = block.cloneNode(true) as HTMLElement;
                const expectedRange = document.createRange();
                expectedRange.setStart(expected.firstElementChild.firstChild, scenario.offset);
                expectedRange.collapse(true);
                expectedRange.insertNode(document.createElement("wbr"));
                const expectedDOM = document.createElement("div");
                expectedDOM.innerHTML = lute.SpinBlockDOM(expected.outerHTML);
                const expectedMarker = expectedDOM.querySelector("wbr");
                const expectedEditable = expectedMarker.closest('[contenteditable="true"]');
                expectedRange.selectNodeContents(expectedEditable);
                expectedRange.setEndBefore(expectedMarker);
                const expectedCaretPrefix = expectedRange.toString();
                const range = document.createRange();
                range.setStart(block.firstElementChild.firstChild, scenario.offset);
                range.collapse(true);
                getSelection().removeAllRanges();
                getSelection().addRange(range);
                batches.length = 0;
                const undoContext = {focusID: id};
                await input(protyle, block, range, true, new InputEvent("input", {inputType: scenario.inputType}), {
                    doOperations: [], undoOperations: [], undoContext,
                });
                const wraps = layout === "col" && scenario.count > 1;
                const siblings = children(parent);
                check.equal(siblings.length, (wraps ? 1 : scenario.count) + columnIndex + 1, scenario.name + " sibling count");
                if (!firstColumn) {
                    check.equal(siblings[0].outerHTML, beforeLeft, "left neighbor unchanged");
                }
                check.equal(siblings[siblings.length - 1].outerHTML, beforeRight, "right neighbor unchanged");
                if (wraps) {
                    const wrapper = siblings[columnIndex] as HTMLElement;
                    check.equal(wrapper.dataset.type, "NodeSuperBlock");
                    check.equal(wrapper.dataset.sbLayout, "row");
                    check.equal(children(wrapper).length, scenario.count);
                    check.equal(wrapper.style.width, unstyled ? "" : "60%");
                    check.equal(wrapper.style.flex, unstyled ? "" : "0 0 auto");
                    children(wrapper).forEach((child: HTMLElement) => {
                        check.equal(child.style.width, "", "width belongs to column wrapper");
                        check.equal(child.style.flex, "", "flex belongs to column wrapper");
                    });
                    const snapshot = document.createElement("template");
                    snapshot.innerHTML = protyle.wysiwyg.lastHTMLs[id];
                    check.equal((snapshot.content.firstElementChild as HTMLElement).style.width, "", "cached width is cleared");
                    check.ok(wrapper.contains(getSelection().anchorNode), "caret remains in original column");
                } else {
                    check.equal(parent.querySelector(':scope > [data-sb-layout="row"]'), null, "no extra wrapper");
                }
                check.equal(root.querySelector("wbr"), null, "caret marker is consumed");
                check.ok(root.contains(getSelection().anchorNode), "caret remains in editor");
                const caret = getSelection().getRangeAt(0).cloneRange();
                const caretElement = caret.startContainer.nodeType === Node.TEXT_NODE ?
                    caret.startContainer.parentElement : caret.startContainer as HTMLElement;
                const caretEditable = caretElement.closest('[contenteditable="true"]');
                check.equal(caretEditable.textContent, expectedEditable.textContent, "caret follows the converted content");
                caret.setStart(caretEditable, 0);
                check.equal(caret.toString(), expectedCaretPrefix, "caret offset follows the Lute marker");
                check.equal(batches.length, 1, "conversion and wrapping share one transaction");
                check.deepEqual(batches[0].undoOperations.find(operation => operation.action === "update" && operation.id === id).context,
                    undoContext, "native input undo context survives wrapping");
                const persisted = document.createElement("div");
                persisted.innerHTML = originalHTML;
                replay(persisted, batches[0].doOperations);
                check.deepEqual(shape(persisted), shape(root), "redo operations persist the rendered structure");
                replay(persisted, batches[0].undoOperations);
                check.deepEqual(shape(persisted), originalShape, "undo restores original column and content");
                replay(persisted, batches[0].doOperations);
                check.deepEqual(shape(persisted), shape(root), "redo restores wrapped structure");
            } catch (error) {
                failures.push(`${layout}${firstColumn ? " first column" : ""}${unstyled ? " without width" : ""}: ${scenario.name}: ${error.stack}`);
            }
        }
    }
    check.deepEqual(failures, []);
    return "Input superblock cases passed (23 scenarios)";
};

test("input preserves a horizontal column when Lute emits multiple blocks", {timeout: 45000}, async () => {
    const extract = (file: string, names?: string[]) => {
        const source = createSourceFile(file, readFileSync(path.join(__dirname, file + ".ts"), "utf8"), ScriptTarget.Latest, true);
        if (names) {
            return names.map(name => {
                const declaration = source.statements.filter(isVariableStatement).flatMap(statement =>
                    Array.from(statement.declarationList.declarations)).find(item => item.name.getText(source) === name);
                assert.ok(declaration, `${file}: ${name}`);
                return `const ${name} = ${declaration.initializer.getText(source)};`;
            }).join("\n");
        }
        return source.statements.filter(statement => !isImportDeclaration(statement))
            .map(statement => statement.getText(source).replace(/^export /, "")).join("\n");
    };
    const source = transpileModule([
        extract("../util/hasClosest"), extract("getBlock"),
        extract("../../block/util", ["genSBElement", "refreshSbResize"]),
        extract("transaction", ["refreshSbs", "turnsIntoOneTransaction"]),
        extract("../util/selectionOffsets", ["focusByRange"]),
        extract("../util/selection", ["focusByWbr"]), extract("input"),
    ].join("\n"), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-input-superblock-test-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    const expression = `const __name = value => value; require(${JSON.stringify(lutePath)}); (${browserCases.toString()})(${JSON.stringify(source)})`;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(expression)}));
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    }
});`, "utf8");
    const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: path.join(temporary, "cache"), XDG_RUNTIME_DIR: temporary};
    delete env.ELECTRON_RUN_AS_NODE;
    const args = process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY ?
        ["--ozone-platform=headless", "--no-sandbox", script] : [script];
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, args,
            {env, timeout: 40000, windowsHide: true, maxBuffer: 1024 * 1024});
        assert.match(result.stdout, /Input superblock cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-input-superblock-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
