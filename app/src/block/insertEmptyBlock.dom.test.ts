import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.contentEditable = "true";
    document.body.append(root);
    const style = document.createElement("style");
    style.textContent = '.li[fold="1"] > div:nth-child(3):not(.protyle-attr), ' +
        '.li[fold="1"] > div:nth-child(3) ~ div:not(.protyle-attr) {display: none}';
    document.head.append(style);
    window.siyuan = {config: {editor: {spellcheck: false}}} as typeof window.siyuan;
    let forward: IOperation[];
    let backward: IOperation[];
    const undoContext = {undoFocusId: "original"};
    const dependencies = {
        Constants: {ZWSP: "\u200b"}, Lute,
        getEditorRange: () => getSelection().getRangeAt(0),
        getUndoFocusContext: () => undoContext,
        hideElements: () => {}, scrollCenter: () => {}, isMobile: () => false,
        revealTabsForTarget: () => {},
        transaction: (_protyle: IProtyle, operations: IOperation[], undo: IOperation[]) => {
            forward = operations;
            backward = undo;
        },
        updateTransaction: (_protyle: IProtyle, element: Element, oldHTML: string, context: IOperation["context"]) => {
            const id = element.getAttribute("data-node-id");
            forward = [{action: "update", id, data: element.outerHTML}];
            backward = [{action: "update", id, data: oldHTML, context}];
        },
    };
    const api = new Function(...Object.keys(dependencies), source +
        "; return {insertEmptyBlock, genEmptyElement, genListItemElement};")(...Object.values(dependencies));
    const protyle = {wysiwyg: {element: root}};
    const lute = Lute.New();
    lute.SetTextMark(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    const makeList = (subtype: string) => {
        const list = document.createElement("div");
        list.className = "list";
        list.setAttribute("data-type", "NodeList");
        list.setAttribute("data-node-id", Lute.NewNodeID());
        list.setAttribute("data-subtype", subtype);
        const attr = document.createElement("div");
        attr.className = "protyle-attr";
        attr.contentEditable = "false";
        list.append(attr);
        return list;
    };
    try {
        for (const subtype of ["u", "o", "t"]) {
            for (const multiple of [false, true]) {
                for (const nested of [false, true]) {
                    for (const folded of [false, true]) {
                        for (const position of ["beforebegin", "afterend"]) {
                            for (const explicit of [false, true]) {
                                root.replaceChildren();
                                const list = makeList(subtype);
                                const seed = document.createElement("div");
                                seed.setAttribute("data-subtype", subtype);
                                seed.setAttribute("data-marker", "3.");
                                const item = api.genListItemElement(seed, 0, false) as HTMLElement;
                                const paragraph = item.querySelector<HTMLElement>('[data-type="NodeParagraph"]');
                                paragraph.firstElementChild.textContent = "Parent";
                                const hidden = api.genEmptyElement(false, false) as HTMLElement;
                                hidden.firstElementChild.textContent = "Hidden";
                                item.lastElementChild.before(hidden);
                                if (folded) item.setAttribute("fold", "1");
                                list.firstElementChild.before(item);
                                if (multiple) item.after(api.genListItemElement(item));
                                if (nested) {
                                    const outer = makeList("u");
                                    const parent = api.genListItemElement(outer) as HTMLElement;
                                    parent.lastElementChild.before(list);
                                    outer.firstElementChild.before(parent);
                                    root.append(outer);
                                } else {
                                    root.append(list);
                                }
                                const originalItemHTML = item.outerHTML;
                                const originalParagraphHTML = paragraph.outerHTML;
                                const originalHiddenHTML = hidden.outerHTML;
                                const originalListHTML = list.outerHTML;
                                const editable = paragraph.firstElementChild as HTMLElement;
                                root.focus();
                                const range = document.createRange();
                                range.selectNodeContents(editable);
                                range.collapse(false);
                                getSelection().removeAllRanges();
                                getSelection().addRange(range);
                                forward = [];
                                backward = [];
                                await api.insertEmptyBlock(protyle, position, explicit ? paragraph : undefined);
                                const anchor = folded && !explicit ? item : paragraph;
                                const inserted = position === "afterend" ? anchor.nextElementSibling : anchor.previousElementSibling;
                                check.ok(inserted, `${subtype} multiple=${multiple} nested=${nested} folded=${folded} ${position}`);
                                check.equal(inserted.getAttribute("data-type"), anchor === item ? "NodeListItem" : "NodeParagraph",
                                    `${subtype} multiple=${multiple} nested=${nested} folded=${folded} ${position} explicit=${explicit}`);
                                if (anchor === item) {
                                    check.equal(inserted.parentElement, list);
                                    check.equal(inserted.getAttribute("data-subtype"), subtype);
                                    check.notEqual(inserted.getAttribute("fold"), "1");
                                    if (subtype !== "o") check.equal(item.outerHTML, originalItemHTML);
                                    check.equal(paragraph.outerHTML, originalParagraphHTML);
                                    check.equal(hidden.outerHTML, originalHiddenHTML);
                                    check.equal(root.querySelectorAll('[data-type="NodeParagraph"]').length,
                                        (multiple ? 3 : 2) + (nested ? 1 : 0) + 1);
                                    const insertedEditable = inserted.querySelector<HTMLElement>('[contenteditable="true"]');
                                    check.ok(insertedEditable.contains(getSelection().anchorNode));
                                    check.ok(insertedEditable.getClientRects().length > 0);
                                    getSelection().getRangeAt(0).insertNode(document.createTextNode("typed"));
                                    check.equal(insertedEditable.textContent, "typed", root.innerHTML);
                                    const saved = document.createElement("div");
                                    saved.innerHTML = lute.SpinBlockDOM(list.outerHTML);
                                    check.equal(saved.querySelector(`[data-node-id="${item.getAttribute("data-node-id")}"]`)
                                        .getAttribute("fold"), "1");
                                    check.ok(saved.querySelector(`[data-node-id="${inserted.getAttribute("data-node-id")}"]`)
                                        .textContent.includes("typed"));
                                    if (subtype === "o") {
                                        check.deepEqual(Array.from(list.querySelectorAll(':scope > [data-type="NodeListItem"]'))
                                            .map(element => element.getAttribute("data-marker")),
                                        multiple ? ["4.", "5.", "6."] : ["4.", "5."]);
                                        check.equal(forward[0].action, "update");
                                        check.equal(backward[0].data, originalListHTML);
                                    } else {
                                        check.equal(forward.length, 1);
                                        check.equal(forward[0].action, "insert");
                                        check.equal(forward[0][position === "afterend" ? "previousID" : "nextID"],
                                            item.getAttribute("data-node-id"));
                                        check.equal(backward[0].action, "delete");
                                        check.equal(backward[0].id, inserted.getAttribute("data-node-id"));
                                    }
                                    check.equal(backward[0].context, undoContext);
                                } else {
                                    check.equal(inserted.parentElement, item);
                                    check.equal(forward[0][position === "afterend" ? "previousID" : "nextID"],
                                        paragraph.getAttribute("data-node-id"));
                                }
                            }
                        }
                    }
                }
            }
        }
        return "block-insertion-ok";
    } finally {
        root.remove();
        style.remove();
    }
};

