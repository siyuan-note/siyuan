import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {focusBlock} from "../../util/selection";
import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {genCellValue, genCellValueByElement, getTypeByCellElement, renderCell, renderCellAttr} from "./cell";
import {fetchPost} from "../../../util/fetch";
import * as dayjs from "dayjs";
import {Constants} from "../../../constants";
import {insertGalleryItemAnimation} from "./gallery/item";
import {clearSelect} from "../../util/clear";
import {isCustomAttr} from "./blockAttr";

export const getFieldIdByCellElement = (cellElement: Element, viewType: TAVView): string => {
    if (isCustomAttr(cellElement)) {
        return cellElement.getAttribute("data-row-id");
    }
    return (hasClosestByClassName(cellElement, viewType === "table" ? "av__row" : "av__gallery-item") as HTMLElement).dataset.id;
};

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
    const count = rowElement.parentElement.querySelectorAll(".av__row:not(.av__row--header)").length;

    const headElement = rowElement.parentElement.firstElementChild;
    const headUseElement = headElement.querySelector("use");

    if (count === selectCount && count !== 0) {
        headElement.classList.add("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconCheck");
    } else if (selectCount === 0) {
        headElement.classList.remove("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconUncheck");
    } else if (selectCount > 0) {
        headElement.classList.add("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconIndeterminateCheck");
    }

    const counterElement = blockElement.querySelector(".av__counter");
    const allCount = blockElement.querySelectorAll(".av__row--select:not(.av__row--header)").length;
    if (allCount === 0) {
        counterElement.classList.add("fn__none");
        return;
    }
    counterElement.classList.remove("fn__none");
    counterElement.innerHTML = `${allCount} ${window.siyuan.languages.selected}`;
};

export const setPage = (blockElement: Element) => {
    const avType = blockElement.getAttribute("data-av-type") as TAVView;
    blockElement.querySelectorAll(".av__body").forEach((item: HTMLElement) => {
        const pageSize = item.dataset.pageSize;
        if (pageSize) {
            const currentCount = item.querySelectorAll(avType === "table" ? ".av__row:not(.av__row--header)" : ".av__gallery-item").length;
            if (parseInt(pageSize) < currentCount) {
                item.dataset.pageSize = currentCount.toString();
            }
        }
    });
};

/**
 * 前端插入一假行
 * @param options.protyle
 * @param options.blockElement
 * @param options.srcIDs
 * @param options.previousId
 * @param options.avId 存在为新增否则为拖拽插入
 */
