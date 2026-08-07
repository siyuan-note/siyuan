import {
    beforePaste,
    convertPastedListItemSubtype,
    enableLuteMarkdownSyntax,
    getPlainText,
    getTextStar,
    normalizeVirtualBlockRef,
    paste,
    restoreLuteMarkdownSyntax
} from "../util/paste";
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
    focusByOffset,
    focusByRange,
    focusByWbr,
    focusSideBlock,
    getBlockRangeSelectElements,
    getBlockRanges,
    getEditorRange,
    getSelectionOffset,
    getUndoFocusContext,
    setFirstNodeRange,
    setInsertWbrHTML,
    setLastNodeRange,
} from "../util/selection";
import {Constants} from "../../constants";
import {isMobile} from "../../util/functions";
import {previewDocImage} from "../preview/image";
import {getDiagramBlock, previewDiagram} from "../preview/diagram";
import {
    contentMenu,
    enterBack,
    fileAnnotationRefMenu,
    imgMenu,
    inlineMathMenu,
    linkMenu,
    refMenu,
    tagMenu,
    zoomOut
} from "../../menus/protyle";
import * as dayjs from "dayjs";
import {dropEvent} from "../util/editorCommonEvent";
import {beforeBlockquoteInput, input} from "./input";
import {
    getContenteditableElement,
    getFirstBlock,
    getLastBlock,
    getNextBlock,
    getTopAloneElement,
    hasNextSibling,
    hasPreviousSibling,
    isContainerBlock,
    isEndOfBlock,
    isNotEditBlock
} from "./getBlock";
import {transaction, updateTransaction} from "./transaction";
import {toggleTaskListItem} from "./list";
import {hideElements} from "../ui/hideElements";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {getEnableHTML, removeEmbed} from "./removeEmbed";
import {keydown} from "./keydown";
import {openMobileFileById} from "../../mobile/editor";
import {
    getImageBlockRefCheckTargets,
    getRangeBlockRefCheckTargets,
    IBlockRefCheckTargets,
    removeBlock,
    removeCrossBlockRange
} from "./remove";
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
import {
    copyPlainText,
    encodeBase64,
    isInAndroid,
    isInHarmony,
    isInIOS,
    isMac,
    isOnlyMeta,
    readClipboard
} from "../util/compatibility";
import {MenuItem} from "../../menus/Menu";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {
    buildTableGrid,
    clearTableCell,
    deleteTableColumns,
    deleteTableRows,
    getTableCellSelectionIndexes,
    getTableRangeHTML,
    isIncludeCell,
    updateTableTitle,
} from "../util/table";
import {getTableCellsInRectangle} from "../util/tableSelection";
import {
    getTableCellAlignmentMenus,
    getTableCellBackgroundMenus,
    setTableCellStyle,
    TableControl,
} from "../util/tableControl";
import {countBlockWord, countSelectWord} from "../../layout/status";
import {showMessage} from "../../dialog/message";
import {getBacklinkHeadingMore, loadBreadcrumb} from "./renderBacklink";
import {removeSearchMark} from "../toolbar/util";
import {getTableCellTextStyleMenus} from "../toolbar/tableCell";
import {activeBlur} from "../../mobile/util/keyboardToolbar";
import {commonClick} from "./commonClick";
import {avClick, avContextmenu, updateAVName} from "../render/av/action";
import {selectRow, stickyRow, updateHeader} from "../render/av/row";
import {getAVSelectedItemIDs, getAVSelectedTableCells, updateAVRowSelect} from "../render/av/virtualScroll";
import {autoFitAVColumns, setFreezeColumn, showAVColumnWidthMenu, showColMenu} from "../render/av/col";
import {openViewMenu} from "../render/av/view";
import {getAVCurrentViewID} from "../render/av/viewVisibility";
import {checkFold} from "../../util/noRelyPCFunction";
import {confirmBlockRef} from "../../util/checkBlockRef";
import {
    addDragFill,
    dragFillCellsValue,
    getAVCellData,
    getAVSelectedCellData,
    genCellValueByElement,
    getCellText,
    getPositionByCellElement,
    getTypeByCellElement,
    updateCellsValue
} from "../render/av/cell";
import {getAVSelectedCells} from "../render/av/selectionState";
import {openEmojiPanel, unicode2Emoji} from "../../emoji";
import {getIconValueKind} from "../../emoji/iconValue";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {openLink} from "../../editor/openLink";
import {mathRender} from "../render/mathRender";
import {editAssetItem} from "../render/av/asset";
import {img3115} from "../../boot/compatibleVersion";
import {dragOverScroll, stopScrollAnimation} from "../../boot/globalEvent/dragover";
import {globalClickHideMenu} from "../../boot/globalEvent/click";
import {hideTooltip} from "../../dialog/tooltip";
import {openGalleryItemMenu} from "../render/av/gallery/util";
import {clearSelect} from "../util/clear";
import {chartRender} from "../render/chartRender";
import {reloadProtyle} from "../util/reload";
import {updateCalloutType} from "./callout";
import {nbsp2space, removeZWJ} from "../util/normalizeText";
import {setFold} from "../util/blockFold";
import {BlockPanel} from "../../block/Panel";
import {isEncryptedBox, parseSiYuanUriInfo} from "../../util/pathName";
import {processSiYuanUri} from "../../util/uri";
import {enhanceRichClipboard, prepareRichClipboardHTML} from "../util/richClipboard";
import {addSpellcheckMenuItems, requestSpellcheckContext} from "../../menus/spellcheck";
import {getAVTemplateInteractiveElement, isAVTemplateLink} from "../render/av/attributeValue";
import {focusAVByArrow} from "../render/av/focus";
import {applyAVDragSelection, clearAVDragSelection, isAVDragSelectSupported} from "../render/av/dragSelect";
import {
    selectAVCellRange,
    selectAVItemRange,
    setAVCellAnchor,
    setAVDragItemAnchor,
    setAVItemAnchor,
} from "../render/av/rangeSelect";
import {getAVColumnResizeWidth} from "../render/av/columnWidth";
import {
    clampBlockDragSelectY,
    getBlockDragSelectBlock,
    getBlockDragSelectProbeX,
    isBlockDragSelectBottomReached,
    isBlockDragSelectTopReached,
    resolveBlockDragSelectStart
} from "./blockDragSelect";

interface IShiftClickBlockPoint {
    blockElement: HTMLElement;
    toStart: boolean;
}

const getShiftClickBlockByPoint = (wysiwygElement: HTMLElement, startElement: HTMLElement, x: number, y: number) => {
    const blockElements = Array.from(wysiwygElement.children).filter(item =>
        item.getAttribute("data-type")?.startsWith("Node")) as HTMLElement[];
    if (blockElements.length === 0) {
        return;
    }

    const firstElement = blockElements[0];
    const lastElement = blockElements[blockElements.length - 1];
    const firstRect = firstElement.getBoundingClientRect();
    const lastRect = lastElement.getBoundingClientRect();
    if (y <= firstRect.top) {
        return {
            blockElement: getFirstBlock(firstElement) as HTMLElement,
            toStart: true,
        };
    }
    if (y >= lastRect.bottom) {
        return {
            blockElement: getLastBlock(lastElement) as HTMLElement,
            toStart: false,
        };
    }

    const startRect = startElement.getBoundingClientRect();
    const horizontal = y >= startRect.top && y <= startRect.bottom;
    const toStart = horizontal ?
        x < startRect.left + startRect.width / 2 :
        y < startRect.top + startRect.height / 2;
    const stepX = horizontal ? (toStart ? 4 : -4) : 0;
    const stepY = horizontal ? 0 : (toStart ? 4 : -4);
    const wysiwygRect = wysiwygElement.getBoundingClientRect();
    const wysiwygStyle = window.getComputedStyle(wysiwygElement);
    const minX = wysiwygRect.left + (parseFloat(wysiwygStyle.paddingLeft) || 0) + 1;
    const maxX = wysiwygRect.right - (parseFloat(wysiwygStyle.paddingRight) || 0) - 1;
    let probeX = Math.max(minX, Math.min(x, maxX));
    let probeY = y;
    let containerBlockElement: HTMLElement | undefined;
    while (horizontal ? (stepX > 0 ? probeX < maxX : probeX > minX) :
        (stepY > 0 ? probeY < wysiwygRect.bottom : probeY > wysiwygRect.top)) {
        probeX += stepX;
        probeY += stepY;
        const pointElement = document.elementFromPoint(probeX, probeY);
        if (!pointElement || (pointElement !== wysiwygElement && !wysiwygElement.contains(pointElement))) {
            continue;
        }
        const blockElement = hasClosestBlock(pointElement) as HTMLElement;
        if (!blockElement || !wysiwygElement.contains(blockElement)) {
            continue;
        }
        if (!isContainerBlock(blockElement)) {
            return {
                blockElement,
                toStart,
            };
        }
        containerBlockElement = containerBlockElement || blockElement;
    }
    if (containerBlockElement) {
        return {
            blockElement: (toStart ? getFirstBlock(containerBlockElement) :
                getLastBlock(containerBlockElement)) as HTMLElement,
            toStart,
        };
    }
};

const extendSelectionToBlockSide = (selection: Selection, blockElement: HTMLElement, toStart: boolean) => {
    if (!selection.anchorNode || !blockElement.contains(selection.anchorNode)) {
        return false;
    }
    const editableElement = getContenteditableElement(blockElement);
    if (!editableElement) {
        return false;
    }
    const boundaryRange = document.createRange();
    boundaryRange.selectNodeContents(editableElement);
    boundaryRange.collapse(toStart);
    selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset,
        boundaryRange.startContainer, boundaryRange.startOffset);
    return true;
};

export class WYSIWYG {
    public lastHTMLs: { [key: string]: string } = {};
    public element: HTMLDivElement;
    public preventKeyup: boolean;

    private preventClick: boolean;
    private preventInput: boolean;
    private copyAsRichText = false;
    private inputTimeout: number;
    private pendingInputTimeouts = new Map<number, () => void>();
    public tableControl: TableControl;

    private scheduleInput(callback: () => void, delay = 0, replace = true) {
        if (replace && this.inputTimeout) {
            clearTimeout(this.inputTimeout);
            this.pendingInputTimeouts.delete(this.inputTimeout);
        }
        const timeout = window.setTimeout(() => {
            this.pendingInputTimeouts.delete(timeout);
            if (this.inputTimeout === timeout) {
                this.inputTimeout = undefined;
            }
            callback();
        }, delay);
        this.pendingInputTimeouts.set(timeout, callback);
        if (replace) {
            this.inputTimeout = timeout;
        }
    }

    public flushPendingInput() {
        const callbacks = Array.from(this.pendingInputTimeouts.values());
        this.pendingInputTimeouts.forEach((callback, timeout) => clearTimeout(timeout));
        this.pendingInputTimeouts.clear();
        this.inputTimeout = undefined;
        callbacks.forEach(callback => callback());
    }

    public copyRichText() {
        this.copyAsRichText = true;
        try {
            document.execCommand("copy");
        } finally {
            this.copyAsRichText = false;
        }
    }

