import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
    hasTopClosestByClassName,
    isInAVBlock,
    isInEmbedBlock
} from "../util/hasClosest";
import {getIconByType} from "../../editor/getIcon";
import {enterBack, iframeMenu, tableMenu, videoMenu, zoomOut} from "../../menus/protyle";
import {foldBlocksRecursively, setFold} from "../util/blockFold";
import {MenuItem} from "../../menus/Menu";
import {copySubMenu, openAttr, openFileAttr, openWechatNotify} from "../../menus/commonMenuItem";
import {
    copyPlainText,
    isInAndroid,
    isInHarmony,
    isMac,
    isOnlyMeta,
    saveExportFile,
    updateHotkeyAfterTip,
    updateHotkeyTip,
    writeText
} from "../util/compatibility";
import {
    transaction,
    turnsIntoOneTransaction,
    turnsIntoTransaction,
    turnsOneInto,
    updateBatchTransaction,
    updateTransaction
} from "../wysiwyg/transaction";
import {removeBlock} from "../wysiwyg/remove";
import {focusBlock, focusByRange, getEditorRange} from "../util/selection";
import {hideElements} from "../ui/hideElements";
import {highlightRender} from "../render/highlightRender";
import {blockRender} from "../render/blockRender";
import {
    getContenteditableElement,
    getEmbedChildOperationContext,
    getParentBlock,
    getTopAloneElement,
    isNotEditBlock
} from "../wysiwyg/getBlock";
import * as dayjs from "dayjs";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {cancelSB, genEmptyElement, getLangByType, insertEmptyBlock, jumpToParent,} from "../../block/util";
import {transparentImgSrc} from "../util/dragTip";
import {countBlockWord} from "../../layout/status";
import {Constants} from "../../constants";
import {mathRender} from "../render/mathRender";
import {duplicateBlock} from "../wysiwyg/commonHotkey";
import {isEncryptedBox, movePathTo, useShell} from "../../util/pathName";
import {hintMoveBlock} from "../hint/extend";
import {makeCard, quickMakeCard} from "../../card/makeCard";
import {transferBlockRef} from "../../menus/block";
import {isMobile} from "../../util/functions";
import {AIActions} from "../../ai/actions";
import {activeBlur, renderTextMenu, showKeyboardToolbarUtil} from "../../mobile/util/keyboardToolbar";
import {hideTooltip} from "../../dialog/tooltip";
import {appearanceMenu} from "../toolbar/Font";
import {setPosition} from "../../util/setPosition";
import {emitOpenMenu} from "../../plugin/EventBus";
import {insertAttrViewBlockAnimation, updateHeader} from "../render/av/row";
import {avContextmenu, duplicateCompletely} from "../render/av/action";
import {getPlainText} from "../util/paste";
import {addEditorToDatabase} from "../render/av/addToDatabase";
import {processClonePHElement} from "../render/util";
/// #if !MOBILE
import {openFileById} from "../../editor/util";
import {getDockByType} from "../../layout/tabUtil";
import * as path from "path";
/// #endif
import {showMessage} from "../../dialog/message";
import {checkFold} from "../../util/noRelyPCFunction";
import {clearSelect} from "../util/clear";
import {chartRender} from "../render/chartRender";

// 块类型 data-type 到本地化名称键的映射，用于块标提示中的 ${x}
const BLOCK_TYPE_LANG_KEYS: { [key: string]: string } = {
    NodeParagraph: "paragraph",
    NodeHeading: "headings",
    NodeList: "list1",
    NodeListItem: "listItem",
    NodeBlockquote: "quote",
    NodeCallout: "callout",
    NodeSuperBlock: "superBlock",
    NodeTable: "table",
    NodeCodeBlock: "code",
    NodeMathBlock: "math",
    NodeBlockQueryEmbed: "blockEmbed",
    NodeThematicBreak: "line",
    NodeVideo: "video",
    NodeAudio: "audio",
    NodeWidget: "widget",
    NodeAttributeView: "database",
};

// 根据块 data-type 返回本地化的类型名，用于块标拖拽提示「拖拽 ${x} 移动位置」
const getBlockTypeName = (type: string) => {
    const langKey = BLOCK_TYPE_LANG_KEYS[type];
    if (langKey && (window.siyuan.languages as { [key: string]: string })[langKey]) {
        return (window.siyuan.languages as { [key: string]: string })[langKey];
    }
    // 未知类型兜底，与拖拽 ghost 文案保持一致
    return getLangByType(type);
};

export class Gutter {
    public element: HTMLElement;
    // 普通块标提示模板（含 ${x} 块类型占位符），反链面板使用 gutterTipBacklink
    private gutterTip: string;
    private gutterTipBacklink: string;

