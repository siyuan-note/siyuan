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

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    document.body.append(root);
    const lute = Lute.New();
    lute.SetTabs(true);
    lute.SetCallout(true);
    lute.SetTextMark(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    lute.PutEmojis({custom: "/emojis/custom.png", vector: "/emojis/vector.svg"});
    let insertedRange: Range;
    let inputCount = 0;
    const dependencies = {
        Constants: {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing"},
        prepareInlineElementBoundaryMutation: () => {},
        getEditorRange: () => getSelection().getRangeAt(0),
        getBlockRanges: (): unknown[] => [],
        getTextWithoutSemanticMarkers: (element: Element) => element.textContent,
        input: (_protyle: IProtyle, _block: HTMLElement, range: Range) => {
            insertedRange = range.cloneRange();
            inputCount++;
        },
        getUploadInsertRange: (protyle: IProtyle) => protyle.toolbar.range,
        getAssetUploadSuccesses: (data: {succFiles: unknown[]}) => data.succFiles,
        pathPosix: () => ({extname: () => ".png"}),
        isBrowserRenderableImagePath: () => true,
        getHostCapabilities: () => ({localFileSystem: false}),
        setTimeout: () => 0,
    };
    Object.assign(dependencies.Constants, {SIYUAN_ASSETS_IMAGE: [".png"], SIYUAN_ASSETS_AUDIO: [], SIYUAN_ASSETS_VIDEO: []});
    const api = new Function(...Object.keys(dependencies), source + "; return {insertHTML, genUploadedLabel};")(
        ...Object.values(dependencies));
    const protyle = {lute, wysiwyg: {element: root, lastHTMLs: {} as Record<string, string>},
        options: {upload: {filename: (name: string) => name}},
        toolbar: {range: undefined as Range, getCurrentType: (): string[] => []}};
    try {
        for (const kind of ["tab", "callout", "paragraph"]) {
            for (const content of ["", "12", "AB", ":custom:", "12:custom:", "/emoji", "**AB**"]) {
                for (const payload of [":custom:", ":vector:", '<span data-type="strong">Bold</span>', "upload-image"]) {
                    for (const useProtyleRange of [false, true]) {
                        const markdown = kind === "tab" ? `::: tabs\n@tab ${content}\n\nBody\n\n:::\n` :
                            kind === "callout" ? `> [!NOTE] ${content}\n> Body` : content || "Placeholder";
                        root.innerHTML = lute.Md2BlockDOM(markdown);
                        const title = root.querySelector<HTMLElement>(kind === "paragraph" ?
                            '[contenteditable="true"]' : ".callout-title");
                        check.ok(title, `${kind}: ${content}`);
                        if (!content) title.innerHTML = "";
                        if (kind !== "paragraph") check.equal(title.tagName, "SPAN");
                        const body = root.querySelector(".tab-item-content, .callout-content")?.innerHTML;
                        const range = document.createRange();
                        if (content === "**AB**") {
                            range.setStart(title.querySelector('[data-type="strong"]').firstChild, 1);
                        } else if (content === "AB") {
                            range.setStart(title.firstChild, 1);
                        } else {
                            range.selectNodeContents(title);
                            range.collapse(false);
                        }
                        range.collapse(true);
                        if (content === "/emoji") range.selectNodeContents(title);
                        getSelection().removeAllRanges();
                        getSelection().addRange(range);
                        protyle.toolbar.range = range;
                        const originalHTML = root.innerHTML;
                        const priorInputCount = inputCount;
                        if (payload === "upload-image") {
                            await api.genUploadedLabel(JSON.stringify({code: 0, data: {succFiles: [
                                {name: "image.png", path: "assets/image.png", index: 0},
                            ]}}), protyle, useProtyleRange ? {insertPosition: {}} : undefined);
                        } else {
                            api.insertHTML(lute.SpinBlockDOM(payload), protyle, false, useProtyleRange);
                        }
                        check.equal(inputCount, priorInputCount + 1);
                        const selector = payload === "upload-image" ? 'img[src="assets/image.png"]' :
                            payload.includes("<span") ? '[data-type="strong"]' :
                            `img.emoji[src="/emojis/${payload === ":custom:" ? "custom.png" : "vector.svg"}"]`;
                        check.ok(title.querySelector(selector), `${kind}: inserted element remains inside title`);
                        if (kind !== "paragraph") {
                            check.equal(root.querySelectorAll(".callout-title").length, 1, "the title container is never split");
                            check.equal(title.parentElement.querySelectorAll(":scope > img, :scope > span[data-type]").length, 0);
                        }
                        check.ok(title.contains(insertedRange.startContainer), "the caret remains inside the editable title");
                        check.equal(root.querySelector(".tab-item-content, .callout-content")?.innerHTML, body);
                        const serialized = document.createElement("div");
                        serialized.innerHTML = lute.SpinBlockDOM(root.innerHTML);
                        const savedTitle = serialized.querySelector(kind === "paragraph" ?
                            '[contenteditable="true"]' : ".callout-title");
                        check.ok(savedTitle.querySelector(selector),
                            `${kind} ${content} ${payload}: serialization preserves the inserted element: ${serialized.innerHTML}`);
                        if (content === "AB" || content === "**AB**") {
                            check.equal(savedTitle.textContent, payload.includes("<span") ? "ABoldB" :
                                payload === "upload-image" ? "A  B" : "AB");
                        }
                        check.equal(savedTitle.textContent.includes("/emoji"), false, "the selected command is replaced");
                        const blockID = title.closest("[data-node-id]").getAttribute("data-node-id");
                        check.ok(protyle.wysiwyg.lastHTMLs[blockID], "the original block is captured for undo");
                        check.notEqual(root.innerHTML, originalHTML);
                    }
                }
            }
        }
        return "title-inline-insert-ok";
    } finally {
        root.remove();
    }
};

test("real Lute titles keep uploaded images, emoji and rich text inside their editable container", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const file = "src/protyle/util/insertHTML.ts";
    const ast = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
    const insert = ast.statements.find(node => isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "insertHTML"));
    assert.ok(insert);
    const uploadAst = createSourceFile("upload.ts", readFileSync("src/protyle/upload/index.ts", "utf8"), ScriptTarget.Latest, true);
    const upload = uploadAst.statements.find(node => isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(uploadAst) === "genUploadedLabel"));
    assert.ok(upload);
    const assetAst = createSourceFile("renderAssets.ts", readFileSync("src/asset/renderAssets.ts", "utf8"), ScriptTarget.Latest, true);
    const asset = assetAst.statements.find(node => isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(assetAst) === "genAssetHTML"));
    assert.ok(asset);
    const source = ["src/protyle/util/hasClosest.ts", "src/protyle/wysiwyg/getBlock.ts"]
        .map(file => compile(readFileSync(file, "utf8"))).join("\n") + compile(insert.getText(ast)) +
        compile(asset.getText(assetAst)) + compile(upload.getText(uploadAst));
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-title-inline-"));
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
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /title-inline-insert-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        assert.ok(path.basename(directory).startsWith("siyuan-title-inline-"));
        rmSync(directory, {recursive: true, force: true});
    }
});
