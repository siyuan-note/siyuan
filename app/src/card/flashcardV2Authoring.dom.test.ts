import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {IFlashcardV2ClozeDraft} from "./flashcardV2AuthoringTypes";

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
    let cancel: () => void;
    const transactions: Array<Array<{action: string; data: string}>> = [];
    const undoMarks: boolean[] = [];
    const undoContext = {focus: "caret"};
    const dependencies: Record<string, unknown> = {
        "../block/util": {genEmptyElement: () => paragraph("new-" + (++id), "")},
        "../constants": {Constants: {ZWSP: "\u200b"}},
        "../dialog/confirmDialog": {confirmDialog: (options: {confirm: () => void; cancel: () => void}) => {
            ({confirm, cancel} = options);
        }},
        "../protyle/util/selection": {getUndoFocusContext: (_editor: unknown, caret: Range) => {
            undoMarks.push(caret.collapsed);
            return undoContext;
        }},
        "../protyle/util/selectionOffsets": {focusByRange: (range: Range) => {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }},
        "../protyle/wysiwyg/getBlock": {getContenteditableElement: (block: HTMLElement) => block.firstElementChild},
        "../protyle/wysiwyg/transaction": {
            transaction: (_editor: unknown, operations: Array<{action: string; data: string}>) => {
                transactions.push(operations);
            },
            updateTransaction: (_editor: unknown, element: Element, oldHTML: string, context: unknown) => {
                undoMarks.push(context === undoContext && oldHTML.includes("/qa"));
                transactions.push([{action: "update", data: element.outerHTML}]);
            },
        },
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
    const listChanges = content(transactions[2]);
    const formatted = paragraph("formatted", "");
    formatted.firstElementChild.innerHTML = '<span data-type="strong">Question/qaAnswer</span><code>tail</code>';
    editor.appendChild(formatted);
    const formattedText = formatted.querySelector("span").firstChild;
    const formattedRange = document.createRange();
    formattedRange.setStart(formattedText, 8);
    formattedRange.setEnd(formattedText, 11);
    run(protyle, formatted, formattedRange, "qa");
    cancel();
    const selection = window.getSelection();
    const cancelled = {
        actions: content(transactions[3]),
        content: formatted.firstElementChild.innerHTML,
        caret: [selection.isCollapsed, selection.focusNode === formattedText, selection.focusOffset],
    };
    const changed = paragraph("changed", "Question/qaAnswer");
    editor.appendChild(changed);
    invoke(changed, 8, 11);
    changed.firstElementChild.firstChild.textContent += " new edit";
    cancel();
    const replaced = paragraph("replaced", "Question/qaAnswer");
    editor.appendChild(replaced);
    invoke(replaced, 8, 11);
    replaced.firstElementChild.replaceChildren(document.createTextNode(replaced.textContent));
    cancel();
    const collapsed = paragraph("collapsed", "QuestionAnswer");
    editor.appendChild(collapsed);
    invoke(collapsed, 8, 8);
    cancel();
    const selected = paragraph("selected", "QuestionAnswer");
    editor.appendChild(selected);
    invoke(selected, 0, 8);
    cancel();
    const switched = paragraph("switched", "Question/qaAnswer");
    editor.appendChild(switched);
    invoke(switched, 8, 11);
    protyle.block.rootID = "different";
    cancel();
    return {confirmationRequired, split, template, blankNeedsNoConfirmation, list: listChanges, cancelled, undoMarks,
        unaffected: [changed, replaced, collapsed, selected, switched].map(block => block.textContent), updates: transactions.length};
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

const clozeSelectionCase = async (sources: Record<string, string>) => {
    const load = (name: string, modules: Record<string, unknown> = {}) => {
        const exports = {};
        new Function("exports", "require", sources[name])(exports, (path: string) => modules[path] || {});
        return exports;
    };
    const closest = load("hasClosest");
    const boundary = load("inlineElementBoundary", {"./longTextWrap": load("longTextWrap")});
    const marker = load("inlineElementMarker", {"./inlineElementBoundary": boundary});
    let draft: IFlashcardV2ClozeDraft;
    let mobile = false;
    let rejectWrite = false;
    const transactions: {data: string; undo: string}[] = [];
    const {Toolbar} = load("toolbar", {
        "../util/hasClosest": closest,
        "../util/inlineElementBoundary": boundary,
        "../util/inlineElementMarker": marker,
        "../wysiwyg/getBlock": load("getBlock", {"../util/hasClosest": closest}),
        "./inlineRangeBoundary": load("inlineRangeBoundary"),
        "./fontFamilyCore": load("fontFamilyCore"),
        "./Font": {setFontStyle: (): void => undefined, hasSameTextStyle: () => true},
        "./util": load("toolbarUtil", {"../util/inlineElementMarker": marker,
            "./Font": {hasSameTextStyle: () => true},
            "../../util/functions": {isArrayEqual: (left: string[], right: string[]) => left.join(" ") === right.join(" ")}}),
        "../util/selection": {fixTableRange: (): void => undefined},
        "../../constants": {Constants: {ZWSP: "\u200b"}},
        "../../util/functions": {isMobile: () => mobile},
        "../../util/pathName": {isEncryptedBox: () => false},
        "dayjs": () => ({format: () => "20261128170000"}),
        "../../card/flashcardV2": {openFlashcardV2SourceMode: (_ids: string[], _mode: string, staged: IFlashcardV2ClozeDraft) => {
            draft = staged;
        }},
        "../wysiwyg/transaction": {
            transaction: async (_editor: unknown, operations: {data: string}[], undo: {data: string}[],
                options: {callback: () => void}) => {
                if (rejectWrite) { throw new Error("transaction failed"); }
                transactions.push({data: operations[0].data, undo: undo[0].data});
                options.callback();
            },
        },
    }) as typeof import("../protyle/toolbar");
    const toolbar = Object.create(Toolbar.prototype) as InstanceType<typeof Toolbar>;
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    document.body.append(editor);
    const protyle = {element: editor, block: {rootID: "root"}, wysiwyg: {element: editor}} as unknown as IProtyle;
    const outcomes = [];
    for (mobile of [false, true]) {
        const block = document.createElement("div");
        block.dataset.nodeId = "block";
        block.dataset.type = "NodeParagraph";
        block.innerHTML = '<div contenteditable="true">before <span data-type="strong">answer</span> after</div>';
        editor.replaceChildren(block);
        const original = block.outerHTML;
        const range = document.createRange();
        range.selectNodeContents(block.querySelector("span").firstChild);
        const open = async () => {
            toolbar.createFlashcardCloze(protyle, range);
            await new Promise(resolve => setTimeout(resolve, 0));
        };
        const startingCount = transactions.length;
        await open();
        const staged = document.createElement("template");
        staged.innerHTML = draft.dom;
        const mark = staged.content.querySelector<HTMLElement>('span[data-type~="mark"]');
        const stagedText = mark.textContent;
        const stagedStrong = mark.dataset.type.includes("strong");
        draft = undefined;
        const cancelled = block.outerHTML === original && transactions.length === startingCount;
        await open();
        mark.dataset.occlusionId = "occlusion-id";
        rejectWrite = true;
        const unchangedAfterFailure = await draft.save(staged.innerHTML).then(() => false,
            () => block.outerHTML === original && transactions.length === startingCount);
        rejectWrite = false;
        const confirmed = await draft.save(staged.innerHTML);
        const stored = transactions.at(-1);
        const rendered = block.querySelector<HTMLElement>('[data-occlusion-id="occlusion-id"]');
        outcomes.push({mobile, stagedText, stagedStrong, cancelled, unchangedAfterFailure, confirmed,
            undo: stored.undo === original, savedOnce: transactions.length === startingCount + 1,
            storedMatchesEditor: stored.data === block.outerHTML,
            rendered: rendered?.textContent, text: block.textContent});
    }
    const block = editor.firstElementChild;
    block.innerHTML = '<div contenteditable="true">one two</div>';
    const text = block.firstElementChild.firstChild;
    const staleRange = document.createRange();
    staleRange.setStart(text, 0);
    staleRange.setEnd(text, 3);
    toolbar.createFlashcardCloze(protyle, staleRange);
    await new Promise(resolve => setTimeout(resolve, 0));
    text.textContent += " edited";
    const staleRejected = !await draft.save(draft.dom) && block.textContent === "one two edited";
    return {outcomes, staleRejected, writes: transactions.length};
};

test("selected cloze text is staged through cancellation and written only on confirmation", async () => {
    const sources = Object.fromEntries(Object.entries({toolbar: "toolbar/index", toolbarUtil: "toolbar/util",
        inlineRangeBoundary: "toolbar/inlineRangeBoundary", fontFamilyCore: "toolbar/fontFamilyCore", hasClosest: "util/hasClosest",
        inlineElementBoundary: "util/inlineElementBoundary", inlineElementMarker: "util/inlineElementMarker",
        longTextWrap: "util/longTextWrap", getBlock: "wysiwyg/getBlock",
    }).map(([key, file]) => [key, authoringSource(`../protyle/${file}.ts`)]));
    const result = await runInAuthoringBrowser("window.siyuan={config:{}};(" + clozeSelectionCase.toString() + ")(" +
        JSON.stringify(sources) + ");");
    assert.deepEqual(result, {outcomes: [false, true].map(mobile => ({mobile, stagedText: "answer", stagedStrong: true,
        cancelled: true, unchangedAfterFailure: true, confirmed: true, undo: true, savedOnce: true,
        storedMatchesEditor: true, rendered: "answer", text: "before answer after"})), staleRejected: true, writes: 2});
});

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
        cancelled: {
            actions: [["update", "QuestionAnswertail"]],
            content: '<span data-type="strong">QuestionAnswer</span><code>tail</code>',
            caret: [true, true, 8],
        },
        undoMarks: [true, true],
        unaffected: ["Question/qaAnswer new edit", "Question/qaAnswer", "QuestionAnswer", "QuestionAnswer", "Question/qaAnswer"],
        updates: 4,
    });
});

