import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName, hasClosestByTag} from "./hasClosest";
import * as dayjs from "dayjs";
import {transaction, updateTransaction} from "../wysiwyg/transaction";
import {getContenteditableElement, getParentBlock} from "../wysiwyg/getBlock";
import {
    fixTableRange,
    focusBlock,
    focusByRange,
    focusByWbr,
    getEditorRange,
    getSelectionOffset,
    setLastNodeRange,
} from "./selection";
import {Constants} from "../../constants";
import {highlightRender} from "../render/highlightRender";
import {scrollCenter} from "../../util/highlightById";
import {updateAttrViewCellAnimation, updateAVName} from "../render/av/action";
import {updateCellsValue} from "../render/av/cell";
import {input} from "../wysiwyg/input";
import {fetchPost} from "../../util/fetch";
import {isIncludeCell} from "./table";
import {getFieldIdByCellElement} from "../render/av/row";
import {processClonePHElement} from "../render/util";
import {setFold} from "../../menus/protyle";

const processAV = (range: Range, html: string, protyle: IProtyle, blockElement: HTMLElement) => {
    const tempElement = document.createElement("template");
    tempElement.innerHTML = html;
    let values: string[][] = [];
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
                values[values.length - 1].push(cell.textContent);
            });
        });
    }
    const avID = blockElement.dataset.avId;
    fetchPost("/api/av/getAttributeViewKeysByAvID", {avID}, async (response) => {
        const columns: IAVColumn[] = response.data;
        const cellElements: HTMLElement[] = Array.from(blockElement.querySelectorAll(".av__cell--active, .av__cell--select")) || [];
        if (values && Array.isArray(values) && values.length > 0) {
            if (cellElements.length === 0) {
                blockElement.querySelectorAll(".av__row--select:not(.av__row--header)").forEach(rowElement => {
                    rowElement.querySelectorAll(".av__cell").forEach((cellElement: HTMLElement) => {
                        cellElements.push(cellElement);
                    });
                });
            }
            if (cellElements.length === 0) {
                cellElements.push(blockElement.querySelector(".av__row:not(.av__row--header) .av__cell"));
            }
            const doOperations: IOperation[] = [];
            const undoOperations: IOperation[] = [];

            const id = blockElement.dataset.nodeId;
            let currentRowElement: Element;
            const firstColIndex = cellElements[0].getAttribute("data-col-id");
            for (let i = 0; i < values.length; i++) {
                if (!currentRowElement) {
                    currentRowElement = hasClosestByClassName(cellElements[0].parentElement, "av__row") as HTMLElement;
                } else {
                    currentRowElement = currentRowElement.nextElementSibling;
                }
                if (!currentRowElement.classList.contains("av__row")) {
                    break;
                }
                let cellElement: HTMLElement;
                for (let j = 0; j < values[i].length; j++) {
                    const cellValue = values[i][j];
                    if (!cellElement) {
                        cellElement = currentRowElement.querySelector(`.av__cell[data-col-id="${firstColIndex}"]`) as HTMLElement;
                    } else {
                        if (cellElement.nextElementSibling) {
                            cellElement = cellElement.nextElementSibling as HTMLElement;
                        } else if (cellElement.parentElement.classList.contains("av__colsticky")) {
                            cellElement = cellElement.parentElement.nextElementSibling as HTMLElement;
                        }
                    }
                    if (!cellElement.classList.contains("av__cell")) {
                        break;
                    }
                    const operations = await updateCellsValue(protyle, blockElement as HTMLElement,
                        cellValue, [cellElement], columns, html, true);
                    if (operations.doOperations.length > 0) {
                        doOperations.push(...operations.doOperations);
                        undoOperations.push(...operations.undoOperations);
                    }
                }
            }
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
                const previousID = getFieldIdByCellElement(selectCellElement, blockElement.getAttribute("data-av-type") as TAVView);
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
                updateAttrViewCellAnimation(selectCellElement, {
                    type: "block",
                    isDetached: false,
                    block: {content: contenteditableElement.firstElementChild.textContent, id: sourceId}
                });
                return;
            }
        }

        const text = protyle.lute.BlockDOM2Content(html);
        const rowsElement = blockElement.querySelectorAll(".av__row--select");

        const textJSON: string[][] = [];
        text.split("\n").forEach(row => {
            textJSON.push(row.split("\t"));
        });
        if (rowsElement.length > 0 && textJSON.length === 1 && textJSON[0].length === 1) {
            updateCellsValue(protyle, blockElement as HTMLElement, text, undefined, columns, html);
            return;
        }
        if (rowsElement.length > 0) {
            rowsElement.forEach(rowElement => {
                rowElement.querySelectorAll(".av__cell").forEach((cellElement: HTMLElement) => {
                    cellElements.push(cellElement);
                });
            });
        }
        if (cellElements.length > 0) {
            if (textJSON.length === 1 && textJSON[0].length === 1) {
                updateCellsValue(protyle, blockElement as HTMLElement, text, cellElements, columns, html);
            } else {
                let currentRowElement: Element;
                const doOperations: IOperation[] = [];
                const undoOperations: IOperation[] = [];
                const firstColIndex = cellElements[0].getAttribute("data-col-id");
                for (let i = 0; i < textJSON.length; i++) {
                    if (!currentRowElement) {
                        currentRowElement = hasClosestByClassName(cellElements[0].parentElement, "av__row") as HTMLElement;
                    } else {
                        currentRowElement = currentRowElement.nextElementSibling;
                    }
                    if (!currentRowElement.classList.contains("av__row")) {
                        break;
                    }
                    let cellElement: HTMLElement;
                    for (let j = 0; j < textJSON[i].length; j++) {
                        if (!cellElement) {
                            cellElement = currentRowElement.querySelector(`.av__cell[data-col-id="${firstColIndex}"]`) as HTMLElement;
                        } else {
                            if (cellElement.nextElementSibling) {
                                cellElement = cellElement.nextElementSibling as HTMLElement;
                            } else if (cellElement.parentElement.classList.contains("av__colsticky")) {
                                cellElement = cellElement.parentElement.nextElementSibling as HTMLElement;
                            }
                        }
                        if (!cellElement.classList.contains("av__cell")) {
                            break;
                        }
                        const cellValue = textJSON[i][j];
                        const operations = await updateCellsValue(protyle, blockElement as HTMLElement, cellValue, [cellElement], columns, html, true);
                        if (operations.doOperations.length > 0) {
                            doOperations.push(...operations.doOperations);
                            undoOperations.push(...operations.undoOperations);
                        }
                    }
                }
                if (doOperations.length > 0) {
                    const id = blockElement.getAttribute("data-node-id");
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
            }
            document.querySelector(".av__panel")?.remove();
        } else if (hasClosestByClassName(range.startContainer, "av__title")) {
            const node = document.createTextNode(text);
            range.insertNode(node);
            range.setEnd(node, text.length);
            range.collapse(false);
            focusByRange(range);
            updateAVName(protyle, blockElement);
        }
    });
};

