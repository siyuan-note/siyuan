import {genEmptyElement, genHeadingElement, insertEmptyBlock} from "../../block/util";
import {focusByRange, focusByWbr, getSelectionOffset, setLastNodeRange} from "../util/selection";
import {
    getContenteditableElement, getParentBlock,
    getTopEmptyElement,
    hasNextSibling,
    hasPreviousSibling,
    isNotEditBlock
} from "./getBlock";
import {transaction, turnsIntoOneTransaction, updateTransaction} from "./transaction";
import {breakList, genListItemElement, listOutdent, updateListOrder} from "./list";
import {highlightRender} from "../render/highlightRender";
import {Constants} from "../../constants";
import {scrollCenter} from "../../util/highlightById";
import {hideElements} from "../ui/hideElements";
import {isIPad, setStorageVal} from "../util/compatibility";
import {mathRender} from "../render/mathRender";
import {isMobile} from "../../util/functions";
import {processRender} from "../util/processCode";
import {hasClosestByAttribute, hasClosestByClassName} from "../util/hasClosest";
import {blockRender} from "../render/blockRender";

export const enter = (blockElement: HTMLElement, range: Range, protyle: IProtyle) => {
    if (hasClosestByClassName(blockElement, "protyle-wysiwyg__embed")) {
        return;
    }
    const disableElement = isNotEditBlock(blockElement);
    if (!disableElement && blockElement.classList.contains("protyle-wysiwyg--select")) {
        setLastNodeRange(getContenteditableElement(blockElement), range, false);
        range.collapse(false);
        hideElements(["select"], protyle);
        return;
    }
    protyle.observerLoad?.disconnect();
    // https://github.com/siyuan-note/siyuan/issues/5471
    if (disableElement ||
        // https://github.com/siyuan-note/siyuan/issues/10633
        blockElement.classList.contains("table")) {
        if (blockElement.classList.contains("protyle-wysiwyg--select") && blockElement.classList.contains("render-node")) {
            protyle.toolbar.showRender(protyle, blockElement);
        } else {
            insertEmptyBlock(protyle, "afterend");
        }
        return;
    }
    const editableElement = getContenteditableElement(blockElement) as HTMLElement;
    // 选中图片后回车，应取消图片的选中状态 https://ld246.com/article/1650357135043
    editableElement.querySelectorAll(".img--select").forEach(item => {
        item.classList.remove("img--select");
    });
    // 数据库
    if (blockElement.getAttribute("data-type") === "NodeAttributeView") {
        return true;
    }

    const trimStartHTML = editableElement.innerHTML.trimStart();
    const trimStartText = editableElement.textContent.trimStart();
    if (trimStartHTML.startsWith("```") || trimStartHTML.startsWith("···") || trimStartHTML.startsWith("~~~") ||
        (trimStartHTML.indexOf("\n```") > -1 && trimStartText.indexOf("\n```") > -1) ||
        (trimStartHTML.indexOf("\n~~~") > -1 && trimStartText.indexOf("\n~~~") > -1) ||
        (trimStartHTML.indexOf("\n···") > -1 && trimStartText.indexOf("\n···") > -1)) {
        if (trimStartHTML.indexOf("\n") === -1 && trimStartHTML.replace(/·|~/g, "`").replace(/^`{3,}/g, "").indexOf("`") > -1) {
            // ```test` 不处理，正常渲染为段落块
        } else if (blockElement.classList.contains("p")) { // https://github.com/siyuan-note/siyuan/issues/6953
            range.insertNode(document.createElement("wbr"));
            const oldHTML = blockElement.outerHTML;
            // https://github.com/siyuan-note/siyuan/issues/16744
            range.extractContents();
            const wbrElement = document.createElement("wbr");
            range.insertNode(wbrElement);
            wbrElement.after(document.createTextNode("\n"));
            let replaceInnerHTML = editableElement.innerHTML.replace(/\n(~|·|`){3,}/g, "\n```").trim().replace(/^(~|·|`){3,}/g, "```");
            if (!replaceInnerHTML.endsWith("\n```")) {
                replaceInnerHTML += "\n```";
            }
            editableElement.innerHTML = replaceInnerHTML;
            blockElement.outerHTML = protyle.lute.SpinBlockDOM(blockElement.outerHTML);
            blockElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${blockElement.getAttribute("data-node-id")}"]`);
            const languageElement = blockElement.querySelector(".protyle-action__language");
            if (languageElement) {
                if (window.siyuan.storage[Constants.LOCAL_CODELANG] && languageElement.textContent === "") {
                    languageElement.textContent = window.siyuan.storage[Constants.LOCAL_CODELANG];
                } else if (!Constants.SIYUAN_RENDER_CODE_LANGUAGES.includes(languageElement.textContent)) {
                    window.siyuan.storage[Constants.LOCAL_CODELANG] = languageElement.textContent;
                    setStorageVal(Constants.LOCAL_CODELANG, window.siyuan.storage[Constants.LOCAL_CODELANG]);
                }
                if (Constants.SIYUAN_RENDER_CODE_LANGUAGES.includes(languageElement.textContent)) {
                    blockElement.dataset.content = "";
                    blockElement.dataset.subtype = languageElement.textContent;
                    blockElement.className = "render-node";
                    blockElement.innerHTML = `<div spin="1"></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
                    protyle.toolbar.showRender(protyle, blockElement);
                    processRender(blockElement);
                } else {
                    highlightRender(blockElement);
                }
            } else {
                protyle.toolbar.showRender(protyle, blockElement);
                processRender(blockElement);
            }
            updateTransaction(protyle, blockElement.getAttribute("data-node-id"), blockElement.outerHTML, oldHTML);
            return true;
        }
    }
    // 代码块
    if (blockElement.getAttribute("data-type") === "NodeCodeBlock") {
        const wbrElement = document.createElement("wbr");
        range.insertNode(wbrElement);
        const oldHTML = blockElement.outerHTML;
        wbrElement.remove();
        range.extractContents();
        if (!editableElement.textContent.endsWith("\n")) {
            editableElement.insertAdjacentText("beforeend", "\n");
        }
        range.insertNode(document.createTextNode("\n"));
        range.collapse(false);
        range.insertNode(wbrElement);
        editableElement.parentElement.removeAttribute("data-render");
        highlightRender(blockElement);
        updateTransaction(protyle, blockElement.getAttribute("data-node-id"), blockElement.outerHTML, oldHTML);
        scrollCenter(protyle);
        return true;
    }

    // bq || callout
    if (editableElement.textContent.replace(Constants.ZWSP, "").replace("\n", "") === "" &&
        ((blockElement.nextElementSibling && blockElement.nextElementSibling.classList.contains("protyle-attr") &&
                blockElement.parentElement.getAttribute("data-type") === "NodeBlockquote") ||
            (blockElement.parentElement.classList.contains("callout-content") && !blockElement.nextElementSibling))) {
        range.insertNode(document.createElement("wbr"));
        const topElement = getTopEmptyElement(blockElement);
        const blockId = blockElement.getAttribute("data-node-id");
        const topId = topElement.getAttribute("data-node-id");
        const doInsert: IOperation = {
            action: "insert",
            id: blockId,
            data: blockElement.outerHTML,
        };
        const undoInsert: IOperation = {
            action: "insert",
            id: topId,
            data: topElement.outerHTML,
        };
        let parentBlockElement = getParentBlock(blockElement);
        if (topId === blockId) {
            doInsert.previousID = parentBlockElement.getAttribute("data-node-id");
            undoInsert.previousID = blockElement.previousElementSibling.getAttribute("data-node-id");
            parentBlockElement.after(blockElement);
        } else {
            doInsert.previousID = topElement.previousElementSibling ? topElement.previousElementSibling.getAttribute("data-node-id") : undefined;
            doInsert.parentID = topElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID;
            undoInsert.previousID = doInsert.previousID;
            undoInsert.parentID = doInsert.parentID;
            topElement.after(blockElement);
            topElement.remove();
        }
        transaction(protyle, [{
            action: "delete",
            id: topId
        }, doInsert], [{
            action: "delete",
            id: blockId,
        }, undoInsert]);
        parentBlockElement = getParentBlock(blockElement);
        if (topId === blockId && parentBlockElement.classList.contains("sb") &&
            parentBlockElement.getAttribute("data-sb-layout") === "col") {
            turnsIntoOneTransaction({
                protyle,
                selectsElement: [blockElement.previousElementSibling, blockElement],
                type: "BlocksMergeSuperBlock",
                level: "row",
                unfocus: true,
            });
        }
        focusByWbr(blockElement, range);
        return true;
    }

    const position = getSelectionOffset(editableElement, protyle.wysiwyg.element, range);
    if (blockElement.parentElement.getAttribute("data-type") === "NodeListItem" &&
        (
            blockElement.nextElementSibling.classList.contains("protyle-attr") ||
            (blockElement.nextElementSibling.classList.contains("list") && blockElement.previousElementSibling?.classList.contains("protyle-action")) ||
            (position.start === 0 && blockElement.previousElementSibling.classList.contains("protyle-action")) ||
            blockElement.parentElement.getAttribute("fold") === "1"
        ) && listEnter(protyle, blockElement, range)
    ) {
        return true;
    }

    // 段首换行
    if (editableElement.textContent !== "" && range.toString() === "" && position.start === 0) {
        let newElement;
        if (blockElement.previousElementSibling &&
            blockElement.previousElementSibling.getAttribute("data-type") === "NodeHeading" &&
            blockElement.previousElementSibling.getAttribute("fold") === "1") {
            newElement = genHeadingElement(blockElement.previousElementSibling, false, true) as HTMLDivElement;
        } else {
            newElement = genEmptyElement(false, true);
        }
        const newId = newElement.getAttribute("data-node-id");
        transaction(protyle, [{
            action: "insert",
            data: newElement.outerHTML,
            id: newId,
            previousID: blockElement.previousElementSibling ? blockElement.previousElementSibling.getAttribute("data-node-id") : "",
            parentID: getParentBlock(blockElement).getAttribute("data-node-id") || protyle.block.parentID
        }], [{
            action: "delete",
            id: newId,
        }]);
        newElement.querySelector("wbr").remove();
        blockElement.insertAdjacentElement("beforebegin", newElement);
        removeEmptyNode(newElement);
        return true;
    }
    range.insertNode(document.createElement("wbr"));
    const html = blockElement.outerHTML;
    const parentHTML = getParentBlock(blockElement).outerHTML;
    if (range.toString() !== "") {
        // 选中数学公式后回车取消选中 https://github.com/siyuan-note/siyuan/issues/12637#issuecomment-2381106949
        const mathElement = hasClosestByAttribute(range.startContainer, "data-type", "inline-math");
        if (mathElement) {
            const nextSibling = hasNextSibling(mathElement);
            if (nextSibling) {
                range = getSelection().getRangeAt(0);
                range.setEnd(nextSibling, nextSibling.textContent.startsWith(Constants.ZWSP) ? 1 : 0);
                range.collapse(false);
            }
            mathElement.querySelector("wbr")?.remove();
            return true;
        }
        range.extractContents();
        range.insertNode(document.createElement("wbr"));
    }
    if (editableElement.lastChild) {
        range.setEndAfter(editableElement.lastChild);
    }
    const id = blockElement.getAttribute("data-node-id");
    const newElement = document.createElement("div");
    if (blockElement.getAttribute("data-type") === "NodeHeading" && blockElement.getAttribute("fold") === "1") {
        newElement.innerHTML = genHeadingElement(blockElement, true) as string;
    } else {
        newElement.appendChild(genEmptyElement(false, false));
    }
    const newEditableElement = newElement.querySelector('[contenteditable="true"]');
    newEditableElement.appendChild(range.extractContents());
    const selectWbrElement = newEditableElement.querySelector("wbr");
    if (selectWbrElement && selectWbrElement.parentElement.tagName === "SPAN" && selectWbrElement.parentElement.innerHTML === "<wbr>") {
        selectWbrElement.parentElement.outerHTML = "<wbr>";
    }
    const newHTML = newEditableElement.innerHTML.trimStart();
    const newText = newEditableElement.textContent.trimStart();
    // https://github.com/siyuan-note/siyuan/issues/10759
    if (newHTML.startsWith("```") || newHTML.startsWith("···") || newHTML.startsWith("~~~") ||
        (newHTML.indexOf("\n```") > -1 && newText.indexOf("\n```") > -1) ||
        (newHTML.indexOf("\n~~~") > -1 && newText.indexOf("\n~~~") > -1) ||
        (newHTML.indexOf("\n···") > -1 && newText.indexOf("\n···") > -1)) {
        if (newHTML.indexOf("\n") === -1 && newHTML.replace(/·|~/g, "`").replace(/^`{3,}/g, "").indexOf("`") > -1) {
            // ```test` 不处理，正常渲染为段落块
        } else {
            let replaceNewHTML = newEditableElement.innerHTML.replace(/\n(~|·|`){3,}/g, "\n```").trim().replace(/^(~|·|`){3,}/g, "```");
            if (!replaceNewHTML.endsWith("\n```")) {
                replaceNewHTML += "\n```";
            }
            newEditableElement.innerHTML = replaceNewHTML;
        }
    }
    // https://github.com/siyuan-note/insider/issues/480
    newElement.innerHTML = protyle.lute.SpinBlockDOM(newElement.innerHTML);

    // https://github.com/siyuan-note/siyuan/issues/3850
    // https://github.com/siyuan-note/siyuan/issues/6018
    // https://github.com/siyuan-note/siyuan/issues/9682
    // 图片后的零宽空格前回车 https://github.com/siyuan-note/siyuan/issues/5690
    const enterElement = document.createElement("div");
    enterElement.innerHTML = protyle.lute.SpinBlockDOM(editableElement.parentElement.outerHTML);
    const doOperation: IOperation[] = [];
    const undoOperation: IOperation[] = [];
    let currentElement = blockElement;
    // 回车之前的块为 1\n\n2 时会产生多个块
    const selectsElement: Element[] = [];
    Array.from(enterElement.children).forEach((item: HTMLElement) => {
        if (item.dataset.nodeId === id) {
            blockElement.before(item);
            blockElement.remove();
            doOperation.push({
                action: "update",
                data: item.outerHTML,
                id,
            });
            undoOperation.push({
                action: "update",
                data: html,
                id,
            });
        } else {
            doOperation.push({
                action: "insert",
                data: item.outerHTML,
                id: item.dataset.nodeId,
                nextID: id,
            });
            currentElement.insertAdjacentElement("afterend", item);
            undoOperation.push({
                action: "delete",
                id: item.dataset.nodeId,
            });
        }
        if (item.dataset.type === "NodeBlockQueryEmbed") {
            blockRender(protyle, item);
        } else {
            mathRender(item);
        }
        currentElement = item;
        selectsElement.push(item);
    });

    Array.from(newElement.children).forEach((item: HTMLElement) => {
        const newId = item.getAttribute("data-node-id");
        doOperation.push({
            action: "insert",
            data: item.outerHTML,
            id: newId,
            previousID: currentElement.getAttribute("data-node-id"),
        });
        undoOperation.push({
            action: "delete",
            id: newId,
        });
        currentElement.insertAdjacentElement("afterend", item);
        if (item.classList.contains("code-block")) {
            highlightRender(item);
        } else if (item.dataset.type === "NodeBlockQueryEmbed") {
            blockRender(protyle, item);
        } else {
            mathRender(currentElement.nextElementSibling);
        }
        currentElement = item;
        selectsElement.push(item);
    });
    if (currentElement.parentElement.classList.contains("bq") && currentElement.parentElement.childElementCount > 2 &&
        currentElement.previousElementSibling.classList.contains("p") && currentElement.classList.contains("p") &&
        currentElement.previousElementSibling.textContent.startsWith("[!") && parentHTML) {
        const parentId = currentElement.parentElement.getAttribute("data-node-id");
        const calloutHTML = protyle.lute.SpinBlockDOM(currentElement.parentElement.outerHTML);
        if (calloutHTML.indexOf('data-type="NodeCallout"') > -1) {
            currentElement.parentElement.outerHTML = calloutHTML;
            mathRender(protyle.wysiwyg.element);
            updateTransaction(protyle, parentId, calloutHTML, parentHTML);
            focusByWbr(protyle.wysiwyg.element, range);
            scrollCenter(protyle);
            return true;
        }
    }
    undoOperation.find((item, index) => {
        if (item.action === "update") {
            undoOperation.splice(index, 1);
            undoOperation.push(item);
            return true;
        }
    });
    transaction(protyle, doOperation, undoOperation);
    if (currentElement.parentElement.classList.contains("sb") &&
        currentElement.parentElement.getAttribute("data-sb-layout") === "col") {
        turnsIntoOneTransaction({
            protyle,
            selectsElement,
            type: "BlocksMergeSuperBlock",
            level: "row",
            unfocus: true,
        });
    }
    focusByWbr(currentElement, range);
    scrollCenter(protyle);
    return true;
};

const listEnter = (protyle: IProtyle, blockElement: HTMLElement, range: Range) => {
    const listItemElement = blockElement.parentElement;
    const editableElement = getContenteditableElement(blockElement);
    if (// \n 是因为 https://github.com/siyuan-note/siyuan/issues/3846
        ["", "\n"].includes(editableElement.textContent) &&
        blockElement.previousElementSibling.classList.contains("protyle-action") &&
        !blockElement.querySelector("img") // https://ld246.com/article/1651820644238
    ) {
        if (listItemElement.nextElementSibling?.classList.contains("protyle-attr")) {
            listOutdent(protyle, [blockElement.parentElement], range);
            return true;
        } else if (!listItemElement.parentElement.classList.contains("protyle-wysiwyg")) {
            // 打断列表
            breakList(protyle, blockElement, range);
            return true;
        }
    }

    const position = getSelectionOffset(editableElement, protyle.wysiwyg.element, range);
    if (range.toString() === "" && position.start === 0 &&
        // 段首为图片是 start 也为 0
        !hasPreviousSibling(range.startContainer)) {
        // 段首换行
        if (listItemElement.parentElement.classList.contains("protyle-wysiwyg")) {
            return true;
        }
        // https://github.com/siyuan-note/siyuan/issues/8935
        const wbrElement = document.createElement("wbr");
        range.insertNode(wbrElement);
        const html = listItemElement.parentElement.outerHTML;
        wbrElement.remove();
        let newElement = genListItemElement(listItemElement, -1, true);
        if (!blockElement.previousElementSibling.classList.contains("protyle-action")) {
            // 列表项中有多个块，最后一个块为空，换行应进行缩进
            if (getContenteditableElement(blockElement).textContent !== "") {
                return false;
            }
            blockElement.remove();
            newElement = genListItemElement(listItemElement, -1, true);
            listItemElement.insertAdjacentElement("afterend", newElement);
        } else if (getContenteditableElement(blockElement).textContent === "") {
            listItemElement.insertAdjacentElement("afterend", newElement);
        } else {
            listItemElement.insertAdjacentElement("beforebegin", newElement);
        }
        if (listItemElement.getAttribute("data-subtype") === "o") {
            updateListOrder(listItemElement.parentElement);
        }
        updateTransaction(protyle, listItemElement.parentElement.getAttribute("data-node-id"), listItemElement.parentElement.outerHTML, html);
        focusByWbr(newElement, range);
        scrollCenter(protyle);
        removeEmptyNode(newElement);
        return true;
    }

    const subListElement = listItemElement.querySelector(".list");
    let newElement;
    if (subListElement && listItemElement.getAttribute("fold") !== "1" &&
        // 子列表下的段落块回车 https://ld246.com/article/1623919354587
        blockElement.nextElementSibling === subListElement) {
        // 含有子列表的换行
        if (position.end >= editableElement.textContent.length -
            // 数学公式结尾会有 zwsp https://github.com/siyuan-note/siyuan/issues/6679
            (editableElement.textContent.endsWith(Constants.ZWSP) ? 1 : 0)) {
            // 段末换行，在子列表中插入
            range.insertNode(document.createElement("wbr"));
            const html = listItemElement.outerHTML;
            blockElement.querySelector("wbr").remove();
            newElement = genListItemElement(subListElement.firstElementChild, -1, true);
            subListElement.firstElementChild.before(newElement);
            if (subListElement.getAttribute("data-subtype") === "o") {
                updateListOrder(subListElement);
            }
            updateTransaction(protyle, listItemElement.getAttribute("data-node-id"), listItemElement.outerHTML, html);
            focusByWbr(listItemElement, range);
            scrollCenter(protyle);
        } else {
            // 文字中间换行
            range.insertNode(document.createElement("wbr"));
            const listItemHTML = listItemElement.outerHTML;
            const html = listItemElement.parentElement.outerHTML;
            if (range.toString() !== "") {
                range.extractContents();
                range.insertNode(document.createElement("wbr"));
            }
            range.setEndAfter(editableElement.lastChild);
            newElement = genListItemElement(listItemElement, 0, false);
            const newEditElement = getContenteditableElement(newElement);
            newEditElement.appendChild(range.extractContents());
            const subWbrElement = newEditElement.querySelector("wbr");
            if (subWbrElement && subWbrElement.parentElement.tagName === "SPAN" && subWbrElement.parentElement.innerHTML === "<wbr>") {
                subWbrElement.parentElement.outerHTML = "<wbr>";
            }
            newEditElement.parentElement.outerHTML = protyle.lute.SpinBlockDOM(newEditElement.parentElement.outerHTML);
            let subListNextElement = subListElement.nextElementSibling;
            newElement.lastElementChild.before(subListElement);
            // https://github.com/siyuan-note/siyuan/issues/13016
            while (!subListNextElement.classList.contains("protyle-attr")) {
                subListNextElement = subListNextElement.nextElementSibling;
                newElement.lastElementChild.before(subListNextElement.previousElementSibling);
            }
            listItemElement.insertAdjacentElement("afterend", newElement);
            blockRender(protyle, newElement);
            mathRender(newElement);
            processRender(newElement);
            if (listItemElement.getAttribute("data-subtype") === "o") {
                updateListOrder(listItemElement.parentElement);
            }
            if (listItemElement.parentElement.classList.contains("protyle-wysiwyg")) {
                transaction(protyle, [{
                    action: "update",
                    data: listItemElement.outerHTML,
                    id: listItemElement.getAttribute("data-node-id")
                }, {
                    action: "insert",
                    id: newElement.getAttribute("data-node-id"),
                    data: newElement.outerHTML,
                    previousID: listItemElement.getAttribute("data-node-id")
                }], [{
                    action: "delete",
                    id: newElement.getAttribute("data-node-id"),
                }, {
                    action: "update",
                    data: listItemHTML,
                    id: listItemElement.getAttribute("data-node-id")
                }]);
            } else {
                updateTransaction(protyle, listItemElement.parentElement.getAttribute("data-node-id"), listItemElement.parentElement.outerHTML, html);
            }
            focusByWbr(newElement, range);
            scrollCenter(protyle);
        }
        removeEmptyNode(newElement);
        return true;
    }
    if ((range.toString() === "" || range.toString() === Constants.ZWSP) && range.startContainer.nodeType === 3 && range.startOffset === 0) {
        // 图片后的零宽空格前回车 https://github.com/siyuan-note/siyuan/issues/5690
        // 列表中的图片后双击换行图片光标错误 https://ld246.com/article/1660987186727/comment/1662181221732?r=Vanessa#comments
        let nextSibling = range.startContainer;
        while (nextSibling) {
            if (nextSibling.textContent === Constants.ZWSP) {
                range.setStart(nextSibling, 1);
                range.collapse(false);
                break;
            } else {
                nextSibling = nextSibling.nextSibling;
            }
        }
    }
    range.insertNode(document.createElement("wbr"));
    const listItemHTML = listItemElement.outerHTML;
    const oldHTML = listItemElement.parentElement.outerHTML;
    if (range.toString() !== "") {
        // 选中数学公式后回车取消选中 https://github.com/siyuan-note/siyuan/issues/12637#issuecomment-2381106949
        const mathElement = hasClosestByAttribute(range.startContainer, "data-type", "inline-math");
        if (mathElement) {
            const nextSibling = hasNextSibling(mathElement);
            if (nextSibling) {
                range = getSelection().getRangeAt(0);
                range.setEnd(nextSibling, nextSibling.textContent.startsWith(Constants.ZWSP) ? 1 : 0);
                range.collapse(false);
            }
            mathElement.querySelector("wbr")?.remove();
            return true;
        }
        range.extractContents();
        range.insertNode(document.createElement("wbr"));
    }
    if (editableElement.lastChild) {
        range.setEndAfter(editableElement.lastChild);
    }
    newElement = genListItemElement(listItemElement, 0, false);
    const newEditableElement = getContenteditableElement(newElement);
    newEditableElement.appendChild(range.extractContents());
    const selectWbrElement = newEditableElement.querySelector("wbr");
    if (selectWbrElement && selectWbrElement.parentElement.tagName === "SPAN" && selectWbrElement.parentElement.innerHTML === "<wbr>") {
        selectWbrElement.parentElement.outerHTML = "<wbr>";
    }
    // 回车移除空元素 https://github.com/siyuan-note/insider/issues/480
    // https://github.com/siyuan-note/siyuan/issues/12273
    // 文字和图片中间回车后图片前需添加 zwsp
    newEditableElement.parentElement.outerHTML = protyle.lute.SpinBlockDOM(newEditableElement.parentElement.outerHTML);
    listItemElement.insertAdjacentElement("afterend", newElement);
    blockRender(protyle, newElement);
    mathRender(newElement);
    processRender(newElement);
    // https://github.com/siyuan-note/siyuan/issues/3850
    // https://github.com/siyuan-note/siyuan/issues/6018
    // img 后有文字，在 img 后换行
    editableElement.parentElement.outerHTML = protyle.lute.SpinBlockDOM(editableElement.parentElement.outerHTML);
    blockRender(protyle, listItemElement);
    mathRender(listItemElement);
    processRender(listItemElement);
    if (listItemElement.getAttribute("data-subtype") === "o") {
        updateListOrder(listItemElement.parentElement);
    }
    if (listItemElement.parentElement.classList.contains("protyle-wysiwyg")) {
        transaction(protyle, [{
            action: "update",
            id: listItemElement.getAttribute("data-node-id"),
            data: listItemElement.outerHTML,
        }, {
            action: "insert",
            id: newElement.getAttribute("data-node-id"),
            data: newElement.outerHTML,
            previousID: listItemElement.getAttribute("data-node-id")
        }], [{
            action: "delete",
            id: newElement.getAttribute("data-node-id"),
        }, {
            action: "update",
            id: listItemElement.getAttribute("data-node-id"),
            data: listItemHTML
        }]);
    } else {
        updateTransaction(protyle, listItemElement.parentElement.getAttribute("data-node-id"), listItemElement.parentElement.outerHTML, oldHTML);
    }
    focusByWbr(newElement, range);
    scrollCenter(protyle);
    removeEmptyNode(newElement);
    return true;
};

const removeEmptyNode = (newElement: Element) => {
    const children = getContenteditableElement(newElement).childNodes;
    for (let i = 0; i < children.length; i++) {
        if (children[i].nodeType === 3 && children[i].textContent.length === 0) {
            children[i].remove();
            i--;
        }
    }
};

export const softEnter = (range: Range, nodeElement: HTMLElement, protyle: IProtyle) => {
    let startElement = range.startContainer as HTMLElement;
    const nextSibling = hasNextSibling(startElement) as Element;
    if (nodeElement.getAttribute("data-type") === "NodeAttributeView") {
        return true;
    }
    if (nextSibling && nextSibling.nodeType !== 3) {
        const textPosition = getSelectionOffset(range.startContainer, protyle.wysiwyg.element, range);
        if (textPosition.end === range.endContainer.textContent.length) {
            // 图片之前软换行 || 数学公式之前软换行 https://github.com/siyuan-note/siyuan/issues/13621
            if (nextSibling.classList.contains("img") || nextSibling.getAttribute("data-type") === "inline-math") {
                nextSibling.insertAdjacentHTML("beforebegin", "<wbr>");
                const oldHTML = nodeElement.outerHTML;
                nextSibling.previousElementSibling.remove();
                const newlineNode = document.createTextNode("\n");
                startElement.after(document.createTextNode(Constants.ZWSP));
                startElement.after(newlineNode);
                range.selectNode(newlineNode);
                range.collapse(false);
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                return true;
            }
        }
    }
    // 行内元素末尾软换行 https://github.com/siyuan-note/insider/issues/886
    if (startElement.nodeType === 3) {
        startElement = startElement.parentElement;
    }
    if (startElement && protyle.toolbar.getCurrentType(range).length > 0 &&
        getSelectionOffset(startElement, startElement, range).end === startElement.textContent.length) {
        addNewLineToEnd(range, nodeElement, protyle, startElement);
        return true;
    }
    if (isIPad() || isMobile()) {
        // iPad shift+enter 无效
        startElement = range.startContainer as HTMLElement;
        const nextSibling = hasNextSibling(startElement);
        if (nextSibling && nextSibling.textContent.trim() !== "") {
            document.execCommand("insertHTML", false, "\n");
            return true;
        }
        addNewLineToEnd(range, nodeElement, protyle, startElement);
        return true;
    }
    return false;
};

const addNewLineToEnd = (range: Range, nodeElement: HTMLElement, protyle: IProtyle, startElement: Element) => {
    const wbrElement = document.createElement("wbr");
    if (startElement.nodeType === 3) {
        range.insertNode(wbrElement);
    } else {
        startElement.insertAdjacentElement("afterend", wbrElement);
    }
    const oldHTML = nodeElement.outerHTML;
    wbrElement.remove();
    let endNewlineNode;
    if (!hasNextSibling(startElement)) {
        endNewlineNode = document.createTextNode("\n");
        startElement.after(endNewlineNode);
    }
    const newlineNode = document.createTextNode("\n");
    startElement.after(newlineNode);
    if (endNewlineNode) {
        range.setStart(endNewlineNode, 0);
    } else {
        range.setStart(newlineNode, 1);
    }
    range.collapse(true);
    focusByRange(range);
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
};