export const insertAttrViewBlockAnimation = (options: {
    protyle: IProtyle,
    blockElement: Element,
    srcIDs: string[],   // node id
    previousId: string,
    groupID?: string
}) => {
    (options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement).value = "";
    const groupQuery = options.groupID ? `.av__body[data-group-id="${options.groupID}"] ` : "";
    let previousElement = options.blockElement.querySelector(groupQuery + `.av__row[data-id="${options.previousId}"]`) || options.blockElement.querySelector(groupQuery + ".av__row--header");
    // 有排序需要加入最后一行
    const hasSort = options.blockElement.querySelector('.av__views [data-type="av-sort"]').classList.contains("block__icon--active");
    if (hasSort) {
        previousElement = options.blockElement.querySelector(groupQuery + ".av__row--util").previousElementSibling;
    }
    const bodyElement = options.blockElement.querySelector(`.av__body[data-group-id="${options.groupID}"] `);
    if (bodyElement && ["updated", "created"].includes(bodyElement.getAttribute("data-dtype")) &&
        bodyElement.getAttribute("data-content") !== "_@today@_") {
        previousElement = options.blockElement.querySelector('.av__body[data-content="_@today@_"] .av__row--util')?.previousElementSibling;
    }
    if (!previousElement) {
        return;
    }
    let cellsHTML = '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div></div>';
    const pinIndex = previousElement.querySelectorAll(".av__colsticky .av__cell").length - 1;
    if (pinIndex > -1) {
        cellsHTML = '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
    }
    previousElement.querySelectorAll(".av__cell").forEach((item: HTMLElement, index) => {
        let lineNumber = 1;
        const colType = getTypeByCellElement(item);
        if (colType === "lineNumber") {
            const lineNumberValue = item.querySelector(".av__celltext")?.getAttribute("data-value");
            if (lineNumberValue) {
                lineNumber = parseInt(lineNumberValue);
            }
        }
        cellsHTML += `<div class="av__cell${colType === "checkbox" ? " av__cell-uncheck" : ""}" data-col-id="${item.dataset.colId}" 
data-wrap="${item.dataset.wrap}" 
data-dtype="${item.dataset.dtype}" 
style="width: ${item.style.width};${item.dataset.dtype === "number" ? "text-align: right;" : ""}" 
${colType === "block" ? ' data-detached="true"' : ""}>${renderCell(genCellValue(colType, null), lineNumber)}</div>`;
        if (pinIndex === index) {
            cellsHTML += "</div>";
        }
    });
    let html = "";
    clearSelect(["cell", "row"], options.blockElement);
    options.srcIDs.forEach(() => {
        html += `<div class="av__row" data-type="ghost">
    ${cellsHTML}
</div>`;
    });
    previousElement.insertAdjacentHTML("afterend", html);
    fetchPost("/api/av/getAttributeViewAddingBlockDefaultValues", {
        avID: options.blockElement.getAttribute("data-av-id"),
        viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW),
        groupID: options.groupID,
        previousID: options.previousId,
    }, (response) => {
        if (response.data.values) {
            let popCellElement: HTMLElement;
            const updateIds = Object.keys(response.data.values);
            options.blockElement.querySelectorAll('[data-type="ghost"]').forEach(rowItem => {
                rowItem.querySelectorAll(".av__cell").forEach((cellItem: HTMLElement) => {
                    if (!popCellElement && cellItem.getAttribute("data-detached") === "true") {
                        popCellElement = cellItem;
                    }
                    if (updateIds.includes(cellItem.dataset.colId)) {
                        const cellValue = response.data.values[cellItem.dataset.colId];
                        cellItem.innerHTML = renderCell(cellValue);
                        renderCellAttr(cellItem, cellValue);
                    }
                });
            });
        }
        setPage(options.blockElement);
    });
};

