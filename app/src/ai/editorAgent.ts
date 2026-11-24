import type {App} from "../index";
import type {AgentChat} from "../layout/dock/agent/AgentChat";
import {isDisabledFeature} from "../protyle/util/compatibility";
import {isEncryptedBox} from "../util/pathName";
import {focusByOffset, getBlockRanges} from "../protyle/util/selection";
import {createRangeByOffsets, focusByRange} from "../protyle/util/selectionOffsets";
import {isInEmbedBlock} from "../protyle/util/hasClosest";
import type {AgentQuote} from "../layout/dock/agent/agentQuote";
import type {Editor} from "../editor";
import {Constants} from "../constants";
import {showMessage} from "../dialog/message";
/// #if !MOBILE
import {getDockByType} from "../layout/tabUtil";

const quotedEditors = new WeakSet<IProtyle>();
const agentDockItem = '.dock__item[data-type="agentChat"].dock__item--active';
/// #endif

export const openEditorAgent = async (app: App, quote?: "first" | "repeat"): Promise<AgentChat | undefined> => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish || isDisabledFeature("ai")) {
        return;
    }
    let result: AgentChat;
    /// #if MOBILE
    const {openMobileAgent} = await import("../mobile/agent/MobileAgentChat");
    result = openMobileAgent(app);
    /// #else
    const dock = getDockByType("agentChat");
    if (!dock) {
        return;
    }
    const ready = (value: unknown): value is AgentChat => !!value && typeof value === "object" &&
        "insertBlockMentions" in value && typeof value.insertBlockMentions === "function";
    const floating = dock.isFloating();
    if (!(floating && quote === "repeat" && ready(dock.data.agentChat))) {
        if (!ready(dock.data.agentChat) || !document.querySelector(agentDockItem) ||
            (floating && quote === "first" && !dock.isPanelVisible())) {
            dock.toggleModel("agentChat", true);
        } else if (floating && quote === "first") {
            dock.showDock();
        }
    }
    result = ready(dock.data.agentChat) ? dock.data.agentChat : undefined;
    /// #endif
    return result;
};

export const openQuotedSelection = async (app: App, quote: AgentQuote) => {
    const source = quote.source;
    if (source.kind !== "selection") return;
    const highlight = (protyle?: IProtyle) => {
        const root = protyle?.wysiwyg?.element;
        if (!root) return;
        const endpoint = (id: string, offset: number, cell?: number) => {
            const block = Array.from(root.querySelectorAll(`[data-node-id="${CSS.escape(id)}"]`)).find(el => !isInEmbedBlock(el));
            if (!block) return;
            if (cell === undefined) return focusByOffset(block, offset, offset, false);
            return createRangeByOffsets(block.querySelectorAll("th, td")[cell], offset, offset);
        };
        const select = () => {
            const from = endpoint(source.id, source.start, source.startCell);
            const to = endpoint(source.endID, source.end, source.endCell);
            if (!(from instanceof Range) || !(to instanceof Range)) return false;
            from.setEnd(to.endContainer, to.endOffset);
            if (getBlockRanges(root, from).map(part => part.range.toString()).join("\n") === quote.text) {
                focusByRange(from);
            }
            return true;
        };
        if (!select()) {
            // 打开已有页签时，定位的内容可能仍在按需加载。
            const observer = new MutationObserver(() => {
                if (select()) {
                    observer.disconnect();
                    window.clearTimeout(timeout);
                }
            });
            observer.observe(root, {childList: true, subtree: true});
            const timeout = window.setTimeout(() => observer.disconnect(), 3000);
        }
    };
    const action: TProtyleAction[] = [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT];
    /// #if MOBILE
    const {openMobileFileById} = await import("../mobile/editor");
    await openMobileFileById(app, source.id, action, "center", undefined, highlight);
    /// #else
    const {openFileById} = await import("../editor/util");
    await openFileById({app, id: source.id, action, forceCurrentWindow: true,
        afterOpen: (model: Editor) => highlight(model?.editor?.protyle)});
    /// #endif
};

export const quoteEditorSelection = async (editor: IProtyle, range: Range) => {
    if (!editor.block.rootID || isEncryptedBox(editor.notebookId)) {
        return;
    }
    const showFailure = () => showMessage(window.siyuan.languages.confirmActionFailed, 3000, "error");
    if (!range || range.collapsed) {
        showFailure();
        return;
    }
    const parts = getBlockRanges(editor.wysiwyg.element, range);
    if (!parts.length) {
        showFailure();
        return;
    }
    const first = parts[0];
    const last = parts[parts.length - 1];
    const text = parts.map(part => part.range.toString()).join("\n");
    if (!text.trim()) {
        showFailure();
        return;
    }
    try {
        const cellIndex = (part: typeof first) => part.editableElement.matches("th, td") ?
            Array.from(part.blockElement.querySelectorAll("th, td")).indexOf(part.editableElement) : undefined;
        const quote: AgentQuote = {text, source: {kind: "selection", id: first.blockElement.dataset.nodeId,
            endID: last.blockElement.dataset.nodeId, start: first.start, end: last.end,
            startCell: cellIndex(first), endCell: cellIndex(last)}};
        /// #if MOBILE
        const mobileChat = await openEditorAgent(editor.app);
        if (!await mobileChat?.insertQuote(quote)) showFailure();
        /// #else
        const chat = await openEditorAgent(editor.app, quotedEditors.has(editor) ? "repeat" : "first");
        if (!chat) {
            showFailure();
            return;
        }
        const dock = getDockByType("agentChat");
        const floating = dock?.isFloating();
        const inBackground = !!floating && (!dock.isPanelVisible() ||
            dock.layout.element.style.opacity !== "1" || !document.querySelector(agentDockItem));
        const count = await chat.insertQuote(quote, inBackground);
        if (!count) {
            showFailure();
        } else if (floating) {
            quotedEditors.add(editor);
            if (inBackground) {
                showMessage(window.siyuan.languages.agentQuoteAdded.replace("${count}", count.toString()), 3000, "info", "agent-quote-added");
            }
        }
        /// #endif
    } catch (error) {
        console.error(error);
        showFailure();
    }
};
