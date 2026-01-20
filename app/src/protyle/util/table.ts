import {updateTransaction} from "../wysiwyg/transaction";
import {
    getSelectionOffset,
    focusByWbr,
    focusByRange,
    focusBlock,
    getSelectionPosition,
} from "./selection";
import {hasClosestBlock, hasClosestByClassName, hasClosestByTag} from "./hasClosest";
import {matchHotKey} from "./hotKey";
import {isNotCtrl} from "./compatibility";
import {scrollCenter} from "../../util/highlightById";
import {insertEmptyBlock} from "../../block/util";
import {removeBlock} from "../wysiwyg/remove";
import {hasNextSibling, hasPreviousSibling} from "../wysiwyg/getBlock";
import * as dayjs from "dayjs";

const scrollToView = (nodeElement: Element, rowElement: HTMLElement, protyle: IProtyle) => {
    if (nodeElement.getAttribute("custom-pinthead") === "true") {
        const tableElement = nodeElement.querySelector("table");
        if (tableElement.clientHeight + tableElement.scrollTop < rowElement.offsetTop + rowElement.clientHeight) {
            tableElement.scrollTop = rowElement.offsetTop - tableElement.clientHeight + rowElement.clientHeight + 1;
        } else if (tableElement.scrollTop > rowElement.offsetTop - rowElement.clientHeight) {
            tableElement.scrollTop = rowElement.offsetTop - rowElement.clientHeight + 1;
        }
    } else {
        scrollCenter(protyle, rowElement);
    }
};

export const getColIndex = (cellElement: HTMLElement) => {
    let previousElement = cellElement.previousElementSibling;
    let index = 0;
    while (previousElement) {
        index++;
        previousElement = previousElement.previousElementSibling;
    }
    return index;
};

// 光标设置到前一个表格中
const goPreviousCell = (cellElement: HTMLElement, range: Range, isSelected = true) => {
    let previousElement = cellElement.previousElementSibling;
    if (!previousElement) {
        if (cellElement.parentElement.previousElementSibling) {
            previousElement = cellElement.parentElement.previousElementSibling.lastElementChild;
        } else if (cellElement.parentElement.parentElement.tagName === "TBODY" &&
            cellElement.parentElement.parentElement.previousElementSibling) {
            previousElement = cellElement.parentElement
                .parentElement.previousElementSibling.lastElementChild.lastElementChild;
        } else {
            previousElement = null;
        }
    }
    if (previousElement) {
        range.selectNodeContents(previousElement);
        if (!isSelected) {
            range.collapse(false);
        }
        focusByRange(range);
    }
    return previousElement;
};

export const setTableAlign = (protyle: IProtyle, cellElements: HTMLElement[], nodeElement: Element, type: string, range: Range) => {
    range.insertNode(document.createElement("wbr"));
    const html = nodeElement.outerHTML;

    const tableElement = nodeElement.querySelector("table");
    const columnCnt = tableElement.rows[0].cells.length;
    const rowCnt = tableElement.rows.length;
    const currentColumns: number[] = [];

    for (let i = 0; i < rowCnt; i++) {
        for (let j = 0; j < columnCnt; j++) {
            if (tableElement.rows[i].cells[j] === cellElements[currentColumns.length]) {
                currentColumns.push(j);
            }
        }
        if (currentColumns.length > 0) {
            break;
        }
    }
    for (let k = 0; k < rowCnt; k++) {
        currentColumns.forEach(item => {
            tableElement.rows[k].cells[item].setAttribute("align", type);
        });
    }
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
    focusByWbr(tableElement, range);
};

