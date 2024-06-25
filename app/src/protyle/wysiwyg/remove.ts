import {focusBlock, focusByRange, focusByWbr, getSelectionOffset, setLastNodeRange} from "../util/selection";
import {
    getContenteditableElement,
    getLastBlock,
    getNextBlock,
    getPreviousBlock,
    getTopAloneElement,
    getTopEmptyElement,
    hasNextSibling,
    hasPreviousSibling
} from "./getBlock";
import {transaction, turnsIntoTransaction, updateTransaction} from "./transaction";
import {cancelSB, genEmptyElement} from "../../block/util";
import {listOutdent, updateListOrder} from "./list";
import {setFold, zoomOut} from "../../menus/protyle";
import {preventScroll} from "../scroll/preventScroll";
import {hideElements} from "../ui/hideElements";
import {Constants} from "../../constants";
import {scrollCenter} from "../../util/highlightById";
import {isMobile} from "../../util/functions";

export const removeBlock = (protyle: IProtyle, blockElement: Element, range: Range, type: "Delete" | "Backspace" | "remove") => {
    // 删除后，防止滚动条滚动后调用 get 请求，因为返回的请求已查找不到内容块了
    preventScroll(protyle);
    const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
    if (selectElements?.length > 0) {
        const deletes: IOperation[] = [];
        const inserts: IOperation[] = [];
        let sideElement;
        let sideIsNext = false;
        if (type === "Backspace") {
            sideElement = selectElements[0].previousElementSibling;
            if (!sideElement) {
                sideIsNext = true;
                sideElement = selectElements[selectElements.length - 1].nextElementSibling;
            }
        } else {
            sideElement = selectElements[selectElements.length - 1].nextElementSibling;
            sideIsNext = true;
            if (!sideElement) {
                sideIsNext = false;
                sideElement = selectElements[0].previousElementSibling;
            }
        }
        let listElement: Element;
        let topParentElement: Element;
        hideElements(["select"], protyle);
        let foldPreviousId: string;
        selectElements.find((item: HTMLElement) => {
            const topElement = getTopAloneElement(item);
            topParentElement = topElement.parentElement;
            const id = topElement.getAttribute("data-node-id");
            deletes.push({
                action: "delete",
                id,
            });
            if (type === "Backspace") {
                sideElement = getPreviousBlock(topElement);
                if (!sideElement) {
                    sideIsNext = true;
                    sideElement = getNextBlock(topElement);
                }
            } else {
                sideElement = getNextBlock(topElement);
                sideIsNext = true;
                if (!sideElement) {
                    sideIsNext = false;
                    sideElement = getPreviousBlock(topElement);
                }
            }
            if (!sideElement) {
                sideElement = topElement.parentElement || protyle.wysiwyg.element.firstElementChild;
                sideIsNext = false;
            }
            if (topElement.getAttribute("data-type") === "NodeHeading" && topElement.getAttribute("fold") === "1") {
                // https://github.com/siyuan-note/siyuan/issues/2188
                setFold(protyle, topElement, undefined, true);
                let previousID = topElement.previousElementSibling ? topElement.previousElementSibling.getAttribute("data-node-id") : "";
                if (typeof foldPreviousId !== "undefined") {
                    previousID = foldPreviousId;
                }
                inserts.push({
                    action: "insert",
                    data: topElement.outerHTML,
                    id,
                    previousID: previousID,
                    parentID: topElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
                });
                // 折叠块和非折叠块同时删除时撤销异常 https://github.com/siyuan-note/siyuan/issues/11312
                let foldPreviousElement = getPreviousBlock(topElement);
                while (foldPreviousElement && foldPreviousElement.childElementCount === 3) {
                    foldPreviousElement = getPreviousBlock(foldPreviousElement);
                }
                if (foldPreviousElement) {
                    foldPreviousId = foldPreviousElement.getAttribute("data-node-id");
                } else {
                    foldPreviousId = "";
                }
                // https://github.com/siyuan-note/siyuan/issues/4422
                topElement.firstElementChild.removeAttribute("contenteditable");
                // 在折叠标题后输入文字，然后全选删除再撤销会重建索引。因此不能删除折叠标题后新输入的输入折叠标题下的内容
                const nextElement = topElement.nextElementSibling;
                if (nextElement) {
                    const nextType = nextElement.getAttribute("data-type");
                    if (nextType !== "NodeHeading" ||
                        (nextType === "NodeHeading" && nextElement.getAttribute("data-subtype") > topElement.getAttribute("data-subtype"))) {
                        return true;
                    }
                }
            } else {
                let data = topElement.outerHTML;    // 不能 spin ，否则 li 会变为 list
                if (topElement.classList.contains("render-node") || topElement.querySelector("div.render-node")) {
                    data = protyle.lute.SpinBlockDOM(topElement.outerHTML);  // 防止图表撤销问题
                }
                let previousID = topElement.previousElementSibling ? topElement.previousElementSibling.getAttribute("data-node-id") : "";
                if (typeof foldPreviousId !== "undefined") {
                    previousID = foldPreviousId;
                }
                inserts.push({
                    action: "insert",
                    data,
                    id,
                    previousID,
                    parentID: topElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
                });
                if (topElement.getAttribute("data-subtype") === "o" && topElement.classList.contains("li")) {
                    listElement = topElement.parentElement;
                } else {
                    listElement = undefined;
                }
                topElement.remove();
            }
        });
        if (sideElement) {
            if (protyle.block.showAll && sideElement.classList.contains("protyle-wysiwyg") && protyle.wysiwyg.element.childElementCount === 0) {
                setTimeout(() => {
                    zoomOut({protyle, id: protyle.block.parent2ID, focusId: protyle.block.parent2ID});
                }, Constants.TIMEOUT_INPUT * 2 + 100);
            } else {
                if ((sideElement.classList.contains("protyle-wysiwyg") && protyle.wysiwyg.element.childElementCount === 0)) {
                    const newID = Lute.NewNodeID();
                    const emptyElement = genEmptyElement(false, true, newID);
                    sideElement.insertAdjacentElement("afterbegin", emptyElement);
                    deletes.push({
                        action: "insert",
                        data: emptyElement.outerHTML,
                        id: newID,
                        parentID: sideElement.getAttribute("data-node-id") || protyle.block.parentID
                    });
                    inserts.push({
                        action: "delete",
                        id: newID,
                    });
                    sideElement = undefined;
                    focusByWbr(emptyElement, range);
                }
                // https://github.com/siyuan-note/siyuan/issues/5485
                // https://github.com/siyuan-note/siyuan/issues/10389
                // https://github.com/siyuan-note/siyuan/issues/10899
                if (type !== "Backspace" && sideIsNext) {
                    focusBlock(sideElement);
                } else {
                    focusBlock(sideElement, undefined, false);
                }
                scrollCenter(protyle, sideElement);
                if (listElement) {
                    inserts.push({
                        action: "update",
                        id: listElement.getAttribute("data-node-id"),
                        data: listElement.outerHTML
                    });
                    updateListOrder(listElement, 1);
                    deletes.push({
                        action: "update",
                        id: listElement.getAttribute("data-node-id"),
                        data: listElement.outerHTML
                    });
                }
            }
        }
        if (deletes.length > 0) {
            if (topParentElement && topParentElement.getAttribute("data-type") === "NodeSuperBlock" && topParentElement.childElementCount === 2) {
                const sbData = cancelSB(protyle, topParentElement);
                transaction(protyle, deletes.concat(sbData.doOperations), sbData.undoOperations.concat(inserts.reverse()));
            } else {
                transaction(protyle, deletes, inserts.reverse());
            }
        }

        hideElements(["util"], protyle);
        return;
    }
    const blockType = blockElement.getAttribute("data-type");
    // 空代码块直接删除
    if (blockType === "NodeCodeBlock" && getContenteditableElement(blockElement).textContent.trim() === "") {
        blockElement.classList.add("protyle-wysiwyg--select");
        removeBlock(protyle, blockElement, range, type);
        return;
    }

    if (!blockElement.previousElementSibling && blockElement.parentElement.getAttribute("data-type") === "NodeBlockquote") {
        range.insertNode(document.createElement("wbr"));
        const blockParentElement = blockElement.parentElement;
        blockParentElement.insertAdjacentElement("beforebegin", blockElement);
        if (blockParentElement.childElementCount === 1) {
            transaction(protyle, [{
                action: "move",
                id: blockElement.getAttribute("data-node-id"),
                previousID: blockElement.previousElementSibling?.getAttribute("data-node-id"),
                parentID: blockParentElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
            }, {
                action: "delete",
                id: blockParentElement.getAttribute("data-node-id")
            }], [{
                action: "insert",
                id: blockParentElement.getAttribute("data-node-id"),
                data: blockParentElement.outerHTML,
                previousID: blockElement.previousElementSibling?.getAttribute("data-node-id"),
                parentID: blockParentElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
            }, {
                action: "move",
                id: blockElement.getAttribute("data-node-id"),
                parentID: blockParentElement.getAttribute("data-node-id")
            }]);
            blockParentElement.remove();
        } else {
            transaction(protyle, [{
                action: "move",
                id: blockElement.getAttribute("data-node-id"),
                previousID: blockElement.previousElementSibling?.getAttribute("data-node-id"),
                parentID: blockParentElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
            }], [{
                action: "move",
                id: blockElement.getAttribute("data-node-id"),
                parentID: blockParentElement.getAttribute("data-node-id")
            }]);
        }
        focusByWbr(blockElement, range);
        return;
    }

    if (blockElement.parentElement.classList.contains("li") && blockElement.previousElementSibling.classList.contains("protyle-action")) {
        removeLi(protyle, blockElement, range, type === "Delete");
        return;
    }
    // 设置 bq 和代码块光标
    // 需放在列表处理后 https://github.com/siyuan-note/siyuan/issues/11606
    if (["NodeCodeBlock", "NodeTable", "NodeAttributeView"].includes(blockType)) {
        const previousElement = getPreviousBlock(blockElement)
        if (previousElement) {
            if (previousElement.classList.contains("p") && getContenteditableElement(previousElement).textContent === "") {
                // 空块向后删除时移除改块 https://github.com/siyuan-note/siyuan/issues/11732
                const ppElement = getPreviousBlock(previousElement)
                transaction(protyle, [{
                    action: "delete",
                    id: previousElement.getAttribute("data-node-id"),
                }], [{
                    action: "insert",
                    data: previousElement.outerHTML,
                    id: previousElement.getAttribute("data-node-id"),
                    parentID: protyle.block.parentID,
                    previousID: ppElement ? ppElement.getAttribute("data-node-id") : undefined
                }]);
                previousElement.remove();
            } else {
                focusBlock(previousElement, undefined, false);
            }
        }
        return;
    }
    if (blockType === "NodeHeading") {
        turnsIntoTransaction({
            protyle: protyle,
            selectsElement: [blockElement],
            type: "Blocks2Ps",
            range: moveToPrevious(blockElement, range, type === "Delete")
        });
        return;
    }
    if (blockElement.previousElementSibling && blockElement.previousElementSibling.classList.contains("protyle-breadcrumb__bar")) {
        return;
    }

    const previousElement = getPreviousBlock(blockElement) as HTMLElement;
    if (!previousElement) {
        if (protyle.wysiwyg.element.childElementCount > 1 && getContenteditableElement(blockElement).textContent === "") {
            focusBlock(protyle.wysiwyg.element.firstElementChild.nextElementSibling);
            // 列表项中包含超级块时需要到顶层
            const topElement = getTopAloneElement(blockElement);
            transaction(protyle, [{
                action: "delete",
                id: topElement.getAttribute("data-node-id"),
            }], [{
                action: "insert",
                data: topElement.outerHTML,
                id: topElement.getAttribute("data-node-id"),
                parentID: protyle.block.parentID
            }]);
            topElement.remove();
        }
        return;
    }

    const parentElement = blockElement.parentElement;
    const editableElement = getContenteditableElement(blockElement);
    const previousLastElement = getLastBlock(previousElement) as HTMLElement;
    if (range.toString() === "" && isMobile() && previousLastElement && previousLastElement.classList.contains("hr") && getSelectionOffset(editableElement).start === 0) {
        transaction(protyle, [{
            action: "delete",
            id: previousLastElement.getAttribute("data-node-id"),
        }], [{
            action: "insert",
            data: previousLastElement.outerHTML,
            id: previousLastElement.getAttribute("data-node-id"),
            previousID: previousLastElement.previousElementSibling?.getAttribute("data-node-id"),
            parentID: previousLastElement.parentElement.getAttribute("data-node-id")
        }]);
        previousLastElement.remove();
        return;
    }
    const isSelectNode = previousLastElement && (
        previousLastElement.classList.contains("table") ||
        previousLastElement.classList.contains("render-node") ||
        previousLastElement.classList.contains("iframe") ||
        previousLastElement.classList.contains("hr") ||
        previousLastElement.classList.contains("av") ||
        previousLastElement.classList.contains("code-block"));
    const previousId = previousLastElement.getAttribute("data-node-id");
    if (isSelectNode) {
        if (previousLastElement.classList.contains("code-block")) {
            if (editableElement.textContent.trim() === "") {
                const id = blockElement.getAttribute("data-node-id");
                const doOperations: IOperation[] = [{
                    action: "delete",
                    id,
                }];
                const undoOperations: IOperation[] = [{
                    action: "insert",
                    data: blockElement.outerHTML,
                    id: id,
                    previousID: blockElement.previousElementSibling?.getAttribute("data-node-id"),
                    parentID: blockElement.parentElement.getAttribute("data-node-id")
                }];
                blockElement.remove();
                // 取消超级块
                if (parentElement.getAttribute("data-type") === "NodeSuperBlock" && parentElement.childElementCount === 2) {
                    const sbData = cancelSB(protyle, parentElement);
                    transaction(protyle, doOperations.concat(sbData.doOperations), sbData.undoOperations.concat(undoOperations));
                } else {
                    transaction(protyle, doOperations, undoOperations);
                }
                focusBlock(protyle.wysiwyg.element.querySelector(`[data-node-id="${previousId}"]`), undefined, false);
            } else {
                focusBlock(previousLastElement, undefined, false);
            }
            return;
        }
        if (editableElement.textContent !== "" ||
            // https://github.com/siyuan-note/siyuan/issues/10207
            blockElement.classList.contains("av")) {
            focusBlock(previousLastElement, undefined, false);
            return;
        }
    }

    const removeElement = getTopEmptyElement(blockElement);
    const removeId = removeElement.getAttribute("data-node-id");
    range.insertNode(document.createElement("wbr"));
    const undoOperations: IOperation[] = [{
        action: "update",
        data: previousLastElement.outerHTML,
        id: previousId,
    }, {
        action: "insert",
        data: removeElement.outerHTML,
        id: removeId,
        // 不能使用 previousLastElement，否则在超级块下的元素前删除撤销错误
        previousID: blockElement.previousElementSibling?.getAttribute("data-node-id"),
        parentID: parentElement.getAttribute("data-node-id")
    }];
    const doOperations: IOperation[] = [{
        action: "delete",
        id: removeId,
    }];

    if (isSelectNode) {
        // 需先移除 removeElement，否则 side 会选中 removeElement
        removeElement.remove();
        focusBlock(previousLastElement, undefined, false);
    } else {
        const previousLastEditElement = getContenteditableElement(previousLastElement);
        if (editableElement && editableElement.textContent !== "") {
            // 非空块
            range.setEndAfter(editableElement.lastChild);
            // 数学公式回车后再删除 https://github.com/siyuan-note/siyuan/issues/3850
            if ((previousLastEditElement?.lastElementChild?.getAttribute("data-type") || "").indexOf("inline-math") > -1) {
                const lastSibling = hasNextSibling(previousLastEditElement?.lastElementChild);
                if (lastSibling && lastSibling.textContent === "\n") {
                    lastSibling.remove();
                }
            }
        }
        const scroll = protyle.contentElement.scrollTop;
        const leftNodes = range.extractContents();
        range.selectNodeContents(previousLastEditElement);
        range.collapse(false);
        range.insertNode(leftNodes);
        removeElement.remove();
        // extractContents 内容过多时需要进行滚动条重置，否则位置会错位
        protyle.contentElement.scrollTop = scroll;
        protyle.scroll.lastScrollTop = scroll - 1;
        doOperations.push({
            action: "update",
            data: previousLastElement.outerHTML,
            id: previousId,
        });
    }
    if (parentElement.getAttribute("data-type") === "NodeSuperBlock" && parentElement.childElementCount === 2) {
        const sbData = cancelSB(protyle, parentElement);
        transaction(protyle, doOperations.concat(sbData.doOperations), sbData.undoOperations.concat(undoOperations));
    } else {
        transaction(protyle, doOperations, undoOperations);
    }
    focusByWbr(protyle.wysiwyg.element, range);
};

