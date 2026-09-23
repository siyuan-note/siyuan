import {showMessage} from "../../../dialog/message";
import {setCustomBlockRootReady} from "../../../plugin/customBlockRender";
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
import {processRender} from "../../util/processCode";
import {avRender} from "../av/render";
import {blockRender} from "../blockRender";
import {highlightRender} from "../highlightRender";
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

const nestedBranchType = (node: ListMindmapNode) =>
    node.element?.parentElement?.getAttribute("data-type") === "NodeMindmap" ? "NodeMindmap" : "NodeList";

const nodeContent = (node: ListMindmapNode) => Array.from(node.element?.children || []).filter(child =>
    child.hasAttribute("data-node-id") && child.getAttribute("data-type") !== nestedBranchType(node))
    .map(child => cleanListMindmapHTML(child.outerHTML)).join("");

const independentBlockSelector = '[data-type="NodeAttributeView"], [data-type="NodeBlockQueryEmbed"]';

const comparableContent = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = cleanListMindmapHTML(html);
    template.content.querySelectorAll<HTMLElement>(independentBlockSelector).forEach(block => {
        if (block.dataset.type === "NodeAttributeView") {
            const identity = document.createElement("div");
            identity.dataset.type = block.dataset.type;
            identity.dataset.nodeId = block.dataset.nodeId;
            identity.dataset.avId = block.dataset.avId;
            block.replaceWith(identity);
        } else {
            block.removeAttribute("updated");
            block.removeAttribute("data-render");
            block.replaceChildren();
        }
    });
    return template.innerHTML;
};

const retainIndependentBlocks = (html: string, node: ListMindmapNode) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const current = new Map<string, Element>();
    Array.from(node.element.children).filter(child => child.hasAttribute("data-node-id") &&
        child.getAttribute("data-type") !== nestedBranchType(node)).forEach(child => {
        const blocks = [child, ...Array.from(child.querySelectorAll(independentBlockSelector))];
        blocks.forEach(block => {
            if (block.matches(independentBlockSelector) && !block.closest(".protyle-wysiwyg__embed")) {
                current.set(block.getAttribute("data-node-id"), block);
            }
        });
    });
    template.content.querySelectorAll<HTMLElement>(independentBlockSelector).forEach(block => {
        const latest = current.get(block.dataset.nodeId);
        if (latest && comparableContent(block.outerHTML) === comparableContent(latest.outerHTML)) {
            block.replaceWith(latest.cloneNode(true));
        }
    });
    return template.innerHTML;
};

