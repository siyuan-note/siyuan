import {genEmptyElement, insertEmptyBlock} from "../../block/util";
import {getSelectionOffset, focusByWbr, setLastNodeRange} from "../util/selection";
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
import {setStorageVal} from "../util/compatibility";

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
        const html = listItemElement.parentElement.outerHTML;
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
    if ((range.toString() === "" || range.toString() === Constants.ZWSP) && range.startContainer.nodeType === 3 && range.startContainer.textContent === Constants.ZWSP && range.startOffset === 0) {
        // 图片后的零宽空格前回车 https://github.com/siyuan-note/siyuan/issues/5690
        // 列表中的图片后双击换行图片光标错误 https://ld246.com/article/1660987186727/comment/1662181221732?r=Vanessa#comments
        range.setStart(range.startContainer, 1);
        range.collapse(false);
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

export const enter = (blockElement: HTMLElement, range: Range, protyle: IProtyle) => {
    const disableElement = isNotEditBlock(blockElement);
    if (!disableElement && blockElement.classList.contains("protyle-wysiwyg--select")) {
        setLastNodeRange(getContenteditableElement(blockElement), range, false);
        range.collapse(false);
        hideElements(["select"], protyle);
        return;
    }
    // https://github.com/siyuan-note/siyuan/issues/5471
    if (disableElement) {
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
                highlightRender(blockElement);
            } else {
                protyle.toolbar.showRender(protyle, blockElement);
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
    if (range.toString() === "" && range.startContainer.nodeType === 3 && range.startContainer.textContent === Constants.ZWSP && range.startOffset === 0) {
        // 图片后的零宽空格前回车 https://github.com/siyuan-note/siyuan/issues/5690
        range.setStart(range.startContainer, 1);
    }
    range.insertNode(document.createElement("wbr"));
    const html = blockElement.outerHTML;
    if (range.toString() !== "") {
        range.extractContents();
        range.insertNode(document.createElement("wbr"));
    }
    if (editableElement.lastChild) {
        range.setEndAfter(editableElement.lastChild);
    }
    const newElement = genEmptyElement(false, false);
    const selectNode = range.extractContents();
    if (selectNode.firstChild && selectNode.firstChild.nodeType !== 3 && selectNode.firstChild.textContent === "") {
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
    getContenteditableElement(newElement).appendChild(selectNode);
    const id = blockElement.getAttribute("data-node-id");
    const newId = newElement.getAttribute("data-node-id");
    blockElement.insertAdjacentElement("afterend", newElement);
    transaction(protyle, [{
        action: "update",
        data: blockElement.outerHTML,
        id: id,
    }, {
        action: "insert",
        data: newElement.outerHTML,
        id: newId,
        previousID: id,
    }], [{
        action: "delete",
        id: newId,
    }, {
        action: "update",
        data: html,
        id: id,
    }]);
    blockElement.insertAdjacentElement("afterend", newElement);
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
