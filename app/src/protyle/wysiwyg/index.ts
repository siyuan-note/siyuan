import {enableLuteMarkdownSyntax, getTextStar, paste, restoreLuteMarkdownSyntax} from "../util/paste";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
    hasTopClosestByClassName,
    isInEmbedBlock,
} from "../util/hasClosest";
import {
    focusBlock,
    focusByRange,
    focusByWbr,
    focusSideBlock,
    getEditorRange,
    getSelectionOffset,
    setFirstNodeRange,
    setInsertWbrHTML,
    setLastNodeRange,
} from "../util/selection";
import {Constants} from "../../constants";
import {isMobile} from "../../util/functions";
import {previewDocImage} from "../preview/image";
import {
    contentMenu,
    enterBack,
    fileAnnotationRefMenu,
    imgMenu,
    inlineMathMenu,
    linkMenu,
    refMenu,
    setFold,
    tagMenu,
    zoomOut
} from "../../menus/protyle";
import * as dayjs from "dayjs";
import {dropEvent} from "../util/editorCommonEvent";
import {input} from "./input";
import {
    getContenteditableElement,
    getNextBlock,
    getTopAloneElement,
    hasNextSibling,
    hasPreviousSibling,
    isEndOfBlock,
    isNotEditBlock
} from "./getBlock";
import {transaction, updateTransaction} from "./transaction";
import {hideElements} from "../ui/hideElements";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {getEnableHTML, removeEmbed} from "./removeEmbed";
import {keydown} from "./keydown";
import {openMobileFileById} from "../../mobile/editor";
import {removeBlock} from "./remove";
import {highlightRender} from "../render/highlightRender";
import {openAttr} from "../../menus/commonMenuItem";
import {blockRender} from "../render/blockRender";
/// #if !MOBILE
import {getAllModels} from "../../layout/getAll";
import {pushBack} from "../../util/backForward";
import {openFileById} from "../../editor/util";
import {openGlobalSearch} from "../../search/util";
/// #else
import {popSearch} from "../../mobile/menu/search";
/// #endif
import {BlockPanel} from "../../block/Panel";
import {copyPlainText, encodeBase64, isInIOS, isMac, isOnlyMeta, readClipboard} from "../util/compatibility";
import {MenuItem} from "../../menus/Menu";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {onGet} from "../util/onGet";
import {clearTableCell, isIncludeCell, setTableAlign} from "../util/table";
import {countBlockWord, countSelectWord} from "../../layout/status";
import {showMessage} from "../../dialog/message";
import {getBacklinkHeadingMore, loadBreadcrumb} from "./renderBacklink";
import {removeSearchMark} from "../toolbar/util";
import {activeBlur} from "../../mobile/util/keyboardToolbar";
import {commonClick} from "./commonClick";
import {avClick, avContextmenu, updateAVName} from "../render/av/action";
import {selectRow, stickyRow} from "../render/av/row";
import {showColMenu} from "../render/av/col";
import {openViewMenu} from "../render/av/view";
import {checkFold} from "../../util/noRelyPCFunction";
import {
    addDragFill,
    dragFillCellsValue,
    genCellValueByElement,
    getCellText,
    getPositionByCellElement,
    getTypeByCellElement,
    updateCellsValue
} from "../render/av/cell";
import {openEmojiPanel, unicode2Emoji} from "../../emoji";
import {openLink} from "../../editor/openLink";
import {mathRender} from "../render/mathRender";
import {editAssetItem} from "../render/av/asset";
import {img3115} from "../../boot/compatibleVersion";
import {globalClickHideMenu} from "../../boot/globalEvent/click";
import {hideTooltip} from "../../dialog/tooltip";
import {openGalleryItemMenu} from "../render/av/gallery/util";
import {clearSelect} from "../util/clear";
import {chartRender} from "../render/chartRender";
import {updateCalloutType} from "./callout";
import {nbsp2space, removeZWJ} from "../util/normalizeText";

export class WYSIWYG {
    public lastHTMLs: { [key: string]: string } = {};
    public element: HTMLDivElement;
    public preventKeyup: boolean;

    private preventClick: boolean;

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.className = "protyle-wysiwyg";
        this.element.setAttribute("spellcheck", "false");
        if (isMobile()) {
            // iPhone，iPad 端输入 contenteditable 为 true 时会在块中间插入 span
            // Android 端空块输入法弹出会收起 https://ld246.com/article/1689713888289
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
        let isFullWidth = ial[Constants.CUSTOM_SY_FULLWIDTH];
        if (!isFullWidth) {
            isFullWidth = window.siyuan.config.editor.fullWidth ? "true" : "false";
        }
        if (isFullWidth === "true") {
            this.element.parentElement.setAttribute("data-fullwidth", "true");
        } else {
            this.element.parentElement.removeAttribute("data-fullwidth");
        }
        const ialKeys = Object.keys(ial);
        for (let i = 0; i < this.element.attributes.length; i++) {
            const oldKey = this.element.attributes[i].nodeName;
            if (!["type", "class", "spellcheck", "contenteditable", "data-doc-type", "style", "data-realwidth", "data-readonly"].includes(oldKey) &&
                !ialKeys.includes(oldKey)) {
                this.element.removeAttribute(oldKey);
                i--;
            }
        }
        ialKeys.forEach((key: string) => {
            if (!["title-img", "title", "updated", "icon", "id", "type", "class", "spellcheck", "contenteditable", "data-doc-type", "style", "data-realwidth", "data-readonly", "av-names"].includes(key)) {
                this.element.setAttribute(key, ial[key]);
            }
        });
    }

