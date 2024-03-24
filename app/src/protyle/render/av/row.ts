import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {focusBlock} from "../../util/selection";
import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {genCellValueByElement, getTypeByCellElement, popTextCell, renderCell, renderCellAttr} from "./cell";
import {fetchPost} from "../../../util/fetch";
import {showMessage} from "../../../dialog/message";
import * as dayjs from "dayjs";

export const selectRow = (checkElement: Element, type: "toggle" | "select" | "unselect" | "unselectAll") => {
    const rowElement = hasClosestByClassName(checkElement, "av__row");
    if (!rowElement) {
        return;
    }
    const useElement = checkElement.querySelector("use");
    if (rowElement.classList.contains("av__row--header") || type === "unselectAll") {
        if ("#iconCheck" === useElement.getAttribute("xlink:href") || type === "unselectAll") {
            rowElement.parentElement.querySelectorAll(".av__firstcol").forEach(item => {
                item.querySelector("use").setAttribute("xlink:href", "#iconUncheck");
                const rowItemElement = hasClosestByClassName(item, "av__row");
                if (rowItemElement) {
                    rowItemElement.classList.remove("av__row--select");
                }
            });
        } else {
            rowElement.parentElement.querySelectorAll(".av__firstcol").forEach(item => {
                item.querySelector("use").setAttribute("xlink:href", "#iconCheck");
                const rowItemElement = hasClosestByClassName(item, "av__row");
                if (rowItemElement) {
                    rowItemElement.classList.add("av__row--select");
                }
            });
        }
    } else {
        if (type === "select" || (useElement.getAttribute("xlink:href") === "#iconUncheck" && type === "toggle")) {
            rowElement.classList.add("av__row--select");
            useElement.setAttribute("xlink:href", "#iconCheck");
        } else if (type === "unselect" || (useElement.getAttribute("xlink:href") === "#iconCheck" && type === "toggle")) {
            rowElement.classList.remove("av__row--select");
            useElement.setAttribute("xlink:href", "#iconUncheck");
        }
    }
    focusBlock(hasClosestBlock(rowElement) as HTMLElement);
    updateHeader(rowElement);
};

export const updateHeader = (rowElement: HTMLElement) => {
    const blockElement = hasClosestBlock(rowElement);
    if (!blockElement) {
        return;
    }
    const selectCount = rowElement.parentElement.querySelectorAll(".av__row--select:not(.av__row--header)").length;
    const diffCount = rowElement.parentElement.childElementCount - 3 - selectCount;
    const headElement = rowElement.parentElement.firstElementChild;
    const headUseElement = headElement.querySelector("use");
    const counterElement = blockElement.querySelector(".av__counter");
    const avHeadElement = blockElement.querySelector(".av__header") as HTMLElement;
    if (diffCount === 0 && rowElement.parentElement.childElementCount - 3 !== 0) {
        headElement.classList.add("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconCheck");
    } else if (diffCount === rowElement.parentElement.childElementCount - 3) {
        headElement.classList.remove("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconUncheck");
        counterElement.classList.add("fn__none");
        avHeadElement.style.position = "";
        return;
    } else if (diffCount > 0) {
        headElement.classList.add("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconIndeterminateCheck");
    }
    counterElement.classList.remove("fn__none");
    counterElement.innerHTML = `${selectCount} ${window.siyuan.languages.selected}`;
    avHeadElement.style.position = "sticky";
};

const setPage = (blockElement: Element) => {
    const pageSize = parseInt(blockElement.getAttribute("data-page-size"));
    if (pageSize) {
        const currentCount = blockElement.querySelectorAll(".av__row:not(.av__row--header)").length;
        if (pageSize < currentCount) {
            blockElement.setAttribute("data-page-size", currentCount.toString());
        }
    }
};

/**
 * 前端插入一假行
 * @param protyle
 * @param blockElement
 * @param srcIDs
 * @param previousId
 * @param avId 存在为新增否则为拖拽插入
 */