    constructor(protyle: IProtyle) {
        if (isMac()) {
            this.gutterTip = window.siyuan.languages.gutterTip.replace("⌥→", updateHotkeyAfterTip(window.siyuan.config.keymap.general.enter.custom, "/"));
            this.gutterTipBacklink = window.siyuan.languages.gutterTipBacklink.replace("⌥→", updateHotkeyAfterTip(window.siyuan.config.keymap.general.enter.custom, "/"));
        } else {
            this.gutterTip = window.siyuan.languages.gutterTip.replace("⌥→", updateHotkeyAfterTip(window.siyuan.config.keymap.general.enter.custom, "/"))
                .replace(/⌘/g, "Ctrl+").replace(/⌥/g, "Alt+").replace(/⇧/g, "Shift+").replace(/⌃/g, "Ctrl+");
            this.gutterTipBacklink = window.siyuan.languages.gutterTipBacklink.replace("⌥→", updateHotkeyAfterTip(window.siyuan.config.keymap.general.enter.custom, "/"))
                .replace(/⌘/g, "Ctrl+").replace(/⌥/g, "Alt+").replace(/⇧/g, "Shift+").replace(/⌃/g, "Ctrl+");
        }
        this.element = document.createElement("div");
        this.element.className = "protyle-gutters";
        this.element.addEventListener("dragstart", (event: DragEvent & { target: HTMLElement }) => {
            hideTooltip();
            window.siyuan.menus.menu.remove();
            const buttonElement = event.target.parentElement;
            if (buttonElement.dataset.embedId) {
                event.preventDefault();
                return;
            }
            let selectIds: string[] = [];
            let selectElements: Element[] = [];
            let avElement: Element;
            if (buttonElement.dataset.rowId) {
                avElement = Array.from(protyle.wysiwyg.element.querySelectorAll(`.av[data-node-id="${buttonElement.dataset.nodeId}"]`)).find((item: HTMLElement) => {
                    if (!isInEmbedBlock(item) && !isInAVBlock(item)) {
                        return true;
                    }
                });
                if (avElement.querySelector('.block__icon[data-type="av-sort"]')?.classList.contains("block__icon--active")) {
                    const bodyElements = avElement.querySelectorAll(".av__body");
                    if (bodyElements.length === 1) {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                    } else if (["template", "created", "updated"].includes(bodyElements[0].getAttribute("data-dtype"))) {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                    }
                }
                const rowElement = avElement.querySelector(`.av__body${buttonElement.dataset.groupId ? `[data-group-id="${buttonElement.dataset.groupId}"]` : ""} .av__row[data-id="${buttonElement.dataset.rowId}"]`);
                if (!rowElement.classList.contains("av__row--select")) {
                    avElement.querySelectorAll(".av__row--select:not(.av__row--header)").forEach(item => {
                        item.classList.remove("av__row--select");
                        item.querySelector("use").setAttribute("xlink:href", "#iconUncheck");
                    });
                }
                rowElement.classList.add("av__row--select");
                rowElement.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconCheck");
                updateHeader(rowElement as HTMLElement);
                avElement.querySelectorAll(".av__row--select:not(.av__row--header)").forEach(item => {
                    const avBodyElement = hasClosestByClassName(item, "av__body") as HTMLElement;
                    const groupId = (avBodyElement ? avBodyElement.dataset.groupId : "") || "";
                    selectIds.push(item.getAttribute("data-id") + (groupId ? "@" + groupId : ""));
                    selectElements.push(item);
                });
            } else {
                const gutterId = buttonElement.getAttribute("data-node-id");
                selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
                let selectedIncludeGutter = false;
                selectElements.forEach((item => {
                    const itemId = item.getAttribute("data-node-id");
                    if (itemId === gutterId) {
                        selectedIncludeGutter = true;
                    }
                    selectIds.push(itemId);
                }));
                if (!selectedIncludeGutter) {
                    let gutterNodeElement: HTMLElement;
                    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${gutterId}"]`)).find((item: HTMLElement) => {
                        if (!isInEmbedBlock(item) && this.isMatchNode(item)) {
                            gutterNodeElement = item;
                            return true;
                        }
                    });
                    if (gutterNodeElement) {
                        selectElements.forEach((item => {
                            item.classList.remove("protyle-wysiwyg--select");
                        }));
                        gutterNodeElement.classList.add("protyle-wysiwyg--select");
                        selectElements = [gutterNodeElement];
                        selectIds = [gutterId];
                    }
                }
            }

            const ghostElement = document.createElement("div");
            ghostElement.className = protyle.wysiwyg.element.className;
            selectElements.forEach(item => {
                if (item.querySelector("iframe")) {
                    const type = item.getAttribute("data-type");
                    const embedElement = genEmptyElement();
                    embedElement.classList.add("protyle-wysiwyg--select");
                    getContenteditableElement(embedElement).innerHTML = `<svg class="svg"><use xlink:href="${buttonElement.querySelector("use").getAttribute("xlink:href")}"></use></svg> ${getLangByType(type)}`;
                    ghostElement.append(embedElement);
                } else {
                    ghostElement.append(processClonePHElement(item.cloneNode(true) as Element));
                }
            });
            ghostElement.setAttribute("style", `position:fixed;opacity:.1;width:${selectElements[0].clientWidth}px;padding:0;`);
            document.body.append(ghostElement);
            // 普通块（段落/标题/列表块/引用块等）拖拽时隐藏原生 ghost 并改用自定义双区跟随框；AV 行保留原生 ghost
            const isBlockDrag = !buttonElement.dataset.rowId;
            if (isBlockDrag && !window.siyuan.touchDragActive) {
                const transparentImg = new Image();
                transparentImg.src = transparentImgSrc;
                event.dataTransfer.setDragImage(transparentImg, 0, 0);
                setTimeout(() => {
                    ghostElement.remove();
                });
            } else {
                event.dataTransfer.setDragImage(ghostElement, 0, 0);
                if (window.siyuan.touchDragActive) {
                    window.siyuan.touchDragGhost = ghostElement;
                } else {
                    setTimeout(() => {
                        ghostElement.remove();
                    });
                }
            }
            if (isBlockDrag) {
                const text = getContenteditableElement(selectElements[0] as HTMLElement)?.textContent?.trim() || "";
                // 数据库块若无标题，优先用当前视图名，最后兜底为"数据库"
                let title = text;
                if (!title && buttonElement.getAttribute("data-type") === "NodeAttributeView") {
                    title = (selectElements[0] as HTMLElement)?.querySelector(".av__views .item--focus")?.textContent?.trim() ||
                        window.siyuan.languages.database;
                }
                window.siyuan.dragTitle = title;
            }
            buttonElement.style.opacity = "0.38";
            window.siyuan.dragElement = avElement as HTMLElement || protyle.wysiwyg.element;
            event.dataTransfer.setData(`${Constants.SIYUAN_DROP_GUTTER}${buttonElement.getAttribute("data-type")}${Constants.ZWSP}${buttonElement.getAttribute("data-subtype")}${Constants.ZWSP}${selectIds}${Constants.ZWSP}${window.siyuan.config.system.workspaceDir}`,
                protyle.wysiwyg.element.innerHTML);
        });
        this.element.addEventListener("dragend", () => {
            this.element.querySelectorAll("button").forEach((item) => {
                item.style.opacity = "";
            });
            window.siyuan.dragElement = undefined;
            window.siyuan.dragTitle = "";
        });
        this.element.addEventListener("click", (event: MouseEvent & { target: HTMLInputElement }) => {
            const buttonElement = hasClosestByTag(event.target, "BUTTON");
            if (!buttonElement) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            hideTooltip();
            clearSelect(["cell", "img"], protyle.wysiwyg.element);
            // 框线点击：若鼠标在块标范围内（框线::before 截获了块标点击），转发为块标菜单；否则无操作
            if (buttonElement.classList.contains("protyle-gutters__line")) {
                if (activeBlockButton && !protyle.disabled) {
                    const br = activeBlockButton.getBoundingClientRect();
                    if (event.clientX >= br.left && event.clientX <= br.right &&
                        event.clientY >= br.top && event.clientY <= br.bottom) {
                        this.renderMenu(protyle, activeBlockButton as HTMLElement);
                        if (!protyle.toolbar.range) {
                            protyle.toolbar.range = getEditorRange(
                                this.getNodeElement(protyle, activeBlockButton) || protyle.wysiwyg.element.firstElementChild);
                        }
                        /// #if !MOBILE
                        window.siyuan.menus.menu.popup({x: br.left, y: br.bottom, isLeft: true});
                        focusByRange(protyle.toolbar.range);
                        /// #endif
                    }
                }
                return;
            }
            const id = buttonElement.getAttribute("data-node-id");
            if (!id) {
                if (buttonElement.getAttribute("disabled")) {
                    return;
                }
                buttonElement.setAttribute("disabled", "disabled");
                const blockButtonElement = buttonElement.previousElementSibling || buttonElement.nextElementSibling;
                const foldElement = this.getNodeElement(protyle, blockButtonElement);
                if (!foldElement) {
                    return;
                }
                if (event.altKey) {
                    // 折叠所有子集
                    let hasFold = true;
                    Array.from(foldElement.children).find((ulElement) => {
                        if (ulElement.classList.contains("list")) {
                            const foldElement = Array.from(ulElement.children).find((listItemElement) => {
                                if (listItemElement.classList.contains("li")) {
                                    if (listItemElement.getAttribute("fold") !== "1" && listItemElement.childElementCount > 3) {
                                        hasFold = false;
                                        return true;
                                    }
                                }
                            });
                            if (foldElement) {
                                return true;
                            }
                        }
                    });
                    const doOperations: IOperation[] = [];
                    const undoOperations: IOperation[] = [];
                    Array.from(foldElement.children).forEach((ulElement) => {
                        if (ulElement.classList.contains("list")) {
                            Array.from(ulElement.children).forEach((listItemElement) => {
                                if (listItemElement.classList.contains("li")) {
                                    if (hasFold) {
                                        listItemElement.removeAttribute("fold");
                                    } else if (listItemElement.childElementCount > 3) {
                                        listItemElement.setAttribute("fold", "1");
                                    }
                                    const listId = listItemElement.getAttribute("data-node-id");
                                    doOperations.push({
                                        action: "setAttrs",
                                        id: listId,
                                        data: JSON.stringify({fold: hasFold ? "" : "1"})
                                    });
                                    undoOperations.push({
                                        action: "setAttrs",
                                        id: listId,
                                        data: JSON.stringify({fold: hasFold ? "1" : ""})
                                    });
                                }
                            });
                        }
                    });
                    transaction(protyle, doOperations, undoOperations);
                    buttonElement.removeAttribute("disabled");
                } else {
                    const foldStatus = setFold(protyle, foldElement).fold;
                    if (foldStatus === 1) {
                        (buttonElement.firstElementChild as HTMLElement).style.transform = "";
                    } else if (foldStatus === 0) {
                        (buttonElement.firstElementChild as HTMLElement).style.transform = "rotate(90deg)";
                    }
                }
                hideElements(["select"], protyle);
                window.siyuan.menus.menu.remove();
                return;
            }
            const gutterRect = buttonElement.getBoundingClientRect();
            if (buttonElement.dataset.type === "gutterPlusBefore" || buttonElement.dataset.type === "gutterPlusAfter") {
                // 块标边缘+号：在对应块上方/下方插入新块，复用 insertEmptyBlock（列表项自动生成新列表项）
                if (protyle.disabled || !id) {
                    return;
                }
                hideElements(["gutter"], protyle);
                countBlockWord([], protyle.block.rootID);
                insertEmptyBlock(protyle, buttonElement.dataset.type === "gutterPlusBefore" ? "beforebegin" : "afterend", id);
                return;
            }
            if (buttonElement.dataset.type === "NodeAttributeViewRowMenu" || buttonElement.dataset.type === "NodeAttributeViewRow") {
                const rowElement = Array.from(protyle.wysiwyg.element.querySelectorAll(`.av[data-node-id="${buttonElement.dataset.nodeId}"] .av__row[data-id="${buttonElement.dataset.rowId}"]`)).find((item: HTMLElement) => {
                    if (!isInEmbedBlock(item)) {
                        return true;
                    }
                });
                if (!rowElement) {
                    return;
                }
                const blockElement = hasClosestBlock(rowElement);
                if (!blockElement) {
                    return;
                }
                if (buttonElement.dataset.type === "NodeAttributeViewRow") {
                    const avID = blockElement.getAttribute("data-av-id");
                    const srcIDs = [Lute.NewNodeID()];
                    const previousID = event.altKey ? (rowElement.previousElementSibling.getAttribute("data-id") || "") : buttonElement.dataset.rowId;
                    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
                    const groupID = rowElement.parentElement.getAttribute("data-group-id");
                    transaction(protyle, [{
                        action: "insertAttrViewBlock",
                        avID,
                        previousID,
                        srcs: [{
                            itemID: Lute.NewNodeID(),
                            id: srcIDs[0],
                            isDetached: true,
                            content: ""
                        }],
                        blockID: id,
                        groupID,
                    }, {
                        action: "doUpdateUpdated",
                        id,
                        data: newUpdated,
                    }], [{
                        action: "removeAttrViewBlock",
                        srcIDs,
                        avID,
                    }, {
                        action: "doUpdateUpdated",
                        id,
                        data: blockElement.getAttribute("updated")
                    }]);
                    insertAttrViewBlockAnimation({protyle, blockElement, srcIDs, previousId: previousID, groupID});
                    if (event.altKey) {
                        this.element.querySelectorAll("button").forEach(item => {
                            item.dataset.rowId = srcIDs[0];
                        });
                    }
                    blockElement.setAttribute("updated", newUpdated);
                } else {
                    if (!protyle.disabled && event.shiftKey) {
                        const blockId = rowElement.querySelector('[data-dtype="block"] .av__celltext--ref')?.getAttribute("data-id");
                        if (blockId) {
                            fetchPost("/api/attr/getBlockAttrs", {id: blockId}, (response) => {
                                openFileAttr(response.data, "av", protyle);
                            });
                            return;
                        }
                    }
                    avContextmenu(protyle, rowElement as HTMLElement, {
                        x: gutterRect.left,
                        y: gutterRect.bottom,
                        w: gutterRect.width,
                        h: gutterRect.height,
                        isLeft: true
                    });
                }
                return;
            }
            if (isOnlyMeta(event)) {
                if (protyle.options.backlinkData) {
                    checkFold(id, (zoomIn, action) => {
                        openFileById({
                            app: protyle.app,
                            id,
                            action,
                            zoomIn
                        });
                    });
                } else {
                    zoomOut({protyle, id});
                }
            } else if (event.altKey) {
                const foldElement = this.getNodeElement(protyle, buttonElement);
                if (!foldElement) {
                    return;
                }
                if (buttonElement.getAttribute("data-type") === "NodeListItem" && foldElement.parentElement.getAttribute("data-node-id")) {
                    // 折叠同级
                    let hasFold = true;
                    Array.from(foldElement.parentElement.children).find((listItemElement) => {
                        if (listItemElement.classList.contains("li")) {
                            if (listItemElement.getAttribute("fold") !== "1" && listItemElement.childElementCount > 3) {
                                hasFold = false;
                                return true;
                            }
                        }
                    });
                    const arrowElement = buttonElement.parentElement.querySelector("[data-type='fold'] > svg") as HTMLElement;
                    if (arrowElement) {
                        arrowElement.style.transform = hasFold ? "rotate(90deg)" : "";
                    }
                    const doOperations: IOperation[] = [];
                    const undoOperations: IOperation[] = [];
                    Array.from(foldElement.parentElement.children).find((listItemElement) => {
                        if (listItemElement.classList.contains("li")) {
                            if (hasFold) {
                                listItemElement.removeAttribute("fold");
                            } else if (listItemElement.childElementCount > 3) {
                                listItemElement.setAttribute("fold", "1");
                            }
                            const listId = listItemElement.getAttribute("data-node-id");
                            doOperations.push({
                                action: "setAttrs",
                                id: listId,
                                data: JSON.stringify({fold: hasFold ? "" : "1"})
                            });
                            undoOperations.push({
                                action: "setAttrs",
                                id: listId,
                                data: JSON.stringify({fold: hasFold ? "1" : ""})
                            });
                        }
                    });
                    transaction(protyle, doOperations, undoOperations);
                } else {
                    const hasFold = setFold(protyle, foldElement).fold;
                    const foldArrowElement = buttonElement.parentElement.querySelector("[data-type='fold'] > svg") as HTMLElement;
                    if (hasFold !== -1 && foldArrowElement) {
                        foldArrowElement.style.transform = hasFold === 0 ? "rotate(90deg)" : "";
                    }
                }
                foldElement.classList.remove("protyle-wysiwyg--hl");
            } else if (event.shiftKey && !protyle.disabled && !isEncryptedBox(protyle.notebookId)) {
                // 不使用 window.siyuan.shiftIsPressed ，否则窗口未激活时按 Shift 点击块标无法打开属性面板 https://github.com/siyuan-note/siyuan/issues/15075
                openAttr(this.getNodeElement(protyle, buttonElement), "bookmark", protyle);
            } else if (!window.siyuan.ctrlIsPressed && !window.siyuan.altIsPressed && !window.siyuan.shiftIsPressed) {
                this.renderMenu(protyle, buttonElement);
                // https://ld246.com/article/1648433751993
                if (!protyle.toolbar.range) {
                    protyle.toolbar.range = getEditorRange(
                        this.getNodeElement(protyle, buttonElement) || protyle.wysiwyg.element.firstElementChild);
                }
                /// #if MOBILE
                window.siyuan.menus.menu.fullscreen();
                /// #else
                window.siyuan.menus.menu.popup({x: gutterRect.left, y: gutterRect.bottom, isLeft: true});
                const popoverElement = hasTopClosestByClassName(protyle.element, "block__popover", true);
                window.siyuan.menus.menu.element.setAttribute("data-from", popoverElement ? popoverElement.dataset.level + "popover" : "app");
                focusByRange(protyle.toolbar.range);
                /// #endif
            }
        });
        this.element.addEventListener("contextmenu", (event: MouseEvent & { target: HTMLInputElement }) => {
            const buttonElement = hasClosestByTag(event.target, "BUTTON");
            if (!buttonElement || buttonElement.getAttribute("data-type") === "fold") {
                return;
            }
            if (!window.siyuan.ctrlIsPressed && !window.siyuan.altIsPressed && !window.siyuan.shiftIsPressed) {
                hideTooltip();
                clearSelect(["cell", "img"], protyle.wysiwyg.element);
                const gutterRect = buttonElement.getBoundingClientRect();
                if (buttonElement.dataset.type === "NodeAttributeViewRowMenu") {
                    const rowElement = Array.from(protyle.wysiwyg.element.querySelectorAll(`.av[data-node-id="${buttonElement.dataset.nodeId}"] .av__row[data-id="${buttonElement.dataset.rowId}"]`)).find((item: HTMLElement) => {
                        if (!isInEmbedBlock(item)) {
                            return true;
                        }
                    });
                    if (rowElement) {
                        avContextmenu(protyle, rowElement as HTMLElement, {
                            x: gutterRect.left,
                            y: gutterRect.bottom,
                            w: gutterRect.width,
                            h: gutterRect.height,
                            isLeft: true
                        });
                    }
                } else if (buttonElement.dataset.type !== "NodeAttributeViewRow") {
                    this.renderMenu(protyle, buttonElement);
                    if (!protyle.toolbar.range) {
                        protyle.toolbar.range = getEditorRange(
                            this.getNodeElement(protyle, buttonElement) ||
                            protyle.wysiwyg.element.firstElementChild);
                    }
                    /// #if MOBILE
                    window.siyuan.menus.menu.fullscreen();
                    /// #else
                    window.siyuan.menus.menu.popup({x: gutterRect.left, y: gutterRect.bottom, isLeft: true});
                    const popoverElement = hasTopClosestByClassName(protyle.element, "block__popover", true);
                    window.siyuan.menus.menu.element.setAttribute("data-from", popoverElement ? popoverElement.dataset.level + "popover" : "app");
                    focusByRange(protyle.toolbar.range);
                    /// #endif
                }
            }
            event.preventDefault();
            event.stopPropagation();
        });
        // 延迟隐藏计时器，鼠标在块标/框线/+号之间移动时提供缓冲，避免中途 mouseleave 误隐藏
        let hidePlusTimeout: number;
        // 当前悬浮的块标 button，供情况A 坐标判断（鼠标在块标内不误触发+号）
        let activeBlockButton: Element;
        const hideInsert = () => {
            activeBlockButton = undefined;
            this.element.querySelectorAll(".protyle-gutters__line, .protyle-gutters__plus").forEach(item => {
                (item as HTMLElement).style.display = "none";
            });
        };
        this.element.addEventListener("mouseleave", (event: MouseEvent & { target: HTMLInputElement }) => {
            // 鼠标移向框线或+号时不隐藏（它们定位在容器外侧，移出容器几何范围会触发 mouseleave）
            const related = event.relatedTarget as HTMLElement;
            if (related && (related.classList.contains("protyle-gutters__line") || related.classList.contains("protyle-gutters__plus"))) {
                return;
            }
            // 块高亮立即移除，保持原有反馈；框线/+号延迟隐藏，避免移向它们途中误隐藏
            Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl, .av__row--hl")).forEach(item => {
                item.classList.remove("protyle-wysiwyg--hl", "av__row--hl");
            });
            window.clearTimeout(hidePlusTimeout);
            hidePlusTimeout = window.setTimeout(hideInsert, 200);
            event.preventDefault();
            event.stopPropagation();
        });
        // 双元素交互：悬浮块标显示框线（贴边不动），悬浮框线显示+号（独立元素外偏定位）
        this.element.addEventListener("mousemove", (event: MouseEvent & { target: HTMLElement }) => {
            const lineBefore = this.element.querySelector('.protyle-gutters__line[data-type="gutterLineBefore"]') as HTMLElement;
            const lineAfter = this.element.querySelector('.protyle-gutters__line[data-type="gutterLineAfter"]') as HTMLElement;
            const plusBefore = this.element.querySelector('.protyle-gutters__plus[data-type="gutterPlusBefore"]') as HTMLElement;
            const plusAfter = this.element.querySelector('.protyle-gutters__plus[data-type="gutterPlusAfter"]') as HTMLElement;
            if (protyle.disabled || !lineBefore || !lineAfter || !plusBefore || !plusAfter) {
                return;
            }
            // 情况A：鼠标在框线或+号上 → 显示对应+号，框线设透明（视觉隐藏但保留命中区，避免 display:none 导致脱离触发重置闪烁）
            const lineEl = hasClosestByClassName(event.target, "protyle-gutters__line");
            const plusEl = hasClosestByClassName(event.target, "protyle-gutters__plus");
            const hoverEl = lineEl || plusEl;
            if (hoverEl) {
                window.clearTimeout(hidePlusTimeout);
                // 鼠标若仍在块标 button 几何范围内，视为块标 hover，不触发+号
                // 避免框线::before 扩展区侵入块标导致误把点击块标弹菜单变成插入块
                if (activeBlockButton) {
                    const br = activeBlockButton.getBoundingClientRect();
                    if (event.clientX >= br.left && event.clientX <= br.right &&
                        event.clientY >= br.top && event.clientY <= br.bottom) {
                        return;
                    }
                }
                const isBefore = hoverEl.getAttribute("data-type").includes("Before");
                plusBefore.style.display = isBefore ? "" : "none";
                plusAfter.style.display = isBefore ? "none" : "";
                // 框线视觉隐藏（opacity:0），但 display 保持以维持命中区
                lineBefore.style.opacity = "0";
                lineAfter.style.opacity = "0";
                return;
            }
            const buttonElement = hasClosestByTag(event.target, "BUTTON");
            if (!buttonElement || buttonElement.classList.contains("protyle-gutters__line") || buttonElement.classList.contains("protyle-gutters__plus")) {
                return;
            }
            const type = buttonElement.getAttribute("data-type");
            const id = buttonElement.getAttribute("data-node-id");
            // 情况C：非有效块标（折叠箭头、数据库行等）→ 隐藏框线与+号
            if (type === "fold" || type === "NodeAttributeViewRow" || type === "NodeAttributeViewRowMenu" || !id) {
                hideInsert();
                return;
            }
            // 情况B：悬浮有效块标 → 显示框线（贴边），并预设+号位置（隐藏）
            plusBefore.dataset.nodeId = id;
            plusAfter.dataset.nodeId = id;
            activeBlockButton = buttonElement;
            const rect = buttonElement.getBoundingClientRect();
            const compressed = this.element.style.width === "24px";
            // 竖排时不显示+号提示（清空 aria-label 避免触发 tooltip），横排时恢复
            plusBefore.setAttribute("aria-label", compressed ? "" : window.siyuan.languages.insertBefore);
            plusAfter.setAttribute("aria-label", compressed ? "" : window.siyuan.languages.insertAfter);
            plusBefore.style.display = "none";
            plusAfter.style.display = "none";
            if (compressed) {
                // 竖排：压缩模式块标贴编辑区左缘，左侧紧邻 .layout__resize--lr 分栏拖拽条（z-index 4）
                // 若 lineBefore/plusBefore 按横排逻辑外延到块标左侧，鼠标移入该区会被分栏拖拽条抢占悬浮，
                // 导致加号无法触发。故竖排时上方/下方插入指示均置于块标右侧，上下以纵向位置区分：
                // 上方插入指示贴图标右缘上半段，下方插入指示贴图标右缘下半段，完全避开左侧拖拽条命中区。
                const iconRect = buttonElement.querySelector("svg").getBoundingClientRect();
                const centerY = iconRect.top + iconRect.height / 2;
                const lineH = Math.max(8, iconRect.height / 2 - 1);
                const plusSize = 16;
                // 线条/加号需落在 button rect（rect.right）外，否则 case A 会判定鼠标仍在块标内而不触发加号
                const rightX = rect.right + 1;
                // 上方插入：块标右侧上半段
                lineBefore.style.display = "";
                lineBefore.style.opacity = "1";
                lineBefore.style.width = "2px";
                lineBefore.style.height = `${lineH}px`;
                lineBefore.style.left = `${rightX}px`;
                lineBefore.style.top = `${iconRect.top - 1}px`;
                // 下方插入：块标右侧下半段
                lineAfter.style.display = "";
                lineAfter.style.opacity = "1";
                lineAfter.style.width = "2px";
                lineAfter.style.height = `${lineH}px`;
                lineAfter.style.left = `${rightX}px`;
                lineAfter.style.top = `${centerY + 1}px`;
                // +号位于右侧线条外偏，上下分开避免重叠
                plusBefore.style.width = `${plusSize}px`;
                plusBefore.style.height = `${plusSize}px`;
                plusBefore.style.left = `${rightX + 4}px`;
                plusBefore.style.top = `${iconRect.top + lineH / 2 - plusSize / 2}px`;
                plusAfter.style.width = `${plusSize}px`;
                plusAfter.style.height = `${plusSize}px`;
                plusAfter.style.left = `${rightX + 4}px`;
                plusAfter.style.top = `${centerY + 1 + lineH / 2 - plusSize / 2}px`;
                // 竖排时隐藏块标提示，避免其遮挡右侧框线与+号
                hideTooltip();
            } else {
                // 横排：框线贴块标上下边缘，+号定位在外偏位置
                const lineW = 10;
                const left = rect.left + (rect.width - lineW) / 2;
                const plusSize = 16;
                const plusLeft = rect.left + (rect.width - plusSize) / 2;
                lineBefore.style.display = "";
                lineBefore.style.opacity = "1";
                lineBefore.style.width = `${lineW}px`;
                lineBefore.style.height = "2px";
                lineBefore.style.left = `${left}px`;
                lineBefore.style.top = `${rect.top - 4}px`;
                lineAfter.style.display = "";
                lineAfter.style.opacity = "1";
                lineAfter.style.width = `${lineW}px`;
                lineAfter.style.height = "2px";
                lineAfter.style.left = `${left}px`;
                lineAfter.style.top = `${rect.bottom + 2}px`;
                plusBefore.style.width = `${plusSize}px`;
                plusBefore.style.height = `${plusSize}px`;
                plusBefore.style.left = `${plusLeft}px`;
                plusBefore.style.top = `${rect.top - 5 - plusSize / 2 + 1}px`;
                plusAfter.style.width = `${plusSize}px`;
                plusAfter.style.height = `${plusSize}px`;
                plusAfter.style.left = `${plusLeft}px`;
                plusAfter.style.top = `${rect.bottom + 3 - plusSize / 2 + 1}px`;
            }
            window.clearTimeout(hidePlusTimeout);
        });
        // https://github.com/siyuan-note/siyuan/issues/12751
        this.element.addEventListener("mousewheel", (event) => {
            hideElements(["gutter"], protyle);
            event.stopPropagation();
        }, {passive: true});
    }

    public isMatchNode(item: Element) {
        const itemRect = item.getBoundingClientRect();
        // 原本为4，由于 https://github.com/siyuan-note/siyuan/issues/12166 改为 6
        let gutterTop = this.element.getBoundingClientRect().top + 6;
        if (itemRect.height < Math.floor(window.siyuan.config.editor.fontSize * 1.625) + 8) {
            gutterTop = gutterTop - (itemRect.height - this.element.clientHeight) / 2;
        }
        return itemRect.top <= gutterTop && itemRect.bottom >= gutterTop;
    }

    private turnsOneInto(options: {
        menuId?: string,
        id: string,
        icon: string,
        label: string,
        protyle: IProtyle,
        nodeElement: Element,
        accelerator?: string
        type: string,
        level?: number
    }) {
        return {
            id: options.menuId,
            icon: options.icon,
            label: options.label,
            accelerator: options.accelerator,
            click() {
                turnsOneInto(options);
            }
        };
    }

    private turnsIntoOne(options: {
        menuId?: string,
        accelerator?: string,
        icon?: string,
        label: string,
        protyle: IProtyle,
        selectsElement: Element[],
        type: TTurnIntoOne,
        level?: TTurnIntoOneSub,
    }) {
        return {
            id: options.menuId,
            icon: options.icon,
            label: options.label,
            accelerator: options.accelerator,
            click() {
                turnsIntoOneTransaction(options);
            }
        };
    }

    private turnsInto(options: {
        menuId?: string,
        icon?: string,
        label: string,
        protyle: IProtyle,
        selectsElement: Element[],
        type: TTurnInto,
        level?: number,
        isContinue?: boolean,
        accelerator?: string,
    }) {
        return {
            id: options.menuId,
            icon: options.icon,
            label: options.label,
            accelerator: options.accelerator,
            click() {
                turnsIntoTransaction(options);
            }
        };
    }

    private showMobileAppearance(protyle: IProtyle) {
        const toolbarElement = document.getElementById("keyboardToolbar");
        const dynamicElements = toolbarElement.querySelectorAll("#keyboardToolbar .keyboard__dynamic");
        dynamicElements[0].classList.add("fn__none");
        dynamicElements[1].classList.remove("fn__none");
        toolbarElement.querySelector('.keyboard__action[data-type="text"]').classList.add("protyle-toolbar__item--current");
        toolbarElement.querySelector('.keyboard__action[data-type="done"] use').setAttribute("xlink:href", "#iconCloseRound");
        toolbarElement.classList.remove("fn__none");
        const oldScrollTop = protyle.contentElement.scrollTop + 333.5;  // toolbarElement.clientHeight
        renderTextMenu(protyle, toolbarElement);
        showKeyboardToolbarUtil(oldScrollTop);
    }

    public renderMultipleMenu(protyle: IProtyle, selectsElement: Element[]) {
        let isList = false;
        let isContinue = false;
        selectsElement.find((item, index) => {
            if (item.classList.contains("li")) {
                isList = true;
                return true;
            }
            if (item.nextElementSibling && selectsElement[index + 1] &&
                item.nextElementSibling === selectsElement[index + 1]) {
                isContinue = true;
            } else if (index !== selectsElement.length - 1) {
                isContinue = false;
                return true;
            }
        });
        if (!isList && !protyle.disabled) {
            const turnIntoSubmenu: IMenu[] = [];
            if (isContinue) {
                turnIntoSubmenu.push(this.turnsIntoOne({
                    menuId: "list",
                    icon: "iconList",
                    label: window.siyuan.languages.list,
                    protyle,
                    accelerator: window.siyuan.config.keymap.editor.insert.list.custom,
                    selectsElement,
                    type: "Blocks2ULs"
                }));
                turnIntoSubmenu.push(this.turnsIntoOne({
                    menuId: "orderedList",
                    icon: "iconOrderedList",
                    label: window.siyuan.languages["ordered-list"],
                    accelerator: window.siyuan.config.keymap.editor.insert["ordered-list"].custom,
                    protyle,
                    selectsElement,
                    type: "Blocks2OLs"
                }));
                turnIntoSubmenu.push(this.turnsIntoOne({
                    menuId: "check",
                    icon: "iconCheck",
                    label: window.siyuan.languages.check,
                    accelerator: window.siyuan.config.keymap.editor.insert.check.custom,
                    protyle,
                    selectsElement,
                    type: "Blocks2TLs"
                }));
                turnIntoSubmenu.push(this.turnsIntoOne({
                    menuId: "quote",
                    icon: "iconQuote",
                    label: window.siyuan.languages.quote,
                    accelerator: window.siyuan.config.keymap.editor.insert.quote.custom,
                    protyle,
                    selectsElement,
                    type: "Blocks2Blockquote"
                }));
                turnIntoSubmenu.push(this.turnsIntoOne({
                    menuId: "callout",
                    icon: "iconCallout",
                    label: window.siyuan.languages.callout,
                    protyle,
                    selectsElement,
                    type: "Blocks2Callout"
                }));
            }
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "paragraph",
                icon: "iconParagraph",
                label: window.siyuan.languages.paragraph,
                accelerator: window.siyuan.config.keymap.editor.heading.paragraph.custom,
                protyle,
                selectsElement,
                type: "Blocks2Ps",
                isContinue
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading1",
                icon: "iconH1",
                label: window.siyuan.languages.heading1,
                accelerator: window.siyuan.config.keymap.editor.heading.heading1.custom,
                protyle,
                selectsElement,
                level: 1,
                type: "Blocks2Hs",
                isContinue
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading2",
                icon: "iconH2",
                label: window.siyuan.languages.heading2,
                accelerator: window.siyuan.config.keymap.editor.heading.heading2.custom,
                protyle,
                selectsElement,
                level: 2,
                type: "Blocks2Hs",
                isContinue
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading3",
                icon: "iconH3",
                label: window.siyuan.languages.heading3,
                accelerator: window.siyuan.config.keymap.editor.heading.heading3.custom,
                protyle,
                selectsElement,
                level: 3,
                type: "Blocks2Hs",
                isContinue
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading4",
                icon: "iconH4",
                label: window.siyuan.languages.heading4,
                accelerator: window.siyuan.config.keymap.editor.heading.heading4.custom,
                protyle,
                selectsElement,
                level: 4,
                type: "Blocks2Hs",
                isContinue
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading5",
                icon: "iconH5",
                label: window.siyuan.languages.heading5,
                accelerator: window.siyuan.config.keymap.editor.heading.heading5.custom,
                protyle,
                selectsElement,
                level: 5,
                type: "Blocks2Hs",
                isContinue
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading6",
                icon: "iconH6",
                label: window.siyuan.languages.heading6,
                accelerator: window.siyuan.config.keymap.editor.heading.heading6.custom,
                protyle,
                selectsElement,
                level: 6,
                type: "Blocks2Hs",
                isContinue
            }));
            window.siyuan.menus.menu.append(new MenuItem({
                id: "turnInto",
                icon: "iconTurnInto",
                label: window.siyuan.languages.turnInto,
                type: "submenu",
                submenu: turnIntoSubmenu
            }).element);
            if (isContinue && !(selectsElement[0].parentElement.classList.contains("sb") &&
                selectsElement.length + 1 === selectsElement[0].parentElement.childElementCount)) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "mergeSuperBlock",
                    icon: "iconSuper",
                    label: window.siyuan.languages.merge + " " + window.siyuan.languages.superBlock,
                    type: "submenu",
                    submenu: [this.turnsIntoOne({
                        menuId: "hLayout",
                        label: window.siyuan.languages.hLayout,
                        accelerator: window.siyuan.config.keymap.editor.general.hLayout.custom,
                        icon: "iconSplitLR",
                        protyle,
                        selectsElement,
                        type: "BlocksMergeSuperBlock",
                        level: "col"
                    }), this.turnsIntoOne({
                        menuId: "vLayout",
                        label: window.siyuan.languages.vLayout,
                        accelerator: window.siyuan.config.keymap.editor.general.vLayout.custom,
                        icon: "iconSplitTB",
                        protyle,
                        selectsElement,
                        type: "BlocksMergeSuperBlock",
                        level: "row"
                    })]
                }).element);
            }
        }
        if (!protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "ai",
                icon: "iconSparkles",
                label: window.siyuan.languages.aiEdit,
                accelerator: window.siyuan.config.keymap.editor.general.ai.custom,
                click() {
                    AIActions(selectsElement, protyle);
                }
            }).element);
        }
        const copyMenu: IMenu[] = (copySubMenu(Array.from(selectsElement).map(item => item.getAttribute("data-node-id")), true, selectsElement[0]) as IMenu[]).concat([{
            id: "copyPlainText",
            iconHTML: "",
            label: window.siyuan.languages.copyPlainText,
            accelerator: window.siyuan.config.keymap.editor.general.copyPlainText.custom,
            click() {
                let html = "";
                selectsElement.forEach((item: HTMLElement) => {
                    html += getPlainText(item) + "\n";
                });
                copyPlainText(html.trimEnd());
                focusBlock(selectsElement[0]);
            }
        }, {
            id: "copy",
            iconHTML: "",
            label: window.siyuan.languages.copy,
            accelerator: "⌘C",
            click() {
                if (isNotEditBlock(selectsElement[0])) {
                    focusBlock(selectsElement[0]);
                } else {
                    focusByRange(getEditorRange(selectsElement[0]));
                }
                document.execCommand("copy");
            }
        }]);
        const copyTextRefMenu = this.genCopyTextRef(selectsElement);
        if (copyTextRefMenu) {
            copyMenu.splice(7, 0, copyTextRefMenu);
        }
        if (!protyle.disabled) {
            copyMenu.push({
                id: "duplicate",
                iconHTML: "",
                label: window.siyuan.languages.duplicate,
                accelerator: window.siyuan.config.keymap.editor.general.duplicate.custom,
                click() {
                    duplicateBlock(selectsElement, protyle);
                }
            });
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "copy",
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
            type: "submenu",
            submenu: copyMenu,
        }).element);
        if (!protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "cut",
                label: window.siyuan.languages.cut,
                accelerator: "⌘X",
                icon: "iconCut",
                click: () => {
                    focusBlock(selectsElement[0]);
                    document.execCommand("cut");
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "move",
                label: window.siyuan.languages.move,
                accelerator: window.siyuan.config.keymap.general.move.custom,
                icon: "iconMove",
                click: () => {
                    movePathTo({
                        cb: (toPath) => {
                            hintMoveBlock(toPath[0], selectsElement, protyle);
                        },
                        flashcard: false
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "addToDatabase",
                label: window.siyuan.languages.addToDatabase,
                accelerator: window.siyuan.config.keymap.general.addToDatabase.custom,
                icon: "iconDatabase",
                click: () => {
                    addEditorToDatabase(protyle, getEditorRange(selectsElement[0]));
                }
            }).element);
            /// #if !MOBILE
            // 加密笔记本中的块不暴露该菜单：避免把受保护内容引入智能体会话。
            if (!isEncryptedBox(protyle.notebookId)) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "addToAgent",
                    icon: "iconSend",
                    label: window.siyuan.languages.addToAgent,
                    click: () => {
                        addBlockToAgent(Array.from(selectsElement).map(item => item.getAttribute("data-node-id")));
                    }
                }).element);
            }
            /// #endif
            window.siyuan.menus.menu.append(new MenuItem({
                id: "delete",
                label: window.siyuan.languages.delete,
                icon: "iconTrashcan",
                accelerator: "⌫",
                click: () => {
                    protyle.breadcrumb?.hide();
                    removeBlock(protyle, selectsElement[0], getEditorRange(selectsElement[0]), "Backspace");
                }
            }).element);

            window.siyuan.menus.menu.append(new MenuItem({id: "separator_appearance", type: "separator"}).element);
            const appearanceElement = new MenuItem({
                id: "appearance",
                label: window.siyuan.languages.appearance,
                icon: "iconFont",
                accelerator: window.siyuan.config.keymap.editor.insert.appearance.custom,
                click: () => {
                    /// #if MOBILE
                    this.showMobileAppearance(protyle);
                    /// #else
                    protyle.toolbar.element.classList.add("fn__none");
                    protyle.toolbar.subElement.innerHTML = "";
                    protyle.toolbar.subElement.style.width = "";
                    protyle.toolbar.subElement.style.padding = "";
                    protyle.toolbar.subElement.append(appearanceMenu(protyle, selectsElement));
                    protyle.toolbar.subElement.style.zIndex = (++window.siyuan.zIndex).toString();
                    protyle.toolbar.subElement.classList.remove("fn__none");
                    protyle.toolbar.subElementCloseCB = undefined;
                    const position = selectsElement[0].getBoundingClientRect();
                    setPosition(protyle.toolbar.subElement, position.left, position.top);
                    /// #endif
                }
            }).element;
            window.siyuan.menus.menu.append(appearanceElement);
            if (!isMobile()) {
                appearanceElement.lastElementChild.classList.add("b3-menu__submenu--row");
            }
            this.genAlign(selectsElement, protyle);
            this.genWidths(selectsElement, protyle);
            // this.genHeights(selectsElement, protyle);
        }
        if (!window.siyuan.config.readonly && !isEncryptedBox(protyle.notebookId)) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "separator_quickMakeCard",
                type: "separator"
            }).element);
            const allCardsMade = !selectsElement.some(item => !item.hasAttribute(Constants.CUSTOM_RIFF_DECKS) && item.getAttribute("data-type") !== "NodeThematicBreak");
            window.siyuan.menus.menu.append(new MenuItem({
                id: allCardsMade ? "removeCard" : "quickMakeCard",
                label: allCardsMade ? window.siyuan.languages.removeCard : window.siyuan.languages.quickMakeCard,
                accelerator: window.siyuan.config.keymap.editor.general.quickMakeCard.custom,
                icon: "iconRiffCard",
                click() {
                    quickMakeCard(protyle, selectsElement);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "addToDeck",
                label: window.siyuan.languages.addToDeck,
                icon: "iconRiffCard",
                ignore: !window.siyuan.config.flashcard.deck,
                click() {
                    const ids: string[] = [];
                    selectsElement.forEach(item => {
                        if (item.getAttribute("data-type") === "NodeThematicBreak") {
                            return;
                        }
                        ids.push(item.getAttribute("data-node-id"));
                    });
                    makeCard(protyle.app, ids);
                }
            }).element);
        }

        if (protyle?.app?.plugins) {
            emitOpenMenu({
                plugins: protyle.app.plugins,
                type: "click-blockicon",
                detail: {
                    protyle,
                    blockElements: selectsElement,
                },
                separatorPosition: "top",
            });
        }

        return window.siyuan.menus.menu;
    }

    public getNodeElement(protyle: IProtyle, element: Element) {
        if (!element) {
            return;
        }
        if (element.tagName !== "BUTTON") {
            return element;
        }
        const id = element.getAttribute("data-node-id");
        if (!id) {
            return;
        }
        const embedID = (element as HTMLElement).dataset.embedId;
        return Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${id}"]`)).find(item => {
            if (!this.isMatchNode(item)) {
                return false;
            }
            const embedElement = isInEmbedBlock(item, false);
            if (embedID) {
                return embedElement && embedElement.getAttribute("data-node-id") === embedID &&
                    !!getEmbedChildOperationContext(item);
            }
            return !embedElement;
        });
    }

    public renderMenu(protyle: IProtyle, buttonElement: Element) {
        if (!buttonElement) {
            return;
        }
        hideElements(["util", "toolbar", "hint"], protyle);
        window.siyuan.menus.menu.remove();
        if (isMobile()) {
            activeBlur();
        }
        const id = buttonElement.getAttribute("data-node-id");
        const nodeElement = this.getNodeElement(protyle, buttonElement);
        if (!nodeElement) {
            return;
        }
        const embedContext = getEmbedChildOperationContext(nodeElement);
        const selectsElement = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
        if (!embedContext && selectsElement.length > 1) {
            window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_BLOCK_MULTI);
            const match = Array.from(selectsElement).find(item => {
                if (id === item.getAttribute("data-node-id")) {
                    return true;
                }
            });
            if (match) {
                return this.renderMultipleMenu(protyle, Array.from(selectsElement));
            }
        } else {
            window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_BLOCK_SINGLE);
        }

        const isEmbedMenu = !!embedContext;
        // 查询目标容器自身只允许非结构操作，子块可以在目标边界内转换、插入、复制和删除。
        const allowStructuralMutation = !protyle.disabled &&
            (!embedContext || embedContext.targetElement !== nodeElement);
        const isOnlyTargetListItem = embedContext?.targetElement?.getAttribute("data-type") === "NodeList" &&
            nodeElement.getAttribute("data-type") === "NodeListItem" &&
            nodeElement.parentElement === embedContext.targetElement &&
            embedContext.targetElement.querySelectorAll(":scope > [data-type=\"NodeListItem\"]").length === 1;
        const allowRemoval = allowStructuralMutation && !isOnlyTargetListItem;
        const type = nodeElement.getAttribute("data-type");
        const subType = nodeElement.getAttribute("data-subtype");
        const turnIntoSubmenu: IMenu[] = [];
        hideElements(["select"], protyle);
        nodeElement.classList.add("protyle-wysiwyg--select");
        countBlockWord([id], protyle.block.rootID);
        // "heading1-6", "list", "ordered-list", "check", "quote", "code", "table", "line", "math", "paragraph"
        if (type === "NodeParagraph" && allowStructuralMutation) {
            turnIntoSubmenu.push(this.turnsIntoOne({
                menuId: "list",
                icon: "iconList",
                label: window.siyuan.languages.list,
                accelerator: window.siyuan.config.keymap.editor.insert.list.custom,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2ULs"
            }));
            turnIntoSubmenu.push(this.turnsIntoOne({
                menuId: "orderedList",
                icon: "iconOrderedList",
                label: window.siyuan.languages["ordered-list"],
                accelerator: window.siyuan.config.keymap.editor.insert["ordered-list"].custom,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2OLs"
            }));
            turnIntoSubmenu.push(this.turnsIntoOne({
                menuId: "check",
                icon: "iconCheck",
                label: window.siyuan.languages.check,
                accelerator: window.siyuan.config.keymap.editor.insert.check.custom,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2TLs"
            }));
            turnIntoSubmenu.push(this.turnsIntoOne({
                menuId: "quote",
                icon: "iconQuote",
                label: window.siyuan.languages.quote,
                accelerator: window.siyuan.config.keymap.editor.insert.quote.custom,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2Blockquote"
            }));
            turnIntoSubmenu.push(this.turnsIntoOne({
                menuId: "callout",
                icon: "iconCallout",
                label: window.siyuan.languages.callout,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2Callout"
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading1",
                icon: "iconH1",
                label: window.siyuan.languages.heading1,
                accelerator: window.siyuan.config.keymap.editor.heading.heading1.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 1,
                type: "Blocks2Hs",
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading2",
                icon: "iconH2",
                label: window.siyuan.languages.heading2,
                accelerator: window.siyuan.config.keymap.editor.heading.heading2.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 2,
                type: "Blocks2Hs",
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading3",
                icon: "iconH3",
                label: window.siyuan.languages.heading3,
                accelerator: window.siyuan.config.keymap.editor.heading.heading3.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 3,
                type: "Blocks2Hs",
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading4",
                icon: "iconH4",
                label: window.siyuan.languages.heading4,
                accelerator: window.siyuan.config.keymap.editor.heading.heading4.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 4,
                type: "Blocks2Hs",
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading5",
                icon: "iconH5",
                label: window.siyuan.languages.heading5,
                accelerator: window.siyuan.config.keymap.editor.heading.heading5.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 5,
                type: "Blocks2Hs",
            }));
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "heading6",
                icon: "iconH6",
                label: window.siyuan.languages.heading6,
                accelerator: window.siyuan.config.keymap.editor.heading.heading6.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 6,
                type: "Blocks2Hs",
            }));
        } else if (type === "NodeHeading" && allowStructuralMutation) {
            turnIntoSubmenu.push(this.turnsInto({
                menuId: "paragraph",
                icon: "iconParagraph",
                label: window.siyuan.languages.paragraph,
                accelerator: window.siyuan.config.keymap.editor.heading.paragraph.custom,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2Ps",
            }));
            turnIntoSubmenu.push(this.turnsIntoOne({
                menuId: "quote",
                icon: "iconQuote",
                label: window.siyuan.languages.quote,
                accelerator: window.siyuan.config.keymap.editor.insert.quote.custom,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2Blockquote"
            }));
            turnIntoSubmenu.push(this.turnsIntoOne({
                menuId: "callout",
                icon: "iconCallout",
                label: window.siyuan.languages.callout,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2Callout"
            }));
            if (subType !== "h1") {
                turnIntoSubmenu.push(this.turnsInto({
                    menuId: "heading1",
                    icon: "iconH1",
                    label: window.siyuan.languages.heading1,
                    accelerator: window.siyuan.config.keymap.editor.heading.heading1.custom,
                    protyle,
                    selectsElement: [nodeElement],
                    level: 1,
                    type: "Blocks2Hs",
                }));
            }
            if (subType !== "h2") {
                turnIntoSubmenu.push(this.turnsInto({
                    menuId: "heading2",
                    icon: "iconH2",
                    label: window.siyuan.languages.heading2,
                    accelerator: window.siyuan.config.keymap.editor.heading.heading2.custom,
                    protyle,
                    selectsElement: [nodeElement],
                    level: 2,
                    type: "Blocks2Hs",
                }));
            }
            if (subType !== "h3") {
                turnIntoSubmenu.push(this.turnsInto({
                    menuId: "heading3",
                    icon: "iconH3",
                    label: window.siyuan.languages.heading3,
                    accelerator: window.siyuan.config.keymap.editor.heading.heading3.custom,
                    protyle,
                    selectsElement: [nodeElement],
                    level: 3,
                    type: "Blocks2Hs",
                }));
            }
            if (subType !== "h4") {
                turnIntoSubmenu.push(this.turnsInto({
                    menuId: "heading4",
                    icon: "iconH4",
                    label: window.siyuan.languages.heading4,
                    accelerator: window.siyuan.config.keymap.editor.heading.heading4.custom,
                    protyle,
                    selectsElement: [nodeElement],
                    level: 4,
                    type: "Blocks2Hs",
                }));
            }
            if (subType !== "h5") {
                turnIntoSubmenu.push(this.turnsInto({
                    menuId: "heading5",
                    icon: "iconH5",
                    label: window.siyuan.languages.heading5,
                    accelerator: window.siyuan.config.keymap.editor.heading.heading5.custom,
                    protyle,
                    selectsElement: [nodeElement],
                    level: 5,
                    type: "Blocks2Hs",
                }));
            }
            if (subType !== "h6") {
                turnIntoSubmenu.push(this.turnsInto({
                    menuId: "heading6",
                    icon: "iconH6",
                    label: window.siyuan.languages.heading6,
                    accelerator: window.siyuan.config.keymap.editor.heading.heading6.custom,
                    protyle,
                    selectsElement: [nodeElement],
                    level: 6,
                    type: "Blocks2Hs",
                }));
            }
        } else if (type === "NodeList" && allowStructuralMutation) {
            turnIntoSubmenu.push(this.turnsOneInto({
                menuId: "paragraph",
                id,
                icon: "iconParagraph",
                label: window.siyuan.languages.paragraph,
                accelerator: window.siyuan.config.keymap.editor.heading.paragraph.custom,
                protyle,
                nodeElement,
                type: "CancelList"
            }));
            turnIntoSubmenu.push(this.turnsIntoOne({
                menuId: "quote",
                icon: "iconQuote",
                label: window.siyuan.languages.quote,
                accelerator: window.siyuan.config.keymap.editor.insert.quote.custom,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2Blockquote"
            }));
            turnIntoSubmenu.push(this.turnsIntoOne({
                menuId: "callout",
                icon: "iconCallout",
                label: window.siyuan.languages.callout,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2Callout"
            }));
            if (nodeElement.getAttribute("data-subtype") === "o") {
                turnIntoSubmenu.push(this.turnsOneInto({
                    menuId: "list",
                    id,
                    icon: "iconList",
                    label: window.siyuan.languages.list,
                    accelerator: window.siyuan.config.keymap.editor.insert.list.custom,
                    protyle,
                    nodeElement,
                    type: "OL2UL"
                }));
                turnIntoSubmenu.push(this.turnsOneInto({
                    menuId: "check",
                    id,
                    icon: "iconCheck",
                    label: window.siyuan.languages.check,
                    accelerator: window.siyuan.config.keymap.editor.insert.check.custom,
                    protyle,
                    nodeElement,
                    type: "UL2TL"
                }));
            } else if (nodeElement.getAttribute("data-subtype") === "t") {
                turnIntoSubmenu.push(this.turnsOneInto({
                    menuId: "list",
                    id,
                    icon: "iconList",
                    label: window.siyuan.languages.list,
                    accelerator: window.siyuan.config.keymap.editor.insert.list.custom,
                    protyle,
                    nodeElement,
                    type: "TL2UL"
                }));
                turnIntoSubmenu.push(this.turnsOneInto({
                    menuId: "orderedList",
                    id,
                    icon: "iconOrderedList",
                    label: window.siyuan.languages["ordered-list"],
                    accelerator: window.siyuan.config.keymap.editor.insert["ordered-list"].custom,
                    protyle,
                    nodeElement,
                    type: "TL2OL"
                }));
            } else {
                turnIntoSubmenu.push(this.turnsOneInto({
                    menuId: "orderedList",
                    id,
                    icon: "iconOrderedList",
                    label: window.siyuan.languages["ordered-list"],
                    accelerator: window.siyuan.config.keymap.editor.insert["ordered-list"].custom,
                    protyle,
                    nodeElement,
                    type: "UL2OL"
                }));
                turnIntoSubmenu.push(this.turnsOneInto({
                    menuId: "check",
                    id,
                    icon: "iconCheck",
                    label: window.siyuan.languages.check,
                    accelerator: window.siyuan.config.keymap.editor.insert.check.custom,
                    protyle,
                    nodeElement,
                    type: "OL2TL"
                }));
            }
        } else if (type === "NodeBlockquote" && allowStructuralMutation) {
            turnIntoSubmenu.push(this.turnsOneInto({
                menuId: "paragraph",
                id,
                icon: "iconParagraph",
                label: window.siyuan.languages.paragraph,
                accelerator: window.siyuan.config.keymap.editor.heading.paragraph.custom,
                protyle,
                nodeElement,
                type: "CancelBlockquote"
            }));
            turnIntoSubmenu.push(this.turnsOneInto({
                id,
                icon: "iconCallout",
                label: window.siyuan.languages.callout,
                protyle,
                nodeElement,
                type: "Blockquote2Callout"
            }));
        } else if (type === "NodeCallout" && allowStructuralMutation) {
            turnIntoSubmenu.push(this.turnsOneInto({
                menuId: "paragraph",
                id,
                icon: "iconParagraph",
                label: window.siyuan.languages.paragraph,
                accelerator: window.siyuan.config.keymap.editor.heading.paragraph.custom,
                protyle,
                nodeElement,
                type: "CancelCallout"
            }));
            turnIntoSubmenu.push(this.turnsOneInto({
                id,
                icon: "iconQuote",
                label: window.siyuan.languages.quote,
                protyle,
                nodeElement,
                type: "Callout2Blockquote"
            }));
        }
        if (turnIntoSubmenu.length > 0 && allowStructuralMutation) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "turnInto",
                icon: "iconTurnInto",
                label: window.siyuan.languages.turnInto,
                type: "submenu",
                submenu: turnIntoSubmenu
            }).element);
        }
        if (!isEmbedMenu && !protyle.disabled && !nodeElement.classList.contains("hr")) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "ai",
                icon: "iconSparkles",
                label: window.siyuan.languages.aiEdit,
                accelerator: window.siyuan.config.keymap.editor.general.ai.custom,
                click() {
                    AIActions([nodeElement], protyle);
                }
            }).element);
        }

        this.appendCopyMenu(protyle, nodeElement, allowStructuralMutation);
        if (allowRemoval) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "cut",
                icon: "iconCut",
                label: window.siyuan.languages.cut,
                accelerator: "⌘X",
                click: () => {
                    focusBlock(nodeElement);
                    document.execCommand("cut");
                }
            }).element);
        }
        if (!isEmbedMenu && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "move",
                icon: "iconMove",
                label: window.siyuan.languages.move,
                accelerator: window.siyuan.config.keymap.general.move.custom,
                click: () => {
                    movePathTo({
                        cb: (toPath) => {
                            hintMoveBlock(toPath[0], [nodeElement], protyle);
                        },
                        flashcard: false,
                    });
                }
            }).element);
        }
        this.appendAddToDatabaseMenu(protyle, nodeElement);
        if (!protyle.disabled) {
            /// #if !MOBILE
            // 加密笔记本中的块不暴露该菜单：避免把受保护内容引入智能体会话。
            if (!isEncryptedBox(protyle.notebookId)) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "addToAgent",
                    icon: "iconSend",
                    label: window.siyuan.languages.addToAgent,
                    click: () => {
                        addBlockToAgent([nodeElement.getAttribute("data-node-id")]);
                    }
                }).element);
            }
            /// #endif
        }
        if (allowRemoval) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "delete",
                icon: "iconTrashcan",
                label: window.siyuan.languages.delete,
                accelerator: "⌫",
                click: () => {
                    protyle.breadcrumb?.hide();
                    removeBlock(protyle, nodeElement, getEditorRange(nodeElement), "Backspace");
                }
            }).element);
        }
        if (type === "NodeSuperBlock" && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "separator_cancelSuperBlock",
                type: "separator"
            }).element);
            const isCol = nodeElement.getAttribute("data-sb-layout") === "col";
            if (allowStructuralMutation) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "cancelSuperBlock",
                    label: window.siyuan.languages.cancel + " " + window.siyuan.languages.superBlock,
                    accelerator: window.siyuan.config.keymap.editor.general[isCol ? "hLayout" : "vLayout"].custom,
                    async click() {
                        const sbData = await cancelSB(protyle, nodeElement);
                        transaction(protyle, sbData.doOperations, sbData.undoOperations);
                        focusBlock(embedContext?.resultElement.querySelector(`[data-node-id="${sbData.previousId}"]`) ||
                            protyle.wysiwyg.element.querySelector(`[data-node-id="${sbData.previousId}"]`));
                        hideElements(["gutter"], protyle);
                    }
                }).element);
            }
            window.siyuan.menus.menu.append(new MenuItem({
                id: "turnInto" + (isCol ? "VLayout" : "HLayout"),
                accelerator: window.siyuan.config.keymap.editor.general[isCol ? "vLayout" : "hLayout"].custom,
                label: window.siyuan.languages.turnInto + " " + window.siyuan.languages[isCol ? "vLayout" : "hLayout"],
                click() {
                    const oldHTML = nodeElement.outerHTML;
                    if (isCol) {
                        nodeElement.setAttribute("data-sb-layout", "row");
                    } else {
                        nodeElement.setAttribute("data-sb-layout", "col");
                    }
                    nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                    updateTransaction(protyle, nodeElement, oldHTML);
                    focusByRange(protyle.toolbar.range);
                    hideElements(["gutter"], protyle);
                }
            }).element);
        } else if (type === "NodeCodeBlock" && !nodeElement.getAttribute("data-subtype")) {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_code", type: "separator"}).element);
            const linewrap = nodeElement.getAttribute("linewrap");
            const ligatures = nodeElement.getAttribute("ligatures");
            const linenumber = nodeElement.getAttribute("linenumber");

            window.siyuan.menus.menu.append(new MenuItem({
                id: "code",
                type: "submenu",
                icon: "iconCode",
                label: window.siyuan.languages.code,
                submenu: [{
                    id: "md31",
                    iconHTML: "",
                    ignore: protyle.disabled,
                    label: `<div class="fn__flex" style="margin-bottom: 4px"><span>${window.siyuan.languages.md31}</span><span class="fn__space fn__flex-1"></span>
<input type="checkbox" class="b3-switch fn__flex-center"${linewrap === "true" ? " checked" : ((window.siyuan.config.editor.codeLineWrap && linewrap !== "false") ? " checked" : "")}></div>`,
                    bind(element) {
                        element.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
                            const inputElement = element.querySelector("input");
                            if (event.target.tagName !== "INPUT") {
                                inputElement.checked = !inputElement.checked;
                            }
                            nodeElement.setAttribute("linewrap", inputElement.checked.toString());
                            nodeElement.querySelector(".hljs").removeAttribute("data-render");
                            highlightRender(nodeElement);
                            fetchPost("/api/attr/setBlockAttrs", {
                                id,
                                attrs: {linewrap: inputElement.checked.toString()}
                            });
                            window.siyuan.menus.menu.remove();
                        });
                    }
                }, {
                    id: "md2",
                    iconHTML: "",
                    ignore: protyle.disabled,
                    label: `<div class="fn__flex" style="margin-bottom: 4px"><span>${window.siyuan.languages.md2}</span><span class="fn__space fn__flex-1"></span>
<input type="checkbox" class="b3-switch fn__flex-center"${ligatures === "true" ? " checked" : ((window.siyuan.config.editor.codeLigatures && ligatures !== "false") ? " checked" : "")}></div>`,
                    bind(element) {
                        element.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
                            const inputElement = element.querySelector("input");
                            if (event.target.tagName !== "INPUT") {
                                inputElement.checked = !inputElement.checked;
                            }
                            nodeElement.setAttribute("ligatures", inputElement.checked.toString());
                            nodeElement.querySelector(".hljs").removeAttribute("data-render");
                            highlightRender(nodeElement);
                            fetchPost("/api/attr/setBlockAttrs", {
                                id,
                                attrs: {ligatures: inputElement.checked.toString()}
                            });
                            window.siyuan.menus.menu.remove();
                        });
                    }
                }, {
                    id: "md27",
                    iconHTML: "",
                    ignore: protyle.disabled,
                    label: `<div class="fn__flex" style="margin-bottom: 4px"><span>${window.siyuan.languages.md27}</span><span class="fn__space fn__flex-1"></span>
<input type="checkbox" class="b3-switch fn__flex-center"${linenumber === "true" ? " checked" : ((window.siyuan.config.editor.codeSyntaxHighlightLineNum && linenumber !== "false") ? " checked" : "")}></div>`,
                    bind(element) {
                        element.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
                            const inputElement = element.querySelector("input");
                            if (event.target.tagName !== "INPUT") {
                                inputElement.checked = !inputElement.checked;
                            }
                            nodeElement.setAttribute("linenumber", inputElement.checked.toString());
                            nodeElement.querySelector(".hljs").removeAttribute("data-render");
                            highlightRender(nodeElement);
                            fetchPost("/api/attr/setBlockAttrs", {
                                id,
                                attrs: {linenumber: inputElement.checked.toString()}
                            });
                            window.siyuan.menus.menu.remove();
                        });
                    }
                }, {
                    id: "saveCodeBlockAsFile",
                    iconHTML: "",
                    label: window.siyuan.languages.saveCodeBlockAsFile,
                    click() {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportCodeBlock", {id}, (response) => {
                            saveExportFile(response.data.path, msgId);
                        });
                    }
                }]
            }).element);
        } else if (type === "NodeCodeBlock" && !protyle.disabled && ["echarts", "mindmap"].includes(nodeElement.getAttribute("data-subtype"))) {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_chart", type: "separator"}).element);
            const height = (nodeElement as HTMLElement).style.height;
            let html = nodeElement.outerHTML;
            window.siyuan.menus.menu.append(new MenuItem({
                id: "chart",
                label: window.siyuan.languages.chart,
                icon: "iconCode",
                submenu: [{
                    id: "height",
                    iconHTML: "",
                    type: "readonly",
                    label: `<div class="fn__flex"><input class="b3-text-field fn__flex-1" value="${height ? parseInt(height) : "420"}" step="1" min="148" style="margin: 4px 8px 4px 0" placeholder="${window.siyuan.languages.height}"><span class="fn__flex-center">px</span></div>`,
                    bind: (element) => {
                        element.querySelector("input").addEventListener("change", (event) => {
                            const newHeight = ((event.target as HTMLInputElement).value || "420") + "px";
                            (nodeElement as HTMLElement).style.height = newHeight;
                            updateTransaction(protyle, nodeElement, html);
                            html = nodeElement.outerHTML;
                            event.stopPropagation();
                            const renderElement = nodeElement.querySelector('[contenteditable="false"]') as HTMLElement;
                            if (renderElement) {
                                renderElement.style.height = newHeight;
                                const chartInstance = window.echarts.getInstanceById(renderElement.getAttribute("_echarts_instance_"));
                                if (chartInstance) {
                                    chartInstance.resize();
                                }
                            }
                        });
                    }
                }, {
                    id: "update",
                    label: window.siyuan.languages.update,
                    icon: "iconEdit",
                    click() {
                        protyle.toolbar.showRender(protyle, nodeElement);
                    }
                }]
            }).element);
        } else if (type === "NodeTable" && !protyle.disabled) {
            let range = getEditorRange(nodeElement);
            const tableElement = nodeElement.querySelector("table");
            if (!tableElement.contains(range.startContainer)) {
                range = getEditorRange(tableElement.querySelector("th"));
            }
            const cellElement = hasClosestByTag(range.startContainer, "TD") ||
                hasClosestByTag(range.startContainer, "TH") || nodeElement.querySelector("th, td");
            if (cellElement) {
                window.siyuan.menus.menu.append(new MenuItem({id: "separator_table", type: "separator"}).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "table",
                    type: "submenu",
                    icon: "iconTable",
                    label: window.siyuan.languages.table,
                    submenu: tableMenu(protyle, nodeElement, cellElement as HTMLTableCellElement, range).menus as IMenu[]
                }).element);
            }
        } else if (type === "NodeAttributeView") {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_exportCSV", type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "exportCSV",
                icon: "iconDatabase",
                label: window.siyuan.languages.export + " CSV",
                click() {
                    fetchPost("/api/export/exportAttributeView", {
                        id: nodeElement.getAttribute("data-av-id"),
                        blockID: id,
                    }, response => {
                        saveExportFile(response.data.zip);
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "showDatabaseInFolder",
                icon: "iconFolder",
                label: window.siyuan.languages.showInFolder,
                click() {
                    const avId = nodeElement.getAttribute("data-av-id");
                    const notebookId = protyle.notebookId;
                    // 加密笔记本的 AV 定义存笔记本级路径
                    const avDir = isEncryptedBox(notebookId)
                        ? path.join(window.siyuan.config.system.dataDir, notebookId, "storage", "av")
                        : path.join(window.siyuan.config.system.dataDir, "storage", "av");
                    useShell("showItemInFolder", path.join(avDir, avId) + ".json");
                }
            }).element);
        } else if ((type === "NodeVideo" || type === "NodeAudio") && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_VideoOrAudio", type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: type === "NodeVideo" ? "assetVideo" : "assetAudio",
                type: "submenu",
                icon: type === "NodeVideo" ? "iconVideo" : "iconRecord",
                label: window.siyuan.languages.assets,
                submenu: videoMenu(protyle, nodeElement, type)
            }).element);
        } else if (type === "NodeIFrame" && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_IFrame", type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "assetIFrame",
                type: "submenu",
                icon: "iconGlobe",
                label: window.siyuan.languages.assets,
                submenu: iframeMenu(protyle, nodeElement)
            }).element);
        } else if (type === "NodeHTMLBlock" && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_html", type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "html",
                icon: "iconHTML5",
                label: "HTML",
                click() {
                    protyle.toolbar.showRender(protyle, nodeElement);
                }
            }).element);
        } else if (type === "NodeBlockQueryEmbed" && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_blockEmbed", type: "separator"}).element);
            const breadcrumb = nodeElement.getAttribute("breadcrumb");
            window.siyuan.menus.menu.append(new MenuItem({
                id: "blockEmbed",
                type: "submenu",
                icon: "iconSQL",
                label: window.siyuan.languages.blockEmbed,
                submenu: [{
                    id: "refresh",
                    icon: "iconRefresh",
                    label: `${window.siyuan.languages.refresh} SQL`,
                    click() {
                        nodeElement.removeAttribute("data-render");
                        blockRender(protyle, nodeElement);
                    }
                }, {
                    id: "update",
                    icon: "iconEdit",
                    label: `${window.siyuan.languages.update} SQL`,
                    click() {
                        protyle.toolbar.showRender(protyle, nodeElement);
                    }
                }, {
                    type: "separator"
                }, {
                    id: "embedBlockBreadcrumb",
                    label: `<div class="fn__flex" style="margin-bottom: 4px"><span>${window.siyuan.languages.embedBlockBreadcrumb}</span><span class="fn__space fn__flex-1"></span>
<input type="checkbox" class="b3-switch fn__flex-center"${breadcrumb === "true" ? " checked" : ((window.siyuan.config.editor.embedBlockBreadcrumb && breadcrumb !== "false") ? " checked" : "")}></div>`,
                    bind(element) {
                        element.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
                            const inputElement = element.querySelector("input");
                            if (event.target.tagName !== "INPUT") {
                                inputElement.checked = !inputElement.checked;
                            }
                            nodeElement.setAttribute("breadcrumb", inputElement.checked.toString());
                            fetchPost("/api/attr/setBlockAttrs", {
                                id,
                                attrs: {breadcrumb: inputElement.checked.toString()}
                            });
                            nodeElement.removeAttribute("data-render");
                            blockRender(protyle, nodeElement);
                            window.siyuan.menus.menu.remove();
                        });
                    }
                }, {
                    id: "headingEmbedMode",
                    label: window.siyuan.languages.headingEmbedMode,
                    type: "submenu",
                    submenu: [{
                        id: "showHeadingWithBlocks",
                        label: window.siyuan.languages.showHeadingWithBlocks,
                        iconHTML: "",
                        checked: nodeElement.getAttribute("custom-heading-mode") === "0",
                        click() {
                            nodeElement.setAttribute("custom-heading-mode", "0");
                            fetchPost("/api/attr/setBlockAttrs", {
                                id,
                                attrs: {"custom-heading-mode": "0"}
                            });
                            nodeElement.removeAttribute("data-render");
                            blockRender(protyle, nodeElement);
                        }
                    }, {
                        id: "showHeadingOnlyTitle",
                        label: window.siyuan.languages.showHeadingOnlyTitle,
                        iconHTML: "",
                        checked: nodeElement.getAttribute("custom-heading-mode") === "1",
                        click() {
                            nodeElement.setAttribute("custom-heading-mode", "1");
                            fetchPost("/api/attr/setBlockAttrs", {
                                id,
                                attrs: {"custom-heading-mode": "1"}
                            });
                            nodeElement.removeAttribute("data-render");
                            blockRender(protyle, nodeElement);
                        }
                    }, {
                        id: "showHeadingOnlyBlocks",
                        label: window.siyuan.languages.showHeadingOnlyBlocks,
                        iconHTML: "",
                        checked: nodeElement.getAttribute("custom-heading-mode") === "2",
                        click() {
                            nodeElement.setAttribute("custom-heading-mode", "2");
                            fetchPost("/api/attr/setBlockAttrs", {
                                id,
                                attrs: {"custom-heading-mode": "2"}
                            });
                            nodeElement.removeAttribute("data-render");
                            blockRender(protyle, nodeElement);
                        }
                    }, {
                        id: "default",
                        label: window.siyuan.languages.default,
                        iconHTML: "",
                        checked: !nodeElement.getAttribute("custom-heading-mode"),
                        click() {
                            nodeElement.removeAttribute("custom-heading-mode");
                            fetchPost("/api/attr/setBlockAttrs", {
                                id,
                                attrs: {"custom-heading-mode": ""}
                            });
                            nodeElement.removeAttribute("data-render");
                            blockRender(protyle, nodeElement);
                        }
                    }]
                }]
            }).element);
        } else if (type === "NodeHeading" && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
            if (!isEmbedMenu) {
                const headingSubMenu = [];
                if (subType !== "h1") {
                    headingSubMenu.push(this.genHeadingTransform(protyle, id, 1));
                }
                if (subType !== "h2") {
                    headingSubMenu.push(this.genHeadingTransform(protyle, id, 2));
                }
                if (subType !== "h3") {
                    headingSubMenu.push(this.genHeadingTransform(protyle, id, 3));
                }
                if (subType !== "h4") {
                    headingSubMenu.push(this.genHeadingTransform(protyle, id, 4));
                }
                if (subType !== "h5") {
                    headingSubMenu.push(this.genHeadingTransform(protyle, id, 5));
                }
                if (subType !== "h6") {
                    headingSubMenu.push(this.genHeadingTransform(protyle, id, 6));
                }
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "tWithSubtitle",
                    type: "submenu",
                    icon: "iconRefresh",
                    label: window.siyuan.languages.tWithSubtitle,
                    submenu: headingSubMenu
                }).element);
            }
            window.siyuan.menus.menu.append(new MenuItem({
                id: "copyHeadings1",
                icon: "iconCopy",
                label: `${window.siyuan.languages.copy} ${window.siyuan.languages.headings1}`,
                click() {
                    fetchPost("/api/block/getHeadingChildrenDOM", {
                        id,
                        removeFoldAttr: nodeElement.getAttribute("fold") !== "1"
                    }, (response) => {
                        if (isInAndroid()) {
                            window.JSAndroid.writeSiYuanHTMLClipboard(protyle.lute.BlockDOM2StdMd(response.data).trimEnd(), protyle.lute.BlockDOM2HTML(response.data).trimEnd(), response.data + Constants.ZWSP);
                        } else if (isInHarmony()) {
                            window.JSHarmony.writeSiYuanHTMLClipboard(protyle.lute.BlockDOM2StdMd(response.data).trimEnd(), protyle.lute.BlockDOM2HTML(response.data).trimEnd(), response.data + Constants.ZWSP);
                        } else {
                            writeText(response.data + Constants.ZWSP);
                        }
                    });
                }
            }).element);
            if (!isEmbedMenu) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "cutHeadings1",
                    icon: "iconCut",
                    label: `${window.siyuan.languages.cut} ${window.siyuan.languages.headings1}`,
                    click() {
                        fetchPost("/api/block/getHeadingChildrenDOM", {
                            id,
                            removeFoldAttr: nodeElement.getAttribute("fold") !== "1"
                        }, (response) => {
                            if (isInAndroid()) {
                                window.JSAndroid.writeHTMLClipboard(protyle.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
                            } else if (isInHarmony()) {
                                window.JSHarmony.writeHTMLClipboard(protyle.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
                            } else {
                                writeText(response.data + Constants.ZWSP);
                            }
                            fetchPost("/api/block/getHeadingDeleteTransaction", {
                                id,
                            }, (deleteResponse) => {
                                deleteResponse.data.doOperations.forEach((operation: IOperation) => {
                                    protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                                        itemElement.remove();
                                    });
                                });
                                if (protyle.wysiwyg.element.childElementCount === 0) {
                                    const newID = Lute.NewNodeID();
                                    const emptyElement = genEmptyElement(false, false, newID);
                                    protyle.wysiwyg.element.insertAdjacentElement("afterbegin", emptyElement);
                                    deleteResponse.data.doOperations.push({
                                        action: "insert",
                                        data: emptyElement.outerHTML,
                                        id: newID,
                                        parentID: protyle.block.parentID
                                    });
                                    deleteResponse.data.undoOperations.push({
                                        action: "delete",
                                        id: newID,
                                    });
                                    focusBlock(emptyElement);
                                }
                                transaction(protyle, deleteResponse.data.doOperations, deleteResponse.data.undoOperations);
                            });
                        });
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "deleteHeadings1",
                    icon: "iconTrashcan",
                    label: `${window.siyuan.languages.delete} ${window.siyuan.languages.headings1}`,
                    click() {
                        fetchPost("/api/block/getHeadingDeleteTransaction", {
                            id,
                        }, (response) => {
                            response.data.doOperations.forEach((operation: IOperation) => {
                                protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                                    itemElement.remove();
                                });
                            });
                            if (protyle.wysiwyg.element.childElementCount === 0) {
                                const newID = Lute.NewNodeID();
                                const emptyElement = genEmptyElement(false, false, newID);
                                protyle.wysiwyg.element.insertAdjacentElement("afterbegin", emptyElement);
                                response.data.doOperations.push({
                                    action: "insert",
                                    data: emptyElement.outerHTML,
                                    id: newID,
                                    parentID: protyle.block.parentID
                                });
                                response.data.undoOperations.push({
                                    action: "delete",
                                    id: newID,
                                });
                                focusBlock(emptyElement);
                            }
                            transaction(protyle, response.data.doOperations, response.data.undoOperations);
                        });
                    }
                }).element);
            }
        }
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
        if (!protyle.options.backlinkData) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "enter",
                icon: "iconEnter",
                accelerator: `${window.siyuan.config.keymap.general.enter.custom ? updateHotkeyTip(window.siyuan.config.keymap.general.enter.custom) + "/" : ""}${updateHotkeyAfterTip("⌘" + window.siyuan.languages.click)}`,
                label: window.siyuan.languages.enter,
                click: () => {
                    zoomOut({protyle, id});
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "enterBack",
                icon: "iconEnterBack",
                accelerator: window.siyuan.config.keymap.general.enterBack.custom,
                label: window.siyuan.languages.enterBack,
                click: () => {
                    enterBack(protyle, id);
                }
            }).element);
        } else {
            /// #if !MOBILE
            window.siyuan.menus.menu.append(new MenuItem({
                id: "enter",
                icon: "iconEnter",
                accelerator: `${updateHotkeyTip(window.siyuan.config.keymap.general.enter.custom)}/${updateHotkeyTip("⌘" + window.siyuan.languages.click)}`,
                label: window.siyuan.languages.openBy,
                click: () => {
                    checkFold(id, (zoomIn, action) => {
                        openFileById({
                            app: protyle.app,
                            id,
                            action,
                            zoomIn
                        });
                    });
                }
            }).element);
            /// #endif
        }
        if (allowStructuralMutation) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "insertBefore",
                icon: "iconBefore",
                label: window.siyuan.languages.insertBefore,
                accelerator: window.siyuan.config.keymap.editor.general.insertBefore.custom,
                click() {
                    hideElements(["select"], protyle);
                    countBlockWord([], protyle.block.rootID);
                    insertEmptyBlock(protyle, "beforebegin", nodeElement);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "insertAfter",
                icon: "iconAfter",
                label: window.siyuan.languages.insertAfter,
                accelerator: window.siyuan.config.keymap.editor.general.insertAfter.custom,
                click() {
                    hideElements(["select"], protyle);
                    countBlockWord([], protyle.block.rootID);
                    insertEmptyBlock(protyle, "afterend", nodeElement);
                }
            }).element);
        }
        if (!protyle.disabled) {
            const countElement = nodeElement.lastElementChild?.querySelector(".protyle-attr--refcount");
            if (countElement && countElement.textContent) {
                transferBlockRef(id);
            }
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "jumpTo",
            icon: "iconJumpTo",
            type: "submenu",
            label: window.siyuan.languages.jumpTo,
            submenu: [{
                id: "jumpToParentPrev",
                iconHTML: "",
                label: window.siyuan.languages.jumpToParentPrev,
                accelerator: window.siyuan.config.keymap.editor.general.jumpToParentPrev.custom,
                click() {
                    hideElements(["select"], protyle);
                    jumpToParent(protyle, nodeElement, "previous");
                }
            }, {
                iconHTML: "",
                id: "jumpToParentNext",
                label: window.siyuan.languages.jumpToParentNext,
                accelerator: window.siyuan.config.keymap.editor.general.jumpToParentNext.custom,
                click() {
                    hideElements(["select"], protyle);
                    jumpToParent(protyle, nodeElement, "next");
                }
            }, {
                iconHTML: "",
                id: "jumpToParent",
                label: window.siyuan.languages.jumpToParent,
                accelerator: window.siyuan.config.keymap.editor.general.jumpToParent.custom,
                click() {
                    hideElements(["select"], protyle);
                    jumpToParent(protyle, nodeElement, "parent");
                }
            }]
        }).element);

        window.siyuan.menus.menu.append(new MenuItem({id: "separator_3", type: "separator"}).element);

        if (type !== "NodeThematicBreak") {
            this.appendFoldMenu(protyle, nodeElement);
            if (!protyle.disabled && !isEncryptedBox(protyle.notebookId)) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "attr",
                    label: window.siyuan.languages.attr,
                    icon: "iconAttr",
                    accelerator: window.siyuan.config.keymap.editor.general.attr.custom + "/" + updateHotkeyTip("⇧" + window.siyuan.languages.click),
                    click() {
                        openAttr(nodeElement, "bookmark", protyle);
                    }
                }).element);
            }
        }
        if (!protyle.disabled) {
            const appearanceElement = new MenuItem({
                id: "appearance",
                label: window.siyuan.languages.appearance,
                icon: "iconFont",
                accelerator: window.siyuan.config.keymap.editor.insert.appearance.custom,
                click: () => {
                    /// #if MOBILE
                    this.showMobileAppearance(protyle);
                    /// #else
                    protyle.toolbar.element.classList.add("fn__none");
                    protyle.toolbar.subElement.innerHTML = "";
                    protyle.toolbar.subElement.style.width = "";
                    protyle.toolbar.subElement.style.padding = "";
                    protyle.toolbar.subElement.append(appearanceMenu(protyle, [nodeElement]));
                    protyle.toolbar.subElement.style.zIndex = (++window.siyuan.zIndex).toString();
                    protyle.toolbar.subElement.classList.remove("fn__none");
                    protyle.toolbar.subElementCloseCB = undefined;
                    const position = nodeElement.getBoundingClientRect();
                    setPosition(protyle.toolbar.subElement, position.left, position.top);
                    /// #endif
                }
            }).element;
            window.siyuan.menus.menu.append(appearanceElement);
            if (!isMobile()) {
                appearanceElement.lastElementChild.classList.add("b3-menu__submenu--row");
            }
            this.genAlign([nodeElement], protyle);
            this.genWidths([nodeElement], protyle);
            // this.genHeights([nodeElement], protyle);
        }
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_4", type: "separator"}).element);
        if (window.siyuan.config.cloudRegion === 0 &&
            !["NodeThematicBreak", "NodeBlockQueryEmbed", "NodeIFrame", "NodeHTMLBlock", "NodeWidget", "NodeVideo", "NodeAudio"].includes(type) &&
            getContenteditableElement(nodeElement)?.textContent.trim() !== "" &&
            (type !== "NodeCodeBlock" || (type === "NodeCodeBlock" && !nodeElement.getAttribute("data-subtype")))) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "wechatReminder",
                icon: "iconMp",
                label: window.siyuan.languages.wechatReminder,
                ignore: window.siyuan.config.readonly,
                click() {
                    openWechatNotify(nodeElement);
                }
            }).element);
        }
        if (type !== "NodeThematicBreak" && !window.siyuan.config.readonly && !isEncryptedBox(protyle.notebookId)) {
            const isCardMade = nodeElement.hasAttribute(Constants.CUSTOM_RIFF_DECKS);
            window.siyuan.menus.menu.append(new MenuItem({
                id: isCardMade ? "removeCard" : "quickMakeCard",
                icon: "iconRiffCard",
                label: isCardMade ? window.siyuan.languages.removeCard : window.siyuan.languages.quickMakeCard,
                accelerator: window.siyuan.config.keymap.editor.general.quickMakeCard.custom,
                click() {
                    quickMakeCard(protyle, [nodeElement]);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "addToDeck",
                label: window.siyuan.languages.addToDeck,
                ignore: !window.siyuan.config.flashcard.deck,
                icon: "iconRiffCard",
                click() {
                    makeCard(protyle.app, [id]);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_5", type: "separator"}).element);
        }

        if (!isEmbedMenu && protyle?.app?.plugins) {
            emitOpenMenu({
                plugins: protyle.app.plugins,
                type: "click-blockicon",
                detail: {
                    protyle,
                    blockElements: [nodeElement]
                },
                separatorPosition: "bottom",
            });
        }

        let updateHTML = nodeElement.getAttribute("updated") || "";
        if (updateHTML) {
            updateHTML = `${window.siyuan.languages.modifiedAt} ${dayjs(updateHTML).format("YYYY-MM-DD HH:mm:ss")}<br>`;
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "updateAndCreatedAt",
            iconHTML: "",
            type: "readonly",
            label: `${updateHTML}${window.siyuan.languages.createdAt} ${dayjs(id.substr(0, 14)).format("YYYY-MM-DD HH:mm:ss")}`,
        }).element);
        return window.siyuan.menus.menu;
    }

    private genHeadingTransform(protyle: IProtyle, id: string, level: number) {
        return {
            id: "heading" + level,
            iconHTML: "",
            icon: "iconHeading" + level,
            label: window.siyuan.languages["heading" + level],
            click() {
                fetchPost("/api/block/getHeadingLevelTransaction", {
                    id,
                    level
                }, (response) => {
                    response.data.doOperations.forEach((operation: IOperation, index: number) => {
                        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                            itemElement.outerHTML = operation.data;
                        });
                        // 使用 outer 后元素需要重新查询
                        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                            mathRender(itemElement);
                        });
                        if (index === 0) {
                            focusBlock(protyle.wysiwyg.element.querySelector(`[data-node-id="${operation.id}"]`), protyle.wysiwyg.element, true);
                        }
                    });
                    transaction(protyle, response.data.doOperations, response.data.undoOperations);
                });
            }
        };
    }

    private genClick(nodeElements: Element[], protyle: IProtyle, cb: (e: HTMLElement) => void) {
        updateBatchTransaction(nodeElements, protyle, cb);
        focusBlock(nodeElements[0]);
    }

    private genAlign(nodeElements: Element[], protyle: IProtyle) {
        const disabledRTL = nodeElements.some(e => ["NodeAttributeView", "NodeCodeBlock", "NodeMathBlock"].includes(e.getAttribute("data-type")));
        window.siyuan.menus.menu.append(new MenuItem({
            id: "layout",
            icon: "iconAlignSettings",
            label: window.siyuan.languages.layout,
            type: "submenu",
            submenu: [{
                id: "alignLeft",
                icon: "iconAlignLeft",
                label: window.siyuan.languages.alignLeft,
                accelerator: window.siyuan.config.keymap.editor.general.alignLeft.custom,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        if (e.classList.contains("av")) {
                            e.style.justifyContent = "";
                        } else if (["NodeIFrame", "NodeWidget"].includes(e.getAttribute("data-type"))) {
                            e.style.margin = "";
                        } else {
                            e.style.textAlign = "left";
                        }
                    });
                }
            }, {
                id: "alignCenter",
                icon: "iconAlignCenter",
                label: window.siyuan.languages.alignCenter,
                accelerator: window.siyuan.config.keymap.editor.general.alignCenter.custom,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        if (e.classList.contains("av")) {
                            e.style.justifyContent = "center";
                        } else if (["NodeIFrame", "NodeWidget"].includes(e.getAttribute("data-type"))) {
                            e.style.margin = "0 auto";
                        } else {
                            e.style.textAlign = "center";
                        }
                    });
                }
            }, {
                id: "alignRight",
                icon: "iconAlignRight",
                label: window.siyuan.languages.alignRight,
                accelerator: window.siyuan.config.keymap.editor.general.alignRight.custom,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        if (e.classList.contains("av")) {
                            e.style.justifyContent = "flex-end";
                        } else if (["NodeIFrame", "NodeWidget"].includes(e.getAttribute("data-type"))) {
                            e.style.margin = "0 0 0 auto";
                        } else {
                            e.style.textAlign = "right";
                        }
                    });
                }
            }, {
                id: "justify",
                icon: "iconAlignJustify",
                label: window.siyuan.languages.justify,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.textAlign = "justify";
                    });
                }
            }, {
                id: "separator_1",
                type: "separator"
            }, {
                id: "ltr",
                icon: "iconLtr",
                ignore: disabledRTL,
                label: window.siyuan.languages.ltr,
                accelerator: window.siyuan.config.keymap.editor.general.ltr.custom,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        if (e.classList.contains("table")) {
                            e.querySelector("table").style.direction = "ltr";
                        } else if (e.getAttribute("data-type") === "NodeHTMLBlock") {
                            (e.querySelector("protyle-html") as HTMLElement).style.direction = "ltr";
                        } else {
                            e.style.direction = "ltr";
                        }
                    });
                }
            }, {
                id: "rtl",
                icon: "iconRtl",
                ignore: disabledRTL,
                label: window.siyuan.languages.rtl,
                accelerator: window.siyuan.config.keymap.editor.general.rtl.custom,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        if (e.classList.contains("table")) {
                            e.querySelector("table").style.direction = "rtl";
                        } else if (e.getAttribute("data-type") === "NodeHTMLBlock") {
                            (e.querySelector("protyle-html") as HTMLElement).style.direction = "rtl";
                        } else {
                            e.style.direction = "rtl";
                        }
                    });
                }
            }, {
                id: "separator_2",
                ignore: disabledRTL,
                type: "separator"
            }, {
                id: "clearFontStyle",
                icon: "iconTrashcan",
                label: window.siyuan.languages.clearFontStyle,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        if (e.classList.contains("av")) {
                            e.style.justifyContent = "";
                        } else if (["NodeIFrame", "NodeWidget"].includes(e.getAttribute("data-type"))) {
                            e.style.margin = "";
                        } else {
                            e.style.textAlign = "";
                            e.style.direction = "";
                        }
                    });
                }
            }]
        }).element);
    }

    private updateNodeElements(nodeElements: Element[], protyle: IProtyle, inputElement: HTMLInputElement) {
        const undoOperations: IOperation[] = [];
        const operations: IOperation[] = [];
        nodeElements.forEach((e) => {
            e.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            undoOperations.push({
                action: "update",
                id: e.getAttribute("data-node-id"),
                data: e.outerHTML
            });
        });
        inputElement.addEventListener(inputElement.type === "number" ? "blur" : "change", () => {
            nodeElements.forEach((e: HTMLElement) => {
                e.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
                operations.push({
                    action: "update",
                    id: e.getAttribute("data-node-id"),
                    data: e.outerHTML
                });
                if (e.getAttribute("data-subtype") === "echarts") {
                    const chartInstance = window.echarts.getInstanceById(e.querySelector("[_echarts_instance_]").getAttribute("_echarts_instance_"));
                    if (chartInstance) {
                        chartInstance.resize();
                    }
                    chartRender(e);
                }
            });
            transaction(protyle, operations, undoOperations);
            window.siyuan.menus.menu.remove();
            focusBlock(nodeElements[0]);
        });
    }

    private genWidths(nodeElements: Element[], protyle: IProtyle) {
        let isInSb = false;
        nodeElements.find((e: HTMLElement) => {
            if (e.parentElement.classList.contains("sb")) {
                isInSb = true;
                return true;
            }
        });
        if (isInSb) {
            return;
        }
        let rangeElement: HTMLInputElement;
        const firstElement = nodeElements[0] as HTMLElement;
        const styles: IMenu[] = [{
            id: "widthInput",
            iconHTML: "",
            type: "readonly",
            label: `<div class="fn__flex"><input class="b3-text-field fn__flex-1" value="${firstElement.style.width.endsWith("px") ? parseInt(firstElement.style.width) : ""}" type="number" style="margin: 4px 8px 4px 0" placeholder="${window.siyuan.languages.width}"><span class="fn__flex-center">px</span></div>`,
            bind: (element) => {
                const inputElement = element.querySelector("input");
                inputElement.addEventListener("input", () => {
                    nodeElements.forEach((item: HTMLElement) => {
                        item.style.width = inputElement.value + "px";
                        item.style.flex = "none";
                    });
                    rangeElement.value = "0";
                    rangeElement.parentElement.setAttribute("aria-label", inputElement.value + "px");
                });
                this.updateNodeElements(nodeElements, protyle, inputElement);
            }
        }];
        ["25%", "33%", "50%", "67%", "75%", "100%"].forEach((item) => {
            styles.push({
                id: "width_" + item,
                iconHTML: "",
                label: item,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.width = item;
                        e.style.flex = "none";
                        if (e.getAttribute("data-subtype") === "echarts") {
                            const chartInstance = window.echarts.getInstanceById(e.querySelector("[_echarts_instance_]").getAttribute("_echarts_instance_"));
                            if (chartInstance) {
                                chartInstance.resize();
                            }
                        }
                    });
                }
            });
        });
        styles.push({
            id: "separator_1",
            type: "separator"
        });
        const width = firstElement.style.width.endsWith("%") ? parseInt(firstElement.style.width) : 0;
        window.siyuan.menus.menu.append(new MenuItem({
            id: "width",
            icon: "iconWidth",
            label: window.siyuan.languages.width,
            submenu: styles.concat([{
                id: "widthDrag",
                iconHTML: "",
                type: "readonly",
                label: `<div style="margin: 4px 0;" aria-label="${firstElement.style.width.endsWith("px") ? firstElement.style.width : (firstElement.style.width || window.siyuan.languages.default)}" class="b3-tooltips b3-tooltips__n"><input style="box-sizing: border-box" value="${width}" class="b3-slider fn__block" max="100" min="1" step="1" type="range"></div>`,
                bind: (element) => {
                    rangeElement = element.querySelector("input");
                    rangeElement.addEventListener("input", () => {
                        nodeElements.forEach((e: HTMLElement) => {
                            e.style.width = rangeElement.value + "%";
                            e.style.flex = "none";
                        });
                        rangeElement.parentElement.setAttribute("aria-label", `${rangeElement.value}%`);
                    });
                    this.updateNodeElements(nodeElements, protyle, rangeElement);
                }
            }, {
                id: "separator_2",
                type: "separator"
            }, {
                id: "default",
                iconHTML: "",
                label: window.siyuan.languages.default,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        if (e.style.width) {
                            e.style.width = "";
                            e.style.flex = "";
                            if (e.getAttribute("data-subtype") === "echarts") {
                                const chartInstance = window.echarts.getInstanceById(e.querySelector("[_echarts_instance_]").getAttribute("_echarts_instance_"));
                                if (chartInstance) {
                                    chartInstance.resize();
                                }
                            }
                        }
                    });
                }
            }]),
        }).element);
    }

    // TODO https://github.com/siyuan-note/siyuan/issues/11055
    private genHeights(nodeElements: Element[], protyle: IProtyle) {
        const matchHeight = nodeElements.find(item => {
            if (!item.classList.contains("p") && !item.classList.contains("code-block") && !item.classList.contains("render-node")) {
                return true;
            }
        });
        if (matchHeight) {
            return;
        }
        let rangeElement: HTMLInputElement;
        const firstElement = nodeElements[0] as HTMLElement;
        const styles: IMenu[] = [{
            id: "heightInput",
            iconHTML: "",
            type: "readonly",
            label: `<div class="fn__flex"><input class="b3-text-field fn__flex-1" value="${firstElement.style.height.endsWith("px") ? parseInt(firstElement.style.height) : ""}" type="number" style="margin: 4px 8px 4px 0" placeholder="${window.siyuan.languages.height}"><span class="fn__flex-center">px</span></div>`,
            bind: (element) => {
                const inputElement = element.querySelector("input");
                inputElement.addEventListener("input", () => {
                    nodeElements.forEach((item: HTMLElement) => {
                        item.style.height = inputElement.value + "px";
                        item.style.flex = "none";
                    });
                    rangeElement.value = "0";
                    rangeElement.parentElement.setAttribute("aria-label", inputElement.value + "px");
                });
                this.updateNodeElements(nodeElements, protyle, inputElement);
            }
        }];
        ["25%", "33%", "50%", "67%", "75%", "100%"].forEach((item) => {
            styles.push({
                id: "height_" + item,
                iconHTML: "",
                label: item,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.height = item;
                        e.style.flex = "none";
                    });
                }
            });
        });
        styles.push({
            type: "separator"
        });
        const height = firstElement.style.height.endsWith("%") ? parseInt(firstElement.style.height) : 0;
        window.siyuan.menus.menu.append(new MenuItem({
            id: "heightDrag",
            label: window.siyuan.languages.height,
            submenu: styles.concat([{
                iconHTML: "",
                type: "readonly",
                label: `<div style="margin: 4px 0;" aria-label="${firstElement.style.height.endsWith("px") ? firstElement.style.height : (firstElement.style.height || window.siyuan.languages.default)}" class="b3-tooltips b3-tooltips__n"><input style="box-sizing: border-box" value="${height}" class="b3-slider fn__block" max="100" min="1" step="1" type="range"></div>`,
                bind: (element) => {
                    rangeElement = element.querySelector("input");
                    rangeElement.addEventListener("input", () => {
                        nodeElements.forEach((e: HTMLElement) => {
                            e.style.height = rangeElement.value + "%";
                            e.style.flex = "none";
                        });
                        rangeElement.parentElement.setAttribute("aria-label", `${rangeElement.value}%`);
                    });
                    this.updateNodeElements(nodeElements, protyle, rangeElement);
                }
            }, {
                type: "separator"
            }, {
                id: "default",
                iconHTML: "",
                label: window.siyuan.languages.default,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        if (e.style.height) {
                            e.style.height = "";
                            e.style.overflow = "";
                        }
                    });
                }
            }]),
        }).element);
    }

    private appendAddToDatabaseMenu(protyle: IProtyle, nodeElement: Element) {
        if (protyle.disabled) {
            return;
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "addToDatabase",
            icon: "iconDatabase",
            label: window.siyuan.languages.addToDatabase,
            accelerator: window.siyuan.config.keymap.general.addToDatabase.custom,
            click: () => {
                addEditorToDatabase(protyle, getEditorRange(nodeElement));
            }
        }).element);
    }

    private appendFoldMenu(protyle: IProtyle, nodeElement: Element) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "fold",
            icon: "iconFoldUnFold",
            label: window.siyuan.languages.fold,
            accelerator: `${updateHotkeyTip(window.siyuan.config.keymap.editor.general.collapse.custom)}/${updateHotkeyTip("⌥" + window.siyuan.languages.click)}`,
            click() {
                setFold(protyle, nodeElement);
                focusBlock(nodeElement);
            }
        }).element);
        if (["NodeHeading", "NodeListItem", "NodeBlockquote", "NodeCallout", "NodeSuperBlock"].includes(
            nodeElement.getAttribute("data-type"))) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "foldRecursive",
                icon: "iconListTree",
                label: window.siyuan.languages.foldRecursive,
                accelerator: window.siyuan.config.keymap.editor.general.foldRecursive?.custom,
                click() {
                    foldBlocksRecursively(protyle, [nodeElement]);
                    focusBlock(nodeElement);
                }
            }).element);
        }
    }

    private appendCopyMenu(protyle: IProtyle, nodeElement: Element, allowDuplicate = !protyle.disabled) {
        const id = nodeElement.getAttribute("data-node-id");
        const type = nodeElement.getAttribute("data-type");
        const copyMenu = (copySubMenu([id], true, nodeElement) as IMenu[]).concat([{
            id: "copyPlainText",
            iconHTML: "",
            label: window.siyuan.languages.copyPlainText,
            accelerator: window.siyuan.config.keymap.editor.general.copyPlainText.custom,
            click() {
                copyPlainText(getPlainText(nodeElement as HTMLElement).trimEnd());
                focusBlock(nodeElement);
            }
        }, {
            id: type === "NodeAttributeView" ? "copyMirror" : "copy",
            iconHTML: "",
            label: type === "NodeAttributeView" ? window.siyuan.languages.copyMirror : window.siyuan.languages.copy,
            accelerator: "⌘C",
            click() {
                if (isNotEditBlock(nodeElement)) {
                    focusBlock(nodeElement);
                } else {
                    focusByRange(getEditorRange(nodeElement));
                }
                document.execCommand("copy");
            }
        }]);
        const copyTextRefMenu = this.genCopyTextRef([nodeElement]);
        if (copyTextRefMenu) {
            copyMenu.splice(7, 0, copyTextRefMenu);
        }
        if (type === "NodeAttributeView") {
            copyMenu.splice(6, 0, {
                iconHTML: "",
                label: window.siyuan.languages.copyAVID,
                click() {
                    writeText(nodeElement.getAttribute("data-av-id"));
                }
            });
            if (allowDuplicate) {
                copyMenu.push({
                    id: "duplicateMirror",
                    iconHTML: "",
                    label: window.siyuan.languages.duplicateMirror,
                    accelerator: window.siyuan.config.keymap.editor.general.duplicate.custom,
                    click() {
                        duplicateBlock([nodeElement], protyle);
                    }
                });
                copyMenu.push({
                    id: "duplicateCompletely",
                    iconHTML: "",
                    label: window.siyuan.languages.duplicateCompletely,
                    accelerator: window.siyuan.config.keymap.editor.general.duplicateCompletely.custom,
                    click() {
                        duplicateCompletely(protyle, nodeElement as HTMLElement);
                    }
                });
            }
        } else if (allowDuplicate) {
            copyMenu.push({
                id: "duplicate",
                iconHTML: "",
                label: window.siyuan.languages.duplicate,
                accelerator: window.siyuan.config.keymap.editor.general.duplicate.custom,
                click() {
                    duplicateBlock([nodeElement], protyle);
                }
            });
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "copy",
            icon: "iconCopy",
            label: window.siyuan.languages.copy,
            type: "submenu",
            submenu: copyMenu
        }).element);
    }

    private genCopyTextRef(selectsElement: Element[]): false | IMenu {
        if (isNotEditBlock(selectsElement[0])) {
            return false;
        }
        return {
            id: "copyText",
            iconHTML: "",
            accelerator: window.siyuan.config.keymap.editor.general.copyText.custom,
            label: window.siyuan.languages.copyText,
            click() {
                // 用于标识复制文本 *
                selectsElement[0].setAttribute("data-reftext", "true");
                focusByRange(getEditorRange(selectsElement[0]));
                document.execCommand("copy");
            }
        };
    }

    public render(protyle: IProtyle, element: Element, target?: Element) {
        // https://github.com/siyuan-note/siyuan/issues/4659
        if (protyle.title && protyle.title.element.getAttribute("data-render") !== "true") {
            return;
        }
        // 防止划选时触碰图标导致 hl 无法移除
        const selectElement = protyle.element.querySelector(".protyle-select");
        if (selectElement && !selectElement.classList.contains("fn__none")) {
            return;
        }
        let html = "";
        let nodeElement = element;
        let space = 0;
        let index = 0;
        let listItem;
        let hideParent = false;
        const embedContext = getEmbedChildOperationContext(element);
        const embedElement = embedContext ? isInEmbedBlock(element, false) : false;
        const embedID = embedElement ? embedElement.getAttribute("data-node-id") : undefined;
        while (nodeElement) {
            let parentElement = hasClosestBlock(nodeElement.parentElement);
            if (embedContext && parentElement && !embedContext.boundaryElement.contains(parentElement)) {
                parentElement = false;
            }
            if (!isInEmbedBlock(nodeElement) || embedContext?.boundaryElement.contains(nodeElement)) {
                let type: string;
                if (!hideParent) {
                    type = nodeElement.getAttribute("data-type");
                }
                let dataNodeId = nodeElement.getAttribute("data-node-id");
                if (type === "NodeAttributeView" && target && !embedContext) {
                    const rowElement = hasClosestByClassName(target, "av__row");
                    if (rowElement && !rowElement.classList.contains("av__row--header") && rowElement.dataset.id) {
                        element = rowElement;
                        const bodyElement = hasClosestByClassName(rowElement, "av__body") as HTMLElement;
                        let iconAriaLabel = isMac() ? window.siyuan.languages.rowTip : window.siyuan.languages.rowTip.replace("⇧", "Shift+");
                        if (protyle.disabled) {
                            iconAriaLabel = window.siyuan.languages.rowTip.substring(0, window.siyuan.languages.rowTip.indexOf("<br"));
                        } else if (rowElement.querySelector('[data-dtype="block"]')?.getAttribute("data-detached") === "true") {
                            iconAriaLabel = window.siyuan.languages.rowTip.substring(0, window.siyuan.languages.rowTip.lastIndexOf("<br"));
                        }
                        html = `<button data-type="NodeAttributeViewRowMenu" data-node-id="${dataNodeId}" data-row-id="${rowElement.dataset.id}" data-group-id="${bodyElement.dataset.groupId || ""}" class="ariaLabel" data-position="parentW" aria-label="${iconAriaLabel}"><svg><use xlink:href="#iconDrag"></use></svg><span ${protyle.disabled ? "" : 'draggable="true" class="fn__grab"'}></span></button>`;
                        if (!protyle.disabled) {
                            html = `<button data-type="NodeAttributeViewRow" data-node-id="${dataNodeId}" data-row-id="${rowElement.dataset.id}" data-group-id="${bodyElement.dataset.groupId || ""}" class="ariaLabel" data-position="parentW" aria-label="${isMac() ? window.siyuan.languages.addBelowAbove : window.siyuan.languages.addBelowAbove.replace("⌥", "Alt+")}"><svg><use xlink:href="#iconAdd"></use></svg></button>${html}`;
                        }
                        break;
                    }
                }
                if (index === 0) {
                    // 不单独显示，要不然在块的间隔中，gutter 会跳来跳去的
                    if (["NodeBlockquote", "NodeList", "NodeCallout", "NodeSuperBlock"].includes(type)) {
                        if (target && type === "NodeCallout") {
                            // Callout 标题需显示
                            const calloutInfoElement = hasTopClosestByClassName(target, "callout-info");
                            if (calloutInfoElement) {
                                element = calloutInfoElement;
                            } else {
                                return;
                            }
                        } else {
                            return;
                        }
                    }

                    let topElement = getTopAloneElement(nodeElement);
                    if (embedContext && !embedContext.boundaryElement.contains(topElement)) {
                        // 单独查询列表项时，渲染器生成的无 ID 列表包装节点不属于可操作边界。
                        topElement = embedContext.targetElement || nodeElement;
                    }
                    // https://github.com/siyuan-note/siyuan/issues/17751 第二点
                    if (topElement === nodeElement.parentElement && nodeElement.childElementCount > 3 &&
                        nodeElement.classList.contains("li")) {
                        topElement = nodeElement;
                    }
                    // 提示下方仅有单个列表
                    if (topElement.classList.contains("callout") && !nodeElement.classList.contains("callout") &&
                        getParentBlock(nodeElement) !== topElement) {
                        topElement = topElement.querySelector("[data-node-id]");
                    }
                    listItem = topElement.querySelector(".li") || topElement.querySelector(".list");
                    // 嵌入块中有列表时块标显示位置错误 https://github.com/siyuan-note/siyuan/issues/6254
                    if ((!embedContext && isInEmbedBlock(listItem)) || isInAVBlock(listItem) ||
                        hasClosestByClassName(nodeElement, "callout")) {
                        listItem = undefined;
                    }
                    // 标题（除列表下的）、提示下的块必须显示
                    if (topElement !== nodeElement && type !== "NodeHeading" && !hasClosestByClassName(nodeElement, "callout")) {
                        while (nodeElement !== topElement) {
                            nodeElement = nodeElement.parentElement;
                            // > > > > 1 left 位置
                            if (nodeElement.parentElement.classList.contains("bq")) {
                                space += 10;
                            }
                        }
                        parentElement = hasClosestBlock(nodeElement.parentElement);
                        type = nodeElement.getAttribute("data-type");
                        dataNodeId = nodeElement.getAttribute("data-node-id");
                    }
                }
                // - > # 1 \n  > 2
                if (type === "NodeListItem" && index > 0) {
                    // 列表项内的块不显示块标
                    html = "";
                }
                index += 1;
                // 按块类型与是否反链面板生成提示，${x} 替换为该块的本地化类型名（如「段落/表格/超级块」）
                // 使用回调返回值，避免类型名中可能的 $ 字符被当作替换模式
                let gutterTip = (protyle.options.backlinkData ? this.gutterTipBacklink : this.gutterTip)
                    .replace("${x}", () => getBlockTypeName(type));
                if (embedContext) {
                    gutterTip = gutterTip.split("<br>")[0];
                } else if (protyle.disabled) {
                    gutterTip = gutterTip.split("<br>").splice(0, 2).join("<br>");
                }

                let popoverHTML = "";
                if (protyle.options.backlinkData) {
                    popoverHTML = `class="popover__block" data-id="${dataNodeId}"`;
                }
                const embedHTML = embedID ? ` data-embed-id="${embedID}"` : "";
                const buttonHTML = type ? `<button class="ariaLabel" data-delay="500" data-position="parentW" aria-label="${gutterTip}"
data-type="${type}" data-subtype="${nodeElement.getAttribute("data-subtype")}" data-node-id="${dataNodeId}"${embedHTML}>
    <svg><use xlink:href="#${getIconByType(type, nodeElement.getAttribute("data-subtype"))}"></use></svg>
    <span ${popoverHTML} ${protyle.disabled || embedContext ? "" : 'draggable="true"'}></span>
</button>` : "";
                if (!hideParent) {
                    html = buttonHTML + html;
                }
                let foldHTML = "";
                if (type === "NodeListItem" && nodeElement.childElementCount > 3 || type === "NodeHeading") {
                    const fold = nodeElement.getAttribute("fold");
                    foldHTML = `<button class="ariaLabel" data-delay="500" data-position="parentW" aria-label="${window.siyuan.languages.fold}"
data-type="fold" style="cursor:inherit;"><svg style="width: 10px;${fold && fold === "1" ? "" : "transform:rotate(90deg)"}"><use xlink:href="#iconPlay"></use></svg></button>`;
                }
                if (type === "NodeListItem" || type === "NodeList") {
                    listItem = nodeElement;
                    if (type === "NodeListItem" && nodeElement.childElementCount > 3) {
                        html = buttonHTML + foldHTML;
                    }
                }
                if (type === "NodeHeading") {
                    html = html + foldHTML;
                }
                if (["NodeBlockquote", "NodeCallout"].includes(type)) {
                    space += 10;
                }
                // 前一个块兄弟（跳过 sb__resize 拖拽手柄，手柄无 data-node-id）
                let previousBlock = nodeElement.previousElementSibling;
                while (previousBlock && !previousBlock.getAttribute("data-node-id")) {
                    previousBlock = previousBlock.previousElementSibling;
                }
                if ((previousBlock && previousBlock.getAttribute("data-node-id")) ||
                    nodeElement.parentElement.classList.contains("callout-content")) {
                    // 前一个块存在时，只显示到当前层级
                    hideParent = true;
                    // 由于折叠块的第二个子块在界面上不显示，因此移除块标 https://github.com/siyuan-note/siyuan/issues/14304
                    if (parentElement && parentElement.getAttribute("fold") === "1") {
                        return;
                    }
                    // 列表项中的引述块中的第二个段落块块标和引述块左侧样式重叠
                    if (parentElement && ["NodeBlockquote", "NodeCallout"].includes(parentElement.getAttribute("data-type"))) {
                        space += 10;
                    }
                }
            }

            if (embedContext && parentElement && !embedContext.boundaryElement.contains(parentElement)) {
                parentElement = false;
            }
            if (parentElement) {
                nodeElement = parentElement;
            } else {
                break;
            }
        }
        let match = true;
        // 统计时排除块标边缘框线与+号元素，它们由 render 末尾单独追加，不参与防抖比较
        const buttonsElement = this.element.querySelectorAll("button:not(.protyle-gutters__line):not(.protyle-gutters__plus)");
        if (buttonsElement.length !== html.split("</button>").length - 1) {
            match = false;
        } else {
            Array.from(buttonsElement).find(item => {
                if (item.getAttribute("data-node-id") && (item as HTMLElement).dataset.embedId !== embedID) {
                    match = false;
                    return true;
                }
                const id = item.getAttribute("data-node-id");
                if (id && html.indexOf(id) === -1) {
                    match = false;
                    return true;
                }
                const rowId = item.getAttribute("data-row-id");
                if ((rowId && html.indexOf(rowId) === -1) || (!rowId && html.indexOf("NodeAttributeViewRowMenu") > -1)) {
                    match = false;
                    return true;
                }
            });
        }
        // 防止抖动 https://github.com/siyuan-note/siyuan/issues/4166
        if (match && this.element.childElementCount > 0) {
            this.element.classList.remove("fn__none");
            return;
        }
        this.element.innerHTML = html;
        this.element.classList.remove("fn__none");
        this.element.style.width = "";
        let contentTop = protyle.contentElement.getBoundingClientRect().top;
        if (protyle.options.backlinkData) {
            const backlinkElement = protyle.element.closest(".backlinkList, .backlinkMList");
            if (backlinkElement) {
                contentTop = Math.max(contentTop, backlinkElement.getBoundingClientRect().top);
            }
        }
        let rect = element.getBoundingClientRect();
        let marginHeight = 0;
        if (listItem && !window.siyuan.config.editor.rtl && getComputedStyle(element).direction !== "rtl") {
            rect = listItem.firstElementChild.getBoundingClientRect();
            space = 0;
        } else if (nodeElement.getAttribute("data-type") === "NodeBlockQueryEmbed") {
            rect = nodeElement.getBoundingClientRect();
            space = 0;
        } else if (!element.classList.contains("av__row")) {
            if (rect.height < Math.floor(window.siyuan.config.editor.fontSize * 1.625) + 8 ||
                (rect.height > Math.floor(window.siyuan.config.editor.fontSize * 1.625) + 8 && rect.height < Math.floor(window.siyuan.config.editor.fontSize * 1.625) * 2 + 8)) {
                marginHeight = (rect.height - this.element.clientHeight) / 2;
            } else if ((nodeElement.getAttribute("data-type") === "NodeAttributeView" || element.getAttribute("data-type") === "NodeAttributeView") &&
                contentTop < rect.top) {
                marginHeight = 8;
            }
        }
        const foldElement = hasClosestByAttribute(element.parentElement, "fold", "1") as HTMLElement;
        this.element.style.top = `${Math.max(rect.top + marginHeight, contentTop, foldElement ? foldElement.getBoundingClientRect().top : 0)}px`;
        let left = rect.left - this.element.clientWidth - space;
        if ((nodeElement.getAttribute("data-type") === "NodeBlockQueryEmbed" && this.element.childElementCount === 1)) {
            // 嵌入块为列表时
            left = nodeElement.getBoundingClientRect().left - this.element.clientWidth - space;
        } else if (element.classList.contains("av__row")) {
            // 为数据库行
            left = nodeElement.getBoundingClientRect().left - this.element.clientWidth - space + parseInt(getComputedStyle(nodeElement).paddingLeft);
        }
        this.element.style.left = `${left}px`;
        if (left < this.element.parentElement.getBoundingClientRect().left) {
            this.element.style.width = "24px";
            // 需加 2，否则和折叠标题无法对齐
            this.element.style.left = `${rect.left - this.element.clientWidth - space / 2 + 3}px`;
            html = "";
            Array.from(this.element.children).reverse().forEach((item, index) => {
                // 跳过块标边缘框线与+号元素，避免被压缩重排
                if (item.classList.contains("protyle-gutters__line") || item.classList.contains("protyle-gutters__plus")) {
                    return;
                }
                if (index !== 0) {
                    (item.firstElementChild as HTMLElement).style.height = "14px";
                }
                html += item.outerHTML;
            });
            this.element.innerHTML = html;
        } else {
            this.element.querySelectorAll("svg").forEach(item => {
                item.style.height = "";
            });
        }
        // 追加块标边缘悬浮触发的插入元素（默认隐藏，悬浮块标显示线条，悬浮线条变+号），由 mousemove 定位
        // 追加块标边缘的框线（悬浮块标显示）与+号（悬浮框线显示），默认隐藏，由 mousemove 定位
        // 双元素：框线贴块标边缘不移动（避免闪烁），+号独立定位在外偏位置，tooltip 基于+号元素对齐
        if (!embedContext) {
            this.element.insertAdjacentHTML("beforeend", `<button class="protyle-gutters__line" data-type="gutterLineBefore" style="display:none"></button><button class="protyle-gutters__line" data-type="gutterLineAfter" style="display:none"></button><button class="protyle-gutters__plus ariaLabel" data-type="gutterPlusBefore" data-position="4west" aria-label="${window.siyuan.languages.insertBefore}" style="display:none"><svg><use xlink:href="#iconAdd"></use></svg></button><button class="protyle-gutters__plus ariaLabel" data-type="gutterPlusAfter" data-position="4west" aria-label="${window.siyuan.languages.insertAfter}" style="display:none"><svg><use xlink:href="#iconAdd"></use></svg></button>`);
        }
    }
}

