import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCase = async (source: string, luteSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const insert = (text: string) => require("electron").ipcRenderer.invoke("insert-review-text", text);
    new Function(luteSource)();
    const note = Lute.New().Md2BlockDOM("- Original list item\n  - Nested list item");
    const mount = () => {
        const element = document.createElement("div");
        element.contentEditable = "false";
        element.innerHTML = note;
        document.body.append(element);
        return element;
    };
    const baseline = mount();
    const editable = baseline.querySelector<HTMLElement>('[contenteditable="true"]');
    check.equal(editable.isContentEditable, true, "a nested source block overrides the old outer read-only flag");
    editable.focus();
    await insert("unexpected typing");
    check.match(baseline.textContent, /unexpected typing/, "the original card surface accepts native text entry");
    baseline.remove();
    const protect = new Function(source + "\nreturn makeFlashcardV2ContentReadOnly;")() as
        typeof import("./flashcardV2Render").makeFlashcardV2ContentReadOnly;
    for (const label of ["front", "back", "context", "explanation"]) {
        const surface = mount();
        const paragraph = surface.querySelector<HTMLElement>('[contenteditable="true"]');
        const nested = document.createElement("span");
        nested.contentEditable = "plaintext-only";
        nested.textContent = "Existing nested text";
        paragraph.append(nested);
        const before = surface.textContent;
        protect(surface);
        check.equal(paragraph.isContentEditable, false, label);
        check.equal(nested.isContentEditable, false, label);
        paragraph.focus();
        await insert("unexpected typing");
        check.equal(surface.textContent, before, label);
        const answer = document.createElement("input");
        answer.setAttribute("data-flashcard-type-answer", "");
        surface.append(answer);
        protect(surface);
        answer.focus();
        await insert("my answer");
        check.equal(answer.value, "my answer", "read-only card text does not disable the answer input");
        const option = document.createElement("input");
        option.type = "checkbox";
        surface.append(option);
        protect(surface);
        option.click();
        check.equal(option.checked, true, "choice answers remain operable");
        surface.remove();
    }
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    document.body.append(editor);
    editor.focus();
    await insert("saved through the source editor");
    check.equal(editor.textContent, "saved through the source editor", "another editor is unaffected");
    return "Read-only flashcard surfaces verified";
};

test("review content rejects native text input while answer and source editor inputs remain editable", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const file = createSourceFile("flashcardV2Render.ts", readFileSync("src/card/flashcardV2Render.ts", "utf8"),
        ScriptTarget.ES2021, true);
    const helper = file.statements.filter(isVariableStatement).find(statement =>
        statement.declarationList.declarations.some(declaration => declaration.name.getText(file) === "makeFlashcardV2ContentReadOnly"));
    assert.ok(helper);
    const source = transpileModule(helper.getText(file).replace(/^export /, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const luteSource = readFileSync("stage/protyle/js/lute/lute.min.js", "utf8");
    const contents = `const __name = value => value; (${browserCase.toString()})(${JSON.stringify(source)}, ${JSON.stringify(luteSource)})`;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-review-read-only-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        window.webContents.debugger.attach("1.3");
        ipcMain.handle("insert-review-text", (event, text) => window.webContents.debugger.sendCommand("Input.insertText", {text}));
        await window.loadURL("data:text/html,<html><body></body></html>");
        console.log(await window.webContents.executeJavaScript(${JSON.stringify(contents)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`);
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 40000});
        assert.match(result.stdout, /Read-only flashcard surfaces verified/);
    } finally {
        if (path.dirname(temporary) === tmpdir() && path.basename(temporary).startsWith("siyuan-review-read-only-")) {
            rmSync(temporary, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
        }
    }
});
