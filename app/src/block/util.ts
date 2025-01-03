import {focusByWbr, getEditorRange} from "../protyle/util/selection";
import {hasClosestBlock} from "../protyle/util/hasClosest";
import {getTopAloneElement} from "../protyle/wysiwyg/getBlock";
import {genListItemElement, updateListOrder} from "../protyle/wysiwyg/list";
import {transaction, turnsIntoOneTransaction, updateTransaction} from "../protyle/wysiwyg/transaction";
import {scrollCenter} from "../util/highlightById";
import {Constants} from "../constants";
import {hideElements} from "../protyle/ui/hideElements";
import {blockRender} from "../protyle/render/blockRender";
import {fetchPost} from "../util/fetch";
import {openFileById} from "../editor/util";
import {openMobileFileById} from "../mobile/editor";

export const cancelSB = (protyle: IProtyle, nodeElement: Element) => {
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    let previousId = nodeElement.previousElementSibling ? nodeElement.previousElementSibling.getAttribute("data-node-id") : undefined;
    nodeElement.classList.remove("protyle-wysiwyg--select");
    nodeElement.removeAttribute("select-start");
    nodeElement.removeAttribute("select-end");
    const id = nodeElement.getAttribute("data-node-id");
    const sbElement = nodeElement.cloneNode() as HTMLElement;
    sbElement.innerHTML = nodeElement.lastElementChild.outerHTML;
    undoOperations.push({
        action: "insert",
        id,
        data: sbElement.outerHTML,
        previousID: nodeElement.previousElementSibling ? nodeElement.previousElementSibling.getAttribute("data-node-id") : undefined,
        parentID: nodeElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
    });
    Array.from(nodeElement.children).forEach((item, index) => {
        if (index === nodeElement.childElementCount - 1) {
            doOperations.push({
                action: "delete",
                id,
            });
            nodeElement.lastElementChild.remove();
            // 超级块中的 html 块需要反转义再赋值 https://github.com/siyuan-note/siyuan/issues/13155
            nodeElement.querySelectorAll("protyle-html").forEach(item => {
                item.setAttribute("data-content", item.getAttribute("data-content").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
            });
            nodeElement.outerHTML = nodeElement.innerHTML;
            return;
        }
        doOperations.push({
            action: "move",
            id: item.getAttribute("data-node-id"),
            previousID: previousId,
            parentID: nodeElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
        });
        undoOperations.push({
            action: "move",
            id: item.getAttribute("data-node-id"),
            previousID: item.previousElementSibling ? item.previousElementSibling.getAttribute("data-node-id") : undefined,
            parentID: id
        });
        previousId = item.getAttribute("data-node-id");
    });
    // 超级块内嵌入块无面包屑，需重新渲染 https://github.com/siyuan-note/siyuan/issues/7574
    doOperations.forEach(item => {
        const element = protyle.wysiwyg.element.querySelector(`[data-node-id="${item.id}"]`);
        if (element && element.getAttribute("data-type") === "NodeBlockQueryEmbed") {
            element.removeAttribute("data-render");
            blockRender(protyle, element);
        }
    });
    return {
        doOperations, undoOperations, previousId
    };
};

export const genSBElement = (layout: string, id?: string, attrHTML?: string) => {
    const sbElement = document.createElement("div");
    sbElement.setAttribute("data-node-id", id || Lute.NewNodeID());
    sbElement.setAttribute("data-type", "NodeSuperBlock");
    sbElement.setAttribute("class", "sb");
    sbElement.setAttribute("data-sb-layout", layout);
    sbElement.innerHTML = attrHTML || `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
    return sbElement;
};

export const jumpToParent = (protyle: IProtyle, nodeElement: Element, type: "parent" | "next" | "previous") => {
    fetchPost("/api/block/getBlockSiblingID", {id: nodeElement.getAttribute("data-node-id")}, (response) => {
        const targetId = response.data[type];
        if (!targetId) {
            return;
        }
        /// #if !MOBILE
        openFileById({
            app: protyle.app,
            id: targetId,
            action: targetId !== protyle.block.rootID && protyle.block.showAll ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS]
        });
        /// #else
        openMobileFileById(protyle.app, targetId, targetId !== protyle.block.rootID && protyle.block.showAll ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS]);
        /// #endif
    });
};

export const insertEmptyBlock = (protyle: IProtyle, position: InsertPosition, id?: string) => {
    const range = getEditorRange(protyle.wysiwyg.element);
    let blockElement: Element;
    if (id) {
        blockElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
    } else {
        const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
        if (selectElements.length > 0) {
            if (position === "beforebegin") {
                blockElement = selectElements[0];
            } else {
                blockElement = selectElements[selectElements.length - 1];
            }
            hideElements(["select"], protyle);
        } else {
            blockElement = hasClosestBlock(range.startContainer) as HTMLElement;
            blockElement = getTopAloneElement(blockElement);
        }
    }
    if (!blockElement) {
        return;
    }
    let newElement = genEmptyElement(false, true);
    let orderIndex = 1;
    if (blockElement.getAttribute("data-type") === "NodeListItem") {
        newElement = genListItemElement(blockElement, 0, true) as HTMLDivElement;
        orderIndex = parseInt(blockElement.parentElement.firstElementChild.getAttribute("data-marker"));
    }
    const parentOldHTML = blockElement.parentElement.outerHTML;
    const newId = newElement.getAttribute("data-node-id");
    blockElement.insertAdjacentElement(position, newElement);
    if (blockElement.getAttribute("data-type") === "NodeListItem" && blockElement.getAttribute("data-subtype") === "o" &&
        !newElement.parentElement.classList.contains("protyle-wysiwyg")) {
        updateListOrder(newElement.parentElement, orderIndex);
        updateTransaction(protyle, newElement.parentElement.getAttribute("data-node-id"), newElement.parentElement.outerHTML, parentOldHTML);
    } else {
        let doOperations: IOperation[];
        if (position === "beforebegin") {
            doOperations = [{
                action: "insert",
                data: newElement.outerHTML,
                id: newId,
                nextID: blockElement.getAttribute("data-node-id"),
            }];
        } else {
            doOperations = [{
                action: "insert",
                data: newElement.outerHTML,
                id: newId,
                previousID: blockElement.getAttribute("data-node-id"),
            }];
        }
        transaction(protyle, doOperations, [{
            action: "delete",
            id: newId,
        }]);
    }
    if (blockElement.parentElement.classList.contains("sb") &&
        blockElement.parentElement.getAttribute("data-sb-layout") === "col") {
        turnsIntoOneTransaction({
            protyle,
            selectsElement: position === "afterend" ? [blockElement, blockElement.nextElementSibling] : [blockElement.previousElementSibling, blockElement],
            type: "BlocksMergeSuperBlock",
            level: "row"
        });
    }
    focusByWbr(protyle.wysiwyg.element, range);
    scrollCenter(protyle);
};

export const genEmptyBlock = (zwsp = true, wbr = true, string?: string) => {
    let html = "";
    if (zwsp) {
        html = Constants.ZWSP;
    }
    if (wbr) {
        html += "<wbr>";
    }
    if (string) {
        html += string;
    }
    return `<div data-node-id="${Lute.NewNodeID()}" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}">${html}</div><div contenteditable="false" class="protyle-attr">${Constants.ZWSP}</div></div>`;
};

export const genEmptyElement = (zwsp = true, wbr = true, id?: string) => {
    const element = document.createElement("div");
    element.setAttribute("data-node-id", id || Lute.NewNodeID());
    element.setAttribute("data-type", "NodeParagraph");
    element.classList.add("p");
    element.innerHTML = `<div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}">${zwsp ? Constants.ZWSP : ""}${wbr ? "<wbr>" : ""}</div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
    return element;
};

export const getLangByType = (type: string) => {
    let lang = type;
    switch (type) {
        case "NodeIFrame":
            lang = "IFrame";
            break;
        case "NodeAttributeView":
            lang = window.siyuan.languages.database;
            break;
        case "NodeThematicBreak":
            lang = window.siyuan.languages.line;
            break;
        case "NodeWidget":
            lang = window.siyuan.languages.widget;
            break;
        case "NodeVideo":
            lang = window.siyuan.languages.video;
            break;
        case "NodeAudio":
            lang = window.siyuan.languages.audio;
            break;
        case "NodeBlockQueryEmbed":
            lang = window.siyuan.languages.blockEmbed;
            break;
    }
    return lang;
};
