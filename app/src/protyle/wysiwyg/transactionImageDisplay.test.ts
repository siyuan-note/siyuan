import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (transactionSource: string, displaySource: string, luteSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    new Function(luteSource)();
    const lute = Lute.New();
    const config = {editor: {displayImgName: true, displayImgAlt: true}, fileTree: {openFilesUseCurrentTab: false}};
    Object.assign(window, {siyuan: {config, languages: {rename: "Rename"}}});
    const getAssetExtension = (value: string) => require("node:path").posix.extname(value);
    const displayDependencies = {
        getAssetExtension,
        getAssetName: (value: string) => require("node:path").posix.basename(value, getAssetExtension(value))
            .replace(/-\d{14}-\w{7}$/, ""),
        isEncryptedBox: () => false,
        renameAsset: () => {},
    };
    const renderImageDisplay = new Function(...Object.keys(displayDependencies), displaySource +
        "\nreturn renderImageDisplay;")(...Object.values(displayDependencies));
    let queued = 0;
    const identity = (html: string) => html;
    const dependencies = {
        renderImageDisplay,
        Constants: {ATTRIBUTE_EDITING: "data-editing"},
        prepareViewFoldTransaction: (_protyle: unknown, doOperations: unknown, undoOperations: unknown) =>
            ({doOperations, undoOperations}),
        getProtyleTransactionOwner: (): undefined => undefined,
        cleanBlockSelectionModeHTML: identity,
        cleanTableCellRichHTML: identity,
        cleanTableVirtualizationHTML: identity,
        cleanListMindmapHTML: identity,
        restoreInlineElementBoundaryHTML: identity,
        retainTableCellRichMetadata: identity,
        normalizeHTMLAssetIFrameBlockDOM: identity,
        cleanHeadingNumberOperations: () => {},
        getEmbedChildOperationContext: (): undefined => undefined,
        isInEmbedBlock: (): undefined => undefined,
        syncTrackedRanges: () => {},
        queueTransaction: () => queued++,
        queueTransactionBatch: () => queued++,
        processRender: () => { throw new Error("Local image edits must preserve the current DOM"); },
    };
    const exports = {} as typeof import("./transaction");
    new Function("exports", "require", transactionSource)(exports, () => dependencies);
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    document.body.append(root);
    const protyle = {wysiwyg: {element: root}, options: {}, undo: {add: () => {}}, lite: false} as unknown as IProtyle;
    const imageMarkdown = "![description](assets/example-20260930090000-abcdefg.png \"caption\")";

    // 新段落、列表和表格中的图片均在事务发送前显示，保存内容及光标保持不变。
    for (const markdown of [imageMarkdown, "- " + imageMarkdown,
        "| Image |\n| --- |\n| " + imageMarkdown + " |", imageMarkdown + "\n\n" + imageMarkdown]) {
        root.innerHTML = lute.Md2BlockDOM("anchor\n\n" + markdown);
        const anchor = root.firstElementChild;
        const inserted = Array.from(root.children).slice(1);
        const range = document.createRange();
        range.selectNodeContents(inserted[inserted.length - 1].querySelector("[contenteditable=\"true\"]"));
        range.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        const before = {node: range.startContainer, offset: range.startOffset};
        const original = lute.BlockDOM2StdMd(root.innerHTML);
        const operations = inserted.map(element => ({
            action: "insert" as const, id: element.getAttribute("data-node-id"),
            previousID: anchor.getAttribute("data-node-id"), data: element.outerHTML,
        }));
        const savedData = operations.map(operation => operation.data);
        const previousQueued = queued;
        exports.transaction(protyle, operations);
        check.equal(queued, previousQueued + 1);
        check.equal(root.querySelectorAll(".img__name").length, root.querySelectorAll(".img img").length);
        root.querySelectorAll(".img__name").forEach(name => check.equal(name.textContent, "example.png"));
        root.querySelectorAll(".img__alt").forEach(alt => check.equal(alt.textContent, "description"));
        check.equal(root.querySelectorAll(".img__alt").length, root.querySelectorAll(".img img").length);
        check.equal(lute.BlockDOM2StdMd(root.innerHTML), original);
        check.deepEqual(operations.map(operation => operation.data), savedData);
        check.equal(getSelection().anchorNode, before.node);
        check.equal(getSelection().anchorOffset, before.offset);
    }

    // 行内插入和后续修改提示文本走当前编辑块的更新分支，无需重新打开文档。
    root.innerHTML = lute.Md2BlockDOM("before " + imageMarkdown + " after");
    const block = root.firstElementChild;
    const editable = block.querySelector("[contenteditable=\"true\"]");
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const update = () => {
        block.setAttribute("data-editing", "true");
        exports.transaction(protyle, [{action: "update", id: block.getAttribute("data-node-id"), data: block.outerHTML}]);
        check.equal(root.firstElementChild, block);
        check.equal(getSelection().anchorNode, editable);
    };
    update();
    check.equal(block.querySelector(".img__name").textContent, "example.png");
    check.equal(block.querySelector(".img__alt").textContent, "description");
    block.querySelector("img").alt = "updated description";
    update();
    check.equal(block.querySelector(".img__alt").textContent, "updated description");
    config.editor.displayImgName = false;
    config.editor.displayImgAlt = false;
    update();
    check.equal(block.querySelector(".img__name"), null);
    check.equal(block.querySelector(".img__alt"), null);
    return "Image transaction cases passed";
};

test("local image insertions and updates display names and descriptions before submission", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const transactionSource = transpileModule(readFileSync(path.join(__dirname, "transaction.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const displaySource = transpileModule(readFileSync(path.join(__dirname, "../render/imageDisplay.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const luteSource = readFileSync("stage/protyle/js/lute/lute.min.js", "utf8");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-image-transaction-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "(() => { try { const __name = value => value; return (" + browserCases.toString() + ")(" +
        JSON.stringify(transactionSource) + "," + JSON.stringify(displaySource) + "," + JSON.stringify(luteSource) +
        "); } catch (error) { return error.stack; } })()";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Image transaction cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-image-transaction-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
