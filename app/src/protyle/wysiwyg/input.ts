import {log} from "../util/log";
import {focusBlock, focusByWbr} from "../util/selection";
import {Constants} from "../../constants";
import * as dayjs from "dayjs";
import {transaction, updateTransaction} from "./transaction";
import {mathRender} from "../markdown/mathRender";
import {highlightRender} from "../markdown/highlightRender";
import {getContenteditableElement, getNextBlock, isNotEditBlock} from "./getBlock";
import {genEmptyBlock} from "../../block/util";
import {blockRender} from "../markdown/blockRender";
import {hideElements} from "../ui/hideElements";
import {hasClosestByAttribute} from "../util/hasClosest";
import {fetchSyncPost} from "../../util/fetch";

export const input = async (protyle: IProtyle, blockElement: HTMLElement, range: Range, needRender = true) => {
    if (!blockElement.parentElement) {
        // 不同 windows 版本下输入法会多次触发 input，导致 outerhtml 赋值的块丢失
        return;
    }
    const editElement = getContenteditableElement(blockElement) as HTMLElement;
    const type = blockElement.getAttribute("data-type");
    if (!editElement) {
        // hr、嵌入块、数学公式、iframe、音频、视频、图表渲染块等不允许输入 https://github.com/siyuan-note/siyuan/issues/3958
        if (type === "NodeThematicBreak") {
            blockElement.innerHTML = "<div><wbr></div>";
        } else if (type === "NodeBlockQueryEmbed") {
            blockElement.lastElementChild.previousElementSibling.innerHTML = "<wbr>" + Constants.ZWSP;
        } else if (type === "NodeMathBlock" || type === "NodeHTMLBlock") {
            blockElement.lastElementChild.previousElementSibling.lastElementChild.innerHTML = "<wbr>" + Constants.ZWSP;
        } else if (type === "NodeIFrame" || type === "NodeWidget") {
            blockElement.innerHTML = "<wbr>" + blockElement.firstElementChild.outerHTML + blockElement.lastElementChild.outerHTML;
        } else if (type === "NodeVideo") {
            blockElement.firstElementChild.innerHTML = "<wbr>" + Constants.ZWSP + blockElement.firstElementChild.firstElementChild.outerHTML + blockElement.firstElementChild.lastElementChild.outerHTML;
        } else if (type === "NodeAudio") {
            blockElement.firstElementChild.innerHTML = blockElement.firstElementChild.firstElementChild.outerHTML + "<wbr>" + Constants.ZWSP;
        } else if (type === "NodeCodeBlock") {
            range.startContainer.textContent = Constants.ZWSP;
        }
        focusByWbr(blockElement, range);
        return;
    }
    const wbrElement = document.createElement("wbr");
    range.insertNode(wbrElement);
    let id = blockElement.getAttribute("data-node-id");
    if (type !== "NodeCodeBlock" && (editElement.innerHTML.endsWith("\n<wbr>") || editElement.innerHTML.endsWith("\n<wbr>\n"))) {
        // 软换行
        updateTransaction(protyle, id, blockElement.outerHTML, blockElement.outerHTML.replace("\n<wbr>", "<wbr>"));
        wbrElement.remove();
        return;
    }
    // table、粗体 中也会有 br，仅用于类似#a#，删除后会产生的 br
    const brElement = blockElement.querySelector("br");
    if (brElement && brElement.parentElement.tagName !== "TD" && brElement.parentElement.tagName !== "TH" && (
        brElement.parentElement.textContent.trim() === "" ||
        brElement.previousSibling?.previousSibling?.textContent === "\n"
    )) {
        brElement.remove();
    }

    blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
    if (editElement.innerHTML === "》<wbr>") {
        editElement.innerHTML = "><wbr>";
    }
    const trimStartText = editElement.innerHTML.trimStart();
    if ((trimStartText.startsWith("````") || trimStartText.startsWith("····") || trimStartText.startsWith("~~~~")) &&
        trimStartText.indexOf("\n") === -1) {
        // 超过三个标记符就可以形成为代码块，下方会处理
    } else if ((trimStartText.startsWith("```") || trimStartText.startsWith("···") || trimStartText.startsWith("~~~")) &&
        trimStartText.indexOf("\n") === -1 && trimStartText.replace(/·|~/g, "`").replace(/^`{3,}/g, "").indexOf("`") === -1) {
        // ```test` 后续处理，```test 不处理
        updateTransaction(protyle, id, blockElement.outerHTML, protyle.wysiwyg.lastHTMLs[id]);
        wbrElement.remove();
        return;
    }
    const refElement = hasClosestByAttribute(range.startContainer, "data-type", "block-ref");
    if (refElement && refElement.getAttribute("data-subtype") === "d") {
        const response = await fetchSyncPost("/api/block/getRefText", {id: refElement.getAttribute("data-id")});
        if (response.data !== refElement.textContent) {
            refElement.setAttribute("data-subtype", "s");
        }
    }
    let html = blockElement.outerHTML;
    let todoOldHTML = "";
    let focusHR = false;
    if (editElement.textContent === "---" && !blockElement.classList.contains("code-block")) {
        html = `<div data-node-id="${id}" data-type="NodeThematicBreak" class="hr"><div></div></div>`;
        const nextBlockElement = getNextBlock(editElement);
        if (nextBlockElement) {
            if (!isNotEditBlock(nextBlockElement)) {
                focusBlock(nextBlockElement);
            } else {
                focusHR = true;
            }
        } else {
            html += genEmptyBlock(false, true);
        }
    } else if (!blockElement.classList.contains("code-block") && (["[]", "[ ]", "[x]", "[X]", "【】", "【 】", "【x】", "【X】"].includes(editElement.textContent))) {
        const isDone = editElement.textContent.indexOf("x") > -1 || editElement.textContent.indexOf("X") > -1;
        if (blockElement.parentElement.classList.contains("li")) {
            if (blockElement.parentElement.parentElement.childElementCount === 2 && blockElement.parentElement.childElementCount === 3) {
                html = `<div data-subtype="t" data-node-id="${blockElement.parentElement.parentElement.getAttribute("data-node-id")}" data-type="NodeList" class="list"><div data-marker="*" data-subtype="t" data-node-id="${blockElement.parentElement.getAttribute("data-node-id")}" data-type="NodeListItem" class="li${isDone ? " protyle-task--done" : ""}"><div class="protyle-action protyle-action--task"><svg><use xlink:href="#icon${isDone ? "C" : "Unc"}heck"></use></svg></div><div data-node-id="${id}" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false"><wbr></div><div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div>`;
                id = blockElement.parentElement.parentElement.getAttribute("data-node-id");
                blockElement = blockElement.parentElement.parentElement;
                todoOldHTML = blockElement.outerHTML;
            }
        } else {
            html = `<div data-subtype="t" data-node-id="${id}" data-type="NodeList" class="list"><div data-marker="*" data-subtype="t" data-node-id="${Lute.NewNodeID()}" data-type="NodeListItem" class="li${isDone ? " protyle-task--done" : ""}"><div class="protyle-action protyle-action--task"><svg><use xlink:href="#icon${isDone ? "C" : "Unc"}heck"></use></svg></div><div data-node-id="${Lute.NewNodeID()}" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false"><wbr></div><div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div>`;
            todoOldHTML = blockElement.outerHTML;
        }
    } else {
        if (trimStartText.startsWith("```") || trimStartText.startsWith("~~~") || trimStartText.startsWith("···") ||
            trimStartText.indexOf("\n```") > -1 || trimStartText.indexOf("\n~~~") > -1 || trimStartText.indexOf("\n···") > -1) {
            if (trimStartText.indexOf("\n") === -1 && trimStartText.replace(/·|~/g, "`").replace(/^`{3,}/g, "").indexOf("`") > -1) {
                // ```test` 不处理，正常渲染为段落块
            } else {
                let replaceInnerHTML = editElement.innerHTML.replace(/^(~|·|`){3,}/g, "```").replace(/\n(~|·|`){3,}/g, "\n```").trim();
                if (!replaceInnerHTML.endsWith("\n```")) {
                    replaceInnerHTML = replaceInnerHTML.replace("<wbr>", "") + "<wbr>\n```";
                }
                editElement.innerHTML = replaceInnerHTML;
                html = blockElement.outerHTML;
            }
        }
        html = protyle.lute.SpinBlockDOM(html);
    }
    // 在数学公式输入框中撤销到最后一步，再继续撤销会撤销编辑器正文内容，从而出发 input 事件
    protyle.toolbar.subElement.classList.add("fn__none");

    const tempElement = document.createElement("template");
    tempElement.innerHTML = html;
    if (needRender && (
            getContenteditableElement(tempElement.content.firstElementChild)?.innerHTML !== getContenteditableElement(blockElement).innerHTML ||
            // 内容删空后使用上下键，光标无法到达 https://github.com/siyuan-note/siyuan/issues/4167 https://ld246.com/article/1636256333803
            tempElement.content.childElementCount === 1 && getContenteditableElement(tempElement.content.firstElementChild)?.innerHTML === "<wbr>"
        ) &&
        !(tempElement.content.childElementCount === 1 && tempElement.content.firstElementChild.classList.contains("code-block") && blockElement.classList.contains("code-block"))
    ) {
        log("SpinBlockDOM", blockElement.outerHTML, "argument", protyle.options.debugger);
        log("SpinBlockDOM", html, "result", protyle.options.debugger);
        let scrollLeft: number;
        if (blockElement.classList.contains("table")) {
            scrollLeft = getContenteditableElement(blockElement).scrollLeft;
        }
        blockElement.outerHTML = html;
        blockElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
        Array.from(tempElement.content.children).forEach((item, index) => {
            const tempId = item.getAttribute("data-node-id");
            let realElement;
            if (tempId === id) {
                realElement = blockElement;
            } else {
                realElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${tempId}"]`);
            }
            const realType = realElement.getAttribute("data-type");
            if (realType === "NodeCodeBlock") {
                const languageElement = realElement.querySelector(".protyle-action__language");
                if (languageElement) {
                    if (localStorage.getItem(Constants.LOCAL_CODELANG) && languageElement.textContent === "") {
                        languageElement.textContent = localStorage.getItem(Constants.LOCAL_CODELANG);
                    }
                    highlightRender(realElement);
                } else if (tempElement.content.childElementCount === 1) {
                    protyle.toolbar.showRender(protyle, realElement);
                }
            } else if (["NodeMathBlock", "NodeHTMLBlock"].includes(realType)) {
                if (realType === "NodeMathBlock") {
                    mathRender(realElement);
                }
                protyle.toolbar.showRender(protyle, realElement);
            } else if (realType === "NodeBlockQueryEmbed") {
                blockRender(protyle, realElement);
                protyle.toolbar.showRender(protyle, realElement);
                hideElements(["hint"], protyle);
            } else if (realType === "NodeThematicBreak" && focusHR) {
                focusBlock(blockElement);
            } else {
                mathRender(realElement);
                if (index === tempElement.content.childElementCount - 1) {
                    focusByWbr(protyle.wysiwyg.element, range);
                    protyle.hint.render(protyle);
                    // 表格出现滚动条，输入数字会向前滚 https://github.com/siyuan-note/siyuan/issues/3650
                    if (scrollLeft > 0) {
                        getContenteditableElement(realElement).scrollLeft = scrollLeft;
                    }
                }
            }
        });
    } else if (blockElement.getAttribute("data-type") === "NodeCodeBlock") {
        editElement.removeAttribute("data-render");
        highlightRender(blockElement);
    } else {
        focusByWbr(protyle.wysiwyg.element, range);
        protyle.hint.render(protyle);
    }
    hideElements(["gutter"], protyle);
    updateInput(html, protyle, id, type, todoOldHTML);
};

const updateInput = (html: string, protyle: IProtyle, id: string, type: string, oldHTML?: string) => {
    const tempElement = document.createElement("template");
    tempElement.innerHTML = html;
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    Array.from(tempElement.content.children).forEach((item, index) => {
        if (item.getAttribute("spellcheck") === "false" && item.getAttribute("contenteditable") === "false") {
            item.setAttribute("contenteditable", "true");
        }
        const tempId = item.getAttribute("data-node-id");
        if (tempId === id) {
            doOperations.push({
                id,
                data: item.outerHTML,
                action: "update"
            });
            undoOperations.push({
                id,
                data: protyle.wysiwyg.lastHTMLs[id] || oldHTML,
                action: "update"
            });
        } else {
            let firstElement;
            if (index === 0) {
                firstElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${tempId}"]`);
            }
            doOperations.push({
                action: "insert",
                data: item.outerHTML,
                id: tempId,
                previousID: index === 0 ? firstElement?.previousElementSibling?.getAttribute("data-node-id") : item.previousElementSibling.getAttribute("data-node-id"),
                parentID: firstElement?.parentElement.getAttribute("data-node-id") || protyle.block.parentID
            });
            undoOperations.push({
                id: tempId,
                action: "delete"
            });
        }
    });
    transaction(protyle, doOperations, undoOperations);
};
