import {focusByWbr} from "../util/selection";
import {transaction, updateTransaction} from "./transaction";
import {genEmptyBlock} from "../../block/util";
import * as dayjs from "dayjs";
import {Constants} from "../../constants";

export const updateListOrder = (listElement: Element, sIndex?: number) => {
    if (listElement.getAttribute("data-subtype") !== "o") {
        return;
    }
    let starIndex: number;
    Array.from(listElement.children).forEach((item, index) => {
        if (index === 0) {
            if (sIndex) {
                starIndex = sIndex;
                item.setAttribute("data-marker", (starIndex) + ".");
                item.querySelector(".protyle-action--order").textContent = (starIndex) + ".";
            } else {
                starIndex = parseInt(item.getAttribute("data-marker"));
            }
        } else if (item.classList.contains("li")) {
            // 保证列表项的缩放和常规列表属性的存在
            starIndex++;
            item.setAttribute("data-marker", (starIndex) + ".");
            item.querySelector(".protyle-action--order").textContent = (starIndex) + ".";
        }
    });
};

export const genListItemElement = (listItemElement: Element, offset = 0, wbr = false) => {
    const element = document.createElement("template");
    const type = listItemElement.getAttribute("data-subtype");
    if (type === "o") {
        const index = parseInt(listItemElement.getAttribute("data-marker")) + offset;
        element.innerHTML = `<div data-marker="${index + 1}." data-subtype="${type}" data-node-id="${Lute.NewNodeID()}" data-type="NodeListItem" class="li"><div contenteditable="false" class="protyle-action protyle-action--order" draggable="true">${index + 1}.</div>${genEmptyBlock(false, wbr)}<div class="protyle-attr" contenteditable="false"></div></div>`;
    } else if (type === "t") {
        element.innerHTML = `<div data-marker="*" data-subtype="${type}" data-node-id="${Lute.NewNodeID()}" data-type="NodeListItem" class="li"><div class="protyle-action protyle-action--task" draggable="true"><svg><use xlink:href="#iconUncheck"></use></svg></div>${genEmptyBlock(false, wbr)}<div class="protyle-attr" contenteditable="false"></div></div>`;
    } else {
        element.innerHTML = `<div data-marker="*" data-subtype="${type}" data-node-id="${Lute.NewNodeID()}" data-type="NodeListItem" class="li"><div class="protyle-action" draggable="true"><svg><use xlink:href="#iconDot"></use></svg></div>${genEmptyBlock(false, wbr)}<div class="protyle-attr" contenteditable="false"></div></div>`;
    }
    return element.content.firstElementChild as HTMLElement;
};

