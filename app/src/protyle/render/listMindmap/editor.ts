import {showMessage} from "../../../dialog/message";
import {escapeHtml} from "../../../util/escape";
import {isMobile} from "../../../util/functions";
import {hintRef, hintSlash} from "../../hint/extend";
import {registerBuiltinSlashHint} from "../../hint/builtinSlash";
import {mountProtyleLiteFragment} from "../../lite/fragmentEditor";
import {bindLiteCodeActions} from "../../lite/codeActions";
import {setMobileToolbarUndo} from "../../lite/mobileToolbar";
import {getDefaultToolbar} from "../../toolbar/defaults";
import {hideElements} from "../../ui/hideElements";
import {matchHotKey} from "../../util/hotKey";
import {TABLE_CELL_SLASH_IDS} from "../../util/tableCellRichMenu";
import {
    configureAVRichTextLute, getAVRichTextLute, getAVRichTextUnsupportedPasteBlocks, sanitizeAVRichTextBlockDOM,
} from "../av/richText";
import {highlightRender} from "../highlightRender";
import {mathRender} from "../mathRender";
import {cleanListMindmapHTML} from "./model";
import type {ListMindmapNode} from "./model";

interface ListMindmapEditorOptions {
    owner: IProtyle;
    node: ListMindmapNode;
    host: HTMLElement;
    canEdit: () => boolean;
    onSave: (html: string) => Promise<boolean>;
    onResize: () => void;
    onFinish: () => void;
    onUndo: (redo: boolean) => void;
}

const nodeContent = (node: ListMindmapNode) => Array.from(node.element?.children || []).filter(child =>
    child.hasAttribute("data-node-id") && child.getAttribute("data-type") !== "NodeList")
    .map(child => cleanListMindmapHTML(child.outerHTML)).join("");

