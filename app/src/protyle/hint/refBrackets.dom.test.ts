import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const browserCases = (source: string) => {
    const check = require("node:assert/strict");
    const root = document.createElement("div");
    root.innerHTML = '<div data-node-id="block" data-type="NodeParagraph"><div contenteditable="true"></div></div>';
    document.body.append(root);
    const editable = root.firstElementChild.firstElementChild;
    window.siyuan = {config: {editor: {autoCloseRefBrackets: true, hashTagSearch: true}}} as any;
    const transactions: {before: string; after: string}[] = [];
    const dependencies = {
        Constants: {BLOCK_HINT_KEYS: ["[[", "(("], BLOCK_HINT_CLOSE_KEYS: {"[[": "]]", "((": "))"}, SIZE_TITLE: 512},
        hasClosestByAttribute: (node: Node, attribute: string, value: string) =>
            (node.nodeType === 3 ? node.parentElement : node as Element).closest(`[${attribute}~="${value}"]`),
        hasClosestBlock: (node: Node) => node.parentElement.closest("[data-node-id]"),
        focusByRange: (range: Range) => { getSelection().removeAllRanges(); getSelection().addRange(range); },
        getSelectionOffset: (_node: Node, _root: Element, range: Range) => ({start: range.startOffset}),
        getWholeTextOffset: (_node: Node, offset: number) => offset,
        getUndoFocusContext: () => ({id: "block"}),
        hideElements: (): undefined => undefined,
        updateTransaction: (_protyle: unknown, block: Element, before: string) => transactions.push({before, after: block.outerHTML}),
    };
    const Hint = new Function(...Object.keys(dependencies), source + "; return Hint;")(...Object.values(dependencies));
    const hint = new Hint();
    const protyle = {notebookId: "box", block: {rootID: "root"}, wysiwyg: {element: root, preventKeyup: false},
        toolbar: {range: undefined as Range}};
    hint.element = document.createElement("div");
    hint.element.className = "fn__none";
    let renders = 0;
    hint.render = () => {
        renders++;
        const range = getSelection().getRangeAt(0);
        hint.getKey(range.startContainer.textContent.substring(0, range.startOffset),
            range.startContainer.textContent.substring(range.startOffset), [{key: "[["}]);
    };
    const reset = (text: string, offset: number, split = false) => {
        editable.replaceChildren(document.createTextNode(text));
        if (split) {
            editable.replaceChildren(document.createTextNode(text.slice(0, 1)), document.createTextNode(text.slice(1)));
        }
        const node = editable.lastChild as Text;
        const range = document.createRange();
        range.setStart(node, split ? offset - 1 : offset);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        hint.refBracketRange = undefined;
        hint.refBracketOrigin = undefined;
        hint.refCloseContext = undefined;
        hint.splitChar = "[[";
        hint.lastIndex = 0;
        hint.consumeCloseKey = true;
        return range;
    };
    const before = (inputType: string, data: string = null) =>
        hint.handleRefBracketBeforeInput(protyle, new InputEvent("beforeinput", {inputType, data}));

    let range = reset("[[ tail", 2, true);
    hint.autoCloseRefBrackets(protyle, range);
    check.equal(editable.textContent, "[[]] tail");
    check.equal(range.startOffset, 2);
    (range.startContainer as Text).insertData(2, "Title");
    range.setStart(range.startContainer, 7);
    range.collapse(true);
    check.equal(before("insertText", "]"), true);
    check.equal(renders, 0);
    check.equal(before("insertText", "]"), true);
    check.equal(renders, 1);
    check.equal(hint.closeKeyTyped, true);
    check.equal(editable.textContent, "[[Title]] tail");
    const context = hint.getRefCloseContext(protyle);
    check.ok(context);
    check.equal(context.text, "[[Title]]");
    range.setStart(range.startContainer, 3);
    range.collapse(true);
    check.equal(hint.isRefCloseContextCurrent(protyle, context), false);
    range.setStart(range.startContainer, 9);
    range.collapse(true);
    check.equal(hint.isRefCloseContextCurrent(protyle, context), true);
    (range.startContainer as Text).insertData(3, "changed");
    check.equal(hint.isRefCloseContextCurrent(protyle, context), false);

    range = reset("[[", 2);
    hint.autoCloseRefBrackets(protyle, range);
    editable.replaceChildren(document.createTextNode("[[Title]]"));
    range = document.createRange();
    range.setStart(editable.firstChild, 7);
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    check.equal(before("insertText", "]"), true);
    check.equal(before("insertText", "]"), true);
    check.ok(hint.getRefCloseContext(protyle));

    range = reset("[[", 2);
    hint.autoCloseRefBrackets(protyle, range);
    check.equal(before("deleteContentBackward"), true);
    check.equal(editable.textContent, "");
    check.equal(range.startOffset, 0);
    check.equal(transactions.length, 1);
    check.match(transactions[0].before, /\[\[\]\]/);
    check.equal(protyle.wysiwyg.preventKeyup, true);

    for (const offset of [7, 8]) {
        range = reset("[[", 2);
        hint.autoCloseRefBrackets(protyle, range);
        (range.startContainer as Text).insertData(2, "Title");
        range.setStart(range.startContainer, offset);
        range.setEnd(range.startContainer, offset);
        range.setStart(range.startContainer, 0);
        hint.consumeRefBracketClose(range);
        check.equal(range.toString(), "[[Title]]");
    }
    range = reset("[[Title]]", 7);
    check.equal(before("insertText", "]"), false);
    check.equal(hint.getRefCloseContext(protyle), undefined);
    for (const type of ["code", "NodeCodeBlock", "inline-math"]) {
        range = reset("[[", 2);
        editable.setAttribute("data-type", type);
        hint.autoCloseRefBrackets(protyle, range);
        check.equal(editable.textContent, "[[");
        editable.removeAttribute("data-type");
    }
    range = reset("[[", 2);
    window.siyuan.config.editor.autoCloseRefBrackets = false;
    hint.autoCloseRefBrackets(protyle, range);
    check.equal(editable.textContent, "[[");
    return "Reference bracket cases passed";
};

test("reference brackets preserve native ranges, close once, delete together and reject stale commits", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const file = createSourceFile("index.ts", readFileSync(path.join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest, true);
    const hint = file.statements.find(isClassDeclaration);
    const names = ["autoCloseRefBrackets", "handleRefBracketBeforeInput", "getRefBracketContext", "canResumeBlockHint",
        "getRefCloseContext", "isRefCloseContextCurrent", "consumeRefBracketClose", "getKey"];
    const methods = names.map(name => hint.members.find(member => member.name?.getText(file) === name).getText(file));
    const helpers = readFileSync(path.join(__dirname, "blockHintRange.ts"), "utf8").replaceAll("export ", "");
    const source = transpileModule(helpers + "\nclass Hint {" + methods.join("\n") + "}", {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-ref-bracket-test-"));
    const script = path.join(temporary, "run.cjs");
    const expression = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)})`;
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
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Reference bracket cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-ref-bracket-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
