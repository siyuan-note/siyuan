import {focusBlock, focusByRange, getRangeByPoint} from "./selection";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
    hasTopClosestByAttribute,
    isInEmbedBlock
} from "./hasClosest";
import {Constants} from "../../constants";
import {paste} from "./paste";
import {cancelSB, genEmptyElement, genSBElement, insertEmptyBlock} from "../../block/util";
import {transaction, turnsIntoOneTransaction} from "../wysiwyg/transaction";
import {getParentBlock, getTopAloneElement} from "../wysiwyg/getBlock";
import {updateListOrder} from "../wysiwyg/list";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {onGet} from "./onGet";
/// #if !MOBILE
import {getAllEditor} from "../../layout/getAll";
import {updatePanelByEditor} from "../../editor/util";
/// #endif
import {blockRender} from "../render/blockRender";
import {uploadLocalFiles} from "../upload";
import {insertHTML} from "./insertHTML";
import {isBrowser} from "../../util/functions";
import {hideElements} from "../ui/hideElements";
import {insertAttrViewBlockAnimation} from "../render/av/row";
import {dragUpload} from "../render/av/asset";
import * as dayjs from "dayjs";
import {setFold, zoomOut} from "../../menus/protyle";
/// #if !BROWSER
import {webUtils} from "electron";
/// #endif
import {addDragFill, getTypeByCellElement} from "../render/av/cell";
import {processClonePHElement} from "../render/util";
import {insertGalleryItemAnimation} from "../render/av/gallery/item";
import {clearSelect} from "./clear";
import {dragoverTab} from "../render/av/view";

