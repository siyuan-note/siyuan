import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isIfStatement, Node, ScriptTarget, transpileModule} from "typescript";

const browserCases = (source: string) => {
    const check = require("node:assert/strict");
    const api = new Function(source + "\nreturn {tabsRender, destroyTabsRender, titleKeydown};")();
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    document.body.append(editor);
    try {
        for (const extension of ["svg", "png"]) {
            for (const titleHTML of [
                `<img class="emoji" src="/emojis/custom.${extension}">`,
                `A<img class="emoji" src="/emojis/custom.${extension}">B`,
                `<img class="emoji" src="/emojis/custom.${extension}"><img class="emoji" src="/emojis/second.${extension}">`,
                "&#x1f600;", "", "<strong>A</strong><br>B",
            ]) {
                editor.innerHTML = '<div class="tabs" data-type="NodeTabs" data-node-id="tabs">' +
                    '<div class="tab-item" data-type="NodeTabItem" data-node-id="item">' +
                    '<div class="tab-item-info"><div class="tab-item-title callout-title" contenteditable="true">' +
                    titleHTML + '</div></div><div class="tab-item-content">Body</div></div></div>';
                api.tabsRender(editor, {label: "Untitled"});
                const title = editor.querySelector<HTMLElement>(".tab-item-title");
                const label = editor.querySelector(".tabs-tab-label");
                check.equal(label.querySelectorAll("img.emoji").length, title.querySelectorAll("img.emoji").length);
                check.equal(label.textContent, titleHTML.includes("<br>") ? "A B" :
                    title.textContent || (titleHTML ? "" : "Untitled"));
                for (let index = 0; index <= title.childNodes.length; index++) {
                    const range = document.createRange();
                    range.setStart(title, index);
                    range.collapse(true);
                    for (const key of ["Delete", "Backspace", "ArrowLeft", "ArrowRight"]) {
                        const event = new KeyboardEvent("keydown", {key, cancelable: true});
                        api.titleKeydown(title, editor, range, event);
                        const boundary = key === "Backspace" || key === "ArrowLeft" ?
                            index === 0 : index === title.childNodes.length;
                        check.equal(event.defaultPrevented, boundary, `${titleHTML}: ${key} at ${index}`);
                    }
                }
                // 原生删除仍能移除图片，标题栏重绘后与源标题一致。
                const image = title.querySelector("img");
                if (image) {
                    const range = document.createRange();
                    range.selectNode(image);
                    range.deleteContents();
                    api.tabsRender(editor, {label: "Untitled"});
                    check.equal(editor.querySelectorAll(".tabs-tab-label img").length, title.querySelectorAll("img").length);
                }
                api.destroyTabsRender(editor);
            }
        }
    } finally {
        api.destroyTabsRender(editor);
        editor.remove();
    }
    return "tabs-emoji-ok";
};

test("tab titles preserve custom emoji and protect only actual editing boundaries", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const file = "src/protyle/wysiwyg/keydown.ts";
    const ast = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.ES2021, true);
    let handler: string;
    const visit = (node: Node) => {
        if (isIfStatement(node) && node.expression.getText(ast) ===
            "calloutTitleElement && !event.isComposing && !blockSelectionModeElement") {
            handler = node.thenStatement.getText(ast);
        }
        node.forEachChild(visit);
    };
    visit(ast);
    assert.ok(handler);
    const source = ["src/util/escape.ts", "src/protyle/util/selectionOffsets.ts",
        "src/protyle/render/tabsState.ts", "src/protyle/render/tabsDrag.ts",
        "src/protyle/render/tabsAttributes.ts", "src/protyle/render/tabsVisibility.ts",
        "src/protyle/render/tabsRender.ts"]
        .map(file => compile(readFileSync(file, "utf8"))).join("\n") + compile(`
        const matchHotKey = () => false;
        const isNotCtrl = () => true;
        const titleKeydown = (calloutTitleElement, nodeElement, range, event) => ${handler};`);
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-tabs-emoji-"));
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
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
        assert.match(result.stdout, /tabs-emoji-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        assert.ok(path.basename(directory).startsWith("siyuan-tabs-emoji-"));
        rmSync(directory, {recursive: true, force: true});
    }
});
