import {focusBlock, focusByRange, focusByWbr, getSelectionOffset, setLastNodeRange} from "../util/selection";
import {
    getContenteditableElement,
    getLastBlock,
    getNextBlock, getParentBlock,
    getPreviousBlock,
    getTopAloneElement,
    getTopEmptyElement,
    hasNextSibling,
    hasPreviousSibling
} from "./getBlock";
import {transaction, turnsIntoOneTransaction, turnsIntoTransaction, updateTransaction} from "./transaction";
import {cancelSB, genEmptyElement} from "../../block/util";
import {listOutdent, updateListOrder} from "./list";
import {setFold, zoomOut} from "../../menus/protyle";
import {preventScroll} from "../scroll/preventScroll";
import {hideElements} from "../ui/hideElements";
import {Constants} from "../../constants";
import {scrollCenter} from "../../util/highlightById";
import {isMobile} from "../../util/functions";
import {mathRender} from "../render/mathRender";
import {hasClosestBlock, hasClosestByClassName} from "../util/hasClosest";
import {getInstanceById} from "../../layout/util";
import {Tab} from "../../layout/Tab";
import {Backlink} from "../../layout/dock/Backlink";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {onGet} from "../util/onGet";

export const removeBlock = async (protyle: IProtyle, blockElement: Element, range: Range, type: "Delete" | "Backspace" | "remove") => {
    protyle.observerLoad?.disconnect();
    // 删除后，防止滚动条滚动后调用 get 请求，因为返回的请求已查找不到内容块了
    preventScroll(protyle);
    const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
    if (selectElements?.length > 0) {
        const deletes: IOperation[] = [];
        const inserts: IOperation[] = [];
        let sideElement: Element | boolean;
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
        const unfoldData: {
            [key: string]: {
                element: Element,
                previousID?: string
            }
        } = {};
        for (let i = 0; i < selectElements.length; i++) {
            const item = selectElements[i];
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
            if (!sideElement && !protyle.options.backlinkData) {
                sideElement = topElement.parentElement || protyle.wysiwyg.element.firstElementChild;
                sideIsNext = false;
            }
            if (topElement.getAttribute("data-type") === "NodeHeading" && topElement.getAttribute("fold") === "1") {
                const foldTransaction = await fetchSyncPost("/api/block/getHeadingDeleteTransaction", {
                    id: topElement.getAttribute("data-node-id"),
                });
                deletes.push(...foldTransaction.data.doOperations.slice(1));
                foldTransaction.data.undoOperations.forEach((operationItem: IOperation, index: number) => {
                    if (index > 0) {
                        operationItem.context = {
                            ignoreProcess: "true"
                        };
                    }
                });
                foldTransaction.data.undoOperations.reverse();
                if (topElement.previousElementSibling &&
                    topElement.previousElementSibling.getAttribute("data-type") === "NodeHeading" &&
                    topElement.previousElementSibling.getAttribute("fold") === "1") {
                    const foldId = topElement.previousElementSibling.getAttribute("data-node-id");
                    if (!unfoldData[foldId]) {
                        const foldTransaction = await fetchSyncPost("/api/block/getHeadingDeleteTransaction", {
                            id: foldId,
                        });
                        unfoldData[foldId] = {
                            element: topElement.previousElementSibling,
                            previousID: foldTransaction.data.doOperations[foldTransaction.data.doOperations.length - 1].id
                        };
                    }
                }
                inserts.push(...foldTransaction.data.undoOperations);
                // https://github.com/siyuan-note/siyuan/issues/4422
                topElement.firstElementChild.removeAttribute("contenteditable");
                topElement.remove();
            } else {
                let data = topElement.outerHTML;    // 不能 spin ，否则 li 会变为 list
                if (topElement.classList.contains("render-node") || topElement.querySelector("div.render-node")) {
                    data = protyle.lute.SpinBlockDOM(topElement.outerHTML);  // 防止图表撤销问题
                }
                let previousID = topElement.previousElementSibling ? topElement.previousElementSibling.getAttribute("data-node-id") : "";
                if (topElement.previousElementSibling &&
                    topElement.previousElementSibling.getAttribute("data-type") === "NodeHeading" &&
                    topElement.previousElementSibling.getAttribute("fold") === "1") {
                    const foldId = topElement.previousElementSibling.getAttribute("data-node-id");
                    if (!unfoldData[foldId]) {
                        const foldTransaction = await fetchSyncPost("/api/block/getHeadingDeleteTransaction", {
                            id: foldId,
                        });
                        unfoldData[foldId] = {
                            element: topElement.previousElementSibling,
                            previousID: foldTransaction.data.doOperations[foldTransaction.data.doOperations.length - 1].id
                        };
                    }
                    previousID = unfoldData[foldId].previousID;
                }
                inserts.push({
                    action: "insert",
                    data,
                    id,
                    previousID,
                    parentID: getParentBlock(topElement)?.getAttribute("data-node-id") || protyle.block.parentID
                });
                if (topElement.getAttribute("data-subtype") === "o" && topElement.classList.contains("li")) {
                    listElement = topElement.parentElement;
                } else {
                    listElement = undefined;
                }
                // https://github.com/siyuan-note/siyuan/issues/12327
                if (topElement.parentElement.classList.contains("li") && topElement.parentElement.childElementCount === 4 &&
                    topElement.parentElement.getAttribute("fold") === "1") {
                    unfoldData[topElement.parentElement.getAttribute("data-node-id")] = {
                        element: topElement.parentElement,
                    };
                }
                topElement.remove();
            }
        }
        Object.keys(unfoldData).forEach(item => {
            const foldOperations = setFold(protyle, unfoldData[item].element, true, false, false, true);
            deletes.push(...foldOperations.doOperations);
            inserts.splice(0, 0, ...foldOperations.undoOperations);
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
                    focusBlock(sideElement as Element);
                } else {
                    focusBlock(sideElement as Element, undefined, false);
                }
                scrollCenter(protyle, sideElement as Element);
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
                const sbData = await cancelSB(protyle, topParentElement, range);
                transaction(protyle, deletes.concat(sbData.doOperations), sbData.undoOperations.concat(inserts.reverse()));
            } else {
                transaction(protyle, deletes, inserts.reverse());
            }
        }

        hideElements(["util"], protyle);
        /// #if !MOBILE
        if (!sideElement) {
            const backlinkElement = hasClosestByClassName(protyle.element, "sy__backlink", true);
            if (backlinkElement) {
                const backLinkTab = getInstanceById(backlinkElement.getAttribute("data-id"), window.siyuan.layout.layout);
                if (backLinkTab instanceof Tab && backLinkTab.model instanceof Backlink) {
                    const editors = backLinkTab.model.editors;
                    editors.find((item, index) => {
                        if (item.protyle.element === protyle.element) {
                            item.destroy();
                            editors.splice(index, 1);
                            item.protyle.element.previousElementSibling.remove();
                            item.protyle.element.remove();
                            return true;
                        }
                    });
                }
            }
        }
        /// #endif
        // https://github.com/siyuan-note/siyuan/issues/16767
        setTimeout(() => {
            if (protyle.wysiwyg.element.lastElementChild.getAttribute("data-eof") !== "2" &&
                !protyle.scroll.element.classList.contains("fn__none") &&
                protyle.contentElement.scrollHeight - protyle.contentElement.scrollTop < protyle.contentElement.clientHeight * 2
            ) {
                fetchPost("/api/filetree/getDoc", {
                    id: protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id"),
                    mode: 2,
                    size: window.siyuan.config.editor.dynamicLoadBlocks,
                }, getResponse => {
                    onGet({
                        data: getResponse,
                        protyle,
                        action: [Constants.CB_GET_APPEND, Constants.CB_GET_UNCHANGEID],
                    });
                });
            }
        }, Constants.TIMEOUT_COUNT);// 需等待滚动阻塞、后台处理完成。否则会加载已删除的内容
        return;
    }
    const blockType = blockElement.getAttribute("data-type");
    // 空代码块直接删除
    if (blockType === "NodeCodeBlock" && getContenteditableElement(blockElement)?.textContent.trim() === "") {
        blockElement.classList.add("protyle-wysiwyg--select");
        removeBlock(protyle, blockElement, range, type);
        return;
    }

    let isCallout = blockElement.parentElement.classList.contains("callout-content");
    if (type === "Delete") {
        const bqCaElement = hasClosestByClassName(blockElement, "bq") || hasClosestByClassName(blockElement, "callout");
        if (bqCaElement) {
            isCallout = bqCaElement.classList.contains("callout");
            blockElement = isCallout ? bqCaElement.querySelector(".callout-content").firstElementChild : bqCaElement.firstElementChild;
        }
    }
    const blockParentElement = isCallout ? blockElement.parentElement.parentElement : blockElement.parentElement;
    if (!blockElement.previousElementSibling && (blockElement.parentElement.getAttribute("data-type") === "NodeBlockquote" || isCallout) && (
        (type !== "Delete" && blockType !== "NodeHeading") ||
        (type === "Delete" && blockParentElement.parentElement.classList.contains("protyle-wysiwyg"))
    )) {
        if (type !== "Delete") {
            range.insertNode(document.createElement("wbr"));
        }
        blockParentElement.insertAdjacentElement("beforebegin", blockElement);
        if (isCallout ? blockParentElement.querySelector(".callout-content").childElementCount === 0 :
            blockParentElement.childElementCount === 1) {
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
        if (type === "Delete") {
            moveToPrevious(blockElement, range, true);
        } else {
            focusByWbr(blockElement, range);
        }
        return;
    }

    if (blockElement.parentElement.classList.contains("li") && blockType !== "NodeHeading" &&
        blockElement.previousElementSibling.classList.contains("protyle-action")) {
        removeLi(protyle, blockElement, range, type === "Delete");
        return;
    }
    if (type === "Delete") {
        const liElement = hasClosestByClassName(blockElement, "li");
        if (liElement) {
            removeLi(protyle, liElement.firstElementChild.nextElementSibling, range, true);
            return;
        }
    }
    const previousElement = getPreviousBlock(blockElement) as HTMLElement;
    // 设置 bq 和代码块光标
    // 需放在列表处理后 https://github.com/siyuan-note/siyuan/issues/11606
    if (["NodeCodeBlock", "NodeTable", "NodeAttributeView"].includes(blockType)) {
        if (previousElement) {
            if (previousElement.classList.contains("p") && getContenteditableElement(previousElement).textContent === "") {
                // 空块向后删除时移除改块 https://github.com/siyuan-note/siyuan/issues/11732
                const ppElement = getPreviousBlock(previousElement);
                transaction(protyle, [{
                    action: "delete",
                    id: previousElement.getAttribute("data-node-id"),
                }], [{
                    action: "insert",
                    data: previousElement.outerHTML,
                    id: previousElement.getAttribute("data-node-id"),
                    parentID: previousElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID,
                    previousID: (ppElement && (!previousElement.previousElementSibling || !previousElement.previousElementSibling.classList.contains("protyle-action"))) ? ppElement.getAttribute("data-node-id") : undefined
                }]);
                previousElement.remove();
            } else {
                focusBlock(previousElement, undefined, false);
            }
        }
        return;
    }
    if (blockType === "NodeHeading") {
        if (blockElement.previousElementSibling &&
            blockElement.previousElementSibling.getAttribute("data-type") === "NodeHeading" &&
            blockElement.previousElementSibling.getAttribute("fold") === "1") {
            setFold(protyle, blockElement.previousElementSibling, true, false, false);
        }
        if (blockType === "NodeHeading" &&
            blockElement.getAttribute("fold") === "1") {
            setFold(protyle, blockElement, true, false, false);
        }
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

    const parentElement = hasClosestBlock(blockElement.parentElement);
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
                if (parentElement && parentElement.getAttribute("data-type") === "NodeSuperBlock" && parentElement.childElementCount === 2) {
                    const sbData = await cancelSB(protyle, parentElement);
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
        parentID: parentElement ? parentElement.getAttribute("data-node-id") : protyle.block.parentID
    }];
    const doOperations: IOperation[] = [{
        action: "delete",
        id: removeId,
    }];

    if (isSelectNode) {
        // 需先移除 removeElement，否则 side 会选中 removeElement
        removeElement.remove();
        focusBlock(previousLastElement, undefined, false);
        // https://github.com/siyuan-note/siyuan/issues/13254
        undoOperations.splice(0, 1);
    } else {
        const previousLastEditElement = getContenteditableElement(previousLastElement);
        if (editableElement && (editableElement.textContent !== "" || editableElement.querySelector(".emoji"))) {
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

        // https://github.com/siyuan-note/siyuan/issues/14807
        if (previousLastEditElement) {
            let previousLastChild = previousLastEditElement.lastChild;
            if (previousLastChild && previousLastChild.nodeType === 3) {
                if (!previousLastChild.textContent) {
                    previousLastChild = hasPreviousSibling(previousLastChild) as ChildNode;
                }
                if (previousLastChild && previousLastChild.nodeType === 3 && previousLastChild.textContent.endsWith("\n")) {
                    previousLastChild.textContent = previousLastChild.textContent.slice(0, -1);
                }
            }
        }

        const scroll = protyle.contentElement.scrollTop;
        const leftNodes = range.extractContents();
        range.selectNodeContents(previousLastEditElement);
        range.collapse(false);
        range.insertNode(leftNodes);
        const previousHTML = previousLastEditElement.innerHTML.trimStart();
        const previousText = previousLastEditElement.textContent.trimStart();
        // https://github.com/siyuan-note/siyuan/issues/15554
        if (previousHTML.startsWith("```") || previousHTML.startsWith("···") || previousHTML.startsWith("~~~") ||
            (previousHTML.indexOf("\n```") > -1 && previousText.indexOf("\n```") > -1) ||
            (previousHTML.indexOf("\n~~~") > -1 && previousText.indexOf("\n~~~") > -1) ||
            (previousHTML.indexOf("\n···") > -1 && previousText.indexOf("\n···") > -1)) {
            if (previousHTML.indexOf("\n") === -1 && previousHTML.replace(/·|~/g, "`").replace(/^`{3,}/g, "").indexOf("`") > -1) {
                // ```test` 不处理，正常渲染为段落块
            } else {
                let replaceNewHTML = previousLastEditElement.innerHTML.replace(/\n(~|·|`){3,}/g, "\n```").trim().replace(/^(~|·|`){3,}/g, "```");
                if (!replaceNewHTML.endsWith("\n```")) {
                    replaceNewHTML += "\n```";
                }
                previousLastEditElement.innerHTML = replaceNewHTML;
            }
        }
        // 图片前删除到上一个文字块时，图片前有 zwsp
        previousLastElement.outerHTML = protyle.lute.SpinBlockDOM(previousLastElement.outerHTML);
        mathRender(getPreviousBlock(removeElement) as HTMLElement);
        const removeParentElement = removeElement.parentElement;
        // https://github.com/siyuan-note/siyuan/issues/12327
        if (removeParentElement.classList.contains("li") && removeParentElement.childElementCount === 4 &&
            removeParentElement.getAttribute("fold") === "1") {
            const foldOperations = setFold(protyle, removeParentElement, true, false, false, true);
            doOperations.push(...foldOperations.doOperations);
            undoOperations.splice(0, 0, ...foldOperations.undoOperations);
        }
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
    if (parentElement && parentElement.getAttribute("data-type") === "NodeSuperBlock" && parentElement.childElementCount === 2) {
        const sbData = await cancelSB(protyle, parentElement);
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
            if (previousBlockElement.querySelector("wbr")) {
                return focusByWbr(previousBlockElement, range);
            } else {
                const previousEditElement = getContenteditableElement(getLastBlock(previousBlockElement));
                if (previousEditElement) {
                    return setLastNodeRange(previousEditElement, range, false);
                }
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
        if (listElement.parentElement.classList.contains("sb") &&
            listElement.parentElement.getAttribute("data-sb-layout") === "col") {
            const selectsElement: Element[] = [];
            let previousElement: Element = listElement;
            while (previousElement) {
                selectsElement.push(previousElement);
                if (undoOperations[0].id === previousElement.getAttribute("data-node-id")) {
                    break;
                }
                previousElement = previousElement.previousElementSibling;
            }
            turnsIntoOneTransaction({
                protyle,
                selectsElement: selectsElement.reverse(),
                type: "BlocksMergeSuperBlock",
                level: "row",
                unfocus: true,
            });
        }
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
    let foldElement: Element;
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
        const previousElement = previousLastElement.previousElementSibling;
        if (previousElement.getAttribute("fold") === "1" && previousElement.getAttribute("data-type") === "NodeHeading") {
            foldElement = previousElement;
        }
        let previousID = previousElement.getAttribute("data-node-id");
        Array.from(blockElement.parentElement.children).forEach((item, index) => {
            if (item.classList.contains("protyle-action") || item.classList.contains("protyle-attr")) {
                return;
            }
            const id = item.getAttribute("data-node-id");
            doOperations.push({
                action: "move",
                id,
                previousID,
                context: {ignoreProcess: foldElement ? "true" : "false"}
            });
            undoOperations.push({
                action: "move",
                id,
                previousID: index === 1 ? undefined : previousID,
                parentID: listItemId
            });
            previousID = id;
            if (foldElement) {
                item.remove();
            } else {
                previousLastElement.before(item);
            }
        });
        doOperations.push({
            action: "delete",
            id: listItemId
        });
        undoOperations[0].data = listItemElement.outerHTML;
        listItemElement.remove();
    }

    if (foldElement) {
        const foldOperations = setFold(protyle, foldElement, true, false, false, true);
        doOperations.push(...foldOperations.doOperations);
        undoOperations.push(...foldOperations.undoOperations);
        if (foldElement.parentElement.getAttribute("data-subtype") === "o") {
            let nextElement = foldElement.parentElement.nextElementSibling;
            while (nextElement && !nextElement.classList.contains("protyle-attr")) {
                const nextId = nextElement.getAttribute("data-node-id");
                undoOperations.push({
                    action: "update",
                    id: nextId,
                    data: nextElement.outerHTML
                });
                const count = parseInt(nextElement.getAttribute("data-marker")) - 1 + ".";
                nextElement.setAttribute("data-marker", count);
                nextElement.querySelector(".protyle-action--order").textContent = count;
                doOperations.push({
                    action: "update",
                    id: nextId,
                    data: nextElement.outerHTML
                });
                nextElement = nextElement.nextElementSibling;
            }
        }
        transaction(protyle, doOperations, undoOperations);
    } else if (listElement.classList.contains("protyle-wysiwyg")) {
        transaction(protyle, doOperations, undoOperations);
    } else {
        if (listElement.getAttribute("data-subtype") === "o") {
            updateListOrder(listElement);
        }
        updateTransaction(protyle, listElement.getAttribute("data-node-id"), listElement.outerHTML, html);
    }
    focusByWbr(previousLastElement.parentElement, range);
};