// position: afterbegin 为拖拽成超级块; "afterend", "beforebegin" 一般拖拽
const moveTo = async (protyle: IProtyle, sourceElements: Element[], targetElement: Element,
                      isSameDoc: boolean, position: InsertPosition, isCopy: boolean) => {
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const copyFoldHeadingIds: { newId: string, oldId: string }[] = [];
    const targetId = targetElement.getAttribute("data-node-id");
    const newSourceElements: Element[] = [];
    let tempTargetElement = targetElement;
    let isSameLi = true;
    sourceElements.find(item => {
        if (!item.classList.contains("li") || !targetElement.classList.contains("li") ||
            targetElement.getAttribute("data-subtype") !== item.getAttribute("data-subtype")) {
            isSameLi = false;
            return true;
        }
    });
    let newListElement: Element;
    let newListId: string;
    const orderListElements: { [key: string]: Element } = {};
    for (let index = sourceElements.length - 1; index >= 0; index--) {
        const item = sourceElements[index];
        const id = item.getAttribute("data-node-id");
        const parentID = getParentBlock(item).getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID;
        if (item.getAttribute("data-type") === "NodeListItem" && !newListId && !isSameLi) {
            newListId = Lute.NewNodeID();
            newListElement = document.createElement("div");
            newListElement.innerHTML = `<div data-subtype="${item.getAttribute("data-subtype")}" data-node-id="${newListId}" data-type="NodeList" class="list"><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
            newListElement = newListElement.firstElementChild;
            doOperations.push({
                action: "insert",
                data: newListElement.outerHTML,
                id: newListId,
                previousID: position === "afterbegin" ? null : (position === "afterend" ? targetId : tempTargetElement.previousElementSibling?.getAttribute("data-node-id")),
                parentID: position === "afterbegin" ? targetId : (getParentBlock(tempTargetElement)?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID),
            });
            undoOperations.push({
                action: "delete",
                id: newListId
            });
            tempTargetElement.insertAdjacentElement(position, newListElement);
            newSourceElements.push(newListElement);
        }
        const copyNewId = Lute.NewNodeID();
        if (isCopy && item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
            copyFoldHeadingIds.push({
                newId: copyNewId,
                oldId: id
            });
        }

        let copyElement;
        if (isCopy) {
            undoOperations.push({
                action: "delete",
                id: copyNewId,
            });
        } else {
            undoOperations.push({
                action: "move",
                id,
                previousID: item.previousElementSibling?.getAttribute("data-node-id"),
                parentID,
            });
        }
        if (!isSameDoc && !isCopy) {
            // 打开两个相同的文档
            const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
            if (sameElement) {
                sameElement.remove();
            }
        }
        if (isCopy) {
            copyElement = item.cloneNode(true) as HTMLElement;
            copyElement.setAttribute("data-node-id", copyNewId);
            copyElement.querySelectorAll("[data-node-id]").forEach((e) => {
                const newId = Lute.NewNodeID();
                e.setAttribute("data-node-id", newId);
                e.setAttribute("updated", newId.split("-")[0]);
            });
            if (newListId) {
                newListElement.insertAdjacentElement("afterbegin", copyElement);
                doOperations.push({
                    action: "insert",
                    id: copyNewId,
                    data: copyElement.outerHTML,
                    parentID: newListId,
                });
            } else {
                tempTargetElement.insertAdjacentElement(position, copyElement);
                doOperations.push({
                    action: "insert",
                    id: copyNewId,
                    data: copyElement.outerHTML,
                    previousID: position === "afterbegin" ? null : (position === "afterend" ? targetId : copyElement.previousElementSibling?.getAttribute("data-node-id")), // 不能使用常量，移动后会被修改
                    parentID: position === "afterbegin" ? targetId : (getParentBlock(copyElement)?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID),
                });
                newSourceElements.push(copyElement);
            }
        } else {
            const topSourceElement = getTopAloneElement(item);
            const oldSourceParentElement = item.parentElement;
            if (item.classList.contains("li") && item.getAttribute("data-subtype") === "o") {
                orderListElements[item.parentElement.getAttribute("data-node-id")] = item.parentElement;
            }
            if (newListId) {
                newListElement.insertAdjacentElement("afterbegin", item);
                doOperations.push({
                    action: "move",
                    id,
                    parentID: newListId,
                });
            } else {
                tempTargetElement.insertAdjacentElement(position, item);
                doOperations.push({
                    action: "move",
                    id,
                    previousID: position === "afterbegin" ? null : (position === "afterend" ? targetId : item.previousElementSibling?.getAttribute("data-node-id")), // 不能使用常量，移动后会被修改
                    parentID: position === "afterbegin" ? targetId : (getParentBlock(item)?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID),
                });
                newSourceElements.push(item);
            }

            if (topSourceElement !== item) {
                // 删除空元素
                doOperations.push({
                    action: "delete",
                    id: topSourceElement.getAttribute("data-node-id"),
                });
                undoOperations.push({
                    action: "insert",
                    data: topSourceElement.outerHTML,
                    id: topSourceElement.getAttribute("data-node-id"),
                    previousID: topSourceElement.previousElementSibling?.getAttribute("data-node-id"),
                    parentID: getParentBlock(topSourceElement)?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
                });
                const topSourceParentElement = topSourceElement.parentElement;
                topSourceElement.remove();
                if (!isSameDoc) {
                    // 打开两个相同的文档
                    const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${topSourceElement.getAttribute("data-node-id")}"]`);
                    if (sameElement) {
                        sameElement.remove();
                    }
                }
                if (topSourceParentElement.classList.contains("sb") && topSourceParentElement.childElementCount === 2) {
                    // 拖拽后，sb 只剩下一个元素
                    if (isSameDoc) {
                        const sbData = await cancelSB(protyle, topSourceParentElement);
                        doOperations.push(sbData.doOperations[0], sbData.doOperations[1]);
                        undoOperations.push(sbData.undoOperations[1], sbData.undoOperations[0]);
                    } else {
                        /// #if !MOBILE
                        const allEditor = getAllEditor();
                        for (let i = 0; i < allEditor.length; i++) {
                            if (allEditor[i].protyle.element.contains(topSourceParentElement)) {
                                const otherSbData = await cancelSB(allEditor[i].protyle, topSourceParentElement);
                                doOperations.push(otherSbData.doOperations[0], otherSbData.doOperations[1]);
                                undoOperations.push(otherSbData.undoOperations[1], otherSbData.undoOperations[0]);
                                // 需清空操作栈，否则撤销到移动出去的块的操作会抛异常
                                allEditor[i].protyle.undo.clear();
                                break;
                            }
                        }
                        /// #endif
                    }
                }
            } else if (oldSourceParentElement.classList.contains("sb") && oldSourceParentElement.childElementCount === 2) {
                // 拖拽后，sb 只剩下一个元素
                if (isSameDoc) {
                    const sbData = await cancelSB(protyle, oldSourceParentElement);
                    doOperations.push(sbData.doOperations[0], sbData.doOperations[1]);
                    undoOperations.push(sbData.undoOperations[1], sbData.undoOperations[0]);
                } else {
                    /// #if !MOBILE
                    const allEditor = getAllEditor();
                    for (let i = 0; i < allEditor.length; i++) {
                        if (allEditor[i].protyle.element.contains(oldSourceParentElement)) {
                            const otherSbData = await cancelSB(allEditor[i].protyle, oldSourceParentElement);
                            doOperations.push(otherSbData.doOperations[0], otherSbData.doOperations[1]);
                            undoOperations.push(otherSbData.undoOperations[1], otherSbData.undoOperations[0]);
                            // 需清空操作栈，否则撤销到移动出去的块的操作会抛异常
                            allEditor[i].protyle.undo.clear();
                            break;
                        }
                    }
                    /// #endif
                }
            } else if (oldSourceParentElement.classList.contains("protyle-wysiwyg") && oldSourceParentElement.childElementCount === 0) {
                /// #if !MOBILE
                // 拖拽后，根文档原内容为空
                getAllEditor().find(item => {
                    if (item.protyle.element.contains(oldSourceParentElement)) {
                        if (!item.protyle.block.showAll) {
                            const newId = Lute.NewNodeID();
                            doOperations.splice(0, 0, {
                                action: "insert",
                                id: newId,
                                data: genEmptyElement(false, false, newId).outerHTML,
                                parentID: item.protyle.block.parentID
                            });
                            undoOperations.splice(0, 0, {
                                action: "delete",
                                id: newId,
                            });
                        } else {
                            zoomOut({protyle: item.protyle, id: item.protyle.block.rootID});
                        }
                        return true;
                    }
                });
                /// #endif
            }
        }

        if (newListId && (index === 0 ||
            sourceElements[index - 1].getAttribute("data-type") !== "NodeListItem" ||
            sourceElements[index - 1].getAttribute("data-subtype") !== item.getAttribute("data-subtype"))
        ) {
            if (position === "beforebegin") {
                tempTargetElement = newListElement;
            }
            newListId = null;
            if (newListElement.getAttribute("data-subtype") === "o" && newListElement.firstElementChild.getAttribute("data-marker") !== "1.") {
                Array.from(newListElement.children).forEach((listItem) => {
                    if (listItem.classList.contains("protyle-attr")) {
                        return;
                    }
                    undoOperations.push({
                        action: "update",
                        id: listItem.getAttribute("data-node-id"),
                        data: listItem.outerHTML
                    });
                });
                updateListOrder(newListElement, 1);
                Array.from(newListElement.children).forEach((listItem) => {
                    if (listItem.classList.contains("protyle-attr")) {
                        return;
                    }
                    doOperations.push({
                        action: "update",
                        id: listItem.getAttribute("data-node-id"),
                        data: listItem.outerHTML
                    });
                });
                updateListOrder(newListElement, 1);
            }
        } else if (position === "beforebegin") {
            tempTargetElement = isCopy ? copyElement : item;
        }
    }
    Object.keys(orderListElements).forEach(key => {
        Array.from(orderListElements[key].children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            undoOperations.push({
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
        updateListOrder(orderListElements[key], 1);
        Array.from(orderListElements[key].children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            doOperations.push({
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
    });
    undoOperations.reverse();
    for (let j = 0; j < copyFoldHeadingIds.length; j++) {
        const childrenItem = copyFoldHeadingIds[j];
        const responseTransaction = await fetchSyncPost("/api/block/getHeadingInsertTransaction", {id: childrenItem.oldId});
        responseTransaction.data.doOperations.splice(0, 1);
        responseTransaction.data.doOperations[0].previousID = childrenItem.newId;
        responseTransaction.data.undoOperations.splice(0, 1);
        doOperations.push(...responseTransaction.data.doOperations);
        undoOperations.push(...responseTransaction.data.undoOperations);
    }
    return {
        doOperations,
        undoOperations,
        newSourceElements
    };
};

const dragSb = async (protyle: IProtyle, sourceElements: Element[], targetElement: Element, isBottom: boolean,
                      direct: "col" | "row", isCopy: boolean) => {
    const isSameDoc = protyle.element.contains(sourceElements[0]);
    // 把列表块中的唯一一个列表项块拖拽到列表块的左侧 https://github.com/siyuan-note/siyuan/issues/16315
    if (isSameDoc && sourceElements[0].classList.contains("li") && targetElement === sourceElements[0].parentElement &&
        targetElement.childElementCount === sourceElements.length + 1) {
        const outLiElement = sourceElements.find((element) => {
            if (!targetElement.contains(element)) {
                return true;
            }
        });
        if (!outLiElement) {
            return;
        }
    }
    const undoOperations: IOperation[] = [];
    const targetMoveUndo: IOperation = {
        action: "move",
        id: targetElement.getAttribute("data-node-id"),
        previousID: targetElement.previousElementSibling?.getAttribute("data-node-id"),
        parentID: getParentBlock(targetElement)?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
    };
    const sbElement = genSBElement(direct);
    targetElement.parentElement.replaceChild(sbElement, targetElement);
    const doOperations: IOperation[] = [{
        action: "insert",
        data: sbElement.outerHTML,
        id: sbElement.getAttribute("data-node-id"),
        nextID: sbElement.nextElementSibling?.getAttribute("data-node-id"),
        previousID: sbElement.previousElementSibling?.getAttribute("data-node-id"),
        parentID: getParentBlock(sbElement)?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
    }];
    // 临时插入，防止后面计算错误，最终再移动矫正
    sbElement.lastElementChild.before(targetElement);
    const moveToResult = await moveTo(protyle, sourceElements, sbElement, isSameDoc, "afterbegin", isCopy);
    doOperations.push(...moveToResult.doOperations);
    undoOperations.push(...moveToResult.undoOperations);
    const newSourceParentElement = moveToResult.newSourceElements;
    // 横向超级块A内两个元素拖拽成纵向超级块B，取消超级块A会导致 targetElement 被删除，需先移动再删除 https://github.com/siyuan-note/siyuan/issues/16292
    let removeIndex = doOperations.length;
    doOperations.find((item, index) => {
        // 横向超级块A内两个元素拖拽成纵向超级块B，取消超级块A会导致 targetElement 被删除，需先移动再删除 https://github.com/siyuan-note/siyuan/issues/16292
        if (item.action === "delete" && item.id === targetMoveUndo.parentID) {
            removeIndex = index;
        }
        // 超级块内有两个块，拖拽其中一个到超级块外 https://github.com/siyuan-note/siyuan/issues/16292#issuecomment-3523600155
        if (item.action === "delete" && item.id === targetElement.getAttribute("data-node-id")) {
            targetElement = sbElement.querySelector(`[data-node-id="${doOperations[index - 1].id}"]`);
        }
    });

    if (isBottom) {
        // 拖拽到超级块 col 下方， 其他块右侧
        sbElement.insertAdjacentElement("afterbegin", targetElement);
        doOperations.splice(removeIndex, 0, {
            action: "move",
            id: targetElement.getAttribute("data-node-id"),
            parentID: sbElement.getAttribute("data-node-id")
        });
    } else {
        sbElement.lastElementChild.insertAdjacentElement("beforebegin", targetElement);
        doOperations.splice(removeIndex, 0, {
            action: "move",
            id: targetElement.getAttribute("data-node-id"),
            previousID: newSourceParentElement[0].getAttribute("data-node-id"),
        });
    }
    undoOperations.push(targetMoveUndo);
    undoOperations.push({
        action: "delete",
        id: sbElement.getAttribute("data-node-id"),
    });
    let hasFoldHeading = false;
    newSourceParentElement.forEach(item => {
        if (item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
            hasFoldHeading = true;
            if (item.nextElementSibling && (
                item.nextElementSibling.getAttribute("data-type") !== "NodeHeading" ||
                item.nextElementSibling.getAttribute("data-subtype") > item.getAttribute("data-subtype")
            )) {
                const foldOperations = setFold(protyle, item, true, false, false, true);
                doOperations.push(...foldOperations.doOperations);
                // 不折叠，否则无法撤销 undoOperations.push(...foldOperations.undoOperations);
            }
            return true;
        }
    });
    if (isSameDoc || isCopy) {
        transaction(protyle, doOperations, undoOperations);
    } else {
        // 跨文档或插入折叠标题下不支持撤销
        transaction(protyle, doOperations);
    }
    if ((newSourceParentElement.length > 1 || hasFoldHeading) && direct === "col") {
        turnsIntoOneTransaction({
            protyle,
            selectsElement: newSourceParentElement.reverse(),
            type: "BlocksMergeSuperBlock",
            level: "row",
            unfocus: true,
        });
    }
    if (document.contains(sourceElements[0])) {
        focusBlock(sourceElements[0]);
    } else {
        focusBlock(targetElement);
    }
};

const dragSame = async (protyle: IProtyle, sourceElements: Element[], targetElement: Element, isBottom: boolean, isCopy: boolean) => {
    const isSameDoc = protyle.element.contains(sourceElements[0]);
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];

    const moveToResult = await moveTo(protyle, sourceElements, targetElement, isSameDoc, isBottom ? "afterend" : "beforebegin", isCopy);
    doOperations.push(...moveToResult.doOperations);
    undoOperations.push(...moveToResult.undoOperations);
    const newSourceParentElement = moveToResult.newSourceElements;
    let foldData;
    if (isBottom &&
        targetElement.getAttribute("data-type") === "NodeHeading" &&
        targetElement.getAttribute("fold") === "1") {
        foldData = setFold(protyle, targetElement, true, false, false, true);
    } else if (!isBottom && targetElement.previousElementSibling &&
        targetElement.previousElementSibling.getAttribute("data-type") === "NodeHeading" &&
        targetElement.previousElementSibling.getAttribute("fold") === "1") {
        foldData = setFold(protyle, targetElement.previousElementSibling, true, false, false, true);
    }
    if (foldData) {
        foldData.doOperations[0].context = {
            focusId: sourceElements[0].getAttribute("data-node-id"),
        };
        doOperations.push(...foldData.doOperations);
        undoOperations.push(...foldData.undoOperations);
    }
    if (targetElement.getAttribute("data-type") === "NodeListItem" &&
        targetElement.getAttribute("data-subtype") === "o") {
        // https://github.com/siyuan-note/insider/issues/536
        Array.from(targetElement.parentElement.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            undoOperations.splice(0, 0, {
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
        updateListOrder(targetElement.parentElement, 1);
        Array.from(targetElement.parentElement.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            doOperations.push({
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
    }
    let hasFoldHeading = false;
    newSourceParentElement.forEach(item => {
        if (item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
            hasFoldHeading = true;
            if (item.nextElementSibling && (
                item.nextElementSibling.getAttribute("data-type") !== "NodeHeading" ||
                item.nextElementSibling.getAttribute("data-subtype") > item.getAttribute("data-subtype")
            )) {
                const foldOperations = setFold(protyle, item, true, false, false, true);
                doOperations.push(...foldOperations.doOperations);
                // 不折叠，否则无法撤销 undoOperations.push(...foldOperations.undoOperations);
            }
            return true;
        }
    });
    if (isSameDoc || isCopy) {
        transaction(protyle, doOperations, undoOperations);
    } else {
        // 跨文档或插入折叠标题下不支持撤销
        transaction(protyle, doOperations);
    }
    if ((newSourceParentElement.length > 1 || hasFoldHeading) &&
        newSourceParentElement[0].parentElement.classList.contains("sb") &&
        newSourceParentElement[0].parentElement.getAttribute("data-sb-layout") === "col") {
        turnsIntoOneTransaction({
            protyle,
            selectsElement: newSourceParentElement.reverse(),
            type: "BlocksMergeSuperBlock",
            level: "row",
            unfocus: true,
        });
    }
    if (document.contains(sourceElements[0])) {
        focusBlock(sourceElements[0]);
    } else {
        focusBlock(targetElement);
    }
};

export const dropEvent = (protyle: IProtyle, editorElement: HTMLElement) => {
    editorElement.addEventListener("dragstart", (event) => {
        if (protyle.disabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        let target = event.target as HTMLElement;
        if (target.classList?.contains("av__gallery-img")) {
            target = hasClosestByClassName(target, "av__gallery-item") as HTMLElement;
        }
        if (!target) {
            return;
        }
        if (target.tagName === "IMG") {
            window.siyuan.dragElement = undefined;
            event.preventDefault();
            return;
        }

        if (target.classList) {
            if (hasClosestByClassName(target, "protyle-wysiwyg__embed")) {
                window.siyuan.dragElement = undefined;
                event.preventDefault();
            } else if (target.parentElement.parentElement.classList.contains("av__views")) {
                window.siyuan.dragElement = target;
                target.style.width = target.clientWidth + "px";
                target.style.opacity = ".36";
                event.dataTransfer.setData(`${Constants.SIYUAN_DROP_GUTTER}NodeAttributeView${Constants.ZWSP}ViewTab${Constants.ZWSP}${[target.previousElementSibling?.getAttribute("data-id")]}`,
                    target.outerHTML);
                return;
            } else if (target.classList.contains("protyle-action")) {
                target.parentElement.classList.add("protyle-wysiwyg--select");
                const ghostElement = document.createElement("div");
                ghostElement.className = protyle.wysiwyg.element.className;
                ghostElement.append(processClonePHElement(target.parentElement.cloneNode(true) as Element));
                ghostElement.setAttribute("style", `position:fixed;opacity:.1;width:${target.parentElement.clientWidth}px;padding:0;`);
                document.body.append(ghostElement);
                event.dataTransfer.setDragImage(ghostElement, 0, 0);
                setTimeout(() => {
                    ghostElement.remove();
                });

                window.siyuan.dragElement = protyle.wysiwyg.element;
                event.dataTransfer.setData(`${Constants.SIYUAN_DROP_GUTTER}NodeListItem${Constants.ZWSP}${target.parentElement.getAttribute("data-subtype")}${Constants.ZWSP}${[target.parentElement.getAttribute("data-node-id")]}`,
                    protyle.wysiwyg.element.innerHTML);
                return;
            } else if (target.classList.contains("av__cell--header")) {
                window.siyuan.dragElement = target;
                event.dataTransfer.setData(`${Constants.SIYUAN_DROP_GUTTER}NodeAttributeView${Constants.ZWSP}Col${Constants.ZWSP}${[target.getAttribute("data-col-id")]}`,
                    target.outerHTML);
                return;
            } else if (target.classList.contains("av__gallery-item")) {
                const blockElement = hasClosestBlock(target);
                if (blockElement) {
                    if (blockElement.querySelector('.block__icon[data-type="av-sort"]')?.classList.contains("block__icon--active")) {
                        const bodyElements = blockElement.querySelectorAll(".av__body");
                        if (bodyElements.length === 1) {
                            event.preventDefault();
                            event.stopPropagation();
                            return;
                        } else if (["template", "created", "updated"].includes(bodyElements[0].getAttribute("data-dtype"))) {
                            event.preventDefault();
                            event.stopPropagation();
                            return;
                        }
                    }
                    if (!target.classList.contains("av__gallery-item--select")) {
                        blockElement.querySelectorAll(".av__gallery-item--select").forEach(item => {
                            item.classList.remove("av__gallery-item--select");
                        });
                        target.classList.add("av__gallery-item--select");
                    }
                    const ghostElement = document.createElement("div");
                    ghostElement.className = "protyle-wysiwyg protyle-wysiwyg--attr";
                    const isKanban = blockElement.getAttribute("data-av-type") === "kanban";
                    if (isKanban) {
                        ghostElement.innerHTML = `<div class="${blockElement.querySelector(".av__kanban").className}"></div>`;
                    }
                    let galleryElement: HTMLElement;
                    let cloneGalleryElement = document.createElement("div");
                    const selectElements = blockElement.querySelectorAll(".av__gallery-item--select");
                    selectElements.forEach(item => {
                        if (!galleryElement || !galleryElement.contains(item)) {
                            galleryElement = item.parentElement;
                            cloneGalleryElement = document.createElement("div");
                            if (isKanban) {
                                cloneGalleryElement.className = "av__kanban-group";
                                cloneGalleryElement.setAttribute("style", item.parentElement.parentElement.parentElement.getAttribute("style"));
                                cloneGalleryElement.innerHTML = '<div class="av__gallery"></div>';
                                ghostElement.firstElementChild.appendChild(cloneGalleryElement);
                            } else {
                                cloneGalleryElement.classList.add("av__gallery");
                                cloneGalleryElement.setAttribute("style", `width: 100vw;margin-bottom: 16px;grid-template-columns: repeat(auto-fill, ${selectElements[0].clientWidth}px);`);
                                ghostElement.appendChild(cloneGalleryElement);
                            }
                        }
                        const cloneItem = processClonePHElement(item.cloneNode(true) as Element);
                        cloneItem.setAttribute("style", `height:${item.clientHeight}px;`);
                        cloneItem.classList.remove("av__gallery-item--select");
                        if (isKanban) {
                            cloneGalleryElement.firstElementChild.appendChild(cloneItem);
                        } else {
                            cloneGalleryElement.appendChild(cloneItem);
                        }
                    });
                    ghostElement.setAttribute("style", "left: 1px;top:100vh;position:fixed;opacity:.1;padding:0;z-index: 8");
                    document.body.append(ghostElement);
                    event.dataTransfer.setDragImage(ghostElement, -10, -10);
                    setTimeout(() => {
                        ghostElement.remove();
                    });
                    window.siyuan.dragElement = target;
                    const selectIds: string[] = [];
                    blockElement.querySelectorAll(".av__gallery-item--select").forEach(item => {
                        const bodyElement = hasClosestByClassName(item, "av__body") as HTMLElement;
                        const groupId = bodyElement.getAttribute("data-group-id");
                        selectIds.push(item.getAttribute("data-id") + (groupId ? `@${groupId}` : ""));
                    });
                    event.dataTransfer.setData(`${Constants.SIYUAN_DROP_GUTTER}NodeAttributeView${Constants.ZWSP}GalleryItem${Constants.ZWSP}${selectIds}`,
                        ghostElement.outerHTML);
                }
                return;
            }
        }
        // 选中编辑器中的文字进行拖拽
        event.dataTransfer.setData(Constants.SIYUAN_DROP_EDITOR, Constants.SIYUAN_DROP_EDITOR);
        protyle.element.style.userSelect = "auto";
        document.onmousemove = null;
        document.onmouseup = null;
    });
    editorElement.addEventListener("drop", async (event: DragEvent & { target: HTMLElement }) => {
        counter = 0;
        if (protyle.disabled || event.dataTransfer.getData(Constants.SIYUAN_DROP_EDITOR)) {
            // 只读模式/编辑器内选中文字拖拽
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        let gutterType = "";
        for (const item of event.dataTransfer.items) {
            if (item.type.startsWith(Constants.SIYUAN_DROP_GUTTER)) {
                gutterType = item.type;
            }
        }
        if (gutterType.startsWith(`${Constants.SIYUAN_DROP_GUTTER}NodeAttributeView${Constants.ZWSP}ViewTab${Constants.ZWSP}`.toLowerCase())) {
            const blockElement = hasClosestBlock(window.siyuan.dragElement);
            if (blockElement) {
                const avID = blockElement.getAttribute("data-av-id");
                const blockID = blockElement.getAttribute("data-node-id");
                const id = window.siyuan.dragElement.getAttribute("data-id");
                transaction(protyle, [{
                    action: "sortAttrViewView",
                    avID,
                    blockID,
                    id,
                    previousID: window.siyuan.dragElement.previousElementSibling?.getAttribute("data-id"),
                    data: "unRefresh"   // 不需要重新渲染
                }], [{
                    action: "sortAttrViewView",
                    avID,
                    blockID,
                    id,
                    previousID: gutterType.split(Constants.ZWSP).pop()
                }]);
            }
            return;
        }
        const targetElement = editorElement.querySelector(".dragover__left, .dragover__right, .dragover__bottom, .dragover__top");
        if (targetElement) {
            targetElement.classList.remove("dragover");
            targetElement.removeAttribute("select-start");
            targetElement.removeAttribute("select-end");
        }
        if (gutterType) {
            // gutter 或反链面板拖拽
            const sourceElements: Element[] = [];
            const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
            const selectedIds = gutterTypes[2].split(",");
            if (event.altKey || event.shiftKey) {
                if (event.y > protyle.wysiwyg.element.lastElementChild.getBoundingClientRect().bottom) {
                    insertEmptyBlock(protyle, "afterend", protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id"));
                } else {
                    const range = getRangeByPoint(event.clientX, event.clientY);
                    if (hasClosestByAttribute(range.startContainer, "data-type", "NodeBlockQueryEmbed")) {
                        return;
                    } else {
                        focusByRange(range);
                    }
                }
            }
            if (event.altKey) {
                let html = "";
                for (let i = 0; i < selectedIds.length; i++) {
                    const response = await fetchSyncPost("/api/block/getRefText", {id: selectedIds[i]});
                    html += protyle.lute.Md2BlockDOM(`((${selectedIds[i]} '${response.data}'))`);
                }
                insertHTML(html, protyle);
            } else if (event.shiftKey) {
                let html = "";
                selectedIds.forEach(item => {
                    html += `{{select * from blocks where id='${item}'}}\n`;
                });
                insertHTML(protyle.lute.SpinBlockDOM(html), protyle, true);
                blockRender(protyle, protyle.wysiwyg.element);
            } else if (targetElement && targetElement.className.indexOf("dragover__") > -1) {
                let queryClass = "";
                selectedIds.forEach(item => {
                    queryClass += `[data-node-id="${item}"],`;
                });
                if (window.siyuan.dragElement) {
                    window.siyuan.dragElement.querySelectorAll(queryClass.substring(0, queryClass.length - 1)).forEach(elementItem => {
                        if (!isInEmbedBlock(elementItem)) {
                            sourceElements.push(elementItem);
                        }
                    });
                } else if (window.siyuan.config.system.workspaceDir.toLowerCase() === gutterTypes[3]) {
                    // 跨窗口拖拽
                    // 不能跨工作区域拖拽 https://github.com/siyuan-note/siyuan/issues/13582
                    const targetProtyleElement = document.createElement("template");
                    targetProtyleElement.innerHTML = `<div>${event.dataTransfer.getData(gutterType)}</div>`;
                    targetProtyleElement.content.querySelectorAll(queryClass.substring(0, queryClass.length - 1)).forEach(elementItem => {
                        if (!isInEmbedBlock(elementItem)) {
                            sourceElements.push(elementItem);
                        }
                    });
                }

                const sourceIds: string [] = [];
                const srcs: IOperationSrcs[] = [];
                sourceElements.forEach(item => {
                    item.classList.remove("protyle-wysiwyg--hl");
                    item.removeAttribute("select-start");
                    item.removeAttribute("select-end");
                    // 反链提及有高亮，如果拖拽到正文的话，应移除
                    item.querySelectorAll('[data-type="search-mark"]').forEach(markItem => {
                        markItem.outerHTML = markItem.innerHTML;
                    });
                    const id = item.getAttribute("data-node-id");
                    sourceIds.push(id);
                    srcs.push({
                        itemID: Lute.NewNodeID(),
                        id,
                        isDetached: false,
                    });
                });

                hideElements(["gutter"], protyle);

                const targetClass = targetElement.className.split(" ");
                targetElement.classList.remove("dragover__bottom", "dragover__top", "dragover__left", "dragover__right");

                if (targetElement.classList.contains("av__cell")) {
                    const blockElement = hasClosestBlock(targetElement);
                    if (blockElement) {
                        const avID = blockElement.getAttribute("data-av-id");
                        let previousID = "";
                        if (targetClass.includes("dragover__left")) {
                            if (targetElement.previousElementSibling) {
                                if (targetElement.previousElementSibling.classList.contains("av__colsticky")) {
                                    previousID = targetElement.previousElementSibling.lastElementChild.getAttribute("data-col-id");
                                } else {
                                    previousID = targetElement.previousElementSibling.getAttribute("data-col-id");
                                }
                            }
                        } else {
                            previousID = targetElement.getAttribute("data-col-id");
                        }
                        let oldPreviousID = "";
                        const rowElement = hasClosestByClassName(targetElement, "av__row");
                        if (rowElement) {
                            const oldPreviousElement = rowElement.querySelector(`[data-col-id="${gutterTypes[2]}"`)?.previousElementSibling;
                            if (oldPreviousElement) {
                                if (oldPreviousElement.classList.contains("av__colsticky")) {
                                    oldPreviousID = oldPreviousElement.lastElementChild.getAttribute("data-col-id");
                                } else {
                                    oldPreviousID = oldPreviousElement.getAttribute("data-col-id");
                                }
                            }
                        }
                        if (previousID !== oldPreviousID && previousID !== gutterTypes[2]) {
                            transaction(protyle, [{
                                action: "sortAttrViewCol",
                                avID,
                                previousID,
                                id: gutterTypes[2],
                                blockID: blockElement.dataset.nodeId,
                            }], [{
                                action: "sortAttrViewCol",
                                avID,
                                previousID: oldPreviousID,
                                id: gutterTypes[2],
                                blockID: blockElement.dataset.nodeId,
                            }]);
                        }
                    }
                } else if (targetElement.classList.contains("av__row")) {
                    // 拖拽到属性视图 table 内
                    const blockElement = hasClosestBlock(targetElement);
                    if (blockElement) {
                        let previousID = "";
                        if (targetClass.includes("dragover__bottom")) {
                            previousID = targetElement.getAttribute("data-id") || "";
                        } else {
                            previousID = targetElement.previousElementSibling?.getAttribute("data-id") || "";
                        }
                        const avID = blockElement.getAttribute("data-av-id");
                        if (gutterTypes[0] === "nodeattributeviewrowmenu") {
                            // 行内拖拽
                            const doOperations: IOperation[] = [];
                            const undoOperations: IOperation[] = [];
                            const targetGroupID = targetElement.parentElement.getAttribute("data-group-id");
                            selectedIds.reverse().forEach(item => {
                                const items = item.split("@");
                                const id = items[0];
                                const groupID = items[1] || "";
                                const undoPreviousId = blockElement.querySelector(`.av__body${groupID ? `[data-group-id="${groupID}"]` : ""} .av__row[data-id="${id}"]`).previousElementSibling?.getAttribute("data-id") || "";
                                if (previousID !== id && undoPreviousId !== previousID || (
                                    (undoPreviousId === "" && previousID === "" && targetGroupID !== groupID)
                                )) {
                                    doOperations.push({
                                        action: "sortAttrViewRow",
                                        avID,
                                        previousID,
                                        id,
                                        blockID: blockElement.dataset.nodeId,
                                        groupID,
                                        targetGroupID,
                                    });
                                    undoOperations.push({
                                        action: "sortAttrViewRow",
                                        avID,
                                        previousID: undoPreviousId,
                                        id,
                                        blockID: blockElement.dataset.nodeId,
                                        groupID: targetGroupID,
                                        targetGroupID: groupID,
                                    });
                                }
                            });
                            transaction(protyle, doOperations, undoOperations);
                        } else {
                            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
                            const bodyElement = hasClosestByClassName(targetElement, "av__body");
                            const groupID = bodyElement && bodyElement.getAttribute("data-group-id");
                            transaction(protyle, [{
                                action: "insertAttrViewBlock",
                                avID,
                                previousID,
                                srcs,
                                blockID: blockElement.dataset.nodeId,
                                groupID
                            }, {
                                action: "doUpdateUpdated",
                                id: blockElement.dataset.nodeId,
                                data: newUpdated,
                            }], [{
                                action: "removeAttrViewBlock",
                                srcIDs: sourceIds,
                                avID,
                            }, {
                                action: "doUpdateUpdated",
                                id: blockElement.dataset.nodeId,
                                data: blockElement.getAttribute("updated")
                            }]);
                            blockElement.setAttribute("updated", newUpdated);
                            insertAttrViewBlockAnimation({
                                protyle,
                                blockElement,
                                srcIDs: sourceIds,
                                previousId: previousID,
                                groupID
                            });
                        }
                    }
                } else if (targetElement.classList.contains("av__gallery-item") || targetElement.classList.contains("av__gallery-add")) {
                    // 拖拽到属性视图 gallery 内
                    const blockElement = hasClosestBlock(targetElement);
                    if (blockElement) {
                        let previousID = "";
                        if (targetClass.includes("dragover__right") || targetClass.includes("dragover__bottom")) {
                            previousID = targetElement.getAttribute("data-id") || "";
                        } else if (targetClass.includes("dragover__top") || targetClass.includes("dragover__left")) {
                            previousID = targetElement.previousElementSibling?.getAttribute("data-id") || "";
                        }
                        const avID = blockElement.getAttribute("data-av-id");
                        if (gutterTypes[1] === "galleryitem" && gutterTypes[0] === "nodeattributeview") {
                            // gallery item 内部拖拽
                            const doOperations: IOperation[] = [];
                            const undoOperations: IOperation[] = [];
                            const targetGroupID = targetElement.parentElement.parentElement.getAttribute("data-group-id");
                            selectedIds.reverse().forEach(item => {
                                const items = item.split("@");
                                const id = items[0];
                                const groupID = items[1] || "";
                                const undoPreviousId = blockElement.querySelector(`.av__body[data-group-id="${groupID}"] .av__gallery-item[data-id="${id}"]`).previousElementSibling?.getAttribute("data-id") || "";
                                if (previousID !== item && undoPreviousId !== previousID || (
                                    (undoPreviousId === "" && previousID === "" && targetGroupID !== groupID)
                                )) {
                                    doOperations.push({
                                        action: "sortAttrViewRow",
                                        avID,
                                        previousID,
                                        id,
                                        blockID: blockElement.dataset.nodeId,
                                        groupID,
                                        targetGroupID,
                                    });
                                    undoOperations.push({
                                        action: "sortAttrViewRow",
                                        avID,
                                        previousID: undoPreviousId,
                                        id,
                                        blockID: blockElement.dataset.nodeId,
                                        groupID: targetGroupID,
                                        targetGroupID: groupID,
                                    });
                                }
                            });
                            transaction(protyle, doOperations, undoOperations);
                        } else {
                            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
                            const bodyElement = hasClosestByClassName(targetElement, "av__body");
                            transaction(protyle, [{
                                action: "insertAttrViewBlock",
                                avID,
                                previousID,
                                srcs,
                                blockID: blockElement.dataset.nodeId,
                                groupID: bodyElement && bodyElement.getAttribute("data-group-id")
                            }, {
                                action: "doUpdateUpdated",
                                id: blockElement.dataset.nodeId,
                                data: newUpdated,
                            }], [{
                                action: "removeAttrViewBlock",
                                srcIDs: sourceIds,
                                avID,
                            }, {
                                action: "doUpdateUpdated",
                                id: blockElement.dataset.nodeId,
                                data: blockElement.getAttribute("updated")
                            }]);
                            blockElement.setAttribute("updated", newUpdated);
                            insertGalleryItemAnimation({
                                protyle,
                                blockElement,
                                srcIDs: sourceIds,
                                previousId: previousID,
                                groupID: targetElement.parentElement.getAttribute("data-group-id")
                            });
                        }
                    }
                } else if (sourceElements.length > 0) {
                    if (targetElement.parentElement.getAttribute("data-type") === "NodeSuperBlock" &&
                        targetElement.parentElement.getAttribute("data-sb-layout") === "col") {
                        if (targetClass.includes("dragover__left") || targetClass.includes("dragover__right")) {
                            // Mac 上 ⌘ 无法进行拖拽
                            dragSame(protyle, sourceElements, targetElement, targetClass.includes("dragover__right"), event.ctrlKey);
                        } else {
                            dragSb(protyle, sourceElements, targetElement, targetClass.includes("dragover__bottom"), "row", event.ctrlKey);
                        }
                    } else {
                        if (targetClass.includes("dragover__left") || targetClass.includes("dragover__right")) {
                            dragSb(protyle, sourceElements, targetElement, targetClass.includes("dragover__right"), "col", event.ctrlKey);
                        } else {
                            dragSame(protyle, sourceElements, targetElement, targetClass.includes("dragover__bottom"), event.ctrlKey);
                        }
                    }

                    // https://github.com/siyuan-note/siyuan/issues/10528#issuecomment-2205165824
                    editorElement.querySelectorAll(".protyle-wysiwyg--empty").forEach(item => {
                        item.classList.remove("protyle-wysiwyg--empty");
                    });

                    // 需重新渲染 https://github.com/siyuan-note/siyuan/issues/7574
                    protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach(item => {
                        item.removeAttribute("data-render");
                        blockRender(protyle, item);
                    });
                }
                dragoverElement = undefined;
            }
        } else if (event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE)?.split("-").length > 1) {
            // 文件树拖拽
            const ids = event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE).split(",");
            if (!event.altKey && (!targetElement || (
                !targetElement.classList.contains("av__row") && !targetElement.classList.contains("av__gallery-item") &&
                !targetElement.classList.contains("av__gallery-add")
            ))) {
                if (event.y > protyle.wysiwyg.element.lastElementChild.getBoundingClientRect().bottom) {
                    insertEmptyBlock(protyle, "afterend", protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id"));
                } else {
                    const range = getRangeByPoint(event.clientX, event.clientY);
                    if (hasClosestByAttribute(range.startContainer, "data-type", "NodeBlockQueryEmbed")) {
                        return;
                    } else {
                        focusByRange(range);
                    }
                }
                let html = "";
                for (let i = 0; i < ids.length; i++) {
                    if (ids.length > 1) {
                        html += "- ";
                    }
                    const response = await fetchSyncPost("/api/block/getRefText", {id: ids[i]});
                    html += `((${ids[i]} '${response.data}'))`;
                    if (ids.length > 1 && i !== ids.length - 1) {
                        html += "\n";
                    }
                }
                insertHTML(protyle.lute.Md2BlockDOM(html), protyle);
            } else if (targetElement && !protyle.options.backlinkData && targetElement.className.indexOf("dragover__") > -1) {
                const scrollTop = protyle.contentElement.scrollTop;
                if (targetElement.classList.contains("av__row") ||
                    targetElement.classList.contains("av__gallery-item") ||
                    targetElement.classList.contains("av__gallery-add")) {
                    // 拖拽到属性视图内
                    const blockElement = hasClosestBlock(targetElement);
                    if (blockElement) {
                        let previousID = "";
                        if (targetElement.classList.contains("dragover__bottom") || targetElement.classList.contains("dragover__right")) {
                            previousID = targetElement.getAttribute("data-id") || "";
                        } else if (targetElement.classList.contains("dragover__top") || targetElement.classList.contains("dragover__left")) {
                            previousID = targetElement.previousElementSibling?.getAttribute("data-id") || "";
                        }
                        const avID = blockElement.getAttribute("data-av-id");
                        const newUpdated = dayjs().format("YYYYMMDDHHmmss");
                        const srcs: IOperationSrcs[] = [];
                        const bodyElement = hasClosestByClassName(targetElement, "av__body");
                        const groupID = bodyElement && bodyElement.getAttribute("data-group-id");
                        ids.forEach(id => {
                            srcs.push({
                                itemID: Lute.NewNodeID(),
                                id,
                                isDetached: false,
                            });
                        });
                        transaction(protyle, [{
                            action: "insertAttrViewBlock",
                            avID,
                            previousID,
                            srcs,
                            blockID: blockElement.dataset.nodeId,
                            groupID
                        }, {
                            action: "doUpdateUpdated",
                            id: blockElement.dataset.nodeId,
                            data: newUpdated,
                        }], [{
                            action: "removeAttrViewBlock",
                            srcIDs: ids,
                            avID,
                        }, {
                            action: "doUpdateUpdated",
                            id: blockElement.dataset.nodeId,
                            data: blockElement.getAttribute("updated")
                        }]);
                        insertAttrViewBlockAnimation({
                            protyle,
                            blockElement,
                            srcIDs: ids,
                            previousId: previousID,
                            groupID
                        });
                        blockElement.setAttribute("updated", newUpdated);
                    }
                } else {
                    if (targetElement.classList.contains("dragover__bottom")) {
                        for (let i = ids.length - 1; i > -1; i--) {
                            if (ids[i]) {
                                await fetchSyncPost("/api/filetree/doc2Heading", {
                                    srcID: ids[i],
                                    after: true,
                                    targetID: targetElement.getAttribute("data-node-id"),
                                });
                            }
                        }
                    } else {
                        for (let i = 0; i < ids.length; i++) {
                            if (ids[i]) {
                                await fetchSyncPost("/api/filetree/doc2Heading", {
                                    srcID: ids[i],
                                    after: false,
                                    targetID: targetElement.getAttribute("data-node-id"),
                                });
                            }
                        }
                    }

                    fetchPost("/api/filetree/getDoc", {
                        id: protyle.block.id,
                        size: window.siyuan.config.editor.dynamicLoadBlocks,
                    }, getResponse => {
                        onGet({data: getResponse, protyle});
                        /// #if !MOBILE
                        // 文档标题互转后，需更新大纲
                        updatePanelByEditor({
                            protyle,
                            focus: false,
                            pushBackStack: false,
                            reload: true,
                            resize: false,
                        });
                        /// #endif
                        // 文档标题互转后，编辑区会跳转到开头 https://github.com/siyuan-note/siyuan/issues/2939
                        setTimeout(() => {
                            protyle.contentElement.scrollTop = scrollTop;
                            protyle.scroll.lastScrollTop = scrollTop - 1;
                        }, Constants.TIMEOUT_LOAD);
                    });
                }
                targetElement.classList.remove("dragover__bottom", "dragover__top", "dragover__left", "dragover__right");
            }
        } else if (!window.siyuan.dragElement && (event.dataTransfer.types[0] === "Files" || event.dataTransfer.types.includes("text/html"))) {
            event.preventDefault();
            // 外部文件拖入编辑器中或者编辑器内选中文字拖拽
            // https://github.com/siyuan-note/siyuan/issues/9544
            const avElement = hasClosestByClassName(event.target, "av");
            if (!avElement) {
                focusByRange(getRangeByPoint(event.clientX, event.clientY));
                if (event.dataTransfer.types[0] === "Files" && !isBrowser()) {
                    const files: ILocalFiles[] = [];
                    for (let i = 0; i < event.dataTransfer.files.length; i++) {
                        files.push({
                            path: webUtils.getPathForFile(event.dataTransfer.files[i]),
                            size: event.dataTransfer.files[i].size
                        });
                    }
                    uploadLocalFiles(files, protyle, !event.altKey);
                } else {
                    paste(protyle, event);
                }
                clearSelect(["av", "img"], protyle.wysiwyg.element);
            } else {
                const cellElement = hasClosestByClassName(event.target, "av__cell");
                if (cellElement) {
                    if (getTypeByCellElement(cellElement) === "mAsset" && event.dataTransfer.types[0] === "Files" && !isBrowser()) {
                        const files: ILocalFiles[] = [];
                        for (let i = 0; i < event.dataTransfer.files.length; i++) {
                            files.push({
                                path: webUtils.getPathForFile(event.dataTransfer.files[i]),
                                size: event.dataTransfer.files[i].size
                            });
                        }
                        dragUpload(files, protyle, cellElement);
                        clearSelect(["cell"], avElement);
                    }
                }
            }
        }
        if (window.siyuan.dragElement) {
            window.siyuan.dragElement.style.opacity = "";
            window.siyuan.dragElement = undefined;
        }
    });
    let dragoverElement: Element;
    let disabledPosition: string;
    editorElement.addEventListener("dragover", (event: DragEvent & { target: HTMLElement }) => {
        if (protyle.disabled || event.dataTransfer.types.includes(Constants.SIYUAN_DROP_EDITOR)) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "none";
            return;
        }
        let gutterType = "";
        for (const item of event.dataTransfer.items) {
            if (item.type.startsWith(Constants.SIYUAN_DROP_GUTTER)) {
                gutterType = item.type;
            }
        }
        if (gutterType.startsWith(`${Constants.SIYUAN_DROP_GUTTER}NodeAttributeView${Constants.ZWSP}ViewTab${Constants.ZWSP}`.toLowerCase())) {
            dragoverTab(event);
            event.preventDefault();
            return;
        }
        let targetElement: HTMLElement | false;
        // 设置了的话 drop 就无法监听 shift/control event.dataTransfer.dropEffect = "move";
        if (event.dataTransfer.types.includes("Files")) {
            targetElement = hasClosestByClassName(event.target, "av__cell");
            if (targetElement && targetElement.getAttribute("data-dtype") === "mAsset" &&
                !targetElement.classList.contains("av__cell--header")) {
                event.preventDefault(); // 不使用导致无法触发 drop
                if (dragoverElement && targetElement === dragoverElement) {
                    return;
                }
                const blockElement = hasClosestBlock(targetElement);
                if (blockElement) {
                    clearSelect(["cell", "row"], protyle.wysiwyg.element);
                    targetElement.classList.add("av__cell--select");
                    if (blockElement.getAttribute("data-av-type") !== "gallery") {
                        addDragFill(targetElement);
                    }
                    dragoverElement = targetElement;
                }
            }
            // 使用 event.preventDefault(); 会导致无光标 https://github.com/siyuan-note/siyuan/issues/12857
            return;
        }

        if (!gutterType && !window.siyuan.dragElement) {
            // https://github.com/siyuan-note/siyuan/issues/6436
            event.preventDefault();
            return;
        }
        const gutterTypes = gutterType ? gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP) : [];
        const fileTreeIds = (event.dataTransfer.types.includes(Constants.SIYUAN_DROP_FILE) && window.siyuan.dragElement) ? window.siyuan.dragElement.innerText : "";
        if (event.shiftKey || (event.altKey && fileTreeIds.indexOf("-") === -1)) {
            const targetAssetElement = hasClosestBlock(event.target);
            if (targetAssetElement) {
                targetAssetElement.classList.remove("dragover__top", "protyle-wysiwyg--select", "dragover__bottom", "dragover__left", "dragover__right");
                targetAssetElement.removeAttribute("select-start");
                targetAssetElement.removeAttribute("select-end");
            } else {
                // https://github.com/siyuan-note/siyuan/issues/14177
                editorElement.querySelectorAll(".dragover__top, .protyle-wysiwyg--select, .dragover__bottom, .dragover__left, .dragover__right").forEach((item: HTMLElement) => {
                    item.classList.remove("dragover__top", "protyle-wysiwyg--select", "dragover__bottom", "dragover__left", "dragover__right");
                    item.removeAttribute("select-start");
                    item.removeAttribute("select-end");
                });
            }
            event.preventDefault();
            return;
        }
        // 编辑器内文字拖拽或资源文件拖拽或按住 alt/shift 拖拽反链图标进入编辑器时不能运行 event.preventDefault()， 否则无光标; 需放在 !window.siyuan.dragElement 之后
        event.preventDefault();
        targetElement = hasClosestByClassName(event.target, "av__gallery-item") || hasClosestByClassName(event.target, "av__gallery-add") ||
            hasClosestByClassName(event.target, "av__row") || hasClosestByClassName(event.target, "av__row--util") ||
            hasClosestBlock(event.target);
        if (targetElement && ["gallery", "kanban"].includes(targetElement.getAttribute("data-av-type")) && event.target.classList.contains("av__gallery")) {
            // 拖拽到属性视图 gallery 内，但没选中 item
            return;
        }
        const point = {x: event.clientX, y: event.clientY, className: ""};

        // 超级块中有a，b两个段落块，移动到 ab 之间的间隙 targetElement 会变为超级块，需修正为 a
        if (targetElement && (targetElement.classList.contains("bq") || targetElement.classList.contains("sb") || targetElement.classList.contains("list") || targetElement.classList.contains("li"))) {
            let prevElement = hasClosestBlock(document.elementFromPoint(point.x, point.y - 6));
            while (prevElement && targetElement.contains(prevElement)) {
                if (prevElement.nextElementSibling?.getAttribute("data-node-id")) {
                    targetElement = prevElement;
                }
                prevElement = prevElement.parentElement;
            }
        }
        if (!targetElement) {
            if (event.clientY > editorElement.lastElementChild.getBoundingClientRect().bottom) {
                // 命中底部
                targetElement = editorElement.lastElementChild as HTMLElement;
                point.className = "dragover__bottom";
            } else if (event.clientY < editorElement.firstElementChild.getBoundingClientRect().top) {
                // 命中顶部
                targetElement = editorElement.firstElementChild as HTMLElement;
                point.className = "dragover__top";
            } else {
                const contentRect = protyle.contentElement.getBoundingClientRect();
                const editorPosition = {
                    left: contentRect.left + parseInt(editorElement.style.paddingLeft),
                    right: contentRect.left + protyle.contentElement.clientWidth - parseInt(editorElement.style.paddingRight)
                };
                if (event.clientX < editorPosition.left) {
                    // 左侧
                    point.x = editorPosition.left;
                    point.className = "dragover__left";
                } else if (event.clientX >= editorPosition.right) {
                    // 右侧
                    point.x = editorPosition.right - 6;
                    point.className = "dragover__right";
                }
                targetElement = document.elementFromPoint(point.x, point.y) as HTMLElement;
                if (targetElement.classList.contains("protyle-wysiwyg")) {
                    // 命中间隙
                    targetElement = document.elementFromPoint(point.x, point.y - 6) as HTMLElement;
                }
                targetElement = hasTopClosestByAttribute(targetElement, "data-node-id", null);
            }
        } else if (targetElement && targetElement.classList.contains("list")) {
            if (gutterTypes[0] !== "nodelistitem") {
                targetElement = hasClosestBlock(document.elementFromPoint(event.clientX, event.clientY - 6));
            } else {
                targetElement = hasClosestByClassName(document.elementFromPoint(event.clientX, event.clientY - 6), "li");
            }
        }
        if (gutterType && gutterType.startsWith(`${Constants.SIYUAN_DROP_GUTTER}NodeAttributeView${Constants.ZWSP}Col${Constants.ZWSP}`.toLowerCase())) {
            // 表头只能拖拽到当前 av 的表头中
            targetElement = hasClosestByClassName(event.target, "av__cell");
            if (targetElement) {
                const targetRowElement = hasClosestByClassName(targetElement, "av__row--header");
                const dragRowElement = hasClosestByClassName(window.siyuan.dragElement, "av__row--header");
                if (targetElement === window.siyuan.dragElement || !targetRowElement || !dragRowElement ||
                    (targetRowElement && dragRowElement && targetRowElement !== dragRowElement)
                ) {
                    targetElement = false;
                }
            }
        } else if (targetElement && gutterType && gutterType.startsWith(`${Constants.SIYUAN_DROP_GUTTER}NodeAttributeViewRowMenu${Constants.ZWSP}`.toLowerCase())) {
            if ((!targetElement.classList.contains("av__row") && !targetElement.classList.contains("av__row--util")) ||
                (window.siyuan.dragElement && !window.siyuan.dragElement.contains(targetElement))) {
                // 行只能拖拽当前 av 中
                targetElement = false;
            } else {
                const bodyElement = hasClosestByClassName(targetElement, "av__body");
                if (bodyElement) {
                    const blockElement = hasClosestBlock(bodyElement) as HTMLElement;
                    const groupID = bodyElement.getAttribute("data-group-id");
                    // 模板、创建时间、更新时间 字段作为分组方式时不允许跨分组拖拽 https://github.com/siyuan-note/siyuan/issues/15553
                    const isTCU = ["template", "created", "updated"].includes(bodyElement.getAttribute("data-dtype"));
                    // 排序只能夸组拖拽
                    const hasSort = blockElement.querySelector('.block__icon[data-type="av-sort"]')?.classList.contains("block__icon--active");
                    gutterTypes[2].split(",").find(item => {
                        const sourceGroupID = item ? item.split("@")[1] : "";
                        if (sourceGroupID !== groupID && isTCU) {
                            targetElement = false;
                            return true;
                        }
                        if (sourceGroupID === groupID && hasSort) {
                            targetElement = false;
                            return true;
                        }
                    });
                }
            }
        } else if (targetElement && gutterType && gutterType.startsWith(`${Constants.SIYUAN_DROP_GUTTER}NodeAttributeView${Constants.ZWSP}GalleryItem${Constants.ZWSP}`.toLowerCase())) {
            const containerElement = hasClosestByClassName(event.target, "av__container");
            if (targetElement.classList.contains("av") || !containerElement ||
                !containerElement.contains(window.siyuan.dragElement) || targetElement === window.siyuan.dragElement) {
                // gallery item 只能拖拽当前 av 中
                targetElement = false;
            } else {
                const bodyElement = hasClosestByClassName(targetElement, "av__body");
                if (bodyElement) {
                    const blockElement = hasClosestBlock(bodyElement) as HTMLElement;
                    const groupID = bodyElement.getAttribute("data-group-id");
                    // 模板、创建时间、更新时间 字段作为分组方式时不允许跨分组拖拽 https://github.com/siyuan-note/siyuan/issues/15553
                    const isTCU = ["template", "created", "updated"].includes(bodyElement.getAttribute("data-dtype"));
                    // 排序只能夸组拖拽
                    const hasSort = blockElement.querySelector('.block__icon[data-type="av-sort"]')?.classList.contains("block__icon--active");
                    gutterTypes[2].split(",").find(item => {
                        const sourceGroupID = item ? item.split("@")[1] : "";
                        if (sourceGroupID !== groupID && isTCU) {
                            targetElement = false;
                            return true;
                        }
                        if (sourceGroupID === groupID && hasSort) {
                            targetElement = false;
                            return true;
                        }
                    });
                }
            }
        }

        if (!targetElement) {
            editorElement.querySelectorAll(".dragover__bottom, .dragover__top, .dragover, .dragover__left, .dragover__right").forEach((item: HTMLElement) => {
                item.classList.remove("dragover__top", "dragover__bottom", "dragover", "dragover__left", "dragover__right");
            });
            return;
        }
        const isNotAvItem = !targetElement.classList.contains("av__row") &&
            !targetElement.classList.contains("av__row--util") &&
            !targetElement.classList.contains("av__gallery-item") &&
            !targetElement.classList.contains("av__gallery-add");
        if (targetElement && dragoverElement && targetElement === dragoverElement) {
            // 性能优化，目标为同一个元素不再进行校验
            const nodeRect = targetElement.getBoundingClientRect();
            editorElement.querySelectorAll(".dragover__left, .dragover__right, .dragover__bottom, .dragover__top, .dragover").forEach((item: HTMLElement) => {
                item.classList.remove("dragover__top", "dragover__bottom", "dragover__left", "dragover__right", "dragover");
                item.removeAttribute("select-start");
                item.removeAttribute("select-end");
            });
            // 文档树拖拽限制
            if (fileTreeIds.indexOf("-") > -1 && isNotAvItem) {
                if (!event.altKey) {
                    return;
                } else if (fileTreeIds.split(",").includes(protyle.block.rootID) && event.altKey) {
                    return;
                }
            }
            if (targetElement.getAttribute("data-type") === "NodeAttributeView" && hasClosestByTag(event.target, "TD")) {
                return;
            }
            if (point.className) {
                targetElement.classList.add(point.className);
                addDragover(targetElement);
                return;
            }
            // 忘记为什么要限定文档树的拖拽了，先放开 https://github.com/siyuan-note/siyuan/pull/13284#issuecomment-2503853135
            if (targetElement.getAttribute("data-type") === "NodeListItem") {
                if (event.clientY > nodeRect.top + nodeRect.height / 2) {
                    targetElement.classList.add("dragover__bottom");
                    addDragover(targetElement);
                } else if (!targetElement.classList.contains("av__row--header")) {
                    targetElement.classList.add("dragover__top");
                    addDragover(targetElement);
                }
                return;
            }

            if (targetElement.classList.contains("av__cell")) {
                if (event.clientX < nodeRect.left + nodeRect.width / 2 && event.clientX > nodeRect.left &&
                    !targetElement.classList.contains("av__row") && targetElement.previousElementSibling !== window.siyuan.dragElement) {
                    targetElement.classList.add("dragover__left");
                } else if (event.clientX > nodeRect.right - nodeRect.width / 2 && event.clientX <= nodeRect.right + 1 &&
                    !targetElement.classList.contains("av__row") && targetElement !== window.siyuan.dragElement.previousElementSibling) {
                    if (window.siyuan.dragElement.previousElementSibling.classList.contains("av__colsticky") &&
                        targetElement === window.siyuan.dragElement.previousElementSibling.lastElementChild) {
                        // 拖拽到固定列的最后一个元素
                    } else {
                        targetElement.classList.add("dragover__right");
                    }
                }
                return;
            }
            // gallery & kanban
            if (targetElement.classList.contains("av__gallery-item")) {
                if (hasClosestByClassName(targetElement, "av__kanban-group")) {
                    const midTop = nodeRect.top + nodeRect.height / 2;
                    if (event.clientY < midTop && event.clientY > nodeRect.top - 13) {
                        targetElement.classList.add("dragover__top");
                    } else if (event.clientY > midTop && event.clientY <= nodeRect.bottom + 13) {
                        targetElement.classList.add("dragover__bottom");
                    }
                } else {
                    const midLeft = nodeRect.left + nodeRect.width / 2;
                    if (event.clientX < midLeft && event.clientX > nodeRect.left - 13) {
                        targetElement.classList.add("dragover__left");
                    } else if (event.clientX > midLeft && event.clientX <= nodeRect.right + 13) {
                        targetElement.classList.add("dragover__right");
                    }
                }
                return;
            }
            if (targetElement.classList.contains("av__gallery-add")) {
                if (hasClosestByClassName(targetElement, "av__kanban-group")) {
                    targetElement.classList.add("dragover__top");
                } else {
                    targetElement.classList.add("dragover__left");
                }
                return;
            }

            if (event.clientX < nodeRect.left + 32 && event.clientX >= nodeRect.left - 1 &&
                !targetElement.classList.contains("av__row")) {
                targetElement.classList.add("dragover__left");
                addDragover(targetElement);
            } else if (event.clientX > nodeRect.right - 32 && event.clientX < nodeRect.right &&
                !targetElement.classList.contains("av__row")) {
                targetElement.classList.add("dragover__right");
                addDragover(targetElement);
            } else if (targetElement.classList.contains("av__row--header")) {
                targetElement.classList.add("dragover__bottom");
            } else if (targetElement.classList.contains("av__row--util")) {
                targetElement.previousElementSibling.classList.add("dragover__bottom");
            } else {
                if (event.clientY > nodeRect.top + nodeRect.height / 2 && disabledPosition !== "bottom") {
                    targetElement.classList.add("dragover__bottom");
                    addDragover(targetElement);
                } else if (disabledPosition !== "top") {
                    targetElement.classList.add("dragover__top");
                    addDragover(targetElement);
                }
            }
            return;
        }

        if (fileTreeIds.indexOf("-") > -1) {
            if (fileTreeIds.split(",").includes(protyle.block.rootID) && isNotAvItem && event.altKey) {
                dragoverElement = undefined;
                editorElement.querySelectorAll(".dragover__left, .dragover__right, .dragover__bottom, .dragover__top, .dragover").forEach((item: HTMLElement) => {
                    item.classList.remove("dragover__top", "dragover__bottom", "dragover__left", "dragover__right", "dragover");
                    item.removeAttribute("select-start");
                    item.removeAttribute("select-end");
                });
            } else {
                dragoverElement = targetElement;
            }
            return;
        }

        if (gutterType) {
            disabledPosition = "";
            // gutter 文档内拖拽限制
            // 排除自己及子孙
            if (gutterTypes[0] === "nodeattributeview" && gutterTypes[1] === "col" && targetElement.getAttribute("data-id") === gutterTypes[2]) {
                // 表头不能拖到自己上
                clearDragoverElement(dragoverElement);
                return;
            }
            if (gutterTypes[0] === "nodeattributeviewrowmenu" && gutterTypes[2].split("@")[0] === targetElement.getAttribute("data-id")) {
                // 行不能拖到自己上
                clearDragoverElement(dragoverElement);
                return;
            }
            const isSelf = gutterTypes[2].split(",").find((item: string) => {
                if (item && hasClosestByAttribute(targetElement as HTMLElement, "data-node-id", item)) {
                    return true;
                }
            });
            if (isSelf && "nodeattributeviewrowmenu" !== gutterTypes[0]) {
                clearDragoverElement(dragoverElement);
                return;
            }
            if (isInEmbedBlock(targetElement)) {
                // 不允许托入嵌入块
                clearDragoverElement(dragoverElement);
                return;
            }
            if (gutterTypes[0] === "nodelistitem" && "NodeListItem" === targetElement.getAttribute("data-type")) {
                if (gutterTypes[1] !== targetElement.getAttribute("data-subtype")) {
                    // 排除类型不同的列表项
                    clearDragoverElement(dragoverElement);
                    return;
                }
                // 选中非列表不能拖拽到列表中 https://github.com/siyuan-note/siyuan/issues/13822
                const notLiItem = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select")).find((item: HTMLElement) => {
                    if (!item.classList.contains("li")) {
                        return true;
                    }
                });
                if (notLiItem) {
                    clearDragoverElement(dragoverElement);
                    return;
                }
            }
            if (gutterTypes[0] !== "nodelistitem" && targetElement.getAttribute("data-type") === "NodeListItem") {
                // 非列表项不能拖入列表项周围
                clearDragoverElement(dragoverElement);
                return;
            }
            if (gutterTypes[0] === "nodelistitem" && targetElement.parentElement.classList.contains("li") &&
                targetElement.previousElementSibling?.classList.contains("protyle-action")) {
                // 列表项不能拖入列表项中第一个元素之上
                disabledPosition = "top";
            }
            if (gutterTypes[0] === "nodelistitem" && targetElement.nextElementSibling?.classList.contains("list")) {
                // 列表项不能拖入列表上方块的下面
                disabledPosition = "bottom";
            }
            if (targetElement && targetElement.classList.contains("av__row--header")) {
                // 块不能拖在表头上
                disabledPosition = "top";
            }
            dragoverElement = targetElement;
        }
    });
    let counter = 0;
    editorElement.addEventListener("dragleave", (event: DragEvent & { target: HTMLElement }) => {
        if (protyle.disabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        counter--;
        if (counter === 0) {
            editorElement.querySelectorAll(".dragover__left, .dragover__right, .dragover__bottom, .dragover__top, .dragover").forEach((item: HTMLElement) => {
                item.classList.remove("dragover__top", "dragover__bottom", "dragover__left", "dragover__right", "dragover");
            });
            dragoverElement = undefined;
        }
    });
    editorElement.addEventListener("dragenter", (event) => {
        event.preventDefault();
        counter++;
    });
    editorElement.addEventListener("dragend", () => {
        if (window.siyuan.dragElement) {
            window.siyuan.dragElement.style.opacity = "";
            window.siyuan.dragElement = undefined;
            document.onmousemove = null;
        }
    });
};

const addDragover = (element: HTMLElement) => {
    if (element.classList.contains("sb") ||
        element.classList.contains("li") ||
        element.classList.contains("list") ||
        element.classList.contains("bq")) {
        element.classList.add("dragover");
    }
};

// https://github.com/siyuan-note/siyuan/issues/12651
const clearDragoverElement = (element: Element) => {
    if (element) {
        element.classList.remove("dragover__top", "dragover__bottom", "dragover__left", "dragover__right", "dragover");
        element = undefined;
    }
};
