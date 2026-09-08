import {isMobile} from "../../util/functions";
import {showMessage} from "../../dialog/message";
import {hintRef, hintSlash} from "../hint/extend";
import {mountProtyleLiteFragment} from "../lite/fragmentEditor";
import {getDefaultToolbar} from "../toolbar/defaults";
import {updateTransaction} from "../wysiwyg/transaction";
import {configureAVRichTextLute, getAVRichTextLute, sanitizeAVRichTextBlockDOM} from "./av/richText";
import {highlightRender} from "./highlightRender";
import {mathRender} from "./mathRender";
import {renderTableCellRichElements} from "./tableCellRich";
import {cleanTableCellRichHTML, getTableCellRichBlockDOM, renderTableCellRich, serializeTableCellRich, setTableCellRich} from "../util/tableCellRich";
import {decodeTableCellRich, encodeTableCellRich, TABLE_CELL_RICH_ATTRIBUTE, TABLE_RICH_ATTRIBUTE} from "../util/tableCellRichValue";

const SAFE_SLASH_IDS = new Set([
    "ref", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "list", "orderedList", "check",
    "quote", "code", "math", "link", "bold", "italic", "underline", "strike", "mark", "sup", "sub", "inlineCode",
    "kbd", "tag", "inlineMath",
]);
let activeEditor: {cell: Element, finish: () => void} | undefined;

export const applyTableCellRichInlineMark = (owner: IProtyle, cells: HTMLTableCellElement[], type: string,
                                           textObj?: ITextOption) => {
    if (owner.disabled) {
        return;
    }
    activeEditor?.finish();
    if (activeEditor) {
        return;
    }
    const host = document.createElement("div");
    host.className = "fn__none";
    document.body.appendChild(host);
    const fragment = mountProtyleLiteFragment(host, {
        app: owner.app,
        runtimeCapabilities: {
            upload: false, websocket: false, pluginExtensions: false, customBlockRender: false,
            lute: getAVRichTextLute(),
            sanitizeBlockDOM: html => sanitizeAVRichTextBlockDOM(html, true),
            restoreLuteMarkdownSyntax: configureAVRichTextLute,
        },
    });
    try {
        const updates = cells.filter(cell => cell.isConnected).map(cell => {
            fragment.setBlockHTML(getTableCellRichBlockDOM(cell));
            fragment.protyle.toolbar.setBlockElementsInlineMark(fragment.protyle,
                Array.from(fragment.wysiwyg.children), type, textObj);
            return {cell, source: serializeTableCellRich(fragment.getBlockHTML()).markdown};
        });
        const tables = new Map<Element, string>();
        updates.forEach(({cell}) => {
            const table = cell.closest('[data-type="NodeTable"]');
            if (!tables.has(table)) {
                tables.set(table, table.outerHTML);
            }
        });
        updates.forEach(({cell, source}) => setTableCellRich(cell, source));
        tables.forEach((oldHTML, table) => {
            updateTransaction(owner, table, oldHTML);
            renderTableCellRichElements(table);
        });
    } catch (error) {
        console.error(error);
        showMessage(window.siyuan.languages.tableCellRichInvalid);
    } finally {
        fragment.destroy();
        host.remove();
    }
};