export const insertRow = (protyle: IProtyle, range: Range, cellElement: HTMLElement, nodeElement: Element) => {
    const wbrElement = document.createElement("wbr");
    range.insertNode(wbrElement);
    const html = nodeElement.outerHTML;
    wbrElement.remove();

    let rowHTML = "";
    for (let m = 0; m < cellElement.parentElement.childElementCount; m++) {
        rowHTML += `<td align="${cellElement.parentElement.children[m].getAttribute("align") || ""}"></td>`;
    }
    let newRowElememt: HTMLTableRowElement;
    if (cellElement.tagName === "TH") {
        const tbodyElement = nodeElement.querySelector("tbody");
        if (tbodyElement) {
            tbodyElement.insertAdjacentHTML("afterbegin", `<tr>${rowHTML}</tr>`);
            newRowElememt = tbodyElement.firstElementChild as HTMLTableRowElement;
        } else {
            cellElement.parentElement.parentElement.insertAdjacentHTML("afterend", `<tbody><tr>${rowHTML}</tr></tbody>`);
            newRowElememt = cellElement.parentElement.parentElement.nextElementSibling.firstElementChild as HTMLTableRowElement;
        }
    } else {
        cellElement.parentElement.insertAdjacentHTML("afterend", `<tr>${rowHTML}</tr>`);
        newRowElememt = cellElement.parentElement.nextElementSibling as HTMLTableRowElement;
    }
    range.selectNodeContents(newRowElememt.cells[getColIndex(cellElement)]);
    range.collapse(true);
    focusByRange(range);
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
    scrollToView(nodeElement, newRowElememt, protyle);
};

export const insertRowAbove = (protyle: IProtyle, range: Range, cellElement: HTMLElement, nodeElement: Element) => {
    const wbrElement = document.createElement("wbr");
    range.insertNode(wbrElement);
    const html = nodeElement.outerHTML;
    wbrElement.remove();
    let rowHTML = "";
    let hasNone = false;

    for (let m = 0; m < cellElement.parentElement.childElementCount; m++) {
        const currentCellElement = cellElement.parentElement.children[m] as HTMLTableCellElement;
        const className = currentCellElement.className;
        if (className === "fn__none") {
            hasNone = true;
        }
        // 不需要空格，否则列宽调整后在空格后插入图片会换行 https://github.com/siyuan-note/siyuan/issues/7631
        if (cellElement.tagName === "TH") {
            rowHTML += `<th class="${currentCellElement.className}" colspan="${currentCellElement.colSpan}" align="${currentCellElement.getAttribute("align")}"></th>`;
        } else {
            rowHTML += `<td class="${currentCellElement.className}" colspan="${currentCellElement.colSpan}" align="${currentCellElement.getAttribute("align")}"></td>`;
        }
    }

    if (hasNone) {
        let previousTrElement = cellElement.parentElement.previousElementSibling;
        let rowCount = 1;
        while (previousTrElement) {
            rowCount++;
            Array.from(previousTrElement.children).forEach((cell: HTMLTableCellElement) => {
                if (cell.rowSpan >= rowCount && cell.rowSpan > 1) {
                    cell.rowSpan = cell.rowSpan + 1;
                }
            });
            previousTrElement = previousTrElement.previousElementSibling;
        }
    }
    let newRowElememt: HTMLTableRowElement;
    if (cellElement.parentElement.parentElement.tagName === "THEAD" && !cellElement.parentElement.previousElementSibling) {
        cellElement.parentElement.parentElement.insertAdjacentHTML("beforebegin", `<thead><tr>${rowHTML}</tr></thead>`);
        newRowElememt = nodeElement.querySelector("thead tr");
        cellElement.parentElement.parentElement.nextElementSibling.insertAdjacentHTML("afterbegin", cellElement.parentElement.parentElement.innerHTML.replace(/<th/g, "<td").replace(/<\/th>/g, "</td>"));
        cellElement.parentElement.parentElement.remove();
    } else {
        cellElement.parentElement.insertAdjacentHTML("beforebegin", `<tr>${rowHTML}</tr>`);
        newRowElememt = cellElement.parentElement.previousElementSibling as HTMLTableRowElement;
    }
    range.selectNodeContents(newRowElememt.cells[getColIndex(cellElement)]);
    range.collapse(true);
    focusByRange(range);
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
    scrollToView(nodeElement, newRowElememt, protyle);
};