    // text block-ref file-annotation-ref a 结尾处打字应为普通文本
    private escapeInline(protyle: IProtyle, range: Range, event: InputEvent) {
        if (!event.data && event.inputType !== "insertLineBreak") {
            return;
        }

        const inputData = event.data;
        protyle.toolbar.range = range;
        const inlineElement = range.startContainer.parentElement;
        const currentTypes = protyle.toolbar.getCurrentType();

        // https://github.com/siyuan-note/siyuan/issues/11766
        if (event.inputType === "insertLineBreak") {
            if (currentTypes.length > 0 && range.toString() === "" && inlineElement.tagName === "SPAN" &&
                inlineElement.textContent.startsWith("\n") &&
                range.startContainer.previousSibling && range.startContainer.previousSibling.textContent === "\n") {
                inlineElement.before(range.startContainer.previousSibling);
            }
            return;
        }

        let dataLength = inputData.length;
        if (inputData === "<" || inputData === ">") {
            // 使用 inlineElement.innerHTML 会出现 https://ld246.com/article/1627185027423 中的第2个问题
            dataLength = 4;
        } else if (inputData === "&") {
            // https://github.com/siyuan-note/siyuan/issues/12239
            dataLength = 5;
        }
        // https://github.com/siyuan-note/siyuan/issues/5924
        if (currentTypes.length > 0 && range.toString() === "" && range.startOffset === inputData.length &&
            inlineElement.tagName === "SPAN" &&
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
            !currentTypes.includes("search-mark") &&    // https://github.com/siyuan-note/siyuan/issues/7586
            !currentTypes.includes("code") &&   // https://github.com/siyuan-note/siyuan/issues/13871
            !currentTypes.includes("kbd") &&
            !currentTypes.includes("tag") &&
            range.toString() === "" && range.startContainer.nodeType === 3 &&
            (currentTypes.includes("inline-memo") || currentTypes.includes("block-ref") || currentTypes.includes("file-annotation-ref") || currentTypes.includes("a")) &&
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
                    item.setCurrent(nodeElement);
                }
            });
        }
        /// #else
        if (protyle.disabled) {
            protyle.toolbar.range = getEditorRange(nodeElement);
        }
        /// #endif
    }

    private emojiToMd(element: HTMLElement) {
        element.querySelectorAll(".emoji").forEach((item: HTMLElement) => {
            item.outerHTML = `:${item.getAttribute("alt")}:`;
        });
    }

    private bindCommonEvent(protyle: IProtyle) {
        this.element.addEventListener("copy", async (event: ClipboardEvent & { target: HTMLElement }) => {
            window.siyuan.ctrlIsPressed = false; // https://github.com/siyuan-note/siyuan/issues/6373
            // https://github.com/siyuan-note/siyuan/issues/4600
            if (event.target.tagName === "PROTYLE-HTML" || event.target.localName === "input") {
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
            const selectAVElement = nodeElement.querySelector(".av__row--select, .av__cell--select");
            const selectTableElement = nodeElement.querySelector(".table__select")?.clientWidth > 0;
            let selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0 && range.toString() === "" && !range.cloneContents().querySelector("img") &&
                !selectImgElement && !selectAVElement && !selectTableElement) {
                nodeElement.classList.add("protyle-wysiwyg--select");
                countBlockWord([nodeElement.getAttribute("data-node-id")]);
                selectElements = [nodeElement];
            }
            let html = "";
            let textPlain = "";
            let isInCodeBlock = false;
            let needClipboardWrite = false;
            if (selectElements.length > 0) {
                const isRefText = selectElements[0].getAttribute("data-reftext") === "true";
                if (selectElements[0].getAttribute("data-type") === "NodeListItem" &&
                    selectElements[0].parentElement.classList.contains("list") &&   // 反链复制列表项 https://github.com/siyuan-note/siyuan/issues/6555
                    selectElements[0].parentElement.childElementCount - 1 === selectElements.length) {
                    const hasNoLiElement = selectElements.find(item => {
                        if (!selectElements[0].parentElement.contains(item)) {
                            return true;
                        }
                    });
                    if (!hasNoLiElement) {
                        selectElements = [selectElements[0].parentElement];
                    }
                }
                let listHTML = "";
                for (let i = 0; i < selectElements.length; i++) {
                    const item = selectElements[i] as HTMLElement;
                    // 复制列表项中的块会变为复制列表项，因此不能使用 getTopAloneElement https://github.com/siyuan-note/siyuan/issues/8925
                    if (isRefText) {
                        html += getTextStar(item) + "\n\n";
                    } else {
                        let itemHTML = "";
                        if (item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
                            needClipboardWrite = true;
                            const response = await fetchSyncPost("/api/block/getHeadingChildrenDOM", {
                                id: item.getAttribute("data-node-id"),
                                removeFoldAttr: false
                            });
                            itemHTML = response.data;
                        } else if (item.getAttribute("data-type") !== "NodeBlockQueryEmbed" && item.querySelector('[data-type="NodeHeading"][fold="1"]')) {
                            needClipboardWrite = true;
                            const response = await fetchSyncPost("/api/block/getBlockDOM", {
                                id: item.getAttribute("data-node-id"),
                            });
                            itemHTML = response.data.dom;
                        } else {
                            itemHTML = removeEmbed(item);
                        }
                        if (item.getAttribute("data-type") === "NodeListItem") {
                            if (!listHTML) {
                                listHTML = `<div data-subtype="${item.getAttribute("data-subtype")}" data-node-id="${Lute.NewNodeID()}" data-type="NodeList" class="list">`;
                            }
                            listHTML += itemHTML;
                            if (i === selectElements.length - 1 ||
                                selectElements[i + 1].getAttribute("data-type") !== "NodeListItem" ||
                                selectElements[i + 1].getAttribute("data-subtype") !== item.getAttribute("data-subtype")
                            ) {
                                html += `${listHTML}<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
                                listHTML = "";
                            }
                        } else {
                            html += itemHTML;
                        }
                    }
                }
                if (isRefText) {
                    html = html.slice(0, -2);
                    selectElements[0].removeAttribute("data-reftext");
                }
            } else if (selectAVElement) {
                const cellElements: Element[] = Array.from(nodeElement.querySelectorAll(".av__cell--active, .av__cell--select")) || [];
                if (cellElements.length === 0) {
                    nodeElement.querySelectorAll(".av__row--select:not(.av__row--header)").forEach(rowElement => {
                        rowElement.querySelectorAll(".av__cell").forEach(cellElement => {
                            cellElements.push(cellElement);
                        });
                    });
                }
                if (cellElements.length > 0) {
                    html = "[";
                    cellElements.forEach((item: HTMLElement, index) => {
                        const cellText = getCellText(item);
                        if (index === 0 || (
                            cellElements[index - 1] !== item.previousElementSibling &&
                            !(item.previousElementSibling?.classList.contains("av__colsticky") && !cellElements[index - 1].nextElementSibling &&
                                cellElements[index - 1].parentElement === item.previousElementSibling)
                        )) {
                            html += "[";
                        }
                        html += JSON.stringify(genCellValueByElement(getTypeByCellElement(item), item)) + ",";
                        if (index === cellElements.length - 1 || (
                            cellElements[index + 1] !== item.nextElementSibling &&
                            !(!item.nextElementSibling && item.parentElement.nextElementSibling === cellElements[index + 1])
                        )) {
                            html = html.substring(0, html.length - 1) + "],";
                            textPlain += cellText + "\n";
                        } else {
                            textPlain += cellText + "\t";
                        }
                    });
                    textPlain = textPlain.substring(0, textPlain.length - 1);
                    html = html.substring(0, html.length - 1) + "]";
                }
            } else if (selectTableElement) {
                const scrollLeft = nodeElement.firstElementChild.scrollLeft;
                const scrollTop = nodeElement.querySelector("table").scrollTop;
                const tableSelectElement = nodeElement.querySelector(".table__select") as HTMLElement;
                html = "<table>";
                nodeElement.querySelectorAll("tr").forEach(rowElement => {
                    const rowCells: HTMLTableCellElement[] = [];
                    rowElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                        if (!item.classList.contains("fn__none") && isIncludeCell({
                            tableSelectElement,
                            scrollLeft,
                            scrollTop,
                            item,
                        })) {
                            rowCells.push(item);
                        }
                    });
                    if (rowCells.length > 0) {
                        html += "<tr>";
                        rowCells.forEach(cell => {
                            html += cell.outerHTML;
                        });
                        html += "</tr>";
                    }
                });
                html += "</table>";
                textPlain = protyle.lute.HTML2Md(html);
            } else {
                const tempElement = document.createElement("div");
                // https://github.com/siyuan-note/siyuan/issues/5540
                const selectTypes = protyle.toolbar.getCurrentType(range);
                const spanElement = hasClosestByTag(range.startContainer, "SPAN");
                const headingElement = hasClosestByAttribute(range.startContainer, "data-type", "NodeHeading");
                const matchHeading = headingElement && headingElement.textContent.replace(Constants.ZWSP, "") === range.toString();
                if ((selectTypes.length > 0 && spanElement && spanElement.textContent.replace(Constants.ZWSP, "") === range.toString()) ||
                    matchHeading) {
                    if (matchHeading) {
                        // 复制标题 https://github.com/siyuan-note/insider/issues/297
                        tempElement.append(headingElement.cloneNode(true));
                        // https://github.com/siyuan-note/siyuan/issues/13232
                        headingElement.removeAttribute("fold");
                    } else if (!["DIV", "TD", "TH", "TR"].includes(range.startContainer.parentElement.tagName)) {
                        // 复制行内元素 https://github.com/siyuan-note/insider/issues/191
                        tempElement.append(range.startContainer.parentElement.cloneNode(true));
                        this.emojiToMd(tempElement);
                    } else {
                        // 直接复制块 https://github.com/siyuan-note/insider/issues/318
                        tempElement.append(range.cloneContents());
                        this.emojiToMd(tempElement);
                    }
                    html = tempElement.innerHTML;
                    textPlain = range.toString();
                } else if (selectImgElement) {
                    html = selectImgElement.outerHTML;
                    textPlain = selectImgElement.querySelector("img").getAttribute("data-src");
                } else if (selectTypes.length > 0 && range.startContainer.nodeType === 3 &&
                    range.startContainer.parentElement.tagName === "SPAN" &&
                    range.startContainer.parentElement === range.endContainer.parentElement) {
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
                    textPlain = range.toString();
                } else {
                    tempElement.append(range.cloneContents());
                    this.emojiToMd(tempElement);
                    const inlineMathElement = hasClosestByAttribute(range.commonAncestorContainer, "data-type", "inline-math");
                    if (inlineMathElement) {
                        // 表格内复制数学公式 https://ld246.com/article/1631708573504
                        html = inlineMathElement.outerHTML;
                    } else {
                        html = tempElement.innerHTML;
                    }
                    // 不能使用 commonAncestorContainer https://ld246.com/article/1643282894693
                    textPlain = tempElement.textContent;
                    if (hasClosestByAttribute(range.startContainer, "data-type", "NodeCodeBlock")) {
                        if (isEndOfBlock(range)) {
                            textPlain = textPlain.replace(/\n$/, "");
                        }
                        isInCodeBlock = true;
                    } else if (hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH")) {
                        tempElement.innerHTML = tempElement.innerHTML.replace(/<br>/g, "\n").replace(/<br\/>/g, "\n");
                        textPlain = tempElement.textContent.endsWith("\n") ? tempElement.textContent.replace(/\n$/, "") : tempElement.textContent;
                    } else if (!hasClosestByTag(range.startContainer, "CODE")) {
                        textPlain = range.toString();
                    }
                }
            }
            if (protyle.disabled) {
                html = getEnableHTML(html);
            }
            textPlain = textPlain || protyle.lute.BlockDOM2StdMd(html).trimEnd();
            textPlain = removeZWJ(nbsp2space(textPlain)) // Replace non-breaking spaces with normal spaces when copying https://github.com/siyuan-note/siyuan/issues/9382
                // Remove ZWSP when copying inline elements https://github.com/siyuan-note/siyuan/issues/13882
                .replace(new RegExp(Constants.ZWSP, "g"), "");
            event.clipboardData.setData("text/plain", textPlain);

            if (!isInCodeBlock) {
                enableLuteMarkdownSyntax(protyle);
                const textSiyuan = selectTableElement ? protyle.lute.HTML2BlockDOM(html) : html;
                event.clipboardData.setData("text/siyuan", textSiyuan);
                restoreLuteMarkdownSyntax(protyle);
                // 在 text/html 中插入注释节点，用于右键菜单粘贴时获取 text/siyuan 数据
                const textHTML = `<!--data-siyuan='${encodeBase64(textSiyuan)}'-->` + removeZWJ(selectTableElement ? html : protyle.lute.BlockDOM2HTML(selectAVElement ? textPlain : html));
                event.clipboardData.setData("text/html", textHTML);
                if (needClipboardWrite) {
                    try {
                        await navigator.clipboard.write([new ClipboardItem({
                            ["text/plain"]: textPlain,
                            ["text/html"]: textHTML,
                        })]);
                    } catch (e) {
                        console.log("Copy write clipboard error:", e);
                    }
                }
            }
        });

        this.element.addEventListener("mousedown", (event: MouseEvent) => {
            protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--hiderange");
            if (event.button === 2) {
                // 右键
                return;
            }
            const documentSelf = document;
            documentSelf.onmouseup = null;
            let target = event.target as HTMLElement;
            let nodeElement = hasClosestBlock(target) as HTMLElement;
            const hasSelectClassElement = this.element.querySelector(".protyle-wysiwyg--select");
            const galleryItemElement = hasClosestByClassName(target, "av__gallery-item");
            if (event.shiftKey) {
                let startElement;
                let endElement = nodeElement;
                // Electron 更新后 shift 向上点击获取的 range 不为上一个位置的 https://github.com/siyuan-note/siyuan/issues/9334
                if (getSelection().rangeCount > 0) {
                    startElement = hasClosestBlock(getSelection().getRangeAt(0).startContainer) as HTMLElement;
                }
                // shift 多选
                if (!hasSelectClassElement && galleryItemElement) {
                    galleryItemElement.classList.add("av__gallery-item--select");
                    let sideElement = galleryItemElement.previousElementSibling;
                    let previousList: Element[] = [];
                    while (sideElement) {
                        if (sideElement.classList.contains("av__gallery-item--select")) {
                            break;
                        } else {
                            previousList.push(sideElement);
                        }
                        sideElement = sideElement.previousElementSibling;
                        if (!sideElement) {
                            previousList = [];
                            break;
                        }
                    }
                    sideElement = galleryItemElement.nextElementSibling;
                    let nextList: Element[] = [];
                    while (sideElement) {
                        if (sideElement.classList.contains("av__gallery-item--select")) {
                            break;
                        } else {
                            nextList.push(sideElement);
                        }
                        sideElement = sideElement.nextElementSibling as HTMLElement;
                        if (!sideElement || sideElement.classList.contains("av__gallery-add")) {
                            nextList = [];
                            break;
                        }
                    }
                    previousList.concat(nextList).forEach(item => {
                        item.classList.add("av__gallery-item--select");
                    });
                    event.preventDefault();
                } else if (startElement && endElement && startElement !== endElement) {
                    let toDown = true;
                    const startRect = startElement.getBoundingClientRect();
                    const endRect = endElement.getBoundingClientRect();
                    let startTop = startRect.top;
                    let endTop = endRect.top;
                    if (startTop === endTop) {
                        // 横排 https://ld246.com/article/1663036247544
                        startTop = startRect.left;
                        endTop = endRect.left;
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
                            if (startRect.top === endRect.top ? (currentRect.left <= endTop) : (currentRect.top <= endTop)) {
                                if (hasJump) {
                                    // 父节点的下个节点在选中范围内才可使用父节点作为选中节点
                                    if (currentElement.nextElementSibling && !currentElement.nextElementSibling.classList.contains("protyle-attr")) {
                                        const currentNextRect = currentElement.nextElementSibling.getBoundingClientRect();
                                        if (startRect.top === endRect.top ?
                                            (currentNextRect.left <= endTop && currentNextRect.bottom <= endRect.bottom) :
                                            (currentNextRect.top <= endTop)) {
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
                    if (selectElements.length === 1 && !selectElements[0].classList.contains("list") &&
                        !selectElements[0].classList.contains("bq") && !selectElements[0].classList.contains("callout") &&
                        !selectElements[0].classList.contains("sb")) {
                        // 单个 p 不选中
                    } else {
                        const ids: string[] = [];
                        if (!hasSelectClassElement && protyle.scroll && !protyle.scroll.element.classList.contains("fn__none") && !protyle.scroll.keepLazyLoad &&
                            (startElement.getBoundingClientRect().top < -protyle.contentElement.clientHeight * 2 || endElement.getBoundingClientRect().bottom > protyle.contentElement.clientHeight * 2)) {
                            showMessage(window.siyuan.languages.crossKeepLazyLoad);
                        }
                        selectElements.forEach(item => {
                            if (!hasClosestByClassName(currentElement, "protyle-wysiwyg--select")) {
                                item.classList.add("protyle-wysiwyg--select");
                                ids.push(item.getAttribute("data-node-id"));
                                // 清除选中的子块 https://ld246.com/article/1667826582251
                                item.querySelectorAll(".protyle-wysiwyg--select").forEach(subItem => {
                                    subItem.classList.remove("protyle-wysiwyg--select");
                                });
                            }
                        });
                        countBlockWord(ids);
                        if (toDown) {
                            focusBlock(selectElements[selectElements.length - 1], protyle.wysiwyg.element, false);
                        } else {
                            focusBlock(selectElements[0], protyle.wysiwyg.element, false);
                        }
                    }
                    event.preventDefault();
                }
                return;
            }
            if (isOnlyMeta(event) && !event.shiftKey && !event.altKey) {
                let ctrlElement = nodeElement;
                const rowElement = hasClosestByClassName(target, "av__row");
                if (!hasSelectClassElement && (galleryItemElement || (rowElement && !rowElement.classList.contains("av__row--header")))) {
                    if (galleryItemElement) {
                        galleryItemElement.classList.toggle("av__gallery-item--select");
                    } else if (rowElement) {
                        selectRow(rowElement.querySelector(".av__firstcol"), "toggle");
                    }
                } else if (ctrlElement) {
                    clearSelect(["row", "galleryItem"], this.element);
                    const embedBlockElement = isInEmbedBlock(ctrlElement);
                    if (embedBlockElement) {
                        ctrlElement = embedBlockElement;
                    }
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
                    const ctrlParentElement = hasClosestByClassName(ctrlElement.parentElement, "protyle-wysiwyg--select");
                    if (ctrlParentElement) {
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
                return;
            }

            // https://github.com/siyuan-note/siyuan/issues/15100
            if (galleryItemElement && !hasClosestByAttribute(target, "data-type", "av-gallery-more")) {
                documentSelf.onmouseup = () => {
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    clearSelect(["galleryItem"], protyle.wysiwyg.element);
                    return false;
                };
                return;
            }
            const avDragFillElement = hasClosestByClassName(target, "av__drag-fill");
            // https://github.com/siyuan-note/siyuan/issues/3026
            hideElements(["select"], protyle);
            if (hasClosestByAttribute(target, "data-type", "av-gallery-more")) {
                clearSelect(["img", "row", "cell"], protyle.wysiwyg.element);
            } else if (!hasClosestByClassName(target, "av__firstcol") && !avDragFillElement) {
                clearSelect(["img", "av"], protyle.wysiwyg.element);
            }

            if ((hasClosestByClassName(target, "protyle-action") && !hasClosestByClassName(target, "code-block")) ||
                (hasClosestByClassName(target, "av__cell--header") && !hasClosestByClassName(target, "av__widthdrag"))) {
                return;
            }
            const wysiwygRect = protyle.wysiwyg.element.getBoundingClientRect();
            const wysiwygStyle = window.getComputedStyle(protyle.wysiwyg.element);
            const mostLeft = wysiwygRect.left + (parseInt(wysiwygStyle.paddingLeft) || 24) + 1;
            const mostRight = wysiwygRect.right - (parseInt(wysiwygStyle.paddingRight) || 16) - 2;

            const protyleRect = protyle.element.getBoundingClientRect();
            const mostBottom = protyleRect.bottom;
            const y = event.clientY;
            const contentRect = protyle.contentElement.getBoundingClientRect();
            // av col resize
            if (!protyle.disabled && target.classList.contains("av__widthdrag")) {
                if (!nodeElement) {
                    return;
                }
                const avId = nodeElement.getAttribute("data-av-id");
                const blockID = nodeElement.dataset.nodeId;
                const dragElement = target.parentElement;
                const oldWidth = dragElement.clientWidth;
                const dragColId = dragElement.getAttribute("data-col-id");
                let newWidth: number;
                const scrollElement = nodeElement.querySelector(".av__scroll");
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    newWidth = Math.max(oldWidth + (moveEvent.clientX - event.clientX), 25);
                    scrollElement.querySelectorAll(".av__row, .av__row--footer").forEach(item => {
                        (item.querySelector(`[data-col-id="${dragColId}"]`) as HTMLElement).style.width = newWidth + "px";
                    });
                    stickyRow(nodeElement, contentRect, "bottom");
                };

                documentSelf.onmouseup = () => {
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    if (!newWidth || newWidth === oldWidth) {
                        return;
                    }
                    const viewID = nodeElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW);
                    transaction(protyle, [{
                        action: "setAttrViewColWidth",
                        id: dragColId,
                        avID: avId,
                        data: newWidth + "px",
                        blockID,
                        viewID // https://github.com/siyuan-note/siyuan/issues/11019
                    }], [{
                        action: "setAttrViewColWidth",
                        id: dragColId,
                        avID: avId,
                        data: oldWidth + "px",
                        blockID,
                        viewID
                    }]);
                };
                this.preventClick = true;
                event.preventDefault();
                return;
            }
            // av drag fill
            if (!protyle.disabled && avDragFillElement) {
                if (!nodeElement) {
                    return;
                }
                const bodyElement = hasClosestByClassName(avDragFillElement, "av__body") as HTMLElement;
                if (!bodyElement) {
                    return;
                }
                const originData: { [key: string]: IAVCellValue[] } = {};
                let lastOriginCellElement: HTMLElement;
                const originCellIds: string[] = [];
                bodyElement.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
                    const rowElement = hasClosestByClassName(item, "av__row");
                    if (rowElement) {
                        if (!originData[rowElement.dataset.id]) {
                            originData[rowElement.dataset.id] = [];
                        }
                        originData[rowElement.dataset.id].push(genCellValueByElement(getTypeByCellElement(item), item));
                        lastOriginCellElement = item;
                        originCellIds.push(item.dataset.id);
                    }
                });
                const dragFillCellIndex = getPositionByCellElement(lastOriginCellElement);
                const firstCellIndex = getPositionByCellElement(bodyElement.querySelector(".av__cell--active"));
                let moveAVCellElement: HTMLElement;
                let lastCellElement: HTMLElement;
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    const tempCellElement = hasClosestByClassName(moveEvent.target as HTMLElement, "av__cell") as HTMLElement;
                    if (moveAVCellElement && tempCellElement && (tempCellElement === moveAVCellElement)) {
                        return;
                    }
                    moveAVCellElement = tempCellElement;
                    if (moveAVCellElement && moveAVCellElement.dataset.id) {
                        const newIndex = getPositionByCellElement(moveAVCellElement);
                        bodyElement.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
                            if (!originCellIds.includes(item.dataset.id)) {
                                item.classList.remove("av__cell--active");
                            }
                        });
                        if (newIndex.celIndex !== dragFillCellIndex.celIndex) {
                            lastCellElement = undefined;
                            return;
                        }
                        bodyElement.querySelectorAll(".av__row").forEach((rowElement: HTMLElement, index: number) => {
                            if ((newIndex.rowIndex < firstCellIndex.rowIndex && index >= newIndex.rowIndex && index < firstCellIndex.rowIndex) ||
                                (newIndex.rowIndex > dragFillCellIndex.rowIndex && index <= newIndex.rowIndex && index > dragFillCellIndex.rowIndex)) {
                                rowElement.querySelectorAll(".av__cell").forEach((cellElement: HTMLElement, cellIndex: number) => {
                                    if (cellIndex >= firstCellIndex.celIndex && cellIndex <= newIndex.celIndex) {
                                        cellElement.classList.add("av__cell--active");
                                        lastCellElement = cellElement;
                                    }
                                });
                            }
                        });
                    }
                };

                documentSelf.onmouseup = () => {
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    if (lastCellElement) {
                        dragFillCellsValue(protyle, nodeElement, originData, originCellIds, lastOriginCellElement);
                        const allActiveCellsElement = bodyElement.querySelectorAll(".av__cell--active");
                        addDragFill(allActiveCellsElement[allActiveCellsElement.length - 1]);
                    }
                    return false;
                };
                this.preventClick = true;
                return false;
            }
            // av cell select
            const avCellElement = hasClosestByClassName(target, "av__cell");
            if (!protyle.disabled && avCellElement && avCellElement.dataset.id && !isInEmbedBlock(avCellElement)) {
                if (!nodeElement || nodeElement.dataset.avType !== "table") {
                    return;
                }
                nodeElement.querySelectorAll(".av__cell--select").forEach(item => {
                    item.classList.remove("av__cell--select");
                });
                nodeElement.querySelectorAll(".av__drag-fill").forEach(item => {
                    item.remove();
                });
                avCellElement.classList.add("av__cell--select");
                const originIndex = getPositionByCellElement(avCellElement);
                let moveSelectCellElement: HTMLElement;
                let lastCellElement: HTMLElement;
                const nodeRect = nodeElement.getBoundingClientRect();
                const scrollElement = nodeElement.querySelector(".av__scroll");
                const bodyElement = hasClosestByClassName(avCellElement, "av__body") as HTMLElement;
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    const tempCellElement = hasClosestByClassName(moveEvent.target as HTMLElement, "av__cell") as HTMLElement;
                    if (scrollElement.scrollWidth > scrollElement.clientWidth + 2) {
                        if (moveEvent.clientX > nodeRect.right - 10) {
                            scrollElement.scrollLeft += 10;
                        } else if (moveEvent.clientX < nodeRect.left + 34) {
                            scrollElement.scrollLeft -= 10;
                        }
                        if (moveEvent.clientY < contentRect.top + 48) {
                            protyle.contentElement.scrollTop -= 5;
                        } else if (moveEvent.clientY > contentRect.bottom - 48) {
                            protyle.contentElement.scrollTop += 5;
                        }
                    }
                    if (bodyElement !== hasClosestByClassName(tempCellElement, "av__body") ||
                        (moveSelectCellElement && tempCellElement && tempCellElement === moveSelectCellElement)) {
                        return;
                    }
                    if (tempCellElement && tempCellElement.dataset.id && (event.clientX !== moveEvent.clientX || event.clientY !== moveEvent.clientY)) {
                        const newIndex = getPositionByCellElement(tempCellElement);
                        nodeElement.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
                            item.classList.remove("av__cell--active");
                        });
                        bodyElement.querySelectorAll(".av__row").forEach((rowElement: HTMLElement, index: number) => {
                            if (index >= Math.min(originIndex.rowIndex, newIndex.rowIndex) && index <= Math.max(originIndex.rowIndex, newIndex.rowIndex)) {
                                rowElement.querySelectorAll(".av__cell").forEach((cellElement: HTMLElement, cellIndex: number) => {
                                    if (cellIndex >= Math.min(originIndex.celIndex, newIndex.celIndex) && cellIndex <= Math.max(originIndex.celIndex, newIndex.celIndex)) {
                                        cellElement.classList.add("av__cell--active");
                                        lastCellElement = cellElement;
                                    }
                                });
                            }
                        });
                        moveSelectCellElement = tempCellElement;
                    }
                };

                documentSelf.onmouseup = () => {
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    if (lastCellElement) {
                        selectRow(nodeElement.querySelector(".av__firstcol"), "unselectAll");
                        focusBlock(nodeElement);
                        addDragFill(lastCellElement);
                        this.preventClick = true;
                    }
                    return false;
                };
                return false;
            }
            // 图片、iframe、video、挂件缩放
            if (!protyle.disabled && target.classList.contains("protyle-action__drag")) {
                if (!nodeElement) {
                    return;
                }
                let isCenter = true;
                if ("NodeVideo" === nodeElement.dataset.type) {
                    nodeElement.classList.add("iframe--drag");
                    if (["left", "right", ""].includes(nodeElement.style.textAlign)) {
                        isCenter = false;
                    }
                } else if (["NodeIFrame", "NodeWidget"].includes(nodeElement.dataset.type)) {
                    nodeElement.classList.add("iframe--drag");
                    if (!nodeElement.style.margin) {
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

                const imgElement = dragElement.parentElement.parentElement;
                if (dragElement.tagName === "IMG") {
                    img3115(imgElement);
                }
                // 3.4.1 以前历史数据兼容
                if (dragElement.tagName === "IFRAME") {
                    dragElement.style.height = "";
                    dragElement.style.width = "";
                }
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    if (dragElement.tagName === "IMG") {
                        dragElement.style.height = "";
                    }
                    if (moveEvent.clientX > x - dragWidth + 8 && moveEvent.clientX < mostRight) {
                        const multiple = ((dragElement.tagName === "IMG" && !imgElement.style.minWidth && nodeElement.style.textAlign !== "center") || !isCenter) ? 1 : 2;
                        if (dragElement.tagName === "IMG") {
                            dragElement.parentElement.style.width = Math.max(17, dragWidth + (moveEvent.clientX - x) * multiple) + "px";
                        } else if (dragElement.tagName === "IFRAME") {
                            nodeElement.style.width = Math.max(17, dragWidth + (moveEvent.clientX - x) * multiple) + "px";
                        } else {
                            dragElement.style.width = Math.max(17, dragWidth + (moveEvent.clientX - x) * multiple) + "px";
                        }
                    }
                    if (dragElement.tagName !== "IMG") {
                        if (moveEvent.clientY > y - dragHeight + 8 && moveEvent.clientY < mostBottom) {
                            if (dragElement.tagName === "IFRAME") {
                                nodeElement.style.height = (dragHeight + (moveEvent.clientY - y)) + "px";
                            } else {
                                dragElement.style.height = (dragHeight + (moveEvent.clientY - y)) + "px";
                            }
                        }
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
            const targetCellElement = hasClosestByTag(target, "TH") || hasClosestByTag(target, "TD");
            if (targetCellElement) {
                target = targetCellElement;
            }
            if (target.tagName === "TH" || target.tagName === "TD" || target.firstElementChild?.tagName === "TABLE" ||
                target.classList.contains("table__resize") || target.classList.contains("table__select")) {
                tableBlockElement = nodeElement;
                if (tableBlockElement) {
                    tableBlockElement.querySelector(".table__select").removeAttribute("style");
                    window.siyuan.menus.menu.remove();
                    hideElements(["toolbar"], protyle);
                    if (target.classList.contains("table__select")) {
                        target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement;
                        nodeElement = hasClosestBlock(target) as HTMLElement;
                    }
                    event.stopPropagation();
                }
                // 后续拖拽操作写在多选节点中
            }
            // table col resize
            if (!protyle.disabled && target.classList.contains("table__resize")) {
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
                const colIndex = parseInt(target.getAttribute("data-col-index"));
                const colElement = nodeElement.querySelectorAll("table col")[colIndex] as HTMLElement;
                // 清空初始化 table 时的最小宽度
                if (colElement.style.minWidth) {
                    colElement.style.width = (nodeElement.querySelectorAll("table td, table th")[colIndex] as HTMLElement).offsetWidth + "px";
                    colElement.style.minWidth = "";
                }
                // 移除 cell 上的宽度限制 https://github.com/siyuan-note/siyuan/issues/7795
                nodeElement.querySelectorAll("tr").forEach((trItem: HTMLTableRowElement) => {
                    trItem.cells[colIndex].style.width = "";
                });
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
            let clentX = event.clientX;
            if (event.clientX > mostRight) {
                clentX = mostRight;
            } else if (event.clientX < mostLeft) {
                clentX = mostLeft;
            }
            const mostTop = protyleRect.top + (protyle.options.render.breadcrumb ? protyle.breadcrumb.element.parentElement.clientHeight : 0);

            let mouseElement: Element;
            let moveCellElement: HTMLElement;
            let startFirstElement: Element;
            let endLastElement: Element;
            this.element.querySelectorAll("iframe").forEach(item => {
                item.style.pointerEvents = "none";
            });
            const needScroll = ["IMG", "VIDEO", "AUDIO"].includes(target.tagName) || target.classList.contains("img");
            documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                let moveTarget: boolean | HTMLElement = moveEvent.target as HTMLElement;
                // table cell select
                if (tableBlockElement &&
                    !hasClosestByClassName(tableBlockElement, "protyle-wysiwyg__embed")) {
                    if (tableBlockElement.contains(moveTarget)) {
                        if (moveTarget.classList.contains("table__select")) {
                            moveTarget.classList.add("fn__none");
                            const pointElement = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
                            moveTarget.classList.remove("fn__none");
                            moveTarget = hasClosestByTag(pointElement, "TH") || hasClosestByTag(pointElement, "TD");
                        }
                        if (moveTarget && moveTarget === target) {
                            tableBlockElement.querySelector(".table__select").removeAttribute("style");
                            protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--hiderange");
                            moveCellElement = moveTarget;
                            return false;
                        }
                        if (moveTarget && (moveTarget.tagName === "TH" || moveTarget.tagName === "TD") &&
                            (!moveCellElement || moveCellElement !== moveTarget)) {
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
                            protyle.wysiwyg.element.classList.add("protyle-wysiwyg--hiderange");
                            tableBlockElement.querySelector(".table__select").setAttribute("style", `left:${left - tableBlockElement.firstElementChild.scrollLeft}px;top:${top - tableBlockElement.querySelector("table").scrollTop}px;height:${height}px;width:${width + 1}px;`);
                            moveCellElement = moveTarget;
                        }
                        return;
                    } else {
                        tableBlockElement.querySelector(".table__select").removeAttribute("style");
                        moveCellElement = undefined;
                    }
                }
                // 在包含 img， video， audio 的元素上划选后无法上下滚动 https://ld246.com/article/1681778773806
                // 在包含 img， video， audio 的元素上拖拽无法划选 https://github.com/siyuan-note/siyuan/issues/11763
                if (needScroll) {
                    if (moveEvent.clientY < contentRect.top + Constants.SIZE_SCROLL_TB || moveEvent.clientY > contentRect.bottom - Constants.SIZE_SCROLL_TB) {
                        protyle.contentElement.scroll({
                            top: protyle.contentElement.scrollTop + (moveEvent.clientY < contentRect.top + Constants.SIZE_SCROLL_TB ? -Constants.SIZE_SCROLL_STEP : Constants.SIZE_SCROLL_STEP),
                            behavior: "smooth"
                        });
                    }
                }
                protyle.selectElement.classList.remove("fn__none");
                // 向左选择，遇到 gutter 就不会弹出 toolbar
                hideElements(["gutter"], protyle);
                let newTop = 0;
                let newLeft = 0;
                let newWidth = 0;
                let newHeight = 0;
                if (moveEvent.clientX < clentX) {
                    if (moveEvent.clientX < mostLeft) {
                        // 向左越界
                        newLeft = mostLeft;
                    } else {
                        // 向左
                        newLeft = moveEvent.clientX;
                    }
                    newWidth = clentX - newLeft;
                } else {
                    if (moveEvent.clientX > mostRight) {
                        // 向右越界
                        newLeft = clentX;
                        newWidth = mostRight - newLeft;
                    } else {
                        // 向右
                        newLeft = clentX;
                        newWidth = moveEvent.clientX - clentX;
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
                if (newHeight < 4) {
                    return;
                }
                protyle.selectElement.setAttribute("style", `background-color: ${protyle.selectElement.style.backgroundColor};top:${newTop}px;height:${newHeight}px;left:${newLeft + 2}px;width:${newWidth - 2}px;`);
                const newMouseElement = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
                if (mouseElement && mouseElement === newMouseElement && !mouseElement.classList.contains("protyle-wysiwyg") &&
                    !mouseElement.classList.contains("list") && !mouseElement.classList.contains("bq") &&
                    !mouseElement.classList.contains("sb") && !mouseElement.classList.contains("callout")) {
                    // 性能优化，同一个p元素不进行选中计算
                    return;
                } else {
                    mouseElement = newMouseElement;
                }
                hideElements(["select"], protyle);
                let firstElement;
                if (moveEvent.clientY > y) {
                    firstElement = startFirstElement || document.elementFromPoint(newLeft, newTop);
                    endLastElement = undefined;
                } else {
                    firstElement = document.elementFromPoint(newLeft, newTop);
                    startFirstElement = undefined;
                }
                if (!firstElement) {
                    return;
                }
                if (firstElement.classList.contains("protyle-wysiwyg") || firstElement.classList.contains("list") ||
                    firstElement.classList.contains("li") || firstElement.classList.contains("sb") ||
                    firstElement.classList.contains("callout") || firstElement.classList.contains("bq")) {
                    firstElement = document.elementFromPoint(newLeft, newTop + 16);
                }
                if (!firstElement) {
                    return;
                }
                let firstBlockElement = hasClosestBlock(firstElement);
                if (!firstBlockElement && firstElement.classList.contains("protyle-breadcrumb__bar")) {
                    firstBlockElement = firstElement.nextElementSibling as HTMLElement;
                }
                if (moveEvent.clientY > y) {
                    if (!startFirstElement) {
                        // 向上选择导致滚动条滚动到顶部再向下选择至 > y 时，firstBlockElement 为 undefined https://ld246.com/article/1705233964097
                        if (!firstBlockElement) {
                            firstBlockElement = protyle.wysiwyg.element.firstElementChild as HTMLElement;
                            if (firstBlockElement.classList.contains("protyle-breadcrumb__bar")) {
                                firstBlockElement = firstBlockElement.nextElementSibling as HTMLElement;
                            }
                        }
                        startFirstElement = firstBlockElement;
                    }
                } else if (!firstBlockElement &&
                    // https://github.com/siyuan-note/siyuan/issues/7580
                    moveEvent.clientY < protyle.wysiwyg.element.lastElementChild.getBoundingClientRect().bottom) {
                    firstBlockElement = protyle.wysiwyg.element.firstElementChild as HTMLElement;
                    if (firstBlockElement.classList.contains("protyle-breadcrumb__bar")) {
                        firstBlockElement = firstBlockElement.nextElementSibling as HTMLElement;
                    }
                }
                let selectElements: Element[] = [];
                let currentElement: Element | boolean = firstBlockElement;

                if (currentElement) {
                    // 从下往上划选遇到嵌入块时，选中整个嵌入块
                    const embedElement = isInEmbedBlock(currentElement);
                    if (embedElement) {
                        currentElement = embedElement;
                    }
                }

                let hasJump = false;
                const selectBottom = endLastElement ? endLastElement.getBoundingClientRect().bottom : (newTop + newHeight);
                while (currentElement) {
                    if (currentElement && !currentElement.classList.contains("protyle-attr")) {
                        const currentRect = currentElement.getBoundingClientRect();
                        if (currentRect.height > 0 && currentRect.top < selectBottom && currentRect.left < newLeft + newWidth) {
                            if (hasJump) {
                                // 父节点的下个节点在选中范围内才可使用父节点作为选中节点
                                if (currentElement.nextElementSibling && !currentElement.nextElementSibling.classList.contains("protyle-attr")) {
                                    const nextRect = currentElement.nextElementSibling.getBoundingClientRect();
                                    if (nextRect.top < selectBottom && nextRect.left < newLeft + newWidth) {
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
                                if (!currentElement.classList.contains("protyle-breadcrumb__bar") &&
                                    !currentElement.classList.contains("protyle-breadcrumb__item")) {
                                    selectElements.push(currentElement);
                                }
                                if (!currentElement.nextElementSibling && currentElement.parentElement.classList.contains("callout-content")) {
                                    currentElement = currentElement.parentElement.nextElementSibling;
                                } else {
                                    currentElement = currentElement.nextElementSibling;
                                }
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
                if (moveEvent.clientY <= y && !endLastElement) {
                    endLastElement = selectElements[selectElements.length - 1];
                }
                if (selectElements.length === 1 && !selectElements[0].classList.contains("list") &&
                    !selectElements[0].classList.contains("bq") && !selectElements[0].classList.contains("callout") &&
                    !selectElements[0].classList.contains("sb")) {
                    // 只有一个 p 时不选中
                    protyle.selectElement.style.backgroundColor = "transparent";
                    protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--hiderange");
                } else {
                    protyle.wysiwyg.element.classList.add("protyle-wysiwyg--hiderange");
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
                startFirstElement = undefined;
                endLastElement = undefined;
                // 多选表格单元格后，选择菜单中的居左，然后 shift+左 选中的文字无法显示选中背景，因此需移除
                // 多选块后 shift+左 选中的文字无法显示选中背景，因此需移除
                protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--hiderange");
                this.element.querySelectorAll("iframe").forEach(item => {
                    item.style.pointerEvents = "";
                });
                protyle.selectElement.classList.add("fn__none");
                protyle.selectElement.removeAttribute("style");
                if (tableBlockElement) {
                    // @ts-ignore
                    tableBlockElement.firstElementChild.style.webkitUserModify = "";
                    const tableSelectElement = tableBlockElement.querySelector(".table__select") as HTMLElement;
                    if (tableSelectElement.getAttribute("style")) {
                        if (getSelection().rangeCount > 0) {
                            getSelection().getRangeAt(0).collapse(false);
                        }
                        window.siyuan.menus.menu.remove();
                        if (!protyle.disabled) {
                            window.siyuan.menus.menu.append(new MenuItem({
                                id: "mergeCell",
                                label: window.siyuan.languages.mergeCell,
                                click: () => {
                                    if (tableBlockElement) {
                                        const selectCellElements: HTMLTableCellElement[] = [];
                                        const colIndexList: number[] = [];
                                        const colCount = tableBlockElement.querySelectorAll("th").length;
                                        let fnNoneMax = 0;
                                        const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
                                        const scrollTop = tableBlockElement.querySelector("table").scrollTop;
                                        let isTHead = false;
                                        let isTBody = false;
                                        tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement, index: number) => {
                                            if (item.classList.contains("fn__none")) {
                                                // 合并的元素中间有 fn__none 的元素
                                                if (item.previousElementSibling && item.previousElementSibling === selectCellElements[selectCellElements.length - 1]) {
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
                                                if (isIncludeCell({
                                                    tableSelectElement,
                                                    scrollLeft,
                                                    scrollTop,
                                                    item,
                                                })) {
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
                                        tableSelectElement.removeAttribute("style");
                                        const oldHTML = tableBlockElement.outerHTML;
                                        let cellElement = selectCellElements[0];
                                        let colSpan = cellElement.colSpan;
                                        let index = 1;
                                        while (cellElement.nextElementSibling && cellElement.nextElementSibling === selectCellElements[index]) {
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
                                                if (rowElement !== item.parentElement) {
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
                            window.siyuan.menus.menu.append(new MenuItem({
                                id: "separator_1",
                                type: "separator"
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                id: "alignLeft",
                                icon: "iconAlignLeft",
                                accelerator: window.siyuan.config.keymap.editor.general.alignLeft.custom,
                                label: window.siyuan.languages.alignLeft,
                                click: () => {
                                    if (tableBlockElement) {
                                        const selectCellElements: HTMLTableCellElement[] = [];
                                        const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
                                        const scrollTop = tableBlockElement.querySelector("table").scrollTop;
                                        tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                                            if (!item.classList.contains("fn__none") &&
                                                isIncludeCell({
                                                    tableSelectElement,
                                                    scrollLeft,
                                                    scrollTop,
                                                    item,
                                                }) && (selectCellElements.length === 0 || (selectCellElements.length > 0 && item.offsetTop === selectCellElements[0].offsetTop))) {
                                                selectCellElements.push(item);
                                            }
                                        });
                                        tableSelectElement.removeAttribute("style");
                                        setTableAlign(protyle, selectCellElements, tableBlockElement, "left", getEditorRange(tableBlockElement));
                                    }
                                }
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                id: "alignCenter",
                                icon: "iconAlignCenter",
                                accelerator: window.siyuan.config.keymap.editor.general.alignCenter.custom,
                                label: window.siyuan.languages.alignCenter,
                                click: () => {
                                    if (tableBlockElement) {
                                        const selectCellElements: HTMLTableCellElement[] = [];
                                        const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
                                        const scrollTop = tableBlockElement.querySelector("table").scrollTop;
                                        tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                                            if (!item.classList.contains("fn__none") && isIncludeCell({
                                                    tableSelectElement,
                                                    scrollLeft,
                                                    scrollTop,
                                                    item,
                                                }) &&
                                                (selectCellElements.length === 0 || (selectCellElements.length > 0 && item.offsetTop === selectCellElements[0].offsetTop))) {
                                                selectCellElements.push(item);
                                            }
                                        });
                                        tableSelectElement.removeAttribute("style");
                                        setTableAlign(protyle, selectCellElements, tableBlockElement, "center", getEditorRange(tableBlockElement));
                                    }
                                }
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                id: "alignRight",
                                icon: "iconAlignRight",
                                accelerator: window.siyuan.config.keymap.editor.general.alignRight.custom,
                                label: window.siyuan.languages.alignRight,
                                click: () => {
                                    if (tableBlockElement) {
                                        const selectCellElements: HTMLTableCellElement[] = [];
                                        const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
                                        const scrollTop = tableBlockElement.querySelector("table").scrollTop;
                                        tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                                            if (!item.classList.contains("fn__none") && isIncludeCell({
                                                tableSelectElement,
                                                scrollLeft,
                                                scrollTop,
                                                item,
                                            }) && (selectCellElements.length === 0 || (selectCellElements.length > 0 && item.offsetTop === selectCellElements[0].offsetTop))) {
                                                selectCellElements.push(item);
                                            }
                                        });
                                        tableSelectElement.removeAttribute("style");
                                        setTableAlign(protyle, selectCellElements, tableBlockElement, "right", getEditorRange(tableBlockElement));
                                    }
                                }
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                id: "useDefaultAlign",
                                icon: "",
                                label: window.siyuan.languages.useDefaultAlign,
                                click: () => {
                                    if (tableBlockElement) {
                                        const selectCellElements: HTMLTableCellElement[] = [];
                                        const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
                                        const scrollTop = tableBlockElement.querySelector("table").scrollTop;
                                        tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                                            if (!item.classList.contains("fn__none") && isIncludeCell({
                                                    tableSelectElement,
                                                    scrollLeft,
                                                    scrollTop,
                                                    item,
                                                }) &&
                                                (selectCellElements.length === 0 || (selectCellElements.length > 0 && item.offsetTop === selectCellElements[0].offsetTop))) {
                                                selectCellElements.push(item);
                                            }
                                        });
                                        tableSelectElement.removeAttribute("style");
                                        setTableAlign(protyle, selectCellElements, tableBlockElement, "", getEditorRange(tableBlockElement));
                                    }
                                }
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                id: "separator_2",
                                type: "separator"
                            }).element);
                        }
                        window.siyuan.menus.menu.append(new MenuItem({
                            id: "copyPlainText",
                            label: window.siyuan.languages.copyPlainText,
                            click() {
                                if (tableBlockElement) {
                                    const selectCellElements: HTMLTableCellElement[] = [];
                                    const scrollLeft = tableBlockElement.firstElementChild.scrollLeft;
                                    const scrollTop = tableBlockElement.querySelector("table").scrollTop;
                                    const tableSelectElement = tableBlockElement.querySelector(".table__select") as HTMLElement;
                                    tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                                        if (!item.classList.contains("fn__none") && isIncludeCell({
                                            tableSelectElement,
                                            scrollLeft,
                                            scrollTop,
                                            item,
                                        })) {
                                            selectCellElements.push(item);
                                        }
                                    });
                                    let textPlain = "";
                                    selectCellElements.forEach((item, index) => {
                                        textPlain += item.textContent.trim() + "\t";
                                        if (!item.nextElementSibling || !selectCellElements[index + 1] ||
                                            item.nextElementSibling !== selectCellElements[index + 1]) {
                                            textPlain = textPlain.slice(0, -1) + "\n";
                                        }
                                    });
                                    copyPlainText(textPlain.slice(0, -1));
                                    focusBlock(tableBlockElement);
                                }
                            }
                        }).element);
                        window.siyuan.menus.menu.append(new MenuItem({
                            id: "copy",
                            icon: "iconCopy",
                            accelerator: "⌘C",
                            label: window.siyuan.languages.copy,
                            click() {
                                if (tableBlockElement) {
                                    focusByRange(getEditorRange(tableBlockElement));
                                    document.execCommand("copy");
                                }
                            }
                        }).element);
                        if (!protyle.disabled) {
                            window.siyuan.menus.menu.append(new MenuItem({
                                id: "cut",
                                icon: "iconCut",
                                accelerator: "⌘X",
                                label: window.siyuan.languages.cut,
                                click() {
                                    if (tableBlockElement) {
                                        focusByRange(getEditorRange(tableBlockElement));
                                        document.execCommand("cut");
                                    }
                                }
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                id: "clear",
                                label: window.siyuan.languages.clear,
                                icon: "iconTrashcan",
                                accelerator: "⌦",
                                click() {
                                    clearTableCell(protyle, tableBlockElement as HTMLElement);
                                }
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                id: "paste",
                                label: window.siyuan.languages.paste,
                                icon: "iconPaste",
                                accelerator: "⌘V",
                                async click() {
                                    if (document.queryCommandSupported("paste")) {
                                        document.execCommand("paste");
                                    } else if (tableBlockElement) {
                                        try {
                                            const text = await readClipboard();
                                            paste(protyle, Object.assign(text, {target: tableBlockElement as HTMLElement}));
                                        } catch (e) {
                                            console.log(e);
                                        }
                                    }
                                }
                            }).element);
                        }
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
                        if (event.detail > 2) {
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
                            return;
                        }
                    }
                    if (selectElement.length > 0) {
                        range.collapse(true);
                        if (range.commonAncestorContainer.nodeType === 1 &&
                            range.startContainer.childNodes[range.startOffset] &&
                            range.startContainer.childNodes[range.startOffset].nodeType === 1 &&
                            (range.commonAncestorContainer as HTMLElement).classList.contains("protyle-wysiwyg")) {
                            focusBlock(range.startContainer.childNodes[range.startOffset] as Element);
                        }
                        return;
                    }
                    const startBlockElement = hasClosestBlock(range.startContainer);
                    let endBlockElement: false | HTMLElement;
                    if (mouseUpEvent.detail > 2 && range.endContainer.nodeType !== 3 && ["DIV", "TD", "TH"].includes((range.endContainer as HTMLElement).tagName) && range.endOffset === 0) {
                        // 三击选中段落块时，rangeEnd 会在下一个块
                        if ((range.endContainer as HTMLElement).classList.contains("protyle-attr") && startBlockElement) {
                            // 三击在悬浮层中会选择到 attr https://github.com/siyuan-note/siyuan/issues/4636
                            // 需要获取可编辑元素，使用 previousElementSibling 的话会 https://github.com/siyuan-note/siyuan/issues/9714
                            setLastNodeRange(getContenteditableElement(startBlockElement), range, false);
                        } else if (["TD", "TH"].includes((range.endContainer as HTMLElement).tagName)) {
                            const cellElement = hasClosestByTag(range.startContainer, "TH") || hasClosestByTag(range.startContainer, "TD");
                            if (cellElement) {
                                setLastNodeRange(cellElement, range, false);
                            }
                        }
                    } else {
                        endBlockElement = hasClosestBlock(range.endContainer);
                    }
                    if (startBlockElement && endBlockElement && endBlockElement !== startBlockElement) {
                        if ((range.startContainer.nodeType === 1 && (range.startContainer as HTMLElement).tagName === "DIV" && (range.startContainer as HTMLElement).classList.contains("protyle-attr")) ||
                            event.clientY > mouseUpEvent.clientY) {
                            setFirstNodeRange(getContenteditableElement(endBlockElement), range);
                        } else if (range.endOffset === 0 && range.endContainer.nodeType === 1 && (range.endContainer as HTMLElement).tagName === "DIV") {
                            setLastNodeRange(getContenteditableElement(startBlockElement), range, false);
                        } else {
                            range.collapse(true);
                        }
                    }
                }
            };
        });
    }

    private bindEvent(protyle: IProtyle) {
        // 删除块时，av 头尾需重新计算位置
        protyle.observer = new ResizeObserver(() => {
            const contentRect = protyle.contentElement.getBoundingClientRect();
            protyle.wysiwyg.element.querySelectorAll(".av").forEach((item: HTMLElement) => {
                if (item.querySelector(".av__scroll")) {
                    stickyRow(item, contentRect, "all");
                }
            });
        });

        this.element.addEventListener("focusout", () => {
            if (getSelection().rangeCount === 0) {
                return;
            }
            const range = getSelection().getRangeAt(0);
            if (this.element === range.startContainer || this.element.contains(range.startContainer)) {
                protyle.toolbar.range = range.cloneRange();
            }
        });

        this.element.addEventListener("cut", async (event: ClipboardEvent & { target: HTMLElement }) => {
            window.siyuan.ctrlIsPressed = false; // https://github.com/siyuan-note/siyuan/issues/6373
            if (protyle.disabled) {
                return;
            }
            if (event.target.tagName === "PROTYLE-HTML" || event.target.localName === "input") {
                event.stopPropagation();
                return;
            }

            if (protyle.options.render.breadcrumb) {
                protyle.breadcrumb.hide();
            }
            const range = getEditorRange(protyle.wysiwyg.element);
            let nodeElement = hasClosestBlock(range.startContainer);
            if (!nodeElement) {
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            // https://github.com/siyuan-note/siyuan/issues/11793
            const embedElement = isInEmbedBlock(nodeElement);
            if (embedElement) {
                nodeElement = embedElement;
            }
            event.stopPropagation();
            event.preventDefault();
            const selectImgElement = nodeElement.querySelector(".img--select");
            const selectAVElement = nodeElement.querySelector(".av__row--select, .av__cell--select");
            const selectTableElement = nodeElement.querySelector(".table__select")?.clientWidth > 0;
            let selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0 && range.toString() === "" && !range.cloneContents().querySelector("img") &&
                !selectImgElement && !selectAVElement && !selectTableElement) {
                nodeElement.classList.add("protyle-wysiwyg--select");
                selectElements = [nodeElement];
            }
            let html = "";
            let textPlain = "";
            let isInCodeBlock = false;
            let needClipboardWrite = false;
            if (selectElements.length > 0) {
                if (selectElements[0].getAttribute("data-type") === "NodeListItem" &&
                    selectElements[0].parentElement.classList.contains("list") &&   // 反链复制列表项 https://github.com/siyuan-note/siyuan/issues/6555
                    selectElements[0].parentElement.childElementCount - 1 === selectElements.length) {
                    const hasNoLiElement = selectElements.find(item => {
                        if (!selectElements[0].parentElement.contains(item)) {
                            return true;
                        }
                    });
                    if (!hasNoLiElement) {
                        selectElements = [selectElements[0].parentElement];
                    }
                }
                let listHTML = "";
                for (let i = 0; i < selectElements.length; i++) {
                    const item = getTopAloneElement(selectElements[i]);
                    let itemHTML = "";
                    if (item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
                        needClipboardWrite = true;
                        const response = await fetchSyncPost("/api/block/getHeadingChildrenDOM", {
                            id: item.getAttribute("data-node-id"),
                            removeFoldAttr: false
                        });
                        itemHTML = response.data;
                    } else if (item.getAttribute("data-type") !== "NodeBlockQueryEmbed" && item.querySelector('[data-type="NodeHeading"][fold="1"]')) {
                        needClipboardWrite = true;
                        const response = await fetchSyncPost("/api/block/getBlockDOM", {
                            id: item.getAttribute("data-node-id"),
                        });
                        itemHTML = response.data.dom;
                    } else {
                        itemHTML = removeEmbed(item);
                    }
                    if (item.getAttribute("data-type") === "NodeListItem") {
                        if (!listHTML) {
                            listHTML = `<div data-subtype="${item.getAttribute("data-subtype")}" data-node-id="${Lute.NewNodeID()}" data-type="NodeList" class="list">`;
                        }
                        listHTML += itemHTML;
                        if (i === selectElements.length - 1 ||
                            selectElements[i + 1].getAttribute("data-type") !== "NodeListItem" ||
                            selectElements[i + 1].getAttribute("data-subtype") !== item.getAttribute("data-subtype")
                        ) {
                            html += `${listHTML}<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
                            listHTML = "";
                        }
                    } else {
                        html += itemHTML;
                    }
                }
                const nextElement = getNextBlock(selectElements[selectElements.length - 1]);
                removeBlock(protyle, nodeElement, range, "remove");
                if (nextElement) {
                    // Ctrl+X 剪切后光标应跳到下一行行首 https://github.com/siyuan-note/siyuan/issues/5485
                    focusBlock(nextElement);
                }
            } else if (selectAVElement) {
                needClipboardWrite = true;
                const cellsValue = await updateCellsValue(protyle, nodeElement);
                html = JSON.stringify(cellsValue.json);
                textPlain = cellsValue.text;
            } else if (selectTableElement) {
                const selectCellElements: HTMLTableCellElement[] = [];
                const scrollLeft = nodeElement.firstElementChild.scrollLeft;
                const scrollTop = nodeElement.querySelector("table").scrollTop;
                const tableSelectElement = nodeElement.querySelector(".table__select") as HTMLElement;
                html = "<table>";
                nodeElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                    if (!item.classList.contains("fn__none") && isIncludeCell({
                        tableSelectElement,
                        scrollLeft,
                        scrollTop,
                        item,
                    })) {
                        selectCellElements.push(item);
                    }
                });
                tableSelectElement.removeAttribute("style");
                if (getSelection().rangeCount > 0) {
                    const range = getSelection().getRangeAt(0);
                    if (nodeElement.contains(range.startContainer)) {
                        range.insertNode(document.createElement("wbr"));
                    }
                }
                const oldHTML = nodeElement.outerHTML;
                nodeElement.querySelector("wbr")?.remove();
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                selectCellElements.forEach((item, index) => {
                    if (index === 0 || !item.previousElementSibling ||
                        item.previousElementSibling !== selectCellElements[index - 1]) {
                        html += "<tr>";
                    }
                    html += item.outerHTML;
                    if (!item.nextElementSibling || !selectCellElements[index + 1] ||
                        item.nextElementSibling !== selectCellElements[index + 1]) {
                        html += "</tr>";
                    }
                    item.innerHTML = "";
                });
                html += "</table>";
                textPlain = protyle.lute.HTML2Md(html);
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
            } else {
                const id = nodeElement.getAttribute("data-node-id");
                setInsertWbrHTML(nodeElement, range, protyle);
                const oldHTML = protyle.wysiwyg.lastHTMLs[id] || nodeElement.outerHTML;
                const tempElement = document.createElement("div");
                // 首次选中标题时，range.startContainer 会为空
                let startContainer = range.startContainer;
                if (startContainer.nodeType === 3 && startContainer.textContent === "") {
                    const nextSibling = hasNextSibling(range.startContainer);
                    if (nextSibling) {
                        startContainer = nextSibling;
                    }
                }
                const headElement = hasClosestByAttribute(startContainer, "data-type", "NodeHeading");
                if (headElement && range.toString() === headElement.firstElementChild.textContent) {
                    tempElement.insertAdjacentHTML("afterbegin", headElement.firstElementChild.innerHTML);
                    headElement.firstElementChild.innerHTML = "";
                } else if (range.toString() !== "" && startContainer === range.endContainer &&
                    range.startContainer.nodeType === 3 &&
                    // 需使用 wholeText https://github.com/siyuan-note/siyuan/issues/14339
                    range.endOffset === (range.endContainer as Text).wholeText.length &&
                    range.startOffset === 0 &&
                    !["DIV", "TD", "TH", "TR"].includes(range.startContainer.parentElement.tagName)) {
                    // 选中整个内联元素
                    tempElement.append(range.startContainer.parentElement);
                } else if (selectImgElement) {
                    tempElement.append(selectImgElement);
                } else if (range.startContainer.nodeType === 3 && range.startContainer.parentElement.tagName === "SPAN" &&
                    range.startContainer.parentElement.getAttribute("data-type") &&
                    range.startContainer.parentElement === range.endContainer.parentElement) {
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
                        mathRender(nodeElement);
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
                            if (nodeElement.classList.contains("av")) {
                                updateAVName(protyle, nodeElement);
                            } else if (nodeElement.classList.contains("table")) {
                                parentElement = hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH");
                            } else {
                                parentElement = getContenteditableElement(nodeElement);
                            }
                            if (parentElement) {
                                // 引用文本剪切 https://ld246.com/article/1647689760545
                                // 表格多行剪切 https://ld246.com/article/1652603836350
                                // 自定义表情的段落剪切后表情丢失 https://ld246.com/article/1668781478724
                                Array.from(parentElement.children).forEach(item => {
                                    if (item.textContent === "" && (item.nodeType === 1 && !["BR", "IMG"].includes(item.tagName))) {
                                        item.remove();
                                    }
                                });
                            }
                        }
                    }
                }
                this.emojiToMd(tempElement);
                html = tempElement.innerHTML;
                // https://github.com/siyuan-note/siyuan/issues/10722
                if (hasClosestByAttribute(range.startContainer, "data-type", "NodeCodeBlock") ||
                    hasClosestByTag(range.startContainer, "CODE")) {
                    textPlain = tempElement.textContent.replace(Constants.ZWSP, "");
                    isInCodeBlock = true;
                }
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
                    nodeElement.querySelector('[data-render="true"]')?.removeAttribute("data-render");
                    highlightRender(nodeElement);
                }
                if (nodeElement.parentElement.parentElement && !nodeElement.classList.contains("av")) {
                    // 选中 heading 时，使用删除的 transaction
                    setInsertWbrHTML(nodeElement, range, protyle);
                    updateTransaction(protyle, id, protyle.wysiwyg.lastHTMLs[id] || nodeElement.outerHTML, oldHTML);
                }
            }
            protyle.hint.render(protyle);
            if (!selectAVElement) {
                textPlain = textPlain || protyle.lute.BlockDOM2StdMd(html).trimEnd(); // 需要 trimEnd，否则 \n 会导致 https://github.com/siyuan-note/siyuan/issues/6218
                if (nodeElement.classList.contains("table")) {
                    textPlain = textPlain.replace(/<br>/g, "\n").replace(/<br\/>/g, "\n");
                    textPlain = textPlain.endsWith("\n") ? textPlain.replace(/\n$/, "") : textPlain;
                }
            }
            textPlain = removeZWJ(nbsp2space(textPlain)); // Replace non-breaking spaces with normal spaces when copying https://github.com/siyuan-note/siyuan/issues/9382
            event.clipboardData.setData("text/plain", textPlain);

            if (!isInCodeBlock) {
                enableLuteMarkdownSyntax(protyle);
                const textSiyuan = selectTableElement ? protyle.lute.HTML2BlockDOM(html) : html;
                restoreLuteMarkdownSyntax(protyle);
                event.clipboardData.setData("text/siyuan", textSiyuan);
                // 在 text/html 中插入注释节点，用于右键菜单粘贴时获取 text/siyuan 数据
                const textHTML = `<!--data-siyuan='${encodeBase64(textSiyuan)}'-->` + removeZWJ(selectTableElement ? html : protyle.lute.BlockDOM2HTML(selectAVElement ? textPlain : html));
                event.clipboardData.setData("text/html", textHTML);
                if (needClipboardWrite) {
                    try {
                        await navigator.clipboard.write([new ClipboardItem({
                            ["text/plain"]: textPlain,
                            ["text/html"]: textHTML,
                        })]);
                    } catch (e) {
                        console.log("Cut write clipboard error:", e);
                    }
                }
            }
        });

        let beforeContextmenuRange: Range;
        this.element.addEventListener("contextmenu", (event: MouseEvent & { detail: any }) => {
            if (event.shiftKey) {
                return;
            }
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
            const embedElement = isInEmbedBlock(target);
            if (embedElement) {
                if (getSelection().rangeCount === 0) {
                    focusSideBlock(embedElement);
                }
                protyle.gutter.renderMenu(protyle, embedElement);
                /// #if MOBILE
                window.siyuan.menus.menu.fullscreen();
                /// #else
                window.siyuan.menus.menu.popup({x, y});
                /// #endif
                return false;
            }

            const nodeElement = hasClosestBlock(target);
            if (!nodeElement) {
                return false;
            }
            const avGalleryItemElement = hasClosestByClassName(target, "av__gallery-item");
            if (avGalleryItemElement) {
                openGalleryItemMenu({
                    target: avGalleryItemElement.querySelector(".protyle-icon--last"),
                    protyle,
                    position: {
                        x: event.clientX,
                        y: event.clientY
                    }
                });
                event.stopPropagation();
                event.preventDefault();
                return false;
            }
            const avCellElement = hasClosestByClassName(target, "av__cell");
            if (avCellElement) {
                if (avCellElement.classList.contains("av__cell--header")) {
                    if (!protyle.disabled) {
                        showColMenu(protyle, nodeElement, avCellElement);
                    }
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                }
                if (getTypeByCellElement(avCellElement) === "mAsset") {
                    const assetImgElement = hasClosestByClassName(target, "av__cellassetimg") || hasClosestByClassName(target, "av__celltext--url");
                    if (assetImgElement) {
                        let index = 0;
                        Array.from(avCellElement.children).find((item, i) => {
                            if (item === assetImgElement) {
                                index = i;
                                return true;
                            }
                        });
                        editAssetItem({
                            protyle,
                            cellElements: [avCellElement],
                            blockElement: hasClosestBlock(assetImgElement) as HTMLElement,
                            content: target.tagName === "IMG" ? target.getAttribute("src") : target.getAttribute("data-url"),
                            type: target.tagName === "IMG" ? "image" : "file",
                            name: target.tagName === "IMG" ? "" : target.getAttribute("data-name"),
                            index,
                            rect: target.getBoundingClientRect()
                        });
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                }
            }
            // 在 span 前面，防止单元格哪 block-ref 被修改
            const avRowElement = hasClosestByClassName(target, "av__row");
            if (avRowElement && avContextmenu(protyle, avRowElement, {
                x: event.clientX,
                y: avRowElement.getBoundingClientRect().bottom,
                h: avRowElement.clientHeight
            })) {
                event.stopPropagation();
                event.preventDefault();
                return;
            }

            const avTabHeaderElement = hasClosestByClassName(target, "item");
            if (nodeElement.classList.contains("av") && avTabHeaderElement) {
                if (avTabHeaderElement.classList.contains("item--focus")) {
                    openViewMenu({protyle, blockElement: nodeElement, element: avTabHeaderElement});
                } else {
                    transaction(protyle, [{
                        action: "setAttrViewBlockView",
                        blockID: nodeElement.getAttribute("data-node-id"),
                        id: avTabHeaderElement.dataset.id,
                        avID: nodeElement.getAttribute("data-av-id"),
                    }], [{
                        action: "setAttrViewBlockView",
                        blockID: nodeElement.getAttribute("data-node-id"),
                        id: avTabHeaderElement.parentElement.querySelector(".item--focus").getAttribute("data-id"),
                        avID: nodeElement.getAttribute("data-av-id"),
                    }]);
                    window.siyuan.menus.menu.remove();
                    openViewMenu({
                        protyle,
                        blockElement: nodeElement,
                        element: avTabHeaderElement
                    });
                }
                event.stopPropagation();
                event.preventDefault();
                return;
            }

            protyle.toolbar.range = getEditorRange(protyle.element);

            if (target.tagName === "SPAN" && !isNotEditBlock(nodeElement)) { // https://ld246.com/article/1665141518103
                let types = target.getAttribute("data-type")?.split(" ") || [];
                if (types.length === 0) {
                    // https://github.com/siyuan-note/siyuan/issues/8960
                    types = (target.dataset.type || "").split(" ");
                }
                if (types.length > 0) {
                    removeSearchMark(target);
                }
                if (types.includes("block-ref")) {
                    refMenu(protyle, target);
                    // 阻止 popover
                    target.setAttribute("prevent-popover", "true");
                    setTimeout(() => {
                        target.removeAttribute("prevent-popover");
                    }, 620);
                    return false;
                } else if (types.includes("file-annotation-ref") && !protyle.disabled) {
                    fileAnnotationRefMenu(protyle, target);
                    return false;
                } else if (types.includes("tag") && !protyle.disabled) {
                    tagMenu(protyle, target);
                    return false;
                } else if (types.includes("inline-memo")) {
                    protyle.toolbar.showRender(protyle, target);
                    return false;
                } else if (types.includes("a")) {
                    linkMenu(protyle, target);
                    if (window.siyuan.config.editor.floatWindowMode === 0 &&
                        target.getAttribute("data-href")?.startsWith("siyuan://blocks")) {
                        // 阻止 popover
                        target.setAttribute("prevent-popover", "true");
                        setTimeout(() => {
                            target.removeAttribute("prevent-popover");
                        }, 620);
                    }
                    return false;
                }
            }
            const inlineMathElement = hasClosestByAttribute(target, "data-type", "inline-math");
            if (inlineMathElement) {
                inlineMathMenu(protyle, inlineMathElement);
                return false;
            }
            if (target.tagName === "IMG" && hasClosestByClassName(target, "img")) {
                imgMenu(protyle, protyle.toolbar.range, target.parentElement.parentElement, {
                    clientX: x + 4,
                    clientY: y
                });
                return false;
            }
            if (!isNotEditBlock(nodeElement) && !nodeElement.classList.contains("protyle-wysiwyg--select") &&
                !hasClosestByClassName(target, "protyle-action") && // https://github.com/siyuan-note/siyuan/issues/8983
                (isMobile() || event.detail.target || (beforeContextmenuRange && nodeElement.contains(beforeContextmenuRange.startContainer)))
            ) {
                if ((!isMobile() || protyle.toolbar?.element.classList.contains("fn__none")) && !nodeElement.classList.contains("av")) {
                    contentMenu(protyle, nodeElement);
                    window.siyuan.menus.menu.popup({x, y: y + 13, h: 26});
                    protyle.toolbar?.element.classList.add("fn__none");
                    if (nodeElement.classList.contains("table")) {
                        nodeElement.querySelector(".table__select").removeAttribute("style");
                    }
                }
            } else if (protyle.toolbar.range.toString() === "") {
                hideElements(["util"], protyle);
                if (protyle.gutter) {
                    protyle.gutter.renderMenu(protyle, nodeElement);
                }
                /// #if MOBILE
                window.siyuan.menus.menu.fullscreen();
                /// #else
                window.siyuan.menus.menu.popup({x, y});
                /// #endif
                protyle.toolbar?.element.classList.add("fn__none");
            }
        });

        this.element.addEventListener("pointerdown", () => {
            if (getSelection().rangeCount > 0) {
                beforeContextmenuRange = getSelection().getRangeAt(0);
            } else {
                beforeContextmenuRange = undefined;
            }
            /// #if BROWSER && !MOBILE
            if (protyle.breadcrumb) {
                const indentElement = protyle.breadcrumb.element.parentElement.querySelector('[data-type="indent"]');
                if (indentElement && getSelection().rangeCount > 0) {
                    setTimeout(() => {
                        const newRange = getSelection().getRangeAt(0);
                        const blockElement = hasClosestBlock(newRange.startContainer);
                        if (!blockElement) {
                            return;
                        }
                        const outdentElement = protyle.breadcrumb.element.parentElement.querySelector('[data-type="outdent"]');
                        if (blockElement.parentElement.classList.contains("li")) {
                            indentElement.removeAttribute("disabled");
                            outdentElement.removeAttribute("disabled");
                        } else {
                            indentElement.setAttribute("disabled", "true");
                            outdentElement.setAttribute("disabled", "true");
                        }
                    }, 520);
                }
            }
            /// #endif
        });

        let preventGetTopHTML = false;
        this.element.addEventListener("mousewheel", (event: WheelEvent) => {
            hideTooltip();
            // https://ld246.com/article/1648865235549
            // 不能使用上一版本的 timeStamp，否则一直滚动将导致间隔不够 https://ld246.com/article/1662852664926
            if (!preventGetTopHTML &&
                event.deltaY < 0 && !protyle.scroll.element.classList.contains("fn__none") &&
                protyle.contentElement.clientHeight === protyle.contentElement.scrollHeight &&
                protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") !== "1") {
                fetchPost("/api/filetree/getDoc", {
                    id: protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-id"),
                    mode: 1,
                    size: window.siyuan.config.editor.dynamicLoadBlocks,
                }, getResponse => {
                    preventGetTopHTML = false;
                    onGet({
                        data: getResponse,
                        protyle,
                        action: [Constants.CB_GET_BEFORE, Constants.CB_GET_UNCHANGEID],
                    });
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

        this.element.addEventListener("paste", (event: ClipboardEvent & { target: HTMLElement }) => {
            // https://github.com/siyuan-note/siyuan/issues/11241
            if (event.target.localName === "input" && event.target.getAttribute("data-type") === "av-search") {
                return;
            }
            if (protyle.disabled) {
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            window.siyuan.ctrlIsPressed = false; // https://github.com/siyuan-note/siyuan/issues/6373
            // https://github.com/siyuan-note/siyuan/issues/4600
            if (event.target.tagName === "PROTYLE-HTML" || event.target.localName === "input") {
                event.stopPropagation();
                return;
            }
            if (!hasClosestByAttribute(event.target, "contenteditable", "true")) {
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            const blockElement = hasClosestBlock(event.target);
            if (blockElement && !getContenteditableElement(blockElement)) {
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            if (!blockElement) {
                return;
            }
            // 链接，备注，样式，引用，pdf标注粘贴 https://github.com/siyuan-note/siyuan/issues/11572
            const range = getSelection().getRangeAt(0);
            protyle.toolbar.range = range;
            const inlineElement = range.startContainer.parentElement;
            if (range.toString() === "" && inlineElement.tagName === "SPAN") {
                const currentTypes = (inlineElement.getAttribute("data-type") || "").split(" ");
                if (currentTypes.includes("inline-memo") || currentTypes.includes("text") ||
                    currentTypes.includes("block-ref") || currentTypes.includes("file-annotation-ref") ||
                    currentTypes.includes("a")) {
                    const offset = getSelectionOffset(inlineElement, blockElement, range);
                    if (offset.start === 0) {
                        range.setStartBefore(inlineElement);
                        range.collapse(true);
                    } else if (offset.start === inlineElement.textContent.length) {
                        range.setEndAfter(inlineElement);
                        range.collapse(false);
                    }
                }
            }
            paste(protyle, event);
        });

        // 输入法测试点 https://github.com/siyuan-note/siyuan/issues/3027
        let isComposition = false; // for iPhone
        this.element.addEventListener("compositionstart", (event) => {
            isComposition = true;
            // 微软双拼由于 focusByRange 导致无法输入文字，因此不再 keydown 中记录了，但 keyup 会记录拼音字符，因此使用 isComposition 阻止 keyup 记录。
            // 但搜狗输入法选中后继续输入不走 keydown，isComposition 阻止了 keyup 记录，因此需在此记录。
            const range = getEditorRange(protyle.wysiwyg.element);
            const nodeElement = hasClosestBlock(range.startContainer);
            if (!isMac() && nodeElement) {
                setInsertWbrHTML(nodeElement, range, protyle);
            }
            event.stopPropagation();
        });

        this.element.addEventListener("compositionend", (event: InputEvent) => {
            event.stopPropagation();
            isComposition = false;
            const range = getEditorRange(this.element);
            const blockElement = hasClosestBlock(range.startContainer);
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

        let timeout: number;
        this.element.addEventListener("input", (event: InputEvent) => {
            const target = event.target as HTMLElement;
            if (target.tagName === "VIDEO" || target.tagName === "AUDIO" || event.inputType === "historyRedo") {
                return;
            }
            if (event.inputType === "historyUndo") {
                /// #if !BROWSER
                ipcRenderer.send(Constants.SIYUAN_CMD, "redo");
                /// #endif
                window.siyuan.menus.menu.remove();
                return;
            }
            const range = getEditorRange(this.element);
            const blockElement = hasClosestBlock(range.startContainer);
            if (!blockElement) {
                return;
            }
            if ([":", "(", "【", "（", "[", "{", "「", "『", "#", "/", "、"].includes(event.data)) {
                protyle.hint.enableExtend = true;
            }
            if (event.isComposing || isComposition ||
                // https://github.com/siyuan-note/siyuan/issues/337 编辑器内容拖拽问题
                event.inputType === "deleteByDrag" || event.inputType === "insertFromDrop"
            ) {
                return;
            }
            this.escapeInline(protyle, range, event);

            if ((/^\d{1}$/.test(event.data) || event.data === "‘" || event.data === "“" ||
                // 百度输入法中文反双引号 https://github.com/siyuan-note/siyuan/issues/9686
                event.data === "”" ||
                event.data === "「")) {
                clearTimeout(timeout);  // https://github.com/siyuan-note/siyuan/issues/9179
                timeout = window.setTimeout(() => {
                    input(protyle, blockElement, range, true); // 搜狗拼音数字后面句号变为点；Mac 反向双引号无法输入
                });
            } else {
                if (isMac() && event.data === "【】") {
                    setTimeout(() => {
                        input(protyle, blockElement, range, true, event);
                    }, Constants.TIMEOUT_INPUT);
                } else {
                    input(protyle, blockElement, range, true, event);
                }
            }
            event.stopPropagation();
        });

        this.element.addEventListener("keyup", (event) => {
            const range = getEditorRange(this.element).cloneRange();
            const nodeElement = hasClosestBlock(range.startContainer);

            if (event.key !== "PageUp" && event.key !== "PageDown" && event.key !== "Home" && event.key !== "End" &&
                event.key.indexOf("Arrow") === -1 && event.key !== "Escape" && event.key !== "Shift" &&
                event.key !== "Meta" && event.key !== "Alt" && event.key !== "Control" && event.key !== "CapsLock" &&
                !event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey &&
                !/^F\d{1,2}$/.test(event.key)) {
                // 搜狗输入法不走 keydown，没有选中字符后不走 compositionstart，需重新记录历史状态
                if (!isMac() && nodeElement &&
                    // 微软双拼 keyup 会记录拼音字符，因此在 compositionstart 记录
                    !isComposition &&
                    (typeof protyle.wysiwyg.lastHTMLs[nodeElement.getAttribute("data-node-id")] === "undefined" || range.toString() !== "" || !this.preventKeyup)) {
                    setInsertWbrHTML(nodeElement, range, protyle);
                }
                this.preventKeyup = false;
                return;
            }

            // 需放在 lastHTMLs 后，否则 https://github.com/siyuan-note/siyuan/issues/4388
            if (this.preventKeyup) {
                this.preventKeyup = false;
                return;
            }

            if ((event.shiftKey || isOnlyMeta(event)) && !event.isComposing && range.toString() !== "") {
                // 工具栏
                protyle.toolbar.render(protyle, range, event);
                countSelectWord(range);
            }

            if (event.eventPhase !== 3 && !event.shiftKey && (event.key.indexOf("Arrow") > -1 || event.key === "Home" || event.key === "End" || event.key === "PageUp" || event.key === "PageDown") && !event.isComposing) {
                if (nodeElement) {
                    clearSelect(["img", "av"], protyle.wysiwyg.element);
                    this.setEmptyOutline(protyle, nodeElement);
                    if (range.toString() === "" && !nodeElement.classList.contains("protyle-wysiwyg--select")) {
                        countSelectWord(range, protyle.block.rootID);
                    }
                    if (protyle.breadcrumb) {
                        const indentElement = protyle.breadcrumb.element.parentElement.querySelector('[data-type="indent"]');
                        if (indentElement) {
                            const outdentElement = protyle.breadcrumb.element.parentElement.querySelector('[data-type="outdent"]');
                            if (nodeElement.parentElement.classList.contains("li")) {
                                indentElement.removeAttribute("disabled");
                                outdentElement.removeAttribute("disabled");
                            } else {
                                indentElement.setAttribute("disabled", "true");
                                outdentElement.setAttribute("disabled", "true");
                            }
                        }
                    }
                }
                event.stopPropagation();
            }

            // 按下方向键后块高亮跟随光标移动 https://github.com/siyuan-note/siyuan/issues/8918
            if ((event.key === "ArrowLeft" || event.key === "ArrowRight") &&
                nodeElement && !nodeElement.classList.contains("protyle-wysiwyg--select")) {
                const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
                let containRange = false;
                selectElements.find(item => {
                    if (item.contains(range.startContainer)) {
                        containRange = true;
                        return true;
                    }
                });
                if (!containRange && selectElements.length > 0) {
                    selectElements.forEach(item => {
                        item.classList.remove("protyle-wysiwyg--select");
                    });
                    nodeElement.classList.add("protyle-wysiwyg--select");
                }
            }
        });

        this.element.addEventListener("dblclick", (event: MouseEvent & { target: HTMLElement }) => {
            if (event.target.tagName === "IMG" && !event.target.classList.contains("emoji")) {
                previewDocImage((event.target as HTMLElement).getAttribute("src"), protyle.block.rootID);
                return;
            }
        });
        let mobileBlur = false;
        this.element.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            if (this.preventClick) {
                this.preventClick = false;
                return;
            }
            protyle.app.plugins.forEach(item => {
                item.eventBus.emit("click-editorcontent", {
                    protyle,
                    event
                });
            });
            hideElements(["hint", "util"], protyle);
            const ctrlIsPressed = isOnlyMeta(event);
            const backlinkBreadcrumbItemElement = hasClosestByClassName(event.target, "protyle-breadcrumb__item");
            if (backlinkBreadcrumbItemElement) {
                const breadcrumbId = backlinkBreadcrumbItemElement.getAttribute("data-id");
                /// #if !MOBILE
                if (breadcrumbId) {
                    if (ctrlIsPressed && !event.shiftKey && !event.altKey) {
                        checkFold(breadcrumbId, (zoomIn) => {
                            openFileById({
                                app: protyle.app,
                                id: breadcrumbId,
                                action: zoomIn ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                                zoomIn
                            });
                        });
                    } else {
                        loadBreadcrumb(protyle, backlinkBreadcrumbItemElement);
                    }
                } else {
                    // 引用标题时的更多加载
                    getBacklinkHeadingMore(backlinkBreadcrumbItemElement);
                }
                /// #else
                if (breadcrumbId) {
                    loadBreadcrumb(protyle, backlinkBreadcrumbItemElement);
                }
                /// #endif
                event.stopPropagation();
                return;
            }

            this.setEmptyOutline(protyle, event.target);
            const tableElement = hasClosestByClassName(event.target, "table");
            this.element.querySelectorAll(".table").forEach(item => {
                if (item.tagName !== "DIV") {
                    return;
                }
                if (!tableElement || item !== tableElement) {
                    item.querySelector(".table__select").removeAttribute("style");
                }
                if (tableElement && tableElement === item && item.querySelector(".table__select").getAttribute("style")) {
                    // 防止合并单元格的菜单消失
                    event.stopPropagation();
                }
            });
            // 面包屑定位，需至于前，否则 return 的元素就无法进行面包屑定位
            if (protyle.options.render.breadcrumb) {
                protyle.breadcrumb.render(protyle, false, hasClosestBlock(event.target));
            }
            const range = getEditorRange(this.element);
            // https://github.com/siyuan-note/siyuan/issues/12317
            if (range.startContainer.nodeType !== 3 &&
                (range.startContainer as Element).classList.contains("protyle-action") &&
                range.startContainer.parentElement.classList.contains("code-block")) {
                setFirstNodeRange(range.startContainer.parentElement.querySelector(".hljs").lastElementChild, range);
            }
            // 需放在嵌入块之前，否则嵌入块内的引用、链接、pdf 双链无法点击打开 https://ld246.com/article/1630479789513
            const aElement = hasClosestByAttribute(event.target, "data-type", "a") ||
                hasClosestByClassName(event.target, "av__celltext--url");   // 数据库中资源文件、链接、电话、邮箱单元格
            let aLink = aElement ? (aElement.getAttribute("data-href") || "") : "";
            if (aElement && !aLink && aElement.classList.contains("av__celltext--url")) {
                aLink = aElement.textContent.trim();
                if (aElement.dataset.type === "phone") {
                    aLink = "tel:" + aLink;
                } else if (aElement.dataset.type === "email") {
                    aLink = "mailto:" + aLink;
                } else if (aElement.classList.contains("b3-chip")) {
                    aLink = aElement.dataset.url;
                }
            }

            const blockRefElement = hasClosestByAttribute(event.target, "data-type", "block-ref");
            if (blockRefElement || aLink.startsWith("siyuan://blocks/")) {
                event.stopPropagation();
                event.preventDefault();
                hideElements(["dialog", "toolbar"], protyle);
                if (range.toString() === "" || event.shiftKey) {
                    let refBlockId: string;
                    if (blockRefElement) {
                        refBlockId = blockRefElement.getAttribute("data-id");
                    } else if (aElement) {
                        refBlockId = aLink.substring(16, 38);
                    }
                    checkFold(refBlockId, (zoomIn, action, isRoot) => {
                        // 块引用跳转后需要短暂高亮目标块 https://github.com/siyuan-note/siyuan/issues/11542
                        if (!isRoot) {
                            action.push(Constants.CB_GET_HL);
                        }
                        /// #if MOBILE
                        mobileBlur = true;
                        activeBlur();
                        openMobileFileById(protyle.app, refBlockId, zoomIn ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL], "start");
                        /// #else
                        if (event.shiftKey) {
                            openFileById({
                                app: protyle.app,
                                id: refBlockId,
                                position: "bottom",
                                action,
                                zoomIn,
                                scrollPosition: "start"
                            });
                            window.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
                        } else if (event.altKey) {
                            openFileById({
                                app: protyle.app,
                                id: refBlockId,
                                position: "right",
                                action,
                                zoomIn,
                                scrollPosition: "start"
                            });
                        } else if (ctrlIsPressed) {
                            openFileById({
                                app: protyle.app,
                                id: refBlockId,
                                keepCursor: true,
                                action: zoomIn ? [Constants.CB_GET_HL, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                                zoomIn,
                                scrollPosition: "start"
                            });
                        } else {
                            openFileById({
                                app: protyle.app,
                                id: refBlockId,
                                action,
                                zoomIn,
                                scrollPosition: "start"
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
            }
            /// #if MOBILE
            // https://github.com/siyuan-note/siyuan/issues/10513
            const virtualRefElement = hasClosestByAttribute(event.target, "data-type", "virtual-block-ref");
            if (virtualRefElement && range.toString() === "") {
                event.stopPropagation();
                event.preventDefault();
                const blockElement = hasClosestBlock(virtualRefElement);
                if (blockElement) {
                    fetchPost("/api/block/getBlockDefIDsByRefText", {
                        anchor: virtualRefElement.textContent,
                        excludeIDs: [blockElement.getAttribute("data-node-id")]
                    }, (response) => {
                        checkFold(response.data.refDefs[0].refID, (zoomIn) => {
                            mobileBlur = true;
                            activeBlur();
                            openMobileFileById(protyle.app, response.data.refDefs[0].refID, zoomIn ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
                        });
                    });
                }
                return;
            }
            /// #endif

            const fileElement = hasClosestByAttribute(event.target, "data-type", "file-annotation-ref");
            if (fileElement && range.toString() === "") {
                event.stopPropagation();
                event.preventDefault();
                openLink(protyle, fileElement.getAttribute("data-id"), event, ctrlIsPressed);
                return;
            }

            if (aElement &&
                // https://github.com/siyuan-note/siyuan/issues/11980
                (event.shiftKey || range.toString() === "") &&
                // 如果aLink 为空时，当 data-type="a inline-math" 可继续后续操作
                aLink) {
                event.stopPropagation();
                event.preventDefault();
                openLink(protyle, aLink, event, ctrlIsPressed);
                return;
            }

            if (aElement && aElement.classList.contains("av__celltext--url") && !aLink) {
                let index = 0;
                Array.from(aElement.parentElement.children).find((item, i) => {
                    if (item === aElement) {
                        index = i;
                        return true;
                    }
                });
                editAssetItem({
                    protyle,
                    cellElements: [aElement.parentElement],
                    blockElement: hasClosestBlock(aElement) as HTMLElement,
                    content: aElement.getAttribute("data-url"),
                    type: "file",
                    name: aElement.getAttribute("data-name"),
                    index,
                    rect: aElement.getBoundingClientRect()
                });
                return;
            }

            const tagElement = hasClosestByAttribute(event.target, "data-type", "tag");
            if (tagElement && !event.altKey && !event.shiftKey && range.toString() === "") {
                /// #if !MOBILE
                openGlobalSearch(protyle.app, `#${tagElement.textContent}#`, !ctrlIsPressed, {method: 0});
                hideElements(["dialog"]);
                /// #else
                popSearch(protyle.app, {
                    hasReplace: false,
                    method: 0,
                    hPath: "",
                    idPath: [],
                    k: `#${tagElement.textContent}#`,
                    r: "",
                    page: 1,
                });
                /// #endif
                return;
            }

            const embedItemElement = hasClosestByClassName(event.target, "protyle-wysiwyg__embed");
            if (embedItemElement) {
                const embedId = embedItemElement.getAttribute("data-id");
                checkFold(embedId, (zoomIn, action) => {
                    /// #if MOBILE
                    mobileBlur = true;
                    activeBlur();
                    openMobileFileById(protyle.app, embedId, zoomIn ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
                    /// #else
                    if (event.shiftKey) {
                        openFileById({
                            app: protyle.app,
                            id: embedId,
                            position: "bottom",
                            action,
                            zoomIn
                        });
                    } else if (event.altKey) {
                        openFileById({
                            app: protyle.app,
                            id: embedId,
                            position: "right",
                            action,
                            zoomIn
                        });
                    } else if (ctrlIsPressed) {
                        openFileById({
                            app: protyle.app,
                            id: embedId,
                            action: zoomIn ? [Constants.CB_GET_HL, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT],
                            zoomIn,
                            keepCursor: true,
                        });
                    } else if (!protyle.disabled) {
                        window.siyuan.blockPanels.push(new BlockPanel({
                            app: protyle.app,
                            targetElement: embedItemElement,
                            isBacklink: false,
                            refDefs: [{refID: embedId}]
                        }));
                    }
                    /// #endif
                });
                // https://github.com/siyuan-note/siyuan/issues/12585
                if (!ctrlIsPressed) {
                    event.stopPropagation();
                    return;
                }
            }

            if (commonClick(event, protyle)) {
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
                /// #if MOBILE
                window.siyuan.menus.menu.fullscreen();
                /// #else
                const rect = menuElement.getBoundingClientRect();
                window.siyuan.menus.menu.popup({
                    x: rect.left,
                    y: rect.top,
                    isLeft: true
                });
                /// #endif
                event.stopPropagation();
                event.preventDefault();
                return;
            }

            const reloadElement = hasClosestByClassName(event.target, "protyle-action__reload");
            if (reloadElement) {
                const embedReloadElement = isInEmbedBlock(reloadElement);
                if (embedReloadElement) {
                    embedReloadElement.removeAttribute("data-render");
                    blockRender(protyle, embedReloadElement);
                } else {
                    const blockElement = hasClosestBlock(reloadElement);
                    if (blockElement && blockElement.getAttribute("data-subtype") === "echarts") {
                        blockElement.removeAttribute("data-render");
                        chartRender(blockElement);
                    }
                }
                event.stopPropagation();
                event.preventDefault();
                return;
            }

            const languageElement = hasClosestByClassName(event.target, "protyle-action__language");
            if (languageElement && !protyle.disabled && !ctrlIsPressed) {
                protyle.toolbar.showCodeLanguage(protyle, [languageElement]);
                event.stopPropagation();
                event.preventDefault();
                return;
            }

            // 需放在属性后，否则数学公式无法点击属性；需放在 action 后，否则嵌入块的的 action 无法打开；需放在嵌入块后，否则嵌入块中的数学公式会被打开
            const mathElement = hasClosestByAttribute(event.target, "data-subtype", "math");
            if (!event.shiftKey && !ctrlIsPressed && mathElement && !protyle.disabled) {
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
                    event.stopPropagation();
                    return;
                } else if (actionElement.parentElement.classList.contains("li")) {
                    const actionId = actionElement.parentElement.getAttribute("data-node-id");
                    if (event.altKey && !protyle.disabled) {
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
                    } else if (event.shiftKey && !protyle.disabled) {
                        openAttr(actionElement.parentElement, "bookmark", protyle);
                    } else if (ctrlIsPressed) {
                        zoomOut({protyle, id: actionId});
                    } else {
                        if (actionElement.classList.contains("protyle-action--task")) {
                            if (!protyle.disabled) {
                                const html = actionElement.parentElement.outerHTML;
                                if (actionElement.parentElement.classList.contains("protyle-task--done")) {
                                    actionElement.querySelector("use").setAttribute("xlink:href", "#iconUncheck");
                                    actionElement.parentElement.classList.remove("protyle-task--done");
                                } else {
                                    actionElement.querySelector("use").setAttribute("xlink:href", "#iconCheck");
                                    actionElement.parentElement.classList.add("protyle-task--done");
                                }
                                actionElement.parentElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                                updateTransaction(protyle, actionId, actionElement.parentElement.outerHTML, html);
                            }
                        } else if (window.siyuan.config.editor.listItemDotNumberClickFocus) {
                            if (protyle.block.showAll && protyle.block.id === actionId) {
                                enterBack(protyle, actionId);
                            } else {
                                zoomOut({protyle, id: actionId});
                            }
                        }
                    }
                    event.stopPropagation();
                    return;
                }
            }

            const selectElement = hasClosestByClassName(event.target, "hr") ||
                hasClosestByClassName(event.target, "iframe");
            if (!event.shiftKey && !ctrlIsPressed && selectElement) {
                selectElement.classList.add("protyle-wysiwyg--select");
                globalClickHideMenu(event.target);
                event.stopPropagation();
                return;
            }

            const imgElement = hasTopClosestByClassName(event.target, "img");
            if (!event.shiftKey && !ctrlIsPressed && imgElement) {
                imgElement.classList.add("img--select");
                const nextSibling = hasNextSibling(imgElement);
                if (nextSibling) {
                    if (nextSibling.textContent.startsWith(Constants.ZWSP)) {
                        range.setStart(nextSibling, 1);
                    } else {
                        range.setStart(nextSibling, 0);
                    }
                    range.collapse(true);
                    focusByRange(range);
                    // 需等待 range 更新再次进行渲染
                    if (protyle.options.render.breadcrumb) {
                        protyle.breadcrumb.render(protyle);
                    }
                }
                return;
            }

            const calloutTitleElement = hasTopClosestByClassName(event.target, "callout-title");
            if (!protyle.disabled && !event.shiftKey && !ctrlIsPressed && calloutTitleElement) {
                updateCalloutType([hasClosestBlock(calloutTitleElement) as HTMLElement], protyle);
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const calloutIconElement = hasTopClosestByClassName(event.target, "callout-icon");
            if (!protyle.disabled && !event.shiftKey && !ctrlIsPressed && calloutIconElement) {
                const nodeElement = hasClosestBlock(calloutIconElement);
                if (nodeElement) {
                    const emojiRect = calloutIconElement.getBoundingClientRect();
                    openEmojiPanel("", "av", {
                        x: emojiRect.left,
                        y: emojiRect.bottom,
                        h: emojiRect.height,
                        w: emojiRect.width
                    }, (unicode) => {
                        const oldHTML = nodeElement.outerHTML;
                        let emojiHTML;
                        if (unicode.startsWith("api/icon/getDynamicIcon")) {
                            emojiHTML = `<img class="callout-img" src="${unicode}"/>`;
                        } else if (unicode.indexOf(".") > -1) {
                            emojiHTML = `<img class="callout-img" src="/emojis/${unicode}">`;
                        } else {
                            emojiHTML = unicode2Emoji(unicode);
                        }
                        if (unicode === "") {
                            const subType = nodeElement.getAttribute("data-subtype");
                            if (subType === "NOTE") {
                                emojiHTML = "✏️";
                            } else if (subType === "TIP") {
                                emojiHTML = "💡";
                            } else if (subType === "IMPORTANT") {
                                emojiHTML = "❗";
                            } else if (subType === "WARNING") {
                                emojiHTML = "⚠️";
                            } else if (subType === "CAUTION") {
                                emojiHTML = "🚨";
                            }
                        }
                        calloutIconElement.innerHTML = emojiHTML;
                        updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                        focusBlock(nodeElement);
                    }, calloutIconElement.querySelector("img"));
                }
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            const emojiElement = hasTopClosestByClassName(event.target, "emoji");
            if (!protyle.disabled && !event.shiftKey && !ctrlIsPressed && emojiElement) {
                const nodeElement = hasClosestBlock(emojiElement);
                if (nodeElement) {
                    const emojiRect = emojiElement.getBoundingClientRect();
                    openEmojiPanel("", "av", {
                        x: emojiRect.left,
                        y: emojiRect.bottom,
                        h: emojiRect.height,
                        w: emojiRect.width
                    }, (unicode) => {
                        emojiElement.insertAdjacentHTML("afterend", "<wbr>");
                        const oldHTML = nodeElement.outerHTML;
                        let emojiHTML;
                        if (unicode.startsWith("api/icon/getDynamicIcon")) {
                            emojiHTML = `<img class="emoji" src="${unicode}"/>`;
                        } else if (unicode.indexOf(".") > -1) {
                            const emojiList = unicode.split(".");
                            emojiHTML = `<img alt="${emojiList[0]}" class="emoji" src="/emojis/${unicode}" title="${emojiList[0]}">`;
                        } else {
                            emojiHTML = unicode2Emoji(unicode);
                        }
                        emojiElement.outerHTML = emojiHTML;
                        hideElements(["dialog"]);
                        updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                        focusByWbr(nodeElement, range);
                    }, emojiElement);
                }
                return;
            }

            if (avClick(protyle, event)) {
                return;
            }

            setTimeout(() => {
                // 选中后，在选中的文字上点击需等待 range 更新
                let newRange = getEditorRange(this.element);
                // 点击两侧或间隙导致光标跳转到开头 https://github.com/siyuan-note/siyuan/issues/16179
                if (hasClosestBlock(event.target) !== hasClosestBlock(newRange.startContainer) &&
                    this.element.querySelector("[data-node-id]")?.contains(newRange.startContainer)) {
                    const rect = this.element.getBoundingClientRect();
                    let rangeElement = document.elementFromPoint(rect.left + rect.width / 2, event.clientY);
                    if (rangeElement === this.element) {
                        rangeElement = document.elementFromPoint(rect.left + rect.width / 2, event.clientY + 8);
                    }
                    let blockElement = hasClosestBlock(rangeElement);
                    if (blockElement) {
                        const embedElement = isInEmbedBlock(blockElement);
                        if (embedElement) {
                            blockElement = embedElement;
                        }
                        newRange = focusBlock(blockElement, undefined, event.clientX < rect.left + parseInt(this.element.style.paddingLeft)) || newRange;
                        if (protyle.options.render.breadcrumb) {
                            protyle.breadcrumb.render(protyle, false, blockElement);
                        }
                    }
                }
                // https://github.com/siyuan-note/siyuan/issues/10357
                const attrElement = hasClosestByClassName(newRange.endContainer, "protyle-attr");
                if (attrElement) {
                    newRange = setLastNodeRange(attrElement.previousElementSibling, newRange, false);
                }
                // https://github.com/siyuan-note/siyuan/issues/14481
                const inlineMathElement = hasClosestByAttribute(newRange.startContainer, "data-type", "inline-math");
                if (inlineMathElement) {
                    newRange.setEndAfter(inlineMathElement);
                    newRange.collapse(false);
                    focusByRange(newRange);
                }
                /// #if !MOBILE
                if (newRange.toString().replace(Constants.ZWSP, "") !== "") {
                    protyle.toolbar.render(protyle, newRange);
                } else {
                    // https://github.com/siyuan-note/siyuan/issues/9785
                    protyle.toolbar.range = newRange;
                }
                /// #endif
                if (!protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--select")) {
                    countSelectWord(newRange, protyle.block.rootID);
                }
                if (getSelection().rangeCount === 0 && !mobileBlur) {
                    // https://github.com/siyuan-note/siyuan/issues/14589
                    // https://github.com/siyuan-note/siyuan/issues/14569
                    // https://github.com/siyuan-note/siyuan/issues/5901
                    focusByRange(newRange);
                }
                /// #if !MOBILE
                pushBack(protyle, newRange);
                /// #endif
                mobileBlur = false;
            }, (isMobile() || isInIOS()) ? 520 : 0); // Android/iPad 双击慢了出不来

            protyle.hint.enableExtend = false;

            if (this.element.querySelector(".protyle-wysiwyg--select") && range.toString() !== "") {
                // 选中块后，文字不能被选中。需在 shift click 之后，防止shift点击单个块出现文字选中
                range.collapse(false);
                focusByRange(range);
            }
        });
    }
}
