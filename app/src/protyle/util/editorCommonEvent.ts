import {focusBlock, focusByRange, getRangeByPoint} from "./selection";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
    hasTopClosestByAttribute
} from "./hasClosest";
import {Constants} from "../../constants";
import {paste} from "./paste";
import {cancelSB, genEmptyElement, genSBElement} from "../../block/util";
import {transaction} from "../wysiwyg/transaction";
import {getTopAloneElement} from "../wysiwyg/getBlock";
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
import {zoomOut} from "../../menus/protyle";

const moveToNew = (protyle: IProtyle, sourceElements: Element[], targetElement: Element, newSourceElement: Element,
                   isSameDoc: boolean, isBottom: boolean, isCopy: boolean) => {
    let topSourceElement;
    const targetId = targetElement.getAttribute("data-node-id");
    const newSourceId = newSourceElement.getAttribute("data-node-id");
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    targetElement.insertAdjacentElement(isBottom ? "afterend" : "beforebegin", newSourceElement);
    if (isBottom) {
        doOperations.push({
            action: "insert",
            data: newSourceElement.outerHTML,
            id: newSourceId,
            previousID: targetId,
        });
    } else {
        doOperations.push({
            action: "insert",
            data: newSourceElement.outerHTML,
            id: newSourceId,
            nextID: targetId,
        });
    }
    sourceElements.reverse().forEach((item, index) => {
        const itemId = item.getAttribute("data-node-id");
        if (index === sourceElements.length - 1) {
            topSourceElement = getTopAloneElement(item);
            if (topSourceElement.isSameNode(item)) {
                topSourceElement = undefined;
            }
        }
        const copyId = Lute.NewNodeID();
        if (isCopy) {
            undoOperations.push({
                action: "delete",
                id: copyId,
            });
        } else {
            undoOperations.push({
                action: "move",
                id: itemId,
                previousID: item.previousElementSibling?.getAttribute("data-node-id"),
                parentID: item.parentElement.getAttribute("data-node-id") || protyle.block.rootID,
            });
        }
        if (!isSameDoc && !isCopy) {
            // 打开两个相同的文档
            const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${itemId}"]`);
            if (sameElement) {
                sameElement.remove();
            }
        }
        if (isCopy) {
            const copyElement = item.cloneNode(true) as HTMLElement;
            copyElement.setAttribute("data-node-id", copyId);
            copyElement.querySelectorAll("[data-node-id]").forEach((e) => {
                const newId = Lute.NewNodeID();
                e.setAttribute("data-node-id", newId);
                e.setAttribute("updated", newId.split("-")[0]);
            });
            newSourceElement.insertAdjacentElement("afterbegin", copyElement);
            doOperations.push({
                action: "insert",
                id: copyId,
                data: copyElement.outerHTML,
                parentID: newSourceId,
            });
        } else {
            newSourceElement.insertAdjacentElement("afterbegin", item);
            doOperations.push({
                action: "move",
                id: itemId,
                parentID: newSourceId,
            });
        }
    });
    undoOperations.reverse();
    if (newSourceElement.getAttribute("data-subtype") === "o") {
        undoOperations.splice(0, 0, {
            action: "update",
            id: newSourceId,
            data: newSourceElement.outerHTML
        });
        updateListOrder(newSourceElement, 1);
        doOperations.push({
            action: "update",
            id: newSourceId,
            data: newSourceElement.outerHTML
        });
    }
    undoOperations.push({
        action: "delete",
        id: newSourceId,
    });
    return {
        doOperations,
        undoOperations,
        topSourceElement,
    };
};