export const insertColumn = (protyle: IProtyle, nodeElement: Element, cellElement: HTMLElement, type: InsertPosition, range: Range) => {
    const wbrElement = document.createElement("wbr");
    range.insertNode(wbrElement);
    const html = nodeElement.outerHTML;
    wbrElement.remove();
    const index = getColIndex(cellElement);
    const tableElement = nodeElement.querySelector("table");
    for (let i = 0; i < tableElement.rows.length; i++) {
        const colCellElement = tableElement.rows[i].cells[index];
        const newCellElement = document.createElement(colCellElement.tagName);
        colCellElement.insertAdjacentElement(type, newCellElement);
        if (colCellElement === cellElement) {
            newCellElement.innerHTML = "<wbr> ";
            // 滚动条横向定位
            if (newCellElement.offsetLeft + newCellElement.clientWidth > nodeElement.firstElementChild.scrollLeft + nodeElement.firstElementChild.clientWidth) {
                nodeElement.firstElementChild.scrollLeft = newCellElement.offsetLeft + newCellElement.clientWidth - nodeElement.firstElementChild.clientWidth;
            }
        } else {
            newCellElement.textContent = " ";
        }
    }
    tableElement.querySelectorAll("col")[index].insertAdjacentHTML(type, "<col style='min-width: 60px;'>");
    focusByWbr(nodeElement, range);
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
};

export const deleteRow = (protyle: IProtyle, range: Range, cellElement: HTMLElement, nodeElement: Element) => {
    if (cellElement.parentElement.parentElement.tagName !== "THEAD") {
        const wbrElement = document.createElement("wbr");
        range.insertNode(wbrElement);
        const html = nodeElement.outerHTML;
        wbrElement.remove();
        const index = getColIndex(cellElement);
        const tbodyElement = cellElement.parentElement.parentElement;
        let previousTrElement = tbodyElement.previousElementSibling.lastElementChild as HTMLTableRowElement;
        if (cellElement.parentElement.previousElementSibling) {
            previousTrElement = cellElement.parentElement.previousElementSibling as HTMLTableRowElement;
        }

        if (tbodyElement.childElementCount === 1) {
            tbodyElement.remove();
        } else {
            cellElement.parentElement.remove();
        }
        range.selectNodeContents(previousTrElement.cells[index]);
        range.collapse(true);
        focusByRange(range);
        scrollToView(nodeElement, previousTrElement, protyle);
        updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
    }
};

export const deleteColumn = (protyle: IProtyle, range: Range, nodeElement: Element, cellElement: HTMLElement) => {
    const wbrElement = document.createElement("wbr");
    range.insertNode(wbrElement);
    const html = nodeElement.outerHTML;
    wbrElement.remove();
    const index = getColIndex(cellElement);
    const sideCellElement = (cellElement.previousElementSibling || cellElement.nextElementSibling) as HTMLElement;
    if (sideCellElement) {
        range.selectNodeContents(sideCellElement);
        range.collapse(true);
        // 滚动条横向定位
        if (sideCellElement.offsetLeft + sideCellElement.clientWidth > nodeElement.firstElementChild.scrollLeft + nodeElement.firstElementChild.clientWidth) {
            nodeElement.firstElementChild.scrollLeft = sideCellElement.offsetLeft + sideCellElement.clientWidth - nodeElement.firstElementChild.clientWidth;
        }
    } else {
        nodeElement.classList.add("protyle-wysiwyg--select");
        removeBlock(protyle, nodeElement, range, "remove");
        return;
    }
    const tableElement = nodeElement.querySelector("table");
    for (let i = 0; i < tableElement.rows.length; i++) {
        const cells = tableElement.rows[i].cells;
        if (cells.length === 1) {
            tableElement.remove();
            break;
        }
        cells[index].remove();
    }
    nodeElement.querySelectorAll("col")[index]?.remove();
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
    focusByRange(range);
};

export const moveRowToUp = (protyle: IProtyle, range: Range, cellElement: HTMLElement, nodeElement: Element) => {
    const rowElement = cellElement.parentElement;
    if (rowElement.parentElement.tagName === "THEAD") {
        return;
    }
    range.insertNode(document.createElement("wbr"));
    const html = nodeElement.outerHTML;
    if (rowElement.previousElementSibling) {
        rowElement.after(rowElement.previousElementSibling);
    } else {
        const headElement = rowElement.parentElement.previousElementSibling.firstElementChild;
        headElement.querySelectorAll("th").forEach(item => {
            const tdElement = document.createElement("td");
            tdElement.innerHTML = item.innerHTML;
            item.parentNode.replaceChild(tdElement, item);
        });
        rowElement.querySelectorAll("td").forEach(item => {
            const thElement = document.createElement("th");
            thElement.innerHTML = item.innerHTML;
            item.parentNode.replaceChild(thElement, item);
        });
        rowElement.after(headElement);
        rowElement.parentElement.previousElementSibling.append(rowElement);
    }
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
    focusByWbr(nodeElement, range);
    scrollCenter(protyle, rowElement);
};