const processTable = (range: Range, html: string, protyle: IProtyle, blockElement: HTMLElement) => {
    const tempElement = document.createElement("template");
    tempElement.innerHTML = html;
    const copyCellElements = tempElement.content.querySelectorAll("th, td");
    if (copyCellElements.length === 0) {
        return false;
    }
    const scrollLeft = blockElement.firstElementChild.scrollLeft;
    const scrollTop = blockElement.querySelector("table").scrollTop;
    const tableSelectElement = blockElement.querySelector(".table__select") as HTMLElement;
    let index = 0;
    const matchCellsElement: HTMLTableCellElement[] = [];
    blockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
        if (!item.classList.contains("fn__none") && copyCellElements.length > index &&
            isIncludeCell({
                tableSelectElement,
                scrollLeft,
                scrollTop,
                item,
            })) {
            matchCellsElement.push(item);
            index++;
        }
    });
    tableSelectElement.removeAttribute("style");
    const oldHTML = blockElement.outerHTML;
    blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
    matchCellsElement.forEach((item, matchIndex) => {
        item.innerHTML = copyCellElements[matchIndex].innerHTML;
        if (matchIndex === matchCellsElement.length - 1) {
            setLastNodeRange(item, range, false);
        }
    });
    range.collapse(false);
    updateTransaction(protyle, blockElement.getAttribute("data-node-id"), blockElement.outerHTML, oldHTML);
    return true;
};

