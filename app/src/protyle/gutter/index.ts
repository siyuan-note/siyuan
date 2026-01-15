import {
    hasClosestBlock,
    hasClosestByClassName,
    hasClosestByTag,
    hasTopClosestByClassName,
    isInAVBlock,
    isInEmbedBlock
} from "../util/hasClosest";
import {getIconByType} from "../../editor/getIcon";
import {enterBack, iframeMenu, setFold, tableMenu, videoMenu, zoomOut} from "../../menus/protyle";
import {MenuItem} from "../../menus/Menu";
import {copySubMenu, openAttr, openFileAttr, openWechatNotify} from "../../menus/commonMenuItem";
import {
    copyPlainText,
    isInAndroid,
    isInHarmony,
    isMac,
    isOnlyMeta,
    openByMobile,
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
import {getContenteditableElement, getParentBlock, getTopAloneElement, isNotEditBlock} from "../wysiwyg/getBlock";
import * as dayjs from "dayjs";
import {fetchPost} from "../../util/fetch";
import {cancelSB, genEmptyElement, getLangByType, insertEmptyBlock, jumpToParent,} from "../../block/util";
import {countBlockWord} from "../../layout/status";
import {Constants} from "../../constants";
import {mathRender} from "../render/mathRender";
import {duplicateBlock} from "../wysiwyg/commonHotkey";
import {movePathTo, useShell} from "../../util/pathName";
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
import * as path from "path";
/// #endif
import {hideMessage, showMessage} from "../../dialog/message";
import {checkFold} from "../../util/noRelyPCFunction";
import {clearSelect} from "../util/clear";

export class Gutter {
    public element: HTMLElement;
    private gutterTip: string;

    constructor(protyle: IProtyle) {
        if (isMac()) {
            this.gutterTip = window.siyuan.languages.gutterTip.replace("⌥→", updateHotkeyAfterTip(window.siyuan.config.keymap.general.enter.custom, "/"))
                .replace("⌘↑", updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.collapse.custom, "/"))
                .replace("⌥⌘A", updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.attr.custom, "/"));
        } else {
            this.gutterTip = window.siyuan.languages.gutterTip.replace("⌥→", updateHotkeyAfterTip(window.siyuan.config.keymap.general.enter.custom, "/"))
                .replace("⌘↑", updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.collapse.custom, "/"))
                .replace("⌥⌘A", updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.attr.custom, "/"))
                .replace(/⌘/g, "Ctrl+").replace(/⌥/g, "Alt+").replace(/⇧/g, "Shift+").replace(/⌃/g, "Ctrl+");
        }
        if (protyle.options.backlinkData) {
            this.gutterTip = this.gutterTip.replace(window.siyuan.languages.enter, window.siyuan.languages.openBy);
        }
        this.element = document.createElement("div");
        this.element.className = "protyle-gutters";
        this.element.addEventListener("dragstart", (event: DragEvent & { target: HTMLElement }) => {
            hideTooltip();
            window.siyuan.menus.menu.remove();
            const buttonElement = event.target.parentElement;
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
            event.dataTransfer.setDragImage(ghostElement, 0, 0);
            setTimeout(() => {
                ghostElement.remove();
            });
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
        });
        this.element.addEventListener("click", (event: MouseEvent & { target: HTMLInputElement }) => {
            const buttonElement = hasClosestByTag(event.target, "BUTTON");
            if (!buttonElement) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            hideTooltip();
            clearSelect(["av", "img"], protyle.wysiwyg.element);
            const id = buttonElement.getAttribute("data-node-id");
            if (!id) {
                if (buttonElement.getAttribute("disabled")) {
                    return;
                }
                buttonElement.setAttribute("disabled", "disabled");
                let foldElement: Element;
                Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${(buttonElement.previousElementSibling || buttonElement.nextElementSibling).getAttribute("data-node-id")}"]`)).find(item => {
                    if (!isInEmbedBlock(item) && this.isMatchNode(item)) {
                        foldElement = item;
                        return true;
                    }
                });
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
                let foldElement: Element;
                Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${id}"]`)).find(item => {
                    if (!isInEmbedBlock(item) && this.isMatchNode(item)) {
                        foldElement = item;
                        return true;
                    }
                });
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
            } else if (event.shiftKey && !protyle.disabled) {
                // 不使用 window.siyuan.shiftIsPressed ，否则窗口未激活时按 Shift 点击块标无法打开属性面板 https://github.com/siyuan-note/siyuan/issues/15075
                openAttr(protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`), "bookmark", protyle);
            } else if (!window.siyuan.ctrlIsPressed && !window.siyuan.altIsPressed && !window.siyuan.shiftIsPressed) {
                this.renderMenu(protyle, buttonElement);
                // https://ld246.com/article/1648433751993
                if (!protyle.toolbar.range) {
                    protyle.toolbar.range = getEditorRange(protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`) || protyle.wysiwyg.element.firstElementChild);
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
                clearSelect(["av", "img"], protyle.wysiwyg.element);
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
                            protyle.wysiwyg.element.querySelector(`[data-node-id="${buttonElement.getAttribute("data-node-id")}"]`) ||
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
        this.element.addEventListener("mouseleave", (event: MouseEvent & { target: HTMLInputElement }) => {
            Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl, .av__row--hl")).forEach(item => {
                item.classList.remove("protyle-wysiwyg--hl", "av__row--hl");
            });
            event.preventDefault();
            event.stopPropagation();
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
                icon: "iconRefresh",
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
                label: window.siyuan.languages.ai,
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
        if (!window.siyuan.config.readonly) {
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
        const selectsElement = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
        if (selectsElement.length > 1) {
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

        let nodeElement: Element;
        if (buttonElement.tagName === "BUTTON") {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${id}"]`)).find(item => {
                if (!isInEmbedBlock(item) && this.isMatchNode(item)) {
                    nodeElement = item;
                    return true;
                }
            });
        } else {
            nodeElement = buttonElement;
        }
        if (!nodeElement) {
            return;
        }
        const type = nodeElement.getAttribute("data-type");
        const subType = nodeElement.getAttribute("data-subtype");
        const turnIntoSubmenu: IMenu[] = [];
        hideElements(["select"], protyle);
        nodeElement.classList.add("protyle-wysiwyg--select");
        countBlockWord([id], protyle.block.rootID);
        // "heading1-6", "list", "ordered-list", "check", "quote", "code", "table", "line", "math", "paragraph"
        if (type === "NodeParagraph" && !protyle.disabled) {
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
        } else if (type === "NodeHeading" && !protyle.disabled) {
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
        } else if (type === "NodeList" && !protyle.disabled) {
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
        } else if (type === "NodeBlockquote" && !protyle.disabled) {
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
        } else if (type === "NodeCallout" && !protyle.disabled) {
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
        if (turnIntoSubmenu.length > 0 && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "turnInto",
                icon: "iconRefresh",
                label: window.siyuan.languages.turnInto,
                type: "submenu",
                submenu: turnIntoSubmenu
            }).element);
        }
        if (!protyle.disabled && !nodeElement.classList.contains("hr")) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "ai",
                icon: "iconSparkles",
                label: window.siyuan.languages.ai,
                accelerator: window.siyuan.config.keymap.editor.general.ai.custom,
                click() {
                    AIActions([nodeElement], protyle);
                }
            }).element);
        }

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
            if (!protyle.disabled) {
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
        } else if (!protyle.disabled) {
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
        if (!protyle.disabled) {
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
            window.siyuan.menus.menu.append(new MenuItem({
                id: "addToDatabase",
                icon: "iconDatabase",
                label: window.siyuan.languages.addToDatabase,
                accelerator: window.siyuan.config.keymap.general.addToDatabase.custom,
                click: () => {
                    addEditorToDatabase(protyle, getEditorRange(nodeElement));
                }
            }).element);
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
            window.siyuan.menus.menu.append(new MenuItem({
                id: "cancelSuperBlock",
                label: window.siyuan.languages.cancel + " " + window.siyuan.languages.superBlock,
                accelerator: window.siyuan.config.keymap.editor.general[isCol ? "hLayout" : "vLayout"].custom,
                async click() {
                    const sbData = await cancelSB(protyle, nodeElement);
                    transaction(protyle, sbData.doOperations, sbData.undoOperations);
                    focusBlock(protyle.wysiwyg.element.querySelector(`[data-node-id="${sbData.previousId}"]`));
                    hideElements(["gutter"], protyle);
                }
            }).element);
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
                    updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
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
                            hideMessage(msgId);
                            openByMobile(response.data.path);
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
                            updateTransaction(protyle, id, nodeElement.outerHTML, html);
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
            const cellElement = hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH");
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
                        openByMobile(response.data.zip);
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "showDatabaseInFolder",
                icon: "iconFolder",
                label: window.siyuan.languages.showInFolder,
                click() {
                    useShell("showItemInFolder", path.join(window.siyuan.config.system.dataDir, "storage", "av", nodeElement.getAttribute("data-av-id")) + ".json");
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
                icon: "iconLanguage",
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
                            window.JSAndroid.writeHTMLClipboard(protyle.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
                        } else if (isInHarmony()) {
                            window.JSHarmony.writeHTMLClipboard(protyle.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
                        } else {
                            writeText(response.data + Constants.ZWSP);
                        }
                    });
                }
            }).element);
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
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
        if (!protyle.options.backlinkData) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "enter",
                accelerator: `${window.siyuan.config.keymap.general.enter.custom ? updateHotkeyTip(window.siyuan.config.keymap.general.enter.custom) + "/" : ""}${updateHotkeyAfterTip("⌘" + window.siyuan.languages.click)}`,
                label: window.siyuan.languages.enter,
                click: () => {
                    zoomOut({protyle, id});
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "enterBack",
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
        if (!protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "insertBefore",
                icon: "iconBefore",
                label: window.siyuan.languages.insertBefore,
                accelerator: window.siyuan.config.keymap.editor.general.insertBefore.custom,
                click() {
                    hideElements(["select"], protyle);
                    countBlockWord([], protyle.block.rootID);
                    insertEmptyBlock(protyle, "beforebegin", id);
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
                    insertEmptyBlock(protyle, "afterend", id);
                }
            }).element);
            const countElement = nodeElement.lastElementChild.querySelector(".protyle-attr--refcount");
            if (countElement && countElement.textContent) {
                transferBlockRef(id);
            }
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "jumpTo",
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
            window.siyuan.menus.menu.append(new MenuItem({
                id: "fold",
                label: window.siyuan.languages.fold,
                accelerator: `${updateHotkeyTip(window.siyuan.config.keymap.editor.general.collapse.custom)}/${updateHotkeyTip("⌥" + window.siyuan.languages.click)}`,
                click() {
                    setFold(protyle, nodeElement);
                    focusBlock(nodeElement);
                }
            }).element);
            if (!protyle.disabled) {
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
        if (type !== "NodeThematicBreak" && !window.siyuan.config.readonly) {
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

        if (protyle?.app?.plugins) {
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
        window.siyuan.menus.menu.append(new MenuItem({
            id: "layout",
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
                icon: "iconMenu",
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
                label: window.siyuan.languages.ltr,
                accelerator: window.siyuan.config.keymap.editor.general.ltr.custom,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.direction = "ltr";
                    });
                }
            }, {
                id: "rtl",
                icon: "iconRtl",
                label: window.siyuan.languages.rtl,
                accelerator: window.siyuan.config.keymap.editor.general.rtl.custom,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        if (!e.classList.contains("av")) {
                            e.style.direction = "rtl";
                        }
                    });
                }
            }, {
                id: "separator_2",
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
            undoOperations.push({
                action: "update",
                id: e.getAttribute("data-node-id"),
                data: e.outerHTML
            });
        });
        inputElement.addEventListener(inputElement.type === "number" ? "blur" : "change", () => {
            nodeElements.forEach((e: HTMLElement) => {
                operations.push({
                    action: "update",
                    id: e.getAttribute("data-node-id"),
                    data: e.outerHTML
                });
            });
            transaction(protyle, operations, undoOperations);
            window.siyuan.menus.menu.remove();
            focusBlock(nodeElements[0]);
        });
    }

    private genWidths(nodeElements: Element[], protyle: IProtyle) {
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
        while (nodeElement) {
            let parentElement = hasClosestBlock(nodeElement.parentElement);
            if (!isInEmbedBlock(nodeElement)) {
                let type;
                if (!hideParent) {
                    type = nodeElement.getAttribute("data-type");
                }
                let dataNodeId = nodeElement.getAttribute("data-node-id");
                if (type === "NodeAttributeView" && target) {
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
                        if (target && type === "NodeCallout" && hasTopClosestByClassName(target, "callout-info")) {
                            // Callout 标题需显示
                        } else {
                            return;
                        }
                    }

                    let topElement = getTopAloneElement(nodeElement);
                    // 提示下方仅有单个列表
                    if (topElement.classList.contains("callout") && !nodeElement.classList.contains("callout") &&
                        getParentBlock(nodeElement) !== topElement) {
                        topElement = topElement.querySelector("[data-node-id]");
                    }
                    listItem = topElement.querySelector(".li") || topElement.querySelector(".list");
                    // 嵌入块中有列表时块标显示位置错误 https://github.com/siyuan-note/siyuan/issues/6254
                    if (isInEmbedBlock(listItem) || isInAVBlock(listItem) || hasClosestByClassName(nodeElement, "callout")) {
                        listItem = undefined;
                    }
                    // 标题（除列表下的）、提示下的块必须显示
                    if (topElement !== nodeElement && type !== "NodeHeading" && !hasClosestByClassName(nodeElement, "callout")) {
                        nodeElement = topElement;
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
                let gutterTip = this.gutterTip;
                if (protyle.disabled) {
                    gutterTip = this.gutterTip.split("<br>").splice(0, 2).join("<br>");
                }

                let popoverHTML = "";
                if (protyle.options.backlinkData) {
                    popoverHTML = `class="popover__block" data-id="${dataNodeId}"`;
                }
                const buttonHTML = `<button class="ariaLabel" data-position="parentW" aria-label="${gutterTip}" 
data-type="${type}" data-subtype="${nodeElement.getAttribute("data-subtype")}" data-node-id="${dataNodeId}">
    <svg><use xlink:href="#${getIconByType(type, nodeElement.getAttribute("data-subtype"))}"></use></svg>
    <span ${popoverHTML} ${protyle.disabled ? "" : 'draggable="true"'}></span>
</button>`;
                if (!hideParent) {
                    html = buttonHTML + html;
                }
                let foldHTML = "";
                if (type === "NodeListItem" && nodeElement.childElementCount > 3 || type === "NodeHeading") {
                    const fold = nodeElement.getAttribute("fold");
                    foldHTML = `<button class="ariaLabel" data-position="parentW" aria-label="${window.siyuan.languages.fold}" 
data-type="fold" style="cursor:inherit;"><svg style="width: 10px${fold && fold === "1" ? "" : ";transform:rotate(90deg)"}"><use xlink:href="#iconPlay"></use></svg></button>`;
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
                    space += 8;
                }
                if ((nodeElement.previousElementSibling && nodeElement.previousElementSibling.getAttribute("data-node-id")) ||
                    nodeElement.parentElement.classList.contains("callout-content")) {
                    // 前一个块存在时，只显示到当前层级
                    hideParent = true;
                    // 由于折叠块的第二个子块在界面上不显示，因此移除块标 https://github.com/siyuan-note/siyuan/issues/14304
                    if (parentElement && parentElement.getAttribute("fold") === "1") {
                        return;
                    }
                    // 列表项中的引述块中的第二个段落块块标和引述块左侧样式重叠
                    if (parentElement && ["NodeBlockquote", "NodeCallout"].includes(parentElement.getAttribute("data-type"))) {
                        space += 8;
                    }
                }
            }

            if (parentElement) {
                nodeElement = parentElement;
            } else {
                break;
            }
        }
        let match = true;
        const buttonsElement = this.element.querySelectorAll("button");
        if (buttonsElement.length !== html.split("</button>").length - 1) {
            match = false;
        } else {
            Array.from(buttonsElement).find(item => {
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
        const contentTop = protyle.contentElement.getBoundingClientRect().top;
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
        this.element.style.top = `${Math.max(rect.top, contentTop) + marginHeight}px`;
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
    }
}
