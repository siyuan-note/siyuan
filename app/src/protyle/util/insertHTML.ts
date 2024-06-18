import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName, hasClosestByMatchTag} from "./hasClosest";
import * as dayjs from "dayjs";
import {transaction, updateTransaction} from "../wysiwyg/transaction";
import {getContenteditableElement} from "../wysiwyg/getBlock";
import {
    fixTableRange,
    focusBlock,
    focusByWbr,
    getEditorRange,
    getSelectionOffset,
} from "./selection";
import {Constants} from "../../constants";
import {highlightRender} from "../render/highlightRender";
import {scrollCenter} from "../../util/highlightById";
import {updateAttrViewCellAnimation, updateAVName} from "../render/av/action";
import {genCellValue, genCellValueByElement, getTypeByCellElement, updateCellsValue} from "../render/av/cell";
import {input} from "../wysiwyg/input";
import {objEquals} from "../../util/functions";
import {fetchPost} from "../../util/fetch";
import {mergeAddOption} from "../render/av/select";

const processAV = (range: Range, html: string, protyle: IProtyle, blockElement: HTMLElement) => {
    const tempElement = document.createElement("template");
    tempElement.innerHTML = html;
    let values: IAVCellValue[][] = [];
    if (html.endsWith("]") && html.startsWith("[")) {
        try {
            values = JSON.parse(html);
        } catch (e) {
            console.warn("insert cell: JSON.parse error");
        }
    } else if (tempElement.content.querySelector("table")) {
        tempElement.content.querySelectorAll("tr").forEach(item => {
            values.push([]);
            Array.from(item.children).forEach(cell => {
                values[values.length - 1].push({
                    text: {content: cell.textContent},
                    type: "text"
                });
            });
        });
    }
    const avID = blockElement.dataset.avId;
    fetchPost("/api/av/getAttributeViewKeysByAvID", {avID}, (response) => {
        const columns: IAVColumn[] = response.data;
        if (values && Array.isArray(values) && values.length > 0) {
            const cellElements: Element[] = Array.from(blockElement.querySelectorAll(".av__cell--active, .av__cell--select")) || [];
            if (cellElements.length === 0) {
                blockElement.querySelectorAll(".av__row--select:not(.av__row--header)").forEach(rowElement => {
                    rowElement.querySelectorAll(".av__cell").forEach(cellElement => {
                        cellElements.push(cellElement);
                    });
                });
            }
            if (cellElements.length === 0) {
                cellElements.push(blockElement.querySelector(".av__row:not(.av__row--header) .av__cell"));
            }
            const doOperations: IOperation[] = [];
            const undoOperations: IOperation[] = [];

            const avID = blockElement.dataset.avId;
            const id = blockElement.dataset.nodeId;
            let currentRowElement: Element;
            const firstColIndex = cellElements[0].getAttribute("data-col-id");
            values.find(rowItem => {
                if (!currentRowElement) {
                    currentRowElement = cellElements[0].parentElement;
                } else {
                    currentRowElement = currentRowElement.nextElementSibling;
                }
                if (!currentRowElement.classList.contains("av__row")) {
                    return true;
                }
                let cellElement: HTMLElement;
                rowItem.find(cellValue => {
                    if (!cellElement) {
                        cellElement = currentRowElement.querySelector(`.av__cell[data-col-id="${firstColIndex}"]`) as HTMLElement;
                    } else {
                        cellElement = cellElement.nextElementSibling as HTMLElement;
                    }
                    if (!cellElement.classList.contains("av__cell")) {
                        return true;
                    }
                    const type = getTypeByCellElement(cellElement) || cellElement.dataset.type as TAVCol;
                    if (["created", "updated", "template", "rollup"].includes(type) ||
                        (type === "block" && !cellElement.dataset.detached)) {
                        return;
                    }
                    const rowID = currentRowElement.getAttribute("data-id");
                    const cellId = cellElement.getAttribute("data-id");
                    const colId = cellElement.getAttribute("data-col-id");

                    const oldValue = genCellValueByElement(type, cellElement);
                    if (cellValue.type !== type &&
                        !(["select", "mSelect"].includes(type) && ["select", "mSelect"].includes(cellValue.type))) {
                        if (type === "date") {
                            // 类型不能转换时就不进行替换
                            return;
                        }
                        const content = cellValue[cellValue.type as "text"]?.content;
                        if (!content) {
                            return;
                        }
                        cellValue = genCellValue(type, cellValue[cellValue.type as "text"].content.toString());
                    }
                    if (cellValue.type === "block") {
                        cellValue.isDetached = true;
                        delete cellValue.block.id;
                    } else if (type === "select" || type === "mSelect") {
                        const operations = mergeAddOption(columns.find(e => e.id === cellElement.dataset.colId), cellValue, avID);
                        doOperations.push(...operations.doOperations);
                        undoOperations.push(...operations.undoOperations);
                    }
                    cellValue.id = cellId;
                    if ((cellValue.type === "date" && typeof cellValue.date === "string") ||
                        (cellValue.type === "relation" && typeof cellValue.relation === "string")) {
                        return;
                    }
                    if (objEquals(cellValue, oldValue)) {
                        return;
                    }
                    doOperations.push({
                        action: "updateAttrViewCell",
                        id: cellId,
                        avID,
                        keyID: colId,
                        rowID,
                        data: cellValue
                    });
                    undoOperations.push({
                        action: "updateAttrViewCell",
                        id: cellId,
                        avID,
                        keyID: colId,
                        rowID,
                        data: oldValue
                    });
                    updateAttrViewCellAnimation(cellElement, cellValue);
                });
            });
            if (doOperations.length > 0) {
                doOperations.push({
                    action: "doUpdateUpdated",
                    id,
                    data: dayjs().format("YYYYMMDDHHmmss"),
                });
                undoOperations.push({
                    action: "doUpdateUpdated",
                    id,
                    data: blockElement.getAttribute("updated"),
                });
                transaction(protyle, doOperations, undoOperations);
            }
            return;
        }

        const contenteditableElement = getContenteditableElement(tempElement.content.firstElementChild);
        if (contenteditableElement && contenteditableElement.childNodes.length === 1 && contenteditableElement.firstElementChild?.getAttribute("data-type") === "block-ref") {
            const selectCellElement = blockElement.querySelector(".av__cell--select") as HTMLElement;
            if (selectCellElement) {
                const sourceId = contenteditableElement.firstElementChild.getAttribute("data-id");
                const previousID = selectCellElement.dataset.blockId;
                transaction(protyle, [{
                    action: "replaceAttrViewBlock",
                    avID,
                    previousID,
                    nextID: sourceId,
                    isDetached: false,
                }], [{
                    action: "replaceAttrViewBlock",
                    avID,
                    previousID: sourceId,
                    nextID: previousID,
                    isDetached: selectCellElement.dataset.detached === "true",
                }]);
                return;
            }
        }

        const text = protyle.lute.BlockDOM2Content(html);
        const cellsElement: HTMLElement[] = Array.from(blockElement.querySelectorAll(".av__cell--select"));
        const rowsElement = blockElement.querySelector(".av__row--select");

        if (rowsElement) {
            updateCellsValue(protyle, blockElement as HTMLElement, text, undefined, columns, html);
        } else if (cellsElement.length > 0) {
            updateCellsValue(protyle, blockElement as HTMLElement, text, cellsElement, columns, html);
        } else if (hasClosestByClassName(range.startContainer, "av__title")) {
            range.insertNode(document.createTextNode(text));
            range.collapse(false);
            updateAVName(protyle, blockElement);
        }
    });
};

