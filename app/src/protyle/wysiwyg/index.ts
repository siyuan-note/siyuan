import {paste} from "../util/paste";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByMatchTag,
    hasTopClosestByClassName,
} from "../util/hasClosest";
import {
    focusBlock,
    focusByRange,
    focusByWbr,
    focusSideBlock,
    getEditorRange,
    getSelectionOffset, setLastNodeRange,
} from "../util/selection";
import {Constants} from "../../constants";
import {getSearch, isMobile} from "../../util/functions";
import {isLocalPath, pathPosix} from "../../util/pathName";
import {genEmptyElement} from "../../block/util";
import {previewImage} from "../preview/image";
import {contentMenu, imgMenu, linkMenu, refMenu, setFold, zoomOut} from "../../menus/protyle";
import * as dayjs from "dayjs";
import {dropEvent} from "../util/editorCommonEvent";
import {input} from "./input";
import {
    getContenteditableElement,
    getLastBlock, getNextBlock,
    getPreviousHeading,
    getTopAloneElement,
    hasNextSibling, hasPreviousSibling,
    isNotEditBlock
} from "./getBlock";
import {transaction, updateTransaction} from "./transaction";
import {hideElements} from "../ui/hideElements";
/// #if !BROWSER
import {shell} from "electron";
import {getCurrentWindow} from "@electron/remote";
/// #endif
import {removeEmbed} from "./removeEmbed";
import {keydown} from "./keydown";
import {openMobileFileById} from "../../mobile/editor";
import {removeBlock} from "./remove";
import {highlightRender} from "../markdown/highlightRender";
import {openAttr} from "../../menus/commonMenuItem";
import {blockRender} from "../markdown/blockRender";
/// #if !MOBILE
import {getAllModels} from "../../layout/getAll";
import {pushBack} from "../../util/backForward";
import {openAsset, openBy, openFileById} from "../../editor/util";
import {openGlobalSearch} from "../../search/util";
/// #endif
import {BlockPanel} from "../../block/Panel";
import {isCtrl, openByMobile} from "../util/compatibility";
import {MenuItem} from "../../menus/Menu";
import {fetchPost} from "../../util/fetch";
import {onGet} from "../util/onGet";
import {setTableAlign} from "../util/table";
import {countBlockWord, countSelectWord} from "../../layout/status";
import {showMessage} from "../../dialog/message";
import {getBacklinkHeadingMore, loadBreadcrumb} from "./renderBacklink";

export class WYSIWYG {
    public lastHTMLs: { [key: string]: string } = {};

