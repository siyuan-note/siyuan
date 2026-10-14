import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const api = {} as typeof import("./search");
    new Function("exports", "require", source)(api, () => ({addClearButton() {}, electronUndo() {}}));
    const block = document.createElement("div");
    document.body.append(block);
    const header = '<div class="av__views"><div data-type="av-search" contenteditable="plaintext-only"></div></div>';
    block.innerHTML = header;
    const input = () => block.querySelector<HTMLElement>('[data-type="av-search"]');
    const bind = (query: string, isSearching = true, selection?: ReturnType<typeof api.captureAvSearchSelection>) => {
        api.bindAvSearch({blockElement: block, query, isSearching, selection, onChange() {}});
    };
    const render = () => {
        const query = input().textContent;
        const isSearching = document.activeElement === input();
        const selection = api.captureAvSearchSelection(input());
        block.innerHTML = header;
        bind(query, isSearching, selection);
    };
    const select = (anchor: number, focus = anchor) => {
        const node = input().firstChild || input();
        getSelection().setBaseAndExtent(node, anchor, node, focus);
    };
    const checkSelection = (anchor: number, focus = anchor) => {
        check.equal(document.activeElement, input());
        check.equal(getSelection().anchorNode, input().firstChild || input());
        check.equal(getSelection().focusNode, input().firstChild || input());
        check.equal(getSelection().anchorOffset, anchor);
        check.equal(getSelection().focusOffset, focus);
    };
    for (const [anchor, focus] of [[0, 0], [7, 7], [12, 12], [2, 9], [9, 2]]) {
        bind("before after");
        select(anchor, focus);
        render();
        checkSelection(anchor, focus);
    }
    select(7);
    check.equal(document.execCommand("insertText", false, "X"), true);
    render();
    check.equal(input().textContent, "before Xafter");
    checkSelection(8);
    select(8, 7);
    check.equal(document.execCommand("delete"), true);
    render();
    check.equal(input().textContent, "before after");
    checkSelection(7);

    bind("");
    select(0);
    render();
    checkSelection(0);
    bind("前😀后");
    input().replaceChildren(document.createTextNode("前😀"), document.createTextNode("后"));
    getSelection().setBaseAndExtent(input().lastChild, 1, input().firstChild, 1);
    render();
    checkSelection(4, 1);

    bind("前后");
    const original = input();
    select(1);
    original.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    check.equal(api.deferAvSearchRender(original, render), true);
    original.textContent = "前你好后";
    original.dispatchEvent(new InputEvent("input", {bubbles: true, isComposing: true, inputType: "insertCompositionText"}));
    check.equal(input(), original);
    original.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "你好"}));
    select(3);
    original.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText"}));
    await new Promise(resolve => setTimeout(resolve, 0));
    check.notEqual(input(), original);
    check.equal(input().textContent, "前你好后");
    checkSelection(3);

    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    render();
    check.equal(document.activeElement, outside);
    block.remove();
    outside.remove();
    return "Database search DOM cases passed";
};

test("database search preserves real DOM selection, edits and composition across replacement", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "search.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-av-search-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("about:blank");
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
        const {stdout} = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(stdout, /Database search DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-av-search-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
