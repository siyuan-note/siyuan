import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCase = (source: string) => {
    const editor = document.createElement("div");
    document.body.appendChild(editor);
    const paragraph = (id: string, value: string) => {
        const block = document.createElement("div");
        block.dataset.type = "NodeParagraph";
        block.dataset.nodeId = id;
        const editable = document.createElement("div");
        editable.contentEditable = "true";
        editable.textContent = value;
        block.appendChild(editable);
        return block;
    };
    let id = 0;
    let confirm: () => void;
    const transactions: Array<Array<{action: string; data: string}>> = [];
    const dependencies: Record<string, unknown> = {
        "../block/util": {genEmptyElement: () => paragraph("new-" + (++id), "")},
        "../constants": {Constants: {ZWSP: "\u200b"}},
        "../dialog/confirmDialog": {confirmDialog: (options: {confirm: () => void}) => { confirm = options.confirm; }},
        "../protyle/util/selection": {},
        "../protyle/wysiwyg/getBlock": {getContenteditableElement: (block: HTMLElement) => block.firstElementChild},
        "../protyle/wysiwyg/transaction": {transaction: (_editor: unknown, operations: Array<{action: string; data: string}>) => {
            transactions.push(operations);
        }},
        "../util/pathName": {isEncryptedBox: () => false},
    };
    const exports = {};
    new Function("exports", "require", source)(exports, (path: string) => dependencies[path]);
    const run = (exports as typeof import("./flashcardV2Authoring")).runFlashcardSlashCommand;
    const protyle = {block: {rootID: "root"}, wysiwyg: {element: editor}} as unknown as IProtyle;
    const invoke = (block: HTMLElement, start: number, end: number) => {
        const range = document.createRange();
        range.setStart(block.firstElementChild.firstChild, start);
        range.setEnd(block.firstElementChild.firstChild, end);
        run(protyle, block, range, "qa");
    };
    const content = (operations: Array<{action: string; data: string}>) => operations.map(operation => {
        const template = document.createElement("template");
        template.innerHTML = operation.data;
        return [operation.action, template.content.textContent];
    });
    const existing = paragraph("original", "Question /qa Answer");
    editor.appendChild(existing);
    invoke(existing, 9, 12);
    const confirmationRequired = !!confirm && transactions.length === 0 && existing.textContent === "Question /qa Answer";
    confirm();
    const split = content(transactions[0]);
    confirm = undefined;
    const empty = paragraph("empty", "/qa");
    editor.appendChild(empty);
    invoke(empty, 0, 3);
    const template = content(transactions[1]);
    const blankNeedsNoConfirmation = confirm === undefined;
    const item = document.createElement("div");
    item.dataset.type = "NodeListItem";
    const question = paragraph("question", "Question /qa");
    const list = document.createElement("div");
    list.dataset.type = "NodeList";
    const child = document.createElement("div");
    child.dataset.type = "NodeListItem";
    child.appendChild(paragraph("answer", "Existing answer"));
    list.appendChild(child);
    item.append(question, list);
    editor.appendChild(item);
    invoke(question, 9, 12);
    return {confirmationRequired, split, template, blankNeedsNoConfirmation, list: content(transactions[2])};
};

test("slash card commands ask before splitting and directly handle empty paragraphs or existing list structure", async () => {
    const folder = mkdtempSync(join(tmpdir(), "siyuan-flashcard-authoring-"));
    try {
        const source = transpileModule(readFileSync("src/card/flashcardV2Authoring.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const command = "const __name = value => value; window.siyuan={config:{},languages:{flashcardChoiceQuestion:'Question',flashcardCorrectAnswer:'Answer'}};(" +
            browserCase.toString() + ")(" + JSON.stringify(source) + ");";
        const script = join(folder, "authoring.cjs");
        writeFileSync(script, "const {app,BrowserWindow}=require('electron');app.setPath('userData'," +
            JSON.stringify(join(folder, "profile")) + ");app.commandLine.appendSwitch('disable-gpu');app.whenReady().then(async()=>{" +
            "const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});" +
            "try {await win.loadURL('data:text/html,<html><body></body></html>');const result=await win.webContents.executeJavaScript(" +
            JSON.stringify(command) + ");console.log('AUTHORING_RESULT='+JSON.stringify(result));app.exit(0);" +
            "}catch(error){console.error(error);app.exit(1);}});", "utf8");
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const {stdout} = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 30000});
        const match = stdout.match(/AUTHORING_RESULT=(.*)/);
        assert.ok(match, stdout);
        assert.deepEqual(JSON.parse(match[1]), {
            confirmationRequired: true,
            split: [["update", "Question "], ["insert", " Answer"]],
            template: [["update", "Question"], ["insert", "Answer"]],
            blankNeedsNoConfirmation: true,
            list: [["update", "Question "]],
        });
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
});