const imageAndBadgeCase = async (imageSource: string, badgeSource: string, authoringSource: string) => {
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
    let closeDialog: () => void;
    let upload: () => void;
    let uploads = 0;
    const messages: string[] = [];
    const opened: string[] = [];
    const menus: Array<[string, boolean]> = [];
    const undos: string[][] = [];
    const transactionSelections: Array<string | null> = [];
    const cancellations: Array<[string, string, string]> = [];
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
                closeDialog = () => this.destroy();
                document.body.appendChild(dialog);
            }
            destroy() {
                this.element.remove();
                this.options.destroyCallback();
            }
        }},
        "../dialog/message": {showMessage: (message: string) => messages.push(message)},
        "../protyle/util/selection": {getUndoFocusContext: () => ({restoreSelection: "true"})},
        "../protyle/util/selectionOffsets": {focusByRange: (range: Range) => {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }},
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
            const selection = window.getSelection();
            const anchor = selection.rangeCount ? selection.getRangeAt(0).startContainer : null;
            transactionSelections.push(anchor?.parentElement?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null);
            for (const change of changes) {
                const block = editor.querySelector('[data-node-id="' +
                    (change.action === "update" ? change.id : change.previousID) + '"]');
                if (anchor && block.contains(anchor)) {
                    continue;
                }
                if (change.action === "update") {
                    block.outerHTML = String(change.data);
                } else {
                    block.insertAdjacentHTML("afterend", String(change.data));
                }
            }
            undos.push(undo.map(change => change.action + ":" + change.id));
            options.callback();
        }, updateTransaction: (_protyle: unknown, block: HTMLElement, oldHTML: string) => {
            const previous = document.createElement("template");
            previous.innerHTML = oldHTML;
            cancellations.push([block.dataset.nodeId, previous.content.textContent, block.textContent]);
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
    const authoringModule = {};
    new Function("exports", "require", authoringSource)(authoringModule, (path: string) => dependencies[path]);
    dependencies["./flashcardV2Authoring"] = authoringModule;
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
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
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
    protyle.block.rootID = "root";
    const blank = paragraph("blank", "/image");
    const unrelated = paragraph("unrelated", "Keep this selection");
    editor.append(blank, unrelated);
    invoke(blank);
    const files = new DataTransfer();
    files.items.add(new File(["bytes"], "diagram.png"));
    const input = dialog.querySelector("input");
    input.files = files.files;
    input.dispatchEvent(new Event("change"));
    const selection = window.getSelection();
    selection.collapse(unrelated.firstElementChild.firstChild, 4);
    upload();
    const unrelatedSelectionPreserved = selection.anchorNode === unrelated.firstElementChild.firstChild && selection.anchorOffset === 4;
    const declined = paragraph("declined", "");
    declined.firstElementChild.innerHTML = '<span data-type="strong">Keep/image text</span>';
    editor.appendChild(declined);
    const declinedText = declined.querySelector("span").firstChild;
    const declinedRange = document.createRange();
    declinedRange.setStart(declinedText, 4);
    declinedRange.setEnd(declinedText, 10);
    selection.removeAllRanges();
    selection.addRange(declinedRange);
    openFlashcardV2ImageUpload(protyle, declined, declinedRange);
    dialog.querySelector("input").dispatchEvent(new Event("change"));
    const emptyPickerRetainedCommand = declined.textContent === "Keep/image text" && dialog.isConnected;
    dialog.querySelector<HTMLButtonElement>(".b3-button--cancel").click();
    const cancelCaret = selection.anchorNode === declinedText && selection.isCollapsed && selection.anchorOffset === 4;
    const interrupted = paragraph("interrupted", "/image");
    editor.appendChild(interrupted);
    invoke(interrupted);
    drop("diagram.png");
    closeDialog();
    upload();
    const changed = paragraph("changed", "/image");
    editor.appendChild(changed);
    invoke(changed);
    changed.firstElementChild.firstChild.textContent += " edited";
    closeDialog();
    const switched = paragraph("switched", "/image");
    editor.appendChild(switched);
    invoke(switched);
    selection.collapse(unrelated.firstElementChild.firstChild, 2);
    closeDialog();

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
        uploads, messages, opened, undos, menus, badgeCount, transactionSelections, unrelatedSelectionPreserved,
        remainingBadges: editor.querySelectorAll("[data-flashcard-badge]").length,
        original: editor.firstElementChild.textContent, stale: cancel.textContent,
        image: imageBlock.querySelector("img").dataset.src,
        blankImage: editor.querySelector<HTMLElement>('[data-node-id="blank"] img').dataset.src,
        cancellations, emptyPickerRetainedCommand, cancelCaret, declinedHTML: declined.firstElementChild.innerHTML,
        protectedCommands: [changed.textContent, switched.textContent],
    };
};