test("folded list insertion creates visible siblings with stable focus and undo operations", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const extract = (file: string, names: string[]) => {
        const ast = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
        return names.map(name => {
            const declaration = ast.statements.filter(isVariableStatement).flatMap(statement =>
                Array.from(statement.declarationList.declarations)).find(item => item.name.getText(ast) === name);
            assert.ok(declaration, `${file}: ${name}`);
            return `const ${name} = ${declaration.initializer.getText(ast)};`;
        }).join("\n");
    };
    const source = transpileModule([
        extract("src/protyle/util/hasClosest.ts", ["hasClosestByAttribute", "hasClosestByClassName", "hasClosestBlock", "isBlockElement"]),
        extract("src/protyle/wysiwyg/getBlock.ts", ["getTopAloneElement", "getPreviousBlockSibling", "getSbChildBlockCount"]),
        extract("src/protyle/util/selection.ts", ["focusByWbr"]),
        extract("src/protyle/util/selectionOffsets.ts", ["focusByRange"]),
        extract("src/protyle/wysiwyg/listContext.ts", ["getOrderedListMarkerUpdates"]),
        extract("src/protyle/wysiwyg/list.ts", ["genListItemElement", "updateListOrder"]),
        extract("src/block/util.ts", ["insertEmptyBlock", "genEmptyBlock", "genEmptyElement"]),
    ].join("\n"), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-block-insertion-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
        offscreen: true, backgroundThrottling: false}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(
        path.resolve("stage/protyle/js/lute/lute.min.js"))}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)})`)}));
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
        assert.match(result.stdout, /block-insertion-ok/, result.stderr);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-block-insertion-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
