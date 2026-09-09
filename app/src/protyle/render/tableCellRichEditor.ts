import {isMobile} from "../../util/functions";
import {showMessage} from "../../dialog/message";
import {hintRef, hintSlash} from "../hint/extend";
import {mountProtyleLiteFragment} from "../lite/fragmentEditor";
import {getDefaultToolbar} from "../toolbar/defaults";
import {hideElements} from "../ui/hideElements";
import {updateTransaction} from "../wysiwyg/transaction";
import {configureAVRichTextLute, getAVRichTextLute, getAVRichTextUnsupportedPasteBlocks, sanitizeAVRichTextBlockDOM} from "./av/richText";
import {highlightRender} from "./highlightRender";
import {mathRender} from "./mathRender";
import {renderTableCellRichElements} from "./tableCellRich";
import {cleanTableCellRichHTML, getTableCellInlineHTML, getTableCellRichBlockDOM, renderTableCellRich, serializeTableCellRich, setTableCellRich, TABLE_CELL_INLINE_ATTRIBUTE, updateTableCellEditingValue} from "../util/tableCellRich";
import {TABLE_CELL_RICH_ATTRIBUTE} from "../util/tableCellRichValue";
import {focusByOffset, focusByRange, getSelectionOffset, getUndoFocusContext} from "../util/selection";
import {getAdjacentRichTableCell, isTableCellCaretAtBoundary} from "../util/tableCellRichNavigation";
import {focusEditableAtGoalX, getCaretGoalX} from "../wysiwyg/verticalCaret";
import {fixTable} from "../util/table";
import {updateTableCellContentLayout} from "../util/tableCellRich";
import {TABLE_CELL_SLASH_IDS} from "../util/tableCellRichMenu";
import {captureRichCellSelection, restoreRichCellSelection} from "../util/tableCellRichSelection";
import {matchHotKey} from "../util/hotKey";

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
            getUnsupportedPasteBlocks: html => getAVRichTextUnsupportedPasteBlocks(html, true),
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