export const listIndent = (protyle: IProtyle, liItemElements: Element[], range: Range) => {
    const previousElement = liItemElements[0].previousElementSibling as HTMLElement;
    if (!previousElement) {
        return;
    }
    range.collapse(false);
    range.insertNode(document.createElement("wbr"));
    liItemElements.forEach(item => {
        item.classList.remove("protyle-wysiwyg--select");
        item.removeAttribute("select-start");
        item.removeAttribute("select-end");
    });
    const html = previousElement.parentElement.outerHTML;
    if (previousElement.lastElementChild.previousElementSibling.getAttribute("data-type") === "NodeList") {
        // 上一个列表的最后一项为子列表
        const previousLastListHTML = previousElement.lastElementChild.previousElementSibling.outerHTML;

        const doOperations: IOperation[] = [];
        const undoOperations: IOperation[] = [];

        const subtype = previousElement.lastElementChild.previousElementSibling.getAttribute("data-subtype");
        let previousID = previousElement.lastElementChild.previousElementSibling.lastElementChild.previousElementSibling.getAttribute("data-node-id");
        liItemElements.forEach((item, index) => {
            doOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                previousID
            });
            undoOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                previousID: index === 0 ? previousElement.getAttribute("data-node-id") : previousID,
            });
            previousID = item.getAttribute("data-node-id");
            item.setAttribute("data-subtype", subtype);
            const actionElement = item.querySelector(".protyle-action");
            if (subtype === "o") {
                actionElement.classList.add("protyle-action--order");
                actionElement.classList.remove("protyle-action--task");
                previousElement.lastElementChild.previousElementSibling.lastElementChild.before(item);
            } else if (subtype === "t") {
                item.setAttribute("data-marker", "*");
                actionElement.innerHTML = '<svg><use xlink:href="#iconUncheck"></use></svg>';
                actionElement.classList.remove("protyle-action--order");
                actionElement.classList.add("protyle-action--task");
                previousElement.lastElementChild.previousElementSibling.lastElementChild.before(item);
            } else {
                item.setAttribute("data-marker", "*");
                actionElement.innerHTML = '<svg><use xlink:href="#iconDot"></use></svg>';
                actionElement.classList.remove("protyle-action--order", "protyle-action--task");
                previousElement.lastElementChild.previousElementSibling.lastElementChild.before(item);
            }
        });

        if (subtype === "o") {
            updateListOrder(previousElement.lastElementChild.previousElementSibling);
            updateListOrder(previousElement.parentElement);
        } else if (previousElement.getAttribute("data-subtype") === "o") {
            updateListOrder(previousElement.parentElement);
        }

        if (previousElement.parentElement.classList.contains("protyle-wysiwyg")) {
            doOperations.push({
                action: "update",
                data: previousElement.lastElementChild.previousElementSibling.outerHTML,
                id: previousElement.lastElementChild.previousElementSibling.getAttribute("data-node-id")
            });
            undoOperations.push({
                action: "update",
                data: previousLastListHTML,
                id: previousElement.lastElementChild.previousElementSibling.getAttribute("data-node-id")
            });
            transaction(protyle, doOperations, undoOperations);
        }
    } else {
        const previousHTML = previousElement.outerHTML;
        const subType = liItemElements[0].getAttribute("data-subtype");
        const newListElement = document.createElement("div");
        const newListId = Lute.NewNodeID();
        newListElement.setAttribute("data-node-id", newListId);
        newListElement.setAttribute("data-type", "NodeList");
        newListElement.setAttribute("class", "list");
        newListElement.setAttribute("data-subtype", subType);
        newListElement.innerHTML = '<div class="protyle-attr" contenteditable="false"></div>';
        const doOperations: IOperation[] = [{
            action: "insert",
            data: newListElement.outerHTML,
            id: newListId,
            previousID: previousElement.lastElementChild.previousElementSibling.getAttribute("data-node-id")
        }];
        previousElement.lastElementChild.before(newListElement);
        const undoOperations: IOperation[] = [];
        let previousID: string;
        liItemElements.forEach((item, index) => {
            doOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                parentID: newListId,
                previousID
            });
            undoOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                previousID: index === 0 ? previousElement.getAttribute("data-node-id") : previousID,
            });
            previousID = item.getAttribute("data-node-id");
            newListElement.lastElementChild.before(item);
        });
        undoOperations.push({
            action: "delete",
            id: newListId
        });
        if (subType === "o") {
            updateListOrder(newListElement, 1);
            updateListOrder(previousElement.parentElement);
        }
        if (previousElement.parentElement.classList.contains("protyle-wysiwyg")) {
            doOperations.push({
                action: "update",
                data: previousElement.outerHTML,
                id: previousElement.getAttribute("data-node-id")
            });
            undoOperations.push({
                action: "update",
                data: previousHTML,
                id: previousElement.getAttribute("data-node-id")
            });
            transaction(protyle, doOperations, undoOperations);
        }
    }
    if (!previousElement.parentElement.classList.contains("protyle-wysiwyg")) {
        updateTransaction(protyle, previousElement.parentElement.getAttribute("data-node-id"), previousElement.parentElement.outerHTML, html);
    }
    focusByWbr(previousElement, range);
};