export const insertAttrViewBlockAnimation = (protyle: IProtyle, blockElement: Element, srcIDs: string[], previousId: string, avId?: string,) => {
    if ((blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement).value !== "") {
        showMessage(window.siyuan.languages.insertRowTip);
        return;
    }
    let previousElement = blockElement.querySelector(`.av__row[data-id="${previousId}"]`) || blockElement.querySelector(".av__row--header");
    // 有排序需要加入最后一行
    if (blockElement.querySelector('.av__views [data-type="av-sort"]').classList.contains("block__icon--active")) {
        previousElement = blockElement.querySelector(".av__row--util").previousElementSibling;
        showMessage(window.siyuan.languages.insertRowTip2);
    }
    let colHTML = '<div class="av__firstcol av__colsticky"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
    const pinIndex = previousElement.querySelectorAll(".av__colsticky .av__cell").length - 1;
    if (pinIndex > -1) {
        colHTML = '<div class="av__colsticky"><div class="av__firstcol av__colsticky"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
    }
    previousElement.querySelectorAll(".av__cell").forEach((item: HTMLElement, index) => {
        colHTML += `<div class="av__cell" data-col-id="${item.dataset.colId}" 
style="width: ${item.style.width};${item.dataset.dtype === "number" ? "text-align: right;" : ""}" 
${(item.getAttribute("data-block-id") || item.dataset.dtype === "block") ? ' data-detached="true"' : ""}><span class="${avId ? "av__celltext" : "av__pulse"}"></span></div>`;
        if (pinIndex === index) {
            colHTML += "</div>";
        }
    });
    let html = "";
    srcIDs.forEach((id) => {
        html += `<div class="av__row" data-type="ghost" data-id="${id}" data-avid="${avId}" data-previous-id="${previousId}">
    ${colHTML}
</div>`;
    });
    previousElement.insertAdjacentHTML("afterend", html);
    if (avId) {
        const currentRow = previousElement.nextElementSibling;
        if (blockElement.querySelector('.av__views [data-type="av-sort"]').classList.contains("block__icon--active") &&
            !blockElement.querySelector('[data-type="av-load-more"]').parentElement.classList.contains("fn__none")) {
            currentRow.setAttribute("data-need-update", "true");
        }
        const sideRow = previousElement.classList.contains("av__row--header") ? currentRow.nextElementSibling : previousElement;
        fetchPost("/api/av/getAttributeViewFilterSort", {
            id: avId,
            blockID: blockElement.getAttribute("data-node-id")
        }, (response) => {
            // https://github.com/siyuan-note/siyuan/issues/10517
            let hideTextCell = false;
            response.data.filters.find((item: IAVFilter) => {
                const headerElement = blockElement.querySelector(`.av__cell--header[data-col-id="${item.column}"]`);
                if (!headerElement) {
                    return;
                }
                const filterType = headerElement.getAttribute("data-dtype");
                if (item.value && filterType !== item.value.type) {
                    return;
                }
                if (["relation", "rollup", "template"].includes(filterType)) {
                    hideTextCell = true;
                    return true;
                }

                // 根据后台计算出显示与否的结果进行标识，以便于在 refreshAV 中更新 UI
                if (["created", "updated"].includes(filterType)) {
                    currentRow.setAttribute("data-need-update", "true");
                } else {
                    response.data.sorts.find((sortItem: IAVSort) => {
                        if (sortItem.column === item.column) {
                            currentRow.setAttribute("data-need-update", "true");
                            return true;
                        }
                    });
                }
                if (sideRow.classList.contains("av__row")) {
                    const sideRowCellElement = sideRow.querySelector(`.av__cell[data-col-id="${item.column}"]`) as HTMLElement;
                    const cellElement = currentRow.querySelector(`.av__cell[data-col-id="${item.column}"]`);
                    const cellValue = genCellValueByElement(getTypeByCellElement(sideRowCellElement), sideRowCellElement);
                    cellElement.innerHTML = renderCell(cellValue);
                    renderCellAttr(cellElement, cellValue);
                }
            });
            if (hideTextCell) {
                currentRow.remove();
                showMessage(window.siyuan.languages.insertRowTip);
            } else if (srcIDs.length === 1) {
                popTextCell(protyle, [currentRow.querySelector('.av__cell[data-detached="true"]')], "block");
            }
            setPage(blockElement);
        });
    }
    setPage(blockElement);
};

export const stickyRow = (blockElement: HTMLElement, elementRect: DOMRect, status: "top" | "bottom" | "all") => {
    if (blockElement.querySelector(".av__title").getAttribute("contenteditable") === "false") {
        return;
    }
    const scrollRect = blockElement.querySelector(".av__scroll").getBoundingClientRect();
    const headerElement = blockElement.querySelector(".av__row--header") as HTMLElement;
    if (headerElement && (status === "top" || status === "all")) {
        const distance = Math.floor(elementRect.top - scrollRect.top);
        if (distance > 0 && distance < scrollRect.height) {
            headerElement.style.transform = `translateY(${distance}px)`;
        } else {
            headerElement.style.transform = "";
        }
    }

    const footerElement = blockElement.querySelector(".av__row--footer") as HTMLElement;
    if (footerElement && (status === "bottom" || status === "all")) {
        if (footerElement.querySelector(".av__calc--ashow")) {
            const distance = Math.ceil(elementRect.bottom - footerElement.parentElement.getBoundingClientRect().bottom);
            if (distance < 0 && -distance < scrollRect.height) {
                footerElement.style.transform = `translateY(${distance}px)`;
            } else {
                footerElement.style.transform = "";
            }
        } else {
            footerElement.style.transform = "";
        }
    }
};

