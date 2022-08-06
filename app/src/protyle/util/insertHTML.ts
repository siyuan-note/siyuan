import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName, hasClosestByMatchTag} from "./hasClosest";
import * as dayjs from "dayjs";
import {removeEmbed} from "../wysiwyg/removeEmbed";
import {transaction, updateTransaction} from "../wysiwyg/transaction";
import {getContenteditableElement} from "../wysiwyg/getBlock";
import {focusBlock, getEditorRange, focusByWbr} from "./selection";
import {mathRender} from "../markdown/mathRender";
import {Constants} from "../../constants";

export const insertHTML = (html: string, protyle: IProtyle, isBlock = false) => {
    if (html === "") {
        return;
    }
    const range = getEditorRange(protyle.wysiwyg.element);
    // table 选中处理 https://ld246.com/article/1624269001599
    const tableElement = hasClosestByAttribute(range.startContainer, "data-type", "NodeTable");
    if (range.toString() !== "" && tableElement && range.commonAncestorContainer.nodeType !== 3) {
        const parentTag = (range.commonAncestorContainer as Element).tagName;
        if (parentTag !== "TH" && parentTag !== "TD") {
            let cellElement = hasClosestByMatchTag(range.startContainer, "TD") || hasClosestByMatchTag(range.startContainer, "TH");
            if (!cellElement) {
                cellElement = tableElement.querySelector("th") || tableElement.querySelector("td");
                range.setStartBefore(cellElement.firstChild);
            }
            if (cellElement.lastChild) {
                range.setEndAfter(cellElement.lastChild);
            } else {
                range.collapse(true);
            }
        }
    }
    if (tableElement) {
        html = protyle.lute.BlockDOM2InlineBlockDOM(html);
    }
    let blockElement = hasClosestBlock(range.startContainer) as Element;
    if (!blockElement) {
        // 使用鼠标点击选则模版提示列表后 range 丢失
        if (protyle.toolbar.range) {
            blockElement = hasClosestBlock(protyle.toolbar.range.startContainer) as Element;
        } else {
            blockElement = protyle.wysiwyg.element.firstElementChild as Element;
        }
    }
    if (!blockElement) {
        return;
    }
    let id = blockElement.getAttribute("data-node-id");
    range.insertNode(document.createElement("wbr"));
    let oldHTML = blockElement.outerHTML;
    const undoOperation: IOperation[] = [];
    const doOperation: IOperation[] = [];
    if (range.toString() !== "") {
        const inlineMathElement = hasClosestByAttribute(range.commonAncestorContainer, "data-type", "inline-math");
        if (inlineMathElement) {
            // 表格内选中数学公式 https://ld246.com/article/1631708573504
            inlineMathElement.remove();
        } else if (range.startContainer.nodeType === 3 && range.startContainer.parentElement.getAttribute("data-type") === "block-ref") {
            // ref 选中处理 https://ld246.com/article/1629214377537
            range.startContainer.parentElement.remove();
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
    tempElement.innerHTML = html;
    const editableElement = getContenteditableElement(blockElement);
    let render = false;
    // 使用 lute 方法会添加 p 元素，只有一个 p 元素或者只有一个字符串或者为 <u>b</u> 时的时候只拷贝内部
    if (!isBlock) {
        if (tempElement.content.firstChild.nodeType === 3 ||
            (tempElement.content.firstChild.nodeType !== 3 &&
                ((tempElement.content.firstElementChild.classList.contains("p") && tempElement.content.childElementCount === 1) ||
                    tempElement.content.firstElementChild.tagName !== "DIV"))) {
            if (tempElement.content.firstChild.nodeType !== 3 && tempElement.content.firstElementChild.classList.contains("p")) {
                tempElement.innerHTML = tempElement.content.firstElementChild.firstElementChild.innerHTML.trim();
            }
            range.insertNode(tempElement.content.cloneNode(true));
            range.collapse(false);
            blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            // 使用 innerHTML,避免行内元素为代码块
            const trimStartText = editableElement ? editableElement.innerHTML.trimStart() : "";
            if (editableElement && (trimStartText.startsWith("```") || trimStartText.startsWith("~~~") || trimStartText.startsWith("···") ||
                trimStartText.indexOf("\n```") > -1 || trimStartText.indexOf("\n~~~") > -1 || trimStartText.indexOf("\n···") > -1)) {
                if (trimStartText.indexOf("\n") === -1 && trimStartText.replace(/·|~/g, "`").replace(/^`{3,}/g, "").indexOf("`") > -1) {
                    // ```test` 不处理
                } else {
                    let replaceInnerHTML = editableElement.innerHTML.replace(/^(~|·|`){3,}/g, "```").replace(/\n(~|·|`){3,}/g, "\n```").trim();
                    if (!replaceInnerHTML.endsWith("\n```")) {
                        replaceInnerHTML += "\n```";
                    }
                    const languageIndex = replaceInnerHTML.indexOf("```") + 3;
                    replaceInnerHTML = replaceInnerHTML.substring(0, languageIndex) + (window.localStorage["local-codelang"] || "") + replaceInnerHTML.substring(languageIndex);

                    editableElement.innerHTML = replaceInnerHTML;
                }
            }
            const spinHTML = protyle.lute.SpinBlockDOM(removeEmbed(blockElement));
            const scrollLeft = blockElement.firstElementChild.scrollLeft;
            blockElement.outerHTML = spinHTML;
            render = true;
            // spin 后变成多个块需后续处理 https://github.com/siyuan-note/insider/issues/451
            tempElement.innerHTML = spinHTML;
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${id}"]`)).find((item) => {
                if (!hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed")) {
                    blockElement = item;
                    return true;
                }
            });
            if (tempElement.content.childElementCount === 1) {
                if (blockElement.classList.contains("table") && scrollLeft > 0) {
                    blockElement.firstElementChild.scrollLeft = scrollLeft;
                }
                mathRender(blockElement);
                updateTransaction(protyle, id, blockElement.outerHTML, oldHTML);
                focusByWbr(protyle.wysiwyg.element, range);
                return;
            }
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
    Array.from(tempElement.content.children).reverse().forEach(item => {
        const addId = item.getAttribute("data-node-id");
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
            doOperation.push({
                action: "insert",
                data: item.outerHTML,
                id: addId,
                previousID: id
            });
            undoOperation.push({
                action: "delete",
                id: addId,
            });
        }
        if (!render) {
            blockElement.after(item);
        }
    });
    if (editableElement && editableElement.textContent === "") {
        doOperation.push({
            action: "delete",
            id
        });
        undoOperation.push({
            action: "insert",
            data: oldHTML,
            id,
            previousID: blockElement.previousElementSibling ? blockElement.previousElementSibling.getAttribute("data-node-id") : "",
            parentID: blockElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
        });
        const nextElement = blockElement.nextElementSibling;
        blockElement.remove();
        focusBlock(nextElement, undefined, false);
    } else {
        focusByWbr(protyle.wysiwyg.element, range);
    }
    transaction(protyle, doOperation, undoOperation);
};
