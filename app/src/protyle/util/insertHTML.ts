import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "./hasClosest";
import * as dayjs from "dayjs";
import {transaction, updateTransaction} from "../wysiwyg/transaction";
import {getContenteditableElement, hasNextSibling, hasPreviousSibling} from "../wysiwyg/getBlock";
import {fixTableRange, focusBlock, focusByWbr, getEditorRange} from "./selection";
import {mathRender} from "../render/mathRender";
import {Constants} from "../../constants";
import {highlightRender} from "../render/highlightRender";
import {scrollCenter} from "../../util/highlightById";
import {updateAVName} from "../render/av/action";
import {readText} from "./compatibility";

export const insertHTML = (html: string, protyle: IProtyle, isBlock = false,
                           // 移动端插入嵌入块时，获取到的 range 为旧值
                           useProtyleRange = false) => {
    if (html === "") {
        return;
    }
    const range = useProtyleRange ? protyle.toolbar.range : getEditorRange(protyle.wysiwyg.element);
    fixTableRange(range);
    let tableInlineHTML;
    if (hasClosestByAttribute(range.startContainer, "data-type", "NodeTable") && !isBlock) {
        tableInlineHTML = protyle.lute.BlockDOM2InlineBlockDOM(html);
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
    if (blockElement.classList.contains("av")) {
        range.deleteContents();
        const text = readText();
        if (typeof text === "string") {
            range.insertNode(document.createTextNode(text));
            range.collapse(false);
            updateAVName(protyle, blockElement);
        } else {
            text.then((t) => {
                range.insertNode(document.createTextNode(t));
                range.collapse(false);
                updateAVName(protyle, blockElement);
            });
        }
        return;
    }
    let id = blockElement.getAttribute("data-node-id");
    range.insertNode(document.createElement("wbr"));
    let oldHTML = blockElement.outerHTML;
    const isNodeCodeBlock = blockElement.getAttribute("data-type") === "NodeCodeBlock";
    if (!isBlock &&
        (isNodeCodeBlock || protyle.toolbar.getCurrentType(range).includes("code"))) {
        range.deleteContents();
        range.insertNode(document.createTextNode(html.replace(/\r\n|\r|\u2028|\u2029/g, "\n")));
        range.collapse(false);
        range.insertNode(document.createElement("wbr"));
        if (isNodeCodeBlock) {
            getContenteditableElement(blockElement).removeAttribute("data-render");
            highlightRender(blockElement);
        } else {
            focusByWbr(blockElement, range);
        }
        blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(protyle, id, blockElement.outerHTML, oldHTML);
        setTimeout(() => {
            scrollCenter(protyle, blockElement, false, "smooth");
        }, Constants.TIMEOUT_LOAD);
        return;
    }

    const undoOperation: IOperation[] = [];
    const doOperation: IOperation[] = [];
    if (range.toString() !== "") {
        const inlineMathElement = hasClosestByAttribute(range.commonAncestorContainer, "data-type", "inline-math");
        if (inlineMathElement) {
            // 表格内选中数学公式 https://ld246.com/article/1631708573504
            inlineMathElement.remove();
        } else if (range.startContainer.nodeType === 3 && range.startContainer.parentElement.getAttribute("data-type")?.indexOf("block-ref") > -1) {
            // ref 选中处理 https://ld246.com/article/1629214377537
            range.startContainer.parentElement.remove();
            // 选中 ref**bbb** 后 alt+[
            range.deleteContents();
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
    // 需要再 spin 一次 https://github.com/siyuan-note/siyuan/issues/7118
    tempElement.innerHTML = tableInlineHTML // 在 table 中插入需要使用转换好的行内元素 https://github.com/siyuan-note/siyuan/issues/9358
        || protyle.lute.SpinBlockDOM(html) ||
        html;   // 空格会被 Spin 不再，需要使用原文
    const editableElement = getContenteditableElement(blockElement);
    // 使用 lute 方法会添加 p 元素，只有一个 p 元素或者只有一个字符串或者为 <u>b</u> 时的时候只拷贝内部
    if (!isBlock) {
        if (tempElement.content.firstChild.nodeType === 3 ||
            (tempElement.content.firstChild.nodeType !== 3 &&
                ((tempElement.content.firstElementChild.classList.contains("p") && tempElement.content.childElementCount === 1) ||
                    tempElement.content.firstElementChild.tagName !== "DIV"))) {
            if (tempElement.content.firstChild.nodeType !== 3 && tempElement.content.firstElementChild.classList.contains("p")) {
                tempElement.innerHTML = tempElement.content.firstElementChild.firstElementChild.innerHTML.trim();
            }
            // 粘贴带样式的行内元素到另一个行内元素中需进行切割
            const spanElement = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer as HTMLElement;
            if (spanElement.tagName === "SPAN" && spanElement.isSameNode(range.endContainer.nodeType === 3 ? range.endContainer.parentElement : range.endContainer) &&
                // 粘贴纯文本不需切割 https://ld246.com/article/1665556907936
                // emoji 图片需要切割 https://github.com/siyuan-note/siyuan/issues/9370
                tempElement.content.querySelector("span, img")
            ) {
                const afterElement = document.createElement("span");
                const attributes = spanElement.attributes;
                for (let i = 0; i < attributes.length; i++) {
                    afterElement.setAttribute(attributes[i].name, attributes[i].value);
                }
                range.setEnd(spanElement.lastChild, spanElement.lastChild.textContent.length);
                afterElement.append(range.extractContents());
                spanElement.after(afterElement);
                range.setStartBefore(afterElement);
                range.collapse(true);
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
                    replaceInnerHTML = replaceInnerHTML.substring(0, languageIndex) + (localStorage["local-codelang"] || "") + replaceInnerHTML.substring(languageIndex);

                    editableElement.innerHTML = replaceInnerHTML;
                }
            }
            const editWbrElement = editableElement.querySelector("wbr");
            if (editWbrElement && editableElement && !trimStartText.endsWith("\n")) {
                // 数学公式后无换行，后期渲染后添加导致 rang 错误，中文输入错误 https://github.com/siyuan-note/siyuan/issues/9054
                const previousElement = hasPreviousSibling(editWbrElement) as HTMLElement;
                if (previousElement && previousElement.nodeType !== 3 && (previousElement.dataset.type || "").indexOf("inline-math") > -1 &&
                    !hasNextSibling(editWbrElement)) {
                    editWbrElement.insertAdjacentText("afterend", "\n");
                }
            }
            mathRender(blockElement);
            updateTransaction(protyle, id, blockElement.outerHTML, oldHTML);
            focusByWbr(protyle.wysiwyg.element, range);
            return;
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
    let lastElement: Element;
    Array.from(tempElement.content.children).reverse().forEach((item) => {
        let addId = item.getAttribute("data-node-id");
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
            if (item.classList.contains("li") && !blockElement.parentElement.classList.contains("list")) {
                // https://github.com/siyuan-note/siyuan/issues/6534
                addId = Lute.NewNodeID();
                const liElement = document.createElement("div");
                liElement.setAttribute("data-subtype", item.getAttribute("data-subtype"));
                liElement.setAttribute("data-node-id", addId);
                liElement.setAttribute("data-type", "NodeList");
                liElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                liElement.classList.add("list");
                liElement.append(item);
                item = liElement;
            }
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
        blockElement.after(item);
        if (!lastElement) {
            lastElement = item;
        }
    });
    if (editableElement && editableElement.textContent === "" && blockElement.classList.contains("p")) {
        // 选中当前块所有内容粘贴再撤销会导致异常 https://ld246.com/article/1662542137636
        doOperation.find((item, index) => {
            if (item.id === id) {
                doOperation.splice(index, 1);
                return true;
            }
        });
        doOperation.push({
            action: "delete",
            id
        });
        // 选中当前块所有内容粘贴再撤销会导致异常 https://ld246.com/article/1662542137636
        undoOperation.find((item, index) => {
            if (item.id === id && item.action === "update") {
                undoOperation.splice(index, 1);
                return true;
            }
        });
        undoOperation.push({
            action: "insert",
            data: oldHTML,
            id,
            previousID: blockElement.previousElementSibling ? blockElement.previousElementSibling.getAttribute("data-node-id") : "",
            parentID: blockElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
        });
        blockElement.remove();
    }
    if (lastElement) {
        // https://github.com/siyuan-note/siyuan/issues/5591
        focusBlock(lastElement, undefined, false);
    }
    const wbrElement = protyle.wysiwyg.element.querySelector("wbr");
    if (wbrElement) {
        wbrElement.remove();
    }
    transaction(protyle, doOperation, undoOperation);
};
