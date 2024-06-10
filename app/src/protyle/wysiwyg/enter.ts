import {genEmptyElement, insertEmptyBlock} from "../../block/util";
import {focusBlock, focusByRange, focusByWbr, getSelectionOffset, setLastNodeRange} from "../util/selection";
import {
    getContenteditableElement,
    getTopEmptyElement,
    hasNextSibling,
    hasPreviousSibling,
    isNotEditBlock
} from "./getBlock";
import {transaction, updateTransaction} from "./transaction";
import {breakList, genListItemElement, listOutdent, updateListOrder} from "./list";
import {highlightRender} from "../render/highlightRender";
import {Constants} from "../../constants";
import {scrollCenter} from "../../util/highlightById";
import {hideElements} from "../ui/hideElements";
import {isIPad, setStorageVal} from "../util/compatibility";
import {mathRender} from "../render/mathRender";
import {isMobile} from "../../util/functions";
import {processRender} from "../util/processCode";
import {hasClosestByClassName} from "../util/hasClosest";

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
    // https://github.com/siyuan-note/siyuan/issues/5471
    if (disableElement ||
        // https://github.com/siyuan-note/siyuan/issues/10633
        blockElement.classList.contains("table")) {
        if (blockElement.parentElement.classList.contains("li")) {
            const oldHTML = blockElement.parentElement.parentElement.outerHTML;
            const newElement = genListItemElement(blockElement.parentElement, 0, true);
            blockElement.parentElement.insertAdjacentElement("afterend", newElement);
            updateTransaction(protyle, blockElement.parentElement.parentElement.getAttribute("data-node-id"), blockElement.parentElement.parentElement.outerHTML, oldHTML);
            focusByWbr(newElement, range);
            removeEmptyNode(newElement);
            scrollCenter(protyle);
            return;
        }
        if (blockElement.classList.contains("hr")) {
            insertEmptyBlock(protyle, "afterend");
            return;
        }
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
    // 代码块
    const trimStartText = editableElement.innerHTML.trimStart();
    if (trimStartText.startsWith("```") || trimStartText.startsWith("···") || trimStartText.startsWith("~~~") ||
        trimStartText.indexOf("\n```") > -1 || trimStartText.indexOf("\n~~~") > -1 || trimStartText.indexOf("\n···") > -1) {
        if (trimStartText.indexOf("\n") === -1 && trimStartText.replace(/·|~/g, "`").replace(/^`{3,}/g, "").indexOf("`") > -1) {
            // ```test` 不处理，正常渲染为段落块
        } else if (blockElement.classList.contains("p")) { // https://github.com/siyuan-note/siyuan/issues/6953
            const oldHTML = blockElement.outerHTML;
            let replaceInnerHTML = editableElement.innerHTML.replace(/\n(~|·|`){3,}/g, "\n```").trim().replace(/^(~|·|`){3,}/g, "```");
            if (!replaceInnerHTML.endsWith("\n```")) {
                replaceInnerHTML += "<wbr>\n```";
            }
            editableElement.innerHTML = replaceInnerHTML;
            blockElement.outerHTML = protyle.lute.SpinBlockDOM(blockElement.outerHTML);
            blockElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${blockElement.getAttribute("data-node-id")}"]`);
            const languageElement = blockElement.querySelector(".protyle-action__language");
            if (languageElement) {
                if (window.siyuan.storage[Constants.LOCAL_CODELANG] && languageElement.textContent === "") {
                    languageElement.textContent = window.siyuan.storage[Constants.LOCAL_CODELANG];
                } else {
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
        editableElement.removeAttribute("data-render");
        highlightRender(blockElement);
        updateTransaction(protyle, blockElement.getAttribute("data-node-id"), blockElement.outerHTML, oldHTML);
        return true;
    }

    // bq
    if (editableElement.textContent.replace(Constants.ZWSP, "").replace("\n", "") === "" &&
        blockElement.nextElementSibling && blockElement.nextElementSibling.classList.contains("protyle-attr") && blockElement.parentElement.getAttribute("data-type") === "NodeBlockquote") {
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
        if (topId === blockId) {
            doInsert.previousID = blockElement.parentElement.getAttribute("data-node-id");
            undoInsert.previousID = blockElement.previousElementSibling.getAttribute("data-node-id");
            blockElement.parentElement.after(blockElement);
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
        const newElement = genEmptyElement(false, true);
        const newId = newElement.getAttribute("data-node-id");
        transaction(protyle, [{
            action: "insert",
            data: newElement.outerHTML,
            id: newId,
            previousID: blockElement.previousElementSibling ? blockElement.previousElementSibling.getAttribute("data-node-id") : "",
            parentID: blockElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
        }], [{
            action: "delete",
            id: newId,
        }]);
        newElement.querySelector("wbr").remove();
        blockElement.insertAdjacentElement("beforebegin", newElement);
        removeEmptyNode(newElement);
        return true;
    }
    const wbrElement = document.createElement("wbr");
    range.insertNode(wbrElement);
    const html = blockElement.outerHTML;
    wbrElement.remove();
    if (range.toString() !== "") {
        range.extractContents();
    }
    if (editableElement.lastChild) {
        range.setEndAfter(editableElement.lastChild);
    }

    const id = blockElement.getAttribute("data-node-id");
    const newElement = document.createElement("div");
    newElement.appendChild(genEmptyElement(false, false));
    const newEditableElement = newElement.querySelector('[contenteditable="true"]');
    newEditableElement.appendChild(range.extractContents());
    const newHTML = newEditableElement.innerHTML.trimStart();
    // https://github.com/siyuan-note/siyuan/issues/10759
    if (newHTML.startsWith("```") || newHTML.startsWith("···") || newHTML.startsWith("~~~") ||
        newHTML.indexOf("\n```") > -1 || newHTML.indexOf("\n~~~") > -1 || newHTML.indexOf("\n···") > -1) {
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
        mathRender(item);
        currentElement = item;
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
        } else {
            mathRender(currentElement.nextElementSibling);
        }
        currentElement = item;
    });
    transaction(protyle, doOperation, undoOperation);
    focusBlock(currentElement);
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
        blockElement.nextElementSibling.isSameNode(subListElement)) {
        // 含有子列表的换行
        if (position.end >= editableElement.textContent.length -
            // 数学公式结尾会有 zwsp https://github.com/siyuan-note/siyuan/issues/6679
            (editableElement.textContent.endsWith(Constants.ZWSP) ? 1 : 0)) {
            // 段末换行，在子列表中插入
            range.insertNode(document.createElement("wbr"));
            const html = subListElement.outerHTML;
            blockElement.querySelector("wbr").remove();
            newElement = genListItemElement(subListElement.firstElementChild, -1, true);
            subListElement.firstElementChild.before(newElement);
            if (subListElement.getAttribute("data-subtype") === "o") {
                updateListOrder(subListElement);
            }
            updateTransaction(protyle, subListElement.getAttribute("data-node-id"), subListElement.outerHTML, html);
            focusByWbr(listItemElement, range);
            scrollCenter(protyle);
        } else {
            // 文字中间换行
            range.insertNode(document.createElement("wbr"));
            const listItemHTMl = listItemElement.outerHTML;
            const html = listItemElement.parentElement.outerHTML;
            if (range.toString() !== "") {
                range.extractContents();
                range.insertNode(document.createElement("wbr"));
            }
            range.setEndAfter(editableElement.lastChild);
            newElement = genListItemElement(listItemElement, 0, false);
            const newEditElement = getContenteditableElement(newElement);
            newEditElement.appendChild(range.extractContents());
            newEditElement.parentElement.after(subListElement);
            listItemElement.insertAdjacentElement("afterend", newElement);
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
                    data: listItemHTMl,
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
    const html = listItemElement.parentElement.outerHTML;
    if (range.toString() !== "") {
        range.extractContents();
        range.insertNode(document.createElement("wbr"));
    }
    range.setEndAfter(editableElement.lastChild);
    newElement = genListItemElement(listItemElement, 0, false);
    const selectNode = range.extractContents();
    if (selectNode.firstChild.nodeType !== 3 && selectNode.firstChild.textContent === "") {
        // 回车移除空元素 https://github.com/siyuan-note/insider/issues/480
        selectNode.firstChild.after(document.createElement("wbr"));
        selectNode.firstChild.remove();
    }
    // https://github.com/siyuan-note/siyuan/issues/3850
    // https://github.com/siyuan-note/siyuan/issues/6018
    if ((editableElement?.lastElementChild?.getAttribute("data-type") || "").indexOf("inline-math") > -1 &&
        !hasNextSibling(editableElement?.lastElementChild)) {
        editableElement.insertAdjacentText("beforeend", "\n");
    }
    // img 后有文字，在 img 后换行
    if (editableElement?.lastElementChild?.classList.contains("img") && !hasNextSibling(editableElement?.lastElementChild)) {
        editableElement.insertAdjacentText("beforeend", Constants.ZWSP);
    }
    getContenteditableElement(newElement).appendChild(selectNode);
    listItemElement.insertAdjacentElement("afterend", newElement);
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
        updateTransaction(protyle, listItemElement.parentElement.getAttribute("data-node-id"), listItemElement.parentElement.outerHTML, html);
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
    // 图片之前软换行
    if (nextSibling && nextSibling.nodeType !== 3 && nextSibling.classList.contains("img")) {
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
