import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import test from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sourceCode: string, css: string, cleanupSource: string, tabsSource: string) => {
    const check = require("node:assert/strict");
    const {tabsRender, destroyTabsRender} = new Function(tabsSource + "; return {tabsRender, destroyTabsRender};")();
    const baseStyle = document.createElement("style");
    baseStyle.textContent = css;
    document.head.append(baseStyle);
    const noop = (): void => undefined;
    const settle = async () => {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    };
    const until = async (condition: () => boolean) => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (condition()) {
                return;
            }
            await settle();
        }
        check.fail("Editor lifecycle did not settle");
    };
    const gate = () => {
        let release: () => void;
        const promise = new Promise<void>(resolve => {
            release = resolve;
        });
        return {promise, release};
    };
    const textHTML = (text: string) => {
        const block = document.createElement("div");
        block.dataset.type = "NodeParagraph";
        block.dataset.nodeId = "paragraph";
        block.textContent = text;
        return block.outerHTML;
    };
    const create = (initialBlockHTML = textHTML("Initial"), replaceFirstParagraph?: string,
                    branchType = "NodeList", embedded = false, canvas = false) => {
        let transactionOwner: (operations: Array<{action: string; id: string; parentID?: string;
            previousID?: string; nextID?: string}>) => unknown;
        const container = document.createElement("section");
        container.dataset.type = branchType;
        const rootID = embedded ? "source-document" : "document";
        if (embedded) {
            container.classList.add("protyle-wysiwyg__embed");
        }
        const element = document.createElement("div");
        element.dataset.type = `${branchType}Item`;
        element.dataset.nodeId = "item";
        element.innerHTML = initialBlockHTML;
        const host = document.createElement("div");
        host.style.display = "inline-block";
        host.style.width = "120px";
        host.style.minWidth = "36px";
        const wysiwyg = document.createElement("div");
        wysiwyg.className = "protyle-wysiwyg";
        const hintElement = document.createElement("div");
        const toolbarElement = document.createElement("div");
        const subElement = document.createElement("div");
        [hintElement, toolbarElement, subElement].forEach(item => item.classList.add("fn__none"));
        container.append(element, host, hintElement, toolbarElement, subElement);
        if (canvas) {
            const map = document.createElement("div");
            map.className = "mindmap-view";
            map.innerHTML = '<div class="mindmap-view__viewport"><div class="mindmap-view__world">' +
                '<div class="mindmap-view__node mindmap-view__node--editing"></div></div></div>';
            map.querySelector(".mindmap-view__node").append(host);
            host.classList.add("mindmap-view__content");
            hintElement.classList.add("protyle-hint", "protyle-hint--lite-overlay");
            toolbarElement.classList.add("protyle-toolbar");
            subElement.classList.add("protyle-util");
            container.append(map);
        }
        document.body.append(container);
        const state = {
            focusedText: "",
            panTarget: undefined as Element | undefined,
            flushed: 0,
            destroyed: 0,
            finished: 0,
            saves: [] as string[],
            additions: [] as string[],
            listInputs: [] as import("./listInput").ListMindmapListInput[],
            messages: [] as string[],
            accept: true,
            flush: async (): Promise<void> => undefined,
            saveBarrier: undefined as Promise<void> | undefined,
            finishNested: async (): Promise<boolean> => true,
            uploads: [] as File[][],
        };
        const protyle = {
            block: {rootID: ""},
            upload: {isUploading: false},
            undo: {clear: noop},
            wysiwyg: {lastHTMLs: {} as Record<string, string>, flushPendingInput: async () => {
                state.flushed++;
                await state.flush();
            }},
            toolbar: {element: toolbarElement, subElement, range: undefined as Range | undefined},
        };
        const dependencies = {
            genEmptyElement: () => {
                const paragraph = document.createElement("div");
                paragraph.dataset.type = "NodeParagraph";
                paragraph.dataset.nodeId = "created";
                paragraph.innerHTML = '<div contenteditable="true"></div>';
                return paragraph;
            },
            showMessage: (message: string) => state.messages.push(message),
            escapeHtml: (value: string) => {
                const node = document.createElement("span");
                node.textContent = value;
                return node.innerHTML;
            },
            isMobile: () => false,
            hintRef: (): unknown[] => [],
            hintSlash: (): unknown[] => [],
            hintTag: (): unknown[] => [],
            registerBuiltinSlashHint: (callback: unknown) => callback,
            mountProtyleLiteFragment: (target: HTMLElement, options: {
                initialBlockHTML: string;
                onChange: () => void;
                afterSetContent: (owner: unknown, element: HTMLElement) => void;
                runtimeCapabilities: {getTransactionOwner: typeof transactionOwner};
                protyleOptions: {hint: {extend: Array<{key: string; hint: unknown}>}};
            }) => {
                const hints = options.protyleOptions.hint.extend;
                check.equal(hints.find(item => item.key === "#")?.hint, dependencies.hintTag,
                    "mindmap nodes use the built-in tag creation and search hint");
                check.ok(hints.findIndex(item => item.key === "#") < hints.findIndex(item => item.key === "/"),
                    "tag searches containing a slash retain tag hint precedence");
                transactionOwner = options.runtimeCapabilities.getTransactionOwner;
                target.style.width = "";
                wysiwyg.innerHTML = options.initialBlockHTML;
                target.append(wysiwyg);
                options.afterSetContent(protyle, wysiwyg);
                const observer = new MutationObserver(options.onChange);
                observer.observe(wysiwyg, {subtree: true, childList: true, characterData: true});
                return {
                    protyle, wysiwyg, hintElement,
                    focus: () => {
                        const target = Array.from(wysiwyg.querySelectorAll<HTMLElement>('[contenteditable="true"]'))
                            .reverse().find(item => item.getBoundingClientRect().width > 0);
                        state.focusedText = target?.textContent || "";
                    },
                    getBlockHTML: () => wysiwyg.innerHTML,
                    getMarkdown: () => wysiwyg.textContent,
                    destroy: () => {
                        destroyTabsRender(wysiwyg);
                        observer.disconnect();
                        state.destroyed++;
                    },
                };
            },
            bindLiteCodeActions: noop,
            paste: (target: typeof protyle, data: {files?: File[], target: HTMLElement}) => {
                check.equal(target, protyle);
                check.equal(data.target, wysiwyg);
                check.equal(target.block.rootID, rootID);
                check.equal(target.toolbar.range, undefined);
                state.uploads.push(data.files);
            },
            setMobileToolbarUndo: noop,
            getDefaultToolbar: (): unknown[] => [],
            hideElements: noop,
            getDefaultKeymapBindings: (item: {default?: string}) => item.default ? [item.default] : [],
            getKeymapBindings: (item: {custom?: string}) => item.custom ? [item.custom] : [],
            visitKeymapItems: (keymap: {editor: object}, visit: (item: unknown, path: string[]) => void) => {
                const walk = (value: object, path: string[]) => {
                    Object.entries(value).forEach(([key, item]) => {
                        if (item && typeof item.custom === "string") {
                            visit(item, [...path, key]);
                        } else if (item && typeof item === "object") {
                            walk(item, [...path, key]);
                        }
                    });
                };
                walk(keymap.editor, ["editor"]);
            },
            matchHotKey: (key: {custom?: string} | string, event: KeyboardEvent) => {
                const binding = typeof key === "string" ? key : key?.custom;
                return !!binding && binding.endsWith("↩") && event.key === "Enter" &&
                    event.ctrlKey === binding.includes("⌘") && event.shiftKey === binding.includes("⇧") &&
                    event.altKey === binding.includes("⌥");
            },
            processRender: noop,
            initEditorTabs: () => tabsRender(wysiwyg, {readonly: () => false}),
            setCustomBlockRootReady: noop,
            avRender: noop,
            blockRender: noop,
            highlightRender: noop,
            getUndoFocusContext: (): undefined => undefined,
            restoreFocusContext: () => false,
            finishListMindmaps: () => state.finishNested(),
            cleanListMindmapHTML: new Function(cleanupSource + "; return cleanListMindmapHTML;")(),
        };
        const open = new Function(...Object.keys(dependencies), sourceCode + "; return openListMindmapEditor;")(
            ...Object.values(dependencies));
        const owner = {app: {}, notebookId: "notebook", block: {rootID: "document"}};
        const editor = open({
            owner,
            rootID,
            node: {element}, host, replaceFirstParagraph,
            canEdit: () => element.isConnected,
            onResize: noop,
            onAdd: async (kind: string) => { state.additions.push(kind); },
            onListInput: async (input: import("./listInput").ListMindmapListInput) => { state.listInputs.push(input); },
            isPanTarget: (event: PointerEvent) => event.target === state.panTarget,
            onFinish: () => state.finished++,
            onUndo: noop,
            onSave: async (html: string) => {
                state.saves.push(html);
                await state.saveBarrier;
                if (!state.accept) {
                    return false;
                }
                element.innerHTML = html;
                return true;
            },
        });
        check.ok(editor);
        check.equal(protyle.block.rootID, rootID);
        const type = async (value: string) => {
            wysiwyg.innerHTML = textHTML(value);
            await settle();
        };
        const remove = async () => {
            editor.destroy();
            await until(() => state.destroyed === 1);
            container.remove();
        };
        return {container, element, host, wysiwyg, hintElement, protyle, state, editor, type, remove,
            owner, transactionOwner: (operations: Parameters<typeof transactionOwner>[0]) => transactionOwner(operations)};
    };
    window.siyuan = {
        languages: {listMindmapStale: "Content changed", listMindmapUnsupported: "Unsupported"},
        config: {editor: {markdown: {codeBlockMiddleDot: true}}, keymap: {editor: {
            general: {
                undo: "undo", redo: "redo",
                insertBefore: {default: "⇧⌘B", custom: "⇧⌘B"},
                insertAfter: {default: "⇧⌘A", custom: "⇧⌘A"},
            },
            list: {
                mindmapAddSibling: {default: "⌘↩", custom: "⌘↩"},
                mindmapAddChild: {default: "⇧⌘↩", custom: "⇧⌘↩"},
            },
        }}},
    } as unknown as typeof window.siyuan;

    const documentHistoryEditor = create();
    const documentHistory = document.createElement("div");
    documentHistory.className = "protyle-breadcrumb__history";
    const undoButton = document.createElement("button");
    documentHistory.append(undoButton); document.body.append(documentHistory);
    undoButton.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
    await settle();
    check.equal(documentHistoryEditor.state.finished, 0,
        "document history controls preserve the node editor until the explicit save gate runs");
    check.equal(await documentHistoryEditor.editor.finish(), true);
    check.equal(documentHistoryEditor.state.finished, 1);
    documentHistory.remove(); await documentHistoryEditor.remove();

    // 普通段落与软键盘回车走同一节点拆分路径；保留富文本、后续块和原生编辑边界。
    const listParagraph = '<div data-type="NodeParagraph" data-node-id="paragraph"><div contenteditable="true"><span data-type="strong">AlphaBeta</span></div></div>';
    for (const softKeyboard of [false, true]) {
        const current = create(listParagraph + '<div data-type="NodeParagraph" data-node-id="second"><div contenteditable="true">Second</div></div>');
        const editable = current.wysiwyg.querySelector<HTMLElement>('[contenteditable="true"]');
        const range = document.createRange();
        range.setStart(editable.firstChild.firstChild, 5);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        const event = softKeyboard ? new InputEvent("beforeinput", {inputType: "insertParagraph", bubbles: true, cancelable: true}) :
            new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true});
        editable.dispatchEvent(event);
        check.equal(event.defaultPrevented, true);
        check.equal(current.state.listInputs.length, 1);
        check.equal(current.state.listInputs[0].kind, "split");
        check.match(current.state.listInputs[0].before, /<span data-type="strong">Alpha<\/span>/);
        check.match(current.state.listInputs[0].after, /<span data-type="strong">Beta<\/span>/);
        check.match(current.state.listInputs[0].after, /data-node-id="second"/);
        check.equal(editable.textContent, "AlphaBeta", "planning does not mutate unsaved text");
        await current.remove();
    }
    for (const [key, shift, offset, expected] of [
        ["Enter", false, 0, "before"], ["Enter", false, 9, "split"],
        ["Tab", false, 3, "indent"], ["Tab", true, 3, "outdent"],
        ["Backspace", false, 0, "mergePrevious"], ["Delete", false, 9, "mergeNext"],
        ["Enter", true, 5, undefined], ["Backspace", false, 5, undefined], ["Delete", true, 9, undefined],
    ] as const) {
        const current = create(listParagraph);
        const editable = current.wysiwyg.querySelector<HTMLElement>('[contenteditable="true"]');
        const range = document.createRange();
        range.setStart(editable.firstChild.firstChild, offset);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        const event = new KeyboardEvent("keydown", {key, shiftKey: shift, bubbles: true, cancelable: true});
        editable.dispatchEvent(event);
        check.equal(current.state.listInputs[0]?.kind, expected, `${key} shift=${shift} offset=${offset}`);
        check.equal(event.defaultPrevented, !!expected);
        await current.remove();
    }
    for (const boundary of ["code-block", "table", "av", "protyle-wysiwyg__embed", "hint", "composition"]) {
        const current = create(listParagraph);
        const editable = current.wysiwyg.querySelector<HTMLElement>('[contenteditable="true"]');
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        if (boundary === "hint") current.hintElement.classList.remove("fn__none");
        else if (boundary !== "composition") editable.classList.add(boundary);
        const event = new KeyboardEvent("keydown", {key: "Enter", isComposing: boundary === "composition", bubbles: true, cancelable: true});
        editable.dispatchEvent(event);
        check.equal(event.defaultPrevented, false, boundary);
        check.equal(current.state.listInputs.length, 0, boundary);
        await current.remove();
    }
    for (const [inputType, offset, expected] of [
        ["deleteContentBackward", 0, "mergePrevious"], ["deleteContentForward", 9, "mergeNext"],
    ] as const) {
        const current = create(listParagraph);
        const editable = current.wysiwyg.querySelector<HTMLElement>('[contenteditable="true"]');
        const range = document.createRange();
        range.setStart(editable.firstChild.firstChild, offset);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        editable.dispatchEvent(new InputEvent("beforeinput", {inputType, bubbles: true, cancelable: true}));
        check.equal(current.state.listInputs[0].kind, expected);
        await current.remove();
    }
    const customized = create(listParagraph);
    const originalChildShortcut = window.siyuan.config.keymap.editor.list.mindmapAddChild.custom;
    window.siyuan.config.keymap.editor.list.mindmapAddChild.custom = "↩";
    const customizedEditable = customized.wysiwyg.querySelector<HTMLElement>('[contenteditable="true"]');
    const customizedRange = document.createRange();
    customizedRange.selectNodeContents(customizedEditable);
    customizedRange.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(customizedRange);
    customizedEditable.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    await until(() => customized.state.additions.length === 1);
    check.deepEqual(customized.state.additions, ["child"], "a configured plain Enter shortcut takes precedence over node splitting");
    check.equal(customized.state.listInputs.length, 0);
    window.siyuan.config.keymap.editor.list.mindmapAddChild.custom = originalChildShortcut;
    await customized.remove();
    for (const marker of ["```js", "~~~go", "···"]) {
        const current = create('<div data-type="NodeParagraph" data-node-id="paragraph"><div contenteditable="true"></div></div>');
        const editable = current.wysiwyg.querySelector<HTMLElement>('[contenteditable="true"]');
        editable.textContent = marker;
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        const event = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true});
        editable.dispatchEvent(event);
        check.equal(event.defaultPrevented, false, "code fences reach the existing Markdown conversion");
        check.equal(current.state.listInputs.length, 0);
        await current.remove();
    }

    // 节点编辑器透传未处理的组合快捷键，已消费的编辑操作和组合输入仍保持隔离。
    const shortcutEditor = create();
    const received: KeyboardEvent[] = [];
    shortcutEditor.container.addEventListener("keydown", event => received.push(event));
    for (const key of ["p", "f", "e"]) {
        for (const modifiers of [{ctrlKey: true}, {metaKey: true}]) {
            const event = new KeyboardEvent("keydown", {key, ...modifiers, bubbles: true, cancelable: true});
            shortcutEditor.wysiwyg.dispatchEvent(event);
            check.equal(received[received.length - 1], event);
        }
    }
    const beforeHandled = received.length;
    for (const init of [{key: "x"}, {key: "p", ctrlKey: true, isComposing: true}]) {
        shortcutEditor.wysiwyg.dispatchEvent(new KeyboardEvent("keydown", {...init, bubbles: true}));
    }
    const consumed = new KeyboardEvent("keydown", {key: "p", ctrlKey: true, bubbles: true, cancelable: true});
    consumed.preventDefault();
    shortcutEditor.wysiwyg.dispatchEvent(consumed);
    check.equal(received.length, beforeHandled);
    await shortcutEditor.remove();

    // 直接键入只替换首个段落，保留其余内容块。
    const paragraph = (id: string, html: string) =>
        `<div data-type="NodeParagraph" data-node-id="${id}" class="p"><div contenteditable="true">${html}</div></div>`;
    // 新增的直接子分支在关闭节点编辑时提交，自动保存不能先把分支 ID 写入源树。
    for (const type of ["NodeList", "NodeMindmap"]) {
        const current = create(paragraph("body", "Keep body"), undefined, "NodeMindmap");
        const branch = document.createElement("div");
        branch.dataset.type = type;
        branch.dataset.nodeId = "new-branch";
        branch.innerHTML = `<div data-node-id="new-item" data-type="${type}Item">${paragraph("child", "New child")}</div>`;
        current.wysiwyg.append(branch);
        await settle();
        const flushed = current.state.flushed;
        window.dispatchEvent(new Event("blur"));
        await until(() => current.state.flushed > flushed);
        await settle();
        check.equal(current.state.saves.length, 0, type);
        check.equal(current.element.textContent, "Keep body", "background saves retain the original source");
        check.equal(await current.editor.finish(), true, type);
        check.equal(current.state.saves.length, 1, "closing commits the branch in one content snapshot");
        check.equal(current.element.querySelector('[data-node-id="child"]').textContent, "New child");
        check.equal(current.state.finished, 1);
        check.equal(current.state.messages.length, 0);
        await current.remove();
    }
    // 旧列表脑图中的独立脑图仍属于正文，保留其后台保存能力。
    const legacyNested = create(paragraph("body", "Keep body"));
    legacyNested.wysiwyg.insertAdjacentHTML("beforeend", '<div data-type="NodeMindmap" data-node-id="nested">' +
        '<div data-type="NodeMindmapItem" data-node-id="nested-item">' + paragraph("child", "Nested body") + "</div></div>");
    await settle();
    window.dispatchEvent(new Event("blur"));
    await until(() => legacyNested.state.saves.length === 1);
    check.equal(legacyNested.element.querySelector('[data-node-id="child"]').textContent, "Nested body");
    check.equal(await legacyNested.editor.finish(), true);
    await legacyNested.remove();
    // 粘贴到选中节点时保留原正文，在当前可见正文末尾启动上传；上传结束前保留编辑器。
    const panEditor = create(paragraph("body", "Keep caret"));
    const panTarget = document.createElement("div");
    document.body.append(panTarget);
    panEditor.state.panTarget = panTarget;
    const editable = panEditor.wysiwyg.querySelector<HTMLElement>('[contenteditable="true"]');
    editable.focus();
    const panRange = document.createRange();
    panRange.setStart(editable.firstChild, 3);
    panRange.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(panRange);
    panTarget.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
    await settle();
    check.equal(panEditor.state.finished, 0, "canvas panning does not close the node editor");
    check.equal(document.activeElement, editable);
    check.equal(getSelection().anchorOffset, 3, "canvas panning retains the insertion point");
    await require("electron").ipcRenderer.invoke("mindmap-view-editor-type", "X");
    check.equal(editable.textContent, "KeeXp caret", "typing continues at the retained insertion point");
    document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
    await until(() => panEditor.state.finished === 1);
    panTarget.remove();
    await panEditor.remove();

    const imageEditor = create(paragraph("body", "Keep text"));
    const images = [new File(["image"], "image.png", {type: "image/png"})];
    imageEditor.editor.pasteClipboard({files: images});
    check.equal(imageEditor.state.focusedText, "Keep text");
    check.deepEqual(imageEditor.state.uploads, [images]);
    check.equal(imageEditor.wysiwyg.textContent, "Keep text");
    imageEditor.protyle.upload.isUploading = true;
    check.equal(await imageEditor.editor.finish(), false);
    check.equal(imageEditor.state.destroyed, 0);
    const image = document.createElement("img");
    image.src = "assets/image.png";
    imageEditor.wysiwyg.querySelector('[contenteditable="true"]').append(image);
    imageEditor.protyle.upload.isUploading = false;
    check.equal(await imageEditor.editor.finish(), true);
    check.equal(imageEditor.element.querySelector("img").getAttribute("src"), "assets/image.png");
    imageEditor.editor.pasteClipboard({files: images});
    check.equal(imageEditor.state.uploads.length, 1, "closed editors do not accept another upload");
    await imageEditor.remove();
    for (const resized of [false, true]) {
        const current = create('<div data-node-id="image-body" data-type="NodeParagraph"><span data-type="img" class="img">' +
            '<span class="protyle-image-container" style="width: 180px;"><img src="assets/image.png" alt="description"></span></span></div>');
        const image = current.wysiwyg.querySelector("img");
        image.closest(".img").classList.add("img--select", "img--drag");
        image.parentElement.classList.add("protyle-image-container--compact");
        image.parentElement.insertAdjacentHTML("beforeend", '<span class="protyle-image-resize"><span class="touch-resize-active"></span></span>');
        if (resized) {
            image.parentElement.style.width = "140px";
        }
        check.equal(await current.editor.finish(), true);
        check.equal(current.state.saves.length, resized ? 1 : 0, "image UI changes alone do not create a content save");
        check.equal(current.element.querySelector(".img--select, .img--drag, .protyle-image-resize, .protyle-image-container--compact"), null);
        check.equal(current.element.querySelector("img").parentElement.style.width, resized ? "140px" : "180px");
        await current.remove();
    }
    // 关闭等待内层编辑结束时启动上传，也不能提前销毁外层编辑器。
    const uploadingEditor = create();
    const nestedGate = gate();
    uploadingEditor.state.finishNested = () => nestedGate.promise.then(() => true);
    const finishBeforeUpload = uploadingEditor.editor.finish();
    uploadingEditor.protyle.upload.isUploading = true;
    nestedGate.release();
    check.equal(await finishBeforeUpload, false);
    check.equal(uploadingEditor.state.destroyed, 0);
    uploadingEditor.protyle.upload.isUploading = false;
    check.equal(await uploadingEditor.editor.finish(), true);
    await uploadingEditor.remove();
    for (const active of ["first", "second"]) {
        const tabs = create(`<div class="tabs" data-type="NodeTabs" data-node-id="tabs" tabs-active-id="${active}">
            ${["first", "second"].map(id => `<div class="tab-item" data-type="NodeTabItem" data-node-id="${id}">
                <div class="tab-item-info"><div class="tab-item-title">${id}</div></div>
                <div class="tab-item-content">${paragraph(id + "-body", id)}</div></div>`).join("")}</div>`);
        check.equal(tabs.state.focusedText, active, "opening an editor focuses the active tab instead of the last tab");
        check.equal(tabs.wysiwyg.querySelector(".tabs").getAttribute("tabs-active-id"), active);
        await tabs.remove();
    }
    let typed = create(paragraph("first", "Old <strong>rich</strong>") +
        paragraph("second", "Keep") + '<div data-type="NodeThematicBreak" data-node-id="special"></div>', "N");
    check.equal(typed.wysiwyg.querySelector('[data-node-id="first"] > [contenteditable="true"]').textContent, "N");
    check.equal(typed.wysiwyg.querySelector('[data-node-id="second"] > [contenteditable="true"]').textContent, "Keep");
    await typed.editor.finish();
    check.equal(typed.element.querySelector('[data-node-id="first"] > [contenteditable="true"]').textContent, "N");
    check.equal(typed.element.querySelector('[data-node-id="second"] > [contenteditable="true"]').textContent, "Keep");
    check.ok(typed.element.querySelector('[data-node-id="special"]'));
    await typed.remove();

    // 首个正文不是段落时，在其前面新建段落，不改写特殊块。
    typed = create('<div data-type="NodeThematicBreak" data-node-id="special"></div>', "Z");
    check.equal(typed.wysiwyg.firstElementChild.getAttribute("data-type"), "NodeParagraph");
    check.equal(typed.wysiwyg.firstElementChild.textContent, "Z");
    await typed.editor.finish();
    check.ok(typed.element.querySelector('[data-node-id="special"]'));
    await typed.remove();

    // 特殊块与普通文字共存时仍可进入编辑，修改文字不会改变特殊块的源码和属性。
    for (const type of ["NodeThematicBreak", "NodeTable", "NodeAttributeView", "NodeBlockQueryEmbed",
        "NodeCustomBlock", "NodeHTMLBlock", "NodeIFrame", "NodeWidget", "NodeVideo", "NodeAudio",
        "NodeCallout", "NodeSuperBlock", "NodeTabs"]) {
        const special = document.createElement("div");
        special.dataset.type = type;
        special.dataset.nodeId = "special";
        special.dataset.content = "Raw source & attributes";
        special.setAttribute("custom-preserve", "Original value");
        special.textContent = "Preserved content";
        const current = create(textHTML("Initial") + special.outerHTML);
        current.wysiwyg.firstElementChild.textContent = "Edited text";
        await settle();
        check.equal(await current.editor.finish(), true, type);
        check.equal(current.element.firstElementChild.textContent, "Edited text", type);
        check.equal(current.element.lastElementChild.outerHTML, special.outerHTML, type);
        check.equal(current.state.messages.length, 0, type);
        await current.remove();
    }

    // 页签重新渲染和切换编辑状态不会伪造正文冲突，隐藏页签的内容仍参与冲突检测。
    const tabsHTML = '<div data-type="NodeTabs" data-node-id="tabs" class="tabs" tabs-position="top">' +
        '<div data-type="NodeTabItem" data-node-id="tab" class="tab-item"><div class="tab-item-info">Title</div>' +
        '<div class="tab-item-content">' + textHTML("Body") + "</div></div></div>";
    const tabsEditor = create(tabsHTML);
    tabsEditor.element.firstElementChild.insertAdjacentHTML("afterbegin", '<div class="tabs-header">Navigation</div>');
    tabsEditor.element.querySelector(".tab-item-content").setAttribute("id", "siyuan-tabs-1-panel-0");
    tabsEditor.wysiwyg.querySelector(".tab-item-content").setAttribute("id", "siyuan-tabs-2-panel-0");
    tabsEditor.wysiwyg.querySelector(".tab-item").setAttribute("data-tabs-editing", "true");
    tabsEditor.wysiwyg.querySelector('[data-node-id="paragraph"]').textContent = "Edited body";
    await settle();
    check.equal(await tabsEditor.editor.finish(), true);
    check.equal(tabsEditor.state.messages.length, 0);
    check.equal(tabsEditor.element.querySelector('[data-node-id="paragraph"]').textContent, "Edited body");
    check.equal(tabsEditor.element.querySelector(".tabs").getAttribute("tabs-position"), "top");
    await tabsEditor.remove();
    const nestedEditor = create(tabsHTML);
    nestedEditor.state.finishNested = async () => false;
    check.equal(await nestedEditor.editor.finish(), false);
    check.equal(nestedEditor.state.destroyed, 0, "failed nested saves keep the outer editor open");
    nestedEditor.state.finishNested = async () => {
        nestedEditor.wysiwyg.querySelector('[data-node-id="paragraph"]').textContent = "Nested edit";
        return true;
    };
    check.equal(await nestedEditor.editor.finish(), true);
    check.equal(nestedEditor.element.querySelector('[data-node-id="paragraph"]').textContent, "Nested edit");
    await nestedEditor.remove();

    const nestedKeys = create(tabsHTML);
    const nestedView = document.createElement("div");
    nestedView.className = "mindmap-view";
    nestedView.tabIndex = 0;
    nestedKeys.wysiwyg.append(nestedView);
    nestedView.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    nestedView.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
    await settle();
    check.equal(nestedKeys.state.finished, 0, "nested shortcuts must not finish the outer editor");
    check.deepEqual(nestedKeys.state.additions, []);
    await nestedKeys.remove();
    const conflictingTabs = create(tabsHTML);
    conflictingTabs.element.querySelector('[data-node-id="paragraph"]').textContent = "External change";
    conflictingTabs.wysiwyg.querySelector('[data-node-id="paragraph"]').textContent = "Local change";
    await settle();
    check.equal(await conflictingTabs.editor.finish(), false);
    check.equal(conflictingTabs.state.saves.length, 0);
    await conflictingTabs.remove();

    // 数据库和嵌入结果在编辑期间重新渲染，不会挡住普通文字保存或覆盖新的独立块状态。
    for (const [type, embedded] of ["NodeAttributeView", "NodeBlockQueryEmbed"].flatMap(type =>
        [false, true].map(embedded => [type, embedded] as const))) {
        const special = document.createElement("div");
        special.dataset.type = type;
        special.dataset.nodeId = "special";
        if (type === "NodeAttributeView") {
            special.dataset.avId = "database";
        } else {
            special.dataset.content = "select * from blocks";
        }
        special.textContent = "Old projection";
        const current = create(textHTML("Initial") + special.outerHTML, undefined, "NodeList", embedded);
        current.element.lastElementChild.setAttribute("updated", "20260923120000");
        current.element.lastElementChild.textContent = "Latest projection";
        current.wysiwyg.lastElementChild.setAttribute("data-render", "true");
        current.wysiwyg.lastElementChild.textContent = "Editor projection";
        await settle();
        current.wysiwyg.firstElementChild.textContent = "Edited text";
        await settle();
        check.equal(await current.editor.finish(), true, type);
        check.equal(current.element.firstElementChild.textContent, "Edited text", type);
        check.equal(current.element.lastElementChild.textContent, "Latest projection", type);
        check.equal(current.state.messages.length, 0, type);
        await current.remove();
    }

    // 嵌套在超级块中的数据库要沿用最新属性，避免保存相邻文字时写回旧视图配置。
    let nested = create(textHTML("Initial") +
        '<div data-type="NodeSuperBlock" data-node-id="container"><div data-type="NodeAttributeView" ' +
        'data-node-id="nested-database" data-av-id="database" custom-sy-av-view="old">Old projection</div></div>');
    nested.element.querySelector('[data-node-id="nested-database"]').setAttribute("custom-sy-av-view", "new");
    nested.wysiwyg.firstElementChild.textContent = "Edited text";
    await settle();
    check.equal(await nested.editor.finish(), true);
    check.equal(nested.element.querySelector('[data-node-id="nested-database"]').getAttribute("custom-sy-av-view"), "new");
    await nested.remove();

    // 嵌入源块的拆分和删除与文字更新使用同一外层事务，普通节点正文仍留在片段中保存。
    nested = create(textHTML("Initial") +
        '<div data-type="NodeBlockQueryEmbed" data-node-id="embed" data-content="query"><div ' +
        'class="protyle-wysiwyg__embed" data-id="source"><div data-type="NodeParagraph" ' +
        'data-node-id="source">Source</div></div></div>');
    await settle();
    const result = nested.wysiwyg.querySelector(".protyle-wysiwyg__embed");
    result.insertAdjacentHTML("beforeend", '<div data-type="NodeParagraph" data-node-id="new-source">New</div>');
    check.equal(nested.transactionOwner([{action: "update", id: "source"},
        {action: "insert", id: "new-source", previousID: "source"}]), nested.owner);
    result.querySelector('[data-node-id="new-source"]').remove();
    check.equal(nested.transactionOwner([{action: "delete", id: "new-source"}]), nested.owner);
    check.equal(nested.transactionOwner([{action: "insert", id: "first-source", parentID: "source"}]), nested.owner);
    check.equal(nested.transactionOwner([{action: "update", id: "paragraph"}]), undefined);
    await nested.remove();

    // 数据库浮层属于当前节点时保留编辑会话，其他位置的点击仍正常结束编辑。
    for (const overlayClass of ["av__panel", "av__mask av__richtext-mask"]) {
        const current = create(textHTML("Initial") +
            '<div data-type="NodeAttributeView" data-node-id="database" data-av-id="view"></div>');
        const overlay = document.createElement("div");
        overlay.className = overlayClass;
        overlay.dataset.avBlockId = "database";
        document.body.append(overlay);
        overlay.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        await settle();
        check.equal(current.state.destroyed, 0, overlayClass);
        overlay.dataset.avBlockId = "other-database";
        overlay.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        await until(() => current.state.destroyed === 1);
        overlay.remove();
        await current.remove();
    }

    // 查询源码本身发生外部修改时仍视为冲突，避免旧编辑会话覆盖新查询。
    let current = create(textHTML("Initial") +
        '<div data-type="NodeBlockQueryEmbed" data-node-id="special" data-content="old query"></div>');
    current.wysiwyg.firstElementChild.textContent = "Local text";
    current.element.lastElementChild.setAttribute("data-content", "new query");
    check.equal(await current.editor.finish(), false);
    check.equal(current.state.saves.length, 0);
    await current.remove();

    // 浏览器将输入事件派发给编辑器根节点时，也要为嵌入源块保存有效的撤销快照。
    current = create(textHTML("Initial") +
        '<div data-type="NodeBlockQueryEmbed" data-node-id="special" data-content="query"><div class="protyle-wysiwyg__embed"><div data-node-id="source" data-type="NodeParagraph"><div contenteditable="true">Source</div></div></div></div>');
    const sourceBlock = current.wysiwyg.querySelector<HTMLElement>('[data-node-id="source"]');
    const range = document.createRange();
    range.selectNodeContents(sourceBlock.firstElementChild);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    current.wysiwyg.dispatchEvent(new InputEvent("beforeinput", {bubbles: true, inputType: "insertText", data: " edited"}));
    check.equal(current.protyle.wysiwyg.lastHTMLs.source, sourceBlock.outerHTML);
    await current.remove();

    // 关闭前等待输入转换完成，保存转换后的最终内容后再销毁编辑器。
    current = create();
    check.equal(current.host.offsetWidth, 120, "mounting the editor preserves the preview width");
    await current.type("Pending");
    const flushGate = gate();
    current.state.flush = async () => {
        await flushGate.promise;
        current.wysiwyg.innerHTML = textHTML("Final after flush");
    };
    const finishing = current.editor.finish();
    check.equal(current.editor.finish(), finishing);
    await settle();
    check.equal(current.state.saves.length, 0);
    check.equal(current.state.destroyed, 0);
    flushGate.release();
    check.equal(await finishing, true);
    check.equal(current.element.textContent, "Final after flush");
    check.equal(current.state.destroyed, 1);
    check.equal(current.state.finished, 1);
    check.equal(current.host.style.minWidth, "36px", "closing restores the original minimum width");
    check.equal(current.state.saves.length, 1);
    await current.remove();

    // 保存失败时保留正文和编辑器，允许下一次关闭重新提交。
    current = create();
    await current.type("Retry me");
    current.state.accept = false;
    check.equal(await current.editor.finish(), false);
    check.equal(current.state.destroyed, 0);
    check.equal(current.state.finished, 0);
    check.equal(current.wysiwyg.textContent, "Retry me");
    check.equal(current.element.textContent, "Initial");
    current.state.accept = true;
    check.equal(await current.editor.finish(), true);
    check.equal(current.element.textContent, "Retry me");
    await current.remove();

    // 输入法组合期间拒绝关闭，组合结束后完成保存和延迟关闭。
    current = create();
    current.host.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    await current.type("Composing");
    check.equal(await current.editor.finish(), false);
    check.equal(current.state.saves.length, 0);
    check.equal(current.state.destroyed, 0);
    await current.type("Composition complete");
    current.host.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    await until(() => current.state.destroyed === 1);
    check.equal(current.element.textContent, "Composition complete");
    check.equal(current.state.finished, 1);
    await current.remove();

    // 外部改动不能被旧会话覆盖，未保存正文保留在可恢复提示中。
    current = create();
    await current.type("Unsaved local content");
    current.element.innerHTML = textHTML("External content");
    check.equal(await current.editor.finish(), false);
    check.equal(current.element.textContent, "External content");
    check.equal(current.state.saves.length, 0);
    check.equal(current.state.destroyed, 0);
    check.ok(current.state.messages.some(message => message.includes("Unsaved local content")));
    await current.remove();

    // 强制卸载也要排空输入任务，并保留尚未写回的最终正文供恢复。
    current = create();
    await current.type("Before destroy");
    const destroyGate = gate();
    current.state.flush = async () => {
        await destroyGate.promise;
        current.wysiwyg.innerHTML = textHTML("Final before destroy");
    };
    current.editor.destroy();
    await settle();
    check.equal(current.state.destroyed, 0);
    destroyGate.release();
    await until(() => current.state.destroyed === 1);
    check.equal(current.element.textContent, "Initial");
    check.ok(current.state.messages.some(message => message.includes("Final before destroy")));
    await current.remove();

    // 保存等待期间继续输入，随后关闭必须保存后续文字，不能被旧请求清除变更标记。
    current = create();
    await current.type("First save");
    const saveGate = gate();
    current.state.saveBarrier = saveGate.promise;
    window.dispatchEvent(new Event("blur"));
    await until(() => current.state.saves.length === 1);
    await current.type("Typed during save");
    saveGate.release();
    await settle();
    check.equal(await current.editor.finish(), true);
    check.equal(current.element.textContent, "Typed during save");
    check.equal(current.state.destroyed, 1);
    await current.remove();

    // Esc 成功保存后恢复脑图焦点；保存失败时仍留在节点编辑器。
    for (const accept of [false, true]) {
        current = create();
        current.container.className = "mindmap-view";
        current.container.tabIndex = -1;
        current.host.tabIndex = -1;
        current.host.focus();
        current.state.accept = accept;
        await current.type("Escape content");
        current.host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await until(() => accept ? current.state.finished === 1 : current.state.saves.length === 1);
        await settle();
        check.equal(document.activeElement, accept ? current.container : current.host);
        await current.remove();
    }

    // 编辑态组合键保存当前节点后直接创建新节点，重复按键只创建一次。
    for (const [kind, shiftKey] of [["sibling", false], ["child", true]] as const) {
        current = create();
        await current.type(`Edited ${kind}`);
        const shortcut = () => current.host.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", ctrlKey: true, shiftKey, bubbles: true, cancelable: true,
        }));
        shortcut();
        const repeated = new KeyboardEvent("keydown", {
            key: "Enter", ctrlKey: true, shiftKey, repeat: true, bubbles: true, cancelable: true,
        });
        current.host.dispatchEvent(repeated);
        check.equal(repeated.defaultPrevented, true);
        shortcut();
        await until(() => current.state.additions.length === 1);
        check.deepEqual(current.state.additions, [kind]);
        check.equal(current.element.textContent, `Edited ${kind}`);
        check.equal(current.state.finished, 1);
        await current.remove();
    }

    // 用户为其他编辑命令新增相同绑定时，按键交给节点内部编辑器处理。
    for (const [action, kind, binding, shiftKey] of [
        ["insertAfter", "sibling", "⌘↩", false],
        ["insertBefore", "child", "⇧⌘↩", true],
    ] as const) {
        current = create();
        const keymap = window.siyuan.config.keymap.editor.general[action];
        keymap.custom = binding;
        let innerKeydowns = 0;
        current.wysiwyg.addEventListener("keydown", () => innerKeydowns++);
        const shortcut = () => {
            const event = new KeyboardEvent("keydown", {
                key: "Enter", ctrlKey: true, shiftKey, bubbles: true, cancelable: true,
            });
            current.wysiwyg.dispatchEvent(event);
            return event;
        };
        check.equal(shortcut().defaultPrevented, false, action);
        check.equal(innerKeydowns, 1, action);
        check.deepEqual(current.state.additions, [], action);
        keymap.custom = keymap.default;
        check.equal(shortcut().defaultPrevented, true, kind);
        await until(() => current.state.additions.length === 1);
        check.deepEqual(current.state.additions, [kind]);
        check.equal(innerKeydowns, 1, kind);
        await current.remove();
    }

    // 保存失败时不得新增节点；修正后再次按快捷键可以完成操作。
    current = create();
    await current.type("Retry shortcut");
    current.state.accept = false;
    current.host.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
    await until(() => current.state.saves.length === 1);
    await settle();
    check.deepEqual(current.state.additions, []);
    check.equal(current.state.finished, 0);
    current.state.accept = true;
    current.host.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
    await until(() => current.state.additions.length === 1);
    check.deepEqual(current.state.additions, ["sibling"]);
    await current.remove();

    // 提示弹层、输入法组合输入和嵌套输入控件保留原有按键行为。
    current = create();
    current.hintElement.classList.remove("fn__none");
    current.host.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
    current.hintElement.classList.add("fn__none");
    current.host.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    current.host.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
    current.host.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    const nestedInput = document.createElement("input");
    current.host.append(nestedInput);
    nestedInput.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
    await settle();
    check.deepEqual(current.state.additions, []);
    check.equal(current.state.finished, 0);
    await current.remove();

    // 快捷键读取用户配置，修改绑定后旧按键不再触发。
    current = create();
    window.siyuan.config.keymap.editor.list.mindmapAddSibling.custom = "⌥⌘↩";
    current.host.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
    check.equal(current.state.finished, 0);
    current.host.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", ctrlKey: true, altKey: true, bubbles: true,
    }));
    await until(() => current.state.additions.length === 1);
    check.deepEqual(current.state.additions, ["sibling"]);
    window.siyuan.config.keymap.editor.list.mindmapAddSibling.custom = "⌘↩";
    await current.remove();

    // 使用完整样式和外层文档结构，覆盖嵌套编辑器的最小高度及行高继承。
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    // 编辑浮层挂载在未缩放的脑图根元素，跨过画布边界时仍可点击。
    for (const fullscreen of [false, true]) {
        for (const scale of [1, .75]) {
            const current = create(textHTML("Paint isolation"), undefined, "NodeMindmap", false, true);
            current.container.style.cssText = "position:fixed;top:40px;left:40px;width:500px";
            const map = current.host.closest<HTMLElement>(".mindmap-view");
            map.classList.toggle("fullscreen", fullscreen);
            const viewport = map.querySelector<HTMLElement>(".mindmap-view__viewport");
            map.querySelector<HTMLElement>(".mindmap-view__world").style.transform = `translate(30px, 30px) scale(${scale})`;
            const overlays = [current.hintElement, current.protyle.toolbar.element, current.protyle.toolbar.subElement];
            for (const overlay of overlays) {
                check.equal(overlay.parentElement, map, "editor overlays stay outside the isolated viewport");
                const bounds = viewport.getBoundingClientRect();
                const top = fullscreen ? bounds.bottom - 48 : bounds.bottom - 8;
                overlay.style.cssText = `position:fixed;left:${bounds.left + 20}px;top:${top}px;` +
                    "width:140px;height:36px;min-height:0;max-height:none;display:block;z-index:10";
                overlay.classList.remove("fn__none");
                const rect = overlay.getBoundingClientRect();
                check.ok(Math.abs(rect.left - bounds.left - 20) < 1 && Math.abs(rect.top - top) < 1,
                    "world zoom does not change editor overlay coordinates");
                check.ok(overlay.contains(document.elementFromPoint(rect.left + 10, rect.bottom - 5)),
                    "editor controls remain clickable outside the canvas and in fullscreen");
                overlay.classList.add("fn__none");
            }
            await current.type("Edited with paint isolation");
            check.equal(await current.editor.finish(), true);
            check.ok(current.element.textContent.includes("Edited with paint isolation"), "editing still saves source content");
            await current.remove();
        }
    }
    const fixture = document.createElement("div");
    fixture.className = "protyle-wysiwyg";
    document.body.append(fixture);
    fixture.innerHTML = '<div class="mindmap-view"><div class="mindmap-view__node"><div class="mindmap-view__content">' +
        '<div class="p mindmap-view__preview-block">Normal</div>' +
        '<div class="bq mindmap-view__preview-block" data-type="NodeBlockquote"><div class="p mindmap-view__preview-block">Quote</div></div>' +
        '<div class="h1 mindmap-view__preview-block" data-type="NodeHeading">Heading</div>' +
        "</div></div></div>";
    const quote = fixture.querySelector<HTMLElement>(".bq");
    check.equal(getComputedStyle(quote).position, "relative", "quote decoration is anchored to the quote block");
    check.ok(parseFloat(getComputedStyle(quote).paddingLeft) > 4, "quote keeps shared indentation");
    check.ok(parseFloat(getComputedStyle(fixture.querySelector(".h1")).fontSize) >
        parseFloat(getComputedStyle(fixture.querySelector(".p")).fontSize), "heading keeps shared font size");
    for (const [text, task] of ["", "Test text", '<span data-type="strong">11pppppp</span>', "First<br>Second", "First\nSecond",
        '<span data-type="strong">1水电费ppppp</span>', '<span data-type="strong">1水电费pppppp</span>']
        .flatMap(text => [[text, false], [text, true]] as const)) {
        fixture.innerHTML = `<div data-node-id="list" data-type="NodeList"><div class="mindmap-view"><div class="mindmap-view__node"><div class="mindmap-view__content"><div class="p mindmap-view__preview-block" data-type="NodeParagraph"><div class="mindmap-view__text">${text}</div></div></div></div></div></div>`;
        const node = fixture.querySelector<HTMLElement>(".mindmap-view__node");
        if (task) {
            node.dataset.task = " ";
            const button = document.createElement("button");
            button.className = "protyle-action protyle-action--task mindmap-view__task";
            button.innerHTML = '<svg><use xlink:href="#iconUncheck"></use></svg>';
            node.prepend(button);
        }
        const content = fixture.querySelector<HTMLElement>(".mindmap-view__content");
        const before = {width: node.offsetWidth, height: node.offsetHeight};
        if (text === "Test text") {
            check.equal(before.height, 32, "single-line previews do not inherit extra block spacing");
        }
        const preview = content.innerHTML;
        for (const scale of [1, 0.65, 1.5]) {
            fixture.style.transform = `scale(${scale})`;
            content.style.minWidth = getComputedStyle(content).width;
            content.classList.add("mindmap-view__editor", "protyle");
            content.innerHTML = `<div class="protyle-content" data-padding-mode="responsive" data-device="desktop"><div class="protyle-wysiwyg" spellcheck="false" contenteditable="true"><div class="p" data-node-id="text" data-type="NodeParagraph"><div contenteditable="true" spellcheck="false">${text}</div></div></div></div>`;
            check.deepEqual({width: node.offsetWidth, height: node.offsetHeight}, before,
                "entering edit mode preserves node dimensions with responsive padding and canvas zoom");
            content.style.minWidth = "";
            const editable = content.querySelector<HTMLElement>('[data-type="NodeParagraph"] > div');
            check.ok(editable.getBoundingClientRect().width > 0, JSON.stringify({text, task, scale,
                nodeWidth: node.offsetWidth, contentWidth: content.offsetWidth,
                contentMinWidth: getComputedStyle(content).minWidth,
                columns: getComputedStyle(node).gridTemplateColumns}));
            const beforeInput = editable.textContent;
            editable.focus();
            const range = document.createRange();
            range.selectNodeContents(editable);
            range.collapse(false);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            await require("electron").ipcRenderer.invoke("mindmap-view-editor-type", "a");
            check.equal(editable.textContent, beforeInput + "a", "focused node content accepts native text input");
            editable.textContent = "A longer sentence that expands the node while editing";
            const expandedWidth = node.offsetWidth;
            check.ok(expandedWidth > before.width, "typing expands the editor before blur");
            check.ok(expandedWidth <= 300, "editing respects the existing maximum width");
            editable.textContent = "A";
            check.ok(node.offsetWidth < expandedWidth, "deleting text shrinks the editor before blur");
            content.classList.remove("mindmap-view__editor", "protyle");
            content.style.minWidth = "";
            content.innerHTML = preview;
            check.deepEqual({width: node.offsetWidth, height: node.offsetHeight}, before,
                "repeated editing does not change preview dimensions");
        }
    }
    // 百分比宽度的内层画布不能在按内容撑开的节点中塌缩，缩放和大字号也保持可操作宽度。
    for (const type of ["NodeList", "NodeMindmap"]) {
        for (const fontSize of [16, 32]) {
            fixture.style.fontSize = `${fontSize}px`;
            fixture.innerHTML = '<div class="mindmap-view"><div class="mindmap-view__viewport"><div class="mindmap-view__world">' +
                '<div class="mindmap-view__node mindmap-view__node--editing"><div class="mindmap-view__content mindmap-view__editor protyle">' +
                '<div class="protyle-content" data-padding-mode="responsive"><div class="protyle-wysiwyg" spellcheck="false">' +
                `<div data-type="${type}" class="${type === "NodeList" ? "list" : "mindmap"}" data-mindmap-view-rendered="true">` +
                '<div class="mindmap-view"><div class="mindmap-view__toolbar block__icons"></div>' +
                '<div class="mindmap-view__viewport"><div class="mindmap-view__world"></div></div></div>' +
                "</div></div></div></div></div></div></div></div>";
            const node = fixture.querySelector<HTMLElement>(".mindmap-view__node--editing");
            const nested = fixture.querySelector<HTMLElement>(".mindmap-view__editor .mindmap-view");
            for (const device of ["desktop", "mobile"]) {
                fixture.style.width = device === "mobile" ? "320px" : "800px";
                fixture.querySelector<HTMLElement>(".protyle-content").dataset.device = device;
                for (const scale of [1, 0.65, 1.5]) {
                    fixture.style.transform = `scale(${scale})`;
                    check.ok(nested.offsetWidth >= 260, "nested canvases retain a usable intrinsic width");
                    check.ok(node.offsetWidth <= 300, "nested canvases respect the node width limit");
                }
            }
        }
    }
    fixture.remove();
    style.remove();
    return "List mindmap editor lifecycle cases passed";
};