    public selectByShiftClick(protyle: IProtyle, event: MouseEvent, targetBlockElement?: HTMLElement,
                              resolveTargetByPoint = false): boolean {
        const selection = getSelection();
        let startElement: HTMLElement | undefined;
        let endElement = targetBlockElement;
        let shiftClickBlockPoint: IShiftClickBlockPoint | undefined;
        // 锚点始终表示 Shift 选择的起点，向上选择时不能使用按文档顺序排列的 range 起点
        // https://github.com/siyuan-note/siyuan/issues/9334
        if (selection.anchorNode) {
            startElement = hasClosestBlock(selection.anchorNode) as HTMLElement;
        } else if (selection.rangeCount > 0) {
            startElement = hasClosestBlock(selection.getRangeAt(0).startContainer) as HTMLElement;
        }
        if (startElement && (resolveTargetByPoint || !endElement)) {
            shiftClickBlockPoint = getShiftClickBlockByPoint(this.element, startElement,
                event.clientX, event.clientY);
            endElement = shiftClickBlockPoint?.blockElement;
        }
        if (startElement && endElement && startElement !== endElement) {
            const blockRange = getBlockRangeSelectElements(startElement, endElement);
            startElement = blockRange.startElement;
            endElement = blockRange.endElement;
            const selectElements = blockRange.selectElements;
            const toDown = blockRange.toDown;
            if (selectElements.length === 1 && !selectElements[0].classList.contains("list") &&
                !selectElements[0].classList.contains("bq") && !selectElements[0].classList.contains("callout") &&
                !selectElements[0].classList.contains("sb")) {
                // 单个 p 不选中
            } else {
                const ids: string[] = [];
                const hasSelectClassElement = this.element.querySelector(".protyle-wysiwyg--select");
                if (!hasSelectClassElement && protyle.scroll && !protyle.scroll.element.classList.contains("fn__none") &&
                    !protyle.scroll.keepLazyLoad &&
                    (startElement.getBoundingClientRect().top < -protyle.contentElement.clientHeight * 2 ||
                        endElement.getBoundingClientRect().bottom > protyle.contentElement.clientHeight * 2)) {
                    showMessage(window.siyuan.languages.crossKeepLazyLoad);
                }
                selectElements.forEach(item => {
                    if (!hasClosestByClassName(item, "protyle-wysiwyg--select")) {
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
            return true;
        }
        if (!this.element.querySelector(".protyle-wysiwyg--select") && shiftClickBlockPoint &&
            startElement === endElement) {
            return extendSelectionToBlockSide(selection, endElement, shiftClickBlockPoint.toStart);
        }
        return false;
    }

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.className = "protyle-wysiwyg";
        this.element.setAttribute("spellcheck", "false");
        this.element.setAttribute("contenteditable", "true");
        if (window.siyuan.config.editor.displayBookmarkIcon) {
            this.element.classList.add("protyle-wysiwyg--attr");
        }
        if (!isMobile()) {
            this.tableControl = new TableControl(protyle, this.element);
        }
        this.bindCommonEvent(protyle);
        this.bindEvent(protyle);
        if (protyle.options.action.includes(Constants.CB_GET_HISTORY)) {
            return;
        }
        keydown(protyle, this.element);
        dropEvent(protyle, this.element);
    }

    public renderCustom(ial: Record<string, string>) {
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

    private clearAttrContent(element: HTMLElement) {
        const attrElements = element.querySelectorAll(".protyle-attr");
        if (attrElements.length === 0) {
            return;
        }
        attrElements.forEach(item => {
            item.textContent = Constants.ZWSP;
        });
        return element.textContent;
    }

    private normalizeCrossBlockCopy(element: HTMLElement, range: Range) {
        normalizeVirtualBlockRef(element);
        let firstElement = element.firstElementChild as HTMLElement;
        while (firstElement?.getAttribute("data-type") === "NodeListItem") {
            const childBlocks = Array.from(firstElement.children).filter(item =>
                item.hasAttribute("data-node-id")) as HTMLElement[];
            if (childBlocks.length !== 1 || childBlocks[0].getAttribute("data-type") !== "NodeList") {
                break;
            }
            const listItems = Array.from(childBlocks[0].children).filter(item =>
                item.getAttribute("data-type") === "NodeListItem");
            if (listItems.length === 0) {
                break;
            }
            firstElement.replaceWith(...listItems);
            firstElement = element.firstElementChild as HTMLElement;
        }
        element.querySelectorAll<HTMLElement>("[data-node-id]").forEach(item => {
            const sourceElements = this.element.querySelectorAll<HTMLElement>(
                `[data-node-id="${item.getAttribute("data-node-id")}"]`,
            );
            const sourceElement = Array.from(sourceElements).find(source => range.intersectsNode(source)) ||
                sourceElements[0];
            if (!sourceElement) {
                return;
            }
            const prependElements = Array.from(sourceElement.children).filter(sourceChild =>
                (sourceChild.classList.contains("protyle-action") ||
                    sourceChild.classList.contains("callout-info")) &&
                !Array.from(item.children).some(child => child.className === sourceChild.className));
            item.prepend(...prependElements.map(child => child.cloneNode(true)));
            const attrElement = sourceElement.querySelector(":scope > .protyle-attr");
            if (attrElement && !item.querySelector(":scope > .protyle-attr")) {
                item.append(attrElement.cloneNode(true));
            }
        });
        const listItemElements = Array.from(element.children).filter(item =>
            item.getAttribute("data-type") === "NodeListItem") as HTMLElement[];
        const subtype = listItemElements[0]?.getAttribute("data-subtype");
        if (subtype && listItemElements.length > 1 && listItemElements.length === element.childElementCount) {
            listItemElements.forEach(item => {
                if (item.getAttribute("data-subtype") !== subtype) {
                    convertPastedListItemSubtype(item, subtype);
                }
            });
        }
    }

    private async writeSelectionClipboardForCut() {
        const clipboardData = new DataTransfer();
        this.element.dispatchEvent(new ClipboardEvent("copy", {
            bubbles: true,
            cancelable: true,
            clipboardData,
        }));
        const textPlain = clipboardData.getData("text/plain");
        const textHTML = clipboardData.getData("text/html");
        const textSiyuan = clipboardData.getData("text/siyuan");
        if (!textPlain && !textHTML) {
            showMessage(window.siyuan.languages.clipboardPermissionDenied, 7000, "error");
            return false;
        }
        const clipboardItem: Record<string, string> = {};
        if (textPlain) {
            clipboardItem["text/plain"] = textPlain;
        }
        if (textHTML) {
            clipboardItem["text/html"] = textHTML;
        }
        try {
            if (isInAndroid()) {
                if (textSiyuan) {
                    window.JSAndroid.writeSiYuanHTMLClipboard(textPlain, textHTML, textSiyuan);
                } else if (textHTML) {
                    window.JSAndroid.writeHTMLClipboard(textPlain, textHTML);
                } else {
                    window.JSAndroid.writeClipboard(textPlain);
                }
            } else if (isInHarmony()) {
                if (textSiyuan) {
                    window.JSHarmony.writeSiYuanHTMLClipboard(textPlain, textHTML, textSiyuan);
                } else if (textHTML) {
                    window.JSHarmony.writeHTMLClipboard(textPlain, textHTML);
                } else {
                    window.JSHarmony.writeClipboard(textPlain);
                }
            } else if (isInIOS()) {
                window.webkit.messageHandlers.setClipboard.postMessage(textPlain);
            } else if (navigator.clipboard?.write) {
                await navigator.clipboard.write([new ClipboardItem(clipboardItem)]);
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(textPlain || textHTML);
            } else {
                showMessage(window.siyuan.languages.clipboardPermissionDenied, 7000, "error");
                return false;
            }
            return true;
        } catch (error) {
            console.log("Cut write clipboard error:", error);
            showMessage(error instanceof Error ? error.message : String(error), 7000, "error");
            return false;
        }
    }

    private bindCommonEvent(protyle: IProtyle) {
        this.element.addEventListener("copy", async (event: ClipboardEvent & { target: HTMLElement }) => {
            const copyAsRichText = this.copyAsRichText;
            this.copyAsRichText = false;
            window.siyuan.ctrlIsPressed = false; // https://github.com/siyuan-note/siyuan/issues/6373
            if (getAVTemplateInteractiveElement(event.target)) {
                event.stopPropagation();
                return;
            }
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
            const selectAVElement = nodeElement.querySelector(".av__row--select, .av__cell--select") ||
                (getAVSelectedCells(nodeElement).length > 0 ||
                (nodeElement.dataset.avType === "table" && getAVSelectedItemIDs(nodeElement).length > 0) ?
                    nodeElement : null);
            const selectTableElement = nodeElement.querySelector(".table__select")?.clientWidth > 0;
            // 表格内跨多单元格的文本选区：range.cloneContents() 会产出残缺的 td/tr 片段，需要重建合法 table
            let selectTableRange = false;
            let tableRangeElement: HTMLElement = null;
            let tableRangeStartCell: HTMLElement = null;
            let tableRangeEndCell: HTMLElement = null;
            if (!selectTableElement) {
                const startCell = hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH");
                const endCell = hasClosestByTag(range.endContainer, "TD") || hasClosestByTag(range.endContainer, "TH");
                if (startCell && endCell && startCell !== endCell) {
                    const startTable = (startCell as HTMLElement).closest("table");
                    if (startTable && startTable === (endCell as HTMLElement).closest("table")) {
                        selectTableRange = true;
                        tableRangeElement = (startCell as HTMLElement).closest('[data-type="NodeTable"]') as HTMLElement;
                        tableRangeStartCell = startCell as HTMLElement;
                        tableRangeEndCell = endCell as HTMLElement;
                    }
                }
            }
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
                                notebook: protyle.notebookId,
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
                const selectedCells = getAVSelectedCells(nodeElement);
                const selectedCellData = selectedCells.length > 0 ?
                    getAVSelectedCellData(nodeElement) : getAVCellData(getAVSelectedTableCells(nodeElement));
                const cellElements: Element[] = selectedCellData.json.length > 0 ? [] :
                    Array.from(nodeElement.querySelectorAll(".av__cell--active, .av__cell--select"));
                if (selectedCellData.json.length > 0) {
                    html = JSON.stringify(selectedCellData.json);
                    textPlain = selectedCellData.text;
                }
                if (cellElements.length === 0) {
                    nodeElement.querySelectorAll(".av__row--select:not(.av__row--header)").forEach(rowElement => {
                        rowElement.querySelectorAll(".av__cell").forEach(cellElement => {
                            cellElements.push(cellElement);
                        });
                    });
                }
                if (cellElements.length > 0 && selectedCellData.json.length === 0) {
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
                const tableSelectElement = nodeElement.querySelector(".table__select") as HTMLElement;
                const tableElement = nodeElement.querySelector("table");
                // 通过框选几何范围确定 startCell/endCell，复用 getTableRangeHTML 的网格映射逻辑
                //（它会正确保留 thead/tbody、补齐 fn__none 占位、重新计算 colspan/rowspan）
                let startCell: HTMLElement = null;
                let endCell: HTMLElement = null;
                const allCells = Array.from(tableElement.querySelectorAll("th, td")) as HTMLElement[];
                allCells.forEach((item: HTMLTableCellElement) => {
                    if (item.classList.contains("fn__none")) {
                        return;
                    }
                    if (isIncludeCell({tableSelectElement, item})) {
                        if (!startCell) {
                            startCell = item;
                        }
                        endCell = item;
                    }
                });
                if (startCell && endCell) {
                    html = getTableRangeHTML(tableElement, startCell, endCell);
                } else {
                    html = "<table></table>";
                }
                textPlain = protyle.lute.HTML2Md(html);
            } else if (selectTableRange) {
                // 表格内跨多单元格的文本选区：按网格映射重建合法 table，重新计算 colspan/rowspan。
                // 后续统一构建 NodeTable BlockDOM，不经过 markdown 往返（GFM 表格只有单行表头）
                const tableElement = tableRangeElement.querySelector("table");
                html = getTableRangeHTML(tableElement, tableRangeStartCell, tableRangeEndCell);
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
                        const textWithoutAttr = this.clearAttrContent(tempElement);
                        if (textWithoutAttr !== undefined) {
                            textPlain = textWithoutAttr;
                        }
                        // https://github.com/siyuan-note/siyuan/issues/13232
                        headingElement.removeAttribute("fold");
                    } else if (!["DIV", "TD", "TH", "TR"].includes(range.startContainer.parentElement.tagName)) {
                        // 复制行内元素 https://github.com/siyuan-note/insider/issues/191
                        tempElement.append(range.startContainer.parentElement.cloneNode(true));
                        this.emojiToMd(tempElement);
                    } else {
                        // 直接复制块 https://github.com/siyuan-note/insider/issues/318
                        tempElement.append(range.cloneContents());
                        const textWithoutAttr = this.clearAttrContent(tempElement);
                        if (textWithoutAttr !== undefined) {
                            textPlain = textWithoutAttr;
                        }
                        this.emojiToMd(tempElement);
                    }
                    html = tempElement.innerHTML;
                    textPlain = textPlain || range.toString();
                } else if (selectImgElement) {
                    html = selectImgElement.outerHTML;
                    // 和图片菜单中的复制保持一致
                    textPlain = protyle.lute.BlockDOM2StdMd(html).replace(/%20/g, " ");
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
                    const isCrossBlock = nodeElement !== hasClosestBlock(range.endContainer);
                    if (isCrossBlock) {
                        this.normalizeCrossBlockCopy(tempElement, range);
                    }
                    const crossBlockTextPlain = isCrossBlock ? Array.from(tempElement.children)
                        .map(item => getPlainText(item as HTMLElement).trimEnd())
                        .filter(Boolean).join("\n") : undefined;
                    const textWithoutAttr = this.clearAttrContent(tempElement);
                    this.emojiToMd(tempElement);
                    const inlineMathElement = hasClosestByAttribute(range.commonAncestorContainer, "data-type", "inline-math");
                    if (inlineMathElement) {
                        // 表格内复制数学公式 https://ld246.com/article/1631708573504
                        html = inlineMathElement.outerHTML;
                    } else {
                        html = tempElement.innerHTML;
                    }
                    // 不能使用 commonAncestorContainer https://ld246.com/article/1643282894693
                    textPlain = crossBlockTextPlain ?? tempElement.textContent;
                    if (hasClosestByAttribute(range.startContainer, "data-type", "NodeCodeBlock")) {
                        if (isEndOfBlock(range)) {
                            textPlain = textPlain.replace(/\n$/, "");
                        }
                        isInCodeBlock = true;
                    } else if (hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH")) {
                        tempElement.innerHTML = tempElement.innerHTML.replace(/<br>/g, "\n").replace(/<br\/>/g, "\n");
                        textPlain = tempElement.textContent.endsWith("\n") ? tempElement.textContent.replace(/\n$/, "") : tempElement.textContent;
                    } else if (tempElement.querySelector('.img, [data-type~="inline-math"]')) {
                        textPlain = "";
                        tempElement.childNodes.forEach((item: Element) => {
                            if (item.nodeType === 3) {
                                textPlain += item.textContent;
                            } else if (item.nodeType === 1 &&
                                (item.classList.contains("img") || item.getAttribute("data-type").includes("inline-math"))) {
                                if (!item.classList.contains("img")) {
                                    item.setAttribute("data-type", "inline-math");
                                }
                                textPlain += protyle.lute.BlockDOM2StdMd(item.outerHTML).trimEnd();
                            } else {
                                textPlain += item.textContent;
                            }
                        });
                    } else if (!hasClosestByTag(range.startContainer, "CODE")) {
                        textPlain = crossBlockTextPlain ?? textWithoutAttr ?? range.toString();
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
            let clipboardText = textPlain;

            if (!isInCodeBlock) {
                enableLuteMarkdownSyntax(protyle);
                // 表格选区（框选或跨多单元格文本选区）直接构建 BlockDOM，不走 HTML2BlockDOM 的 markdown 往返
                //（GFM 表格只有单行表头，markdown 往返会丢失多行 thead 和单元格 th 属性）
                let textSiyuan: string;
                if (selectTableElement || selectTableRange) {
                    // 表格选区：html 已是合法 <table>...</table>（含 thead/tbody/fn__none 占位），
                    // 构建最小化 NodeTable BlockDOM，不经过 markdown 往返（GFM 表格只有单行表头，往返会丢失多行 thead）
                    const newId = Lute.NewNodeID();
                    textSiyuan = `<div data-node-id="${newId}" data-type="NodeTable" class="table"><div contenteditable="true" spellcheck="false">${html}<div class="protyle-action__table"><div class="table__resize"></div><div class="table__select"></div></div></div><div class="protyle-attr" contenteditable="false">\u200b</div></div>`;
                    html = textSiyuan;
                } else {
                    textSiyuan = html;
                }
                event.clipboardData.setData("text/siyuan", textSiyuan);
                restoreLuteMarkdownSyntax(protyle);
                // 在 text/html 中插入注释节点，用于右键菜单粘贴时获取 text/siyuan 数据
                let exportedHTML = removeZWJ((selectTableElement || selectTableRange) ? html :
                    (copyAsRichText ? protyle.lute.BlockDOM2RichHTML(selectAVElement ? textPlain : html) :
                        protyle.lute.BlockDOM2HTML(selectAVElement ? textPlain : html)));
                if (copyAsRichText) {
                    const prepared = prepareRichClipboardHTML(exportedHTML);
                    exportedHTML = prepared.html;
                    clipboardText = prepared.source;
                }
                const textHTML = `<!--data-siyuan='${encodeBase64(textSiyuan)}'-->` + exportedHTML;
                event.clipboardData.setData("text/plain", clipboardText);
                event.clipboardData.setData("text/html", textHTML);
                if (needClipboardWrite) {
                    try {
                        await navigator.clipboard.write([new ClipboardItem({
                            ["text/plain"]: clipboardText,
                            ["text/html"]: textHTML,
                        })]);
                    } catch (e) {
                        console.log("Copy write clipboard error:", e);
                    }
                }
                enhanceRichClipboard(clipboardText, textHTML, protyle.notebookId);
            } else {
                event.clipboardData.setData("text/plain", clipboardText);
            }
        });

        this.element.addEventListener("mousedown", (event: MouseEvent) => {
            if (protyle.toolbar.isMultiSelectMode()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--hiderange");
            if (event.button === 2) {
                // 右键
                return;
            }
            if (getAVTemplateInteractiveElement(event.target)) {
                event.stopPropagation();
                return;
            }
            const documentSelf = document;
            documentSelf.onmouseup = null;
            let target = event.target as HTMLElement;
            let nodeElement = hasClosestBlock(target) as HTMLElement;
            let clickedTableNode = nodeElement && nodeElement.dataset.type === "NodeTable" ? nodeElement : undefined;
            if (!nodeElement) {
                clickedTableNode = Array.from(this.element.querySelectorAll<HTMLElement>(
                    '[data-type="NodeTable"]')).find(item => {
                    const table = item.querySelector("table");
                    if (!table) {
                        return false;
                    }
                    const tableRect = table.getBoundingClientRect();
                    const nodeRect = item.getBoundingClientRect();
                    return event.clientX > tableRect.right &&
                        event.clientY >= nodeRect.top && event.clientY <= nodeRect.bottom;
                });
            }
            const clickedTableElement = clickedTableNode?.querySelector("table");
            if (clickedTableElement) {
                const tableRect = clickedTableElement.getBoundingClientRect();
                const nodeRect = clickedTableNode.getBoundingClientRect();
                if (event.clientX > tableRect.right &&
                    event.clientY >= nodeRect.top && event.clientY <= nodeRect.bottom) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
            }
            if (hasClosestByClassName(target, "av__selection-toolbar")) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const hasSelectClassElement = this.element.querySelector(".protyle-wysiwyg--select");
            const galleryItemElement = hasClosestByClassName(target, "av__gallery-item");
            const avCellElement = hasClosestByClassName(target, "av__cell") as HTMLElement;
            const wysiwygRect = protyle.wysiwyg.element.getBoundingClientRect();
            const wysiwygStyle = window.getComputedStyle(protyle.wysiwyg.element);
            const mostLeft = wysiwygRect.left + (parseInt(wysiwygStyle.paddingLeft) || 24) + 1;
            const mostRight = wysiwygRect.right - (parseInt(wysiwygStyle.paddingRight) || 16) - 2;
            const startsFromPadding = event.clientX < mostLeft - 1 || event.clientX > mostRight + 2 ||
                event.clientY < wysiwygRect.top + (parseFloat(wysiwygStyle.paddingTop) || 0) ||
                event.clientY > wysiwygRect.bottom - (parseFloat(wysiwygStyle.paddingBottom) || 0);
            const isBottomBacklink = !!protyle.element.closest(".sy__backlink--bottom");
            // 按住 Ctrl/Command 从边缘空白处划选时，以按下时的选区为基线切换块
            // https://github.com/siyuan-note/siyuan/issues/15006
            const isToggleBlockDrag = isOnlyMeta(event) && !event.shiftKey && !event.altKey && startsFromPadding;
            const baseDragSelectElements = new Set(isToggleBlockDrag ?
                Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select")) : []);
            const rangeBeforePaddingMouseDown = startsFromPadding && getSelection().rangeCount > 0 ?
                getSelection().getRangeAt(0).cloneRange() : undefined;
            if (event.shiftKey) {
                if (!isMobile() && !protyle.disabled && nodeElement?.dataset.avType === "table" &&
                    avCellElement?.dataset.id &&
                    selectAVCellRange(nodeElement, avCellElement)) {
                    focusBlock(nodeElement);
                    this.preventClick = true;
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                if (!hasSelectClassElement && galleryItemElement &&
                    selectAVItemRange(nodeElement, galleryItemElement as HTMLElement)) {
                    focusBlock(nodeElement);
                    this.preventClick = true;
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                // 块间空白和文档末尾没有直接对应的块，需沿锚点方向解析终点
                // https://github.com/siyuan-note/siyuan/issues/11960
                const editableElement = nodeElement && getContenteditableElement(nodeElement);
                const editableRect = editableElement?.getBoundingClientRect();
                // 块的 padding 和 margin 可能仍命中内部元素，需根据实际可编辑区域判断是否使用坐标解析
                const resolveTargetByPoint = !nodeElement || target === nodeElement || !editableRect ||
                    event.clientX < editableRect.left || event.clientX > editableRect.right ||
                    event.clientY < editableRect.top || event.clientY > editableRect.bottom;
                if (this.selectByShiftClick(protyle, event, nodeElement, resolveTargetByPoint)) {
                    this.preventClick = true;
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }
            if (isOnlyMeta(event) && !event.shiftKey && !event.altKey && !startsFromPadding) {
                let ctrlElement = nodeElement;
                const rowElement = hasClosestByClassName(target, "av__row");
                if (!hasSelectClassElement && (galleryItemElement || (rowElement && !rowElement.classList.contains("av__row--header")))) {
                    if (galleryItemElement) {
                        const galleryBodyElement = hasClosestByClassName(galleryItemElement, "av__body") as HTMLElement;
                        const galleryRowId = galleryItemElement.getAttribute("data-id");
                        if (galleryBodyElement && galleryRowId) {
                            updateAVRowSelect(galleryBodyElement, galleryRowId,
                                galleryItemElement.classList.toggle("av__gallery-item--select"));
                        }
                        updateHeader(galleryItemElement);
                        setAVItemAnchor(nodeElement, galleryItemElement as HTMLElement);
                    } else if (rowElement) {
                        selectRow(rowElement.querySelector(".av__firstcol"), "toggle");
                        setAVItemAnchor(nodeElement, rowElement as HTMLElement);
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
                    setAVItemAnchor(nodeElement, galleryItemElement as HTMLElement);
                    return false;
                };
                return;
            }
            const avDragFillElement = hasClosestByClassName(target, "av__drag-fill");
            // https://github.com/siyuan-note/siyuan/issues/3026
            if (!isToggleBlockDrag) {
                hideElements(["select"], protyle);
                if (hasClosestByAttribute(target, "data-type", "av-gallery-more")) {
                    clearSelect(["img", "row", "cell"], protyle.wysiwyg.element);
                } else if (!hasClosestByClassName(target, "av__firstcol") && !avDragFillElement) {
                    clearSelect(["img", "av"], protyle.wysiwyg.element);
                }
            }

            if ((hasClosestByClassName(target, "protyle-action") && !hasClosestByClassName(target, "code-block")) ||
                (hasClosestByClassName(target, "av__cell--header") && !hasClosestByClassName(target, "av__widthdrag"))) {
                return;
            }
            const protyleRect = protyle.element.getBoundingClientRect();
            const mostBottom = protyleRect.bottom;
            const y = event.clientY;
            const contentRect = protyle.contentElement.getBoundingClientRect();
            // 超级块横向布局下拖拽调整子块宽度
            if (!protyle.disabled && target.classList.contains("sb__resize")) {
                const sbElement = target.parentElement;
                const previousElement = target.previousElementSibling as HTMLElement;
                // 取手柄右侧的下一个块（跳过手柄等装饰元素）
                let nextElement = target.nextElementSibling as HTMLElement;
                while (nextElement && !nextElement.hasAttribute("data-node-id")) {
                    nextElement = nextElement.nextElementSibling as HTMLElement;
                }
                if (!sbElement || !previousElement || !previousElement.hasAttribute("data-node-id") ||
                    !nextElement || sbElement.getAttribute("data-sb-layout") !== "col") {
                    return;
                }
                hideElements(["gutter"], protyle);
                this.tableControl?.setHidden(true);
                const oldHTMLs = {
                    prev: previousElement.outerHTML,
                    next: nextElement.outerHTML,
                };
                const x = event.clientX;
                const sbWidth = sbElement.clientWidth;
                // 使用 getBoundingClientRect 获取精确浮点宽度，避免 clientWidth（整数取整）作为
                // 拖拽起始值带入累积误差
                const oldLeftWidth = previousElement.getBoundingClientRect().width;
                const oldRightWidth = nextElement.getBoundingClientRect().width;
                // 读取手柄实际占用宽度（width + margin），这才是子块间的真实间距，用于 calc 补偿避免换行
                const handleStyle = getComputedStyle(target);
                const gapPx = target.offsetWidth + parseFloat(handleStyle.marginLeft) + parseFloat(handleStyle.marginRight);
                const minWidth = 20;
                // @ts-ignore
                previousElement.style.webkitUserModify = "read-only";
                // @ts-ignore
                nextElement.style.webkitUserModify = "read-only";
                // 为所有子块创建右上角百分比提示
                const sbChildren = Array.from(sbElement.querySelectorAll(":scope > [data-node-id]")) as HTMLElement[];
                const gapHalve = gapPx / 2 + 1;
                const tips: { el: HTMLElement, child: HTMLElement }[] = [];
                sbChildren.forEach(child => {
                    child.style.position = "relative";
                    const tip = document.createElement("span");
                    tip.className = "sb__resize-tip protyle-icon protyle-icon--first protyle-icon--last";
                    child.appendChild(tip);
                    tips.push({el: tip, child});
                });
                // 份额池：每个子块占 100 的份额（一位小数），总和恒为 100
                // 从子块实测宽度按比例分配，与 calc 百分比无关（calc 含 gap 补偿，坐标系不同）
                // 最大余数法取整确保总和精确 = 100，拖拽中实时更新两侧份额
                const rawPcts = sbChildren.map(child => child.getBoundingClientRect().width);
                const totalWidth = rawPcts.reduce((s, w) => s + w, 0) || 1;
                const scaled = rawPcts.map(w => w / totalWidth * 1000);
                const shares = scaled.map(p => Math.floor(p));
                const deficit = 1000 - shares.reduce((s, p) => s + p, 0);
                const remainders = scaled
                    .map((p, i) => ({i, frac: p - Math.floor(p)}))
                    .sort((a, b) => b.frac - a.frac);
                for (let k = 0; k < deficit && k < remainders.length; k++) {
                    shares[remainders[k].i]++;
                }
                const leftIdx = sbChildren.indexOf(previousElement);
                const rightIdx = sbChildren.indexOf(nextElement);
                const updateTips = () => {
                    tips.forEach(({el}, i) => {
                        el.textContent = `${(shares[i] / 10).toFixed(1)}%`;
                    });
                };
                // 记录最终拖拽宽度，供 mouseup 精确计算百分比，避免从 clientWidth（整数取整）
                // 反推导致每次拖拽累积误差
                let finalLeft = oldLeftWidth;
                let finalRight = oldRightWidth;
                updateTips();
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    // 左右两块等量交换宽度，不影响其他子块
                    const delta = moveEvent.clientX - x;
                    let newLeftWidth = oldLeftWidth + delta;
                    let newRightWidth = oldRightWidth - delta;
                    // 限制最小宽度，避免塌陷
                    if (newLeftWidth < minWidth) {
                        newLeftWidth = minWidth;
                        newRightWidth = oldLeftWidth + oldRightWidth - minWidth;
                    }
                    if (newRightWidth < minWidth) {
                        newRightWidth = minWidth;
                        newLeftWidth = oldLeftWidth + oldRightWidth - minWidth;
                    }
                    finalLeft = newLeftWidth;
                    finalRight = newRightWidth;
                    previousElement.style.width = newLeftWidth + "px";
                    previousElement.style.flex = "none";
                    nextElement.style.width = newRightWidth + "px";
                    nextElement.style.flex = "none";
                    // 更新份额池：左块份额 = 当前宽度 / 子块总宽度 × 1000，右块 = 1000 - 左块 - 其他块份额
                    // 分母用子块宽度之和（不含手柄），与 mousedown 初始化一致
                    const newLeftShare = Math.max(1, Math.round(newLeftWidth / totalWidth * 1000));
                    const othersSum = shares.reduce((s, p, i) => i === leftIdx || i === rightIdx ? s : s + p, 0);
                    shares[leftIdx] = newLeftShare;
                    shares[rightIdx] = Math.max(1, 1000 - othersSum - newLeftShare);
                    updateTips();
                };
                documentSelf.onmouseup = (mouseupEvent) => {
                    tips.forEach(({child, el}) => {
                        el.remove();
                        // 还原 position（若子块原本无 position 则清除）
                        if (!child.getAttribute("style") || child.style.position === "relative") {
                            child.style.position = "";
                        }
                    });
                    // @ts-ignore
                    previousElement.style.webkitUserModify = "";
                    // @ts-ignore
                    nextElement.style.webkitUserModify = "";
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    this.tableControl?.setHidden(false);
                    // 仅点击未拖拽，不产生 transaction，避免无意义的更新
                    if (Math.abs(x - mouseupEvent.clientX) <= 0) {
                        return;
                    }
                    // 只调整左右两块（手柄两侧），其他子块不动，避免影响未拖拽的块
                    // 使用 mousemove 记录的精确实时宽度（finalLeft/finalRight）反推百分比，
                    // gapHalve 已含 +1px 余量防止亚像素换行，无需再用 *99 缩放（会造成累积收缩）
                    let leftPct = Math.round((finalLeft + gapHalve) / sbWidth * 1000) / 10;
                    let rightPct = Math.round((finalRight + gapHalve) / sbWidth * 1000) / 10;
                    // 防溢出：两块百分比之和超过 99.5% 时等比压缩到 99%，留 1% 缓冲防换行
                    const sumPct = leftPct + rightPct;
                    if (sumPct > 99.5) {
                        const scale = 99 / sumPct;
                        leftPct = Math.round(leftPct * scale * 10) / 10;
                        rightPct = Math.round(rightPct * scale * 10) / 10;
                    }
                    const updated = dayjs().format("YYYYMMDDHHmmss");
                    previousElement.style.width = `calc(${leftPct}% - ${gapHalve}px)`;
                    nextElement.style.width = `calc(${rightPct}% - ${gapHalve}px)`;
                    previousElement.setAttribute("updated", updated);
                    nextElement.setAttribute("updated", updated);
                    // 合并为单个 transaction，确保撤销时两侧宽度同时恢复
                    transaction(protyle, [
                        {
                            action: "update",
                            id: previousElement.getAttribute("data-node-id"),
                            data: previousElement.outerHTML
                        },
                        {action: "update", id: nextElement.getAttribute("data-node-id"), data: nextElement.outerHTML},
                    ], [
                        {action: "update", id: previousElement.getAttribute("data-node-id"), data: oldHTMLs.prev},
                        {action: "update", id: nextElement.getAttribute("data-node-id"), data: oldHTMLs.next},
                    ]);
                };
                this.preventClick = true;
                event.preventDefault();
                return;
            }
            // av 冻结范围
            if (!protyle.disabled && target.classList.contains("av__freeze-drag")) {
                if (!nodeElement) {
                    return;
                }
                const bodyElement = hasClosestByClassName(target, "av__body") as HTMLElement;
                const headerElement = hasClosestByClassName(target, "av__row--header") as HTMLElement;
                if (!bodyElement || !headerElement) {
                    return;
                }
                const headerCells = Array.from(headerElement.querySelectorAll<HTMLElement>(".av__cell"));
                const oldFreezeColId = headerElement.querySelector<HTMLElement>('[data-freeze="true"]')?.dataset.colId || "";
                let freezeColId = oldFreezeColId;
                let moved = false;
                const clearPreview = () => {
                    bodyElement.querySelectorAll(".av__freeze-preview").forEach(item => {
                        item.classList.remove("av__freeze-preview");
                    });
                };
                const preview = () => {
                    clearPreview();
                    const selector = freezeColId ? `[data-col-id="${freezeColId}"]` : ".av__firstcol";
                    bodyElement.querySelectorAll(selector).forEach(item => {
                        item.classList.add("av__freeze-preview");
                    });
                };
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    const moveTarget = moveEvent.target as HTMLElement;
                    const firstColElement = hasClosestByClassName(moveTarget, "av__firstcol");
                    const cellElement = hasClosestByClassName(moveTarget, "av__cell") as HTMLElement;
                    if (firstColElement && bodyElement.contains(firstColElement)) {
                        freezeColId = "";
                    } else if (cellElement && bodyElement.contains(cellElement)) {
                        const cellIndex = headerCells.findIndex(item => item.dataset.colId === cellElement.dataset.colId);
                        if (cellIndex > -1) {
                            const cellRect = cellElement.getBoundingClientRect();
                            freezeColId = moveEvent.clientX < cellRect.left + cellRect.width / 2
                                ? (headerCells[cellIndex - 1]?.dataset.colId || "")
                                : headerCells[cellIndex].dataset.colId;
                        }
                    } else if (headerCells.length > 0 &&
                        moveEvent.clientX < headerCells[0].getBoundingClientRect().left) {
                        freezeColId = "";
                    }
                    moved = true;
                    preview();
                };
                documentSelf.onmouseup = () => {
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    clearPreview();
                    if (moved && freezeColId !== oldFreezeColId) {
                        setFreezeColumn(protyle, nodeElement, freezeColId);
                    }
                };
                documentSelf.ondragstart = () => false;
                documentSelf.onselectstart = () => false;
                documentSelf.onselect = () => false;
                this.preventClick = true;
                event.preventDefault();
                return;
            }
            // av col resize
            if (!protyle.disabled && target.classList.contains("av__widthdrag")) {
                if (!nodeElement) {
                    return;
                }
                const avId = nodeElement.getAttribute("data-av-id");
                const blockID = nodeElement.dataset.nodeId;
                const dragElement = target.parentElement as HTMLElement;
                const dragRect = dragElement.getBoundingClientRect();
                const oldWidth = Math.round(parseFloat(dragElement.style.width) || dragRect.width);
                const dragColId = dragElement.getAttribute("data-col-id");
                const bodyElement = hasClosestByClassName(target, "av__body") as HTMLElement;
                const headerElement = hasClosestByClassName(target, "av__row--header") as HTMLElement;
                const scrollElement = nodeElement.querySelector(".av__scroll");
                if (!dragColId || !bodyElement || !headerElement || !scrollElement) {
                    return;
                }
                const headerCells = Array.from(headerElement.querySelectorAll<HTMLElement>(".av__cell--header"));
                const dragIndex = headerCells.indexOf(dragElement);
                const previousElement = dragIndex > 0 ? headerCells[dragIndex - 1] : undefined;
                const previousWidth = previousElement ?
                    Math.round(parseFloat(previousElement.style.width) || previousElement.getBoundingClientRect().width) :
                    undefined;
                const columnElements: HTMLElement[] = [];
                scrollElement.querySelectorAll(".av__row, .av__row--footer").forEach(item => {
                    const columnElement = item.querySelector<HTMLElement>(`[data-col-id="${dragColId}"]`);
                    if (columnElement) {
                        columnElements.push(columnElement);
                    }
                });
                const initialDragRight = dragRect.right;
                const widthScale = dragRect.width / oldWidth || 1;
                const snapGuideThreshold = 16;
                const snapGuideRight = previousWidth === undefined ? undefined :
                    initialDragRight + (previousWidth - oldWidth) * widthScale;
                const headerRect = headerElement.getBoundingClientRect();
                const headerTop = headerRect.top;
                const guideHeight = Math.round(headerRect.height);
                let newWidth = oldWidth;
                let resizeSnapped = false;
                let resizeGuide: HTMLElement;
                let resizeTip: HTMLElement;
                let pendingResize: { width: number, snapped: boolean } | undefined;
                let resizeAnimationFrame: number | undefined;
                target.classList.add("av__widthdrag--active");
                const clearResizePreview = () => {
                    target.classList.remove("av__widthdrag--active");
                    resizeGuide?.remove();
                    resizeTip?.remove();
                };
                const updateResizePreview = (snapped: boolean) => {
                    if (!resizeTip) {
                        if (snapGuideRight !== undefined) {
                            resizeGuide = document.createElement("div");
                            resizeGuide.className = "av__width-guide";
                            resizeGuide.style.left = `${snapGuideRight}px`;
                            resizeGuide.style.top = `${Math.round(headerTop)}px`;
                            resizeGuide.style.height = `${guideHeight}px`;
                            document.body.appendChild(resizeGuide);
                        }
                        resizeTip = document.createElement("div");
                        resizeTip.className = "av__width-tip";
                        document.body.appendChild(resizeTip);
                    }
                    const showSnapGuide = !snapped && typeof previousWidth === "number" &&
                        Math.abs(newWidth - previousWidth) <= snapGuideThreshold;
                    resizeGuide?.classList.toggle("fn__none", !showSnapGuide);
                    const dragRight = initialDragRight + (newWidth - oldWidth) * widthScale;
                    resizeTip.style.left = `${dragRight}px`;
                    resizeTip.style.top = `${Math.round(headerTop)}px`;
                    resizeTip.textContent = `${newWidth}px${snapped ?
                        window.siyuan.languages.sameWidthAsLeftColumnTip : ""}`;
                };
                updateResizePreview(resizeSnapped);
                const flushResize = () => {
                    if (!pendingResize) {
                        return;
                    }
                    const currentResize = pendingResize;
                    pendingResize = undefined;
                    if (newWidth === currentResize.width && resizeSnapped === currentResize.snapped) {
                        return;
                    }
                    newWidth = currentResize.width;
                    resizeSnapped = currentResize.snapped;
                    columnElements.forEach(columnElement => {
                        columnElement.style.width = newWidth + "px";
                    });
                    updateResizePreview(resizeSnapped);
                };
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    pendingResize = getAVColumnResizeWidth(
                        oldWidth + (moveEvent.clientX - event.clientX),
                        previousWidth,
                    );
                    if (resizeAnimationFrame === undefined) {
                        resizeAnimationFrame = requestAnimationFrame(() => {
                            resizeAnimationFrame = undefined;
                            flushResize();
                        });
                    }
                };

                documentSelf.onmouseup = () => {
                    if (resizeAnimationFrame !== undefined) {
                        cancelAnimationFrame(resizeAnimationFrame);
                        resizeAnimationFrame = undefined;
                    }
                    flushResize();
                    clearResizePreview();
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    if (!newWidth || newWidth === oldWidth) {
                        return;
                    }
                    stickyRow(nodeElement, protyle.contentElement, "bottom");
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
                documentSelf.ondragstart = () => false;
                documentSelf.onselectstart = () => false;
                documentSelf.onselect = () => false;
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
                const stableOriginCells = getAVSelectedCells(nodeElement);
                if (stableOriginCells.length > 0) {
                    stableOriginCells.forEach(item => {
                        if (!originData[item.rowID]) {
                            originData[item.rowID] = [];
                        }
                        originData[item.rowID].push(item.cell.value);
                        originCellIds.push(item.cell.id);
                    });
                    lastOriginCellElement = avDragFillElement.parentElement;
                } else {
                    bodyElement.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
                        const rowElement = hasClosestByClassName(item, "av__row");
                        if (rowElement) {
                            if (!originData[rowElement.dataset.id]) {
                                originData[rowElement.dataset.id] = [];
                            }
                            originData[rowElement.dataset.id].push(
                                genCellValueByElement(getTypeByCellElement(item), item));
                            lastOriginCellElement = item;
                            originCellIds.push(item.dataset.id);
                        }
                    });
                }
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
                        let hasFillTarget = false;
                        bodyElement.querySelectorAll(".av__row").forEach((rowElement: HTMLElement, index: number) => {
                            if ((newIndex.rowIndex < firstCellIndex.rowIndex && index >= newIndex.rowIndex && index < firstCellIndex.rowIndex) ||
                                (newIndex.rowIndex > dragFillCellIndex.rowIndex && index <= newIndex.rowIndex && index > dragFillCellIndex.rowIndex)) {
                                rowElement.querySelectorAll(".av__cell").forEach((cellElement: HTMLElement, cellIndex: number) => {
                                    if (cellIndex >= firstCellIndex.celIndex && cellIndex <= newIndex.celIndex) {
                                        cellElement.classList.add("av__cell--active");
                                        hasFillTarget = true;
                                    }
                                });
                            }
                        });
                        lastCellElement = hasFillTarget ? moveAVCellElement : undefined;
                    }
                };

                documentSelf.onmouseup = () => {
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    if (lastCellElement) {
                        selectAVCellRange(nodeElement, lastCellElement);
                        dragFillCellsValue(protyle, nodeElement, originData, originCellIds, lastOriginCellElement);
                        addDragFill(lastCellElement);
                    }
                    return false;
                };
                this.preventClick = true;
                return false;
            }
            // av cell select
            if (!protyle.disabled && avCellElement && avCellElement.dataset.id && !isInEmbedBlock(avCellElement)) {
                if (!nodeElement || nodeElement.dataset.avType !== "table") {
                    return;
                }
                if (!setAVCellAnchor(nodeElement, avCellElement)) {
                    return;
                }
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
                        selectAVCellRange(nodeElement, tempCellElement);
                        lastCellElement = tempCellElement;
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
                        focusBlock(nodeElement);
                        updateTransaction(protyle, nodeElement, html);
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
                        const cellElement = hasClosestByTag(target, "TH") || hasClosestByTag(target, "TD");
                        if (cellElement) {
                            target = cellElement;
                        }
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
                protyle.wysiwyg.element.classList.add("protyle-wysiwyg--hiderange");
                this.tableControl?.setHidden(true);
                target.removeAttribute("style");
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
                    protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--hiderange");
                    this.tableControl?.setHidden(false);
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    if (nodeElement) {
                        updateTransaction(protyle, nodeElement, html);
                    }
                };
                return;
            }

            // 编辑器底部反链仅用于浏览和编辑，不参与块、数据库或表格框选
            if (isBottomBacklink && (startsFromPadding || tableBlockElement)) {
                return;
            }

            // 内容区域使用浏览器原生选区，跨块选择时保留各行内元素自身的选中样式。
            if (!startsFromPadding && !tableBlockElement) {
                documentSelf.onmouseup = (mouseUpEvent) => {
                    documentSelf.onmouseup = null;
                    if (this.element.contains(mouseUpEvent.target as Node)) {
                        return;
                    }
                    setTimeout(() => {
                        if (getSelection().rangeCount > 0) {
                            const range = getSelection().getRangeAt(0);
                            if (range.toString().replace(Constants.ZWSP, "") !== "") {
                                protyle.toolbar.render(protyle, range, {
                                    x: mouseUpEvent.clientX,
                                    y: mouseUpEvent.clientY,
                                    detail: mouseUpEvent.detail,
                                });
                                countSelectWord(range, protyle.block.rootID);
                            }
                        }
                    });
                };
                return;
            }
            if (startsFromPadding) {
                protyle.wysiwyg.element.classList.add("protyle-wysiwyg--hiderange");
            }

            // 多选节点
            const lastBlockRect = protyle.wysiwyg.element.lastElementChild.getBoundingClientRect();
            // 起点落在 padding 时，需用内容区内的坐标定位起始块
            if (startsFromPadding) {
                const startX = event.clientX > mostRight ? mostRight - 10 :
                    (event.clientX < mostLeft ? mostLeft + 10 : event.clientX);
                // wysiwyg padding 较大（如打字机模式）时，需沿 y 轴循环探测直到命中块
                nodeElement = hasClosestBlock(document.elementFromPoint(startX, event.clientY)) as HTMLElement;
                if (!nodeElement) {
                    let probeY = event.clientY;
                    const probeStep = event.clientY > lastBlockRect.bottom ? -8 : 8;
                    const probeLimit = probeStep > 0 ? lastBlockRect.bottom : wysiwygRect.top;
                    while (!nodeElement && (probeStep > 0 ? probeY < probeLimit : probeY > probeLimit)) {
                        probeY += probeStep;
                        const probeElement = document.elementFromPoint(startX, probeY);
                        if (probeElement && !probeElement.classList.contains("protyle-wysiwyg")) {
                            nodeElement = hasClosestBlock(probeElement) as HTMLElement;
                        }
                    }
                }
            }
            if (!nodeElement) {
                const breadElement = hasClosestByClassName(target, "protyle-breadcrumb__item");
                if (breadElement) {
                    nodeElement = breadElement.nextElementSibling as HTMLElement;
                }
            }
            const mostTop = protyleRect.top + (protyle.options.render.breadcrumb ? protyle.breadcrumb.element.parentElement.clientHeight : 0);
            const selectStartScrollTop = protyle.contentElement.scrollTop;
            let avDragSelectElement = !isToggleBlockDrag && startsFromPadding && nodeElement && !isInEmbedBlock(nodeElement) &&
            isAVDragSelectSupported(nodeElement) ? nodeElement : undefined;
            let avDragSelectRange: { top: number, bottom: number } | undefined;
            if (avDragSelectElement) {
                const rect = avDragSelectElement.getBoundingClientRect();
                avDragSelectRange = {
                    top: rect.top + selectStartScrollTop,
                    bottom: rect.bottom + selectStartScrollTop,
                };
                const selectStartY = y + selectStartScrollTop;
                if (selectStartY < avDragSelectRange.top || selectStartY > avDragSelectRange.bottom) {
                    avDragSelectElement = undefined;
                    avDragSelectRange = undefined;
                }
            }
            let moveCellElement: HTMLElement;
            let hasLeftTableBlock = false;
            let avDragSelectMode: "items" | "blocks" | undefined;
            let avDragSelectFrame: number | undefined;
            let pendingAVDragSelectRect: DOMRect | undefined;
            let hasInitializedAVDragSelect = false;
            // 仅同步发生变化的块，避免划选过程中重复触发选中样式
            const syncDragSelectBlocks = (elements: Element[]) => {
                let nextElements = new Set(elements.filter(item =>
                    !hasClosestByClassName(item, "protyle-wysiwyg__embed")));
                if (isToggleBlockDrag) {
                    const rawRangeElements = Array.from(nextElements);
                    const rangeElements = rawRangeElements.filter(item =>
                        !rawRangeElements.some(otherItem => otherItem !== item && otherItem.contains(item)));
                    nextElements = new Set(baseDragSelectElements);
                    rangeElements.forEach(item => {
                        if (baseDragSelectElements.has(item)) {
                            nextElements.delete(item);
                            return;
                        }
                        nextElements.forEach(selectedItem => {
                            if (selectedItem.contains(item) || item.contains(selectedItem)) {
                                nextElements.delete(selectedItem);
                            }
                        });
                        nextElements.add(item);
                    });
                }
                protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                    if (nextElements.delete(item)) {
                        return;
                    }
                    item.classList.remove("protyle-wysiwyg--select");
                    item.removeAttribute("select-start");
                    item.removeAttribute("select-end");
                });
                nextElements.forEach(item => item.classList.add("protyle-wysiwyg--select"));
            };
            const clearDragSelectBlocks = () => syncDragSelectBlocks([]);
            let hasInitializedToggleBlockDrag = false;
            const initializeToggleBlockDrag = () => {
                if (!isToggleBlockDrag || hasInitializedToggleBlockDrag) {
                    return;
                }
                clearSelect(["img", "av"], protyle.wysiwyg.element);
                hasInitializedToggleBlockDrag = true;
            };
            const initializeAVDragSelect = () => {
                if (!avDragSelectElement || hasInitializedAVDragSelect) {
                    return;
                }
                clearDragSelectBlocks();
                hasInitializedAVDragSelect = true;
            };
            const cancelAVDragSelect = () => {
                if (avDragSelectFrame !== undefined) {
                    cancelAnimationFrame(avDragSelectFrame);
                    avDragSelectFrame = undefined;
                }
                pendingAVDragSelectRect = undefined;
            };
            const flushAVDragSelect = () => {
                if (avDragSelectFrame !== undefined) {
                    cancelAnimationFrame(avDragSelectFrame);
                    avDragSelectFrame = undefined;
                }
                if (pendingAVDragSelectRect && avDragSelectElement && avDragSelectMode === "items") {
                    applyAVDragSelection(avDragSelectElement, pendingAVDragSelectRect);
                }
                pendingAVDragSelectRect = undefined;
            };
            const scheduleAVDragSelect = (selectRect: DOMRect) => {
                pendingAVDragSelectRect = selectRect;
                if (avDragSelectFrame !== undefined) {
                    return;
                }
                avDragSelectFrame = requestAnimationFrame(() => {
                    avDragSelectFrame = undefined;
                    if (pendingAVDragSelectRect && avDragSelectElement && avDragSelectMode === "items") {
                        applyAVDragSelection(avDragSelectElement, pendingAVDragSelectRect);
                    }
                    pendingAVDragSelectRect = undefined;
                });
            };
            this.element.classList.add("fn__pointer-none");
            hideElements(["gutter"], protyle);
            // 容器类元素判断（划选时 elementFromPoint 命中它们的边缘/空白需继续探测子块）
            const isContainer = (el: Element) => el.classList.contains("protyle-wysiwyg") || el.classList.contains("list") ||
                el.classList.contains("li") || el.classList.contains("sb") || el.classList.contains("callout") ||
                el.classList.contains("callout-content") || el.classList.contains("bq");
            const getDragSelectBlock = (element: Element) => getBlockDragSelectBlock(element,
                protyle.wysiwyg.element, (item) => hasClosestBlock(item), isContainerBlock,
                (item) => item.getAttribute("data-type") === "NodeListItem");
            const getFirstDragSelectBlock = () => {
                const firstTopBlock = Array.from(protyle.wysiwyg.element.children).find(item =>
                    item.getAttribute("data-type")?.startsWith("Node"));
                return firstTopBlock ? getDragSelectBlock(getFirstBlock(firstTopBlock)) : false;
            };
            let lastMoveEvent: MouseEvent;
            const selectScrollEvent = () => lastMoveEvent && documentSelf.onmousemove?.(lastMoveEvent);
            if (startsFromPadding) {
                protyle.contentElement.addEventListener("scroll", selectScrollEvent);
            }
            documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                lastMoveEvent = moveEvent;
                let moveTarget: boolean | HTMLElement = moveEvent.target as HTMLElement;
                // table cell select
                if (tableBlockElement &&
                    !hasClosestByClassName(tableBlockElement, "protyle-wysiwyg__embed")) {
                    this.tableControl?.setHidden(true);
                    const tableControlElement = hasClosestByClassName(moveTarget, "protyle-table-control");
                    if (tableControlElement) {
                        moveTarget = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement;
                    }
                    if (tableBlockElement.contains(moveTarget)) {
                        if (hasLeftTableBlock) {
                            clearDragSelectBlocks();
                            protyle.selectElement.classList.add("fn__none");
                            protyle.selectElement.removeAttribute("style");
                            hasLeftTableBlock = false;
                        }
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
                            const tableElement = tableBlockElement.querySelector("table");
                            const tableRect = tableElement.getBoundingClientRect();
                            const rowRects = Array.from(tableElement.rows).map(row => row.getBoundingClientRect());
                            const gridRect = {
                                left: Math.min(...rowRects.map(rect => rect.left)) - tableRect.left,
                                top: Math.min(...rowRects.map(rect => rect.top)) - tableRect.top,
                                right: Math.max(...rowRects.map(rect => rect.right)) - tableRect.left,
                                bottom: Math.max(...rowRects.map(rect => rect.bottom)) - tableRect.top,
                            };
                            const getCellRect = (cell: HTMLElement) => {
                                const rect = cell.getBoundingClientRect();
                                return {
                                    left: rect.left - tableRect.left,
                                    top: rect.top - tableRect.top,
                                    right: rect.right - tableRect.left,
                                    bottom: rect.bottom - tableRect.top,
                                };
                            };
                            let selectionRects: ReturnType<typeof getCellRect>[] = [];
                            let logicalSelection = false;
                            if (target.tagName === "TH" || target.tagName === "TD") {
                                const grid = buildTableGrid(tableElement);
                                const targetInfo = grid.cellInfos.find(item => item.cell === target);
                                const moveTargetInfo = grid.cellInfos.find(item => item.cell === moveTarget);
                                const selectedInfos = getTableCellsInRectangle(grid.cellInfos, targetInfo, moveTargetInfo);
                                if (selectedInfos.length > 0) {
                                    selectionRects = selectedInfos.map(item => getCellRect(item.cell));
                                    logicalSelection = true;
                                }
                            }
                            if (!logicalSelection) {
                                const targetRect = getCellRect(target);
                                const moveTargetRect = getCellRect(moveTarget);
                                let left = Math.min(targetRect.left, moveTargetRect.left);
                                let top = Math.min(targetRect.top, moveTargetRect.top);
                                let right = Math.max(targetRect.right, moveTargetRect.right);
                                let bottom = Math.max(targetRect.bottom, moveTargetRect.bottom);
                                if (targetRect.left === moveTargetRect.left) {
                                    right = left + Math.max(targetRect.right - targetRect.left,
                                        moveTargetRect.right - moveTargetRect.left);
                                }
                                if (targetRect.top === moveTargetRect.top) {
                                    bottom = top + Math.max(targetRect.bottom - targetRect.top,
                                        moveTargetRect.bottom - moveTargetRect.top);
                                }
                                // https://github.com/siyuan-note/insider/issues/1015
                                Array.from(tableBlockElement.querySelectorAll("th, td")).find((item: HTMLElement) => {
                                    const itemRect = getCellRect(item);
                                    const updateRight = itemRect.left < right && itemRect.right > right;
                                    const updateLeft = itemRect.left < left && itemRect.right > left;
                                    if (itemRect.top < top && itemRect.bottom > top) {
                                        if ((itemRect.left + 6 > left && itemRect.right - 6 < right) || updateRight || updateLeft) {
                                            top = itemRect.top;
                                        }
                                        if (updateRight) {
                                            right = itemRect.right;
                                        }
                                        if (updateLeft) {
                                            left = itemRect.left;
                                        }
                                    } else if (itemRect.top < bottom && itemRect.bottom > bottom) {
                                        if ((itemRect.left + 6 > left && itemRect.right - 6 < right) || updateRight || updateLeft) {
                                            bottom = itemRect.bottom;
                                        }
                                        if (updateRight) {
                                            right = itemRect.right;
                                        }
                                        if (updateLeft) {
                                            left = itemRect.left;
                                        }
                                    } else if (updateLeft && itemRect.top + 6 > top && itemRect.bottom - 6 < bottom) {
                                        left = itemRect.left;
                                    } else if (updateRight && itemRect.top + 6 > top && itemRect.bottom - 6 < bottom) {
                                        right = itemRect.right;
                                    }
                                });
                                selectionRects = [{left, top, right, bottom}];
                            }
                            const left = Math.min(...selectionRects.map(rect => rect.left));
                            const top = Math.min(...selectionRects.map(rect => rect.top));
                            const right = Math.max(...selectionRects.map(rect => rect.right));
                            const bottom = Math.max(...selectionRects.map(rect => rect.bottom));
                            protyle.wysiwyg.element.classList.add("protyle-wysiwyg--hiderange");
                            const scrollElement = tableBlockElement.firstElementChild as HTMLElement;
                            const tableSelectElement = tableBlockElement.querySelector(".table__select") as HTMLElement;
                            const actionRect = tableSelectElement.parentElement.getBoundingClientRect();
                            const scrollRect = scrollElement.getBoundingClientRect();
                            const selectionRect = {
                                left: tableRect.left + left,
                                top: tableRect.top + top,
                                right: tableRect.left + right,
                                bottom: tableRect.top + bottom,
                            };
                            const visibleRect = {
                                left: Math.max(selectionRect.left, tableRect.left, scrollRect.left, contentRect.left),
                                top: Math.max(selectionRect.top, tableRect.top, scrollRect.top, contentRect.top),
                                right: Math.min(selectionRect.right, tableRect.right, scrollRect.right, contentRect.right),
                                bottom: Math.min(selectionRect.bottom, tableRect.bottom, scrollRect.bottom, contentRect.bottom),
                            };
                            const radius = "var(--b3-border-radius-s)";
                            const touches = (edge: number, gridEdge: number) => Math.abs(edge - gridEdge) < 1;
                            const touchesTop = touches(top, gridRect.top) && touches(visibleRect.top, selectionRect.top);
                            const touchesRight = touches(right, gridRect.right) && touches(visibleRect.right, selectionRect.right);
                            const touchesBottom = touches(bottom, gridRect.bottom) && touches(visibleRect.bottom, selectionRect.bottom);
                            const touchesLeft = touches(left, gridRect.left) && touches(visibleRect.left, selectionRect.left);
                            const borderRadius = [
                                touchesTop && touchesLeft ? radius : 0,
                                touchesTop && touchesRight ? radius : 0,
                                touchesBottom && touchesRight ? radius : 0,
                                touchesBottom && touchesLeft ? radius : 0,
                            ].join(" ");
                            tableSelectElement.setAttribute("style", `left:${visibleRect.left - actionRect.left}px;top:${visibleRect.top - actionRect.top}px;height:${Math.max(0, visibleRect.bottom - visibleRect.top)}px;width:${Math.max(0, visibleRect.right - visibleRect.left)}px;border-radius:${borderRadius};`);
                            moveCellElement = moveTarget;
                        }
                        return;
                    } else {
                        hasLeftTableBlock = true;
                        tableBlockElement.querySelector(".table__select").removeAttribute("style");
                        moveCellElement = undefined;
                    }
                }
                const scrollTop = protyle.contentElement.scrollTop;
                const startY = y + selectStartScrollTop;
                const wysiwygMoveRect = protyle.wysiwyg.element.getBoundingClientRect();
                const moveY = clampBlockDragSelectY(moveEvent.clientY, mostTop, mostBottom,
                    wysiwygMoveRect.top, wysiwygMoveRect.bottom) + scrollTop;
                const isAVItemMode = avDragSelectRange &&
                    Math.min(startY, moveY) >= avDragSelectRange.top &&
                    Math.max(startY, moveY) <= avDragSelectRange.bottom;
                // 在包含 img， video， audio 的元素上划选后无法上下滚动 https://ld246.com/article/1681778773806
                // 在包含 img， video， audio 的元素上拖拽无法划选 https://github.com/siyuan-note/siyuan/issues/11763
                if (startsFromPadding) {
                    if (!isAVItemMode) {
                        dragOverScroll(moveEvent, contentRect, protyle.contentElement);
                    } else if (avDragSelectMode === "blocks") {
                        stopScrollAnimation();
                    }
                } else if ((moveEvent.target as HTMLElement).closest("img, video, audio, .img") &&
                    (moveEvent.clientY < contentRect.top + Constants.SIZE_SCROLL_TB ||
                        moveEvent.clientY > contentRect.bottom - Constants.SIZE_SCROLL_TB)) {
                    protyle.contentElement.scroll({
                        top: protyle.contentElement.scrollTop + (moveEvent.clientY < contentRect.top + Constants.SIZE_SCROLL_TB ? -Constants.SIZE_SCROLL_STEP : Constants.SIZE_SCROLL_STEP),
                        behavior: "smooth"
                    });
                }
                if (!nodeElement) {
                    return;
                }
                // 向左选择，遇到 gutter 就不会弹出 toolbar
                hideElements(["gutter"], protyle);
                const selectLeft = Math.max(Math.min(event.clientX, moveEvent.clientX), wysiwygRect.left);
                const selectRight = Math.min(Math.max(event.clientX, moveEvent.clientX), wysiwygRect.right);
                const selectTop = Math.min(startY, moveY) - scrollTop;
                const selectHeight = Math.abs(moveY - startY);
                if (selectHeight < 4) {
                    cancelAVDragSelect();
                    if (avDragSelectElement) {
                        clearAVDragSelection(avDragSelectElement);
                    }
                    avDragSelectMode = undefined;
                    clearDragSelectBlocks();
                    protyle.selectElement.classList.add("fn__none");
                    protyle.selectElement.removeAttribute("style");
                    return;
                }
                initializeToggleBlockDrag();
                initializeAVDragSelect();
                protyle.selectElement.classList.remove("fn__none");
                protyle.selectElement.setAttribute("style", `top:${selectTop - protyleRect.top}px;height:${selectHeight}px;left:${selectLeft - protyleRect.left}px;width:${selectRight - selectLeft}px;`);
                const selectRect = protyle.selectElement.getBoundingClientRect();
                if (isAVItemMode && avDragSelectElement) {
                    clearDragSelectBlocks();
                    avDragSelectMode = "items";
                    scheduleAVDragSelect(selectRect);
                    return;
                }
                cancelAVDragSelect();
                if (avDragSelectElement && avDragSelectMode === "items") {
                    clearAVDragSelection(avDragSelectElement);
                }
                avDragSelectMode = "blocks";
                // 从侧边开始划选时，使用矩形靠近内容的一侧动态命中块，使选区进入子块区域后可从父块切换为子块
                const detectX = getBlockDragSelectProbeX(event.clientX, selectRect, mostLeft, mostRight);
                let firstElement: Element | false;
                const isDown = moveY > startY;
                if (startsFromPadding) {
                    firstElement = resolveBlockDragSelectStart({
                        x: detectX,
                        top: selectRect.top,
                        bottom: selectRect.bottom,
                        elementFromPoint: (pointX, pointY) => document.elementFromPoint(pointX, pointY),
                        getBlock: getDragSelectBlock,
                        isContainerSurface: isContainer,
                        fallbackBlock: isDown ? nodeElement : getFirstDragSelectBlock(),
                    });
                } else if (isDown) {
                    firstElement = nodeElement;
                } else {
                    firstElement = document.elementFromPoint(detectX, selectRect.top);
                }
                if (!firstElement) {
                    clearDragSelectBlocks();
                    return;
                }
                // 向上划选且落点在 padding/缝隙时，elementFromPoint 易命中 wysiwyg 容器或容器类元素，
                // 需沿 y 轴循环向下探测以定位到实际块，避免回退到文档首块导致误选上部所有块
                if (!startsFromPadding && !isDown && isContainer(firstElement)) {
                    let probeY = selectRect.top;
                    while (probeY < selectRect.bottom) {
                        probeY += 8;
                        const probeElement = document.elementFromPoint(detectX, probeY);
                        // 命中非容器元素或容器块（list/sb 等 hasClosestBlock 可识别）即采用
                        if (probeElement && (!isContainer(probeElement) || hasClosestBlock(probeElement))) {
                            firstElement = probeElement;
                            break;
                        }
                    }
                }
                if (!firstElement) {
                    clearDragSelectBlocks();
                    return;
                }
                let firstBlockElement = hasClosestBlock(firstElement);
                if (!firstBlockElement && firstElement.classList.contains("protyle-breadcrumb__bar")) {
                    firstBlockElement = firstElement.nextElementSibling as HTMLElement;
                }
                if (!isDown && !firstBlockElement &&
                    // https://github.com/siyuan-note/siyuan/issues/7580
                    moveEvent.clientY < lastBlockRect.bottom) {
                    firstBlockElement = protyle.wysiwyg.element.firstElementChild as HTMLElement;
                    if (firstBlockElement.classList.contains("protyle-breadcrumb__bar")) {
                        firstBlockElement = firstBlockElement.nextElementSibling as HTMLElement;
                    }
                }
                let selectElements: Element[] = [];
                let currentElement: Element | false = firstBlockElement;
                const isContainerBoundaryReached = (element: Element) => {
                    if (!["li", "sb", "callout", "bq"].some(className => element.classList.contains(className))) {
                        return false;
                    }
                    const contentElement = element.classList.contains("callout") ?
                        element.querySelector(":scope > .callout-content") : element;
                    const childElements = contentElement ? Array.from(contentElement.children).filter(item =>
                        item.hasAttribute("data-node-id")) : [];
                    const firstChildElement = childElements[0];
                    const lastChildElement = childElements[childElements.length - 1];
                    if (!firstChildElement || !lastChildElement) {
                        return false;
                    }
                    const containerRect = element.getBoundingClientRect();
                    return isBlockDragSelectTopReached(selectRect.top, containerRect.top,
                        firstChildElement.getBoundingClientRect().top) ||
                        isBlockDragSelectBottomReached(selectRect.bottom, containerRect.bottom,
                            lastChildElement.getBoundingClientRect().bottom);
                };

                if (currentElement) {
                    // 从下往上划选遇到嵌入块时，选中整个嵌入块
                    const embedElement = isInEmbedBlock(currentElement);
                    if (embedElement) {
                        currentElement = embedElement;
                    }
                }

                let hasJump = false;
                while (currentElement) {
                    if (currentElement.classList.contains("protyle-attr")) {
                        currentElement = hasClosestBlock(currentElement.parentElement);
                        hasJump = true;
                        continue;
                    }
                    const currentRect = currentElement.getBoundingClientRect();
                    const currentInRange = currentRect.height > 0 && currentRect.top < selectRect.bottom &&
                        currentRect.bottom > selectRect.top && currentRect.left < selectRect.right &&
                        currentRect.right > selectRect.left;
                    if (!currentInRange) {
                        if (currentElement.parentElement.classList.contains("sb")) {
                            // 跳出超级块横向排版中的未选中元素
                            currentElement = hasClosestBlock(currentElement.parentElement);
                            hasJump = true;
                            continue;
                        }
                        if (currentRect.height === 0 && currentRect.width === 0 &&
                            currentElement.parentElement.getAttribute("fold") === "1") {
                            currentElement = currentElement.parentElement;
                            selectElements = [];
                            continue;
                        }
                        break;
                    }
                    if (hasJump) {
                        if (isContainerBoundaryReached(currentElement)) {
                            selectElements = [currentElement];
                        }
                        const nextElement = currentElement.nextElementSibling;
                        if (!nextElement || nextElement.classList.contains("protyle-attr")) {
                            currentElement = hasClosestBlock(currentElement.parentElement);
                            continue;
                        }
                        const nextRect = nextElement.getBoundingClientRect();
                        const nextInRange = nextRect.top < selectRect.bottom && nextRect.bottom > selectRect.top &&
                            nextRect.left < selectRect.right && nextRect.right > selectRect.left;
                        if (nextInRange) {
                            selectElements = [currentElement];
                            currentElement = nextElement;
                            hasJump = false;
                            continue;
                        }
                        if (currentElement.parentElement.classList.contains("sb")) {
                            currentElement = hasClosestBlock(currentElement.parentElement);
                            continue;
                        }
                        break;
                    }
                    if (!currentElement.classList.contains("protyle-breadcrumb__bar") &&
                        !currentElement.classList.contains("protyle-breadcrumb__item") &&
                        !currentElement.classList.contains("sb__resize")) {
                        selectElements.push(currentElement);
                    }
                    if (!currentElement.nextElementSibling && currentElement.parentElement.classList.contains("callout-content")) {
                        currentElement = currentElement.parentElement.nextElementSibling;
                    } else {
                        currentElement = currentElement.nextElementSibling;
                    }
                }
                syncDragSelectBlocks(selectElements);
            };

            let dragSelectFinished = false;
            const finishDragSelect = (mouseUpEvent: MouseEvent) => {
                if (dragSelectFinished) {
                    return;
                }
                dragSelectFinished = true;
                documentSelf.removeEventListener("mouseup", finishDragSelect, true);
                if (documentSelf.onmouseup === finishDragSelect) {
                    documentSelf.onmouseup = null;
                }
                protyle.contentElement.removeEventListener("scroll", selectScrollEvent);
                flushAVDragSelect();
                if (startsFromPadding) {
                    stopScrollAnimation();
                }
                documentSelf.onmousemove = null;
                documentSelf.ondragstart = null;
                documentSelf.onselectstart = null;
                documentSelf.onselect = null;
                // 多选表格单元格后，选择菜单中的居左，然后 shift+左 选中的文字无法显示选中背景，因此需移除
                // 多选块后 shift+左 选中的文字无法显示选中背景，因此需移除
                protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--hiderange");
                this.element.classList.remove("fn__pointer-none");
                this.tableControl?.setHidden(false);
                if (startsFromPadding) {
                    if (avDragSelectMode !== undefined) {
                        getSelection().removeAllRanges();
                    } else if (isToggleBlockDrag && rangeBeforePaddingMouseDown &&
                        this.element.contains(rangeBeforePaddingMouseDown.startContainer) &&
                        this.element.contains(rangeBeforePaddingMouseDown.endContainer)) {
                        focusByRange(rangeBeforePaddingMouseDown);
                    } else if (mouseUpEvent.clientY > lastBlockRect.bottom) {
                        // 文档末尾空白由 contentElement 的 click 事件插入或聚焦末尾块
                        getSelection().removeAllRanges();
                    } else if (nodeElement) {
                        const blockPoint = getShiftClickBlockByPoint(this.element, nodeElement,
                            mouseUpEvent.clientX, mouseUpEvent.clientY);
                        if (blockPoint) {
                            focusBlock(blockPoint.blockElement, undefined, blockPoint.toStart);
                        } else {
                            focusBlock(nodeElement, undefined, mouseUpEvent.clientX < mostLeft);
                        }
                    }
                }
                protyle.selectElement.classList.add("fn__none");
                protyle.selectElement.removeAttribute("style");
                if (tableBlockElement) {
                    // @ts-ignore
                    tableBlockElement.firstElementChild.style.webkitUserModify = "";
                    const tableSelectElement = tableBlockElement.querySelector(".table__select") as HTMLElement;
                    if (tableSelectElement.getAttribute("style")) {
                        const managedSelection = (target.tagName === "TH" || target.tagName === "TD") &&
                            moveCellElement && this.tableControl?.selectCellRange(
                                target as HTMLTableCellElement, moveCellElement as HTMLTableCellElement);
                        if (managedSelection) {
                            tableSelectElement.removeAttribute("style");
                            window.siyuan.menus.menu.remove();
                        } else {
                        if (getSelection().rangeCount > 0) {
                            getSelection().getRangeAt(0).collapse(false);
                        }
                        window.siyuan.menus.menu.remove();
                        const tableElement = tableBlockElement.querySelector("table");
                        const selectedCellElements: HTMLTableCellElement[] = [];
                        tableBlockElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                            if (!item.classList.contains("fn__none") && isIncludeCell({
                                tableSelectElement,
                                item,
                            })) {
                                selectedCellElements.push(item);
                            }
                        });
                        const setSelectedCellStyle = (property: string, value: string) => {
                            tableSelectElement.removeAttribute("style");
                            setTableCellStyle(protyle, tableBlockElement as HTMLElement, selectedCellElements,
                                property, value);
                        };
                        let mergeCellMenuElement: HTMLElement;
                        if (!protyle.disabled) {
                            mergeCellMenuElement = new MenuItem({
                                id: "mergeCell",
                                icon: "iconTableCellsMerge",
                                label: window.siyuan.languages.mergeCell,
                                click: () => {
                                    if (tableBlockElement) {
                                        const selectCellElements: HTMLTableCellElement[] = [];
                                        const colIndexList: number[] = [];
                                        const colCount = tableBlockElement.querySelectorAll("th").length;
                                        let fnNoneMax = 0;
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
                                                selectCellElements[0].innerHTML = (html.replace(/<br>$/, "") || "<br>") + "<wbr>";
                                                selectCellElements[0].colSpan = colSpan;
                                                selectCellElements[0].rowSpan = rowSpan;
                                                focusByWbr(selectCellElements[0], document.createRange());
                                                this.preventInput = true;
                                                try {
                                                    document.execCommand("insertHTML", false, "");
                                                } finally {
                                                    this.preventInput = false;
                                                }
                                                updateTransaction(protyle, tableBlockElement, oldHTML);
                                            }
                                        });
                                    }
                                }
                            }).element;
                        }
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
                        /// #if !MOBILE
                        window.siyuan.menus.menu.append(new MenuItem({
                            id: "copyRichText",
                            label: window.siyuan.languages.copyRichText,
                            accelerator: window.siyuan.config.keymap.editor.general.copyRichText.custom,
                            click() {
                                if (tableBlockElement) {
                                    focusByRange(getEditorRange(tableBlockElement));
                                    protyle.wysiwyg.copyRichText();
                                }
                            }
                        }).element);
                        /// #endif
                        window.siyuan.menus.menu.append(new MenuItem({
                            id: "copyPlainText",
                            label: window.siyuan.languages.copyPlainText,
                            click() {
                                if (tableBlockElement) {
                                    let textPlain = "";
                                    selectedCellElements.forEach((item, index) => {
                                        textPlain += item.textContent.trim() + "\t";
                                        if (!item.nextElementSibling || !selectedCellElements[index + 1] ||
                                            item.nextElementSibling !== selectedCellElements[index + 1]) {
                                            textPlain = textPlain.slice(0, -1) + "\n";
                                        }
                                    });
                                    copyPlainText(textPlain.slice(0, -1));
                                    focusBlock(tableBlockElement);
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
                                id: "paste",
                                label: window.siyuan.languages.paste,
                                icon: "iconPaste",
                                accelerator: "⌘V",
                                async click() {
                                    if (!tableBlockElement) {
                                        return;
                                    }
                                    focusByRange(getEditorRange(tableBlockElement));
                                    if (document.queryCommandSupported("paste")) {
                                        document.execCommand("paste");
                                    } else {
                                        try {
                                            const text = await readClipboard();
                                            paste(protyle, Object.assign(text, {target: tableBlockElement as HTMLElement}));
                                        } catch (e) {
                                            console.log(e);
                                        }
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
                            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: "iconFont",
                                label: window.siyuan.languages.fontStyle,
                                submenu: getTableCellTextStyleMenus(protyle, selectedCellElements, () => {
                                    tableSelectElement.removeAttribute("style");
                                }),
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: "iconTheme",
                                label: window.siyuan.languages.colorPrimary,
                                submenu: getTableCellBackgroundMenus(selectedCellElements,
                                    color => setSelectedCellStyle("background-color", color)),
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                id: "alignment",
                                icon: "iconAlignSettings",
                                label: window.siyuan.languages.alignment,
                                type: "submenu",
                                submenu: getTableCellAlignmentMenus(selectedCellElements, setSelectedCellStyle),
                            }).element);
                            const cellSelection = getTableCellSelectionIndexes(tableElement, selectedCellElements);
                            if (cellSelection.rowIndexes.length > 0 || cellSelection.columnIndexes.length > 0) {
                                window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                            }
                            if (cellSelection.rowIndexes.length > 0) {
                                window.siyuan.menus.menu.append(new MenuItem({
                                    id: "deleteRows",
                                    icon: "iconTrashcan",
                                    label: window.siyuan.languages["delete-row"],
                                    disabled: cellSelection.merged,
                                    action: cellSelection.merged ? "iconInfo" : undefined,
                                    actionLabel: cellSelection.merged ?
                                        window.siyuan.languages.splitMergedCellTip : undefined,
                                    click() {
                                        tableSelectElement.removeAttribute("style");
                                        deleteTableRows(protyle, tableBlockElement as HTMLElement,
                                            cellSelection.rowIndexes);
                                    },
                                }).element);
                            }
                            if (cellSelection.columnIndexes.length > 0) {
                                window.siyuan.menus.menu.append(new MenuItem({
                                    id: "deleteColumns",
                                    icon: "iconTrashcan",
                                    label: window.siyuan.languages["delete-column"],
                                    disabled: cellSelection.merged,
                                    action: cellSelection.merged ? "iconInfo" : undefined,
                                    actionLabel: cellSelection.merged ?
                                        window.siyuan.languages.splitMergedCellTip : undefined,
                                    click() {
                                        tableSelectElement.removeAttribute("style");
                                        deleteTableColumns(protyle, tableBlockElement as HTMLElement,
                                            cellSelection.columnIndexes);
                                    },
                                }).element);
                            }
                            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                            window.siyuan.menus.menu.append(mergeCellMenuElement);
                        }
                        window.siyuan.menus.menu.popup({x: mouseUpEvent.clientX - 8, y: mouseUpEvent.clientY - 16});
                        }
                    }
                }

                const selectElement = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
                if (avDragSelectMode === "items" && avDragSelectElement) {
                    setAVDragItemAnchor(avDragSelectElement);
                    countBlockWord([]);
                    focusBlock(avDragSelectElement);
                } else {
                    const ids: string[] = [];
                    selectElement.forEach(item => {
                        ids.push(item.getAttribute("data-node-id"));
                    });
                    countBlockWord(ids);
                }
                // 修正三击及跨块选区落在块边界时的 range
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
                        // https://github.com/siyuan-note/siyuan/issues/17092 & https://github.com/siyuan-note/siyuan/issues/15296
                        const endElement = hasClosestBlock(mouseUpEvent.target as HTMLElement);
                        if (endElement && document.activeElement.classList.contains("protyle-wysiwyg")) {
                            focusBlock(endElement);
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
                        }
                    }
                }
            };
            // 底部反链包含嵌套编辑器，捕获阶段结束框选，避免内部事件阻断后选区无法清理
            documentSelf.onmouseup = finishDragSelect;
            documentSelf.addEventListener("mouseup", finishDragSelect, {capture: true, once: true});
        });
    }

    private bindEvent(protyle: IProtyle) {
        // 编辑器尺寸或内容变化时，重新计算数据库视图栏和表头、表尾位置
        protyle.observer = new ResizeObserver(() => {
            protyle.wysiwyg.element.querySelectorAll(".av").forEach((item: HTMLElement) => {
                stickyRow(item, protyle.contentElement, "all");
            });
        });

        this.element.addEventListener("focusout", (event) => {
            if (getAVTemplateInteractiveElement(event.target)) {
                event.stopPropagation();
                return;
            }
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
            if (getAVTemplateInteractiveElement(event.target)) {
                event.stopPropagation();
                return;
            }
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
            // https://github.com/siyuan-note/siyuan/issues/17800 不能删除
            const embedElement = isInEmbedBlock(nodeElement);
            if (embedElement && !embedElement.classList.contains("protyle-wysiwyg--select")) {
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            event.stopPropagation();
            event.preventDefault();
            const selectImgElement = nodeElement.querySelector(".img--select");
            const selectAVElement = nodeElement.querySelector(".av__row--select, .av__cell--select") ||
                (getAVSelectedCells(nodeElement).length > 0 ||
                (nodeElement.dataset.avType === "table" && getAVSelectedItemIDs(nodeElement).length > 0) ?
                    nodeElement : null);
            const selectTableElement = nodeElement.querySelector(".table__select")?.clientWidth > 0;
            // 表格内跨多单元格的文本选区：range.cloneContents() 会产出残缺的 td/tr 片段，需要重建合法 table
            let selectTableRange = false;
            let tableRangeElement: HTMLElement = null;
            let tableRangeStartCell: HTMLElement = null;
            let tableRangeEndCell: HTMLElement = null;
            if (!selectTableElement) {
                const startCell = hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH");
                const endCell = hasClosestByTag(range.endContainer, "TD") || hasClosestByTag(range.endContainer, "TH");
                if (startCell && endCell && startCell !== endCell) {
                    const startTable = (startCell as HTMLElement).closest("table");
                    if (startTable && startTable === (endCell as HTMLElement).closest("table")) {
                        selectTableRange = true;
                        tableRangeElement = (startCell as HTMLElement).closest('[data-type="NodeTable"]') as HTMLElement;
                        tableRangeStartCell = startCell as HTMLElement;
                        tableRangeEndCell = endCell as HTMLElement;
                    }
                }
            }
            let selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            const cloneElement = range.cloneContents();
            let autoSelectedBlock = false;
            if (selectElements.length === 0 && range.toString() === "" && !cloneElement.querySelector("img") &&
                !selectImgElement && !selectAVElement && !selectTableElement) {
                nodeElement.classList.add("protyle-wysiwyg--select");
                selectElements = [nodeElement];
                autoSelectedBlock = true;
            }
            const selectedStateElements = [...selectElements];
            const endElement = hasClosestBlock(range.endContainer);
            const cutCrossBlockRange = selectedStateElements.length === 0 && !range.collapsed &&
                !!endElement && nodeElement !== endElement && !selectImgElement && !selectAVElement && !selectTableElement;
            let cutClipboardWritten = false;
            if (selectedStateElements.length === 0 && (!range.collapsed || selectImgElement) &&
                !selectAVElement && !selectTableElement) {
                let checkTargets: IBlockRefCheckTargets = {elements: [], exactIDs: [], deletedIDs: []};
                if (selectImgElement) {
                    checkTargets = getImageBlockRefCheckTargets(nodeElement, selectImgElement);
                } else if (endElement) {
                    checkTargets = getRangeBlockRefCheckTargets(
                        protyle.wysiwyg.element, range, nodeElement, endElement, cutCrossBlockRange);
                }
                const checkIDs = checkTargets.elements
                    .map(item => item.getAttribute("data-node-id")).filter(Boolean);
                if (checkIDs.length > 0) {
                    if (!await confirmBlockRef({
                        scope: "blocks",
                        ids: checkIDs,
                        exactIDs: checkTargets.exactIDs,
                        deletedIDs: checkTargets.deletedIDs,
                        notebook: protyle.notebookId,
                    }, protyle)) {
                        return;
                    }
                    if (checkTargets.elements.some(item => !item.isConnected) ||
                        !protyle.wysiwyg.element.contains(range.startContainer) ||
                        !protyle.wysiwyg.element.contains(range.endContainer)) {
                        return;
                    }
                    focusByRange(range);
                    if (!await this.writeSelectionClipboardForCut()) {
                        return;
                    }
                    cutClipboardWritten = true;
                }
            }
            if (cutCrossBlockRange) {
                if (!cutClipboardWritten) {
                    const clipboardData = new DataTransfer();
                    this.element.dispatchEvent(new ClipboardEvent("copy", {
                        bubbles: true,
                        cancelable: true,
                        clipboardData,
                    }));
                    if (clipboardData.types.length === 0) {
                        showMessage(window.siyuan.languages.clipboardPermissionDenied, 7000, "error");
                        return;
                    }
                    Array.from(clipboardData.types).forEach(type => {
                        event.clipboardData.setData(type, clipboardData.getData(type));
                    });
                }
                await removeCrossBlockRange(protyle, range, nodeElement, endElement, true);
                protyle.hint.render(protyle);
                return;
            }
            let html = "";
            let textPlain = "";
            let isInCodeBlock = false;
            let needClipboardWrite = false;
            let cutBlockSelection = false;
            let cutNextElement: Element | false;
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
                const checkIDs: string[] = [];
                for (let i = 0; i < selectElements.length; i++) {
                    const item = getTopAloneElement(selectElements[i]);
                    checkIDs.push(item.getAttribute("data-node-id"));
                    let itemHTML = "";
                    if (item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
                        needClipboardWrite = true;
                        const response = await fetchSyncPost("/api/block/getHeadingChildrenDOM", {
                            id: item.getAttribute("data-node-id"),
                            removeFoldAttr: false
                        });
                        itemHTML = response.data;
                        const deleteResponse = await fetchSyncPost("/api/block/getHeadingDeleteTransaction", {
                            id: item.getAttribute("data-node-id"),
                        });
                        if (deleteResponse.code !== 0) {
                            return;
                        }
                        deleteResponse.data.doOperations.forEach((operation: IOperation) => {
                            if (operation.action === "delete") {
                                checkIDs.push(operation.id);
                            }
                        });
                    } else if (item.getAttribute("data-type") !== "NodeBlockQueryEmbed" && item.querySelector('[data-type="NodeHeading"][fold="1"]')) {
                        needClipboardWrite = true;
                        const response = await fetchSyncPost("/api/block/getBlockDOM", {
                            id: item.getAttribute("data-node-id"),
                            notebook: protyle.notebookId,
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
                const uniqueCheckIDs = Array.from(new Set(checkIDs.filter(Boolean)));
                if (!await confirmBlockRef({
                    scope: "blocks",
                    ids: uniqueCheckIDs,
                    deletedIDs: uniqueCheckIDs,
                    notebook: protyle.notebookId,
                }, protyle)) {
                    if (autoSelectedBlock) {
                        nodeElement.classList.remove("protyle-wysiwyg--select");
                    }
                    return;
                }
                if (selectedStateElements.some(item => !item.isConnected || !item.classList.contains("protyle-wysiwyg--select"))) {
                    return;
                }
                needClipboardWrite = true;
                cutBlockSelection = true;
                cutNextElement = getNextBlock(selectElements[selectElements.length - 1]);
            } else if (selectAVElement) {
                needClipboardWrite = true;
                const selectedCells = getAVSelectedCells(nodeElement);
                const itemCells = selectedCells.length === 0 ? getAVSelectedTableCells(nodeElement) : undefined;
                const cellsValue = await updateCellsValue(protyle, nodeElement, undefined, undefined, undefined,
                    undefined, false, false, false, itemCells);
                html = JSON.stringify(cellsValue.json);
                textPlain = cellsValue.text;
            } else if (selectTableElement) {
                const selectCellElements: HTMLTableCellElement[] = [];
                const tableSelectElement = nodeElement.querySelector(".table__select") as HTMLElement;
                const tableElement = nodeElement.querySelector("table");
                nodeElement.querySelectorAll("th, td").forEach((item: HTMLTableCellElement) => {
                    if (!item.classList.contains("fn__none") && isIncludeCell({
                        tableSelectElement,
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
                // 用 getTableRangeHTML 重建合法表格（与 copy 一致），同时清空选区内单元格内容
                if (selectCellElements.length > 0) {
                    html = getTableRangeHTML(tableElement, selectCellElements[0], selectCellElements[selectCellElements.length - 1]);
                } else {
                    html = "<table></table>";
                }
                selectCellElements.forEach((item) => {
                    item.innerHTML = "";
                });
                textPlain = protyle.lute.HTML2Md(html);
                updateTransaction(protyle, nodeElement, oldHTML);
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
                    textPlain = tempElement.textContent;
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
                    textPlain = range.toString();
                    range.deleteContents();
                    tempElement.append(newSpanElement);
                } else {
                    if (selectTableRange || cloneElement.querySelectorAll("td, th").length > 0) {
                        const tableScrollLeft = nodeElement.firstElementChild.scrollLeft;
                        const tableScrollTop = nodeElement.firstElementChild.scrollTop;
                        const contentScrollTop = protyle.contentElement.scrollTop;
                        if (selectTableRange) {
                            // 表格内跨多单元格的文本选区：按网格映射重建合法 table，重新计算 colspan/rowspan。
                            // 必须在 extractContents 删除原内容前计算，否则 getBoundingClientRect 拿不到原始位置
                            const tableElement = tableRangeElement.querySelector("table");
                            const newTableHTML = getTableRangeHTML(tableElement, tableRangeStartCell, tableRangeEndCell);
                            // 放入 tempElement 以便后续 html = tempElement.innerHTML 取用（裸 table，后续统一包 BlockDOM）
                            tempElement.innerHTML = newTableHTML;
                            textPlain = protyle.lute.HTML2Md(newTableHTML);
                            // 删除选区内容并修复表格 DOM
                            const wbrElement = document.createElement("wbr");
                            range.insertNode(wbrElement);
                            range.setStartAfter(wbrElement);
                            range.extractContents();
                        } else {
                            // 表格内多格子 cut https://github.com/siyuan-note/siyuan/issues/564
                            const wbrElement = document.createElement("wbr");
                            range.insertNode(wbrElement);
                            range.setStartAfter(wbrElement);
                            tempElement.append(range.extractContents());
                        }
                        nodeElement.outerHTML = protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
                        nodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
                        mathRender(nodeElement);
                        focusByWbr(nodeElement, range);
                        // SpinBlockDOM 替换整张表格后，恢复旧表格的内外层滚动位置
                        if (tableScrollLeft > 0) {
                            nodeElement.firstElementChild.scrollLeft = tableScrollLeft;
                        }
                        if (tableScrollTop > 0) {
                            nodeElement.firstElementChild.scrollTop = tableScrollTop;
                        }
                        if (contentScrollTop > 0) {
                            protyle.contentElement.scrollTop = contentScrollTop;
                            protyle.scroll.lastScrollTop = contentScrollTop - 1;
                        }
                    } else {
                        const inlineMathElement = hasClosestByAttribute(range.commonAncestorContainer, "data-type", "inline-math");
                        if (inlineMathElement) {
                            // 表格内剪切数学公式 https://ld246.com/article/1631708573504
                            tempElement.append(inlineMathElement);
                        } else {
                            tempElement.append(range.cloneContents());
                            let parentElement: false | Element = getContenteditableElement(nodeElement);
                            // https://ld246.com/article/1647689760545
                            if (nodeElement.classList.contains("av")) {
                                updateAVName(protyle, nodeElement);
                            } else if (nodeElement.classList.contains("table")) {
                                parentElement = hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH");
                            } else if (cloneElement.querySelector('.img, [data-type="inline-math"]')) {
                                textPlain = "";
                                cloneElement.childNodes.forEach((item: Element) => {
                                    if (item.nodeType === 3) {
                                        textPlain += item.textContent;
                                    } else if (item.nodeType === 1 &&
                                        (item.classList.contains("img") || item.getAttribute("data-type") === "inline-math")) {
                                        textPlain += protyle.lute.BlockDOM2StdMd(item.outerHTML).trimEnd();
                                    } else {
                                        textPlain += item.textContent;
                                    }
                                });
                            } else if (!hasClosestByTag(range.startContainer, "CODE")) {
                                textPlain = range.toString();
                            }
                            range.deleteContents();
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
                    updateTransaction(protyle, nodeElement, oldHTML);
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
            if (!cutClipboardWritten) {
                event.clipboardData.setData("text/plain", textPlain);
            }

            if (!isInCodeBlock) {
                enableLuteMarkdownSyntax(protyle);
                // 表格选区（框选或跨多单元格文本选区）直接构建 BlockDOM，不走 HTML2BlockDOM 的 markdown 往返
                let textSiyuan: string;
                if (selectTableElement || selectTableRange) {
                    // 表格选区：html 已是合法 <table>...</table>，构建最小化 NodeTable BlockDOM，不走 markdown 往返
                    const newId = Lute.NewNodeID();
                    textSiyuan = `<div data-node-id="${newId}" data-type="NodeTable" class="table"><div contenteditable="true" spellcheck="false">${html}<div class="protyle-action__table"><div class="table__resize"></div><div class="table__select"></div></div></div><div class="protyle-attr" contenteditable="false">\u200b</div></div>`;
                    html = textSiyuan;
                } else {
                    textSiyuan = html;
                }
                restoreLuteMarkdownSyntax(protyle);
                if (!cutClipboardWritten) {
                    event.clipboardData.setData("text/siyuan", textSiyuan);
                }
                // 在 text/html 中插入注释节点，用于右键菜单粘贴时获取 text/siyuan 数据
                const textHTML = `<!--data-siyuan='${encodeBase64(textSiyuan)}'-->` + removeZWJ((selectTableElement || selectTableRange) ? html : protyle.lute.BlockDOM2HTML(selectAVElement ? textPlain : html));
                if (!cutClipboardWritten) {
                    event.clipboardData.setData("text/html", textHTML);
                }
                let clipboardWriteSucceeded = true;
                if (needClipboardWrite && !cutClipboardWritten) {
                    try {
                        await navigator.clipboard.write([new ClipboardItem({
                            ["text/plain"]: textPlain,
                            ["text/html"]: textHTML,
                        })]);
                    } catch (e) {
                        console.log("Cut write clipboard error:", e);
                        clipboardWriteSucceeded = false;
                        showMessage(e instanceof Error ? e.message : String(e), 7000, "error");
                    }
                }
                if (cutBlockSelection && clipboardWriteSucceeded) {
                    const removed = await removeBlock(protyle, nodeElement, range, "remove", true);
                    if (removed && cutNextElement && cutNextElement.isConnected) {
                        // Ctrl+X 剪切后光标应跳到下一行行首 https://github.com/siyuan-note/siyuan/issues/5485
                        focusBlock(cutNextElement);
                    }
                }
            }
        });

        let beforeContextmenuRange: Range;
        this.element.addEventListener("contextmenu", async (event: MouseEvent & { detail: any }) => {
            if (event.shiftKey || protyle.toolbar.isMultiSelectMode()) {
                return;
            }
            event.stopPropagation();
            /// #if BROWSER
            event.preventDefault();
            /// #endif
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
            const widthDragElement = hasClosestByClassName(target, "av__widthdrag") as HTMLElement;
            if (widthDragElement) {
                if (!protyle.disabled) {
                    showAVColumnWidthMenu(protyle, nodeElement as HTMLElement, widthDragElement, {x, y});
                }
                event.stopPropagation();
                event.preventDefault();
                return;
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
                            content: assetImgElement.tagName === "IMG" ? assetImgElement.getAttribute("src") : assetImgElement.getAttribute("data-url"),
                            type: assetImgElement.tagName === "IMG" ? "image" : "file",
                            name: assetImgElement.tagName === "IMG" ? "" : assetImgElement.getAttribute("data-name"),
                            index,
                            rect: assetImgElement.getBoundingClientRect()
                        });
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                }
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
                    clearSelect(["row", "galleryItem"], nodeElement);
                    transaction(protyle, [{
                        action: "setAttrViewBlockView",
                        blockID: nodeElement.getAttribute("data-node-id"),
                        id: avTabHeaderElement.dataset.id,
                        avID: nodeElement.getAttribute("data-av-id"),
                    }], [{
                        action: "setAttrViewBlockView",
                        blockID: nodeElement.getAttribute("data-node-id"),
                        id: getAVCurrentViewID(nodeElement),
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
                    event.preventDefault();
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
                    event.preventDefault();
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
                    const spellcheckContext = await requestSpellcheckContext(x, y);
                    if (spellcheckContext === null) {
                        return;
                    }
                    if (spellcheckContext?.misspelledWord) {
                        protyle.wysiwyg.flushPendingInput();
                        setInsertWbrHTML(nodeElement, protyle.toolbar.range, protyle);
                    }
                    contentMenu(protyle, nodeElement);
                    addSpellcheckMenuItems(spellcheckContext);
                    /// #if !MOBILE
                    window.siyuan.menus.menu.popup({x, y: y + 13, h: 26});
                    /// #endif
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

        this.element.addEventListener("mousewheel", (event: WheelEvent) => {
            hideTooltip();
            // https://ld246.com/article/1648865235549
            if (!protyle.scroll.element.classList.contains("fn__none")) {
                const firstElement = protyle.wysiwyg.element.firstElementChild;
                const lastElement = protyle.wysiwyg.element.lastElementChild;
                const firstId = firstElement?.getAttribute("data-node-id");
                const lastId = lastElement?.getAttribute("data-node-id");
                if (event.deltaY < 0 && firstElement && firstId && firstElement.getAttribute("data-eof") !== "1" &&
                    (protyle.contentElement.clientHeight === protyle.contentElement.scrollHeight || protyle.contentElement.scrollTop === 0)) {
                    protyle.scroll.loadDynamic(protyle, 1);
                } else if (event.deltaY > 0 && lastElement && lastId && lastElement.getAttribute("data-eof") !== "2" &&
                    (protyle.contentElement.clientHeight === protyle.contentElement.scrollHeight ||
                        protyle.contentElement.clientHeight + Math.ceil(protyle.contentElement.scrollTop) >= protyle.contentElement.scrollHeight)) {
                    protyle.scroll.loadDynamic(protyle, 2);
                }
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
            if (getAVTemplateInteractiveElement(event.target)) {
                event.stopPropagation();
                return;
            }
            // https://github.com/siyuan-note/siyuan/issues/11241
            if (hasClosestByAttribute(event.target, "data-type", "av-search")) {
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
            beforePaste(protyle, blockElement);
            paste(protyle, event);
        });

        // 输入法测试点 https://github.com/siyuan-note/siyuan/issues/3027
        let isComposition = false; // for iPhone
        // 原生软换行在 input 触发前已经修改 DOM，需预存选区供撤销恢复。
        let lineBreakUndoContext: Record<string, string>;
        // 仅矫正从数据库外进入的占位光标，避免重置数据库内部的方向键导航。
        let arrowStartElement: false | HTMLElement | undefined;
        this.element.addEventListener("keydown", (event: KeyboardEvent) => {
            if (!event.repeat && !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey &&
                !event.isComposing && event.key.startsWith("Arrow")) {
                arrowStartElement = hasClosestBlock(getEditorRange(this.element).startContainer);
            }
        });
        // 记录组合开始时的光标位置，用于取消组合后恢复光标（输入法删空候选词会导致浏览器移动光标）
        let compositionRange: { range: Range } | { cell: HTMLElement; offset: number };
        const isAfterInlineMath = (range: Range) => {
            let previousNode: Node;
            if (range.startContainer.nodeType === Node.TEXT_NODE) {
                if (!/^[\n\u200B\uFEFF]*$/.test(range.startContainer.textContent.slice(0, range.startOffset))) {
                    return false;
                }
                previousNode = range.startContainer.previousSibling;
            } else {
                previousNode = range.startContainer.childNodes[range.startOffset - 1];
            }
            return previousNode?.nodeType === Node.ELEMENT_NODE &&
                (previousNode as Element).getAttribute("data-type")?.split(" ").includes("inline-math");
        };
        this.element.addEventListener("compositionstart", (event) => {
            if (getAVTemplateInteractiveElement(event.target)) {
                event.stopPropagation();
                return;
            }
            isComposition = true;
            // 微软双拼由于 focusByRange 导致无法输入文字，因此不再 keydown 中记录了，但 keyup 会记录拼音字符，因此使用 isComposition 阻止 keyup 记录。
            // 但搜狗输入法选中后继续输入不走 keydown，isComposition 阻止了 keyup 记录，因此需在此记录。
            const range = getEditorRange(protyle.wysiwyg.element);
            const nodeElement = hasClosestBlock(range.startContainer);
            if (nodeElement) {
                const startCell = hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH");
                if (startCell && !isAfterInlineMath(range)) {
                    compositionRange = {
                        cell: startCell as HTMLElement,
                        offset: getSelectionOffset(startCell, nodeElement, range).start,
                    };
                } else {
                    compositionRange = {range: range.cloneRange()};
                }
            } else {
                compositionRange = undefined;
            }
            if (!isMac() && nodeElement) {
                setInsertWbrHTML(nodeElement, range, protyle);
            }
            event.stopPropagation();
        });

        this.element.addEventListener("compositionend", (event: InputEvent) => {
            event.stopPropagation();
            if (getAVTemplateInteractiveElement(event.target)) {
                return;
            }
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
                    // https://github.com/siyuan-note/siyuan/issues/4604
                    updateTransaction(protyle, blockElement, protyle.wysiwyg.lastHTMLs[id]);
                }
                // https://github.com/siyuan-note/siyuan/issues/17584
                if (compositionRange) {
                    if ("range" in compositionRange) {
                        // https://github.com/siyuan-note/siyuan/issues/14667
                        if (this.element.contains(compositionRange.range.startContainer)) {
                            focusByRange(compositionRange.range);
                        }
                    } else {
                        const selection = getSelection();
                        if (selection.rangeCount > 0) {
                            const afterRange = selection.getRangeAt(0);
                            const currentCell = hasClosestByTag(afterRange.startContainer, "TD") ||
                                hasClosestByTag(afterRange.startContainer, "TH");
                            if (!currentCell || currentCell !== compositionRange.cell) {
                                focusByOffset(compositionRange.cell, compositionRange.offset, compositionRange.offset);
                            }
                        } else {
                            focusByOffset(compositionRange.cell, compositionRange.offset, compositionRange.offset);
                        }
                    }
                }
                compositionRange = undefined;
            }
        });

        this.element.addEventListener("beforeinput", async (event: InputEvent) => {
            if (!isComposition) {
                beforeBlockquoteInput(protyle, event);
            }
            const selection = getSelection();
            lineBreakUndoContext = !event.defaultPrevented && event.inputType === "insertLineBreak" &&
            selection.rangeCount > 0 ?
                getUndoFocusContext(protyle.wysiwyg.element, selection.getRangeAt(0)) : undefined;
            if (event.defaultPrevented || event.inputType !== "insertText" || !event.data ||
                selection.rangeCount === 0) {
                return;
            }
            const range = selection.getRangeAt(0);
            if (range.collapsed) {
                return;
            }
            const blockRanges = getBlockRanges(protyle.wysiwyg.element, range);
            const startElement = blockRanges[0]?.blockElement || hasClosestBlock(range.startContainer);
            const endElement = blockRanges[blockRanges.length - 1]?.blockElement || hasClosestBlock(range.endContainer);
            if (!startElement || !endElement || startElement === endElement) {
                return;
            }
            if (startElement.closest('[data-type="NodeListItem"]') ||
                endElement.closest('[data-type="NodeListItem"]')) {
                event.preventDefault();
                event.stopPropagation();
                await removeCrossBlockRange(protyle, range, startElement, endElement, false, {
                    event: /^\d{1}$/.test(event.data) ? undefined : event,
                    text: event.data,
                });
                return;
            }
        });

        this.element.addEventListener("input", (event: InputEvent) => {
            let lineBreakInputOperations: Parameters<typeof input>[5];
            if (event.inputType === "insertLineBreak" && lineBreakUndoContext) {
                lineBreakInputOperations = {
                    doOperations: [],
                    undoOperations: [],
                    undoContext: lineBreakUndoContext,
                };
            }
            lineBreakUndoContext = undefined;
            if (getAVTemplateInteractiveElement(event.target)) {
                event.stopPropagation();
                return;
            }
            if (this.preventInput) {
                event.stopPropagation();
                return;
            }
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
                this.scheduleInput(() => {
                    // 搜狗拼音数字后面句号变为点；Mac 反向双引号无法输入
                    input(protyle, blockElement, range, true);
                });
            } else {
                if (isMac() && event.data === "【】") {
                    this.scheduleInput(() => {
                        input(protyle, blockElement, range, true, event);
                    }, Constants.TIMEOUT_INPUT, false);
                } else {
                    this.scheduleInput(() => {
                        input(protyle, blockElement, range, true, event, lineBreakInputOperations);
                    });
                }
            }
            event.stopPropagation();
        });

        this.element.addEventListener("keyup", (event) => {
            if (getAVTemplateInteractiveElement(event.target)) {
                event.stopPropagation();
                return;
            }
            const range = getEditorRange(this.element).cloneRange();
            const nodeElement = hasClosestBlock(range.startContainer);
            const isArrowFromOutsideAV = arrowStartElement && !arrowStartElement.classList.contains("av");
            if (event.key.startsWith("Arrow")) {
                arrowStartElement = undefined;
            }

            if (!event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.isComposing &&
                event.key.startsWith("Arrow") && isArrowFromOutsideAV &&
                nodeElement && nodeElement.classList.contains("av") &&
                !nodeElement.classList.contains("protyle-wysiwyg--select") &&
                hasClosestByClassName(range.startContainer, "av__cursor") &&
                focusAVByArrow(protyle, nodeElement, event.key)) {
                event.stopPropagation();
                return;
            }

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
                protyle.toolbar.render(protyle, range);
                countSelectWord(range);
            }

            if (event.eventPhase !== 3 && !event.shiftKey && (event.key.indexOf("Arrow") > -1 || event.key === "Home" || event.key === "End" || event.key === "PageUp" || event.key === "PageDown") && !event.isComposing) {
                if (nodeElement && protyle.hint.element.classList.contains("fn__none") &&
                    window.siyuan.menus.menu.element.classList.contains("fn__none")) {
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

        this.element.addEventListener("dblclick", (event: MouseEvent) => {
            if (protyle.toolbar.isMultiSelectMode()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (getAVTemplateInteractiveElement(event.target)) {
                event.stopPropagation();
                return;
            }
            const target = event.target as HTMLElement;
            if (!protyle.disabled && target.classList.contains("av__widthdrag")) {
                const blockElement = hasClosestBlock(target) as HTMLElement;
                const columnID = target.parentElement?.getAttribute("data-col-id");
                if (blockElement && columnID) {
                    autoFitAVColumns(protyle, blockElement, [columnID]);
                }
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            // 双击超级块拖拽手柄，均分所有列宽
            if (target.classList.contains("sb__resize")) {
                const doOperations: IOperation[] = [];
                const undoOperations: IOperation[] = [];
                Array.from(target.parentElement.children).forEach((item: HTMLElement) => {
                    // 没有任何子块设过 width，无需重置
                    if (!item.style.width && !item.style.flex) {
                        return;
                    }
                    if (!item.style.width && !item.style.flex) {
                        return;
                    }
                    const oldHTML = item.outerHTML;
                    item.style.width = "";
                    item.style.flex = "";
                    const id = item.getAttribute("data-node-id");
                    doOperations.push({action: "update", id, data: item.outerHTML});
                    undoOperations.push({action: "update", id, data: oldHTML});
                });

                if (doOperations.length > 0) {
                    transaction(protyle, doOperations, undoOperations);
                }
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            if (target.tagName === "IMG" && !target.classList.contains("emoji")) {
                previewDocImage((event.target as HTMLElement).getAttribute("src"), protyle.block.rootID);
                return;
            }
            // https://github.com/siyuan-note/siyuan/issues/12691
            const diagramElement = getDiagramBlock(hasClosestBlock(target) as HTMLElement);
            if (diagramElement) {
                previewDiagram(diagramElement);
                event.stopPropagation();
                event.preventDefault();
            }
        });
        let mobileBlur = false;
        this.element.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            if (protyle.toolbar.isMultiSelectMode()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (event.shiftKey) {
                const selection = getSelection();
                const focusElement = selection.focusNode && hasClosestBlock(selection.focusNode) as HTMLElement;
                // mousedown 未命中块间空白时，浏览器会先生成跨块文字选区，在 click 阶段将其转换为块选区
                // https://github.com/siyuan-note/siyuan/issues/11960
                if (focusElement && this.selectByShiftClick(protyle, event, focusElement)) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
            }
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
            const templateInteractiveElement = getAVTemplateInteractiveElement(event.target);
            if (templateInteractiveElement && !isAVTemplateLink(templateInteractiveElement)) {
                event.stopPropagation();
                return;
            }
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
            if (tableElement && !protyle.disabled) {
                if (hasClosestByTag(event.target, "CAPTION")) {
                    updateTableTitle(protyle, tableElement);
                    return;
                }
            }
            const range = getEditorRange(this.element);
            // 面包屑定位，需至于前，否则 return 的元素就无法进行面包屑定位
            if (protyle.options.render.breadcrumb) {
                protyle.breadcrumb.render(protyle, false, hasClosestBlock(range.startContainer));
            }
            // https://github.com/siyuan-note/siyuan/issues/12317
            if (range.startContainer.nodeType !== 3 &&
                (range.startContainer as Element).classList.contains("protyle-action") &&
                range.startContainer.parentElement.classList.contains("code-block")) {
                setFirstNodeRange(range.startContainer.parentElement.querySelector(".hljs").lastElementChild, range);
            }
            // 需放在嵌入块之前，否则嵌入块内的引用、链接、pdf 双链无法点击打开 https://ld246.com/article/1630479789513
            const templateLinkElement = templateInteractiveElement &&
            isAVTemplateLink(templateInteractiveElement) ? templateInteractiveElement : undefined;
            const aElement = hasClosestByAttribute(event.target, "data-type", "a") ||
                hasClosestByClassName(event.target, "av__celltext--url") ||   // 数据库中资源文件、链接、电话、邮箱单元格
                templateLinkElement;
            let aLink = aElement ? (aElement.getAttribute("data-href") ||
                (templateLinkElement ? aElement.getAttribute("href") : "") || "") : "";
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
            const siyuanURIInfo = aLink.startsWith("siyuan://blocks/") ? parseSiYuanUriInfo(aLink) : undefined;
            if (siyuanURIInfo?.avItemID && (range.toString() === "" || event.shiftKey)) {
                event.stopPropagation();
                event.preventDefault();
                hideElements(["dialog", "toolbar"], protyle);
                processSiYuanUri(protyle.app, aLink);
                return;
            }
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
                const virtualRefParam: { anchor: string, notebook?: string } = {
                    anchor: virtualRefElement.textContent,
                };
                if (isEncryptedBox(protyle.notebookId)) {
                    virtualRefParam.notebook = protyle.notebookId;
                }
                fetchPost("/api/block/getBlockDefIDsByRefText", virtualRefParam, (response) => {
                    checkFold(response.data.refDefs[0].refID, (zoomIn) => {
                        mobileBlur = true;
                        activeBlur();
                        openMobileFileById(protyle.app, response.data.refDefs[0].refID, zoomIn ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
                    });
                });
                return;
            }
            /// #endif

            const fileElement = hasClosestByAttribute(event.target, "data-type", "file-annotation-ref");
            if (fileElement && range.toString() === "") {
                event.stopPropagation();
                event.preventDefault();
                openLink(protyle.app, fileElement.getAttribute("data-id"), event, ctrlIsPressed);
                return;
            }

            if (aElement &&
                // https://github.com/siyuan-note/siyuan/issues/11980
                (event.shiftKey || range.toString() === "") &&
                // 如果aLink 为空时，当 data-type="a inline-math" 可继续后续操作
                aLink) {
                event.stopPropagation();
                event.preventDefault();
                openLink(protyle.app, aLink, event, ctrlIsPressed);
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

            if (window.siyuan.isPublish) {
                const passwordButtonElement = hasClosestByClassName(event.target, "protyle-password__button");
                if (passwordButtonElement) {
                    fetchPost("/api/filetree/authFilePublishAccess", {
                        id: passwordButtonElement.parentElement.parentElement.getAttribute("data-node-id"),
                        password: passwordButtonElement.parentElement.querySelector("input").value
                    }, (response) => {
                        if (response.msg) {
                            showMessage(response.msg);
                        } else {
                            reloadProtyle(protyle, true);
                            /// #if !MOBILE
                            getAllModels().outline.forEach(item => {
                                if (item.blockId === protyle.block.rootID) {
                                    const outlineParam: IObject = {
                                        id: item.blockId,
                                        preview: item.isPreview
                                    };
                                    if (isEncryptedBox(protyle.notebookId)) {
                                        outlineParam.notebook = protyle.notebookId;
                                    }
                                    fetchPost("/api/outline/getDocOutline", outlineParam, response => {
                                        item.update(response);
                                    });
                                }
                            });
                            /// #endif
                        }
                    });
                    event.stopPropagation();
                    return;
                }
            }

            const embedItemElement = hasClosestByClassName(event.target, "protyle-wysiwyg__embed");
            if (embedItemElement) {
                if (event.shiftKey || event.altKey || ctrlIsPressed) {
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
                        }
                        /// #endif
                    });
                    // https://github.com/siyuan-note/siyuan/issues/12585
                    if (!ctrlIsPressed) {
                        event.stopPropagation();
                        return;
                    }
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

            const openFloatElement = hasClosestByAttribute(event.target, "data-action", "openFloat");
            if (openFloatElement) {
                const id = openFloatElement.getAttribute("data-id");
                /// #if MOBILE
                openMobileFileById(protyle.app, id, [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
                /// #else
                window.siyuan.blockPanels.push(new BlockPanel({
                    app: protyle.app,
                    isBacklink: false,
                    targetElement: openFloatElement,
                    refDefs: [{refID: id}]
                }));
                /// #endif
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
                            updateTransaction(protyle, actionElement.parentElement.parentElement, oldHTML);
                        }
                        hideElements(["gutter"], protyle);
                    } else if (event.shiftKey && !protyle.disabled) {
                        openAttr(actionElement.parentElement, "bookmark", protyle);
                    } else if (ctrlIsPressed) {
                        zoomOut({protyle, id: actionId});
                    } else {
                        if (actionElement.classList.contains("protyle-action--task")) {
                            if (!protyle.disabled) {
                                toggleTaskListItem(protyle, actionElement.parentElement);
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
                        let emojiHTML = unicode2Emoji(unicode, "callout-img");
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
                        updateTransaction(protyle, nodeElement, oldHTML);
                        focusBlock(nodeElement);
                    }, calloutIconElement.querySelector("img"), {
                        ownerElement: protyle.element,
                        targetID: nodeElement.dataset.nodeId,
                    });
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
                        let emojiHTML = unicode2Emoji(unicode, "emoji");
                        if (getIconValueKind(unicode) === "custom") {
                            const emojiName = escapeAttr(escapeHtml(unicode.split(".")[0]));
                            const emojiPath = escapeAttr(escapeHtml(unicode));
                            emojiHTML = `<img alt="${emojiName}" class="emoji" src="/emojis/${emojiPath}" title="${emojiName}">`;
                        }
                        emojiElement.outerHTML = emojiHTML;
                        hideElements(["dialog"]);
                        updateTransaction(protyle, nodeElement, oldHTML);
                        focusByWbr(nodeElement, range);
                    }, emojiElement, {
                        ownerElement: protyle.element,
                        targetID: nodeElement.dataset.nodeId,
                    });
                }
                return;
            }

            if (avClick(protyle, event)) {
                return;
            }

            setTimeout(() => {
                // 选中后，在选中的文字上点击需等待 range 更新
                let newRange = getEditorRange(this.element);
                const calloutElement = ["callout", "callout-info", "callout-content"].some(className =>
                    event.target.classList.contains(className)) ? hasClosestBlock(event.target) : false;
                if (!protyle.disabled && !event.shiftKey && !ctrlIsPressed && calloutElement) {
                    // 提示块结构区域不可编辑，点击后将光标定位到首个可编辑子块
                    // https://github.com/siyuan-note/siyuan/issues/16310
                    newRange = focusBlock(calloutElement) || newRange;
                }
                // 表格中点击两侧或间隙导致光标跳转到开头 https://github.com/siyuan-note/siyuan/issues/16179
                if (event.target.classList.contains("protyle-wysiwyg") || event.target.parentElement?.classList.contains("table")) {
                    const rect = this.element.getBoundingClientRect();
                    let rangeElement = document.elementFromPoint(rect.left + rect.width / 2, event.clientY);
                    if (rangeElement === this.element) {
                        rangeElement = document.elementFromPoint(rect.left + rect.width / 2, event.clientY + 8);
                    }
                    let blockElement = hasClosestBlock(rangeElement);
                    if (blockElement && blockElement.classList.contains("table")) {
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
                    protyle.toolbar.render(protyle, newRange, event.detail > 0 ? {
                        x: event.clientX,
                        y: event.clientY,
                        detail: event.detail,
                    } : undefined);
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
