import {Constants} from "../../constants";
import {showMessage} from "../../dialog/message";
import {renderTableCellRichElements} from "../render/tableCellRich";
import {updateTransaction} from "../wysiwyg/transaction";
import {hideCaretLine, hideDragTip, showDragTip} from "./dragTip";
import {cleanupDragIndicators, createListDragTarget} from "./listDragTarget";
import {cleanTableCellRichHTML, getTableCellRichBlockDOM, serializeTableCellRich, setTableCellRich} from "./tableCellRich";

export const bindTableCellRichDrag = (owner: IProtyle, cell: HTMLTableCellElement,
                                      wysiwyg: HTMLElement, finish: () => void, signal: AbortSignal,
                                      focusTarget: (target: HTMLTableCellElement) => void) => {
    let indicator: HTMLElement;
    const getListDragTarget = createListDragTarget();
    const clear = () => {
        indicator?.classList.remove("dragover", "dragover__top", "dragover__bottom",
            "dragover__top--sibling", "dragover__bottom--sibling", "dragover__top--child", "dragover__bottom--child");
        ["--drag-indent", "--drag-line-left", "--drag-guides", "--drag-base-bg", "--drag-line-bg"].forEach(name =>
            indicator?.style.removeProperty(name));
        indicator = undefined;
    };
    const resolve = (event: DragEvent) => {
        if (window.siyuan.dragElement !== wysiwyg) {
            return;
        }
        const type = Array.from(event.dataTransfer?.types || []).find(value => value.startsWith(Constants.SIYUAN_DROP_GUTTER));
        const target = event.target instanceof Element ? event.target : undefined;
        const targetCell = target?.closest<HTMLTableCellElement>("td, th");
        if (!type || !targetCell || targetCell === cell ||
            targetCell.closest(".protyle-wysiwyg") !== owner.wysiwyg.element) {
            return;
        }
        const ids = type.slice(Constants.SIYUAN_DROP_GUTTER.length).split(Constants.ZWSP)[2]?.split(",") || [];
        const blocks = Array.from(wysiwyg.querySelectorAll<HTMLElement>("[data-node-id]"))
            .filter(node => ids.includes(node.dataset.nodeId));
        const selected = blocks.filter(node => !blocks.some(parent => parent !== node && parent.contains(node)));
        if (!selected.length) {
            return;
        }
        const listItems = selected.every(node => node.dataset.type === "NodeListItem");
        let anchor = (listItems ? target.closest('[data-type="NodeListItem"]') : undefined) ||
            target.closest("[data-table-cell-node]");
        if (anchor && !(listItems && anchor.getAttribute("data-type") === "NodeListItem" &&
            selected.every(node => node.dataset.subtype === anchor.getAttribute("data-subtype")))) {
            const preview = targetCell.querySelector(".table__cell-rich");
            while (anchor.parentElement !== preview && anchor.parentElement?.hasAttribute("data-table-cell-node")) {
                anchor = anchor.parentElement;
            }
        }
        const listTarget = listItems && anchor?.getAttribute("data-type") === "NodeListItem" &&
            selected.every(node => node.dataset.subtype === anchor.getAttribute("data-subtype")) ?
            getListDragTarget(anchor as HTMLElement, event) : undefined;
        const rect = (anchor || targetCell).getBoundingClientRect();
        return {targetCell, selected, anchor, listItems, listTarget,
            before: listTarget ? listTarget.position === "top" : event.clientY < rect.top + rect.height / 2};
    };
    owner.wysiwyg.element.addEventListener("dragover", event => {
        const drop = resolve(event);
        if (!drop) {
            clear();
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        // 跨入单元格时接管普通块拖拽留下的指示，避免多个落点同时高亮。
        cleanupDragIndicators(owner.wysiwyg.element);
        hideCaretLine();
        hideDragTip();
        event.dataTransfer.dropEffect = event.altKey || event.shiftKey ? "none" : event.ctrlKey ? "copy" : "move";
        if (event.altKey || event.shiftKey) {
            clear();
        } else {
            clear();
            indicator = (drop.anchor || drop.targetCell) as HTMLElement;
            if (drop.listTarget) {
                drop.listTarget.apply();
                indicator.classList.add("dragover");
            } else {
                indicator.classList.add(drop.before ? "dragover__top" : "dragover__bottom");
            }
            if (drop.listTarget) {
                const text = Array.from(indicator.querySelector("[contenteditable]")?.textContent?.trim() || "");
                const targetText = text.slice(0, 20).join("") + (text.length > 20 ? "..." : "");
                const key = drop.listTarget.isChild ? "dragTipListItemChild" :
                    drop.before ? "dragTipListItemBefore" : "dragTipListItemAfter";
                showDragTip(window.siyuan.dragTitle || "", event.ctrlKey ? window.siyuan.languages.duplicateCopy :
                    window.siyuan.languages[key].replace("${x}", targetText), event.clientX, event.clientY);
            }
        }
    }, {capture: true, signal});
    owner.wysiwyg.element.addEventListener("drop", event => {
        const drop = resolve(event);
        clear();
        if (!drop) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        hideCaretLine();
        hideDragTip();
        if (event.altKey || event.shiftKey || owner.disabled) {
            return;
        }
        try {
            const source = wysiwyg.cloneNode(true) as HTMLElement;
            const destination = document.createElement("div");
            destination.innerHTML = getTableCellRichBlockDOM(drop.targetCell);
            const anchorIndex = Array.from(drop.targetCell.querySelectorAll("[data-table-cell-node]"))
                .indexOf(drop.anchor);
            let anchor = destination.querySelectorAll("[data-node-id]")[anchorIndex];
            if (destination.childElementCount === 1 && destination.firstElementChild.getAttribute("data-type") === "NodeParagraph" &&
                !destination.firstElementChild.querySelector('[contenteditable="true"]')?.innerHTML.replaceAll(Constants.ZWSP, "").trim()) {
                destination.replaceChildren();
                anchor = undefined;
            }
            let nodes = drop.selected.map(node => node.cloneNode(true) as HTMLElement);
            const mergeList = drop.listItems && anchor?.getAttribute("data-type") === "NodeListItem" &&
                drop.selected.every(node => node.dataset.subtype === anchor.getAttribute("data-subtype"));
            if (drop.listItems && !mergeList) {
                const list = drop.selected[0].parentElement.cloneNode(false) as HTMLElement;
                list.append(...nodes);
                nodes = [list];
            }
            if (!mergeList) {
                while (anchor && anchor.parentElement !== destination) {
                    anchor = anchor.parentElement;
                }
            }
            nodes.forEach(node => {
                node.classList.remove("protyle-wysiwyg--select");
                node.querySelectorAll(".protyle-wysiwyg--select").forEach(child =>
                    child.classList.remove("protyle-wysiwyg--select"));
            });
            if (mergeList && drop.listTarget?.isChild) {
                const list = drop.selected[0].parentElement.cloneNode(false) as HTMLElement;
                list.append(...nodes);
                const attributes = anchor.querySelector(":scope > .protyle-attr");
                anchor.insertBefore(list, attributes);
            } else if (anchor) {
                const content = document.createDocumentFragment();
                content.append(...nodes);
                anchor.parentNode.insertBefore(content, drop.before ? anchor : anchor.nextSibling);
            } else if (drop.before) {
                destination.prepend(...nodes);
            } else {
                destination.append(...nodes);
            }
            drop.selected.forEach(node => source.querySelector(`[data-node-id="${node.dataset.nodeId}"]`)?.remove());
            // 删除失去全部列表项的容器，保留未被拖动的嵌套内容。
            Array.from(source.querySelectorAll('[data-type="NodeList"]')).reverse().forEach(list => {
                if (!list.querySelector('[data-type="NodeListItem"]')) {
                    list.remove();
                }
            });
            const targetValue = serializeTableCellRich(destination.innerHTML).markdown;
            const sourceValue = serializeTableCellRich(source.innerHTML).markdown;
            finish();
            const sourceTable = cell.closest('[data-type="NodeTable"]');
            const targetTable = drop.targetCell.closest('[data-type="NodeTable"]');
            const oldSource = cleanTableCellRichHTML(sourceTable.outerHTML);
            const oldTarget = cleanTableCellRichHTML(targetTable.outerHTML);
            if (!event.ctrlKey) {
                setTableCellRich(cell, sourceValue);
            }
            setTableCellRich(drop.targetCell, targetValue);
            const additional: {doOperations: IOperation[], undoOperations: IOperation[]} = sourceTable !== targetTable && !event.ctrlKey ? {
                doOperations: [{action: "update", id: sourceTable.getAttribute("data-node-id"), data: cleanTableCellRichHTML(sourceTable.outerHTML)}],
                undoOperations: [{action: "update", id: sourceTable.getAttribute("data-node-id"), data: oldSource}],
            } : undefined;
            updateTransaction(owner, targetTable, oldTarget, undefined, additional);
            renderTableCellRichElements(sourceTable);
            renderTableCellRichElements(targetTable);
            focusTarget(drop.targetCell);
        } catch (error) {
            console.error(error);
            showMessage(window.siyuan.languages.tableCellRichInvalid);
        }
    }, {capture: true, signal});
    document.addEventListener("dragend", () => {
        clear();
        hideDragTip();
    }, {capture: true, signal});
    owner.wysiwyg.element.addEventListener("dragleave", event => {
        if (!indicator) {
            return;
        }
        // 浏览器切换拖放命中节点时可能没有 relatedTarget，按实际命中位置判断是否已离开。
        const target = event.relatedTarget instanceof Node ? event.relatedTarget :
            document.elementFromPoint(event.clientX, event.clientY);
        if (!target || !owner.wysiwyg.element.contains(target)) {
            clear();
            hideDragTip();
        } else {
            event.stopImmediatePropagation();
        }
    }, {capture: true, signal});
    signal.addEventListener("abort", clear, {once: true});
};