const updatePageSize = (options: {
    currentPageSize: string,
    newPageSize: string,
    protyle: IProtyle,
    avID: string,
    nodeElement: Element
}) => {
    if (options.currentPageSize === options.newPageSize) {
        return;
    }
    options.nodeElement.setAttribute("data-page-size", options.newPageSize);
    const blockID = options.nodeElement.getAttribute("data-node-id");
    transaction(options.protyle, [{
        action: "setAttrViewPageSize",
        avID: options.avID,
        data: parseInt(options.newPageSize),
        blockID
    }], [{
        action: "setAttrViewPageSize",
        data: parseInt(options.currentPageSize),
        avID: options.avID,
        blockID
    }]);
    document.querySelector(".av__panel")?.remove();
};

export const setPageSize = (options: {
    target: HTMLElement,
    protyle: IProtyle,
    avID: string,
    nodeElement: Element
}) => {
    const menu = new Menu("av-page-size");
    if (menu.isOpen) {
        return;
    }
    const currentPageSize = options.target.dataset.size;
    menu.addItem({
        iconHTML: "",
        label: "10",
        accelerator: currentPageSize === "10" ? '<svg class="svg" style="height: 30px; float: left;"><use xlink:href="#iconSelect"></use></svg>' : undefined,
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: "10",
                protyle: options.protyle,
                avID: options.avID,
                nodeElement: options.nodeElement
            });
        }
    });
    menu.addItem({
        iconHTML: "",
        accelerator: currentPageSize === "25" ? '<svg class="svg" style="height: 30px; float: left;"><use xlink:href="#iconSelect"></use></svg>' : undefined,
        label: "25",
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: "25",
                protyle: options.protyle,
                avID: options.avID,
                nodeElement: options.nodeElement
            });
        }
    });
    menu.addItem({
        iconHTML: "",
        accelerator: currentPageSize === "50" ? '<svg class="svg" style="height: 30px; float: left;"><use xlink:href="#iconSelect"></use></svg>' : undefined,
        label: "50",
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: "50",
                protyle: options.protyle,
                avID: options.avID,
                nodeElement: options.nodeElement
            });
        }
    });
    menu.addItem({
        iconHTML: "",
        accelerator: currentPageSize === "100" ? '<svg class="svg" style="height: 30px; float: left;"><use xlink:href="#iconSelect"></use></svg>' : undefined,
        label: "100",
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: "100",
                protyle: options.protyle,
                avID: options.avID,
                nodeElement: options.nodeElement
            });
        }
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom
    });
};

export const deleteRow = (blockElement: HTMLElement, protyle: IProtyle) => {
    const avID = blockElement.getAttribute("data-av-id");
    const undoOperations: IOperation[] = [];
    const rowElements = blockElement.querySelectorAll(".av__row--select:not(.av__row--header)");
    const blockIds: string[] = [];
    rowElements.forEach(item => {
        blockIds.push(item.querySelector(".av__cell[data-block-id]").getAttribute("data-block-id"));
    });
    rowElements.forEach(item => {
        undoOperations.push({
            action: "insertAttrViewBlock",
            avID,
            previousID: item.previousElementSibling?.getAttribute("data-id") || "",
            srcIDs: [item.getAttribute("data-id")],
            isDetached: item.querySelector('.av__cell[data-detached="true"]') ? true : false,
            blockID: blockElement.dataset.nodeId
        });
    });
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    undoOperations.push({
        action: "doUpdateUpdated",
        id: blockElement.dataset.nodeId,
        data: blockElement.getAttribute("updated")
    });
    transaction(protyle, [{
        action: "removeAttrViewBlock",
        srcIDs: blockIds,
        avID,
    }, {
        action: "doUpdateUpdated",
        id: blockElement.dataset.nodeId,
        data: newUpdated,
    }], undoOperations);
    rowElements.forEach(item => {
        item.remove();
    });
    stickyRow(blockElement, protyle.contentElement.getBoundingClientRect(), "all");
    updateHeader(blockElement.querySelector(".av__row"));
    blockElement.setAttribute("updated", newUpdated);
};

export const insertRows = (blockElement: HTMLElement, protyle: IProtyle, count: number, previousID: string) => {
    const avID = blockElement.getAttribute("data-av-id");
    const srcIDs: string[] = [];
    new Array(count).fill(0).forEach(() => {
        srcIDs.push(Lute.NewNodeID());
    });
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    transaction(protyle, [{
        action: "insertAttrViewBlock",
        avID,
        previousID,
        srcIDs,
        isDetached: true,
        blockID: blockElement.dataset.nodeId,
    }, {
        action: "doUpdateUpdated",
        id: blockElement.dataset.nodeId,
        data: newUpdated,
    }], [{
        action: "removeAttrViewBlock",
        srcIDs,
        avID,
    }, {
        action: "doUpdateUpdated",
        id: blockElement.dataset.nodeId,
        data: blockElement.getAttribute("updated")
    }]);
    insertAttrViewBlockAnimation(protyle, blockElement, srcIDs, previousID, avID);
    blockElement.setAttribute("updated", newUpdated);
};