export const moveToPrevious = (blockElement: Element, range: Range, isDelete: boolean) => {
    if (isDelete) {
        const previousBlockElement = getPreviousBlock(blockElement);
        if (previousBlockElement) {
            const previousEditElement = getContenteditableElement(getLastBlock(previousBlockElement));
            if (previousEditElement) {
                return setLastNodeRange(previousEditElement, range, false);
            }
        }
    }
};

// https://github.com/siyuan-note/siyuan/issues/10393
export const removeImage = (imgSelectElement: Element, nodeElement: HTMLElement, range: Range, protyle: IProtyle) => {
    const oldHTML = nodeElement.outerHTML;
    const imgPreviousSibling = hasPreviousSibling(imgSelectElement);
    if (imgPreviousSibling && imgPreviousSibling.textContent.endsWith(Constants.ZWSP)) {
        imgPreviousSibling.textContent = imgPreviousSibling.textContent.substring(0, imgPreviousSibling.textContent.length - 1);
    }
    const imgNextSibling = hasNextSibling(imgSelectElement);
    if (imgNextSibling && imgNextSibling.textContent.startsWith(Constants.ZWSP)) {
        imgNextSibling.textContent = imgNextSibling.textContent.replace(Constants.ZWSP, "");
    }
    imgSelectElement.insertAdjacentHTML("afterend", "<wbr>");
    imgSelectElement.remove();
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
    focusByWbr(nodeElement, range);
    // 不太清楚为什么删除图片后无法上下键定位，但重绘后就好了 https://ld246.com/article/1714314625702
    const editElement = getContenteditableElement(nodeElement);
    if (editElement.innerHTML.trim() === "") {
        editElement.innerHTML = "";
    }
};