// 编辑器只在双击时挂载到节点内容区，预览与编辑沿用同一尺寸和排版。
export const openListMindmapEditor = (options: ListMindmapEditorOptions) => {
    const {owner, node, host} = options;
    const initialBlockHTML = nodeContent(node);
    if (!options.canEdit() || !node.element?.isConnected) {
        return;
    }
    if (getAVRichTextUnsupportedPasteBlocks(initialBlockHTML, true).length) {
        showMessage(window.siyuan.languages.listMindmapUnsupported);
        return;
    }
    hideElements(["gutter", "toolbar", "hint"], owner);
    let finished = false;
    let closing = false;
    let composing = false;
    let finishAfterComposition = false;
    let changed = false;
    let saving = false;
    let pendingSave: Promise<boolean> | undefined;
    let pendingFinish: Promise<boolean> | undefined;
    let saveTimer: number;
    let source = initialBlockHTML;
    let recoveryShown = false;
    const events = new AbortController();
    const toolbar = getDefaultToolbar(isMobile()).filter(item =>
        typeof item === "string" ? item !== "ai" : item.name !== "ai");
    const slash = registerBuiltinSlashHint((key: string, protyle: IProtyle, hintSource: THintSource) =>
        hintSlash(key, protyle, hintSource).filter(item => TABLE_CELL_SLASH_IDS.has(item.id) &&
            !["list", "orderedList", "check"].includes(item.id)));
    const hint: IProtyleOptions["hint"] = {
        extend: [{key: "((", hint: hintRef}, {key: "【【", hint: hintRef}, {key: "（（", hint: hintRef},
            {key: "[[", hint: hintRef}, {key: "/", hint: slash}, {key: "、", hint: slash}],
    };
    const originalMinWidth = host.style.minWidth;
    // 保留未缩放的亚像素宽度，避免取整后响应式容器挤压文字，导致换行和整棵树重排。
    host.style.minWidth = getComputedStyle(host).width;
    host.replaceChildren();
    host.classList.add("list-mindmap__editor");
    host.dataset.protyleLiteRender = "safe";
    host.contentEditable = "false";
    const fragment = mountProtyleLiteFragment(host, {
        app: owner.app,
        initialBlockHTML,
        protyleOptions: {notebookId: owner.notebookId, toolbar, hint},
        runtimeCapabilities: {
            upload: false, websocket: false, pluginExtensions: false, customBlockRender: false,
            listItemFragment: true,
            lute: getAVRichTextLute(), lockedOptions: {toolbar, hint},
            sanitizeBlockDOM: html => sanitizeAVRichTextBlockDOM(html, true),
            getUnsupportedPasteBlocks: html => getAVRichTextUnsupportedPasteBlocks(html, true),
            restoreLuteMarkdownSyntax: configureAVRichTextLute,
        },
        afterSetContent: (protyle, element) => {
            highlightRender(element);
            mathRender(element);
            protyle.undo.clear();
        },
        onChange: () => {
            if (finished || closing) {
                return;
            }
            changed = true;
            host.style.minWidth = originalMinWidth;
            options.onResize();
            if (saving) {
                return;
            }
            clearTimeout(saveTimer);
            saveTimer = window.setTimeout((): void => { void commit(); }, 350);
        },
    });
    fragment.protyle.block.rootID = owner.block.rootID;
    const overlays = [fragment.hintElement, fragment.protyle.toolbar.element, fragment.protyle.toolbar.subElement];
    const overlayRoot = host.closest(".list-mindmap") || document.body;
    // 菜单使用未缩放的容器定位，同时保持在原生全屏元素内可见。
    overlays.forEach(element => overlayRoot.appendChild(element));
    let lastHTML = cleanListMindmapHTML(fragment.getBlockHTML());
    const recover = () => {
        if (recoveryShown) {
            return;
        }
        recoveryShown = true;
        // 原节点被外部事务替换时保留尚未提交的正文，避免覆盖新内容或静默丢弃输入。
        showMessage(`${escapeHtml(window.siyuan.languages.listMindmapStale)}<pre>${escapeHtml(fragment.getMarkdown())}</pre>`,
            0, "error");
    };
    const commit = (finishSession = false): Promise<boolean> => {
        if (pendingSave) {
            return pendingSave;
        }
        pendingSave = save(finishSession).catch(error => {
            console.error(error);
            showMessage(window.siyuan.languages.listMindmapInvalid);
            return false;
        }).finally(() => {
            pendingSave = undefined;
        });
        return pendingSave;
    };
    const save = async (finishSession: boolean) => {
        clearTimeout(saveTimer);
        if (finished || closing || composing || saving) {
            return false;
        }
        await fragment.protyle.wysiwyg.flushPendingInput();
        if (finished || composing) {
            return false;
        }
        // 输入的新列表在结束本次编辑时转换为子节点，避免在连续输入中移走正在编辑的正文。
        if (!finishSession && Array.from(fragment.wysiwyg.children).some(element =>
            element.getAttribute("data-type") === "NodeList")) {
            return false;
        }
        const html = cleanListMindmapHTML(fragment.getBlockHTML());
        if (html === lastHTML) {
            changed = false;
            return true;
        }
        if (!options.canEdit() || !node.element.isConnected || nodeContent(node) !== source) {
            recover();
            return false;
        }
        saving = true;
        try {
            if (!await options.onSave(html)) {
                return false;
            }
            source = nodeContent(node);
            lastHTML = html;
            changed = cleanListMindmapHTML(fragment.getBlockHTML()) !== html;
            if (changed && !finishSession) {
                saveTimer = window.setTimeout((): void => { void commit(); }, 350);
            }
            return true;
        } finally {
            saving = false;
        }
    };
    const cleanup = () => {
        if (finished) {
            return;
        }
        const html = cleanListMindmapHTML(fragment.getBlockHTML());
        if (html !== lastHTML) {
            recover();
        }
        finished = true;
        clearTimeout(saveTimer);
        events.abort();
        observer.disconnect();
        fragment.destroy();
        overlays.forEach(element => element.remove());
        host.classList.remove("list-mindmap__editor");
        host.style.minWidth = originalMinWidth;
        delete host.dataset.protyleLiteRender;
        options.onFinish();
    };
    const destroy = () => {
        if (finished || closing) {
            return;
        }
        closing = true;
        events.abort();
        clearTimeout(saveTimer);
        // 卸载前排空输入任务，延迟转换不会再访问已销毁的编辑器。
        void fragment.protyle.wysiwyg.flushPendingInput().catch(error => console.error(error)).finally(cleanup);
    };
    const finish = (): Promise<boolean> => {
        if (!pendingFinish) {
            pendingFinish = endSession().finally(() => {
                pendingFinish = undefined;
            });
        }
        return pendingFinish;
    };
    const endSession = async () => {
        if (finished) {
            return true;
        }
        if (composing) {
            finishAfterComposition = true;
            return false;
        }
        if (pendingSave) {
            await pendingSave;
        }
        do {
            if (!await commit(true)) {
                return false;
            }
        } while (cleanListMindmapHTML(fragment.getBlockHTML()) !== lastHTML);
        cleanup();
        return true;
    };
    const undo = async (redo: boolean) => {
        if (await finish()) {
            options.onUndo(redo);
        }
    };
    setMobileToolbarUndo(fragment.protyle, owner, undo);
    const signal = events.signal;
    bindLiteCodeActions(host, fragment.protyle, {
        signal,
        canEdit: () => !finished && !closing && options.canEdit(),
        onChange: () => {
            changed = true;
            void commit();
        },
    });
    ["beforeinput", "input", "compositionstart", "compositionupdate", "compositionend", "copy", "cut", "paste",
        "pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "dblclick",
        "contextmenu", "dragstart", "dragover", "drop", "focusin", "focusout", "keyup"]
        .forEach(type => host.addEventListener(type, event => event.stopPropagation(), {signal}));
    host.addEventListener("keydown", event => event.stopPropagation(), {signal});
    host.addEventListener("keydown", event => {
        if (event.isComposing || composing) {
            return;
        }
        const keymap = window.siyuan.config.keymap.editor.general;
        if (matchHotKey(keymap.undo, event) || matchHotKey(keymap.redo, event)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            undo(matchHotKey(keymap.redo, event));
        } else if (event.key === "Escape" && fragment.hintElement.classList.contains("fn__none") &&
            fragment.protyle.toolbar.element.classList.contains("fn__none") &&
            fragment.protyle.toolbar.subElement.classList.contains("fn__none")) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const mindmap = host.closest<HTMLElement>(".list-mindmap");
            void finish().then(finished => {
                // 退出节点编辑后将键盘焦点交回脑图，保留已选节点的快捷键操作。
                if (finished && mindmap?.isConnected &&
                    (document.activeElement === document.body || mindmap.contains(document.activeElement))) {
                    mindmap.focus({preventScroll: true});
                }
            });
        }
    }, {capture: true, signal});
    host.addEventListener("compositionstart", () => {
        composing = true;
        clearTimeout(saveTimer);
    }, {capture: true, signal});
    host.addEventListener("compositionend", () => queueMicrotask(() => {
        composing = false;
        void commit();
        if (finishAfterComposition) {
            finish();
        }
    }), {capture: true, signal});
    const belongs = (target: Node) => host.contains(target) || fragment.hintElement.contains(target) ||
        fragment.protyle.toolbar.element.contains(target) || fragment.protyle.toolbar.subElement.contains(target) ||
        !!(target instanceof Element && target.closest("#keyboardToolbar, #commonMenu, .b3-dialog"));
    document.addEventListener("pointerdown", event => {
        if (!belongs(event.target as Node)) {
            finish();
        }
    }, {capture: true, signal});
    window.addEventListener("blur", () => void commit(), {signal});
    window.addEventListener("pagehide", () => void finish(), {signal});
    const observer = new ResizeObserver(() => options.onResize());
    observer.observe(host);
    fragment.focus(true);
    return {finish, destroy};
};