export const openTableCellRichEditor = (owner: IProtyle, cell: HTMLTableCellElement) => {
    if (owner.disabled || !cell.isConnected || activeEditor?.cell === cell) {
        return;
    }
    activeEditor?.finish();
    if (activeEditor) {
        return;
    }
    const table = cell.closest<HTMLElement>('[data-type="NodeTable"]');
    if (!table || cell.closest(".protyle-wysiwyg") !== owner.wysiwyg.element) {
        return;
    }
    let initialBlockHTML: string;
    try {
        initialBlockHTML = getTableCellRichBlockDOM(cell);
    } catch (error) {
        console.error(error);
        showMessage(window.siyuan.languages.tableCellRichInvalid);
        return;
    }
    owner.wysiwyg.tableControl?.clear();
    owner.wysiwyg.tableControl?.setHidden(true);
    table.setAttribute(TABLE_RICH_ATTRIBUTE, "1");
    const initialHTML = table.outerHTML;
    if (!cell.hasAttribute(TABLE_CELL_RICH_ATTRIBUTE)) {
        cell.setAttribute(TABLE_CELL_RICH_ATTRIBUTE, encodeTableCellRich(serializeTableCellRich(initialBlockHTML).markdown));
        table.setAttribute(TABLE_RICH_ATTRIBUTE, "1");
        updateTransaction(owner, table, initialHTML);
    }
    let source = decodeTableCellRich(cell.getAttribute(TABLE_CELL_RICH_ATTRIBUTE)).content;
    const host = document.createElement("div");
    host.className = "table__cell-editor";
    host.dataset.protyleLiteRender = "safe";
    host.contentEditable = "false";
    cell.replaceChildren(host);
    const events = ["beforeinput", "input", "keydown", "keyup", "compositionstart", "compositionupdate", "compositionend",
        "copy", "cut", "paste", "pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove",
        "click", "dblclick", "contextmenu", "dragstart", "dragover", "drop", "focusin", "focusout"];
    events.forEach(type => host.addEventListener(type, event => event.stopPropagation()));
    const toolbar = getDefaultToolbar(isMobile()).filter(item => typeof item === "string" ? item !== "ai" : item.name !== "ai");
    const safeSlash = (key: string, protyle: IProtyle, hintSource: THintSource) =>
        hintSlash(key, protyle, hintSource).filter(item => SAFE_SLASH_IDS.has(item.id));
    const hint: IProtyleOptions["hint"] = {
        extend: [{key: "((", hint: hintRef}, {key: "【【", hint: hintRef}, {key: "（（", hint: hintRef},
            {key: "[[", hint: hintRef}, {key: "/", hint: safeSlash}, {key: "、", hint: safeSlash}],
    };
    let timer: number;
    let finished = false;
    let composing = false;
    let finishAfterComposition = false;
    const fragment = mountProtyleLiteFragment(host, {
        app: owner.app,
        initialBlockHTML,
        placeholder: window.siyuan.languages.empty,
        protyleOptions: {notebookId: owner.notebookId, toolbar, hint},
        runtimeCapabilities: {
            upload: false,
            websocket: false,
            pluginExtensions: false,
            customBlockRender: false,
            lute: getAVRichTextLute(),
            lockedOptions: {toolbar, hint},
            sanitizeBlockDOM: html => sanitizeAVRichTextBlockDOM(html, true),
            restoreLuteMarkdownSyntax: configureAVRichTextLute,
        },
        afterSetContent: (protyle, element) => {
            highlightRender(element);
            mathRender(element);
            protyle.undo.clear();
        },
        onChange: () => {
            window.clearTimeout(timer);
            if (!finished && !composing) {
                timer = window.setTimeout(commit, 200);
            }
        },
    });
    const commit = () => {
        window.clearTimeout(timer);
        if (!cell.isConnected || !table.isConnected || !host.isConnected || owner.disabled || composing) {
            return;
        }
        try {
            const serialized = serializeTableCellRich(fragment.getBlockHTML());
            if (serialized.markdown === source) {
                return;
            }
            const oldHTML = cleanTableCellRichHTML(table.outerHTML);
            source = serialized.markdown;
            cell.setAttribute(TABLE_CELL_RICH_ATTRIBUTE, encodeTableCellRich(source));
            updateTransaction(owner, table, oldHTML);
        } catch (error) {
            console.error(error);
            showMessage(window.siyuan.languages.tableCellRichInvalid);
        }
    };
    const controller = new AbortController();
    const observer = new MutationObserver(() => {
        if (!host.isConnected || !owner.element.isConnected) {
            finish();
        }
    });
    const finish = () => {
        if (finished) {
            return;
        }
        if (composing && host.isConnected) {
            finishAfterComposition = true;
            return;
        }
        commit();
        finished = true;
        controller.abort();
        observer.disconnect();
        fragment.destroy();
        owner.wysiwyg.tableControl?.setHidden(false);
        if (cell.isConnected && host.isConnected) {
            renderTableCellRich(cell);
            renderTableCellRichElements(cell);
        }
        if (activeEditor?.cell === cell) {
            activeEditor = undefined;
        }
    };
    activeEditor = {cell, finish};
    const signal = controller.signal;
    const belongsToEditor = (target: Node) => host.contains(target) || fragment.hintElement.contains(target) ||
        fragment.protyle.toolbar.element.contains(target) || fragment.protyle.toolbar.subElement.contains(target) ||
        !!(target instanceof Element && target.closest("#commonMenu, .b3-dialog"));
    document.addEventListener("pointerdown", event => {
        if (!belongsToEditor(event.target as Node)) {
            finish();
        }
    }, {capture: true, signal});
    window.addEventListener("pagehide", finish, {signal});
    window.addEventListener("blur", commit, {signal});
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            commit();
        }
    }, {signal});
    host.addEventListener("compositionstart", () => composing = true, {signal});
    host.addEventListener("compositionend", () => {
        composing = false;
        commit();
        if (finishAfterComposition) {
            finish();
        }
    }, {signal});
    host.addEventListener("keydown", event => {
        if (event.key === "Escape" && !event.isComposing &&
            fragment.hintElement.classList.contains("fn__none") &&
            fragment.protyle.toolbar.subElement.classList.contains("fn__none")) {
            event.preventDefault();
            event.stopImmediatePropagation();
            finish();
            cell.tabIndex = -1;
            cell.focus();
            const range = document.createRange();
            range.selectNodeContents(cell);
            range.collapse(true);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
        }
    }, {capture: true, signal});
    observer.observe(owner.element, {childList: true, subtree: true});
    fragment.focus(true);
};
