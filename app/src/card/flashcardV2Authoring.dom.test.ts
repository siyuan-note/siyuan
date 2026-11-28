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

const runInAuthoringBrowser = async (body: string) => {
    const folder = mkdtempSync(join(tmpdir(), "siyuan-flashcard-authoring-"));
    try {
        const command = "const __name = value => value; " + body;
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
        return JSON.parse(match[1]);
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
};

const authoringSource = (file: string) => transpileModule(readFileSync("src/card/" + file, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("slash card commands ask before splitting and directly handle empty paragraphs or existing list structure", async () => {
    const result = await runInAuthoringBrowser(
        "window.siyuan={config:{},languages:{flashcardChoiceQuestion:'Question',flashcardCorrectAnswer:'Answer'}};(" +
        browserCase.toString() + ")(" + JSON.stringify(authoringSource("flashcardV2Authoring.ts")) + ");");
    assert.deepEqual(result, {
        confirmationRequired: true,
        split: [["update", "Question "], ["insert", " Answer"]],
        template: [["update", "Question"], ["insert", "Answer"]],
        blankNeedsNoConfirmation: true,
        list: [["update", "Question "]],
    });
});

const imageAndBadgeCase = async (imageSource: string, badgeSource: string) => {
    const root = document.createElement("div");
    root.className = "protyle";
    root.innerHTML = '<div class="protyle-wysiwyg"></div>';
    document.body.appendChild(root);
    const editor = root.querySelector<HTMLElement>(".protyle-wysiwyg");
    const paragraph = (id: string, text: string) => {
        const block = document.createElement("div");
        block.dataset.nodeId = id;
        block.dataset.type = "NodeParagraph";
        block.innerHTML = '<div contenteditable="true"></div><div class="protyle-attr" contenteditable="false"></div>';
        block.firstElementChild.textContent = text;
        return block;
    };
    let dialog: HTMLElement;
    let upload: () => void;
    let uploads = 0;
    const messages: string[] = [];
    const opened: string[] = [];
    const menus: Array<[string, boolean]> = [];
    const undos: string[][] = [];
    const constants = {ZWSP: "\u200b", SIYUAN_ASSETS_IMAGE: [".png"], DATA_FLASHCARD_SOURCE: "data-flashcard-source"};
    const dependencies: Record<string, unknown> = {
        "../asset/renderAssets": {genAssetHTML: (_extension: string, path: string) => '<img data-src="' + path + '">'},
        "../block/util": {genEmptyElement: () => paragraph("image-block", "")},
        "../constants": {Constants: constants},
        "../dialog": {Dialog: class {
            element = document.createElement("div");
            constructor(private options: {content: string, destroyCallback: () => void}) {
                this.element.innerHTML = options.content;
                dialog = this.element;
                document.body.appendChild(dialog);
            }
            destroy() {
                this.element.remove();
                this.options.destroyCallback();
            }
        }},
        "../dialog/message": {showMessage: (message: string) => messages.push(message)},
        "../protyle/runtimeCapabilities": {isProtyleUploadDisabled: () => false},
        "../protyle/upload": {uploadFiles: (_protyle: unknown, _files: unknown, _input: unknown,
            saved: (response: string, result: string) => void, complete: (success: boolean) => void) => {
            uploads++;
            upload = () => {
                saved("", "assets/diagram.png");
                complete(true);
            };
        }},
        "../protyle/upload/insertPosition": {captureUploadDocument: () => ({})},
        "../protyle/upload/uploadResult": {getCompleteAssetUploadPathsByInput: (_count: number, path: string) => [path]},
        "../protyle/wysiwyg/getBlock": {getContenteditableElement: (block: HTMLElement) => block.firstElementChild},
        "../protyle/wysiwyg/transaction": {transaction: (_protyle: unknown, changes: IOperation[],
            undo: IOperation[], options: {callback: () => void}) => {
            for (const change of changes) {
                if (change.action === "update") {
                    editor.querySelector('[data-node-id="' + change.id + '"]').outerHTML = String(change.data);
                } else {
                    editor.querySelector('[data-node-id="' + change.previousID + '"]').insertAdjacentHTML("afterend", String(change.data));
                }
            }
            undos.push(undo.map(change => change.action + ":" + change.id));
            options.callback();
        }},
        "../util/functions": {isMobile: () => false},
        "../util/imageURL": {isBrowserRenderableImagePath: () => true},
        "../util/pathName": {isEncryptedBox: (box: string) => box === "encrypted"},
        "./flashcardV2ImageEntry": {createFlashcardFromImage: (image: HTMLImageElement) => opened.push(image.dataset.src)},
        "./flashcardV2": {openFlashcardV2BadgeMenu: (_anchor: Element, id: string, writable: boolean) =>
            menus.push([id, writable])},
    };
    const imageModule = {};
    const badgeModule = {};
    new Function("exports", "require", imageSource)(imageModule, (path: string) => dependencies[path]);
    new Function("exports", "require", badgeSource)(badgeModule, (path: string) => dependencies[path]);
    const {openFlashcardV2ImageUpload} = imageModule as typeof import("./flashcardV2ImageUpload");
    const {handleFlashcardV2Badge, renderFlashcardV2Badges, renderFlashcardV2Badge} =
        badgeModule as typeof import("./flashcardV2Badge");
    const protyle = {element: root, notebookId: "notebook", block: {rootID: "root"}, wysiwyg: {element: editor}} as unknown as IProtyle;
    const invoke = (block: HTMLElement) => {
        const text = block.firstElementChild.firstChild;
        const start = text.textContent.indexOf("/image");
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + 6);
        openFlashcardV2ImageUpload(protyle, block, range);
    };
    const drop = (name: string) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["bytes"], name));
        dialog.querySelector(".b3-dialog__content").dispatchEvent(
            new DragEvent("drop", {dataTransfer: transfer, cancelable: true, bubbles: true}));
    };
    const existing = paragraph("original", "Keep /image the text");
    editor.appendChild(existing);
    invoke(existing);
    drop("notes.pdf");
    drop("diagram.png");
    upload();
    const cancel = paragraph("stale", "/image");
    editor.appendChild(cancel);
    invoke(cancel);
    drop("diagram.png");
    protyle.block.rootID = "other-document";
    upload();

    const imageBlock = editor.querySelector<HTMLElement>('[data-node-id="image-block"]');
    imageBlock.dataset.flashcardSource = "true";
    renderFlashcardV2Badges(editor);
    renderFlashcardV2Badges(editor);
    const badges = editor.querySelectorAll<HTMLElement>("[data-flashcard-badge]");
    const badgeCount = badges.length;
    editor.addEventListener("click", event => handleFlashcardV2Badge(event, protyle));
    badges[0].click();
    await new Promise(resolve => setTimeout(resolve, 0));
    imageBlock.dataset.flashcardSource = "false";
    renderFlashcardV2Badge(imageBlock);
    return {
        uploads, messages, opened, undos, menus, badgeCount, remainingBadges: editor.querySelectorAll("[data-flashcard-badge]").length,
        original: editor.firstElementChild.textContent, stale: cancel.textContent,
        image: imageBlock.querySelector("img").dataset.src,
    };
};

test("image slash upload preserves surrounding text and its document, and the source badge addresses that block", async () => {
    const result = await runInAuthoringBrowser("window.siyuan={config:{},languages:{flashcardImageUploadHint:'image-only'," +
        "uploadInsertTargetUnavailable:'stale-target',riffCard:'Cards'}};(" + imageAndBadgeCase.toString() + ")(" +
        JSON.stringify(authoringSource("flashcardV2ImageUpload.ts")) + "," +
        JSON.stringify(authoringSource("flashcardV2Badge.ts")) + ");");
    assert.deepEqual(result, {
        uploads: 2, messages: ["image-only", "stale-target"], opened: ["assets/diagram.png"],
        undos: [["delete:image-block", "update:original"]], menus: [["image-block", true]], badgeCount: 1, remainingBadges: 0,
        original: "Keep  the text", stale: "/image", image: "assets/diagram.png",
    });
});