test("image slash upload preserves surrounding text and its document, and the source badge addresses that block", async () => {
    const result = await runInAuthoringBrowser("window.siyuan={config:{},languages:{flashcardImageUploadHint:'image-only'," +
        "uploadInsertTargetUnavailable:'stale-target',riffCard:'Cards'}};(" + imageAndBadgeCase.toString() + ")(" +
        JSON.stringify(authoringSource("flashcardV2ImageUpload.ts")) + "," +
        JSON.stringify(authoringSource("flashcardV2Badge.ts")) + "," +
        JSON.stringify(authoringSource("flashcardV2Authoring.ts")) + ");");
    assert.deepEqual(result, {
        uploads: 4, messages: ["image-only", "stale-target"], opened: ["assets/diagram.png", "assets/diagram.png"],
        undos: [["delete:image-block", "update:original"], ["update:blank"]], menus: [["image-block", true]],
        badgeCount: 1, remainingBadges: 0, transactionSelections: [null, "unrelated"], unrelatedSelectionPreserved: true,
        original: "Keep  the text", stale: "/image", image: "assets/diagram.png", blankImage: "assets/diagram.png",
        cancellations: [["declined", "Keep/image text", "Keep text"], ["interrupted", "/image", ""]],
        emptyPickerRetainedCommand: true, cancelCaret: true, declinedHTML: '<span data-type="strong">Keep text</span>',
        protectedCommands: ["/image edited", "/image"],
    });
});