    public element: HTMLDivElement;
    public preventKeyup: boolean;

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.className = "protyle-wysiwyg";
        this.element.setAttribute("spellcheck", "false");
        if (navigator && navigator.maxTouchPoints > 1 && navigator.platform === "MacIntel") {
            // iPhone，iPad 端输入 contenteditable 为 true 时会在块中间插入 span
            this.element.setAttribute("contenteditable", "false");
        } else {
            this.element.setAttribute("contenteditable", "true");
        }
        if (window.siyuan.config.editor.displayBookmarkIcon) {
            this.element.classList.add("protyle-wysiwyg--attr");
        }
        this.bindCommonEvent(protyle);
        if (protyle.options.action.includes(Constants.CB_GET_HISTORY)) {
            return;
        }
        this.bindEvent(protyle);
        keydown(protyle, this.element);
        dropEvent(protyle, this.element);
    }

    public renderCustom(ial: IObject) {
        const ialKeys = Object.keys(ial);
        for (let i = 0; i < this.element.attributes.length; i++) {
            const oldKey = this.element.attributes[i].nodeName;
            if (!["type", "class", "spellcheck", "contenteditable", "data-doc-type", "style", "scroll"].includes(oldKey) &&
                !ialKeys.includes(oldKey)) {
                this.element.removeAttribute(oldKey);
                i--;
            }
        }
        ialKeys.forEach((key: string) => {
            if (!["title-img", "title", "updated", "icon", "id", "type", "class", "spellcheck", "contenteditable", "data-doc-type", "style"].includes(key)) {
                this.element.setAttribute(key, ial[key]);
            }
        });
    }

    // text block-ref file-annotation-ref a 结尾处打字应为普通文本
    private escapeInline(protyle: IProtyle, range: Range, event: InputEvent) {
        if (!event.data) {
            return;
        }
        const inputData = event.data;
        protyle.toolbar.range = range;
        const inlineElement = range.startContainer.parentElement;
        const currentTypes = protyle.toolbar.getCurrentType();

        let dataLength = inputData.length;
        if (inputData === "<" || inputData === ">") {
            // 使用 inlineElement.innerHTML 会出现 https://ld246.com/article/1627185027423 中的第2个问题
            dataLength = 4;
        }
        // https://github.com/siyuan-note/siyuan/issues/5924
        if (currentTypes.length > 0 && range.toString() === "" && range.startOffset === inputData.length && inlineElement.tagName === "SPAN" &&
            inlineElement.textContent.replace(Constants.ZWSP, "") !== inputData &&
            inlineElement.textContent.replace(Constants.ZWSP, "").length >= inputData.length &&
            !hasPreviousSibling(range.startContainer) && !hasPreviousSibling(inlineElement)) {
            const html = inlineElement.innerHTML.replace(Constants.ZWSP, "");
            inlineElement.innerHTML = html.substr(dataLength);
            const textNode = document.createTextNode(inputData);
            inlineElement.before(textNode);
            range.selectNodeContents(textNode);
            range.collapse(false);
            return;
        }
        if (// 表格行内公式之前无法插入文字 https://github.com/siyuan-note/siyuan/issues/3908
            inlineElement.tagName === "SPAN" &&
            inlineElement.textContent !== inputData &&
            range.toString() === "" && range.startContainer.nodeType === 3 &&
            (currentTypes.includes("inline-memo") || currentTypes.includes("text") || currentTypes.includes("block-ref") || currentTypes.includes("file-annotation-ref") || currentTypes.includes("a")) &&
            !hasNextSibling(range.startContainer) && range.startContainer.textContent.length === range.startOffset &&
            inlineElement.textContent.length > inputData.length
        ) {
            const position = getSelectionOffset(inlineElement, protyle.wysiwyg.element, range);
            const html = inlineElement.innerHTML;
            if (position.start === inlineElement.textContent.length) {
                // 使用 inlineElement.textContent **$a$b** 中数学公式消失
                inlineElement.innerHTML = html.substr(0, html.length - dataLength);
                const textNode = document.createTextNode(inputData);
                inlineElement.after(textNode);
                range.selectNodeContents(textNode);
                range.collapse(false);
            }
        }
    }

    private setEmptyOutline(protyle: IProtyle, element: HTMLElement) {
        // 图片移除选择状态应放在前面，否则 https://github.com/siyuan-note/siyuan/issues/4173
        const selectImgElement = protyle.wysiwyg.element.querySelector(".img--select");
        if (selectImgElement) {
            selectImgElement.classList.remove("img--select");
        }
        let nodeElement = element;
        if (!element.getAttribute("data-node-id")) {
            const tempElement = hasClosestBlock(element);
            if (!tempElement) {
                return;
            }
            nodeElement = tempElement;
        }
        /// #if !MOBILE
        if (protyle.model) {
            getAllModels().outline.forEach(item => {
                if (item.blockId === protyle.block.rootID) {
                    if (nodeElement.getAttribute("data-type") === "NodeHeading") {
                        item.setCurrent(nodeElement.getAttribute("data-node-id"));
                        return;
                    }
                    const headingElement = getPreviousHeading(nodeElement);
                    if (headingElement) {
                        item.setCurrent(headingElement.getAttribute("data-node-id"));
                        return;
                    }
                    item.setCurrent("");
                }
            });
        }
        /// #endif
    }

    private bindCommonEvent(protyle: IProtyle) {
        this.element.addEventListener("copy", (event: ClipboardEvent & { target: HTMLElement }) => {
            window.siyuan.ctrlIsPressed = false; // https://github.com/siyuan-note/siyuan/issues/6373
            // https://github.com/siyuan-note/siyuan/issues/4600
            if (event.target.tagName === "PROTYLE-HTML") {
                event.stopPropagation();
                return;
            }
            event.stopPropagation();
            event.preventDefault();
            const range = getEditorRange(protyle.wysiwyg.element);
            const nodeElement = hasClosestBlock(range.startContainer);
            if (!nodeElement) {
                return;
            }
            const selectImgElement = nodeElement.querySelector(".img--select");
            let selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0 && range.toString() === "" && !range.cloneContents().querySelector("img") &&
                !selectImgElement) {
                nodeElement.classList.add("protyle-wysiwyg--select");
                countBlockWord([nodeElement.getAttribute("data-node-id")]);
                selectElements = [nodeElement];
            }
            let html = "";
            let textPlain = "";
            if (selectElements.length > 0) {
                if (selectElements[0].getAttribute("data-type") === "NodeListItem" && selectElements[0].parentElement.childElementCount - 1 === selectElements.length) {
                    html = selectElements[0].parentElement.outerHTML;
                } else {
                    selectElements.forEach(item => {
                        const topElement = getTopAloneElement(item);
                        html += removeEmbed(topElement);
                    });
                }
            } else {
                const tempElement = document.createElement("div");
                // https://github.com/siyuan-note/siyuan/issues/5540
                const selectTypes = protyle.toolbar.getCurrentType(range);
                if ((selectTypes.length > 0 || range.startContainer.parentElement.parentElement.getAttribute("data-type") === "NodeHeading") &&
                    (
                        (range.startContainer.nodeType === 3 && range.startContainer.parentElement.textContent === range.toString()) ||
                        (range.startContainer.nodeType !== 3 && range.startContainer.textContent === range.toString())
                    )) {
                    if (range.startContainer.parentElement.parentElement.getAttribute("data-type") === "NodeHeading") {
                        // 复制标题 https://github.com/siyuan-note/insider/issues/297
                        tempElement.append(range.startContainer.parentElement.parentElement.cloneNode(true));
                    } else if (!["DIV", "TD", "TH", "TR"].includes(range.startContainer.parentElement.tagName)) {
                        // 复制行内元素 https://github.com/siyuan-note/insider/issues/191
                        tempElement.append(range.startContainer.parentElement.cloneNode(true));
                    } else {
                        // 直接复制块 https://github.com/siyuan-note/insider/issues/318
                        tempElement.append(range.cloneContents());
                    }
                    html = tempElement.innerHTML;
                } else if (selectImgElement) {
                    html = selectImgElement.outerHTML;
                } else if (selectTypes.length > 0 && range.startContainer.nodeType === 3 && range.startContainer.parentElement.tagName === "SPAN" &&
                    range.startContainer.parentElement.isSameNode(range.endContainer.parentElement)) {
                    // 复制粗体等字体中的一部分
                    const attributes = range.startContainer.parentElement.attributes;
                    const spanElement = document.createElement("span");
                    for (let i = 0; i < attributes.length; i++) {
                        spanElement.setAttribute(attributes[i].name, attributes[i].value);
                    }
                    if (spanElement.getAttribute("data-type").indexOf("block-ref") > -1 &&
                        spanElement.getAttribute("data-subtype") === "d") {
                        // 需变为静态锚文本
                        spanElement.setAttribute("data-subtype", "s");
                    }
                    spanElement.textContent = range.toString();
                    html = spanElement.outerHTML;
                } else {
                    tempElement.append(range.cloneContents());
                    const inlineMathElement = hasClosestByAttribute(range.commonAncestorContainer, "data-type", "inline-math");
                    if (inlineMathElement) {
                        // 表格内复制数学公式 https://ld246.com/article/1631708573504
                        html = inlineMathElement.outerHTML;
                    } else {
                        html = tempElement.innerHTML;
                    }
                    // 不能使用 commonAncestorContainer https://ld246.com/article/1643282894693
                    if (hasClosestByAttribute(range.startContainer, "data-type", "NodeCodeBlock") ||
                        hasClosestByMatchTag(range.startContainer, "CODE")) {
                        textPlain = tempElement.textContent.replace(Constants.ZWSP, "");
                    }
                }
            }
            event.clipboardData.setData("text/plain", textPlain || protyle.lute.BlockDOM2StdMd(html).trimEnd());
            event.clipboardData.setData("text/html", html + Constants.ZWSP);
        });
        this.element.addEventListener("mousedown", (event: MouseEvent) => {
            if (event.button === 2 || window.siyuan.ctrlIsPressed) {
                // 右键
                return;
            }
            if (!window.siyuan.shiftIsPressed) {
                // https://github.com/siyuan-note/siyuan/issues/3026
                hideElements(["select"], protyle);
            }
            const target = event.target as HTMLElement;
            if (hasClosestByClassName(target, "protyle-action")) {
                return;
            }
            const documentSelf = document;
            const rect = protyle.element.getBoundingClientRect();
            const mostLeft = rect.left + parseInt(protyle.wysiwyg.element.style.paddingLeft) + 1;
            const mostRight = mostLeft + protyle.wysiwyg.element.firstElementChild.clientWidth - 1;
            const mostBottom = rect.bottom;
            const y = event.clientY;
            // 图片、iframe、video 缩放
            if (!protyle.disabled && target.classList.contains("protyle-action__drag")) {
                const nodeElement = hasClosestBlock(target);
                if (!nodeElement) {
                    return;
                }
                let isCenter = true;
                if (["NodeIFrame", "NodeWidget", "NodeVideo"].includes(nodeElement.getAttribute("data-type"))) {
                    nodeElement.classList.add("iframe--drag");
                    if (nodeElement.style.textAlign === "left" || nodeElement.style.textAlign === "right") {
                        isCenter = false;
                    }
                } else if (target.parentElement.parentElement.getAttribute("data-type") === "img") {
                    target.parentElement.parentElement.classList.add("img--drag");
                }

                const id = nodeElement.getAttribute("data-node-id");
                const html = nodeElement.outerHTML;
                const x = event.clientX;
                const dragElement = target.previousElementSibling as HTMLElement;
                const dragWidth = dragElement.clientWidth;
                const dragHeight = dragElement.clientHeight;
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    if (dragElement.tagName === "IMG") {
                        dragElement.parentElement.parentElement.style.width = "";
                    }
                    if (moveEvent.clientX > x - dragWidth + 8 && moveEvent.clientX < mostRight) {
                        if ((dragElement.tagName === "IMG" && dragElement.parentElement.parentElement.style.display !== "block") || !isCenter) {
                            dragElement.style.width = Math.max(17, dragWidth + (moveEvent.clientX - x)) + "px";
                        } else {
                            dragElement.style.width = Math.max(17, dragWidth + (moveEvent.clientX - x) * 2) + "px";
                        }
                    }
                    if (dragElement.tagName !== "IMG") {
                        if (moveEvent.clientY > y - dragHeight + 8 && moveEvent.clientY < mostBottom) {
                            dragElement.style.height = (dragHeight + (moveEvent.clientY - y)) + "px";
                        }
                    } else {
                        dragElement.parentElement.parentElement.style.maxWidth = (parseInt(dragElement.style.width) + 10) + "px";
                    }
                };

                documentSelf.onmouseup = () => {
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    if (target.classList.contains("protyle-action__drag") && nodeElement) {
                        updateTransaction(protyle, id, nodeElement.outerHTML, html);
                    }
                    nodeElement.classList.remove("iframe--drag");
                    target.parentElement.parentElement.classList.remove("img--drag");
                };
                return;
            }
            // table cell select
            let tableBlockElement: HTMLElement | false;
            if (target.tagName === "TH" || target.tagName === "TD" || target.firstElementChild?.tagName === "TABLE" || target.classList.contains("table__resize") || target.classList.contains("table__select")) {
                tableBlockElement = hasClosestBlock(target);
                if (tableBlockElement) {
                    tableBlockElement.querySelector("table").classList.remove("select");
                    tableBlockElement.querySelector(".table__select").removeAttribute("style");
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                }
                // 后续拖拽操作写在多选节点中
            }
            // table col resize
            if (!protyle.disabled && target.classList.contains("table__resize")) {
                const nodeElement = hasClosestBlock(target);
                if (!nodeElement) {
                    return;
                }
                const html = nodeElement.outerHTML;
                // https://github.com/siyuan-note/siyuan/issues/4455
                if (getSelection().rangeCount > 0) {
                    getSelection().getRangeAt(0).collapse(false);
                }
                // @ts-ignore
                nodeElement.firstElementChild.style.webkitUserModify = "read-only";
                nodeElement.style.cursor = "col-resize";
                target.removeAttribute("style");
                const id = nodeElement.getAttribute("data-node-id");
                const x = event.clientX;
                const colElement = nodeElement.querySelectorAll("table col")[parseInt(target.getAttribute("data-col-index"))] as HTMLElement;
                // 兼容 1.8.2
                (nodeElement.querySelectorAll("table th")[parseInt(target.getAttribute("data-col-index"))] as HTMLElement).style.width = "";
                const oldWidth = colElement.clientWidth;
                const hasScroll = nodeElement.firstElementChild.clientWidth < nodeElement.firstElementChild.scrollWidth;
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    if (nodeElement.style.textAlign === "center" && !hasScroll) {
                        colElement.style.width = (oldWidth + (moveEvent.clientX - x) * 2) + "px";
                    } else {
                        colElement.style.width = (oldWidth + (moveEvent.clientX - x)) + "px";
                    }
                };

                documentSelf.onmouseup = () => {
                    // @ts-ignore
                    nodeElement.firstElementChild.style.webkitUserModify = "";
                    nodeElement.style.cursor = "";
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    if (nodeElement) {
                        updateTransaction(protyle, id, nodeElement.outerHTML, html);
                    }
                };
                return;
            }

            // 多选节点
            let x = event.clientX;
            if (event.clientX > mostRight) {
                x = mostRight;
            } else if (event.clientX < mostLeft) {
                x = mostLeft;
            }
            const mostTop = rect.top + (protyle.options.render.breadcrumb ? protyle.breadcrumb.element.parentElement.clientHeight : 0);

            let mouseElement: Element;
            let moveCellElement: HTMLElement;
            documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                const moveTarget = moveEvent.target as HTMLElement;
                // table cell select
                if (!protyle.disabled && tableBlockElement && tableBlockElement.contains(moveTarget) && !hasClosestByClassName(tableBlockElement, "protyle-wysiwyg__embed")) {
                    if ((moveTarget.tagName === "TH" || moveTarget.tagName === "TD") && !moveTarget.isSameNode(target) && (!moveCellElement || !moveCellElement.isSameNode(moveTarget))) {
                        // @ts-ignore
                        tableBlockElement.firstElementChild.style.webkitUserModify = "read-only";
                        let width = target.offsetLeft + target.clientWidth - moveTarget.offsetLeft;
                        let left = moveTarget.offsetLeft;
                        if (target.offsetLeft === moveTarget.offsetLeft) {
                            width = Math.max(target.clientWidth, moveTarget.clientWidth);
                        } else if (target.offsetLeft < moveTarget.offsetLeft) {
                            width = moveTarget.offsetLeft + moveTarget.clientWidth - target.offsetLeft;
                            left = target.offsetLeft;
                        }
                        let height = target.offsetTop + target.clientHeight - moveTarget.offsetTop;
                        let top = moveTarget.offsetTop;
                        if (target.offsetTop === moveTarget.offsetTop) {
                            height = Math.max(target.clientHeight, moveTarget.clientHeight);
                        } else if (target.offsetTop < moveTarget.offsetTop) {
                            height = moveTarget.offsetTop + moveTarget.clientHeight - target.offsetTop;
                            top = target.offsetTop;
                        }
                        // https://github.com/siyuan-note/insider/issues/1015
                        Array.from(tableBlockElement.querySelectorAll("th, td")).find((item: HTMLElement) => {
                            const updateWidth = item.offsetLeft < left + width && item.offsetLeft + item.clientWidth > left + width;
                            const updateWidth2 = item.offsetLeft < left && item.offsetLeft + item.clientWidth > left;
                            if (item.offsetTop < top && item.offsetTop + item.clientHeight > top) {
                                if ((item.offsetLeft + 6 > left && item.offsetLeft + item.clientWidth - 6 < left + width) || updateWidth || updateWidth2) {
                                    height = top + height - item.offsetTop;
                                    top = item.offsetTop;
                                }
                                if (updateWidth) {
                                    width = item.offsetLeft + item.clientWidth - left;
                                }
                                if (updateWidth2) {
                                    width = left + width - item.offsetLeft;
                                    left = item.offsetLeft;
                                }
                            } else if (item.offsetTop < top + height && item.offsetTop + item.clientHeight > top + height) {
                                if ((item.offsetLeft + 6 > left && item.offsetLeft + item.clientWidth - 6 < left + width) || updateWidth || updateWidth2) {
                                    height = item.clientHeight + item.offsetTop - top;
                                }
                                if (updateWidth) {
                                    width = item.offsetLeft + item.clientWidth - left;
                                }
                                if (updateWidth2) {
                                    width = left + width - item.offsetLeft;
                                    left = item.offsetLeft;
                                }
                            } else if (updateWidth2 && item.offsetTop + 6 > top && item.offsetTop + item.clientHeight - 6 < top + height) {
                                width = left + width - item.offsetLeft;
                                left = item.offsetLeft;
                            } else if (updateWidth && item.offsetTop + 6 > top && item.offsetTop + item.clientHeight - 6 < top + height) {
                                width = item.offsetLeft + item.clientWidth - left;
                            }
                        });
                        tableBlockElement.querySelector("table").classList.add("select");
                        tableBlockElement.querySelector(".table__select").setAttribute("style", `left:${left - tableBlockElement.firstElementChild.scrollLeft}px;top:${top}px;height:${height}px;width:${width + 1}px;`);
                        moveCellElement = moveTarget;
                    }
                    return;
                }
                protyle.selectElement.classList.remove("fn__none");
                // 向左选择，遇到 gutter 就不会弹出 toolbar
                hideElements(["gutter"], protyle);
                let newTop = 0;
                let newLeft = 0;
                let newWidth = 0;
                let newHeight = 0;
                if (moveEvent.clientX < x) {
                    if (moveEvent.clientX < mostLeft) {
                        // 向左越界
                        newLeft = mostLeft;
                    } else {
                        // 向左
                        newLeft = moveEvent.clientX;
                    }
                    newWidth = x - newLeft;
                } else {
                    if (moveEvent.clientX > mostRight) {
                        // 向右越界
                        newLeft = x;
                        newWidth = mostRight - newLeft;
                    } else {
                        // 向右
                        newLeft = x;
                        newWidth = moveEvent.clientX - x;
                    }
                }

                if (moveEvent.clientY > y) {
                    if (moveEvent.clientY > mostBottom) {
                        // 向下越界
                        newTop = y;
                        newHeight = mostBottom - y;
                    } else {
                        // 向下
                        newTop = y;
                        newHeight = moveEvent.clientY - y;
                    }
                } else {
                    if (moveEvent.clientY < mostTop) {
                        // 向上越界
                        newTop = mostTop;
                    } else {
                        // 向上
                        newTop = moveEvent.clientY;
                    }
                    newHeight = y - newTop;
                }
                protyle.selectElement.setAttribute("style", `background-color: ${protyle.selectElement.style.backgroundColor};top:${newTop}px;height:${newHeight}px;left:${newLeft + 2}px;width:${newWidth - 2}px;`);
                const newMouseElement = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
                if (mouseElement && mouseElement.isSameNode(newMouseElement) && !mouseElement.classList.contains("protyle-wysiwyg") &&
                    !mouseElement.classList.contains("list") && !mouseElement.classList.contains("bq") && !mouseElement.classList.contains("sb")) {
                    // 性能优化，同一个p元素不进行选中计算
                    return;
                } else {
                    mouseElement = newMouseElement;
                }
                hideElements(["select"], protyle);
                let firstElement = document.elementFromPoint(newLeft - 1, newTop);
                if (!firstElement) {
                    return;
                }
                if (firstElement.classList.contains("protyle-wysiwyg") || firstElement.classList.contains("list") || firstElement.classList.contains("sb") || firstElement.classList.contains("bq")) {
                    firstElement = document.elementFromPoint(newLeft - 1, newTop + 16);
                }
                if (!firstElement || firstElement.classList.contains("protyle-wysiwyg")) {
                    return;
                }
                const firstBlockElement = hasClosestBlock(firstElement);
                if (!firstBlockElement) {
                    return;
                }
                let selectElements: Element[] = [];
                let currentElement: Element | boolean = firstBlockElement;
                let hasJump = false;
                while (currentElement) {
                    if (currentElement && !currentElement.classList.contains("protyle-attr")) {
                        const currentRect = currentElement.getBoundingClientRect();
                        if (currentRect.height > 0 && currentRect.top < newTop + newHeight && currentRect.left < newLeft + newWidth) {
                            if (hasJump) {
                                // 父节点的下个节点在选中范围内才可使用父节点作为选中节点
                                if (currentElement.nextElementSibling && !currentElement.nextElementSibling.classList.contains("protyle-attr")) {
                                    const nextRect = currentElement.nextElementSibling.getBoundingClientRect();
                                    if (nextRect.top < newTop + newHeight && nextRect.left < newLeft + newWidth) {
                                        selectElements = [currentElement];
                                        currentElement = currentElement.nextElementSibling;
                                        hasJump = false;
                                    } else if (currentElement.parentElement.classList.contains("sb")) {
                                        currentElement = hasClosestBlock(currentElement.parentElement);
                                        hasJump = true;
                                    } else {
                                        break;
                                    }
                                } else {
                                    currentElement = hasClosestBlock(currentElement.parentElement);
                                    hasJump = true;
                                }
                            } else {
                                selectElements.push(currentElement);
                                currentElement = currentElement.nextElementSibling;
                            }
                        } else if (currentElement.parentElement.classList.contains("sb")) {
                            // 跳出超级块横向排版中的未选中元素
                            currentElement = hasClosestBlock(currentElement.parentElement);
                            hasJump = true;
                        } else if (currentRect.height === 0 && currentRect.width === 0 && currentElement.parentElement.getAttribute("fold") === "1") {
                            currentElement = currentElement.parentElement;
                            selectElements = [];
                        } else {
                            break;
                        }
                    } else {
                        currentElement = hasClosestBlock(currentElement.parentElement);
                        hasJump = true;
                    }
                }
                if (selectElements.length === 1 && !selectElements[0].classList.contains("list") && !selectElements[0].classList.contains("bq") && !selectElements[0].classList.contains("sb")) {
                    // 只有一个 p 时不选中
                    protyle.selectElement.style.backgroundColor = "transparent";
                } else {
                    selectElements.forEach(item => {
                        if (!hasClosestByClassName(item, "protyle-wysiwyg__embed")) {
                            item.classList.add("protyle-wysiwyg--select");
                        }
                    });
                    protyle.selectElement.style.backgroundColor = "";
                }
            };

            documentSelf.onmouseup = (mouseUpEvent) => {
                documentSelf.onmousemove = null;
                documentSelf.onmouseup = null;
                documentSelf.ondragstart = null;
                documentSelf.onselectstart = null;
                documentSelf.onselect = null;
                protyle.selectElement.classList.add("fn__none");
                protyle.selectElement.removeAttribute("style");
                if (!protyle.disabled && tableBlockElement) {
                    // @ts-ignore
                    tableBlockElement.firstElementChild.style.webkitUserModify = "";
                    const tableSelectElement = tableBlockElement.querySelector(".table__select") as HTMLElement;
                    if (tableSelectElement.getAttribute("style")) {
                        if (getSelection().rangeCount > 0) {
                            getSelection().getRangeAt(0).collapse(false);
                        }
                        window.siyuan.menus.menu.remove();
                        window.siyuan.menus.menu.append(new MenuItem({
                            label: window.siyuan.languages.mergeCell,
                            click: () => {
                                if (tableBlockElement) {
                                    const selectCellElements: HTMLTableCellElement[] = [];
                                    const colIndexList: number[] = [];
                                    const colCount = tableBlockElement.querySelectorAll("th").length;
                                    let fnNoneMax = 0;
                                    const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
                                    let isTHead = false;
                                    let isTBody = false;
                                    tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement, index: number) => {
                                        if (item.classList.contains("fn__none")) {
                                            // 合并的元素中间有 fn__none 的元素
                                            if (item.previousElementSibling && item.previousElementSibling.isSameNode(selectCellElements[selectCellElements.length - 1])) {
                                                selectCellElements.push(item);
                                                if (!isTHead && item.parentElement.parentElement.tagName === "THEAD") {
                                                    isTHead = true;
                                                } else if (!isTBody && item.parentElement.parentElement.tagName === "TBODY") {
                                                    isTBody = true;
                                                }
                                            } else {
                                                if (index < fnNoneMax && colIndexList.includes((index + 1) % colCount)) {
                                                    selectCellElements.push(item);
                                                    if (!isTHead && item.parentElement.parentElement.tagName === "THEAD") {
                                                        isTHead = true;
                                                    } else if (!isTBody && item.parentElement.parentElement.tagName === "TBODY") {
                                                        isTBody = true;
                                                    }
                                                }
                                            }
                                        } else {
                                            if (item.offsetLeft + 6 > tableSelectElement.offsetLeft + scrollLeft && item.offsetLeft + item.clientWidth - 6 < tableSelectElement.offsetLeft + scrollLeft + tableSelectElement.clientWidth &&
                                                item.offsetTop + 6 > tableSelectElement.offsetTop && item.offsetTop + item.clientHeight - 6 < tableSelectElement.offsetTop + tableSelectElement.clientHeight) {
                                                selectCellElements.push(item);
                                                if (!isTHead && item.parentElement.parentElement.tagName === "THEAD") {
                                                    isTHead = true;
                                                } else if (!isTBody && item.parentElement.parentElement.tagName === "TBODY") {
                                                    isTBody = true;
                                                }
                                                colIndexList.push((index + 1) % colCount);
                                                // https://github.com/siyuan-note/insider/issues/1014
                                                fnNoneMax = Math.max((item.rowSpan - 1) * colCount + index + 1, fnNoneMax);
                                            }
                                        }
                                    });
                                    tableBlockElement.querySelector("table").classList.remove("select");
                                    tableSelectElement.removeAttribute("style");
                                    const oldHTML = tableBlockElement.outerHTML;
                                    let cellElement = selectCellElements[0];
                                    let colSpan = cellElement.colSpan;
                                    let index = 1;
                                    while (cellElement.nextElementSibling && cellElement.nextElementSibling.isSameNode(selectCellElements[index])) {
                                        cellElement = cellElement.nextElementSibling as HTMLTableCellElement;
                                        if (!cellElement.classList.contains("fn__none")) { // https://github.com/siyuan-note/insider/issues/1007#issuecomment-1046195608
                                            colSpan += cellElement.colSpan;
                                        }
                                        index++;
                                    }
                                    let html = "";
                                    let rowElement: Element = selectCellElements[0].parentElement;
                                    let rowSpan = selectCellElements[0].rowSpan;
                                    selectCellElements.forEach((item, index) => {
                                        let cellHTML = item.innerHTML.trim();
                                        if (cellHTML.endsWith("<br>")) {
                                            cellHTML = cellHTML.substr(0, cellHTML.length - 4);
                                        }
                                        html += cellHTML + ((!cellHTML || index === selectCellElements.length - 1) ? "" : "<br>");
                                        if (index !== 0) {
                                            if (!rowElement.isSameNode(item.parentElement)) {
                                                if (!item.classList.contains("fn__none")) { // https://github.com/siyuan-note/insider/issues/1011
                                                    rowSpan += item.rowSpan;
                                                }
                                                rowElement = item.parentElement;
                                                if (selectCellElements[0].parentElement.parentElement.tagName === "THEAD" && item.parentElement.parentElement.tagName !== "THEAD") {
                                                    selectCellElements[0].parentElement.parentElement.insertAdjacentElement("beforeend", item.parentElement);
                                                }
                                            }
                                            item.classList.add("fn__none");
                                            item.innerHTML = "";
                                        }
                                    });

                                    // https://github.com/siyuan-note/insider/issues/1017
                                    if (isTHead && isTBody) {
                                        rowElement = rowElement.parentElement.nextElementSibling.firstElementChild;
                                        while (rowElement && rowElement.parentElement.tagName !== "THEAD") {
                                            let colSpanCount = 0;
                                            let noneCount = 0;
                                            Array.from(rowElement.children).forEach((item: HTMLTableCellElement) => {
                                                colSpanCount += item.colSpan - 1;
                                                if (item.classList.contains("fn__none")) {
                                                    noneCount++;
                                                }
                                            });
                                            if (colSpanCount !== noneCount) {
                                                selectCellElements[0].parentElement.parentElement.insertAdjacentElement("beforeend", rowElement);
                                                rowElement = rowElement.parentElement.nextElementSibling.firstElementChild;
                                            } else {
                                                break;
                                            }
                                        }
                                    }

                                    // 合并背景色不会修改，需要等计算完毕
                                    setTimeout(() => {
                                        if (tableBlockElement) {
                                            selectCellElements[0].innerHTML = html + "<wbr>";
                                            selectCellElements[0].colSpan = colSpan;
                                            selectCellElements[0].rowSpan = rowSpan;
                                            focusByWbr(selectCellElements[0], document.createRange());
                                            updateTransaction(protyle, tableBlockElement.getAttribute("data-node-id"), tableBlockElement.outerHTML, oldHTML);
                                        }
                                    });
                                }
                            }
                        }).element);
                        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                        window.siyuan.menus.menu.append(new MenuItem({
                            icon: "iconAlignLeft",
                            accelerator: window.siyuan.config.keymap.editor.general.alignLeft.custom,
                            label: window.siyuan.languages.alignLeft,
                            click: () => {
                                if (tableBlockElement) {
                                    const selectCellElements: HTMLTableCellElement[] = [];
                                    const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
                                    tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                                        if (!item.classList.contains("fn__none") &&
                                            item.offsetLeft + 6 > tableSelectElement.offsetLeft + scrollLeft && item.offsetLeft + item.clientWidth - 6 < tableSelectElement.offsetLeft + scrollLeft + tableSelectElement.clientWidth &&
                                            item.offsetTop + 6 > tableSelectElement.offsetTop && item.offsetTop + item.clientHeight - 6 < tableSelectElement.offsetTop + tableSelectElement.clientHeight &&
                                            (selectCellElements.length === 0 || (selectCellElements.length > 0 && item.offsetTop === selectCellElements[0].offsetTop))) {
                                            selectCellElements.push(item);
                                        }
                                    });
                                    tableBlockElement.querySelector("table").classList.remove("select");
                                    tableSelectElement.removeAttribute("style");
                                    setTableAlign(protyle, selectCellElements, tableBlockElement, "left", getEditorRange(tableBlockElement));
                                }
                            }
                        }).element);
                        window.siyuan.menus.menu.append(new MenuItem({
                            icon: "iconAlignCenter",
                            accelerator: window.siyuan.config.keymap.editor.general.alignCenter.custom,
                            label: window.siyuan.languages.alignCenter,
                            click: () => {
                                if (tableBlockElement) {
                                    const selectCellElements: HTMLTableCellElement[] = [];
                                    const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
                                    tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                                        if (!item.classList.contains("fn__none") &&
                                            item.offsetLeft + 6 > tableSelectElement.offsetLeft + scrollLeft && item.offsetLeft + item.clientWidth - 6 < tableSelectElement.offsetLeft + scrollLeft + tableSelectElement.clientWidth &&
                                            item.offsetTop + 6 > tableSelectElement.offsetTop && item.offsetTop + item.clientHeight - 6 < tableSelectElement.offsetTop + tableSelectElement.clientHeight &&
                                            (selectCellElements.length === 0 || (selectCellElements.length > 0 && item.offsetTop === selectCellElements[0].offsetTop))) {
                                            selectCellElements.push(item);
                                        }
                                    });
                                    tableBlockElement.querySelector("table").classList.remove("select");
                                    tableSelectElement.removeAttribute("style");
                                    setTableAlign(protyle, selectCellElements, tableBlockElement, "center", getEditorRange(tableBlockElement));
                                }
                            }
                        }).element);
                        window.siyuan.menus.menu.append(new MenuItem({
                            icon: "iconAlignRight",
                            accelerator: window.siyuan.config.keymap.editor.general.alignRight.custom,
                            label: window.siyuan.languages.alignRight,
                            click: () => {
                                if (tableBlockElement) {
                                    const selectCellElements: HTMLTableCellElement[] = [];
                                    const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
                                    tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                                        if (!item.classList.contains("fn__none") &&
                                            item.offsetLeft + 6 > tableSelectElement.offsetLeft + scrollLeft && item.offsetLeft + item.clientWidth - 6 < tableSelectElement.offsetLeft + scrollLeft + tableSelectElement.clientWidth &&
                                            item.offsetTop + 6 > tableSelectElement.offsetTop && item.offsetTop + item.clientHeight - 6 < tableSelectElement.offsetTop + tableSelectElement.clientHeight &&
                                            (selectCellElements.length === 0 || (selectCellElements.length > 0 && item.offsetTop === selectCellElements[0].offsetTop))) {
                                            selectCellElements.push(item);
                                        }
                                    });
                                    tableBlockElement.querySelector("table").classList.remove("select");
                                    tableSelectElement.removeAttribute("style");
                                    setTableAlign(protyle, selectCellElements, tableBlockElement, "right", getEditorRange(tableBlockElement));
                                }
                            }
                        }).element);
                        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                        window.siyuan.menus.menu.append(new MenuItem({
                            label: window.siyuan.languages.remove,
                            icon: "iconTrashcan",
                            click() {
                                if (tableBlockElement) {
                                    const selectCellElements: HTMLTableCellElement[] = [];
                                    const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
                                    tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                                        if (!item.classList.contains("fn__none") &&
                                            item.offsetLeft + 6 > tableSelectElement.offsetLeft + scrollLeft && item.offsetLeft + item.clientWidth - 6 < tableSelectElement.offsetLeft + scrollLeft + tableSelectElement.clientWidth &&
                                            item.offsetTop + 6 > tableSelectElement.offsetTop && item.offsetTop + item.clientHeight - 6 < tableSelectElement.offsetTop + tableSelectElement.clientHeight) {
                                            selectCellElements.push(item);
                                        }
                                    });
                                    tableBlockElement.querySelector("table").classList.remove("select");
                                    tableSelectElement.removeAttribute("style");
                                    const oldHTML = tableBlockElement.outerHTML;
                                    selectCellElements.forEach(item => {
                                        item.innerHTML = "";
                                    });
                                    updateTransaction(protyle, tableBlockElement.getAttribute("data-node-id"), tableBlockElement.outerHTML, oldHTML);
                                }
                            }
                        }).element);
                        window.siyuan.menus.menu.popup({x: mouseUpEvent.clientX - 8, y: mouseUpEvent.clientY - 16});
                    }
                }

                const ids: string[] = [];
                const selectElement = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
                selectElement.forEach(item => {
                    ids.push(item.getAttribute("data-node-id"));
                });
                countBlockWord(ids);
                // 划选后不能存在跨块的 range https://github.com/siyuan-note/siyuan/issues/4473
                if (getSelection().rangeCount > 0) {
                    const range = getSelection().getRangeAt(0);
                    if (range.toString() === "" ||
                        window.siyuan.shiftIsPressed  // https://ld246.com/article/1650096678723
                    ) {
                        if (event.detail === 3) {
                            // table 前或最后一个 cell 三击状态不对
                            let cursorElement = hasClosestBlock(range.startContainer) as Element;
                            if (cursorElement) {
                                if (cursorElement.nextElementSibling?.classList.contains("table")) {
                                    setLastNodeRange(getContenteditableElement(cursorElement), range, false);
                                } else if (cursorElement.classList.contains("table")) {
                                    const cellElements = cursorElement.querySelectorAll("th, td");
                                    cursorElement = cellElements[cellElements.length - 1];
                                    if (cursorElement.contains(range.startContainer)) {
                                        setLastNodeRange(cursorElement, range, false);
                                    }
                                }
                            }
                        }
                        return;
                    }
                    if (selectElement.length > 0) {
                        range.collapse(true);
                        return;
                    }
                    const startBlockElement = hasClosestBlock(range.startContainer);
                    let endBlockElement: false | HTMLElement;
                    if (mouseUpEvent.detail === 3 && range.endContainer.nodeType !== 3 && (range.endContainer as HTMLElement).tagName === "DIV" && range.endOffset === 0) {
                        // 三击选中段落块时，rangeEnd 会在下一个块
                        if ((range.endContainer as HTMLElement).classList.contains("protyle-attr")) {
                            // 三击在悬浮层中会选择到 attr https://github.com/siyuan-note/siyuan/issues/4636
                            range.setEndAfter(range.endContainer.previousSibling.lastChild);
                        }
                    } else {
                        endBlockElement = hasClosestBlock(range.endContainer);
                    }
                    if (startBlockElement && endBlockElement && !endBlockElement.isSameNode(startBlockElement)) {
                        range.collapse(true);
                    }
                }
            };
        });
    }

    private bindEvent(protyle: IProtyle) {
        this.element.addEventListener("focusout", () => {
            if (getSelection().rangeCount > 0 && !this.element.contains(getSelection().getRangeAt(0).startContainer)) {
                // 对 ctrl+tab 切换后 range 已经在新页面中才会触发的 focusout 进行忽略，因为在切换之前已经 dispatchEvent 了。
                if (!protyle.toolbar.range) {
                    protyle.toolbar.range = this.element.ownerDocument.createRange();
                    protyle.toolbar.range.setStart(getContenteditableElement(this.element) || this.element, 0);
                    protyle.toolbar.range.collapse(true);
                }
            } else {
                protyle.toolbar.range = getEditorRange(this.element);
            }
        });

        this.element.addEventListener("cut", (event: ClipboardEvent & { target: HTMLElement }) => {
            window.siyuan.ctrlIsPressed = false; // https://github.com/siyuan-note/siyuan/issues/6373
            if (event.target.tagName === "PROTYLE-HTML") {
                event.stopPropagation();
                return;
            }
            event.stopPropagation();
            event.preventDefault();

            if (protyle.options.render.breadcrumb) {
                protyle.breadcrumb.hide();
            }
            const range = getEditorRange(protyle.wysiwyg.element);
            let nodeElement = hasClosestBlock(range.startContainer);
            if (!nodeElement) {
                return;
            }
            const selectImgElement = nodeElement.querySelector(".img--select");
            let selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0 && range.toString() === "" && !range.cloneContents().querySelector("img") &&
                !selectImgElement) {
                nodeElement.classList.add("protyle-wysiwyg--select");
                selectElements = [nodeElement];
            }
            let html = "";
            if (selectElements.length > 0) {
                if (selectElements[0].getAttribute("data-type") === "NodeListItem" && selectElements[0].parentElement.childElementCount - 1 === selectElements.length) {
                    html = selectElements[0].parentElement.outerHTML;
                } else {
                    selectElements.forEach(item => {
                        const topElement = getTopAloneElement(item);
                        if (item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
                            html += removeEmbed(topElement).replace('fold="1"', "");
                        } else {
                            html += removeEmbed(topElement);
                        }
                    });
                    if (selectElements[0].getAttribute("data-type") === "NodeListItem") {
                        html = `<div data-subtype="${selectElements[0].getAttribute("data-subtype")}" data-node-id="${Lute.NewNodeID()}" data-type="NodeList" class="list">${html}<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
                    }
                }
                const nextElement = getNextBlock(selectElements[selectElements.length - 1]);
                removeBlock(protyle, nodeElement, range);
                if (nextElement) {
                    // Ctrl+X 剪切后光标应跳到下一行行首 https://github.com/siyuan-note/siyuan/issues/5485
                    focusBlock(nextElement);
                }
            } else {
                const id = nodeElement.getAttribute("data-node-id");
                const oldHTML = nodeElement.outerHTML;
                const tempElement = document.createElement("div");
                // 首次选中标题时，range.startContainer 会为空
                let startContainer = range.startContainer;
                if (startContainer.nodeType === 3 && startContainer.textContent === "") {
                    const nextSibling = hasNextSibling(range.startContainer);
                    if (nextSibling) {
                        startContainer = nextSibling;
                    }
                }
                // 选中整个标题 https://github.com/siyuan-note/siyuan/issues/4329
                const headElement = hasClosestByAttribute(startContainer, "data-type", "NodeHeading");
                let isFoldHeading = false;
                if (headElement && range.toString() === headElement.firstElementChild.textContent) {
                    const doOperations: IOperation[] = [{
                        action: "delete",
                        id: headElement.getAttribute("data-node-id")
                    }];
                    const undoOperations: IOperation[] = [{
                        action: "insert",
                        id: headElement.getAttribute("data-node-id"),
                        data: headElement.outerHTML,
                        previousID: headElement.previousElementSibling?.getAttribute("data-node-id"),
                        parentID: headElement.parentElement?.getAttribute("data-node-id") || protyle.block.parentID
                    }];
                    if (headElement.getAttribute("fold") === "1") {
                        isFoldHeading = true;
                        const headCloneElement = headElement.cloneNode(true) as HTMLElement;
                        headCloneElement.removeAttribute("fold");
                        tempElement.append(headCloneElement);
                        undoOperations[0].data = headCloneElement.outerHTML;
                        setFold(protyle, headElement, undefined, true);
                    } else {
                        if ((headElement.parentElement.childElementCount === 3 && headElement.parentElement.classList.contains("li")) ||
                            (headElement.parentElement.childElementCount === 2 && (headElement.parentElement.classList.contains("bq") || headElement.parentElement.classList.contains("sb"))) ||
                            (headElement.parentElement.childElementCount === 1 && headElement.parentElement.classList.contains("protyle-wysiwyg"))  // 全选剪切标题
                        ) {
                            // https://github.com/siyuan-note/siyuan/issues/4040
                            const emptyId = Lute.NewNodeID();
                            const emptyElement = genEmptyElement(false, false, emptyId);
                            doOperations.push({
                                id: emptyId,
                                data: emptyElement.outerHTML,
                                action: "insert",
                                parentID: headElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
                            });
                            undoOperations.push({
                                id: emptyId,
                                action: "delete",
                            });
                            headElement.before(emptyElement);
                        }
                        focusSideBlock(headElement);
                        tempElement.append(headElement);
                    }
                    transaction(protyle, doOperations, undoOperations);
                } else if (range.toString() !== "" && startContainer.isSameNode(range.endContainer) && range.startContainer.nodeType === 3
                    && range.endOffset === range.endContainer.textContent.length && range.startOffset === 0 &&
                    !["DIV", "TD", "TH", "TR"].includes(range.startContainer.parentElement.tagName)) {
                    // 选中整个内联元素
                    tempElement.append(range.startContainer.parentElement);
                } else if (selectImgElement) {
                    tempElement.append(selectImgElement);
                } else if (range.startContainer.nodeType === 3 && range.startContainer.parentElement.tagName === "SPAN" &&
                    range.startContainer.parentElement.isSameNode(range.endContainer.parentElement)) {
                    // 剪切粗体等字体中的一部分
                    const spanElement = range.startContainer.parentElement;
                    const attributes = spanElement.attributes;
                    const newSpanElement = document.createElement("span");
                    for (let i = 0; i < attributes.length; i++) {
                        newSpanElement.setAttribute(attributes[i].name, attributes[i].value);
                    }
                    if (spanElement.getAttribute("data-type").indexOf("block-ref") > -1 &&
                        spanElement.getAttribute("data-subtype") === "d") {
                        // 引用被剪切后需变为静态锚文本
                        newSpanElement.setAttribute("data-subtype", "s");
                        spanElement.setAttribute("data-subtype", "s");
                    }
                    newSpanElement.textContent = range.toString();
                    range.deleteContents();
                    tempElement.append(newSpanElement);
                } else {
                    if (range.cloneContents().querySelectorAll("td, th").length > 0) {
                        // 表格内多格子 cut https://github.com/siyuan-note/insider/issues/564
                        const wbrElement = document.createElement("wbr");
                        range.insertNode(wbrElement);
                        range.setStartAfter(wbrElement);
                        tempElement.append(range.extractContents());
                        nodeElement.outerHTML = protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
                        nodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
                        focusByWbr(nodeElement, range);
                    } else {
                        const inlineMathElement = hasClosestByAttribute(range.commonAncestorContainer, "data-type", "inline-math");
                        if (inlineMathElement) {
                            // 表格内剪切数学公式 https://ld246.com/article/1631708573504
                            tempElement.append(inlineMathElement);
                        } else {
                            tempElement.append(range.extractContents());
                            let parentElement: Element | false;
                            // https://ld246.com/article/1647689760545
                            if (nodeElement.classList.contains("table")) {
                                parentElement = hasClosestByMatchTag(range.startContainer, "TD") || hasClosestByMatchTag(range.startContainer, "TH");
                            } else {
                                parentElement = getContenteditableElement(nodeElement);
                            }
                            if (parentElement) {
                                // 引用文本剪切 https://ld246.com/article/1647689760545
                                // 表格多行剪切 https://ld246.com/article/1652603836350
                                Array.from(parentElement.children).forEach(item => {
                                    if (item.textContent === "" && (item.nodeType === 1 && item.tagName !== "BR")) {
                                        item.remove();
                                    }
                                });
                            }
                        }
                    }
                }
                html = tempElement.innerHTML;
                // https://github.com/siyuan-note/siyuan/issues/4321
                if (!nodeElement.classList.contains("table")) {
                    const editableElement = getContenteditableElement(nodeElement);
                    if (editableElement && editableElement.textContent === "") {
                        editableElement.innerHTML = "";
                    }
                }
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                if (nodeElement.getAttribute("data-type") === "NodeCodeBlock") {
                    range.insertNode(document.createElement("wbr"));
                    getContenteditableElement(nodeElement).removeAttribute("data-render");
                    highlightRender(nodeElement);
                }
                if (nodeElement.parentElement.parentElement && !isFoldHeading) {
                    // 选中 heading 时，使用删除的 transaction
                    updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                }
            }
            protyle.hint.render(protyle);
            event.clipboardData.setData("text/plain", protyle.lute.BlockDOM2StdMd(html).trimEnd());  // 需要 trimEnd，否则 \n 会导致 https://github.com/siyuan-note/siyuan/issues/6218
            event.clipboardData.setData("text/html", Constants.ZWSP + html);
        });

        let beforeContextmenuRange: Range;
        this.element.addEventListener("contextmenu", (event: MouseEvent & { detail: any }) => {
            event.stopPropagation();
            event.preventDefault();
            const x = event.clientX || event.detail.x;
            const y = event.clientY || event.detail.y;
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 1) {
                // 多选块
                hideElements(["util"], protyle);
                protyle.gutter.renderMenu(protyle, selectElements[0]);
                window.siyuan.menus.menu.popup({x, y});
                return;
            }
            const target = event.detail.target || event.target as HTMLElement;
            const embedElement = hasClosestByAttribute(target, "data-type", "NodeBlockQueryEmbed");
            if (embedElement) {
                if (getSelection().rangeCount === 0) {
                    focusSideBlock(embedElement);
                }
                protyle.gutter.renderMenu(protyle, embedElement);
                window.siyuan.menus.menu.popup({x, y});
                return false;
            }
            if (protyle.disabled) {
                return false;
            }
            protyle.toolbar.range = getEditorRange(protyle.element);
            if (target.tagName === "SPAN") { // https://ld246.com/article/1665141518103
                const types = protyle.toolbar.getCurrentType(protyle.toolbar.range);
                if (types.includes("block-ref")) {
                    refMenu(protyle, target);
                    // 阻止 popover
                    target.setAttribute("prevent-popover", "true");
                    setTimeout(() => {
                        target.removeAttribute("prevent-popover");
                    }, 620);
                    return false;
                }
                if (types.includes("file-annotation-ref")) {
                    protyle.toolbar.showFileAnnotationRef(protyle, target);
                    return false;
                }
                if (types.includes("inline-memo")) {
                    protyle.toolbar.showRender(protyle, target);
                    return false;
                }
                if (types.includes("a")) {
                    linkMenu(protyle, target);
                    if (target.getAttribute("data-href")?.startsWith("siyuan://blocks")) {
                        // 阻止 popover
                        target.setAttribute("prevent-popover", "true");
                        setTimeout(() => {
                            target.removeAttribute("prevent-popover");
                        }, 620);
                    }
                    return false;
                }
            }
            if (target.tagName === "IMG" && hasClosestByClassName(target, "img")) {
                imgMenu(protyle, protyle.toolbar.range, target.parentElement.parentElement, {
                    clientX: x + 4,
                    clientY: y
                });
                return false;
            }
            const nodeElement = hasClosestBlock(target);
            if (!nodeElement) {
                return false;
            }
            if (!isNotEditBlock(nodeElement) &&
                (isMobile() || event.detail.target || (beforeContextmenuRange && nodeElement.contains(beforeContextmenuRange.startContainer)))
            ) {
                if (!isMobile() || protyle.toolbar?.element.classList.contains("fn__none")) {
                    contentMenu(protyle, nodeElement);
                    window.siyuan.menus.menu.popup({x, y: y + 13, h: 26});
                    protyle.toolbar?.element.classList.add("fn__none");
                    if (nodeElement.classList.contains("table")) {
                        nodeElement.querySelector("table").classList.remove("select");
                        nodeElement.querySelector(".table__select").removeAttribute("style");
                    }
                }
            } else if (protyle.toolbar.range.toString() === "") {
                hideElements(["util"], protyle);
                if (protyle.gutter) {
                    protyle.gutter.renderMenu(protyle, nodeElement);
                }
                window.siyuan.menus.menu.popup({x, y});
                protyle.toolbar?.element.classList.add("fn__none");
            }
        });

        this.element.addEventListener("pointerdown", () => {
            if (getSelection().rangeCount > 0) {
                beforeContextmenuRange = getSelection().getRangeAt(0);
            } else {
                beforeContextmenuRange = undefined;
            }
        });

        let preventGetTopHTML = false;
        this.element.addEventListener("mousewheel", (event: WheelEvent) => {
            // https://ld246.com/article/1648865235549
            // 不能使用上一版本的 timeStamp，否则一直滚动将导致间隔不够 https://ld246.com/article/1662852664926
            if (!preventGetTopHTML &&
                event.deltaY < 0 && !protyle.scroll.element.classList.contains("fn__none") &&
                protyle.contentElement.clientHeight === protyle.contentElement.scrollHeight &&
                protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") !== "true") {
                fetchPost("/api/filetree/getDoc", {
                    id: protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-id"),
                    mode: 1,
                    k: protyle.options.key || "",
                    size: Constants.SIZE_GET,
                }, getResponse => {
                    preventGetTopHTML = false;
                    onGet(getResponse, protyle, [Constants.CB_GET_BEFORE, Constants.CB_GET_UNCHANGEID]);
                });
                preventGetTopHTML = true;
            }
            if (event.deltaX === 0) {
                return;
            }
            // https://github.com/siyuan-note/siyuan/issues/4099
            const tableElement = hasClosestByClassName(event.target as HTMLElement, "table");
            if (tableElement) {
                const tableSelectElement = tableElement.querySelector(".table__select") as HTMLElement;
                if (tableSelectElement?.style.width) {
                    tableSelectElement.removeAttribute("style");
                    window.siyuan.menus.menu.remove();
                }
            }
        }, {passive: true});

        let overAttr = false;
        this.element.addEventListener("mouseover", (event: MouseEvent & { target: Element }) => {
            const attrElement = hasClosestByClassName(event.target, "protyle-attr");
            if (attrElement) {
                overAttr = true;
                attrElement.parentElement.classList.add("protyle-wysiwyg--hl");
                return;
            } else if (overAttr) {
                const hlElement = protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--hl");
                if (hlElement) {
                    hlElement.classList.remove("protyle-wysiwyg--hl");
                }
                overAttr = false;
            }
            if (hasClosestByClassName(event.target, "protyle-action") || !protyle.options.render.gutter) {
                return;
            }
            const nodeElement = hasClosestBlock(event.target);
            if (nodeElement && (nodeElement.classList.contains("list") || nodeElement.classList.contains("li"))) {
                // 光标在列表下部应显示右侧的元素，而不是列表本身。放在 globalShortcut 中的 mousemove 下处理
                return;
            }
            if (nodeElement) {
                const embedElement = hasClosestByAttribute(nodeElement, "data-type", "NodeBlockQueryEmbed");
                if (embedElement) {
                    protyle.gutter.render(protyle, embedElement, this.element);
                } else {
                    protyle.gutter.render(protyle, nodeElement, this.element);
                }
            }
        });

        this.element.addEventListener("paste", (event: ClipboardEvent & { target: HTMLElement }) => {
            window.siyuan.ctrlIsPressed = false; // https://github.com/siyuan-note/siyuan/issues/6373
            // https://github.com/siyuan-note/siyuan/issues/4600
            if (event.target.tagName === "PROTYLE-HTML") {
                event.stopPropagation();
                return;
            }
            paste(protyle, event);
        });

        // 输入法测试点 https://github.com/siyuan-note/siyuan/issues/3027
        let isComposition = false; // for iPhone
        this.element.addEventListener("compositionstart", (event) => {
            // 搜狗输入法划选输入后无 data https://github.com/siyuan-note/siyuan/issues/4672
            const range = getEditorRange(protyle.wysiwyg.element);
            const nodeElement = hasClosestBlock(range.startContainer);
            if (nodeElement && typeof protyle.wysiwyg.lastHTMLs[nodeElement.getAttribute("data-node-id")] === "undefined") {
                range.insertNode(document.createElement("wbr"));
                protyle.wysiwyg.lastHTMLs[nodeElement.getAttribute("data-node-id")] = nodeElement.outerHTML;
                nodeElement.querySelector("wbr").remove();
            }
            isComposition = true;
            event.stopPropagation();
        });

        this.element.addEventListener("compositionend", (event: InputEvent) => {
            event.stopPropagation();
            isComposition = false;
            const range = getEditorRange(this.element);
            const blockElement = hasClosestBlock(range.startContainer);
            if (blockElement && blockElement.getAttribute("data-type") === "NodeHTMLBlock") {
                return;
            }
            if (!blockElement) {
                return;
            }
            if ("" !== event.data) {
                this.escapeInline(protyle, range, event);
                // 小鹤音形 ;k 不能使用 setTimeout;
                // wysiwyg.element contenteditable 为 false 时，连拼 needRender 必须为 false
                // hr 渲染；任务列表、粗体、数学公示结尾 needRender 必须为 true
                input(protyle, blockElement, range, true);
            } else {
                const id = blockElement.getAttribute("data-node-id");
                if (protyle.wysiwyg.lastHTMLs[id]) {
                    updateTransaction(protyle, id, blockElement.outerHTML, protyle.wysiwyg.lastHTMLs[id]);
                }
            }
        });

        this.element.addEventListener("input", (event: InputEvent) => {
            const target = event.target as HTMLElement;
            if (target.tagName === "VIDEO" || target.tagName === "AUDIO" || event.inputType === "historyRedo") {
                return;
            }
            /// #if !BROWSER
            if (event.inputType === "historyUndo") {
                getCurrentWindow().webContents.redo();
                window.siyuan.menus.menu.remove();
                return;
            }
            /// #endif
            const range = getEditorRange(this.element);
            const blockElement = hasClosestBlock(range.startContainer);
            if (!blockElement) {
                return;
            }
            if (blockElement && blockElement.getAttribute("data-type") === "NodeHTMLBlock") {
                event.stopPropagation();
                return;
            }
            if (event.isComposing || isComposition ||
                // https://github.com/siyuan-note/siyuan/issues/337 编辑器内容拖拽问题
                event.inputType === "deleteByDrag" || event.inputType === "insertFromDrop"
            ) {
                return;
            }
            this.escapeInline(protyle, range, event);
            if (/^\d{1}$/.test(event.data) || event.data === "‘" || event.data === "“") {
                setTimeout(() => {
                    input(protyle, blockElement, range, true); // 搜狗拼音数字后面句号变为点；Mac 反向双引号无法输入
                });
            } else {
                if (event.data === ":") {
                    protyle.hint.enableEmoji = true;
                }
                input(protyle, blockElement, range, true);
            }
            event.stopPropagation();
        });

        this.element.addEventListener("keyup", (event) => {
            const range = getEditorRange(this.element).cloneRange();
            if (event.key !== "PageUp" && event.key !== "PageDown" && event.key !== "Home" && event.key !== "End" && event.key.indexOf("Arrow") === -1 &&
                event.key !== "Alt" && event.key !== "Shift" && event.key !== "CapsLock" && event.key !== "Escape" && event.key !== "Meta" && !/^F\d{1,2}$/.test(event.key) &&
                (!event.isComposing || (event.isComposing && range.toString() !== "")) // https://github.com/siyuan-note/siyuan/issues/4341
            ) {
                // 搜狗输入法不走 keydown，需重新记录历史状态
                const nodeElement = hasClosestBlock(range.startContainer);
                if (nodeElement && typeof protyle.wysiwyg.lastHTMLs[nodeElement.getAttribute("data-node-id")] === "undefined") {
                    range.insertNode(document.createElement("wbr"));
                    protyle.wysiwyg.lastHTMLs[nodeElement.getAttribute("data-node-id")] = nodeElement.outerHTML;
                    nodeElement.querySelector("wbr").remove();
                }
                return;
            }

            // 需放在 lastHTMLs 后，否则 https://github.com/siyuan-note/siyuan/issues/4388
            if (this.preventKeyup) {
                return;
            }

            if ((event.shiftKey || isCtrl(event)) && !event.isComposing && range.toString() !== "") {
                // 工具栏
                protyle.toolbar.render(protyle, range, event);
                countSelectWord(range);
            }

            if (event.eventPhase !== 3 && !event.shiftKey && (event.key.indexOf("Arrow") > -1 || event.key === "Home" || event.key === "End" || event.key === "PageUp" || event.key === "PageDown") && !event.isComposing) {
                const nodeElement = hasClosestBlock(range.startContainer);
                if (nodeElement) {
                    this.setEmptyOutline(protyle, nodeElement);
                    if (range.toString() === "") {
                        countSelectWord(range, protyle.block.rootID);
                    }
                }
                event.stopPropagation();
            }
        });

        this.element.addEventListener("dblclick", (event: MouseEvent & { target: HTMLElement }) => {
            if (event.target.tagName === "IMG") {
                previewImage((event.target as HTMLImageElement).src, protyle.block.rootID);
                return;
            }
        });

        let shiftStartElement: HTMLElement;
        this.element.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            hideElements(["hint", "util"], protyle);
            /// #if !MOBILE
            const backlinkBreadcrumbItemElement = hasClosestByClassName(event.target, "protyle-breadcrumb__item");
            if (backlinkBreadcrumbItemElement) {
                const breadcrumbId = backlinkBreadcrumbItemElement.getAttribute("data-id");
                if (breadcrumbId) {
                    if (window.siyuan.ctrlIsPressed) {
                        openFileById({id: breadcrumbId, action: [Constants.CB_GET_FOCUS]});
                    } else {
                        loadBreadcrumb(protyle, backlinkBreadcrumbItemElement);
                    }
                } else {
                    // 引用标题时的更多加载
                    getBacklinkHeadingMore(backlinkBreadcrumbItemElement);
                }
                event.stopPropagation();
                return;
            }
            /// #endif
            if (!window.siyuan.shiftIsPressed) {
                shiftStartElement = undefined;
            }
            this.setEmptyOutline(protyle, event.target);
            const tableElement = hasClosestByClassName(event.target, "table");
            this.element.querySelectorAll(".table").forEach(item => {
                if (!tableElement || !item.isSameNode(tableElement)) {
                    item.querySelector("table").classList.remove("select");
                    item.querySelector(".table__select").removeAttribute("style");
                }
                if (tableElement && tableElement.isSameNode(item) && item.querySelector(".table__select").getAttribute("style")) {
                    // 防止合并单元格的菜单消失
                    event.stopPropagation();
                }
            });
            const range = getEditorRange(this.element);
            // 需放在嵌入块之前，否则嵌入块内的引用、链接、pdf 双链无法点击打开 https://ld246.com/article/1630479789513
            const blockRefElement = hasClosestByAttribute(event.target, "data-type", "block-ref");
            const aElement = hasClosestByAttribute(event.target, "data-type", "a");
            if (blockRefElement ||
                (aElement && aElement.getAttribute("data-href").startsWith("siyuan://blocks/"))
            ) {
                event.stopPropagation();
                event.preventDefault();
                hideElements(["dialog", "toolbar"], protyle);
                if (range.toString() !== "" && !window.siyuan.shiftIsPressed) {
                    // 选择不打开引用
                    return;
                }
                let refBlockId: string;
                if (blockRefElement) {
                    refBlockId = blockRefElement.getAttribute("data-id");
                } else if (aElement) {
                    refBlockId = aElement.getAttribute("data-href").substring(16, 38);
                }

                fetchPost("/api/block/checkBlockFold", {id: refBlockId}, (foldResponse) => {
                    /// #if MOBILE
                    openMobileFileById(refBlockId, foldResponse.data ? [Constants.CB_GET_ALL, Constants.CB_GET_HL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]);
                    /// #else
                    if (window.siyuan.shiftIsPressed) {
                        openFileById({
                            id: refBlockId,
                            position: "bottom",
                            action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                            zoomIn: foldResponse.data
                        });
                    } else if (window.siyuan.altIsPressed) {
                        openFileById({
                            id: refBlockId,
                            position: "right",
                            action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                            zoomIn: foldResponse.data
                        });
                    } else if (window.siyuan.ctrlIsPressed) {
                        openFileById({
                            id: refBlockId,
                            action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT],
                            keepCursor: true,
                            zoomIn: foldResponse.data
                        });
                    } else {
                        openFileById({
                            id: refBlockId,
                            action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                            zoomIn: foldResponse.data
                        });
                    }
                    /// #endif
                });
                /// #if !MOBILE
                if (protyle.model) {
                    // 打开双链需记录到后退中 https://github.com/siyuan-note/insider/issues/801
                    let blockElement: HTMLElement | false;
                    if (blockRefElement) {
                        blockElement = hasClosestBlock(blockRefElement);
                    } else if (aElement) {
                        blockElement = hasClosestBlock(aElement);
                    }
                    if (blockElement) {
                        pushBack(protyle, getEditorRange(this.element), blockElement);
                    }
                }
                /// #endif
                return;
            }

            const fileElement = hasClosestByAttribute(event.target, "data-type", "file-annotation-ref");
            if (fileElement && range.toString() === "") {
                event.stopPropagation();
                event.preventDefault();
                const fileIds = fileElement.getAttribute("data-id").split("/");
                const linkAddress = `assets/${fileIds[1]}`;
                /// #if MOBILE
                openByMobile(linkAddress);
                /// #else
                if (window.siyuan.ctrlIsPressed) {
                    openBy(linkAddress, "folder");
                } else if (window.siyuan.shiftIsPressed) {
                    openBy(linkAddress, "app");
                } else {
                    openAsset(linkAddress, fileIds[2], "right");
                }
                /// #endif
                return;
            }

            if (aElement && !window.siyuan.altIsPressed) {
                event.stopPropagation();
                event.preventDefault();
                const linkAddress = aElement.getAttribute("data-href");
                /// #if MOBILE
                openByMobile(linkAddress);
                /// #else
                if (isLocalPath(linkAddress)) {
                    const linkPathname = linkAddress.split("?page")[0];
                    if (Constants.SIYUAN_ASSETS_EXTS.includes(pathPosix().extname(linkPathname)) &&
                        (!linkPathname.endsWith(".pdf") ||
                            (linkPathname.endsWith(".pdf") && !linkAddress.startsWith("file://")))
                    ) {
                        if (window.siyuan.ctrlIsPressed) {
                            openBy(linkAddress, "folder");
                        } else if (window.siyuan.shiftIsPressed) {
                            openBy(linkAddress, "app");
                        } else {
                            const page = getSearch("page", linkAddress);
                            openAsset(linkPathname, page === "" ? undefined : parseInt(page), "right");
                        }
                    } else {
                        /// #if !BROWSER
                        if (window.siyuan.ctrlIsPressed) {
                            openBy(linkAddress, "folder");
                        } else {
                            openBy(linkAddress, "app");
                        }
                        /// #else
                        openByMobile(linkAddress);
                        /// #endif
                    }
                } else {
                    /// #if !BROWSER
                    shell.openExternal(linkAddress).catch((e) => {
                        showMessage(e);
                    });
                    /// #else
                    openByMobile(linkAddress);
                    /// #endif
                }
                /// #endif
                return;
            }

            /// #if !MOBILE
            const tagElement = hasClosestByAttribute(event.target, "data-type", "tag");
            if (tagElement && !window.siyuan.altIsPressed && protyle.model) {
                openGlobalSearch(`#${tagElement.textContent}#`, !window.siyuan.ctrlIsPressed);
                hideElements(["dialog"]);
                return;
            }
            /// #endif

            const embedItemElement = hasClosestByClassName(event.target, "protyle-wysiwyg__embed");
            if (embedItemElement) {
                const embedId = embedItemElement.getAttribute("data-id");
                /// #if MOBILE
                openMobileFileById(embedId, [Constants.CB_GET_ALL]);
                /// #else
                if (window.siyuan.shiftIsPressed) {
                    openFileById({
                        id: embedId,
                        position: "bottom",
                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL],
                        zoomIn: true
                    });
                } else if (window.siyuan.altIsPressed) {
                    openFileById({
                        id: embedId,
                        position: "right",
                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL],
                        zoomIn: true
                    });
                } else if (window.siyuan.ctrlIsPressed) {
                    openFileById({
                        id: embedId,
                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL],
                        keepCursor: true,
                        zoomIn: true
                    });
                } else if (!protyle.disabled) {
                    window.siyuan.blockPanels.push(new BlockPanel({
                        targetElement: embedItemElement,
                        nodeIds: [embedId],
                    }));
                }
                /// #endif
                event.stopPropagation();
                return;
            }

            const attrBookmarkElement = hasClosestByClassName(event.target, "protyle-attr--bookmark");
            if (attrBookmarkElement) {
                openAttr(attrBookmarkElement.parentElement.parentElement, protyle, "bookmark");
                event.stopPropagation();
                return;
            }
            const attrNameElement = hasClosestByClassName(event.target, "protyle-attr--name");
            if (attrNameElement) {
                openAttr(attrNameElement.parentElement.parentElement, protyle, "name");
                event.stopPropagation();
                return;
            }
            const attrAliasElement = hasClosestByClassName(event.target, "protyle-attr--alias");
            if (attrAliasElement) {
                openAttr(attrAliasElement.parentElement.parentElement, protyle, "alias");
                event.stopPropagation();
                return;
            }
            const attrMemoElement = hasClosestByClassName(event.target, "protyle-attr--memo");
            if (attrMemoElement) {
                openAttr(attrMemoElement.parentElement.parentElement, protyle, "memo");
                event.stopPropagation();
                return;
            }

            if (hasTopClosestByClassName(event.target, "protyle-action__copy")) {
                return;
            }

            const editElement = hasClosestByClassName(event.target, "protyle-action__edit");
            if (editElement && !protyle.disabled) {
                protyle.toolbar.showRender(protyle, editElement.parentElement.parentElement);
                event.stopPropagation();
                event.preventDefault();
                return;
            }

            const menuElement = hasClosestByClassName(event.target, "protyle-action__menu");
            if (menuElement) {
                protyle.gutter.renderMenu(protyle, menuElement.parentElement.parentElement);
                const rect = menuElement.getBoundingClientRect();
                window.siyuan.menus.menu.popup({
                    x: rect.left,
                    y: rect.top
                }, true);
                event.stopPropagation();
                event.preventDefault();
                return;
            }

            const reloadElement = hasClosestByClassName(event.target, "protyle-action__reload");
            if (reloadElement) {
                const embedReloadElement = hasClosestByAttribute(reloadElement, "data-type", "NodeBlockQueryEmbed");
                if (embedReloadElement) {
                    embedReloadElement.removeAttribute("data-render");
                    blockRender(protyle, embedReloadElement);
                }
                event.stopPropagation();
                event.preventDefault();
                return;
            }

            const languageElement = hasClosestByClassName(event.target, "protyle-action__language");
            if (languageElement && !protyle.disabled) {
                protyle.toolbar.showCodeLanguage(protyle, languageElement);
                event.stopPropagation();
                event.preventDefault();
                return;
            }

            // 需放在属性后，否则数学公式无法点击属性；需放在 action 后，否则嵌入块的的 action 无法打开；需放在嵌入块后，否则嵌入块中的数学公式会被打开
            const mathElement = hasClosestByAttribute(event.target, "data-subtype", "math");
            if (!window.siyuan.shiftIsPressed && !window.siyuan.ctrlIsPressed && mathElement && !protyle.disabled) {
                protyle.toolbar.showRender(protyle, mathElement);
                event.stopPropagation();
                return;
            }

            const actionElement = hasClosestByClassName(event.target, "protyle-action");
            if (actionElement) {
                const type = actionElement.parentElement.parentElement.getAttribute("data-type");
                if (type === "img" && !protyle.disabled) {
                    imgMenu(protyle, range, actionElement.parentElement.parentElement, {
                        clientX: event.clientX + 4,
                        clientY: event.clientY
                    });
                } else if (!protyle.disabled && actionElement.parentElement.classList.contains("li")) {
                    if (window.siyuan.altIsPressed) {
                        // 展开/折叠当前层级的所有列表项
                        if (actionElement.parentElement.parentElement.classList.contains("protyle-wysiwyg")) {
                            // 缩放列表项 https://ld246.com/article/1653123034794
                            setFold(protyle, actionElement.parentElement);
                        } else {
                            let hasFold = true;
                            const oldHTML = actionElement.parentElement.parentElement.outerHTML;
                            Array.from(actionElement.parentElement.parentElement.children).find((listItemElement) => {
                                if (listItemElement.classList.contains("li")) {
                                    if (listItemElement.getAttribute("fold") !== "1" && listItemElement.childElementCount > 3) {
                                        hasFold = false;
                                        return true;
                                    }
                                }
                            });
                            Array.from(actionElement.parentElement.parentElement.children).find((listItemElement) => {
                                if (listItemElement.classList.contains("li")) {
                                    if (hasFold) {
                                        listItemElement.removeAttribute("fold");
                                    } else if (listItemElement.childElementCount > 3) {
                                        listItemElement.setAttribute("fold", "1");
                                    }
                                }
                            });
                            updateTransaction(protyle, actionElement.parentElement.parentElement.getAttribute("data-node-id"), actionElement.parentElement.parentElement.outerHTML, oldHTML);
                        }
                        hideElements(["gutter"], protyle);
                    } else if (window.siyuan.shiftIsPressed) {
                        openAttr(actionElement.parentElement, protyle);
                    } else if (window.siyuan.ctrlIsPressed) {
                        zoomOut(protyle, actionElement.parentElement.getAttribute("data-node-id"));
                    } else {
                        if (actionElement.classList.contains("protyle-action--task")) {
                            const html = actionElement.parentElement.outerHTML;
                            if (actionElement.parentElement.classList.contains("protyle-task--done")) {
                                actionElement.querySelector("use").setAttribute("xlink:href", "#iconUncheck");
                                actionElement.parentElement.classList.remove("protyle-task--done");
                            } else {
                                actionElement.querySelector("use").setAttribute("xlink:href", "#iconCheck");
                                actionElement.parentElement.classList.add("protyle-task--done");
                            }
                            actionElement.parentElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                            updateTransaction(protyle, actionElement.parentElement.getAttribute("data-node-id"), actionElement.parentElement.outerHTML, html);
                        } else {
                            protyle.gutter.renderMenu(protyle, actionElement.parentElement);
                            window.siyuan.menus.menu.popup({
                                x: event.clientX - 16,
                                y: event.clientY - 16
                            }, true);
                        }
                    }
                }
                event.stopPropagation();
                return;
            }

            const selectElement = hasClosestByClassName(event.target, "hr") ||
                hasClosestByClassName(event.target, "iframe");
            if (!window.siyuan.shiftIsPressed && !window.siyuan.ctrlIsPressed && selectElement) {
                selectElement.classList.add("protyle-wysiwyg--select");
                event.stopPropagation();
                return;
            }

            const imgElement = hasTopClosestByClassName(event.target, "img");
            if (!window.siyuan.shiftIsPressed && !window.siyuan.ctrlIsPressed && imgElement) {
                imgElement.classList.add("img--select");
                range.setStartAfter(imgElement);
                range.collapse(true);
                focusByRange(range);
                return;
            }

            // 点击空白
            if (event.target.contains(this.element) && this.element.lastElementChild && !protyle.disabled) {
                const lastRect = this.element.lastElementChild.getBoundingClientRect();
                if (event.y > lastRect.bottom) {
                    const lastEditElement = getContenteditableElement(getLastBlock(this.element.lastElementChild));
                    if (!lastEditElement ||
                        (this.element.lastElementChild.getAttribute("data-type") !== "NodeParagraph" && protyle.wysiwyg.element.getAttribute("data-doc-type") !== "NodeListItem") ||
                        (this.element.lastElementChild.getAttribute("data-type") === "NodeParagraph" && getContenteditableElement(lastEditElement).textContent !== "")) {
                        const emptyElement = genEmptyElement(false, false);
                        this.element.insertAdjacentElement("beforeend", emptyElement);
                        transaction(protyle, [{
                            action: "insert",
                            data: emptyElement.outerHTML,
                            id: emptyElement.getAttribute("data-node-id"),
                            previousID: emptyElement.previousElementSibling.getAttribute("data-node-id"),
                            parentID: protyle.block.parentID
                        }], [{
                            action: "delete",
                            id: emptyElement.getAttribute("data-node-id")
                        }]);
                        const emptyEditElement = getContenteditableElement(emptyElement) as HTMLInputElement;
                        range.selectNodeContents(emptyEditElement);
                        range.collapse(true);
                        focusByRange(range);
                    } else if (lastEditElement) {
                        range.selectNodeContents(lastEditElement);
                        range.collapse(false);
                    }
                }
            }

            setTimeout(() => {
                // 选中后，在选中的文字上点击需等待 range 更新
                const newRange = getEditorRange(this.element);
                if (newRange.toString().replace(Constants.ZWSP, "") !== "") {
                    protyle.toolbar.render(protyle, newRange);
                } else {
                    hideElements(["toolbar"], protyle);
                }
                if (!protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--select")) {
                    countSelectWord(newRange, protyle.block.rootID);
                }
                if (getSelection().rangeCount === 0) {
                    // https://github.com/siyuan-note/siyuan/issues/5901
                    focusByRange(newRange);
                }
                /// #if !MOBILE
                pushBack(protyle, newRange);
                /// #endif
            }, isMobile() ? 520 : 0); // Android 双击慢了出不来
            protyle.hint.enableEmoji = false;
            if (window.siyuan.shiftIsPressed) {
                event.preventDefault();
                event.stopPropagation();
                // shift 多选
                let startElement = hasClosestBlock(range.startContainer);
                let endElement = hasClosestBlock(event.target);
                if (startElement && endElement && startElement.isSameNode(endElement)) {
                    startElement = hasClosestBlock(range.endContainer);
                }
                if (startElement && endElement && (!startElement.isSameNode(endElement) || (shiftStartElement && shiftStartElement.isSameNode(startElement)))) {
                    let toDown = true;
                    range.collapse(true);
                    if (shiftStartElement) {
                        startElement = shiftStartElement;
                    } else {
                        shiftStartElement = startElement;
                    }
                    const startRect = startElement.getBoundingClientRect();
                    const endRect = endElement.getBoundingClientRect();
                    let startTop = startRect.top;
                    let endTop = endRect.top;
                    if (startTop === endTop) {
                        // 横排 https://ld246.com/article/1663036247544
                        startTop = startRect.right;
                        endTop = endRect.right;
                    }
                    if (startTop > endTop) {
                        const tempElement = endElement;
                        endElement = startElement;
                        startElement = tempElement;
                        const tempTop = endTop;
                        endTop = startTop;
                        startTop = tempTop;
                        toDown = false;
                    }
                    let selectElements: Element[] = [];
                    let currentElement: HTMLElement = startElement;
                    let hasJump = false;
                    while (currentElement) {
                        if (currentElement && !currentElement.classList.contains("protyle-attr")) {
                            const currentRect = currentElement.getBoundingClientRect();
                            if (startRect.top === endRect.top ? (currentRect.right <= endTop) : (currentRect.top <= endTop)) {
                                if (hasJump) {
                                    // 父节点的下个节点在选中范围内才可使用父节点作为选中节点
                                    if (currentElement.nextElementSibling && !currentElement.nextElementSibling.classList.contains("protyle-attr")) {
                                        const currentNextRect = currentElement.nextElementSibling.getBoundingClientRect();
                                        if (startRect.top === endRect.top ? (currentNextRect.right <= endTop) : (currentNextRect.top <= endTop)) {
                                            selectElements = [currentElement];
                                            currentElement = currentElement.nextElementSibling as HTMLElement;
                                            hasJump = false;
                                        } else if (currentElement.parentElement.classList.contains("sb")) {
                                            currentElement = hasClosestBlock(currentElement.parentElement) as HTMLElement;
                                            hasJump = true;
                                        } else {
                                            break;
                                        }
                                    } else {
                                        currentElement = hasClosestBlock(currentElement.parentElement) as HTMLElement;
                                        hasJump = true;
                                    }
                                } else {
                                    selectElements.push(currentElement);
                                    currentElement = currentElement.nextElementSibling as HTMLElement;
                                }
                            } else if (currentElement.parentElement.classList.contains("sb")) {
                                // 跳出超级块横向排版中的未选中元素
                                currentElement = hasClosestBlock(currentElement.parentElement) as HTMLElement;
                                hasJump = true;
                            } else {
                                break;
                            }
                        } else {
                            currentElement = hasClosestBlock(currentElement.parentElement) as HTMLElement;
                            hasJump = true;
                        }
                    }
                    if (selectElements.length === 1 && !selectElements[0].classList.contains("list") && !selectElements[0].classList.contains("bq") && !selectElements[0].classList.contains("sb")) {
                        // 单个 p 不选中
                        shiftStartElement = undefined;
                    } else {
                        const ids: string[] = [];
                        if (!protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--select") && protyle.scroll && !protyle.scroll.element.classList.contains("fn__none") && !protyle.scroll.keepLazyLoad &&
                            (startElement.getBoundingClientRect().top < -protyle.contentElement.clientHeight * 2 || endElement.getBoundingClientRect().bottom > protyle.contentElement.clientHeight * 2)) {
                            showMessage(window.siyuan.languages.crossKeepLazyLoad);
                        }
                        selectElements.forEach(item => {
                            item.classList.add("protyle-wysiwyg--select");
                            ids.push(item.getAttribute("data-node-id"));
                        });
                        countBlockWord(ids);
                        if (toDown) {
                            focusBlock(selectElements[selectElements.length - 1], protyle.wysiwyg.element, false);
                        } else {
                            focusBlock(selectElements[0], protyle.wysiwyg.element, false);
                        }
                    }
                }
            }

            if (this.element.querySelector(".protyle-wysiwyg--select") && range.toString() !== "") {
                // 选中块后，文字不能被选中。需在 shift click 之后，防止shift点击单个块出现文字选中
                range.collapse(false);
                focusByRange(range);
            }

            if (window.siyuan.ctrlIsPressed) {
                let ctrlElement = hasClosestBlock(event.target);
                if (ctrlElement) {
                    ctrlElement = getTopAloneElement(ctrlElement) as HTMLElement;
                    if (ctrlElement.classList.contains("protyle-wysiwyg--select")) {
                        ctrlElement.classList.remove("protyle-wysiwyg--select");
                        ctrlElement.removeAttribute("select-start");
                        ctrlElement.removeAttribute("select-end");
                    } else {
                        ctrlElement.classList.add("protyle-wysiwyg--select");
                    }
                    ctrlElement.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                        item.classList.remove("protyle-wysiwyg--select");
                        item.removeAttribute("select-start");
                        item.removeAttribute("select-end");
                    });
                    const ctrlParentElement = hasClosestByClassName(ctrlElement, "protyle-wysiwyg--select");
                    if (ctrlParentElement && !ctrlElement.isSameNode(ctrlParentElement)) {
                        ctrlParentElement.classList.remove("protyle-wysiwyg--select");
                        ctrlParentElement.removeAttribute("select-start");
                        ctrlParentElement.removeAttribute("select-end");
                    }
                    const ids: string[] = [];
                    protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                        ids.push(item.getAttribute("data-node-id"));
                    });
                    countBlockWord(ids);
                }
            }

            // 面包屑定位
            if (protyle.options.render.breadcrumb) {
                protyle.breadcrumb.render(protyle);
            }
        });
    }
}