export const insertHTML = (html: string, protyle: IProtyle, isBlock = false,
                           // 移动端插入嵌入块时，获取到的 range 为旧值
                           useProtyleRange = false,
                           insertByCursor = false) => {
    if (html === "") {
        return;
    }
    const range = useProtyleRange ? protyle.toolbar.range : getEditorRange(protyle.wysiwyg.element);
    fixTableRange(range);
    let tableInlineHTML;
    if (hasClosestByAttribute(range.startContainer, "data-type", "NodeTable") && !isBlock) {
        if (hasClosestByMatchTag(range.startContainer, "TABLE")) {
            tableInlineHTML = protyle.lute.BlockDOM2InlineBlockDOM(html);
        } else {
            // https://github.com/siyuan-note/siyuan/issues/9411
            isBlock = true;
        }
    }
    let blockElement = hasClosestBlock(range.startContainer) as Element;
    if (!blockElement) {
        // 使用鼠标点击选则模版提示列表后 range 丢失
        if (protyle.toolbar.range) {
            blockElement = hasClosestBlock(protyle.toolbar.range.startContainer) as Element;
        } else {
            blockElement = protyle.wysiwyg.element.firstElementChild as Element;
        }
    }
    if (!blockElement) {
        return;
    }
    if (blockElement.classList.contains("av")) {
        range.deleteContents();
        processAV(range, html, protyle, blockElement as HTMLElement);
        return;
    }
    let id = blockElement.getAttribute("data-node-id");
    range.insertNode(document.createElement("wbr"));
    let oldHTML = blockElement.outerHTML;
    const isNodeCodeBlock = blockElement.getAttribute("data-type") === "NodeCodeBlock";
    if (!isBlock &&
        (isNodeCodeBlock || protyle.toolbar.getCurrentType(range).includes("code"))) {
        range.deleteContents();
        range.insertNode(document.createTextNode(html.replace(/\r\n|\r|\u2028|\u2029/g, "\n")));
        range.collapse(false);
        range.insertNode(document.createElement("wbr"));
        if (isNodeCodeBlock) {
            getContenteditableElement(blockElement).removeAttribute("data-render");
            highlightRender(blockElement);
        } else {
            focusByWbr(blockElement, range);
        }
        blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(protyle, id, blockElement.outerHTML, oldHTML);
        setTimeout(() => {
            scrollCenter(protyle, blockElement, false, "smooth");
        }, Constants.TIMEOUT_LOAD);
        return;
    }

    const undoOperation: IOperation[] = [];
    const doOperation: IOperation[] = [];
    if (range.toString() !== "") {
        const inlineMathElement = hasClosestByAttribute(range.commonAncestorContainer, "data-type", "inline-math");
        if (inlineMathElement) {
            // 表格内选中数学公式 https://ld246.com/article/1631708573504
            inlineMathElement.remove();
        } else if (range.startContainer.nodeType === 3 && range.startContainer.parentElement.getAttribute("data-type")?.indexOf("block-ref") > -1) {
            // ref 选中处理 https://ld246.com/article/1629214377537
            range.startContainer.parentElement.remove();
            // 选中 ref**bbb** 后 alt+[
            range.deleteContents();
        } else {
            range.deleteContents();
        }
        range.insertNode(document.createElement("wbr"));
        undoOperation.push({
            action: "update",
            id,
            data: oldHTML
        });
        doOperation.push({
            action: "update",
            id,
            data: blockElement.outerHTML
        });
    }
    const tempElement = document.createElement("template");

    let innerHTML = tableInlineHTML || // 在 table 中插入需要使用转换好的行内元素 https://github.com/siyuan-note/siyuan/issues/9358
        protyle.lute.SpinBlockDOM(html) || // 需要再 spin 一次 https://github.com/siyuan-note/siyuan/issues/7118
        html;   // 空格会被 Spin 不再，需要使用原文
    // 粘贴纯文本时会进行内部转义，这里需要进行反转义 https://github.com/siyuan-note/siyuan/issues/10620
    innerHTML = innerHTML.replace(/;;;lt;;;/g, "&lt;").replace(/;;;gt;;;/g, "&gt;");
    tempElement.innerHTML = innerHTML;

    const editableElement = getContenteditableElement(blockElement);
    // 使用 lute 方法会添加 p 元素，只有一个 p 元素或者只有一个字符串或者为 <u>b</u> 时的时候只拷贝内部
    if (!isBlock) {
        if (tempElement.content.firstChild.nodeType === 3 ||
            (tempElement.content.firstChild.nodeType !== 3 &&
                ((tempElement.content.firstElementChild.classList.contains("p") && tempElement.content.childElementCount === 1) ||
                    tempElement.content.firstElementChild.tagName !== "DIV"))) {
            if (tempElement.content.firstChild.nodeType !== 3 && tempElement.content.firstElementChild.classList.contains("p")) {
                tempElement.innerHTML = tempElement.content.firstElementChild.firstElementChild.innerHTML.trim();
            }
            // 粘贴带样式的行内元素到另一个行内元素中需进行切割
            const spanElement = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer as HTMLElement;
            if (spanElement.tagName === "SPAN" && spanElement.isSameNode(range.endContainer.nodeType === 3 ? range.endContainer.parentElement : range.endContainer) &&
                // 粘贴纯文本不需切割 https://ld246.com/article/1665556907936
                // emoji 图片需要切割 https://github.com/siyuan-note/siyuan/issues/9370
                tempElement.content.querySelector("span, img")
            ) {
                const afterElement = document.createElement("span");
                const attributes = spanElement.attributes;
                for (let i = 0; i < attributes.length; i++) {
                    afterElement.setAttribute(attributes[i].name, attributes[i].value);
                }
                range.setEnd(spanElement.lastChild, spanElement.lastChild.textContent.length);
                afterElement.append(range.extractContents());
                spanElement.after(afterElement);
                range.setStartBefore(afterElement);
                range.collapse(true);
            }
            range.insertNode(tempElement.content.cloneNode(true));
            range.collapse(false);
            blockElement.querySelector("wbr")?.remove();
            protyle.wysiwyg.lastHTMLs[id] = oldHTML;
            input(protyle, blockElement as HTMLElement, range);
            return;
        }
    }
    const cursorLiElement = hasClosestByClassName(blockElement, "li");
    // 列表项不能单独进行粘贴 https://ld246.com/article/1628681120576/comment/1628681209731#comments
    if (tempElement.content.children[0]?.getAttribute("data-type") === "NodeListItem") {
        if (cursorLiElement) {
            blockElement = cursorLiElement;
            id = blockElement.getAttribute("data-node-id");
            oldHTML = blockElement.outerHTML;
        } else {
            const liItemElement = tempElement.content.children[0];
            const subType = liItemElement.getAttribute("data-subtype");
            tempElement.innerHTML = `<div${subType === "o" ? " data-marker=\"1.\"" : ""} data-subtype="${subType}" data-node-id="${Lute.NewNodeID()}" data-type="NodeList" class="list">${html}<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
        }
    }
    let lastElement: Element;
    let insertBefore = false;
    if (!range.toString() && insertByCursor) {
        const positon = getSelectionOffset(blockElement, protyle.wysiwyg.element, range);
        if (positon.start === 0 && editableElement.textContent !== "") {
            insertBefore = true;
        }
    }
    (insertBefore ? Array.from(tempElement.content.children) : Array.from(tempElement.content.children).reverse()).forEach((item) => {
        let addId = item.getAttribute("data-node-id");
        if (addId === id) {
            doOperation.push({
                action: "update",
                data: item.outerHTML,
                id: addId,
            });
            undoOperation.push({
                action: "update",
                id: addId,
                data: oldHTML,
            });
        } else {
            if (item.classList.contains("li") && !blockElement.parentElement.classList.contains("list")) {
                // https://github.com/siyuan-note/siyuan/issues/6534
                addId = Lute.NewNodeID();
                const liElement = document.createElement("div");
                liElement.setAttribute("data-subtype", item.getAttribute("data-subtype"));
                liElement.setAttribute("data-node-id", addId);
                liElement.setAttribute("data-type", "NodeList");
                liElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                liElement.classList.add("list");
                liElement.append(item);
                item = liElement;
            }
            doOperation.push({
                action: "insert",
                data: item.outerHTML,
                id: addId,
                nextID: insertBefore ? id : undefined,
                previousID: insertBefore ? undefined : id
            });
            undoOperation.push({
                action: "delete",
                id: addId,
            });
        }
        if (insertBefore) {
            blockElement.before(item);
        } else {
            blockElement.after(item);
        }
        if (!lastElement) {
            lastElement = item;
        }
    });
    if (editableElement && editableElement.textContent === "" && blockElement.classList.contains("p")) {
        // 选中当前块所有内容粘贴再撤销会导致异常 https://ld246.com/article/1662542137636
        doOperation.find((item, index) => {
            if (item.id === id) {
                doOperation.splice(index, 1);
                return true;
            }
        });
        doOperation.push({
            action: "delete",
            id
        });
        // 选中当前块所有内容粘贴再撤销会导致异常 https://ld246.com/article/1662542137636
        undoOperation.find((item, index) => {
            if (item.id === id && item.action === "update") {
                undoOperation.splice(index, 1);
                return true;
            }
        });
        undoOperation.push({
            action: "insert",
            data: oldHTML,
            id,
            previousID: blockElement.previousElementSibling ? blockElement.previousElementSibling.getAttribute("data-node-id") : "",
            parentID: blockElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
        });
        blockElement.remove();
    }
    if (lastElement) {
        // https://github.com/siyuan-note/siyuan/issues/5591
        focusBlock(lastElement, undefined, false);
    }
    const wbrElement = protyle.wysiwyg.element.querySelector("wbr");
    if (wbrElement) {
        wbrElement.remove();
    }
    transaction(protyle, doOperation, undoOperation);
};
