import {log} from "../util/log";
import {focusBlock, focusByWbr} from "../util/selection";
import {Constants} from "../../constants";
import * as dayjs from "dayjs";
import {transaction, updateTransaction} from "./transaction";
import {mathRender} from "../render/mathRender";
import {highlightRender} from "../render/highlightRender";
import {getContenteditableElement, getNextBlock, hasNextSibling, isNotEditBlock} from "./getBlock";
import {genEmptyBlock} from "../../block/util";
import {blockRender} from "../render/blockRender";
import {hideElements} from "../ui/hideElements";
import {hasClosestByAttribute, hasClosestByClassName} from "../util/hasClosest";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {headingTurnIntoList, turnIntoTaskList} from "./turnIntoList";
import {updateAVName} from "../render/av/action";

export const input = async (protyle: IProtyle, blockElement: HTMLElement, range: Range, needRender = true, event?: InputEvent) => {
    if (!blockElement.parentElement) {
        // 不同 windows 版本下输入法会多次触发 input，导致 outerhtml 赋值的块丢失
        return;
    }
    if (blockElement.classList.contains("av")) {
        const avCursorElement = hasClosestByClassName(range.startContainer, "av__cursor");
        if (avCursorElement) {
            range.startContainer.textContent = Constants.ZWSP;
        } else {
            updateAVName(protyle, blockElement);
        }
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
    blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
    const wbrElement: HTMLElement = document.createElement("wbr");
    range.insertNode(wbrElement);
    if (event && event.inputType === "deleteContentForward") {
        const wbrNextElement = hasNextSibling(wbrElement) as HTMLElement;
        if (wbrNextElement && wbrNextElement.nodeType === 1 && !wbrNextElement.textContent.startsWith(Constants.ZWSP)) {
            const nextType = (wbrNextElement.getAttribute("data-type") || "").split(" ");
            if (nextType.includes("code") || nextType.includes("kbd") || nextType.includes("tag")) {
                wbrNextElement.insertAdjacentElement("afterbegin", wbrElement);
            }
        }
    }
    const id = blockElement.getAttribute("data-node-id");
    if (type !== "NodeCodeBlock" && (editElement.innerHTML.endsWith("\n<wbr>") || editElement.innerHTML.endsWith("\n<wbr>\n"))) {
        // 软换行
        updateTransaction(protyle, id, blockElement.outerHTML, protyle.wysiwyg.lastHTMLs[id] || blockElement.outerHTML.replace("\n<wbr>", "<wbr>"));
        wbrElement.remove();
        return;
    }
    if (turnIntoTaskList(protyle, type, blockElement, editElement, range)) {
        return;
    }
    if (headingTurnIntoList(protyle, type, blockElement, editElement, range)) {
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

    if (editElement.innerHTML.startsWith("》<wbr>") || editElement.innerHTML.indexOf("\n》<wbr>") > -1) {
        editElement.innerHTML = editElement.innerHTML.replace("》<wbr>", "><wbr>");
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
    // https://github.com/siyuan-note/siyuan/issues/9015
    if (trimStartText === "¥¥<wbr>" || trimStartText === "￥￥<wbr>") {
        editElement.innerHTML = "$$<wbr>";
    }
    const refElement = hasClosestByAttribute(range.startContainer, "data-type", "block-ref");
    if (refElement && refElement.getAttribute("data-subtype") === "d") {
        const response = await fetchSyncPost("/api/block/getRefText", {id: refElement.getAttribute("data-id")});
        if (response.data !== refElement.innerHTML.replace("<wbr>", "")) {
            refElement.setAttribute("data-subtype", "s");
        }
    }
    let html = blockElement.outerHTML;
    let focusHR = false;
    if (editElement.textContent === "---" && type !== "NodeCodeBlock") {
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
    } else {
        if (type !== "NodeCodeBlock" && (
            trimStartText.startsWith("```") || trimStartText.startsWith("~~~") || trimStartText.startsWith("···") ||
            trimStartText.indexOf("\n```") > -1 || trimStartText.indexOf("\n~~~") > -1 || trimStartText.indexOf("\n···") > -1
        )) {
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
    hideElements(["util"], protyle, true);

    const tempElement = document.createElement("template");
    tempElement.innerHTML = html;
    if (needRender && (
            getContenteditableElement(tempElement.content.firstElementChild)?.innerHTML !== getContenteditableElement(blockElement).innerHTML ||
            // 内容删空后使用上下键，光标无法到达 https://github.com/siyuan-note/siyuan/issues/4167 https://ld246.com/article/1636256333803
            tempElement.content.childElementCount === 1 && getContenteditableElement(tempElement.content.firstElementChild)?.innerHTML === "<wbr>"
        ) &&
        !(tempElement.content.childElementCount === 1 && tempElement.content.firstElementChild.classList.contains("code-block") && type === "NodeCodeBlock")
    ) {
        log("SpinBlockDOM", blockElement.outerHTML, "argument", protyle.options.debugger);
        log("SpinBlockDOM", html, "result", protyle.options.debugger);
        let scrollLeft: number;
        if (blockElement.classList.contains("table")) {
            scrollLeft = blockElement.firstElementChild.scrollLeft;
        }
        if (/<span data-type="backslash">.+<\/span><wbr>/.test(html)) {
            // 转义不需要添加 zwsp
            blockElement.outerHTML = html;
        } else {
            // 使用 md 闭合后继续输入应为普通文本
            blockElement.outerHTML = html.replace("</span><wbr>", "</span>" + Constants.ZWSP + "<wbr>");
        }
        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${id}"]`).forEach((item: HTMLElement) => {
            if (item.getAttribute("data-type") === "NodeBlockQueryEmbed" ||
                !hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed")) {
                blockElement = item;
            }
        });
        // https://github.com/siyuan-note/siyuan/issues/8972
        if (html.split('<span data-type="inline-math" data-subtype="math"').length > 1) {
            Array.from(blockElement.querySelectorAll('[data-type="inline-math"]')).find((item: HTMLElement) => {
                if (item.dataset.content.indexOf("<wbr>") > -1) {
                    item.setAttribute("data-content", item.dataset.content.replace("<wbr>", ""));
                    protyle.toolbar.showRender(protyle, item);
                    return true;
                }
            });
        }
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
                    if (window.siyuan.storage[Constants.LOCAL_CODELANG] && languageElement.textContent === "") {
                        languageElement.textContent = window.siyuan.storage[Constants.LOCAL_CODELANG];
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
                // https://github.com/siyuan-note/siyuan/issues/6087
                realElement.querySelectorAll('[data-type="block-ref"][data-subtype="d"]').forEach(refItem => {
                    if (refItem.textContent === "") {
                        fetchPost("/api/block/getRefText", {id: refItem.getAttribute("data-id")}, (response) => {
                            refItem.innerHTML = response.data;
                        });
                    }
                });
                mathRender(realElement);
                if (index === tempElement.content.childElementCount - 1) {
                    // https://github.com/siyuan-note/siyuan/issues/11156
                    const currentWbrElement = blockElement.querySelector("wbr");
                    if (currentWbrElement && currentWbrElement.parentElement.tagName === "SPAN" && currentWbrElement.parentElement.innerHTML === "<wbr>") {
                        const types = currentWbrElement.parentElement.getAttribute("data-type") || "";
                        if (types.includes("sup") || types.includes("u") || types.includes("sub")) {
                            currentWbrElement.insertAdjacentText("beforebegin", Constants.ZWSP);
                        }
                    }
                    focusByWbr(protyle.wysiwyg.element, range);
                    protyle.hint.render(protyle);
                    // 表格出现滚动条，输入数字会向前滚 https://github.com/siyuan-note/siyuan/issues/3650
                    if (scrollLeft > 0) {
                        blockElement.firstElementChild.scrollLeft = scrollLeft;
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
    updateInput(html, protyle, id);
};

const updateInput = (html: string, protyle: IProtyle, id: string) => {
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
                data: protyle.wysiwyg.lastHTMLs[id],
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