export const openTableCellRichEditor = (owner: IProtyle, cell: HTMLTableCellElement,
                                       navigation?: {key: string, goalX: number}, point?: {x: number, y: number},
                                       restoredSelection?: ReturnType<typeof captureRichCellSelection>) => {
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
    let source: string;
    try {
        initialBlockHTML = getTableCellRichBlockDOM(cell);
        source = serializeTableCellRich(initialBlockHTML).markdown;
    } catch (error) {
        console.error(error);
        showMessage(window.siyuan.languages.tableCellRichInvalid);
        return;
    }
    hideElements(["gutter", "toolbar"], owner);
    const selection = getSelection();
    const initialRange = selection.rangeCount ? selection.getRangeAt(0) : undefined;
    const richSelection = cell.hasAttribute(TABLE_CELL_RICH_ATTRIBUTE) ? captureRichCellSelection(cell, selection) : undefined;
    const preserveSelection = initialRange && !initialRange.collapsed &&
        cell.contains(initialRange.startContainer) && cell.contains(initialRange.endContainer);
    const initialOffset = !cell.hasAttribute(TABLE_CELL_RICH_ATTRIBUTE) && initialRange &&
        cell.contains(initialRange.startContainer) && cell.contains(initialRange.endContainer) ?
        getSelectionOffset(cell, owner.wysiwyg.element, initialRange) : undefined;
    owner.wysiwyg.tableControl?.clear();
    if (!cell.hasAttribute(TABLE_CELL_RICH_ATTRIBUTE)) {
        cell.setAttribute(TABLE_CELL_INLINE_ATTRIBUTE, cell.innerHTML);
    }
    const host = document.createElement("div");
    host.className = "table__cell-editor";
    host.dataset.protyleLiteRender = "safe";
    host.contentEditable = "false";
    cell.replaceChildren(host);
    const events = ["beforeinput", "input", "keydown", "keyup", "compositionstart", "compositionupdate", "compositionend",
        "copy", "cut", "paste", "pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove",
        "click", "dblclick", "contextmenu", "dragstart", "dragover", "drop", "focusin", "focusout"];
    events.forEach(type => host.addEventListener(type, event => event.stopPropagation()));
    ["mouseover", "pointerover"].forEach(type => host.addEventListener(type, event => {
        hideElements(["gutter"], owner);
        event.stopPropagation();
    }));
    const toolbar = getDefaultToolbar(isMobile()).filter(item => typeof item === "string" ? item !== "ai" : item.name !== "ai");
    const safeSlash = (key: string, protyle: IProtyle, hintSource: THintSource) =>
        hintSlash(key, protyle, hintSource).filter(item => TABLE_CELL_SLASH_IDS.has(item.id));
    const hint: IProtyleOptions["hint"] = {
        extend: [{key: "((", hint: hintRef}, {key: "【【", hint: hintRef}, {key: "（（", hint: hintRef},
            {key: "[[", hint: hintRef}, {key: "/", hint: safeSlash}, {key: "、", hint: safeSlash}],
    };
    let timer: number;
    let finished = false;
    let composing = false;
    let finishAfterComposition = false;
    let undoSelection: ReturnType<typeof captureRichCellSelection>;
    let contentChanged = false;
    const fragment = mountProtyleLiteFragment(host, {
        app: owner.app,
        initialBlockHTML,
        protyleOptions: {notebookId: owner.notebookId, toolbar, hint},
        runtimeCapabilities: {
            upload: true,
            websocket: false,
            pluginExtensions: false,
            customBlockRender: false,
            lute: getAVRichTextLute(),
            lockedOptions: {toolbar, hint},
            sanitizeBlockDOM: html => sanitizeAVRichTextBlockDOM(html, true),
            getUnsupportedPasteBlocks: html => getAVRichTextUnsupportedPasteBlocks(html, true),
            restoreLuteMarkdownSyntax: configureAVRichTextLute,
        },
        afterSetContent: (protyle, element) => {
            updateTableCellContentLayout(host, element.innerHTML);
            highlightRender(element);
            mathRender(element);
            protyle.undo.clear();
        },
        onChange: () => {
            contentChanged = true;
            updateTableCellContentLayout(host, fragment.getBlockHTML());
            window.clearTimeout(timer);
            if (!finished && !composing) {
                timer = window.setTimeout(commit, 200);
            }
        },
    });
    fragment.protyle.block.rootID = owner.block.rootID;
    const commit = () => {
        window.clearTimeout(timer);
        if (!cell.isConnected || !table.isConnected || !host.isConnected || owner.disabled || composing) {
            return;
        }
        try {
            const serialized = serializeTableCellRich(fragment.getBlockHTML());
            if (serialized.markdown === source) {
                contentChanged = false;
                return;
            }
            const oldHTML = cleanTableCellRichHTML(table.outerHTML);
            const redoSelection = captureRichCellSelection(fragment.wysiwyg, getSelection()) || undoSelection;
            const tableRange = document.createRange();
            tableRange.selectNodeContents(cell);
            tableRange.collapse(true);
            const context = getUndoFocusContext(owner.wysiwyg.element, tableRange, true);
            const cellIndex = Array.from(table.querySelectorAll("th, td")).indexOf(cell).toString();
            const focusContext = (saved: typeof undoSelection) => saved ? {
                ...context,
                undoFocusTableCell: cellIndex,
                undoFocusTableSelection: JSON.stringify(saved),
            } : context;
            source = serialized.markdown;
            updateTableCellEditingValue(cell, serialized);
            updateTransaction(owner, table, oldHTML, focusContext(undoSelection), {
                doOperations: [], undoOperations: [], context: focusContext(redoSelection),
            });
            undoSelection = redoSelection;
            contentChanged = false;
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
    const captureBeforeChange = () => {
        if (!contentChanged || serializeTableCellRich(fragment.getBlockHTML()).markdown === source) {
            undoSelection = captureRichCellSelection(fragment.wysiwyg, getSelection());
        }
    };
    host.addEventListener("beforeinput", captureBeforeChange, {capture: true, signal});
    host.addEventListener("pointerdown", event => {
        captureBeforeChange();
        if (fragment.wysiwyg.contains(event.target as Node)) {
            hideElements(["toolbar"], fragment.protyle);
        }
    }, {capture: true, signal});
    const belongsToEditor = (target: Node) => host.contains(target) || fragment.hintElement.contains(target) ||
        fragment.protyle.toolbar.element.contains(target) || fragment.protyle.toolbar.subElement.contains(target) ||
        !!(target instanceof Element && target.closest("#commonMenu, .b3-dialog"));
    document.addEventListener("pointerdown", event => {
        // 表格右侧空白由外层编辑器忽略，保持单元格编辑状态，避免销毁编辑器后留下失效光标。
        const target = event.target instanceof Element ? event.target : undefined;
        if (target && owner.wysiwyg.element.contains(target) &&
            (!target.closest("[data-node-id]") || target.closest("[data-node-id]") === table)) {
            const tableRect = table.querySelector("table")?.getBoundingClientRect();
            const nodeRect = table.getBoundingClientRect();
            if (tableRect && event.clientX > tableRect.right &&
                event.clientY >= nodeRect.top && event.clientY <= nodeRect.bottom) {
                return;
            }
        }
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
        captureBeforeChange();
        const keymap = window.siyuan.config.keymap.editor.general;
        const undo = matchHotKey(keymap.undo, event);
        const redo = matchHotKey(keymap.redo, event);
        if (!event.isComposing && !composing && (undo || redo)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            // 先提交当前单元格，再由所属文档撤销，保证切换单元格后仍可连续回退。
            finish();
            const range = document.createRange();
            range.selectNodeContents(cell);
            range.collapse(true);
            owner.wysiwyg.element.focus({preventScroll: true});
            focusByRange(range);
            if (undo) {
                owner.undo.undo(owner);
            } else {
                owner.undo.redo(owner);
            }
            return;
        }
        if (!event.isComposing && !composing && !event.ctrlKey && !event.metaKey && !event.altKey &&
            fragment.hintElement.classList.contains("fn__none") &&
            fragment.protyle.toolbar.subElement.classList.contains("fn__none")) {
            const range = getSelection().rangeCount ? getSelection().getRangeAt(0) : undefined;
            if (range && !event.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
                isTableCellCaretAtBoundary(fragment.wysiwyg, range, event.key)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                const nextCell = getAdjacentRichTableCell(cell, event.key);
                if (nextCell) {
                    const goalX = getCaretGoalX(range);
                    finish();
                    openTableCellRichEditor(owner, nextCell, {key: event.key, goalX});
                }
                return;
            }
            const target = range?.startContainer instanceof Element ? range.startContainer : range?.startContainer.parentElement;
            const inListOrCode = target?.closest('[data-type="NodeList"], [data-type="NodeCodeBlock"]');
            const navigate = !inListOrCode && (event.key === "Tab" ||
                (event.key === "Enter" && !event.shiftKey && getTableCellInlineHTML(fragment.getBlockHTML()) !== null));
            if (navigate) {
                event.preventDefault();
                event.stopImmediatePropagation();
                finish();
                const tableRange = document.createRange();
                tableRange.selectNodeContents(cell);
                tableRange.collapse(true);
                getSelection().removeAllRanges();
                getSelection().addRange(tableRange);
                fixTable(owner, event, tableRange);
                const next = getSelection().focusNode;
                const nextElement = next instanceof Element ? next : next?.parentElement;
                const nextCell = nextElement?.closest<HTMLTableCellElement>("td, th");
                if (nextCell && nextCell !== cell && nextCell.closest(".protyle-wysiwyg") === owner.wysiwyg.element) {
                    openTableCellRichEditor(owner, nextCell);
                }
                return;
            }
        }
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
    if (restoredSelection && restoreRichCellSelection(fragment.wysiwyg, restoredSelection)) {
        undoSelection = restoredSelection;
        return;
    }
    if (navigation) {
        const editables = fragment.wysiwyg.querySelectorAll<HTMLElement>('[contenteditable="true"]');
        const backward = navigation.key === "ArrowLeft" || navigation.key === "ArrowUp";
        const edit = backward ? editables[editables.length - 1] : editables[0];
        if (edit) {
            if ((navigation.key === "ArrowUp" || navigation.key === "ArrowDown") &&
                focusEditableAtGoalX(edit, backward ? "up" : "down", navigation.goalX, owner.contentElement)) {
                return;
            }
            const range = document.createRange();
            range.selectNodeContents(edit);
            range.collapse(!backward);
            focusByRange(range);
        }
        return;
    }
    if (richSelection && (preserveSelection || !point) && restoreRichCellSelection(fragment.wysiwyg, richSelection)) {
        if (preserveSelection) {
            fragment.protyle.toolbar.render(fragment.protyle, getSelection().getRangeAt(0));
        }
        return;
    }
    if (point && !preserveSelection) {
        const range = document.caretRangeFromPoint(point.x, point.y);
        if (range && fragment.wysiwyg.contains(range.startContainer)) {
            focusByRange(range);
            return;
        }
    }
    if (initialOffset) {
        const edit = fragment.wysiwyg.querySelector('[contenteditable="true"]');
        if (edit) {
            focusByOffset(edit, initialOffset.start, initialOffset.end);
            if (preserveSelection) {
                fragment.protyle.toolbar.render(fragment.protyle, getSelection().getRangeAt(0));
            }
        }
    }
};
