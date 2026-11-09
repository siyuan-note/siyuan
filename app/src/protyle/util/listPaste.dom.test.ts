import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
    .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const browserCases = (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    document.body.append(root);
    const lute = Lute.New();
    lute.SetTextMark(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    let captured: {doOperations: IOperation[]; undoOperations: IOperation[]};
    const dependencies = {
        Constants: {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing"},
        prepareInlineElementBoundaryMutation: () => {},
        getEditorRange: () => getSelection().getRangeAt(0),
        getBlockRanges: (): unknown[] => [],
        getTextWithoutSemanticMarkers: (element: Element) => element.textContent,
        getUndoFocusContext: () => ({focusId: "original-focus"}),
        getSelectionOffset: () => ({start: 0, end: 0}),
        transaction: (_protyle: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) => {
            captured = {doOperations, undoOperations};
        },
        isMobile: () => false,
        normalizeHTMLAssetIFrameSources: () => {},
        markFoldHeadingChildren: () => {},
        resetCodeBlockRenderState: () => {},
        renderIFrameResize: () => {},
        focusInsertedBlock: () => {},
        updateListOrder: () => {},
        dayjs: () => ({format: () => "20261109000000"}),
    };
    const api = new Function(...Object.keys(dependencies), source + "; return {insertHTML};")(...Object.values(dependencies));
    const protyle = {lute, wysiwyg: {element: root, lastHTMLs: {}}, toolbar: {range: undefined as Range, getCurrentType: (): string[] => []}};
    try {
        for (const marker of ["- ", "1. ", "- [ ] "]) {
            for (const child of ["", "child", "child\n    - grandchild"]) {
                for (const merge of [false, true]) {
                    const indent = marker === "1. " ? "   " : "  ";
                    const childMarkdown = (child || "child").replace("\n    - grandchild", "\n" + indent + "  - grandchild");
                    root.innerHTML = lute.Md2BlockDOM(marker + "parent\n" + indent + "- " + childMarkdown);
                    if (!child) root.querySelector(":scope > .list > .li > .list [contenteditable=\"true\"]").textContent = "";
                    const list = root.firstElementChild;
                    list.querySelector('[contenteditable="true"]').textContent = "";
                    const original = list.outerHTML;
                    const childList = list.querySelector(":scope > .li > .list");
                    check.ok(childList, JSON.stringify({marker, child, merge, original}));
                    if (child.includes("grandchild")) check.ok(childList.querySelector(".list"), "three-level fixture");
                    const childIDs = Array.from(childList.querySelectorAll("[data-node-id]"))
                        .map(element => element.getAttribute("data-node-id"));
                    const editable = list.querySelector('[contenteditable="true"]');
                    const range = document.createRange();
                    range.selectNodeContents(editable);
                    range.collapse(true);
                    getSelection().removeAllRanges();
                    getSelection().addRange(range);
                    api.insertHTML(lute.Md2BlockDOM(marker + "1\n" + marker + "2" + (merge ? "\n" + indent + "- pasted child" : "")), protyle, false, false, true);
                    check.equal(captured.doOperations.length, 1, JSON.stringify({marker, child, merge, original, captured}));
                    check.equal(captured.doOperations[0].action, "update");
                    check.equal(captured.doOperations[0].id, list.getAttribute("data-node-id"));
                    check.equal(captured.doOperations[0].data, list.outerHTML);
                    check.equal(captured.undoOperations.length, 1);
                    check.equal(captured.undoOperations[0].data, original);
                    check.equal(captured.undoOperations[0].context.focusId, "original-focus");
                    check.equal(list.querySelectorAll(":scope > .li").length, 2);
                    const ids = Array.from(list.querySelectorAll("[data-node-id]")).map(element => element.getAttribute("data-node-id"));
                    check.equal(new Set(ids).size, ids.length);
                    for (const id of childIDs) check.ok(ids.includes(id), "retained child identity");
                }
            }
        }
        for (const hasChildren of [false, true]) {
            root.innerHTML = lute.Md2BlockDOM("- parent" + (hasChildren ? "\n  - child" : ""));
            const list = root.firstElementChild;
            const editable = list.querySelector('[contenteditable="true"]');
            if (!hasChildren) editable.textContent = "";
            const range = document.createRange();
            range.selectNodeContents(editable);
            range.collapse(true);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            api.insertHTML(lute.Md2BlockDOM("- 1\n- 2"), protyle, false, false, true);
            check.ok(captured.doOperations.length > 1, "non-empty parents and childless items keep granular operations");
            check.ok(!captured.doOperations.some(operation => operation.action === "update" &&
                operation.id === list.getAttribute("data-node-id")));
        }
        return "list-paste-ok";
    } finally {
        root.remove();
    }
};

test("empty list parents preserve nested identities in one reversible list update", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && process.env.SIYUAN_TEST_HEADLESS !== "1",
    timeout: 45000,
}, async () => {
    const file = "src/protyle/util/insertHTML.ts";
    const ast = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
    const insert = ast.statements.find(node => isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "insertHTML"));
    assert.ok(insert);
    const source = ["src/protyle/util/hasClosest.ts", "src/protyle/wysiwyg/getBlock.ts"]
        .map(file => compile(readFileSync(file, "utf8"))).join("\n") + compile(insert.getText(ast));
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-list-paste-"));
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(
        path.resolve("stage/protyle/js/lute/lute.min.js"))}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; try { (${browserCases.toString()})(${JSON.stringify(source)}) } catch (error) { error.stack }`)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [...(process.env.SIYUAN_TEST_HEADLESS === "1" ? ["--ozone-platform=headless"] : []), script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /list-paste-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        assert.ok(path.basename(directory).startsWith("siyuan-list-paste-"));
        rmSync(directory, {recursive: true, force: true});
    }
});