// 仅声明调用所需的最小接口，避免在 gutter 中 import AgentChat 类而引入
// gutter → AgentChat → platformUtils → compatibility → gutter 的循环依赖（TDZ）。
interface AgentChatLike {
    insertBlockMentions: (mentions: Array<{ id: string; label: string }>) => void;
}

// 将选中的块以 @ 引用形式追加到智能体会话发送框末尾，等价于拖拽块到发送框或在框内 @ 搜索选块。
// 仅桌面端可用：智能体面板（dock）在移动端不存在。
/// #if !MOBILE
export const addBlockToAgent = async (blockIds: string[]) => {
    const ids = blockIds.filter(Boolean);
    if (ids.length === 0) {
        return;
    }
    const dock = getDockByType("agentChat");
    if (!dock) {
        return;
    }
    // 智能体面板首次打开前 dock.data.agentChat 是占位值（非 AgentChat 实例）。
    const isReady = (m: unknown): m is AgentChatLike =>
        !!m && typeof (m as AgentChatLike).insertBlockMentions === "function";
    let agentChat = dock.data.agentChat;
    // 实例未就绪（面板从未打开）或面板被折叠时，先 toggleModel 打开/展开：
    // show=true 既会同步 new AgentChat() 构造常驻实例，也会把折叠的面板重新展开。
    const dockItem = document.querySelector(".dock__item[data-type=\"agentChat\"]");
    const isCollapsed = !dockItem || !dockItem.classList.contains("dock__item--active");
    if (!isReady(agentChat) || isCollapsed) {
        dock.toggleModel("agentChat", true);
        agentChat = dock.data.agentChat;
    }
    if (!isReady(agentChat)) {
        // 极端情况下实例仍未就绪，放弃插入避免报错。
        return;
    }
    // 用 getRefText API 并行获取每个块的引用文本作为 label（与 @ 搜索、拖拽一致），失败时回退到 blockId。
    const mentions: Array<{ id: string; label: string }> = [];
    await Promise.all(ids.map(async (id) => {
        let label = id;
        try {
            const resp = await fetchSyncPost("/api/block/getRefText", {id});
            if (resp && resp.data) {
                label = resp.data;
            }
        } catch {
            label = id;
        }
        mentions.push({id, label});
    }));
    agentChat.insertBlockMentions(mentions);
};
/// #endif