export const stickyRow = (blockElement: HTMLElement, elementRect: DOMRect, status: "top" | "bottom" | "all") => {
    if (blockElement.dataset.avType !== "table") {
        return;
    }
    // 只读模式下也需固定 https://github.com/siyuan-note/siyuan/issues/11338
    const headerElements = blockElement.querySelectorAll(".av__row--header");
    if (headerElements.length > 0 && (status === "top" || status === "all")) {
        headerElements.forEach((item: HTMLElement) => {
            const bodyRect = item.parentElement.getBoundingClientRect();
            const distance = Math.floor(elementRect.top - bodyRect.top);
            if (distance > 0 && distance < bodyRect.height - item.clientHeight) {
                item.style.transform = `translateY(${distance}px)`;
            } else {
                item.style.transform = "";
            }
        });
    }

    const footerElements = blockElement.querySelectorAll(".av__row--footer");
    if (footerElements.length > 0 && (status === "bottom" || status === "all")) {
        footerElements.forEach((item: HTMLElement) => {
            if (item.querySelector(".av__calc--ashow")) {
                const bodyRect = item.parentElement.getBoundingClientRect();
                const distance = Math.ceil(elementRect.bottom - bodyRect.bottom);
                if (distance < 0 && -distance < bodyRect.height - item.clientHeight) {
                    item.style.transform = `translateY(${distance}px)`;
                } else {
                    item.style.transform = "";
                }
            } else {
                item.style.transform = "";
            }
        });
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
    options.nodeElement.querySelectorAll(".av__body").forEach((item: HTMLElement) => {
        item.dataset.pageSize = options.newPageSize;
    });
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
    const menu = new Menu(Constants.MENU_AV_PAGE_SIZE);
    if (menu.isOpen) {
        return;
    }
    const currentPageSize = options.target.dataset.size;
    menu.addItem({
        iconHTML: "",
        label: "5",
        checked: currentPageSize === "5",
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: "5",
                protyle: options.protyle,
                avID: options.avID,
                nodeElement: options.nodeElement
            });
        }
    });
    menu.addItem({
        iconHTML: "",
        label: "10",
        checked: currentPageSize === "10",
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
        checked: currentPageSize === "25",
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
        checked: currentPageSize === "50",
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
        checked: currentPageSize === "100",
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
    menu.addItem({
        iconHTML: "",
        checked: currentPageSize === Constants.SIZE_DATABASE_MAZ_SIZE.toString(),
        label: window.siyuan.languages.all,
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: Constants.SIZE_DATABASE_MAZ_SIZE.toString(),
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
    const rowElements = blockElement.querySelectorAll(".av__row--select:not(.av__row--header), .av__gallery-item--select");
    if (rowElements.length === 0) {
        return;
    }
    const avID = blockElement.getAttribute("data-av-id");
    const undoOperations: IOperation[] = [];
    const blockIds: string[] = [];
    rowElements.forEach(item => {
        blockIds.push(item.getAttribute("data-id"));
    });
    rowElements.forEach(item => {
        const blockValue = genCellValueByElement("block", item.querySelector('.av__cell[data-dtype="block"]'));
        undoOperations.push({
            action: "insertAttrViewBlock",
            avID,
            previousID: item.previousElementSibling?.getAttribute("data-id") || "",
            srcs: [{
                itemID: Lute.NewNodeID(),
                id: item.getAttribute("data-id"),
                isDetached: blockValue.isDetached,
                content: blockValue.block.content
            }],
            blockID: blockElement.dataset.nodeId,
            groupID: item.parentElement.getAttribute("data-group-id")
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

export const insertRows = (options: {
    blockElement: HTMLElement,
    protyle: IProtyle,
    count: number,
    previousID: string,
    groupID?: string
}) => {
    const avID = options.blockElement.getAttribute("data-av-id");
    const srcIDs: string[] = [];
    const srcs: IOperationSrcs[] = [];
    new Array(options.count).fill(0).forEach(() => {
        const newNodeID = Lute.NewNodeID();
        srcIDs.push(newNodeID);
        srcs.push({
            itemID: Lute.NewNodeID(),
            id: newNodeID,
            isDetached: true,
            content: "",
        });
    });
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    transaction(options.protyle, [{
        action: "insertAttrViewBlock",
        avID,
        previousID: options.previousID,
        srcs,
        blockID: options.blockElement.dataset.nodeId,
        groupID: options.groupID
    }, {
        action: "doUpdateUpdated",
        id: options.blockElement.dataset.nodeId,
        data: newUpdated,
    }], [{
        action: "removeAttrViewBlock",
        srcIDs,
        avID,
    }, {
        action: "doUpdateUpdated",
        id: options.blockElement.dataset.nodeId,
        data: options.blockElement.getAttribute("updated")
    }]);
    if (["gallery", "kanban"].includes(options.blockElement.getAttribute("data-av-type"))) {
        insertGalleryItemAnimation({
            blockElement: options.blockElement,
            protyle: options.protyle,
            srcIDs,
            previousId: options.previousID,
            groupID: options.groupID
        });
    } else {
        insertAttrViewBlockAnimation({
            protyle: options.protyle,
            blockElement: options.blockElement,
            srcIDs,
            previousId: options.previousID,
            groupID: options.groupID
        });
    }
    options.blockElement.setAttribute("updated", newUpdated);
};