const removeLi = (protyle: IProtyle, blockElement: Element, range: Range, isDelete = false) => {
    if (!blockElement.parentElement.previousElementSibling && blockElement.parentElement.nextElementSibling && blockElement.parentElement.nextElementSibling.classList.contains("protyle-attr")) {
        listOutdent(protyle, [blockElement.parentElement], range, isDelete, blockElement);
        return;
    }
    // 第一个子列表合并到上一个块的末尾
    if (!blockElement.parentElement.previousElementSibling && blockElement.parentElement.parentElement.parentElement.classList.contains("list")) {
        range.insertNode(document.createElement("wbr"));
        const listElement = blockElement.parentElement.parentElement;
        const listHTML = listElement.outerHTML;
        const previousLastElement = blockElement.parentElement.parentElement.previousElementSibling.lastElementChild;
        const previousHTML = previousLastElement.parentElement.outerHTML;
        blockElement.parentElement.firstElementChild.remove();
        blockElement.parentElement.lastElementChild.remove();
        previousLastElement.insertAdjacentHTML("beforebegin", blockElement.parentElement.innerHTML);
        blockElement.parentElement.remove();
        if (listElement.getAttribute("data-subtype") === "o") {
            updateListOrder(listElement);
        }
        transaction(protyle, [{
            action: "update",
            id: listElement.getAttribute("data-node-id"),
            data: listElement.outerHTML
        }, {
            action: "update",
            data: previousLastElement.parentElement.outerHTML,
            id: previousLastElement.parentElement.getAttribute("data-node-id"),
        }], [{
            action: "update",
            data: previousHTML,
            id: previousLastElement.parentElement.getAttribute("data-node-id"),
        }, {
            action: "update",
            data: listHTML,
            id: listElement.getAttribute("data-node-id"),
        }]);
        focusByWbr(previousLastElement.parentElement, range);
        return;
    }
    // 顶级列表首行删除变为块
    if (!blockElement.parentElement.previousElementSibling) {
        if (blockElement.parentElement.parentElement.classList.contains("protyle-wysiwyg")) {
            return;
        }
        moveToPrevious(blockElement, range, isDelete);
        range.insertNode(document.createElement("wbr"));
        const listElement = blockElement.parentElement.parentElement;
        const listHTML = listElement.outerHTML;
        blockElement.parentElement.firstElementChild.remove();
        blockElement.parentElement.lastElementChild.remove();
        const tempElement = document.createElement("div");
        tempElement.innerHTML = blockElement.parentElement.innerHTML;
        const doOperations: IOperation[] = [];
        const undoOperations: IOperation[] = [];
        Array.from(tempElement.children).forEach((item, index) => {
            doOperations.push({
                action: "insert",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML,
                previousID: index === 0 ? listElement.previousElementSibling?.getAttribute("data-node-id") : doOperations[index - 1].id,
                parentID: listElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
            });
            undoOperations.push({
                action: "delete",
                id: item.getAttribute("data-node-id"),
            });
        });
        listElement.insertAdjacentHTML("beforebegin", blockElement.parentElement.innerHTML);
        blockElement.parentElement.remove();
        if (listElement.getAttribute("data-subtype") === "o") {
            updateListOrder(listElement, parseInt(listElement.firstElementChild.getAttribute("data-marker")) - 1);
        }
        doOperations.splice(0, 0, {
            action: "update",
            id: listElement.getAttribute("data-node-id"),
            data: listElement.outerHTML
        });
        undoOperations.push({
            action: "update",
            data: listHTML,
            id: listElement.getAttribute("data-node-id"),
        });
        transaction(protyle, doOperations, undoOperations);
        focusByWbr(protyle.wysiwyg.element, range);
        return;
    }

    // 列表项合并到前一个列表项的最后一个块末尾
    const listItemElement = blockElement.parentElement;
    if (listItemElement.previousElementSibling && listItemElement.previousElementSibling.classList.contains("protyle-breadcrumb__bar")) {
        return;
    }
    const listItemId = listItemElement.getAttribute("data-node-id");
    const listElement = listItemElement.parentElement;
    moveToPrevious(blockElement, range, isDelete);
    range.insertNode(document.createElement("wbr"));
    const html = listElement.outerHTML;
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [{
        action: "insert",
        id: listItemId,
        data: "",
        previousID: listItemElement.previousElementSibling.getAttribute("data-node-id")
    }];
    const previousLastElement = listItemElement.previousElementSibling.lastElementChild;
    if (listItemElement.previousElementSibling.getAttribute("fold") === "1") {
        if (getContenteditableElement(blockElement).textContent.trim() === "" &&
            blockElement.nextElementSibling.classList.contains("protyle-attr")) {
            doOperations.push({
                action: "delete",
                id: listItemId
            });
            undoOperations[0].data = listItemElement.outerHTML;
            setLastNodeRange(getContenteditableElement(listItemElement.previousElementSibling), range);
            range.collapse(true);
            listItemElement.remove();
        } else {
            setLastNodeRange(getContenteditableElement(listItemElement.previousElementSibling), range);
            range.collapse(true);
            focusByRange(range);
            blockElement.querySelector("wbr")?.remove();
            return;
        }
    } else {
        let previousID = previousLastElement.previousElementSibling.getAttribute("data-node-id");
        Array.from(blockElement.parentElement.children).forEach((item, index) => {
            if (item.classList.contains("protyle-action") || item.classList.contains("protyle-attr")) {
                return;
            }
            const id = item.getAttribute("data-node-id");
            doOperations.push({
                action: "move",
                id,
                previousID,
            });
            undoOperations.push({
                action: "move",
                id,
                previousID: index === 1 ? undefined : previousID,
                parentID: listItemId
            });
            previousID = id;
            previousLastElement.before(item);
        });
        doOperations.push({
            action: "delete",
            id: listItemId
        });
        undoOperations[0].data = listItemElement.outerHTML;
        listItemElement.remove();
    }

    if (listElement.classList.contains("protyle-wysiwyg")) {
        transaction(protyle, doOperations, undoOperations);
    } else {
        if (listElement.getAttribute("data-subtype") === "o") {
            updateListOrder(listElement);
        }
        updateTransaction(protyle, listElement.getAttribute("data-node-id"), listElement.outerHTML, html);
    }
    focusByWbr(previousLastElement.parentElement, range);
};