export const moveRowToDown = (protyle: IProtyle, range: Range, cellElement: HTMLElement, nodeElement: Element) => {
    const rowElement = cellElement.parentElement;
    if ((rowElement.parentElement.tagName === "TBODY" && !rowElement.nextElementSibling) ||
        (rowElement.parentElement.tagName === "THEAD" && !rowElement.parentElement.nextElementSibling)) {
        return;
    }
    range.insertNode(document.createElement("wbr"));
    const html = nodeElement.outerHTML;
    if (rowElement.nextElementSibling) {
        rowElement.before(rowElement.nextElementSibling);
    } else {
        const firstRowElement = rowElement.parentElement.nextElementSibling.firstElementChild;
        firstRowElement.querySelectorAll("td").forEach(item => {
            const thElement = document.createElement("th");
            thElement.innerHTML = item.innerHTML;
            item.parentNode.replaceChild(thElement, item);
        });
        rowElement.querySelectorAll("th").forEach(item => {
            const tdElement = document.createElement("td");
            tdElement.innerHTML = item.innerHTML;
            item.parentNode.replaceChild(tdElement, item);
        });
        rowElement.after(firstRowElement);
        rowElement.parentElement.nextElementSibling.insertAdjacentElement("afterbegin", rowElement);
    }
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
    focusByWbr(nodeElement, range);
    scrollCenter(protyle, rowElement);
};

export const moveColumnToLeft = (protyle: IProtyle, range: Range, cellElement: HTMLElement, nodeElement: Element) => {
    if (!cellElement.previousElementSibling) {
        return;
    }
    range.insertNode(document.createElement("wbr"));
    const html = nodeElement.outerHTML;
    let cellIndex = 0;
    Array.from(cellElement.parentElement.children).find((item, index) => {
        if (cellElement === item) {
            cellIndex = index;
            return true;
        }
    });

    nodeElement.querySelectorAll("tr").forEach((trElement) => {
        trElement.cells[cellIndex].after(trElement.cells[cellIndex - 1]);
    });
    // 滚动条横向定位
    if (cellElement.offsetLeft < nodeElement.firstElementChild.scrollLeft) {
        nodeElement.firstElementChild.scrollLeft = cellElement.offsetLeft;
    }
    const colElements = nodeElement.querySelectorAll("col");
    colElements[cellIndex].after(colElements[cellIndex - 1]);
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
    focusByWbr(nodeElement, range);
};

export const moveColumnToRight = (protyle: IProtyle, range: Range, cellElement: HTMLElement, nodeElement: Element) => {
    if (!cellElement.nextElementSibling) {
        return;
    }
    range.insertNode(document.createElement("wbr"));
    const html = nodeElement.outerHTML;
    let cellIndex = 0;
    Array.from(cellElement.parentElement.children).find((item, index) => {
        if (cellElement === item) {
            cellIndex = index;
            return true;
        }
    });
    nodeElement.querySelectorAll("tr").forEach((trElement) => {
        trElement.cells[cellIndex].before(trElement.cells[cellIndex + 1]);
    });
    // 滚动条横向定位
    if (cellElement.offsetLeft + cellElement.clientWidth > nodeElement.firstElementChild.scrollLeft + nodeElement.firstElementChild.clientWidth) {
        nodeElement.firstElementChild.scrollLeft = cellElement.offsetLeft + cellElement.clientWidth - nodeElement.firstElementChild.clientWidth;
    }
    const colElements = nodeElement.querySelectorAll("col");
    colElements[cellIndex].before(colElements[cellIndex + 1]);
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
    focusByWbr(nodeElement, range);
};