test("list mindmap editor flushes pending input and preserves text across finish, composition and destroy", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-view-editor-test-"));
    const script = path.join(temporary, "run.cjs");
    const source = transpileModule(["../../wysiwyg/codeBlockEnter.ts", "editor.ts"]
        .map(file => readFileSync(path.join(__dirname, file), "utf8")).join("\n")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const css = require("sass").compile(path.resolve(__dirname, "../../../assets/scss/base.scss"), {
        logger: require("sass").Logger.silent,
    }).css;
    const modelSource = readFileSync(path.join(__dirname, "model.ts"), "utf8");
    const cleanupSource = transpileModule(modelSource.slice(modelSource.indexOf("const cleanListMindmapDOM ="),
        modelSource.indexOf("// 转换前将思维导图块还原为列表结构"))
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const tabsSource = ["../../../util/escape.ts", "../tabsState.ts", "../tabsDrag.ts", "../tabsAttributes.ts", "../tabsVisibility.ts", "../tabsRender.ts"]
        .map(file => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText).join("\n");
    const code = `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    ipcMain.handle("mindmap-view-editor-type", async (_event, text) => {
        await win.webContents.insertText(text);
    });
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        const result = await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(css)}, ${JSON.stringify(cleanupSource)}, ${JSON.stringify(tabsSource)})`)});
        console.log(result);
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`;
    writeFileSync(script, code, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const executable = require("electron") as unknown as string;
        const result = await promisify(execFile)(executable, [script], {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /List mindmap editor lifecycle cases passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