export const breakList = (protyle: IProtyle, blockElement: Element, range: Range) => {
    const listItemElement = blockElement.parentElement;
    const listItemId = listItemElement.getAttribute("data-node-id");
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];

    range.insertNode(document.createElement("wbr"));
    const newListId = Lute.NewNodeID();
    let newListHTML = "";
    let hasFind = 0;
    Array.from(listItemElement.parentElement.children).forEach(item => {
        if (!hasFind && item.isSameNode(listItemElement)) {
            hasFind = 1;
        } else if (hasFind && !item.classList.contains("protyle-attr")) {
            undoOperations.push({
                id: item.getAttribute("data-node-id"),
                action: "move",
                previousID: listItemId,
            });
            doOperations.push({
                id: item.getAttribute("data-node-id"),
                action: "delete",
            });
            if (item.getAttribute("data-subtype") === "o") {
                undoOperations.push({
                    id: item.getAttribute("data-node-id"),
                    action: "update",
                    data: item.outerHTML,
                });
                item.setAttribute("data-marker", hasFind + ".");
                item.firstElementChild.innerHTML = hasFind + ".";
            }
            newListHTML += item.outerHTML;
            item.remove();
            hasFind++;
        }
    });
    undoOperations.reverse();
    newListHTML = `<div data-subtype="${listItemElement.getAttribute("data-subtype")}" data-node-id="${newListId}" data-type="NodeList" class="list" updated="${dayjs().format("YYYYMMDDHHmmss")}">${newListHTML}<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
    listItemElement.parentElement.insertAdjacentHTML("afterend", newListHTML);
    doOperations.push({
        id: newListId,
        action: "insert",
        previousID: listItemElement.parentElement.getAttribute("data-node-id"),
        data: newListHTML
    });
    undoOperations.push({
        id: newListId,
        action: "delete"
    });

    Array.from(listItemElement.children).reverse().forEach((item) => {
        if (!item.classList.contains("protyle-action") && !item.classList.contains("protyle-attr")) {
            doOperations.push({
                id: item.getAttribute("data-node-id"),
                action: "move",
                previousID: listItemElement.parentElement.getAttribute("data-node-id")
            });
            undoOperations.push({
                id: item.getAttribute("data-node-id"),
                action: "move",
                parentID: listItemId
            });
            listItemElement.parentElement.after(item);
        }
    });

    const parentId = listItemElement.parentElement.getAttribute("data-node-id");
    if (listItemElement.parentElement.childElementCount === 2) {
        undoOperations.splice(0, 0, {
            id: parentId,
            action: "insert",
            data: listItemElement.parentElement.outerHTML,
            previousID: listItemElement.parentElement.previousElementSibling?.getAttribute("data-node-id"),
            parentID: listItemElement.parentElement.parentElement.getAttribute("data-node-id") || protyle.block.rootID
        });
        listItemElement.parentElement.remove();
        doOperations.push({
            id: parentId,
            action: "delete",
        });
    } else {
        undoOperations.splice(0, 0, {
            id: listItemId,
            action: "insert",
            data: listItemElement.outerHTML,
            previousID: listItemElement.previousElementSibling?.getAttribute("data-node-id"),
            parentID: parentId
        });
        listItemElement.remove();
        doOperations.push({
            id: listItemId,
            action: "delete",
        });
    }

    transaction(protyle, doOperations, undoOperations);
    focusByWbr(protyle.wysiwyg.element, range);
};

export const listOutdent = (protyle: IProtyle, liItemElements: Element[], range: Range) => {
    const liElement = liItemElements[0].parentElement;
    const liId = liElement.getAttribute("data-node-id");
    if (!liId) {
        // zoom in 列表项
        return;
    }
    const parentLiItemElement = liElement.parentElement;
    const parentParentElement = parentLiItemElement.parentElement;
    if (liElement.previousElementSibling?.classList.contains("protyle-action") && !parentParentElement.getAttribute("data-node-id")) {
        // https://ld246.com/article/1691981936960 情况下 zoom in 列表项
        return;
    }
    if (parentLiItemElement.classList.contains("protyle-wysiwyg") || parentLiItemElement.classList.contains("sb") || parentLiItemElement.classList.contains("bq")) {
        // 顶层列表
        const doOperations: IOperation[] = [];
        const undoOperations: IOperation[] = [];
        range.collapse(false);
        range.insertNode(document.createElement("wbr"));
        let startIndex;
        if (!liItemElements[0].previousElementSibling && liElement.getAttribute("data-subtype") === "o") {
            startIndex = parseInt(liItemElements[0].getAttribute("data-marker"));
        }
        let previousID = liId;
        let previousElement: Element = liElement;
        let nextElement = liItemElements[liItemElements.length - 1].nextElementSibling;
        let lastBlockElement = liItemElements[liItemElements.length - 1].lastElementChild.previousElementSibling;
        liItemElements.forEach(item => {
            item.classList.remove("protyle-wysiwyg--select");
            item.removeAttribute("select-start");
            item.removeAttribute("select-end");
            Array.from(item.children).forEach((blockElement, index) => {
                const id = blockElement.getAttribute("data-node-id");
                if (!id) {
                    return;
                }
                doOperations.push({
                    action: "move",
                    id,
                    previousID,
                    parentID: parentLiItemElement.getAttribute("data-node-id") || protyle.block.parentID
                });
                undoOperations.push({
                    action: "move",
                    id,
                    previousID: index === 1 ? undefined : previousID,
                    parentID: item.getAttribute("data-node-id"),
                    data: blockElement.contains(range.startContainer) ? "focus" : "" // 标记需要 focus，https://ld246.com/article/1650018446988/comment/1650081404993?r=Vanessa#comments
                });
                previousID = id;
                previousElement.after(blockElement);
                previousElement = blockElement;
            });
        });
        if (!window.siyuan.config.editor.listLogicalOutdent && !nextElement.classList.contains("protyle-attr")) {
            // 传统缩进
            let newId;
            if (lastBlockElement.getAttribute("data-subtype") !== nextElement.getAttribute("data-subtype")) {
                newId = Lute.NewNodeID();
                lastBlockElement = document.createElement("div");
                lastBlockElement.classList.add("list");
                lastBlockElement.setAttribute("data-subtype", nextElement.getAttribute("data-subtype"));
                lastBlockElement.setAttribute("data-node-id", newId);
                lastBlockElement.setAttribute("data-type", "NodeList");
                lastBlockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                lastBlockElement.innerHTML = `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
                previousElement.after(lastBlockElement);
                doOperations.push({
                    action: "insert",
                    id: newId,
                    data: lastBlockElement.outerHTML,
                    previousID: previousElement.getAttribute("data-node-id"),
                });
            }
            let previousID;
            while (nextElement && !nextElement.classList.contains("protyle-attr")) {
                doOperations.push({
                    action: "move",
                    id: nextElement.getAttribute("data-node-id"),
                    previousID: previousID || lastBlockElement.lastElementChild.previousElementSibling?.getAttribute("data-node-id"),
                    parentID: lastBlockElement.getAttribute("data-node-id")
                });
                undoOperations.push({
                    action: "move",
                    id: nextElement.getAttribute("data-node-id"),
                    parentID: lastBlockElement.getAttribute("data-node-id"),
                    previousID: previousID || nextElement.previousElementSibling?.getAttribute("data-node-id"),
                });
                previousID = nextElement.getAttribute("data-node-id");
                const tempElement = nextElement;
                nextElement = nextElement.nextElementSibling;
                lastBlockElement.lastElementChild.before(tempElement);
            }
            if (lastBlockElement.getAttribute("data-subtype") === "o") {
                Array.from(lastBlockElement.children).forEach(orderItem => {
                    const id = orderItem.getAttribute("data-node-id");
                    if (id) {
                        undoOperations.push({
                            action: "update",
                            id,
                            data: orderItem.outerHTML,
                        });
                    }
                });
                updateListOrder(lastBlockElement, 1);
                Array.from(lastBlockElement.children).forEach(orderItem => {
                    const id = orderItem.getAttribute("data-node-id");
                    if (id) {
                        doOperations.push({
                            action: "update",
                            id,
                            data: orderItem.outerHTML,
                        });
                    }
                });
            }
            if (newId) {
                undoOperations.push({
                    action: "delete",
                    id: newId
                });
            }
        }
        const movedHTML = liElement.outerHTML;
        liItemElements.forEach(item => {
            item.remove();
        });

        if (liElement.childElementCount === 1) {
            // 列表只有一项
            doOperations.push({
                action: "delete",
                id: liId
            });
            // 聚焦列表，第一个列表项反向缩进后刷新会关闭页签
            if (liId === protyle.block.id) {
                protyle.block.id = protyle.block.parentID;
            }
            undoOperations.splice(0, 0, {
                action: "insert",
                data: movedHTML,
                id: liId,
                previousID: liElement.previousElementSibling?.getAttribute("data-node-id"),
                parentID: parentLiItemElement.getAttribute("data-node-id") || protyle.block.parentID
            });
            liElement.remove();
        } else {
            if (liElement.getAttribute("data-subtype") === "o") {
                updateListOrder(liElement, startIndex);
            }
            doOperations.push({
                action: "update",
                id: liId,
                data: liElement.outerHTML
            });
            undoOperations.splice(0, 0, {
                action: "update",
                id: liId,
                data: movedHTML,
            });
        }
        transaction(protyle, doOperations, undoOperations);
        focusByWbr(parentLiItemElement, range);
        return;
    }

    if (liElement.childElementCount === 2 && parentLiItemElement.childElementCount === 3) {
        // 列表项里仅有包含一个列表项的列表，如 1. 1. 1 https://github.com/siyuan-note/insider/issues/494
        range.collapse(false);
        range.insertNode(document.createElement("wbr"));
        const html = parentLiItemElement.outerHTML;
        liItemElements[0].firstElementChild.remove();
        liItemElements[0].lastElementChild.remove();
        liElement.outerHTML = liItemElements[0].innerHTML;
        updateTransaction(protyle, parentLiItemElement.getAttribute("data-node-id"), parentLiItemElement.outerHTML, html);
        focusByWbr(parentLiItemElement, range);
        return;
    }

    range.collapse(false);
    range.insertNode(document.createElement("wbr"));
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const previousID = liItemElements[0].previousElementSibling?.getAttribute("data-node-id");
    liItemElements.forEach(item => {
        item.classList.remove("protyle-wysiwyg--select");
        item.removeAttribute("select-start");
        item.removeAttribute("select-end");
    });
    let startIndex;
    if (!liItemElements[0].previousElementSibling && liElement.getAttribute("data-subtype") === "o") {
        startIndex = parseInt(liItemElements[0].getAttribute("data-marker"));
    }
    const html = parentLiItemElement.parentElement.outerHTML;
    let nextElement = liItemElements[liItemElements.length - 1].nextElementSibling;
    let lastBlockElement = liItemElements[liItemElements.length - 1].lastElementChild.previousElementSibling;
    liItemElements.reverse().forEach(item => {
        const itemId = item.getAttribute("data-node-id");
        doOperations.push({
            action: "move",
            id: itemId,
            previousID: parentLiItemElement.getAttribute("data-node-id")
        });
        undoOperations.push({
            action: "move",
            id: itemId,
            previousID,
            parentID: liElement.getAttribute("data-node-id")
        });
        parentLiItemElement.after(item);
        if ((item.getAttribute("data-subtype") === "o" || item.getAttribute("data-subtype") === "t") &&
            parentLiItemElement.getAttribute("data-subtype") === "u") {
            undoOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
            item.querySelector(".protyle-action").outerHTML = '<div class="protyle-action" draggable="true"><svg><use xlink:href="#iconDot"></use></svg></div>';
            item.setAttribute("data-subtype", "u");
            item.setAttribute("data-marker", "*");
            doOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
        } else if ((item.getAttribute("data-subtype") === "u" || item.getAttribute("data-subtype") === "t") &&
            parentLiItemElement.getAttribute("data-subtype") === "o") {
            undoOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
            item.querySelector(".protyle-action").outerHTML = '<div contenteditable="false" draggable="true" class="protyle-action protyle-action--order">1.</div>';
            item.setAttribute("data-subtype", "o");
            item.setAttribute("data-marker", "1.");
            doOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
        } else if ((item.getAttribute("data-subtype") === "u" || item.getAttribute("data-subtype") === "0") &&
            parentLiItemElement.getAttribute("data-subtype") === "t") {
            undoOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
            item.querySelector(".protyle-action").outerHTML = '<div class="protyle-action protyle-action--task" draggable="true"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
            item.setAttribute("data-subtype", "t");
            item.setAttribute("data-marker", "*");
            doOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
        }
    });
    if (!window.siyuan.config.editor.listLogicalOutdent && !nextElement.classList.contains("protyle-attr")) {
        // 传统缩进
        let newId;
        if (!lastBlockElement.classList.contains("list")) {
            newId = Lute.NewNodeID();
            lastBlockElement = document.createElement("div");
            lastBlockElement.classList.add("list");
            lastBlockElement.setAttribute("data-subtype", nextElement.getAttribute("data-subtype"));
            lastBlockElement.setAttribute("data-node-id", newId);
            lastBlockElement.setAttribute("data-type", "NodeList");
            lastBlockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            lastBlockElement.innerHTML = `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
            doOperations.push({
                action: "insert",
                id: newId,
                data: lastBlockElement.outerHTML,
                previousID: liItemElements[0].lastElementChild.previousElementSibling.getAttribute("data-node-id"),
            });
            liItemElements[0].lastElementChild.before(lastBlockElement);
        }
        let previousID;
        while (nextElement && !nextElement.classList.contains("protyle-attr")) {
            const nextId = nextElement.getAttribute("data-node-id");
            if (nextElement.getAttribute("data-subtype") !== lastBlockElement.getAttribute("data-subtype")) {
                undoOperations.push({
                    action: "update",
                    id: nextId,
                    data: nextElement.outerHTML
                });
                nextElement.querySelector(".protyle-action").outerHTML = lastBlockElement.querySelector(".protyle-action").outerHTML;
                nextElement.setAttribute("data-subtype", lastBlockElement.getAttribute("data-subtype"));
                nextElement.setAttribute("data-marker", lastBlockElement.getAttribute("data-marker"));
                doOperations.push({
                    action: "update",
                    id: nextId,
                    data: nextElement.outerHTML
                });
            }
            doOperations.push({
                action: "move",
                id: nextId,
                previousID: previousID || lastBlockElement.lastElementChild.previousElementSibling?.getAttribute("data-node-id"),
                parentID: lastBlockElement.getAttribute("data-node-id")
            });
            undoOperations.push({
                action: "move",
                id: nextId,
                previousID: previousID || lastBlockElement.parentElement?.getAttribute("data-node-id"),
            });
            previousID = nextId;
            const tempElement = nextElement;
            nextElement = nextElement.nextElementSibling;
            lastBlockElement.lastElementChild.before(tempElement);
        }
        if (lastBlockElement.getAttribute("data-subtype") === "o") {
            Array.from(lastBlockElement.children).forEach(orderItem => {
                const id = orderItem.getAttribute("data-node-id");
                if (id) {
                    undoOperations.push({
                        action: "update",
                        id,
                        data: orderItem.outerHTML,
                    });
                }
            });
            updateListOrder(lastBlockElement, 1);
            Array.from(lastBlockElement.children).forEach(orderItem => {
                const id = orderItem.getAttribute("data-node-id");
                if (id) {
                    doOperations.push({
                        action: "update",
                        id,
                        data: orderItem.outerHTML,
                    });
                }
            });
        }
        if (newId) {
            undoOperations.push({
                action: "delete",
                id: newId
            });
        }
    }
    if (liElement.childElementCount === 1 && parentLiItemElement.childElementCount === 3) {
        // https://ld246.com/article/1691981936960
        doOperations.push({
            action: "delete",
            id: parentLiItemElement.getAttribute("data-node-id")
        });
        undoOperations.splice(0, 0, {
            action: "insert",
            id: parentLiItemElement.getAttribute("data-node-id"),
            data: parentLiItemElement.outerHTML,
            previousID: parentLiItemElement.previousElementSibling.getAttribute("data-node-id")
        });
        parentLiItemElement.remove();
    } else if (liElement.childElementCount === 1) {
        doOperations.push({
            action: "delete",
            id: liElement.getAttribute("data-node-id")
        });
        undoOperations.splice(0, 0, {
            action: "insert",
            id: liElement.getAttribute("data-node-id"),
            data: liElement.outerHTML,
            previousID: liElement.previousElementSibling.getAttribute("data-node-id")
        });
        liElement.remove();
    } else if (liElement.getAttribute("data-subtype") === "o") {
        undoOperations.splice(0, 0, {
            action: "update",
            data: liElement.outerHTML,
            id: liElement.getAttribute("data-node-id"),
        });
        updateListOrder(liElement, startIndex);
        doOperations.push({
            action: "update",
            data: liElement.outerHTML,
            id: liElement.getAttribute("data-node-id"),
        });
    }
    if (parentParentElement.classList.contains("protyle-wysiwyg")) {
        transaction(protyle, doOperations, undoOperations);
    } else {
        if (parentLiItemElement && parentLiItemElement.getAttribute("data-subtype") === "o") {
            updateListOrder(parentParentElement);
        }
        updateTransaction(protyle, parentParentElement.getAttribute("data-node-id"), parentParentElement.outerHTML, html);
    }
    focusByWbr(parentParentElement, range);
};
