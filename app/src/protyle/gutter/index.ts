import {hasClosestBlock, hasClosestByAttribute, hasClosestByMatchTag, hasClosestByTag} from "../util/hasClosest";
import {getIconByType} from "../../editor/getIcon";
import {iframeMenu, setFold, tableMenu, videoMenu, zoomOut} from "../../menus/protyle";
import {MenuItem} from "../../menus/Menu";
import {copySubMenu, openAttr, openWechatNotify} from "../../menus/commonMenuItem";
import {copyPlainText, updateHotkeyTip, writeText} from "../util/compatibility";
import {
    transaction,
    turnsIntoOneTransaction,
    turnsIntoTransaction,
    updateBatchTransaction,
    updateTransaction
} from "../wysiwyg/transaction";
import {removeBlock} from "../wysiwyg/remove";
import {focusBlock, focusByRange, focusByWbr, getEditorRange} from "../util/selection";
import {hideElements} from "../ui/hideElements";
import {processRender} from "../util/processCode";
import {highlightRender} from "../render/highlightRender";
import {blockRender} from "../render/blockRender";
import {removeEmbed} from "../wysiwyg/removeEmbed";
import {getContenteditableElement, getTopAloneElement, isNotEditBlock} from "../wysiwyg/getBlock";
import * as dayjs from "dayjs";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {cancelSB, insertEmptyBlock, jumpToParentNext} from "../../block/util";
import {countBlockWord} from "../../layout/status";
/// #if !MOBILE
import {openFileById} from "../../editor/util";
/// #endif
import {Constants} from "../../constants";
import {openMobileFileById} from "../../mobile/editor";
import {mathRender} from "../render/mathRender";
import {duplicateBlock} from "../wysiwyg/commonHotkey";
import {movePathTo} from "../../util/pathName";
import {hintMoveBlock} from "../hint/extend";
import {makeCard, quickMakeCard} from "../../card/makeCard";
import {transferBlockRef} from "../../menus/block";
import {isMobile} from "../../util/functions";
import {AIActions} from "../../ai/actions";
import {activeBlur} from "../../mobile/util/keyboardToolbar";
import {hideTooltip} from "../../dialog/tooltip";
import {appearanceMenu} from "../toolbar/Font";
import {setPosition} from "../../util/setPosition";
import {avRender} from "../render/av/render";
import {emitOpenMenu} from "../../plugin/EventBus";