const moveTo = async (protyle: IProtyle, sourceElements: Element[], targetElement: Element,
                      isSameDoc: boolean, position: InsertPosition, isCopy: boolean) => {
    let topSourceElement;
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const foldHeadingIds: { id: string, parentID: string }[] = [];
    const targetId = targetElement.getAttribute("data-node-id");
    let tempTargetElement = targetElement;
    sourceElements.reverse().forEach((item, index) => {
        const id = item.getAttribute("data-node-id");
        const parentID = item.parentElement.getAttribute("data-node-id") || protyle.block.rootID;
        if (index === sourceElements.length - 1) {
            topSourceElement = getTopAloneElement(item);
            if (topSourceElement.isSameNode(item)) {
                topSourceElement = undefined;
            } else if (topSourceElement.contains(item) && topSourceElement.contains(targetElement)) {
                // * * 1 列表项拖拽到父级列表项下 https://ld246.com/article/1665448570858
                topSourceElement = targetElement;
            }
        }
        if (isCopy && item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
            item.removeAttribute("fold");
            foldHeadingIds.push({id, parentID});
        }
        let copyId;
        let copyElement;
        if (isCopy) {
            copyId = Lute.NewNodeID();
            undoOperations.push({
                action: "delete",
                id: copyId,
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
            copyElement.setAttribute("data-node-id", copyId);
            copyElement.querySelectorAll("[data-node-id]").forEach((e) => {
                const newId = Lute.NewNodeID();
                e.setAttribute("data-node-id", newId);
                e.setAttribute("updated", newId.split("-")[0]);
            });
            tempTargetElement.insertAdjacentElement(position, copyElement);
            doOperations.push({
                action: "insert",
                id: copyId,
                data: copyElement.outerHTML,
                previousID: position === "afterend" ? targetId : copyElement.previousElementSibling?.getAttribute("data-node-id"), // 不能使用常量，移动后会被修改
                parentID: copyElement.parentElement?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID,
            });
        } else {
            tempTargetElement.insertAdjacentElement(position, item);
            doOperations.push({
                action: "move",
                id,
                previousID: position === "afterend" ? targetId : item.previousElementSibling?.getAttribute("data-node-id"), // 不能使用常量，移动后会被修改
                parentID: item.parentElement?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID,
            });
        }
        if (position !== "afterend") {
            tempTargetElement = isCopy ? copyElement : item;
        }
    });
    undoOperations.reverse();
    for (let j = 0; j < foldHeadingIds.length; j++) {
        const childrenItem = foldHeadingIds[j];
        const headingIds = await fetchSyncPost("/api/block/getHeadingChildrenIDs", {id: childrenItem.id});
        headingIds.data.reverse().forEach((headingId: string) => {
            undoOperations.push({
                action: "move",
                id: headingId,
                previousID: childrenItem.id,
                parentID: childrenItem.parentID,
            });
        });
        undoOperations.push({
            action: "foldHeading",
            id: childrenItem.id,
            data: "remove"
        });
        doOperations.push({
            action: "unfoldHeading",
            id: childrenItem.id,
        });
    }
    return {
        doOperations,
        undoOperations,
        topSourceElement,
    };
};

const dragSb = async (protyle: IProtyle, sourceElements: Element[], targetElement: Element, isBottom: boolean,
                      direct: "col" | "row", isCopy: boolean) => {
    const isSameDoc = protyle.element.contains(sourceElements[0]);

    let newSourceElement: HTMLElement;
    if (sourceElements[0].getAttribute("data-type") === "NodeListItem" && targetElement.getAttribute("data-type") !== "NodeListItem") {
        newSourceElement = document.createElement("div");
        newSourceElement.setAttribute("data-node-id", Lute.NewNodeID());
        newSourceElement.setAttribute("data-type", "NodeList");
        newSourceElement.setAttribute("data-subtype", sourceElements[0].getAttribute("data-subtype"));
        newSourceElement.className = "list";
        newSourceElement.insertAdjacentHTML("beforeend", `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`);
    }

    const undoOperations: IOperation[] = [{
        action: "move",
        id: targetElement.getAttribute("data-node-id"),
        previousID: targetElement.previousElementSibling?.getAttribute("data-node-id"),
        parentID: targetElement.parentElement?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
    }];
    let topSourceElement: Element;
    let oldSourceParentElement = sourceElements[0].parentElement;
    const sbElement = genSBElement(direct);
    targetElement.parentElement.replaceChild(sbElement, targetElement);
    const doOperations: IOperation[] = [{
        action: "insert",
        data: sbElement.outerHTML,
        id: sbElement.getAttribute("data-node-id"),
        nextID: sbElement.nextElementSibling?.getAttribute("data-node-id"),
        previousID: sbElement.previousElementSibling?.getAttribute("data-node-id"),
        parentID: sbElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
    }];
    if (newSourceElement) {
        const newSourceId = newSourceElement.getAttribute("data-node-id");
        sbElement.insertAdjacentElement("afterbegin", targetElement);
        doOperations.push({
            action: "move",
            id: targetElement.getAttribute("data-node-id"),
            parentID: sbElement.getAttribute("data-node-id")
        });
        if (isBottom) {
            targetElement.insertAdjacentElement("afterend", newSourceElement);
            doOperations.push({
                action: "insert",
                data: newSourceElement.outerHTML,
                id: newSourceId,
                previousID: targetElement.getAttribute("data-node-id"),
            });
        } else {
            targetElement.insertAdjacentElement("beforebegin", newSourceElement);
            doOperations.push({
                action: "insert",
                data: newSourceElement.outerHTML,
                id: newSourceId,
                nextID: targetElement.getAttribute("data-node-id"),
            });
        }
        sourceElements.reverse().forEach((item, index) => {
            if (index === sourceElements.length - 1) {
                topSourceElement = getTopAloneElement(item);
                if (topSourceElement.isSameNode(item)) {
                    topSourceElement = undefined;
                }
            }
            const copyId = Lute.NewNodeID();
            if (isCopy) {
                undoOperations.push({
                    action: "delete",
                    id: copyId
                });
            } else {
                undoOperations.push({
                    action: "move",
                    id: item.getAttribute("data-node-id"),
                    previousID: item.previousElementSibling?.getAttribute("data-node-id"),
                    parentID: item.parentElement.getAttribute("data-node-id") || protyle.block.rootID,
                });
            }
            if (!isSameDoc && !isCopy) {
                // 打开两个相同的文档
                const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${item.getAttribute("data-node-id")}"]`);
                if (sameElement) {
                    sameElement.remove();
                }
            }
            if (isCopy) {
                const copyElement = item.cloneNode(true) as HTMLElement;
                copyElement.setAttribute("data-node-id", copyId);
                copyElement.querySelectorAll("[data-node-id]").forEach((e) => {
                    const newId = Lute.NewNodeID();
                    e.setAttribute("data-node-id", newId);
                    e.setAttribute("updated", newId.split("-")[0]);
                });
                newSourceElement.insertAdjacentElement("afterbegin", copyElement);
                doOperations.push({
                    action: "insert",
                    id: copyId,
                    data: copyElement.outerHTML,
                    parentID: newSourceId,
                });
            } else {
                newSourceElement.insertAdjacentElement("afterbegin", item);
                doOperations.push({
                    action: "move",
                    id: item.getAttribute("data-node-id"),
                    parentID: newSourceId,
                });
            }
        });
        undoOperations.reverse();
        undoOperations.push({
            action: "delete",
            id: newSourceId,
        });
    } else {
        const foldHeadingIds: { id: string, parentID: string }[] = [];
        let afterPreviousID;
        sourceElements.reverse().forEach((item, index) => {
            const id = item.getAttribute("data-node-id");
            const parentID = item.parentElement.getAttribute("data-node-id") || protyle.block.rootID;
            if (index === sourceElements.length - 1) {
                topSourceElement = getTopAloneElement(item);
                if (topSourceElement.isSameNode(item)) {
                    topSourceElement = undefined;
                }
            }
            const copyId = Lute.NewNodeID();
            if (index === 0) {
                afterPreviousID = isCopy ? copyId : id;
            }
            if (isCopy && item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
                item.removeAttribute("fold");
                foldHeadingIds.push({id, parentID});
            }
            if (isCopy) {
                undoOperations.push({
                    action: "delete",
                    id: copyId,
                });
            } else {
                undoOperations.push({
                    action: "move",
                    id,
                    previousID: item.previousElementSibling?.getAttribute("data-node-id"),
                    parentID
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
                const copyElement = item.cloneNode(true) as HTMLElement;
                copyElement.setAttribute("data-node-id", copyId);
                copyElement.querySelectorAll("[data-node-id]").forEach((e) => {
                    const newId = Lute.NewNodeID();
                    e.setAttribute("data-node-id", newId);
                    e.setAttribute("updated", newId.split("-")[0]);
                });
                sbElement.insertAdjacentElement("afterbegin", copyElement);
                doOperations.push({
                    action: "insert",
                    id: copyId,
                    data: copyElement.outerHTML,
                    parentID: sbElement.getAttribute("data-node-id"),
                });
            } else {
                sbElement.insertAdjacentElement("afterbegin", item);
                doOperations.push({
                    action: "move",
                    id,
                    parentID: sbElement.getAttribute("data-node-id"),
                });
            }
        });
        undoOperations.reverse();
        for (let j = 0; j < foldHeadingIds.length; j++) {
            const childrenItem = foldHeadingIds[j];
            const headingIds = await fetchSyncPost("/api/block/getHeadingChildrenIDs", {id: childrenItem.id});
            headingIds.data.reverse().forEach((headingId: string) => {
                undoOperations.push({
                    action: "move",
                    id: headingId,
                    previousID: childrenItem.id,
                    parentID: childrenItem.parentID,
                });
            });
            if (j === 0) {
                afterPreviousID = headingIds.data[0];
            }
            undoOperations.push({
                action: "foldHeading",
                id: childrenItem.id,
                data: "remove"
            });
            doOperations.push({
                action: "unfoldHeading",
                id: childrenItem.id,
            });
        }
        if (isBottom) {
            sbElement.insertAdjacentElement("afterbegin", targetElement);
            doOperations.push({
                action: "move",
                id: targetElement.getAttribute("data-node-id"),
                parentID: sbElement.getAttribute("data-node-id")
            });
        } else {
            sbElement.lastElementChild.insertAdjacentElement("beforebegin", targetElement);
            doOperations.push({
                action: "move",
                id: targetElement.getAttribute("data-node-id"),
                previousID: afterPreviousID
            });
        }
    }
    undoOperations.push({
        action: "delete",
        id: sbElement.getAttribute("data-node-id"),
    });
    // https://github.com/siyuan-note/insider/issues/536
    if (!isCopy && oldSourceParentElement && oldSourceParentElement.classList.contains("list") &&
        oldSourceParentElement.getAttribute("data-subtype") === "o" &&
        !oldSourceParentElement.isSameNode(sourceElements[0].parentElement) && oldSourceParentElement.childElementCount > 1) {
        Array.from(oldSourceParentElement.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            // 撤销更新不能位于最后，否则又更新为最新结果 https://github.com/siyuan-note/siyuan/issues/5725
            undoOperations.splice(0, 0, {
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
        updateListOrder(oldSourceParentElement, 1);
        Array.from(oldSourceParentElement.children).forEach((item) => {
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
    // 删除空元素
    if (!isCopy && topSourceElement) {
        doOperations.push({
            action: "delete",
            id: topSourceElement.getAttribute("data-node-id"),
        });
        undoOperations.splice(0, 0, {
            action: "insert",
            data: topSourceElement.outerHTML,
            id: topSourceElement.getAttribute("data-node-id"),
            previousID: topSourceElement.previousElementSibling?.getAttribute("data-node-id"),
            parentID: topSourceElement.parentElement?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
        });
        if (!isSameDoc) {
            // 打开两个相同的文档
            const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${topSourceElement.getAttribute("data-node-id")}"]`);
            if (sameElement) {
                sameElement.remove();
            }
        }
        oldSourceParentElement = topSourceElement.parentElement;
        topSourceElement.remove();
    }
    if (!isCopy && oldSourceParentElement && oldSourceParentElement.classList.contains("sb") && oldSourceParentElement.childElementCount === 2) {
        // 拖拽后，sb 只剩下一个元素
        if (isSameDoc) {
            const sbData = cancelSB(protyle, oldSourceParentElement);
            doOperations.push(sbData.doOperations[0], sbData.doOperations[1]);
            undoOperations.splice(0, 0, sbData.undoOperations[0], sbData.undoOperations[1]);
        } else {
            /// #if !MOBILE
            const otherProtyleElement = hasClosestByClassName(oldSourceParentElement, "protyle", true);
            if (otherProtyleElement) {
                getAllEditor().find(item => {
                    if (item.protyle.element.isSameNode(otherProtyleElement)) {
                        const otherSbData = cancelSB(item.protyle, oldSourceParentElement);
                        doOperations.push(otherSbData.doOperations[0], otherSbData.doOperations[1]);
                        undoOperations.splice(0, 0, otherSbData.undoOperations[0], otherSbData.undoOperations[1]);
                        // 需清空操作栈，否则撤销到移动出去的块的操作会抛异常
                        item.protyle.undo.clear();
                        return true;
                    }
                });
            }
            /// #endif
        }
    } else if (!isCopy && oldSourceParentElement && oldSourceParentElement.classList.contains("protyle-wysiwyg") && oldSourceParentElement.innerHTML === "") {
        /// #if !MOBILE
        // 拖拽后，根文档原内容为空，且不为悬浮窗
        const protyleElement = hasClosestByClassName(oldSourceParentElement, "protyle", true);
        if (protyleElement) {
            getAllEditor().find(item => {
                if (item.protyle.element.isSameNode(protyleElement)) {
                    if (item.protyle.block.id === item.protyle.block.rootID) {
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
        }
        /// #endif
    }
    if (isSameDoc || isCopy) {
        transaction(protyle, doOperations, undoOperations);
    } else {
        // 跨文档不支持撤销
        transaction(protyle, doOperations);
    }
    focusBlock(sourceElements[0]);
};

const dragSame = async (protyle: IProtyle, sourceElements: Element[], targetElement: Element, isBottom: boolean, isCopy: boolean) => {
    const isSameDoc = protyle.element.contains(sourceElements[0]);
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];

    let newSourceElement: HTMLElement;
    if (sourceElements[0].getAttribute("data-type") === "NodeListItem" && targetElement.getAttribute("data-type") !== "NodeListItem") {
        newSourceElement = document.createElement("div");
        newSourceElement.setAttribute("data-node-id", Lute.NewNodeID());
        newSourceElement.setAttribute("data-type", "NodeList");
        newSourceElement.setAttribute("data-subtype", sourceElements[0].getAttribute("data-subtype"));
        newSourceElement.className = "list";
        newSourceElement.insertAdjacentHTML("beforeend", `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`);
    }
    let topSourceElement: Element;
    let oldSourceParentElement = sourceElements[0].parentElement;
    if (isBottom) {
        if (newSourceElement) {
            const moveToResult = moveToNew(protyle, sourceElements, targetElement, newSourceElement, isSameDoc, isBottom, isCopy);
            doOperations.push(...moveToResult.doOperations);
            undoOperations.push(...moveToResult.undoOperations);
            topSourceElement = moveToResult.topSourceElement;
        } else {
            const moveToResult = await moveTo(protyle, sourceElements, targetElement, isSameDoc, "afterend", isCopy);
            doOperations.push(...moveToResult.doOperations);
            undoOperations.push(...moveToResult.undoOperations);
            topSourceElement = moveToResult.topSourceElement;
        }
    } else {
        if (newSourceElement) {
            const moveToResult = moveToNew(protyle, sourceElements, targetElement, newSourceElement, isSameDoc, isBottom, isCopy);
            doOperations.push(...moveToResult.doOperations);
            undoOperations.push(...moveToResult.undoOperations);
            topSourceElement = moveToResult.topSourceElement;
        } else {
            const moveToResult = await moveTo(protyle, sourceElements, targetElement, isSameDoc, "beforebegin", isCopy);
            doOperations.push(...moveToResult.doOperations);
            undoOperations.push(...moveToResult.undoOperations);
            topSourceElement = moveToResult.topSourceElement;
        }
    }
    if (targetElement.getAttribute("data-type") === "NodeListItem" && targetElement.getAttribute("data-subtype") === "o") {
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
    if (!isCopy &&
        isSameDoc &&    // 同一文档分屏后，oldSourceParentElement 已经被移走，不可再 update https://github.com/siyuan-note/siyuan/issues/8863
        oldSourceParentElement && oldSourceParentElement.classList.contains("list") &&
        oldSourceParentElement.getAttribute("data-subtype") === "o" &&
        !oldSourceParentElement.isSameNode(sourceElements[0].parentElement) && oldSourceParentElement.childElementCount > 1) {
        Array.from(oldSourceParentElement.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            if (oldSourceParentElement.contains(targetElement)) {
                undoOperations.splice(0, 0, {
                    action: "update",
                    id: item.getAttribute("data-node-id"),
                    data: item.outerHTML
                });
            } else {
                undoOperations.splice(targetElement.parentElement.childElementCount - 1, 0, {
                    action: "update",
                    id: item.getAttribute("data-node-id"),
                    data: item.outerHTML
                });
            }
        });
        updateListOrder(oldSourceParentElement, 1);
        Array.from(oldSourceParentElement.children).forEach((item) => {
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

    // 删除空元素
    if (!isCopy && topSourceElement) {
        doOperations.push({
            action: "delete",
            id: topSourceElement.getAttribute("data-node-id"),
        });
        undoOperations.splice(0, 0, {
            action: "insert",
            data: topSourceElement.outerHTML,
            id: topSourceElement.getAttribute("data-node-id"),
            previousID: topSourceElement.previousElementSibling?.getAttribute("data-node-id"),
            parentID: topSourceElement.parentElement?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
        });
        oldSourceParentElement = topSourceElement.parentElement;
        topSourceElement.remove();
        if (!isSameDoc) {
            // 打开两个相同的文档
            const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${topSourceElement.getAttribute("data-node-id")}"]`);
            if (sameElement) {
                sameElement.remove();
            }
        }
    }
    if (!isCopy && oldSourceParentElement && oldSourceParentElement.classList.contains("sb") && oldSourceParentElement.childElementCount === 2) {
        // 拖拽后，sb 只剩下一个元素
        if (isSameDoc) {
            const sbData = cancelSB(protyle, oldSourceParentElement);
            doOperations.push(sbData.doOperations[0], sbData.doOperations[1]);
            undoOperations.splice(0, 0, sbData.undoOperations[0], sbData.undoOperations[1]);
        } else {
            /// #if !MOBILE
            const otherProtyleElement = hasClosestByClassName(oldSourceParentElement, "protyle", true);
            if (otherProtyleElement) {
                getAllEditor().find(item => {
                    if (item.protyle.element.isSameNode(otherProtyleElement)) {
                        const otherSbData = cancelSB(item.protyle, oldSourceParentElement);
                        doOperations.push(otherSbData.doOperations[0], otherSbData.doOperations[1]);
                        undoOperations.splice(0, 0, otherSbData.undoOperations[0], otherSbData.undoOperations[1]);
                        // 需清空操作栈，否则撤销到移动出去的块的操作会抛异常
                        item.protyle.undo.clear();
                        return true;
                    }
                });
            }
            /// #endif
        }
    } else if (!isCopy && oldSourceParentElement && oldSourceParentElement.classList.contains("protyle-wysiwyg") && oldSourceParentElement.childElementCount === 0) {
        /// #if !MOBILE
        // 拖拽后，根文档原内容为空
        const protyleElement = hasClosestByClassName(oldSourceParentElement, "protyle", true);
        if (protyleElement) {
            getAllEditor().find(item => {
                if (item.protyle.element.isSameNode(protyleElement)) {
                    if (item.protyle.block.id === item.protyle.block.rootID) {
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
        }
        /// #endif
    }
    if (isSameDoc || isCopy) {
        transaction(protyle, doOperations, undoOperations);
    } else {
        // 跨文档不支持撤销
        transaction(protyle, doOperations);
    }
    focusBlock(sourceElements[0]);
};

export const dropEvent = (protyle: IProtyle, editorElement: HTMLElement) => {
    editorElement.addEventListener("dragstart", (event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "IMG") {
            window.siyuan.dragElement = undefined;
            event.preventDefault();
            return;
        }
        if (target.classList) {
            if (hasClosestByClassName(target, "protyle-wysiwyg__embed")) {
                window.siyuan.dragElement = undefined;
                event.preventDefault();
            } else if (target.classList.contains("protyle-action")) {
                window.siyuan.dragElement = protyle.wysiwyg.element;
                event.dataTransfer.setData(`${Constants.SIYUAN_DROP_GUTTER}NodeListItem${Constants.ZWSP}${target.parentElement.getAttribute("data-subtype")}${Constants.ZWSP}${[target.parentElement.getAttribute("data-node-id")]}`,
                    protyle.wysiwyg.element.innerHTML);
                return;
            } else if (target.classList.contains("av__cell--header")) {
                window.siyuan.dragElement = target;
                event.dataTransfer.setData(`${Constants.SIYUAN_DROP_GUTTER}NodeAttributeView${Constants.ZWSP}Col${Constants.ZWSP}${[target.getAttribute("data-col-id")]}`,
                    target.outerHTML);
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
        const targetElement = editorElement.querySelector(".dragover__left, .dragover__right, .dragover__bottom, .dragover__top");
        if (targetElement) {
            targetElement.classList.remove("protyle-wysiwyg--select");
            targetElement.removeAttribute("select-start");
            targetElement.removeAttribute("select-end");
        }
        if (gutterType) {
            // gutter 或反链面板拖拽
            const sourceElements: Element[] = [];
            const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
            const selectedIds = gutterTypes[2].split(",");
            if (event.altKey) {
                focusByRange(getRangeByPoint(event.clientX, event.clientY));
                let html = "";
                for (let i = 0; i < selectedIds.length; i++) {
                    const response = await fetchSyncPost("/api/block/getRefText", {id: selectedIds[i]});
                    html += `((${selectedIds[i]} '${response.data}')) `;
                }
                insertHTML(html, protyle);
            } else if (event.shiftKey) {
                focusByRange(getRangeByPoint(event.clientX, event.clientY));
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
                        if (elementItem.getAttribute("data-type") === "NodeBlockQueryEmbed" ||
                            !hasClosestByAttribute(elementItem, "data-type", "NodeBlockQueryEmbed")) {
                            sourceElements.push(elementItem);
                        }
                    });
                } else {    // 跨窗口拖拽
                    const targetProtyleElement = document.createElement("template");
                    targetProtyleElement.innerHTML = `<div>${event.dataTransfer.getData(gutterType)}</div>`;
                    targetProtyleElement.content.querySelectorAll(queryClass.substring(0, queryClass.length - 1)).forEach(elementItem => {
                        if (elementItem.getAttribute("data-type") === "NodeBlockQueryEmbed" ||
                            !hasClosestByAttribute(elementItem, "data-type", "NodeBlockQueryEmbed")) {
                            sourceElements.push(elementItem);
                        }
                    });
                }

                const sourceIds: string [] = [];
                const srcs: IOperationSrcs[] = [];
                sourceElements.forEach(item => {
                    item.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--hl");
                    item.removeAttribute("select-start");
                    item.removeAttribute("select-end");
                    // 反链提及有高亮，如果拖拽到正文的话，应移除
                    item.querySelectorAll('[data-type="search-mark"]').forEach(markItem => {
                        markItem.outerHTML = markItem.innerHTML;
                    });
                    const id = item.getAttribute("data-node-id");
                    sourceIds.push(id);
                    srcs.push({
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
                    // 拖拽到属性视图内
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
                            const undoPreviousId = blockElement.querySelector(`.av__row[data-id="${selectedIds[0]}"]`).previousElementSibling.getAttribute("data-id") || "";
                            selectedIds.reverse().forEach(item => {
                                if (previousID !== item && undoPreviousId !== previousID) {
                                    doOperations.push({
                                        action: "sortAttrViewRow",
                                        avID,
                                        previousID,
                                        id: item,
                                        blockID: blockElement.dataset.nodeId,
                                    });
                                    undoOperations.push({
                                        action: "sortAttrViewRow",
                                        avID,
                                        previousID: undoPreviousId,
                                        id: item,
                                        blockID: blockElement.dataset.nodeId,
                                    });
                                }
                            });
                            transaction(protyle, doOperations, undoOperations);
                        } else {
                            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
                            transaction(protyle, [{
                                action: "insertAttrViewBlock",
                                avID,
                                previousID,
                                srcs,
                                blockID: blockElement.dataset.nodeId
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
                            insertAttrViewBlockAnimation(protyle, blockElement, sourceIds, previousID);
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
                    // 超级块内嵌入块无面包屑，需重新渲染 https://github.com/siyuan-note/siyuan/issues/7574
                    sourceElements.forEach(item => {
                        if (item.getAttribute("data-type") === "NodeBlockQueryEmbed") {
                            item.removeAttribute("data-render");
                            blockRender(protyle, item);
                        }
                    });
                    if (targetElement.getAttribute("data-type") === "NodeBlockQueryEmbed") {
                        targetElement.removeAttribute("data-render");
                        blockRender(protyle, targetElement);
                    }
                }
                dragoverElement = undefined;
            }
        } else if (event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE)?.split("-").length > 1
            && targetElement && !protyle.options.backlinkData && targetElement.className.indexOf("dragover__") > -1) {
            // 文件树拖拽
            const scrollTop = protyle.contentElement.scrollTop;
            const ids = event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE).split(",");
            if (targetElement.classList.contains("av__row")) {
                // 拖拽到属性视图内
                const blockElement = hasClosestBlock(targetElement);
                if (blockElement) {
                    let previousID = "";
                    if (targetElement.classList.contains("dragover__bottom")) {
                        previousID = targetElement.getAttribute("data-id") || "";
                    } else {
                        previousID = targetElement.previousElementSibling?.getAttribute("data-id") || "";
                    }
                    const avID = blockElement.getAttribute("data-av-id");
                    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
                    const srcs: IOperationSrcs[] = [];
                    ids.forEach(id => {
                        srcs.push({
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
                    insertAttrViewBlockAnimation(protyle, blockElement, ids, previousID);
                    blockElement.setAttribute("updated", newUpdated);
                }
            } else {
                for (let i = 0; i < ids.length; i++) {
                    if (ids[i]) {
                        await fetchSyncPost("/api/filetree/doc2Heading", {
                            srcID: ids[i],
                            after: targetElement.classList.contains("dragover__bottom"),
                            targetID: targetElement.getAttribute("data-node-id"),
                        });
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
        } else if (!window.siyuan.dragElement && (event.dataTransfer.types[0] === "Files" || event.dataTransfer.types.includes("text/html"))) {
            // 外部文件拖入编辑器中或者编辑器内选中文字拖拽
            // https://github.com/siyuan-note/siyuan/issues/9544
            const avElement = hasClosestByClassName(event.target, "av");
            if (!avElement) {
                focusByRange(getRangeByPoint(event.clientX, event.clientY));
                if (event.dataTransfer.types[0] === "Files" && !isBrowser()) {
                    const files: string[] = [];
                    for (let i = 0; i < event.dataTransfer.files.length; i++) {
                        files.push(event.dataTransfer.files[i].path);
                    }
                    uploadLocalFiles(files, protyle, !event.altKey);
                } else {
                    paste(protyle, event);
                }
            } else {
                const cellElement = hasClosestByClassName(event.target, "av__cell");
                if (cellElement) {
                    const cellType = avElement.querySelector(`.av__row--header [data-col-id="${cellElement.dataset.colId}"]`)?.getAttribute("data-dtype");
                    if (cellType === "mAsset" && event.dataTransfer.types[0] === "Files" && !isBrowser()) {
                        const files: string[] = [];
                        for (let i = 0; i < event.dataTransfer.files.length; i++) {
                            files.push(event.dataTransfer.files[i].path);
                        }
                        dragUpload(files, protyle, cellElement);
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
        const contentRect = protyle.contentElement.getBoundingClientRect();
        if (!hasClosestByClassName(event.target, "av__cell") && (event.clientY < contentRect.top + Constants.SIZE_SCROLL_TB || event.clientY > contentRect.bottom - Constants.SIZE_SCROLL_TB)) {
            protyle.contentElement.scroll({
                top: protyle.contentElement.scrollTop + (event.clientY < contentRect.top + Constants.SIZE_SCROLL_TB ? -Constants.SIZE_SCROLL_STEP : Constants.SIZE_SCROLL_STEP),
                behavior: "smooth"
            });
        }
        // 设置了的话 drop 就无法监听 shift/control event.dataTransfer.dropEffect = "move";
        if (event.dataTransfer.types.includes("Files") && event.target.classList.contains("protyle-wysiwyg")) {
            // 文档底部拖拽文件需 preventDefault，否则无法触发 drop 事件 https://github.com/siyuan-note/siyuan/issues/2665
            event.preventDefault();
            return;
        }
        let gutterType = "";
        for (const item of event.dataTransfer.items) {
            if (item.type.startsWith(Constants.SIYUAN_DROP_GUTTER)) {
                gutterType = item.type;
            }
        }
        if (!gutterType && !window.siyuan.dragElement) {
            // https://github.com/siyuan-note/siyuan/issues/6436
            event.preventDefault();
            return;
        }
        if (event.shiftKey || event.altKey) {
            const targetElement = hasClosestBlock(event.target);
            if (targetElement) {
                targetElement.classList.remove("dragover__top", "protyle-wysiwyg--select", "dragover__bottom", "dragover__left", "dragover__right");
                targetElement.removeAttribute("select-start");
                targetElement.removeAttribute("select-end");
            }
            event.preventDefault();
            return;
        }
        // 编辑器内文字拖拽或资源文件拖拽或按住 alt/shift 拖拽反链图标进入编辑器时不能运行 event.preventDefault()， 否则无光标; 需放在 !window.siyuan.dragElement 之后
        event.preventDefault();
        let targetElement = hasClosestByClassName(event.target, "av__row") || hasClosestBlock(event.target);
        const point = {x: event.clientX, y: event.clientY, className: ""};
        if (!targetElement) {
            if (event.clientY > editorElement.lastElementChild.getBoundingClientRect().bottom) {
                // 命中底部
                targetElement = editorElement.lastElementChild as HTMLElement;
                point.className = "dragover__bottom";
            } else if (event.clientY < editorElement.firstElementChild.getBoundingClientRect().top) {
                // 命中顶部
                targetElement = editorElement.firstElementChild as HTMLElement;
                point.className = "dragover__top";
            } else if (contentRect) {
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
            if (gutterType && gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP)[0] !== "nodelistitem") {
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
                if (targetElement.isSameNode(window.siyuan.dragElement) || !targetRowElement || !dragRowElement ||
                    (targetRowElement && dragRowElement && !targetRowElement.isSameNode(dragRowElement))
                ) {
                    targetElement = false;
                }
            }
        } else if (targetElement && gutterType && gutterType.startsWith(`${Constants.SIYUAN_DROP_GUTTER}NodeAttributeViewRowMenu${Constants.ZWSP}`.toLowerCase())) {
            // 行只能拖拽当前 av 中
            if (!targetElement.classList.contains("av__row") || !window.siyuan.dragElement.contains(targetElement)) {
                targetElement = false;
            }
        }
        if (!targetElement) {
            return;
        }
        const fileTreeIds = (event.dataTransfer.types.includes(Constants.SIYUAN_DROP_FILE) && window.siyuan.dragElement) ? window.siyuan.dragElement.innerText : "";
        if (targetElement && dragoverElement && targetElement.isSameNode(dragoverElement)) {
            // 性能优化，目标为同一个元素不再进行校验
            const nodeRect = targetElement.getBoundingClientRect();
            editorElement.querySelectorAll(".dragover__left, .dragover__right, .dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                item.classList.remove("dragover__top", "dragover__bottom", "dragover__left", "dragover__right", "protyle-wysiwyg--select");
                item.removeAttribute("select-start");
                item.removeAttribute("select-end");
            });
            if (targetElement.getAttribute("data-type") === "NodeAttributeView" && hasClosestByTag(event.target, "TD")) {
                return;
            }
            if (point.className) {
                targetElement.classList.add(point.className);
                return;
            }
            if (targetElement.getAttribute("data-type") === "NodeListItem" || fileTreeIds.indexOf("-") > -1) {
                if (event.clientY > nodeRect.top + nodeRect.height / 2) {
                    targetElement.classList.add("dragover__bottom");
                } else if (!targetElement.classList.contains("av__row--header")) {
                    targetElement.classList.add("dragover__top");
                }
                return;
            }

            if (targetElement.classList.contains("av__cell")) {
                if (event.clientX < nodeRect.left + nodeRect.width / 2 && event.clientX > nodeRect.left &&
                    !targetElement.classList.contains("av__row") && !targetElement.previousElementSibling.isSameNode(window.siyuan.dragElement)) {
                    targetElement.classList.add("dragover__left");
                } else if (event.clientX > nodeRect.right - nodeRect.width / 2 && event.clientX <= nodeRect.right + 1 &&
                    !targetElement.classList.contains("av__row") && !targetElement.isSameNode(window.siyuan.dragElement.previousElementSibling)) {
                    if (window.siyuan.dragElement.previousElementSibling.classList.contains("av__colsticky") && targetElement.isSameNode(window.siyuan.dragElement.previousElementSibling.lastElementChild)) {
                        // 拖拽到固定列的最后一个元素
                    } else {
                        targetElement.classList.add("dragover__right");
                    }
                }
                return;
            }
            if (event.clientX < nodeRect.left + 32 && event.clientX >= nodeRect.left - 1 &&
                !targetElement.classList.contains("av__row")) {
                targetElement.classList.add("dragover__left");
            } else if (event.clientX > nodeRect.right - 32 && event.clientX < nodeRect.right &&
                !targetElement.classList.contains("av__row")) {
                targetElement.classList.add("dragover__right");
            } else {
                if (event.clientY > nodeRect.top + nodeRect.height / 2 && disabledPosition !== "bottom") {
                    targetElement.classList.add("dragover__bottom");
                } else if (disabledPosition !== "top") {
                    targetElement.classList.add("dragover__top");
                }
            }
            return;
        }
        if (fileTreeIds.indexOf("-") > -1) {
            if (fileTreeIds.split(",").includes(protyle.block.rootID) && !targetElement.classList.contains("av__row")) {
                dragoverElement = undefined;
            } else {
                dragoverElement = targetElement;
            }
            return;
        }
        if (gutterType) {
            disabledPosition = "";
            // gutter 文档内拖拽限制
            // 排除自己及子孙
            const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
            if (gutterTypes[0] === "nodeattributeview" && gutterTypes[1] === "col" && targetElement.getAttribute("data-id") === gutterTypes[2]) {
                // 表头不能拖到自己上
                return;
            }
            if (gutterTypes[0] === "nodeattributeviewrowmenu" && gutterTypes[2] === targetElement.getAttribute("data-id")) {
                // 行不能拖到自己上
                return;
            }
            const isSelf = gutterTypes[2].split(",").find((item: string) => {
                if (item && hasClosestByAttribute(targetElement as HTMLElement, "data-node-id", item)) {
                    return true;
                }
            });
            if (isSelf) {
                return;
            }
            if (hasClosestByAttribute(targetElement.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                // 不允许托入嵌入块
                return;
            }
            if (gutterTypes[0] === "nodelistitem" &&
                gutterTypes[1] !== targetElement.getAttribute("data-subtype") &&
                "NodeListItem" === targetElement.getAttribute("data-type")) {
                // 排除类型不同的列表项
                return;
            }
            if (gutterTypes[0] !== "nodelistitem" && targetElement.getAttribute("data-type") === "NodeListItem") {
                // 非列表项不能拖入列表项周围
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
    editorElement.addEventListener("dragleave", (event) => {
        if (protyle.disabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        editorElement.querySelectorAll(".dragover__left, .dragover__right, .dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
            item.classList.remove("dragover__top", "dragover__bottom", "dragover__left", "dragover__right");
        });
    });
};