export const insertHTML = (html: string, protyle: IProtyle, isBlock = false,
                           // 移动端插入嵌入块时，获取到的 range 为旧值
                           useProtyleRange = false,
                           // 在开头粘贴块则插入上方
                           insertByCursor = false) => {
    if (html === "") {
        return;
    }
    const range = useProtyleRange ? protyle.toolbar.range : getEditorRange(protyle.wysiwyg.element);
    fixTableRange(range);
    let unSpinHTML;
    if (hasClosestByAttribute(range.startContainer, "data-type", "NodeTable") && !isBlock) {
        if (hasClosestByTag(range.startContainer, "TABLE")) {
            unSpinHTML = protyle.lute.BlockDOM2InlineBlockDOM(html);
        } else {
            // https://github.com/siyuan-note/siyuan/issues/9411
            isBlock = true;
        }
    }
    let blockElement = hasClosestBlock(range.startContainer) as HTMLElement;
    if (!blockElement) {
        // 使用鼠标点击选则模版提示列表后 range 丢失
        if (protyle.toolbar.range) {
            blockElement = hasClosestBlock(protyle.toolbar.range.startContainer) as HTMLElement;
        } else {
            blockElement = protyle.wysiwyg.element.firstElementChild as HTMLElement;
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
    if (blockElement.classList.contains("table") && blockElement.querySelector(".table__select").clientWidth > 0 &&
        processTable(range, html, protyle, blockElement)) {
        return;
    }

    let id = blockElement.getAttribute("data-node-id");
    range.insertNode(document.createElement("wbr"));
    let oldHTML = blockElement.outerHTML;
    const type = blockElement.getAttribute("data-type");
    const isNodeCodeBlock = type === "NodeCodeBlock";
    const editableElement = getContenteditableElement(blockElement);
    if (!isBlock &&
        (isNodeCodeBlock || protyle.toolbar.getCurrentType(range).includes("code"))) {
        range.deleteContents();
        // 代码块需保持至少一个 \n https://github.com/siyuan-note/siyuan/pull/13271#issuecomment-2502672155
        let codeBlockIsEmpty = false;
        if (isNodeCodeBlock && editableElement.textContent === "") {
            codeBlockIsEmpty = true;
        }
        range.insertNode(document.createTextNode(html.replace(/\r\n|\r|\u2028|\u2029/g, "\n")));
        range.collapse(false);
        range.insertNode(document.createElement("wbr"));
        if (codeBlockIsEmpty) {
            // 代码块为空添加的 \n 需放在最后 https://github.com/siyuan-note/siyuan/issues/15399
            range.collapse(false);
            range.insertNode(document.createTextNode("\n"));
        }
        if (isNodeCodeBlock) {
            blockElement.querySelector('[data-render="true"]')?.removeAttribute("data-render");
            highlightRender(blockElement);
        } else {
            focusByWbr(blockElement, range);
        }
        blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(protyle, id, blockElement.outerHTML, oldHTML);
        setTimeout(() => {
            scrollCenter(protyle, undefined, "nearest", "smooth");
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
            // 选中 ref**bbb** 后 alt+[
            range.deleteContents();
            // https://github.com/siyuan-note/siyuan/issues/14035
            if (range.startContainer.nodeType !== 3 && (range.startContainer as Element).tagName === "SPAN" &&
                range.startContainer.textContent === "") {
                // ref 选中处理 https://ld246.com/article/1629214377537
                (range.startContainer as HTMLElement).remove();
            }
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

    // https://github.com/siyuan-note/siyuan/issues/14162 & https://github.com/siyuan-note/siyuan/issues/14965
    if (/^\s*&gt;|\*|-|\+|\d*.|\[ \]|[x]/.test(html) &&
        editableElement.textContent.replace(Constants.ZWSP, "") !== "") {
        unSpinHTML = html;
    }

    let innerHTML = unSpinHTML || // 在 table 中插入需要使用转换好的行内元素 https://github.com/siyuan-note/siyuan/issues/9358
        html;   // 空格会被 Spin 不再，需要使用原文
    // 粘贴纯文本时会进行内部转义，这里需要进行反转义 https://github.com/siyuan-note/siyuan/issues/10620
    innerHTML = innerHTML.replace(/;;;lt;;;/g, "&lt;").replace(/;;;gt;;;/g, "&gt;");
    tempElement.innerHTML = innerHTML;

    let block2text = false;
    if ((
            editableElement.textContent.replace(Constants.ZWSP, "") !== "" ||
            type === "NodeHeading"
        ) &&
        tempElement.content.childElementCount === 1 &&
        tempElement.content.firstChild.nodeType !== 3 &&
        tempElement.content.firstElementChild.getAttribute("data-type") === "NodeHeading") {
        // https://github.com/siyuan-note/siyuan/issues/14114
        isBlock = false;
        block2text = true;
    }
    // 使用 lute 方法会添加 p 元素，只有一个 p 元素或者只有一个字符串或者为 <u>b</u> 时的时候只拷贝内部
    if (!isBlock) {
        if (tempElement.content.firstChild.nodeType === 3 || block2text ||
            (tempElement.content.firstChild.nodeType !== 3 &&
                ((tempElement.content.firstElementChild.classList.contains("p") && tempElement.content.childElementCount === 1) ||
                    tempElement.content.firstElementChild.tagName !== "DIV"))) {
            if (tempElement.content.firstChild.nodeType !== 3 && tempElement.content.firstElementChild.classList.contains("p")) {
                tempElement.innerHTML = tempElement.content.firstElementChild.firstElementChild.innerHTML.trim();
            }
            // 粘贴带样式的行内元素到另一个行内元素中需进行切割
            const spanElement = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer as HTMLElement;
            if (spanElement.tagName === "SPAN" && spanElement === (range.endContainer.nodeType === 3 ? range.endContainer.parentElement : range.endContainer) &&
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
    // https://github.com/siyuan-note/siyuan/issues/15768
    if (tempElement.content.firstChild.nodeType === 3 || (tempElement.content.firstChild.nodeType === 1 && tempElement.content.firstElementChild.tagName !== "DIV")) {
        tempElement.innerHTML = protyle.lute.SpinBlockDOM(tempElement.innerHTML);
    }
    (insertBefore ? Array.from(tempElement.content.children) : Array.from(tempElement.content.children).reverse()).find((item) => {
        let addId = item.getAttribute("data-node-id");
        const hasParentHeading = item.getAttribute("parent-heading");
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
            item.removeAttribute("parent-heading");
            doOperation.push({
                action: "insert",
                data: item.outerHTML,
                id: addId,
                context: {ignoreProcess: hasParentHeading ? "true" : "false"},
                nextID: insertBefore ? id : undefined,
                previousID: insertBefore ? undefined : id
            });
            undoOperation.push({
                action: "delete",
                id: addId,
            });
        }
        if (!hasParentHeading) {
            const rendersElement = [];
            if (item.classList.contains("render-node") && item.getAttribute("data-type") === "NodeCodeBlock") {
                rendersElement.push(item);
            } else {
                rendersElement.push(...item.querySelectorAll('.render-node[data-type="NodeCodeBlock"]'));
            }
            rendersElement.forEach((renderItem) => {
                renderItem.querySelector(".protyle-icons")?.remove();
                const spinElement = renderItem.querySelector('[spin="1"]');
                if (spinElement) {
                    spinElement.innerHTML = "";
                }
                renderItem.removeAttribute("data-render");
            });
            processClonePHElement(item);
            if (insertBefore) {
                blockElement.before(item);
            } else {
                blockElement.after(item);
            }
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
            parentID: getParentBlock(blockElement).getAttribute("data-node-id") || protyle.block.parentID
        });
        blockElement.remove();
    }
    if (lastElement) {
        // https://github.com/siyuan-note/siyuan/issues/5591
        focusBlock(lastElement, undefined, false);
    }
    protyle.wysiwyg.element.querySelectorAll("wbr").forEach(item => {
        item.remove();
    });
    // 复制容器块中包含折叠标题块
    protyle.wysiwyg.element.querySelectorAll("[parent-heading]").forEach(item => {
        item.remove();
    });
    let foldData;
    if (blockElement.getAttribute("data-type") === "NodeHeading" &&
        blockElement.getAttribute("fold") === "1" && !insertBefore) {
        fetchPost("/api/block/getHeadingChildrenIDs", {id: blockElement.getAttribute("data-node-id")}, (response) => {
            const childrenIDs: string[] = response.data;
            const previousId = (childrenIDs && childrenIDs.length > 0) ? childrenIDs[childrenIDs.length - 1] : blockElement.getAttribute("data-node-id");
            foldData = setFold(protyle, blockElement, true, false, false, true);
            foldData.doOperations[0].context = {
                focusId: lastElement?.getAttribute("data-node-id"),
            };
            doOperation.forEach(item => {
                if (item.action === "insert") {
                    item.previousID = previousId;
                }
            });
            doOperation.splice(0, 0, ...foldData.doOperations);
            undoOperation.push(...foldData.undoOperations);
            transaction(protyle, doOperation, undoOperation);
        });
        return;
    }
    transaction(protyle, doOperation, undoOperation);
};