// 编辑器只在双击时挂载到节点内容区，预览与编辑沿用同一尺寸和排版。
export const openListMindmapEditor = (options: ListMindmapEditorOptions) => {
    const {owner, node, host} = options;
    const initialBlockHTML = nodeContent(node);
    if (!options.canEdit() || !node.element?.isConnected) {
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
    let source = comparableContent(initialBlockHTML);
    let recoveryShown = false;
    const events = new AbortController();
    const toolbar = getDefaultToolbar(isMobile()).filter(item =>
        typeof item === "string" ? item !== "ai" : item.name !== "ai");
    const slash = registerBuiltinSlashHint((key: string, protyle: IProtyle, hintSource: THintSource) =>
        hintSlash(key, protyle, hintSource).filter(item => !["list", "orderedList", "check"].includes(item.id)));
    const hint: IProtyleOptions["hint"] = {
        extend: [{key: "((", hint: hintRef}, {key: "【【", hint: hintRef}, {key: "（（", hint: hintRef},
            {key: "[[", hint: hintRef}, {key: "/", hint: slash}, {key: "、", hint: slash}],
    };
    const originalMinWidth = host.style.minWidth;
    const embedSourceIDs = new Set<string>();
    const rememberEmbedSourceIDs = () => {
        host.querySelectorAll<HTMLElement>(".protyle-wysiwyg__embed").forEach(result => {
            if (result.dataset.id) {
                embedSourceIDs.add(result.dataset.id);
            }
            result.querySelectorAll<HTMLElement>("[data-node-id]").forEach(block => {
                embedSourceIDs.add(block.dataset.nodeId);
            });
        });
    };
    const embedSourceObserver = new MutationObserver(rememberEmbedSourceIDs);
    embedSourceObserver.observe(host, {childList: true, subtree: true});
    // 保留未缩放的亚像素宽度，避免取整后响应式容器挤压文字，导致换行和整棵树重排。
    host.style.minWidth = getComputedStyle(host).width;
    host.replaceChildren();
    host.classList.add("mindmap-view__editor");
    host.contentEditable = "false";
    const fragment = mountProtyleLiteFragment(host, {
        app: owner.app,
        initialBlockHTML,
        protyleOptions: {notebookId: owner.notebookId, toolbar, hint},
        runtimeCapabilities: {
            upload: false, websocket: false, pluginExtensions: false,
            listItemFragment: true,
            getTransactionOwner: operations => {
                const avIDs = new Set(Array.from(host.querySelectorAll<HTMLElement>(
                    '[data-type="NodeAttributeView"][data-av-id]')).map(element => element.dataset.avId));
                if (operations.some(operation => operation.action.includes("AttrView") &&
                    avIDs.has("avID" in operation && typeof operation.avID === "string" ? operation.avID : operation.id))) {
                    return owner;
                }
                rememberEmbedSourceIDs();
                return operations.length > 0 && operations.every(operation =>
                    embedSourceIDs.has(operation.id) || operation.action === "insert" &&
                    [operation.parentID, operation.previousID, operation.nextID].some(id => embedSourceIDs.has(id))) ?
                    owner : undefined;
            },
            lute: owner.lute, lockedOptions: {toolbar, hint},
        },
        afterSetContent: (protyle, element) => {
            protyle.block.rootID = owner.block.rootID;
            protyle.block.parentID = node.id;
            protyle.path = owner.path;
            setCustomBlockRootReady(element, true);
            processRender(element);
            highlightRender(element);
            blockRender(protyle, element, undefined, options.onResize);
            void avRender(element, owner);
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
    const overlayRoot = host.closest(".mindmap-view") || document.body;
    // 菜单使用未缩放的容器定位，同时保持在原生全屏元素内可见。
    overlays.forEach(element => overlayRoot.appendChild(element));
    let lastHTML = comparableContent(fragment.getBlockHTML());
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
        // 编辑器中创建的列表会成为子分支，结束编辑后再移动，避免改动正在输入的节点。
        if (!finishSession &&
            Array.from(fragment.wysiwyg.children).some(element => element.getAttribute("data-type") === "NodeList")) {
            return false;
        }
        const html = cleanListMindmapHTML(fragment.getBlockHTML());
        const version = comparableContent(html);
        if (version === lastHTML) {
            changed = false;
            return true;
        }
        if (!options.canEdit() || !node.element.isConnected || comparableContent(nodeContent(node)) !== source) {
            recover();
            return false;
        }
        saving = true;
        try {
            if (!await options.onSave(retainIndependentBlocks(html, node))) {
                return false;
            }
            source = comparableContent(nodeContent(node));
            lastHTML = version;
            changed = comparableContent(fragment.getBlockHTML()) !== version;
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
        const html = comparableContent(fragment.getBlockHTML());
        if (html !== lastHTML) {
            recover();
        }
        finished = true;
        clearTimeout(saveTimer);
        events.abort();
        embedSourceObserver.disconnect();
        observer.disconnect();
        fragment.destroy();
        overlays.forEach(element => element.remove());
        host.classList.remove("mindmap-view__editor");
        host.style.minWidth = originalMinWidth;
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
        } while (comparableContent(fragment.getBlockHTML()) !== lastHTML);
        cleanup();
        return true;
    };
    const undo = async (redo: boolean) => {
        const selection = getSelection();
        const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
        if (anchor && host.contains(anchor) && anchor.closest(".protyle-wysiwyg__embed, .av")) {
            if (redo) {
                owner.undo.redo(owner);
            } else {
                owner.undo.undo(owner);
            }
            return;
        }
        if (await finish()) {
            options.onUndo(redo);
        }
    };
    setMobileToolbarUndo(fragment.protyle, owner, undo);
    const signal = events.signal;
    host.addEventListener("beforeinput", event => {
        const anchor = getSelection()?.anchorNode;
        const element = anchor instanceof Element ? anchor : anchor?.parentElement;
        const block = element?.closest<HTMLElement>(".protyle-wysiwyg__embed [data-node-id]");
        if (block?.dataset.nodeId && (event.inputType.startsWith("insert") || event.inputType.startsWith("delete"))) {
            fragment.protyle.wysiwyg.lastHTMLs[block.dataset.nodeId] = block.outerHTML;
        }
    }, {capture: true, signal});
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
            const mindmap = host.closest<HTMLElement>(".mindmap-view");
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
    const belongs = (target: Node) => {
        if (host.contains(target) || fragment.hintElement.contains(target) ||
            fragment.protyle.toolbar.element.contains(target) || fragment.protyle.toolbar.subElement.contains(target)) {
            return true;
        }
        if (!(target instanceof Element)) {
            return false;
        }
        const avOverlay = target.closest<HTMLElement>(".av__panel, .av__mask");
        if (avOverlay?.dataset.avBlockId && host.querySelector(
            `[data-type="NodeAttributeView"][data-node-id="${avOverlay.dataset.avBlockId}"]`)) {
            return true;
        }
        return !!target.closest("#keyboardToolbar, #commonMenu, .b3-dialog");
    };
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
