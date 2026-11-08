import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isIfStatement, isVariableStatement, Node, ScriptTarget, transpileModule} from "typescript";

const browserCases = (source: string, luteSource: string, selectionSource: string) => {
    const check = require("node:assert/strict");
    new Function(luteSource)();
    const lute = Lute.New();
    lute.SetTabs(true);
    lute.SetCallout(true);
    lute.SetTextMark(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    const root = document.createElement("div");
    document.body.append(root);
    const style = document.createElement("style");
    style.textContent = ".tab-item-info{font-size:24px}.tabs-title-editor{font-size:14px}";
    document.head.append(style);
    const saved: string[] = [];
    const focusByWbr = new Function("Constants", "revealTabsForTarget", "getSemanticMarkerPrefixLengthForNode",
        selectionSource + "\nreturn focusByWbr;")({ZWSP: "\u200b"}, () => {}, () => 0);
    const dependencies = {
        fixAdjacentTags: () => {}, normalizeSemanticInlineElements: () => {},
        removeEmptySemanticElementAtCaret: () => {}, normalizeInlineFontFamilyStyles: () => {},
        hideElements: () => {}, mathRender: () => {}, focusByWbr,
        updateGutterAfterInput: () => {}, updateInput: (html: string) => saved.push(html),
        Constants: {ATTRIBUTE_EDITING: "data-editing"},
        fetchPost: () => { throw new Error("nonempty references do not fetch text"); },
    };
    const run = new Function(...Object.keys(dependencies),
        `return (protyle, blockElement, editElement, range) => {
            const needRender = true, id = blockElement.dataset.nodeId, inputOperations = undefined;
            ${source}
        };`)(...Object.values(dependencies));
    try {
        for (const prefix of ["", "11"]) {
            for (const subtype of ["d", "s"]) {
                for (const forward of [false, true]) {
                    root.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab Title\n\nBody\n\n:::\n");
                    const title = root.querySelector<HTMLElement>(".tab-item-title");
                    const item = title.closest<HTMLElement>(".tab-item");
                    const info = item.querySelector<HTMLElement>(".tab-item-info");
                    const body = item.querySelector(".tab-item-content");
                    const bodyHTML = body.innerHTML;
                    item.dataset.tabsEditing = "true";
                    info.classList.add("tabs-title-editor");
                    info.style.left = "42px";
                    const protyle = {lute, wysiwyg: {element: root}, hint: {render: () => {}}};
                    for (const value of ["22", "2", "", null]) {
                        item.removeAttribute("data-editing");
                        title.innerHTML = value === null ? prefix + "<wbr>" :
                            prefix + `<span data-type="block-ref" data-id="20200101000000-abcdefg" data-subtype="${subtype}">` +
                            (forward ? "<wbr>" + value : value + "<wbr>") + "</span>";
                        const range = document.createRange();
                        range.selectNodeContents(title);
                        range.collapse(false);
                        title.focus();
                        getSelection().removeAllRanges();
                        getSelection().addRange(range);
                        run(protyle, item, title, range);
                        check.equal(item.getAttribute("data-editing"), "true", "title input protects its host during reference-removal preflight");
                        check.equal(root.querySelector(".tab-item"), item, "input preserves the tab item host");
                        check.equal(root.querySelector(".tab-item-title"), title, "input preserves the focused title");
                        check.equal(document.activeElement, title);
                        check.ok(title.contains(getSelection().anchorNode));
                        check.equal(getComputedStyle(title).fontSize, "14px");
                        check.equal(info.style.left, "42px");
                        check.equal(item.dataset.tabsEditing, "true");
                        check.equal(item.querySelector(".tab-item-content"), body);
                        check.equal(body.innerHTML, bodyHTML);
                        check.equal(title.textContent, prefix + (value ?? ""));
                        const payload = saved[saved.length - 1];
                        check.equal(payload.includes('data-node-id="' + item.dataset.nodeId + '"'), true);
                        check.equal(payload.includes("tabs-title-editor"), false);
                        check.equal(payload.includes("left: 42px"), false);
                        check.equal(payload.includes("data-tabs-editing"), false);
                        const restored = document.createElement("div");
                        restored.innerHTML = lute.SpinBlockDOM(payload);
                        check.equal(restored.querySelector(".tab-item-title").textContent, prefix + (value ?? ""));
                        check.equal(restored.querySelector(".tab-item-content").textContent, body.textContent);
                    }
                }
            }
        }
        for (const prefix of ["", "11"]) {
            for (const subtype of ["d", "s"]) {
                for (const anchor of ["22", "Reference", "反链按锚文本排序"]) {
                    root.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab Title\n\nBody\n\n:::\n");
                    const title = root.querySelector<HTMLElement>(".tab-item-title");
                    const item = title.closest<HTMLElement>(".tab-item");
                    const body = item.querySelector(".tab-item-content");
                    const bodyHTML = body.innerHTML;
                    title.innerHTML = prefix + `<span data-type="block-ref" data-id="20200101000000-abcdefg" data-subtype="${subtype}">${anchor}</span>`;
                    title.focus();
                    const range = document.createRange();
                    range.selectNodeContents(title.lastChild);
                    range.collapse(false);
                    getSelection().removeAllRanges();
                    getSelection().addRange(range);
                    const protyle = {lute, wysiwyg: {element: root}, hint: {render: () => {}}};
                    let inputs = 0;
                    const listener = () => {
                        const range = getSelection().getRangeAt(0);
                        range.insertNode(document.createElement("wbr"));
                        run(protyle, item, title, range);
                        inputs++;
                    };
                    title.addEventListener("input", listener);
                    try {
                        for (let index = 0; index < anchor.length; index++) {
                            item.removeAttribute("data-editing");
                            document.execCommand("delete");
                            check.equal(item.getAttribute("data-editing"), "true", `${anchor}: native deletion protects the title host`);
                            check.equal(inputs, index + 1);
                            check.equal(document.activeElement, title);
                            check.ok(title.contains(getSelection().anchorNode));
                            check.equal(title.textContent, prefix + anchor.slice(0, -index - 1));
                            check.equal(item.querySelector(".tab-item-content"), body);
                            check.equal(body.innerHTML, bodyHTML);
                        }
                        check.equal(title.querySelector('[data-type="block-ref"]'), null);
                        document.execCommand("insertText", false, "x");
                        check.equal(title.textContent, prefix + "x", "native input continues after the reference is removed");
                    } finally {
                        title.removeEventListener("input", listener);
                    }
                }
            }
        }
        return "tabs-title-input-ok";
    } finally {
        root.remove();
        style.remove();
    }
};

test("tab title reference normalization and native removal preserve editing host, caret, size and body", {timeout: 45000}, async () => {
    const file = "src/protyle/wysiwyg/input.ts";
    const ast = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.ES2021, true);
    let handler: string;
    const visit = (node: Node) => {
        if (isIfStatement(node) && node.expression.getText(ast) === 'editElement.classList.contains("callout-title")') {
            handler = node.getText(ast);
        }
        node.forEachChild(visit);
    };
    visit(ast);
    assert.ok(handler);
    const source = transpileModule(handler, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const selectionSource = [
        ["src/protyle/util/selection.ts", "focusByWbr"],
        ["src/protyle/util/selectionOffsets.ts", "focusByRange"],
        ["src/protyle/wysiwyg/getBlock.ts", "hasPreviousSibling"],
    ].map(([file, name]) => {
        const ast = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.ES2021, true);
        const declaration = ast.statements.filter(isVariableStatement)
            .flatMap(statement => Array.from(statement.declarationList.declarations))
            .find(item => item.name.getText(ast) === name);
        assert.ok(declaration);
        return transpileModule(`const ${name} = ${declaration.initializer.getText(ast)};`,
            {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    }).join("\n");
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-tabs-title-input-"));
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; try { (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(
            readFileSync("stage/protyle/js/lute/lute.min.js", "utf8"))}, ${JSON.stringify(selectionSource)}) } catch (error) { error.stack }`)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const args = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ?
            ["--no-sandbox", "--ozone-platform=headless", script] : [script];
        const result = await promisify(execFile)(require("electron") as unknown as string, args,
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /tabs-title-input-ok/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