export class Gutter {
    public element: HTMLElement;

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.className = "protyle-gutters";
        if (/Mac/.test(navigator.platform) || navigator.platform === "iPhone") {
            this.element.setAttribute("aria-label", window.siyuan.languages.gutterTip);
        } else {
            this.element.setAttribute("aria-label", window.siyuan.languages.gutterTip.replace(/⌘/g, "Ctrl+").replace(/⌥/g, "Alt+").replace(/⇧/g, "Shift+").replace(/⌃/g, "Ctrl+"));
        }
        this.element.setAttribute("data-type", "a");
        this.element.setAttribute("data-position", "right");
        this.element.addEventListener("dragstart", (event: DragEvent & { target: HTMLElement }) => {
            hideTooltip();
            let selectIds: string[] = [event.target.getAttribute("data-node-id")];
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                selectIds = [];
                selectElements.forEach(item => {
                    selectIds.push(item.getAttribute("data-node-id"));
                });
            }
            if (selectElements.length === 0) {
                event.dataTransfer.setDragImage(protyle.wysiwyg.element.querySelector(`[data-node-id="${selectIds[0]}"]`), 0, 0);
            }
            event.target.style.opacity = "0.1";
            window.siyuan.dragElement = protyle.wysiwyg.element;
            event.dataTransfer.setData(`${Constants.SIYUAN_DROP_GUTTER}${event.target.getAttribute("data-type")}${Constants.ZWSP}${event.target.getAttribute("data-subtype")}${Constants.ZWSP}${selectIds}`,
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
            const id = buttonElement.getAttribute("data-node-id");
            if (!id) {
                if (buttonElement.getAttribute("disabled")) {
                    return;
                }
                buttonElement.setAttribute("disabled", "disabled");
                let foldElement: Element;
                Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${(buttonElement.previousElementSibling || buttonElement.nextElementSibling).getAttribute("data-node-id")}"]`)).find(item => {
                    if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed") &&
                        this.isMatchNode(item)) {
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
                                        data: JSON.stringify({fold: hasFold ? "0" : "1"})
                                    });
                                    undoOperations.push({
                                        action: "setAttrs",
                                        id: listId,
                                        data: JSON.stringify({fold: hasFold ? "1" : "0"})
                                    });
                                }
                            });
                        }
                    });
                    transaction(protyle, doOperations, undoOperations);
                    buttonElement.removeAttribute("disabled");
                } else {
                    const foldStatus = setFold(protyle, foldElement);
                    if (foldStatus === "1") {
                        (buttonElement.firstElementChild as HTMLElement).style.transform = "";
                    } else if (foldStatus === "0") {
                        (buttonElement.firstElementChild as HTMLElement).style.transform = "rotate(90deg)";
                    }
                }
                hideElements(["select"], protyle);
                window.siyuan.menus.menu.remove();
                return;
            }
            if (event.ctrlKey || event.metaKey) {
                zoomOut({protyle, id});
            } else if (event.altKey) {
                let foldElement: Element;
                Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${id}"]`)).find(item => {
                    if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed") &&
                        this.isMatchNode(item)) {
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
                                data: JSON.stringify({fold: hasFold ? "0" : "1"})
                            });
                            undoOperations.push({
                                action: "setAttrs",
                                id: listId,
                                data: JSON.stringify({fold: hasFold ? "1" : "0"})
                            });
                        }
                    });
                    transaction(protyle, doOperations, undoOperations);
                } else {
                    setFold(protyle, foldElement);
                }
                foldElement.classList.remove("protyle-wysiwyg--hl");
            } else if (window.siyuan.shiftIsPressed && !protyle.disabled) {
                openAttr(protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`), protyle);
            } else {
                this.renderMenu(protyle, buttonElement);
                // https://ld246.com/article/1648433751993
                if (!protyle.toolbar.range) {
                    protyle.toolbar.range = getEditorRange(protyle.wysiwyg.element.firstElementChild);
                }
                if (isMobile()) {
                    window.siyuan.menus.menu.fullscreen();
                } else {
                    window.siyuan.menus.menu.popup({x: event.clientX - 16, y: event.clientY - 16}, true);
                    focusByRange(protyle.toolbar.range);
                }
            }
        });
        this.element.addEventListener("contextmenu", (event: MouseEvent & { target: HTMLInputElement }) => {
            const buttonElement = hasClosestByTag(event.target, "BUTTON");
            if (!buttonElement || protyle.disabled || buttonElement.getAttribute("data-type") === "fold") {
                return;
            }
            if (!window.siyuan.ctrlIsPressed && !window.siyuan.altIsPressed && !window.siyuan.shiftIsPressed) {
                this.renderMenu(protyle, buttonElement);
                window.siyuan.menus.menu.popup({x: event.clientX - 16, y: event.clientY - 16}, true);
            }
            event.preventDefault();
            event.stopPropagation();
        });
        this.element.addEventListener("mouseover", (event: MouseEvent & { target: HTMLInputElement }) => {
            const buttonElement = hasClosestByTag(event.target, "BUTTON");
            if (!buttonElement) {
                return;
            }
            if (buttonElement.getAttribute("data-type") === "fold") {
                Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl")).forEach(hlItem => {
                    hlItem.classList.remove("protyle-wysiwyg--hl");
                });
                return;
            }
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${buttonElement.getAttribute("data-node-id")}"]`)).find(item => {
                if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed") && this.isMatchNode(item)) {
                    Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl")).forEach(hlItem => {
                        if (!item.isSameNode(hlItem)) {
                            hlItem.classList.remove("protyle-wysiwyg--hl");
                        }
                    });
                    item.classList.add("protyle-wysiwyg--hl");
                    return true;
                }
            });
            event.preventDefault();
        });
        this.element.addEventListener("mouseleave", (event: MouseEvent & { target: HTMLInputElement }) => {
            Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl")).forEach(item => {
                item.classList.remove("protyle-wysiwyg--hl");
            });
            event.preventDefault();
            event.stopPropagation();
        });
    }

    private isMatchNode(item: Element) {
        const itemRect = item.getBoundingClientRect();
        let gutterTop = this.element.getBoundingClientRect().top + 4;
        if (itemRect.height < Math.floor(window.siyuan.config.editor.fontSize * 1.625) + 8) {
            gutterTop = gutterTop - (itemRect.height - this.element.clientHeight) / 2;
        }
        return itemRect.top <= gutterTop && itemRect.bottom >= gutterTop;
    }

    private turnsOneInto(options: {
        icon: string,
        label: string,
        protyle: IProtyle,
        nodeElement: Element,
        accelerator?: string
        id: string,
        type: string,
        level?: number
    }) {
        return {
            icon: options.icon,
            label: options.label,
            accelerator: options.accelerator,
            async click() {
                if (!options.nodeElement.querySelector("wbr")) {
                    getContenteditableElement(options.nodeElement)?.insertAdjacentHTML("afterbegin", "<wbr>");
                }
                if (options.type === "CancelList" || options.type === "CancelBlockquote") {
                    for await(const item of options.nodeElement.querySelectorAll('[data-type="NodeHeading"][fold="1"]')) {
                        const itemId = item.getAttribute("data-node-id");
                        item.removeAttribute("fold");
                        const response = await fetchSyncPost("/api/transactions", {
                            session: options.protyle.id,
                            app: Constants.SIYUAN_APPID,
                            transactions: [{
                                doOperations: [{
                                    action: "unfoldHeading",
                                    id: itemId,
                                }],
                                undoOperations: [{
                                    action: "foldHeading",
                                    id: itemId
                                }],
                            }]
                        });
                        options.protyle.undo.add([{
                            action: "unfoldHeading",
                            id: itemId,
                        }], [{
                            action: "foldHeading",
                            id: itemId
                        }]);
                        item.insertAdjacentHTML("afterend", response.data[0].doOperations[0].retData);
                    }
                }
                const oldHTML = options.nodeElement.outerHTML;
                const previousId = options.nodeElement.previousElementSibling?.getAttribute("data-node-id");
                const parentId = options.nodeElement.parentElement.getAttribute("data-node-id") || options.protyle.block.parentID;
                // @ts-ignore
                const newHTML = options.protyle.lute[options.type](options.nodeElement.outerHTML, options.level);
                options.nodeElement.outerHTML = newHTML;
                if (options.type === "CancelList" || options.type === "CancelBlockquote") {
                    const tempElement = document.createElement("template");
                    tempElement.innerHTML = newHTML;
                    const doOperations: IOperation[] = [{
                        action: "delete",
                        id: options.id
                    }];
                    const undoOperations: IOperation[] = [];
                    let tempPreviousId = previousId;
                    Array.from(tempElement.content.children).forEach((item) => {
                        const tempId = item.getAttribute("data-node-id");
                        doOperations.push({
                            action: "insert",
                            data: item.outerHTML,
                            id: tempId,
                            previousID: tempPreviousId,
                            parentID: parentId
                        });
                        undoOperations.push({
                            action: "delete",
                            id: tempId
                        });
                        tempPreviousId = tempId;
                    });
                    undoOperations.push({
                        action: "insert",
                        data: oldHTML,
                        id: options.id,
                        previousID: previousId,
                        parentID: parentId
                    });
                    transaction(options.protyle, doOperations, undoOperations);
                } else {
                    updateTransaction(options.protyle, options.id, newHTML, oldHTML);
                }
                focusByWbr(options.protyle.wysiwyg.element, getEditorRange(options.protyle.wysiwyg.element));
                options.protyle.wysiwyg.element.querySelectorAll('[data-type~="block-ref"]').forEach(item => {
                    if (item.textContent === "") {
                        fetchPost("/api/block/getRefText", {id: item.getAttribute("data-id")}, (response) => {
                            item.innerHTML = response.data;
                        });
                    }
                });
                blockRender(options.protyle, options.protyle.wysiwyg.element);
                processRender(options.protyle.wysiwyg.element);
                highlightRender(options.protyle.wysiwyg.element);
                avRender(options.protyle.wysiwyg.element);
            }
        };
    }

    private turnsIntoOne(options: {
        accelerator?: string,
        icon?: string,
        label: string,
        protyle: IProtyle,
        selectsElement: Element[],
        type: string,
        level?: string
    }) {
        return {
            icon: options.icon,
            label: options.label,
            accelerator: options.accelerator,
            click() {
                turnsIntoOneTransaction(options);
            }
        };
    }

    private turnsInto(options: {
        icon?: string,
        label: string,
        protyle: IProtyle,
        selectsElement: Element[],
        type: string,
        level?: number | string,
        isContinue?: boolean
        accelerator?: string
    }) {
        return {
            icon: options.icon,
            label: options.label,
            accelerator: options.accelerator,
            click() {
                turnsIntoTransaction(options);
            }
        };
    }

    public renderMultipleMenu(protyle: IProtyle, selectsElement: Element[]) {
        let isList = false;
        let isContinue = false;
        let hasEmbedBlock = false;
        selectsElement.find((item, index) => {
            if (item.classList.contains("li")) {
                isList = true;
                return true;
            }
            if (item.classList.contains("bq") || item.classList.contains("sb") || item.classList.contains("p")) {
                hasEmbedBlock = true;
            }
            if (item.nextElementSibling && selectsElement[index + 1] &&
                item.nextElementSibling.isSameNode(selectsElement[index + 1])) {
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
                    icon: "iconList",
                    label: window.siyuan.languages.list,
                    protyle,
                    selectsElement,
                    type: "Blocks2ULs"
                }));
                turnIntoSubmenu.push(this.turnsIntoOne({
                    icon: "iconOrderedList",
                    label: window.siyuan.languages["ordered-list"],
                    protyle,
                    selectsElement,
                    type: "Blocks2OLs"
                }));
                turnIntoSubmenu.push(this.turnsIntoOne({
                    icon: "iconCheck",
                    label: window.siyuan.languages.check,
                    protyle,
                    selectsElement,
                    type: "Blocks2TLs"
                }));
                turnIntoSubmenu.push(this.turnsIntoOne({
                    icon: "iconQuote",
                    label: window.siyuan.languages.quote,
                    protyle,
                    selectsElement,
                    type: "Blocks2Blockquote"
                }));
            }
            // 多选引用转换为块的时候 id 不一致
            if (!hasEmbedBlock) {
                turnIntoSubmenu.push(this.turnsInto({
                    icon: "iconParagraph",
                    label: window.siyuan.languages.paragraph,
                    accelerator: window.siyuan.config.keymap.editor.heading.paragraph.custom,
                    protyle,
                    selectsElement,
                    type: "Blocks2Ps",
                    isContinue
                }));
            }
            turnIntoSubmenu.push(this.turnsInto({
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
                icon: "iconRefresh",
                label: window.siyuan.languages.turnInto,
                type: "submenu",
                submenu: turnIntoSubmenu
            }).element);
            if (isContinue) {
                window.siyuan.menus.menu.append(new MenuItem({
                    icon: "iconSuper",
                    label: window.siyuan.languages.merge + " " + window.siyuan.languages.superBlock,
                    type: "submenu",
                    submenu: [this.turnsIntoOne({
                        label: window.siyuan.languages.hLayout,
                        accelerator: window.siyuan.config.keymap.editor.general.hLayout.custom,
                        icon: "iconSplitLR",
                        protyle,
                        selectsElement,
                        type: "BlocksMergeSuperBlock",
                        level: "col"
                    }), this.turnsIntoOne({
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
            AIActions(selectsElement, protyle);
        }
        const copyMenu: IMenu[] = [{
            label: window.siyuan.languages.copy,
            accelerator: "⌘C",
            click() {
                if (isNotEditBlock(selectsElement[0])) {
                    let html = "";
                    selectsElement.forEach(item => {
                        html += removeEmbed(item);
                    });
                    writeText(protyle.lute.BlockDOM2StdMd(html).trimEnd());
                } else {
                    focusByRange(getEditorRange(selectsElement[0]));
                    document.execCommand("copy");
                }
            }
        }, {
            label: window.siyuan.languages.copyPlainText,
            accelerator: window.siyuan.config.keymap.editor.general.copyPlainText.custom,
            click() {
                let html = "";
                selectsElement.forEach(item => {
                    item.querySelectorAll("[spellcheck]").forEach(editItem => {
                        const cloneNode = editItem.cloneNode(true) as HTMLElement;
                        cloneNode.querySelectorAll('[data-type="backslash"]').forEach(slashItem => {
                            slashItem.firstElementChild.remove();
                        });
                        html += cloneNode.textContent + "\n";
                    });
                });
                copyPlainText(html.trimEnd());
            }
        }, {
            label: window.siyuan.languages.duplicate,
            accelerator: window.siyuan.config.keymap.editor.general.duplicate.custom,
            disabled: protyle.disabled,
            click() {
                duplicateBlock(selectsElement, protyle);
            }
        }];
        const copyTextRefMenu = this.genCopyTextRef(selectsElement);
        if (copyTextRefMenu) {
            copyMenu.splice(2, 0, copyTextRefMenu);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
            type: "submenu",
            submenu: copyMenu,
        }).element);
        if (protyle.disabled) {
            return;
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.cut,
            accelerator: "⌘X",
            icon: "iconCut",
            click: () => {
                if (isNotEditBlock(selectsElement[0])) {
                    let html = "";
                    selectsElement.forEach(item => {
                        html += removeEmbed(item);
                    });
                    writeText(protyle.lute.BlockDOM2StdMd(html).trimEnd());
                    protyle.breadcrumb?.hide();
                    removeBlock(protyle, selectsElement[0], getEditorRange(selectsElement[0]));
                } else {
                    focusByRange(getEditorRange(selectsElement[0]));
                    document.execCommand("cut");
                }
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.move,
            accelerator: window.siyuan.config.keymap.general.move.custom,
            icon: "iconMove",
            click: () => {
                movePathTo((toPath) => {
                    hintMoveBlock(toPath[0], selectsElement, protyle);
                });
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.delete,
            icon: "iconTrashcan",
            accelerator: "⌫",
            click: () => {
                protyle.breadcrumb?.hide();
                removeBlock(protyle, selectsElement[0], getEditorRange(selectsElement[0]));
            }
        }).element);

        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        const appearanceElement = new MenuItem({
            label: window.siyuan.languages.appearance,
            icon: "iconFont",
            accelerator: window.siyuan.config.keymap.editor.insert.appearance.custom,
            click() {
                protyle.toolbar.element.classList.add("fn__none");
                protyle.toolbar.subElement.innerHTML = "";
                protyle.toolbar.subElement.style.width = "";
                protyle.toolbar.subElement.style.padding = "";
                protyle.toolbar.subElement.append(appearanceMenu(protyle, selectsElement));
                protyle.toolbar.subElement.classList.remove("fn__none");
                protyle.toolbar.subElementCloseCB = undefined;
                /// #if !MOBILE
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
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.quickMakeCard,
            accelerator: window.siyuan.config.keymap.editor.general.quickMakeCard.custom,
            iconHTML: '<svg class="b3-menu__icon" style="color:var(--b3-theme-primary)"><use xlink:href="#iconRiffCard"></use></svg>',
            icon: "iconRiffCard",
            click() {
                quickMakeCard(protyle, selectsElement);
            }
        }).element);
        if (window.siyuan.config.flashcard.deck) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.addToDeck,
                icon: "iconRiffCard",
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
                plugins:protyle.app.plugins,
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
        hideElements(["util", "toolbar", "hint"], protyle);
        window.siyuan.menus.menu.remove();
        if (isMobile()) {
            activeBlur();
        }
        const id = buttonElement.getAttribute("data-node-id");
        const selectsElement = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
        if (selectsElement.length > 1) {
            const match = Array.from(selectsElement).find(item => {
                if (id === item.getAttribute("data-node-id")) {
                    return true;
                }
            });
            if (match) {
                return this.renderMultipleMenu(protyle, Array.from(selectsElement));
            }
        }

        let nodeElement: Element;
        if (buttonElement.tagName === "BUTTON") {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${id}"]`)).find(item => {
                if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed") &&
                    this.isMatchNode(item)) {
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
                icon: "iconList",
                label: window.siyuan.languages.list,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2ULs"
            }));
            turnIntoSubmenu.push(this.turnsIntoOne({
                icon: "iconOrderedList",
                label: window.siyuan.languages["ordered-list"],
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2OLs"
            }));
            turnIntoSubmenu.push(this.turnsIntoOne({
                icon: "iconCheck",
                label: window.siyuan.languages.check,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2TLs"
            }));
            turnIntoSubmenu.push(this.turnsIntoOne({
                icon: "iconQuote",
                label: window.siyuan.languages.quote,
                protyle,
                selectsElement: [nodeElement],
                type: "Blocks2Blockquote"
            }));
            turnIntoSubmenu.push(this.turnsInto({
                icon: "iconH1",
                label: window.siyuan.languages.heading1,
                accelerator: window.siyuan.config.keymap.editor.heading.heading1.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 1,
                type: "Blocks2Hs",
            }));
            turnIntoSubmenu.push(this.turnsInto({
                icon: "iconH2",
                label: window.siyuan.languages.heading2,
                accelerator: window.siyuan.config.keymap.editor.heading.heading2.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 2,
                type: "Blocks2Hs",
            }));
            turnIntoSubmenu.push(this.turnsInto({
                icon: "iconH3",
                label: window.siyuan.languages.heading3,
                accelerator: window.siyuan.config.keymap.editor.heading.heading3.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 3,
                type: "Blocks2Hs",
            }));
            turnIntoSubmenu.push(this.turnsInto({
                icon: "iconH4",
                label: window.siyuan.languages.heading4,
                accelerator: window.siyuan.config.keymap.editor.heading.heading4.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 4,
                type: "Blocks2Hs",
            }));
            turnIntoSubmenu.push(this.turnsInto({
                icon: "iconH5",
                label: window.siyuan.languages.heading5,
                accelerator: window.siyuan.config.keymap.editor.heading.heading5.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 5,
                type: "Blocks2Hs",
            }));
            turnIntoSubmenu.push(this.turnsInto({
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
                icon: "iconParagraph",
                label: window.siyuan.languages.paragraph,
                accelerator: window.siyuan.config.keymap.editor.heading.paragraph.custom,
                protyle,
                selectsElement: [nodeElement],
                level: 6,
                type: "Blocks2Ps",
            }));
            if (subType !== "h1") {
                turnIntoSubmenu.push(this.turnsInto({
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
                icon: "iconParagraph",
                label: window.siyuan.languages.paragraph,
                protyle,
                nodeElement,
                id,
                type: "CancelList"
            }));
            if (nodeElement.getAttribute("data-subtype") === "o") {
                turnIntoSubmenu.push(this.turnsOneInto({
                    icon: "iconList",
                    label: window.siyuan.languages.list,
                    protyle,
                    nodeElement,
                    id,
                    type: "OL2UL"
                }));
                turnIntoSubmenu.push(this.turnsOneInto({
                    icon: "iconCheck",
                    label: window.siyuan.languages.check,
                    protyle,
                    nodeElement,
                    id,
                    type: "UL2TL"
                }));
            } else if (nodeElement.getAttribute("data-subtype") === "t") {
                turnIntoSubmenu.push(this.turnsOneInto({
                    icon: "iconList",
                    label: window.siyuan.languages.list,
                    protyle,
                    nodeElement,
                    id,
                    type: "TL2UL"
                }));
                turnIntoSubmenu.push(this.turnsOneInto({
                    icon: "iconOrderedList",
                    label: window.siyuan.languages["ordered-list"],
                    protyle,
                    nodeElement,
                    id,
                    type: "TL2OL"
                }));
            } else {
                turnIntoSubmenu.push(this.turnsOneInto({
                    icon: "iconOrderedList",
                    label: window.siyuan.languages["ordered-list"],
                    protyle,
                    nodeElement,
                    id,
                    type: "UL2OL"
                }));
                turnIntoSubmenu.push(this.turnsOneInto({
                    icon: "iconCheck",
                    label: window.siyuan.languages.check,
                    protyle,
                    nodeElement,
                    id,
                    type: "OL2TL"
                }));
            }
        } else if (type === "NodeBlockquote" && !protyle.disabled) {
            turnIntoSubmenu.push(this.turnsOneInto({
                icon: "iconParagraph",
                label: window.siyuan.languages.paragraph,
                protyle,
                nodeElement,
                id,
                type: "CancelBlockquote"
            }));
        }
        if (turnIntoSubmenu.length > 0 && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconRefresh",
                label: window.siyuan.languages.turnInto,
                type: "submenu",
                submenu: turnIntoSubmenu
            }).element);
        }
        if (!protyle.disabled) {
            AIActions([nodeElement], protyle);
        }
        const copyMenu = (copySubMenu(id, true, nodeElement) as IMenu[]).concat([{
            label: window.siyuan.languages.copy,
            accelerator: "⌘C",
            click() {
                if (isNotEditBlock(nodeElement)) {
                    writeText(protyle.lute.BlockDOM2StdMd(removeEmbed(nodeElement)).trimEnd());
                } else {
                    focusByRange(getEditorRange(nodeElement));
                    document.execCommand("copy");
                }
            }
        }, {
            label: window.siyuan.languages.copyPlainText,
            accelerator: window.siyuan.config.keymap.editor.general.copyPlainText.custom,
            click() {
                let text = "";
                nodeElement.querySelectorAll("[spellcheck]").forEach(item => {
                    const cloneNode = item.cloneNode(true) as HTMLElement;
                    cloneNode.querySelectorAll('[data-type="backslash"]').forEach(slashItem => {
                        slashItem.firstElementChild.remove();
                    });
                    text += cloneNode.textContent + "\n";
                });
                copyPlainText(text.trimEnd());
            }
        }, {
            label: window.siyuan.languages.duplicate,
            accelerator: window.siyuan.config.keymap.editor.general.duplicate.custom,
            disabled: protyle.disabled,
            click() {
                duplicateBlock([nodeElement], protyle);
            }
        }]);
        const copyTextRefMenu = this.genCopyTextRef([nodeElement]);
        if (copyTextRefMenu) {
            copyMenu.splice(copyMenu.length - 1, 0, copyTextRefMenu);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
            type: "submenu",
            submenu: copyMenu
        }).element);
        if (!protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.cut,
                accelerator: "⌘X",
                icon: "iconCut",
                click: () => {
                    if (isNotEditBlock(nodeElement)) {
                        writeText(protyle.lute.BlockDOM2StdMd(removeEmbed(nodeElement)).trimEnd());
                        removeBlock(protyle, nodeElement, getEditorRange(nodeElement));
                        protyle.breadcrumb?.hide();
                    } else {
                        focusByRange(getEditorRange(nodeElement));
                        document.execCommand("cut");
                    }
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.move,
                accelerator: window.siyuan.config.keymap.general.move.custom,
                icon: "iconMove",
                click: () => {
                    movePathTo((toPath) => {
                        hintMoveBlock(toPath[0], [nodeElement], protyle);
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.delete,
                icon: "iconTrashcan",
                accelerator: "⌫",
                click: () => {
                    protyle.breadcrumb?.hide();
                    removeBlock(protyle, nodeElement, getEditorRange(nodeElement));
                }
            }).element);
        }
        if (type === "NodeSuperBlock" && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.cancel + " " + window.siyuan.languages.superBlock,
                click() {
                    const sbData = cancelSB(protyle, nodeElement);
                    transaction(protyle, sbData.doOperations, sbData.undoOperations);
                    focusBlock(protyle.wysiwyg.element.querySelector(`[data-node-id="${sbData.previousId}"]`));
                    hideElements(["gutter"], protyle);
                }
            }).element);
        } else if (type === "NodeCodeBlock" && !protyle.disabled && !nodeElement.getAttribute("data-subtype")) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            const linewrap = nodeElement.getAttribute("linewrap");
            const ligatures = nodeElement.getAttribute("ligatures");
            const linenumber = nodeElement.getAttribute("linenumber");

            window.siyuan.menus.menu.append(new MenuItem({
                type: "submenu",
                icon: "iconCode",
                label: window.siyuan.languages.code,
                submenu: [{
                    iconHTML: "",
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
                    iconHTML: "",
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
                    iconHTML: "",
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
                }]
            }).element);
        } else if (type === "NodeCodeBlock" && !protyle.disabled && ["echarts", "mindmap"].includes(nodeElement.getAttribute("data-subtype"))) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            const height = (nodeElement as HTMLElement).style.height;
            let html = nodeElement.outerHTML;
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.chart,
                icon: "iconCode",
                submenu: [{
                    label: `${window.siyuan.languages.height}<span class="fn__space"></span>
<input style="margin: 4px 0;width: 84px" type="number" step="1" min="148" class="b3-text-field" value="${height ? parseInt(height) : "420"}">`,
                    bind: (element) => {
                        element.querySelector("input").addEventListener("change", (event) => {
                            const newHeight = ((event.target as HTMLInputElement).value || "420") + "px";
                            (nodeElement as HTMLElement).style.height = newHeight;
                            (nodeElement.firstElementChild.nextElementSibling as HTMLElement).style.height = newHeight;
                            updateTransaction(protyle, id, nodeElement.outerHTML, html);
                            html = nodeElement.outerHTML;
                            event.stopPropagation();
                            const chartInstance = echarts.getInstanceById(nodeElement.firstElementChild.nextElementSibling.getAttribute("_echarts_instance_"));
                            if (chartInstance) {
                                chartInstance.resize();
                            }
                        });
                    }
                }, {
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
            const cellElement = hasClosestByMatchTag(range.startContainer, "TD") || hasClosestByMatchTag(range.startContainer, "TH");
            if (cellElement) {
                window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    type: "submenu",
                    icon: "iconTable",
                    label: window.siyuan.languages.table,
                    submenu: tableMenu(protyle, nodeElement, cellElement as HTMLTableCellElement, range) as IMenu[]
                }).element);
            }
        } else if ((type === "NodeVideo" || type === "NodeAudio") && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "assetSubMenu",
                type: "submenu",
                icon: type === "NodeVideo" ? "iconVideo" : "iconRecord",
                label: window.siyuan.languages.assets,
                submenu: videoMenu(protyle, nodeElement, type)
            }).element);
        } else if (type === "NodeIFrame" && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "assetSubMenu",
                type: "submenu",
                icon: "iconLanguage",
                label: window.siyuan.languages.assets,
                submenu: iframeMenu(protyle, nodeElement)
            }).element);
        } else if (type === "NodeHTMLBlock" && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconHTML5",
                label: "HTML",
                click() {
                    protyle.toolbar.showRender(protyle, nodeElement);
                }
            }).element);
        } else if (type === "NodeBlockQueryEmbed" && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            const breadcrumb = nodeElement.getAttribute("breadcrumb");
            window.siyuan.menus.menu.append(new MenuItem({
                id: "assetSubMenu",
                type: "submenu",
                icon: "iconSQL",
                label: window.siyuan.languages.blockEmbed,
                submenu: [{
                    icon: "iconRefresh",
                    label: `${window.siyuan.languages.refresh} SQL`,
                    click() {
                        nodeElement.removeAttribute("data-render");
                        blockRender(protyle, nodeElement);
                    }
                }, {
                    icon: "iconEdit",
                    label: `${window.siyuan.languages.update} SQL`,
                    click() {
                        protyle.toolbar.showRender(protyle, nodeElement);
                    }
                }, {
                    type: "separator"
                }, {
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
                    label: `<div class="fn__flex" style="margin-bottom: 4px"><span>${window.siyuan.languages.hideHeadingBelowBlocks}</span><span class="fn__space fn__flex-1"></span>
<input type="checkbox" class="b3-switch fn__flex-center"${nodeElement.getAttribute("custom-heading-mode") === "1" ? " checked" : ""}></div>`,
                    bind(element) {
                        element.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
                            const inputElement = element.querySelector("input");
                            if (event.target.tagName !== "INPUT") {
                                inputElement.checked = !inputElement.checked;
                            }
                            nodeElement.setAttribute("custom-heading-mode", inputElement.checked ? "1" : "0");
                            fetchPost("/api/attr/setBlockAttrs", {
                                id,
                                attrs: {"custom-heading-mode": inputElement.checked ? "1" : "0"}
                            });
                            nodeElement.removeAttribute("data-render");
                            blockRender(protyle, nodeElement);
                            window.siyuan.menus.menu.remove();
                        });
                    }
                }]
            }).element);
        } else if (type === "NodeHeading" && !protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
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
                type: "submenu",
                icon: "iconRefresh",
                label: window.siyuan.languages.tWithSubtitle,
                submenu: headingSubMenu
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconCopy",
                label: `${window.siyuan.languages.copy} ${window.siyuan.languages.headings1}`,
                click() {
                    fetchPost("/api/block/getHeadingChildrenDOM", {id}, (response) => {
                        writeText(response.data + Constants.ZWSP);
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconCut",
                label: `${window.siyuan.languages.cut} ${window.siyuan.languages.headings1}`,
                click() {
                    fetchPost("/api/block/getHeadingChildrenDOM", {id}, (response) => {
                        writeText(response.data + Constants.ZWSP);
                        fetchPost("/api/block/getHeadingDeleteTransaction", {
                            id,
                        }, (response) => {
                            response.data.doOperations.forEach((operation: IOperation) => {
                                protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                                    itemElement.remove();
                                });
                            });
                            transaction(protyle, response.data.doOperations, response.data.undoOperations);
                        });
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
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
                        transaction(protyle, response.data.doOperations, response.data.undoOperations);
                    });
                }
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        if (!protyle.options.backlinkData) {
            window.siyuan.menus.menu.append(new MenuItem({
                accelerator: `${updateHotkeyTip(window.siyuan.config.keymap.general.enter.custom)}/${updateHotkeyTip("⌘Click")}`,
                label: window.siyuan.languages.enter,
                click: () => {
                    zoomOut({protyle, id});
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                accelerator: window.siyuan.config.keymap.general.enterBack.custom,
                label: window.siyuan.languages.enterBack,
                click: () => {
                    if (!protyle.block.showAll) {
                        const ids = protyle.path.split("/");
                        if (ids.length > 2) {
                            /// #if MOBILE
                            openMobileFileById(protyle.app, ids[ids.length - 2], [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]);
                            /// #else
                            openFileById({
                                app: protyle.app,
                                id: ids[ids.length - 2],
                                action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]
                            });
                            /// #endif
                        }
                    } else {
                        zoomOut({protyle, id: protyle.block.parent2ID, focusId: id});
                    }
                }
            }).element);
        }
        if (!protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconBefore",
                label: window.siyuan.languages["insert-before"],
                accelerator: window.siyuan.config.keymap.editor.general.insertBefore.custom,
                click() {
                    hideElements(["select"], protyle);
                    countBlockWord([], protyle.block.rootID);
                    insertEmptyBlock(protyle, "beforebegin", id);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconAfter",
                label: window.siyuan.languages["insert-after"],
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
            label: window.siyuan.languages.jumpToParentNext,
            accelerator: window.siyuan.config.keymap.editor.general.jumpToParentNext.custom,
            click() {
                hideElements(["select"], protyle);
                jumpToParentNext(protyle, nodeElement);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);

        if (type !== "NodeThematicBreak") {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.fold,
                accelerator: `${updateHotkeyTip(window.siyuan.config.keymap.editor.general.collapse.custom)}/${updateHotkeyTip("⌥Click")}`,
                click() {
                    setFold(protyle, nodeElement);
                    focusBlock(nodeElement);
                }
            }).element);
            if (!protyle.disabled) {
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.attr,
                    accelerator: window.siyuan.config.keymap.editor.general.attr.custom + "/" + updateHotkeyTip("⇧Click"),
                    click() {
                        openAttr(nodeElement, protyle);
                    }
                }).element);
            }
        }
        if (!protyle.disabled) {
            const appearanceElement = new MenuItem({
                label: window.siyuan.languages.appearance,
                icon: "iconFont",
                accelerator: window.siyuan.config.keymap.editor.insert.appearance.custom,
                click() {
                    protyle.toolbar.element.classList.add("fn__none");
                    protyle.toolbar.subElement.innerHTML = "";
                    protyle.toolbar.subElement.style.width = "";
                    protyle.toolbar.subElement.style.padding = "";
                    protyle.toolbar.subElement.append(appearanceMenu(protyle, [nodeElement]));
                    protyle.toolbar.subElement.classList.remove("fn__none");
                    protyle.toolbar.subElementCloseCB = undefined;
                    /// #if !MOBILE
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
        }
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        if (!["NodeThematicBreak", "NodeBlockQueryEmbed", "NodeIFrame", "NodeHTMLBlock", "NodeWidget", "NodeVideo", "NodeAudio"].includes(type) &&
            getContenteditableElement(nodeElement)?.textContent.trim() !== "" &&
            (type !== "NodeCodeBlock" || (type === "NodeCodeBlock" && !nodeElement.getAttribute("data-subtype")))) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.wechatReminder,
                icon: "iconMp",
                click() {
                    openWechatNotify(nodeElement);
                }
            }).element);
        }
        if (type !== "NodeThematicBreak") {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.quickMakeCard,
                accelerator: window.siyuan.config.keymap.editor.general.quickMakeCard.custom,
                iconHTML: '<svg class="b3-menu__icon" style="color:var(--b3-theme-primary)"><use xlink:href="#iconRiffCard"></use></svg>',
                icon: "iconRiffCard",
                click() {
                    quickMakeCard(protyle, [nodeElement]);
                }
            }).element);
            if (window.siyuan.config.flashcard.deck) {
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.addToDeck,
                    icon: "iconRiffCard",
                    click() {
                        makeCard(protyle.app, [nodeElement.getAttribute("data-node-id")]);
                    }
                }).element);
            }
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        }

        if (protyle?.app?.plugins) {
            emitOpenMenu({
                plugins:protyle.app.plugins,
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
            iconHTML: Constants.ZWSP,
            type: "readonly",
            label: `${updateHTML}${window.siyuan.languages.createdAt} ${dayjs(id.substr(0, 14)).format("YYYY-MM-DD HH:mm:ss")}`,
        }).element);
        return window.siyuan.menus.menu;
    }

    private genHeadingTransform(protyle: IProtyle, id: string, level: number) {
        return {
            icon: "iconHeading" + level,
            label: window.siyuan.languages["heading" + level],
            click() {
                fetchPost("/api/block/getHeadingLevelTransaction", {
                    id,
                    level
                }, (response) => {
                    response.data.doOperations.forEach((operation: IOperation) => {
                        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                            itemElement.outerHTML = operation.data;
                        });
                        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                            mathRender(itemElement);
                        });
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
            label: window.siyuan.languages.layout,
            type: "submenu",
            submenu: [{
                label: window.siyuan.languages.alignLeft,
                icon: "iconAlignLeft",
                accelerator: window.siyuan.config.keymap.editor.general.alignLeft.custom,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.textAlign = "left";
                    });
                }
            }, {
                label: window.siyuan.languages.alignCenter,
                icon: "iconAlignCenter",
                accelerator: window.siyuan.config.keymap.editor.general.alignCenter.custom,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.textAlign = "center";
                    });
                }
            }, {
                label: window.siyuan.languages.alignRight,
                icon: "iconAlignRight",
                accelerator: window.siyuan.config.keymap.editor.general.alignRight.custom,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.textAlign = "right";
                    });
                }
            }, {
                label: window.siyuan.languages.justify,
                icon: "iconMenu",
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.textAlign = "justify";
                    });
                }
            }, {
                type: "separator"
            }, {
                label: window.siyuan.languages.ltr,
                icon: "iconLtr",
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.direction = "ltr";
                    });
                }
            }, {
                label: window.siyuan.languages.rtl,
                icon: "iconRtl",
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.direction = "rtl";
                    });
                }
            }, {
                type: "separator"
            }, {
                label: window.siyuan.languages.clearFontStyle,
                icon: "iconTrashcan",
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.textAlign = "";
                        e.style.direction = "";
                    });
                }
            }]
        }).element);
    }

    private genWidths(nodeElements: Element[], protyle: IProtyle) {
        const styles: IMenu[] = [];
        ["25%", "33%", "50%", "67%", "75%"].forEach((item) => {
            styles.push({
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
            type: "separator"
        });
        let width = 100;
        if (nodeElements.length === 1) {
            const widthStyle = (nodeElements[0] as HTMLElement).style.width;
            if (widthStyle.endsWith("%")) {
                width = parseInt(widthStyle);
            }
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.width,
            submenu: styles.concat([{
                label: `<div aria-label="${width}%" class="b3-tooltips b3-tooltips__n${isMobile() ? "" : " fn__size200"}">
    <input style="box-sizing: border-box" value="${width}" class="b3-slider fn__block" max="100" min="1" step="1" type="range">
</div>`,
                bind(element) {
                    const rangeElement = element.querySelector("input");
                    rangeElement.addEventListener("input", () => {
                        nodeElements.forEach((e) => {
                            (e as HTMLElement).style.width = rangeElement.value + "%";
                            (e as HTMLElement).style.flex = "none";
                        });
                        rangeElement.parentElement.setAttribute("aria-label", `${rangeElement.value}%`);
                    });
                    const undoOperations: IOperation[] = [];
                    const operations: IOperation[] = [];
                    nodeElements.forEach((e) => {
                        undoOperations.push({
                            action: "update",
                            id: e.getAttribute("data-node-id"),
                            data: e.outerHTML
                        });
                    });
                    rangeElement.addEventListener("change", () => {
                        nodeElements.forEach((e) => {
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
            }, {
                type: "separator"
            }, {
                label: window.siyuan.languages.clearFontStyle,
                icon: "iconTrashcan",
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

    private genCopyTextRef(selectsElement: Element[]): false | IMenu {
        if (isNotEditBlock(selectsElement[0])) {
            return false;
        }
        return {
            label: `${window.siyuan.languages.copy} ${window.siyuan.languages.text} *`,
            click() {
                // 用于标识复制文本 *
                selectsElement[0].setAttribute("data-reftext", "true");
                focusByRange(getEditorRange(selectsElement[0]));
                document.execCommand("copy");
            }
        };
    }

    public render(protyle: IProtyle, element: Element, wysiwyg: HTMLElement) {
        // https://github.com/siyuan-note/siyuan/issues/4659
        const titleElement = wysiwyg.parentElement.querySelector(".protyle-title__input");
        if (titleElement && titleElement.getAttribute("data-render") !== "true") {
            return;
        }
        // 防止划选时触碰图标导致 hl 无法移除
        const selectElement = wysiwyg.parentElement.parentElement.querySelector(".protyle-select");
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
            const isShow = !hideParent || (hideParent && nodeElement.getAttribute("fold") === "1");
            const embedElement = hasClosestByAttribute(nodeElement.parentElement, "data-type", "NodeBlockQueryEmbed");
            if (!embedElement) {
                let type;
                if (isShow) {
                    type = nodeElement.getAttribute("data-type");
                }
                if (index === 0) {
                    // 不单独显示，要不然在块的间隔中，gutter 会跳来跳去的
                    if (["NodeBlockquote", "NodeList", "NodeSuperBlock"].includes(type)) {
                        return;
                    }
                    const topElement = getTopAloneElement(nodeElement);
                    listItem = topElement.querySelector(".li") || topElement.querySelector(".list");
                    // 嵌入块中有列表时块标显示位置错误 https://github.com/siyuan-note/siyuan/issues/6254
                    if (hasClosestByAttribute(listItem, "data-type", "NodeBlockQueryEmbed")) {
                        listItem = undefined;
                    }
                    // 标题必须显示
                    if (!topElement.isSameNode(nodeElement) && type !== "NodeHeading") {
                        nodeElement = topElement;
                        type = nodeElement.getAttribute("data-type");
                    }
                }
                if (type === "NodeListItem" && index === 1 && !isShow) {
                    // 列表项中第一层不显示
                    html = "";
                }
                index += 1;
                if (isShow) {
                    html = `<button ${protyle.disabled ? "" : 'draggable="true"'} data-type="${type}"  data-subtype="${nodeElement.getAttribute("data-subtype")}" data-node-id="${nodeElement.getAttribute("data-node-id")}"><svg><use xlink:href="#${getIconByType(type, nodeElement.getAttribute("data-subtype"))}"></use></svg></button>` + html;
                }
                let foldHTML = "";
                if (type === "NodeListItem" && nodeElement.childElementCount > 3 || type === "NodeHeading") {
                    const fold = nodeElement.getAttribute("fold");
                    foldHTML = `<button data-type="fold"><svg style="width:10px${fold && fold === "1" ? "" : ";transform:rotate(90deg)"}"><use xlink:href="#iconPlay"></use></svg></button>`;
                }
                if (type === "NodeListItem" || type === "NodeList") {
                    listItem = nodeElement;
                    if (type === "NodeListItem" && nodeElement.childElementCount > 3) {
                        html = `<button ${protyle.disabled ? "" : 'draggable="true"'} data-type="${type}"  data-subtype="${nodeElement.getAttribute("data-subtype")}" data-node-id="${nodeElement.getAttribute("data-node-id")}"><svg><use xlink:href="#${getIconByType(type, nodeElement.getAttribute("data-subtype"))}"></use></svg></button>${foldHTML}`;
                    }
                }
                if (type === "NodeHeading") {
                    html = html + foldHTML;
                }
                if (type === "NodeBlockquote") {
                    space += 8;
                }
                if (nodeElement.previousElementSibling && nodeElement.previousElementSibling.getAttribute("data-node-id")) {
                    // 前一个块存在时，只显示到当前层级，但需显示折叠块的块标
                    // https://github.com/siyuan-note/siyuan/issues/2562 https://github.com/siyuan-note/siyuan/issues/2809
                    hideParent = true;
                }
            }

            const parentElement = hasClosestBlock(nodeElement.parentElement);
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
            buttonsElement.forEach(item => {
                const id = item.getAttribute("data-node-id");
                if (id && html.indexOf(id) === -1) {
                    match = false;
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
        let rect = element.getBoundingClientRect();
        let marginHeight = 0;
        if (listItem) {
            rect = listItem.firstElementChild.getBoundingClientRect();
            space = 0;
        } else if (nodeElement.getAttribute("data-type") === "NodeBlockQueryEmbed") {
            rect = nodeElement.getBoundingClientRect();
            space = 0;
        } else if (rect.height < Math.floor(window.siyuan.config.editor.fontSize * 1.625) + 8 ||
            (rect.height > Math.floor(window.siyuan.config.editor.fontSize * 1.625) + 8 && rect.height < Math.floor(window.siyuan.config.editor.fontSize * 1.625) * 2 + 8)) {
            marginHeight = (rect.height - this.element.clientHeight) / 2;
        }
        this.element.style.top = `${Math.max(rect.top, wysiwyg.parentElement.getBoundingClientRect().top) + marginHeight}px`;
        let left = rect.left - this.element.clientWidth - space;
        if (nodeElement.getAttribute("data-type") === "NodeBlockQueryEmbed" && this.element.childElementCount === 1) {
            // 嵌入块为列表时
            left = nodeElement.getBoundingClientRect().left - this.element.clientWidth - space;
        } else if (nodeElement.getAttribute("data-type") === "NodeAttributeView") {
            left = left + (parseInt((nodeElement.firstElementChild.firstElementChild as HTMLElement)?.style.paddingLeft) || 0);
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