export const fixTable = (protyle: IProtyle, event: KeyboardEvent, range: Range) => {
    const cellElement = hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH");
    const nodeElement = hasClosestBlock(range.startContainer) as HTMLTableElement;
    if (!cellElement || !nodeElement) {
        return false;
    }

    if (event.key === "Backspace" && range.toString() === "") {
        const previousElement = hasPreviousSibling(range.startContainer) as Element;
        if (range.startOffset === 1 && previousElement.nodeType === 1 && previousElement.tagName === "BR" &&
            range.startContainer.textContent.length === 1 && !hasNextSibling(range.startContainer)) {
            previousElement.insertAdjacentHTML("beforebegin", "<br>");
            return false;
        }
    }

    // shift+enter 软换行
    if (event.key === "Enter" && event.shiftKey && isNotCtrl(event) && !event.altKey) {
        const wbrElement = document.createElement("wbr");
        range.insertNode(wbrElement);
        const oldHTML = nodeElement.outerHTML;
        wbrElement.remove();
        if (cellElement && !cellElement.innerHTML.endsWith("<br>")) {
            cellElement.insertAdjacentHTML("beforeend", "<br>");
        }
        range.extractContents();
        const types = protyle.toolbar.getCurrentType(range);
        if (types.includes("code") && range.startContainer.nodeType !== 3) {
            // https://github.com/siyuan-note/siyuan/issues/4169
            const brElement = document.createElement("br");
            (range.startContainer as HTMLElement).after(brElement);
            range.setStartAfter(brElement);
        } else {
            range.insertNode(document.createElement("br"));
        }
        range.collapse(false);
        scrollCenter(protyle);
        updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
        event.preventDefault();
        return true;
    }

    if (!nodeElement.classList.contains("protyle-wysiwyg--select") && !hasClosestByClassName(nodeElement, "protyle-wysiwyg--select")) {
        // enter 光标跳转到下一行同列
        if (isNotCtrl(event) && !event.shiftKey && !event.altKey && event.key === "Enter") {
            event.preventDefault();
            const trElement = cellElement.parentElement as HTMLTableRowElement;
            if ((!trElement.nextElementSibling && trElement.parentElement.tagName === "TBODY") ||
                (trElement.parentElement.tagName === "THEAD" && !trElement.parentElement.nextElementSibling)) {
                insertEmptyBlock(protyle, "afterend", nodeElement.getAttribute("data-node-id"));
                return true;
            }
            let nextElement = trElement.nextElementSibling as HTMLTableRowElement;
            if (!nextElement) {
                nextElement = trElement.parentElement.nextElementSibling.firstChild as HTMLTableRowElement;
            }
            if (!nextElement) {
                return true;
            }
            range.selectNodeContents(nextElement.cells[getColIndex(cellElement)]);
            range.collapse(true);
            scrollCenter(protyle);
            return true;
        }
        // 表格后无内容时，按右键需新建空块
        if (event.key === "ArrowRight" && range.toString() === "" &&
            !nodeElement.nextElementSibling &&
            cellElement === nodeElement.querySelector("table").lastElementChild.lastElementChild.lastElementChild &&
            getSelectionOffset(cellElement, protyle.wysiwyg.element, range).start === cellElement.textContent.length) {
            event.preventDefault();
            insertEmptyBlock(protyle, "afterend", nodeElement.getAttribute("data-node-id"));
            return true;
        }
        // tab：光标移向下一个 cell
        if (event.key === "Tab" && isNotCtrl(event)) {
            if (event.shiftKey) {
                // shift + tab 光标移动到前一个 cell
                goPreviousCell(cellElement, range);
                event.preventDefault();
                return true;
            }

            let nextElement = cellElement.nextElementSibling;
            if (!nextElement) {
                if (cellElement.parentElement.nextElementSibling) {
                    nextElement = cellElement.parentElement.nextElementSibling.firstElementChild;
                } else if (cellElement.parentElement.parentElement.tagName === "THEAD" &&
                    cellElement.parentElement.parentElement.nextElementSibling) {
                    nextElement =
                        cellElement.parentElement.parentElement.nextElementSibling.firstElementChild.firstElementChild;
                } else {
                    nextElement = null;
                }
            }
            if (nextElement) {
                range.selectNodeContents(nextElement);
            } else {
                insertRow(protyle, range, cellElement.parentElement.firstElementChild as HTMLTableCellElement, nodeElement);
            }
            event.preventDefault();
            return true;
        }

        if (event.key === "ArrowUp" && isNotCtrl(event) && !event.shiftKey && !event.altKey) {
            if (cellElement.firstChild) {
                let firstChild = cellElement.firstChild;
                while (firstChild) {
                    if (firstChild.textContent === "" && firstChild.nodeType === 3) {
                        firstChild = firstChild.nextSibling;
                    } else {
                        break;
                    }
                }
                const rangeTemp = document.createRange();
                rangeTemp.selectNodeContents(firstChild);
                rangeTemp.collapse(true);
                const rangeRects = range.getClientRects().length === 0 ? getSelectionPosition(cellElement, range) : range.getClientRects()[0];
                const rangeTempRects = rangeTemp.getClientRects().length === 0 ? getSelectionPosition(cellElement, rangeTemp) : rangeTemp.getClientRects()[0];
                if (rangeTempRects.top < rangeRects.top) {
                    return false;
                }
            }
            const trElement = cellElement.parentElement as HTMLTableRowElement;
            let previousElement = trElement.previousElementSibling as HTMLTableRowElement;
            if (!previousElement) {
                previousElement = trElement.parentElement.previousElementSibling.lastElementChild as HTMLTableRowElement;
            }
            if (!previousElement || previousElement?.tagName === "COL") {
                return false;
            }
            range.selectNodeContents(previousElement.cells[getColIndex(cellElement)]);
            range.collapse(false);
            scrollCenter(protyle);
            event.preventDefault();
            return true;
        }

        if (event.key === "ArrowDown" && isNotCtrl(event) && !event.shiftKey && !event.altKey) {
            if (cellElement.lastChild) {
                let lastChild = cellElement.lastChild;
                while (lastChild) {
                    if (lastChild.textContent === "" && lastChild.nodeType === 3) {
                        lastChild = lastChild.previousSibling;
                    } else {
                        break;
                    }
                }
                const rangeTemp = document.createRange();
                rangeTemp.selectNodeContents(lastChild);
                rangeTemp.collapse(false);
                if (getSelectionPosition(cellElement, rangeTemp).top > getSelectionPosition(cellElement, range).top) {
                    return false;
                }
            }
            const trElement = cellElement.parentElement as HTMLTableRowElement;
            if ((!trElement.nextElementSibling && trElement.parentElement.tagName === "TBODY") ||
                (trElement.parentElement.tagName === "THEAD" && !trElement.parentElement.nextElementSibling)) {
                return false;
            }
            let nextElement = trElement.nextElementSibling as HTMLTableRowElement;
            if (!nextElement) {
                nextElement = trElement.parentElement.nextElementSibling.firstChild as HTMLTableRowElement;
            }
            if (!nextElement) {
                return false;
            }
            range.selectNodeContents(nextElement.cells[getColIndex(cellElement)]);
            range.collapse(true);
            scrollCenter(protyle);
            event.preventDefault();
            return true;
        }

        // Backspace：光标移动到前一个 cell
        if (isNotCtrl(event) && !event.shiftKey && !event.altKey && event.key === "Backspace"
            && getSelectionOffset(cellElement, protyle.wysiwyg.element, range).start === 0 && range.toString() === "" &&
            // 空换行无法删除 https://github.com/siyuan-note/siyuan/issues/2732
            (range.startOffset === 0 || (range.startOffset === 1 && cellElement.querySelectorAll("br").length === 1))) {
            const previousCellElement = goPreviousCell(cellElement, range, false);
            if (!previousCellElement && nodeElement.previousElementSibling) {
                focusBlock(nodeElement.previousElementSibling, undefined, false);
            }
            scrollCenter(protyle);
            event.preventDefault();
            return true;
        }

        // 居左
        if (matchHotKey(window.siyuan.config.keymap.editor.general.alignLeft.custom, event)) {
            setTableAlign(protyle, [cellElement], nodeElement, "left", range);
            event.preventDefault();
            return true;
        }
        // 居中
        if (matchHotKey(window.siyuan.config.keymap.editor.general.alignCenter.custom, event)) {
            setTableAlign(protyle, [cellElement], nodeElement, "center", range);
            event.preventDefault();
            return true;
        }
        // 居右
        if (matchHotKey(window.siyuan.config.keymap.editor.general.alignRight.custom, event)) {
            setTableAlign(protyle, [cellElement], nodeElement, "right", range);
            event.preventDefault();
            return true;
        }
    }

    const tableElement = nodeElement.querySelector("table");
    const hasNone = cellElement.parentElement.querySelector(".fn__none");
    let hasColSpan = false;
    let hasRowSpan = false;
    Array.from(cellElement.parentElement.children).forEach((item: HTMLTableCellElement) => {
        if (item.colSpan > 1) {
            hasColSpan = true;
        }
        if (item.rowSpan > 1) {
            hasRowSpan = true;
        }
    });
    let previousHasNone: false | Element = false;
    let previousHasColSpan = false;
    let previousHasRowSpan = false;
    let previousRowElement = cellElement.parentElement.previousElementSibling;
    if (!previousRowElement && cellElement.parentElement.parentElement.tagName === "TBODY") {
        previousRowElement = tableElement.querySelector("thead").lastElementChild;
    }
    if (previousRowElement) {
        previousHasNone = previousRowElement.querySelector(".fn__none");
        Array.from(previousRowElement.children).forEach((item: HTMLTableCellElement) => {
            if (item.colSpan > 1) {
                previousHasColSpan = true;
            }
            if (item.rowSpan > 1) {
                previousHasRowSpan = true;
            }
        });
    }
    let nextHasNone: false | Element = false;
    let nextHasColSpan = false;
    let nextHasRowSpan = false;
    let nextRowElement = cellElement.parentElement.nextElementSibling;
    if (!nextRowElement && cellElement.parentElement.parentElement.tagName === "THEAD") {
        nextRowElement = tableElement.querySelector("tbody")?.firstElementChild;
    }
    if (nextRowElement) {
        nextHasNone = nextRowElement.querySelector(".fn__none");
        Array.from(nextRowElement.children).forEach((item: HTMLTableCellElement) => {
            if (item.colSpan > 1) {
                nextHasColSpan = true;
            }
            if (item.rowSpan > 1) {
                nextHasRowSpan = true;
            }
        });
    }
    const colIndex = getColIndex(cellElement);
    let colIsPure = true;
    Array.from(tableElement.rows).find(item => {
        const cellElement = item.cells[colIndex];
        if (cellElement.classList.contains("fn__none") || cellElement.colSpan > 1 || cellElement.rowSpan > 1) {
            colIsPure = false;
            return true;
        }
    });
    let nextColIsPure = true;
    Array.from(tableElement.rows).find(item => {
        const cellElement = item.cells[colIndex + 1];
        if (cellElement && (cellElement.classList.contains("fn__none") || cellElement.colSpan > 1 || cellElement.rowSpan > 1)) {
            nextColIsPure = false;
            return true;
        }
    });
    let previousColIsPure = true;
    Array.from(tableElement.rows).find(item => {
        const cellElement = item.cells[colIndex - 1];
        if (cellElement && (cellElement.classList.contains("fn__none") || cellElement.colSpan > 1 || cellElement.rowSpan > 1)) {
            previousColIsPure = false;
            return true;
        }
    });
    if (matchHotKey(window.siyuan.config.keymap.editor.table.moveToUp.custom, event)) {
        if ((!hasNone || (hasNone && !hasRowSpan && hasColSpan)) &&
            (!previousHasNone || (previousHasNone && !previousHasRowSpan && previousHasColSpan))) {
            moveRowToUp(protyle, range, cellElement, nodeElement);
        }
        event.preventDefault();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.table.moveToDown.custom, event)) {
        if ((!hasNone || (hasNone && !hasRowSpan && hasColSpan)) &&
            (!nextHasNone || (nextHasNone && !nextHasRowSpan && nextHasColSpan))) {
            moveRowToDown(protyle, range, cellElement, nodeElement);
        }
        event.preventDefault();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.table.moveToLeft.custom, event)) {
        if (colIsPure && previousColIsPure) {
            moveColumnToLeft(protyle, range, cellElement, nodeElement);
        }
        event.preventDefault();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.table.moveToRight.custom, event)) {
        if (colIsPure && nextColIsPure) {
            moveColumnToRight(protyle, range, cellElement, nodeElement);
        }
        event.preventDefault();
        return true;
    }

    // 上方新添加一行
    if (matchHotKey(window.siyuan.config.keymap.editor.table.insertRowAbove.custom, event)) {
        insertRowAbove(protyle, range, cellElement, nodeElement);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    // 下方新添加一行 https://github.com/Vanessa219/vditor/issues/46
    if (matchHotKey(window.siyuan.config.keymap.editor.table.insertRowBelow.custom, event)) {
        if (!nextHasNone || (nextHasNone && !nextHasRowSpan && nextHasColSpan)) {
            insertRow(protyle, range, cellElement, nodeElement);
        }
        event.preventDefault();
        return true;
    }

    // 左方新添加一列
    if (matchHotKey(window.siyuan.config.keymap.editor.table.insertColumnLeft.custom, event)) {
        if (colIsPure || previousColIsPure) {
            insertColumn(protyle, nodeElement, cellElement, "beforebegin", range);
        }
        event.preventDefault();
        return true;
    }

    // 后方新添加一列
    if (matchHotKey(window.siyuan.config.keymap.editor.table.insertColumnRight.custom, event)) {
        if (colIsPure || nextColIsPure) {
            insertColumn(protyle, nodeElement, cellElement, "afterend", range);
        }
        event.preventDefault();
        return true;
    }

    // 删除当前行
    if (matchHotKey(window.siyuan.config.keymap.editor.table["delete-row"].custom, event)) {
        if ((!hasNone && !hasRowSpan) || //https://github.com/siyuan-note/siyuan/issues/5045
            (hasNone && !hasRowSpan && hasColSpan)) {
            deleteRow(protyle, range, cellElement, nodeElement);
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    // 删除当前列
    if (matchHotKey(window.siyuan.config.keymap.editor.table["delete-column"].custom, event)) {
        if (colIsPure) {
            deleteColumn(protyle, range, nodeElement, cellElement);
        }
        event.preventDefault();
        return true;
    }
};

export const isIncludeCell = (options: {
    tableSelectElement: HTMLElement,
    scrollLeft: number,
    scrollTop: number,
    item: HTMLTableCellElement,
}) => {
    if (options.item.offsetLeft + 6 > options.tableSelectElement.offsetLeft + options.scrollLeft &&
        options.item.offsetLeft + options.item.clientWidth - 6 < options.tableSelectElement.offsetLeft + options.scrollLeft + options.tableSelectElement.clientWidth &&
        options.item.offsetTop + 6 > options.tableSelectElement.offsetTop + options.scrollTop &&
        options.item.offsetTop + options.item.clientHeight - 6 < options.tableSelectElement.offsetTop + options.scrollTop + options.tableSelectElement.clientHeight) {
        return true;
    }
    return false;
};

export const clearTableCell = (protyle: IProtyle, tableBlockElement: HTMLElement) => {
    if (!tableBlockElement) {
        return;
    }
    const tableSelectElement = tableBlockElement.querySelector(".table__select") as HTMLElement;
    const selectCellElements: HTMLTableCellElement[] = [];
    const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
    const scrollTop = tableBlockElement.querySelector("table").scrollTop;
    tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
        if (!item.classList.contains("fn__none") && isIncludeCell({
            tableSelectElement,
            scrollLeft,
            scrollTop,
            item,
        })) {
            selectCellElements.push(item);
        }
    });
    tableSelectElement.removeAttribute("style");
    if (getSelection().rangeCount > 0) {
        const range = getSelection().getRangeAt(0);
        if (tableBlockElement.contains(range.startContainer)) {
            range.insertNode(document.createElement("wbr"));
        }
    }
    const oldHTML = tableBlockElement.outerHTML;
    tableBlockElement.querySelector("wbr")?.remove();
    tableBlockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
    selectCellElements.forEach(item => {
        item.innerHTML = "";
    });
    updateTransaction(protyle, tableBlockElement.getAttribute("data-node-id"), tableBlockElement.outerHTML, oldHTML);
};
