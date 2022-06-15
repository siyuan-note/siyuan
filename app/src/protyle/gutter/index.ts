import {hasClosestBlock, hasClosestByAttribute, hasClosestByMatchTag, hasClosestByTag} from "../util/hasClosest";
import {getIconByType} from "../../editor/getIcon";
import {iframeMenu, setFold, tableMenu, videoMenu, zoomOut} from "../../menus/protyle";
import {MenuItem} from "../../menus/Menu";
import {copySubMenu, openAttr, openWechatNotify} from "../../menus/commonMenuItem";
import {updateHotkeyTip, writeText} from "../util/compatibility";
import {transaction, turnIntoTransaction, turnsIntoTransaction, updateTransaction} from "../wysiwyg/transaction";
import {removeBlock} from "../wysiwyg/remove";
import {focusBlock, focusByRange, getEditorRange} from "../util/selection";
import {hideElements} from "../ui/hideElements";
import {setPosition} from "../../util/setPosition";
import {processRender} from "../util/processCode";
import {highlightRender} from "../markdown/highlightRender";
import {blockRender} from "../markdown/blockRender";
import {removeEmbed} from "../wysiwyg/removeEmbed";
import {getContenteditableElement, getTopAloneElement, isNotEditBlock} from "../wysiwyg/getBlock";
import * as dayjs from "dayjs";
import {fetchPost} from "../../util/fetch";
import {cancelSB, insertEmptyBlock} from "../../block/util";
import {scrollCenter} from "../../util/highlightById";
import {isMobile} from "../../util/functions";
import {confirmDialog} from "../../dialog/confirmDialog";
import {enableProtyle} from "../util/onGet";

export class Gutter {
    public element: HTMLElement;

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.className = "protyle-gutters";
        this.element.setAttribute("aria-label", window.siyuan.languages.gutterTip.replace("⌘Click", updateHotkeyTip("⌘Click")).replace("⌥Click", updateHotkeyTip("⌥Click")).replace("⇧Click", updateHotkeyTip("⇧Click")));
        this.element.setAttribute("data-type", "a");
        this.element.setAttribute("data-position", "right");
        this.element.addEventListener("dragstart", (event: DragEvent & { target: HTMLElement }) => {
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
            event.dataTransfer.effectAllowed = "move";
            window.siyuan.dragElement = event.target;
            window.siyuan.dragElement.setAttribute("data-selected-ids", selectIds.toString());
        });
        this.element.addEventListener("dragend", () => {
            if (window.siyuan.dragElement) {
                window.siyuan.dragElement.removeAttribute("data-selected-ids");
                window.siyuan.dragElement.style.opacity = "";
                window.siyuan.dragElement = undefined;
            }
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
                const gutterFold = () => {
                    buttonElement.setAttribute("disabled", "disabled");
                    const foldElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${(buttonElement.previousElementSibling || buttonElement.nextElementSibling).getAttribute("data-node-id")}"]`) as HTMLElement;
                    if (window.siyuan.altIsPressed) {
                        let hasFold = true;
                        const oldHTML = foldElement.outerHTML;
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
                        Array.from(foldElement.children).forEach((ulElement) => {
                            if (ulElement.classList.contains("list")) {
                                Array.from(ulElement.children).forEach((listItemElement) => {
                                    if (listItemElement.classList.contains("li")) {
                                        if (hasFold) {
                                            listItemElement.removeAttribute("fold");
                                        } else if (listItemElement.childElementCount > 3) {
                                            listItemElement.setAttribute("fold", "1");
                                        }

                                    }
                                });
                            }
                        });
                        updateTransaction(protyle, foldElement.getAttribute("data-node-id"), foldElement.outerHTML, oldHTML);
                        buttonElement.removeAttribute("disabled");
                    } else {
                        const foldStatus = setFold(protyle, foldElement);
                        if (foldStatus === "1") {
                            (buttonElement.firstElementChild as HTMLElement).style.transform = "";
                        } else if (foldStatus === "0") {
                            (buttonElement.firstElementChild as HTMLElement).style.transform = "rotate(90deg)";
                        }
                    }
                };
                if (buttonElement.getAttribute("disabled")) {
                    return;
                }
                if (protyle.disabled) {
                    confirmDialog(window.siyuan.languages["_kernel"]["34"], window.siyuan.languages.foldTip, () => {
                        if (isMobile()) {
                            (document.getElementById("toolbarName") as HTMLInputElement).readOnly = false;
                            document.querySelector("#toolbarEdit use").setAttribute("xlink:href", "#iconPreview");
                        }
                        enableProtyle(protyle);
                        gutterFold();
                    });
                } else {
                    gutterFold();
                }
                return;
            }
            if (protyle.disabled) {
                return;
            }
            if (window.siyuan.ctrlIsPressed) {
                zoomOut(protyle, id);
            } else if (window.siyuan.altIsPressed) {
                const foldElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
                if (buttonElement.getAttribute("data-type") === "NodeListItem") {
                    let hasFold = true;
                    const oldHTML = foldElement.parentElement.outerHTML;
                    Array.from(foldElement.parentElement.children).find((listItemElement) => {
                        if (listItemElement.classList.contains("li")) {
                            if (listItemElement.getAttribute("fold") !== "1" && listItemElement.childElementCount > 3) {
                                hasFold = false;
                                return true;
                            }
                        }
                    });
                    Array.from(foldElement.parentElement.children).find((listItemElement) => {
                        if (listItemElement.classList.contains("li")) {
                            if (hasFold) {
                                listItemElement.removeAttribute("fold");
                            } else if (listItemElement.childElementCount > 3) {
                                listItemElement.setAttribute("fold", "1");
                            }
                        }
                    });
                    updateTransaction(protyle, foldElement.parentElement.getAttribute("data-node-id"), foldElement.parentElement.outerHTML, oldHTML);
                } else {
                    setFold(protyle, foldElement);
                }
                foldElement.classList.remove("protyle-wysiwyg--hl");
            } else if (window.siyuan.shiftIsPressed) {
                openAttr(protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`), protyle);
            } else {
                this.renderMenu(protyle, buttonElement);
                window.siyuan.menus.menu.element.classList.remove("fn__none");
                setPosition(window.siyuan.menus.menu.element, event.clientX - window.siyuan.menus.menu.element.clientWidth - 16, event.clientY - 16);
                // https://ld246.com/article/1648433751993
                if (!protyle.toolbar.range) {
                    protyle.toolbar.range = getEditorRange(protyle.wysiwyg.element.firstElementChild);
                }
                focusByRange(protyle.toolbar.range);
            }
        });
        this.element.addEventListener("contextmenu", (event: MouseEvent & { target: HTMLInputElement }) => {
            const buttonElement = hasClosestByTag(event.target, "BUTTON");
            if (!buttonElement || protyle.disabled || buttonElement.getAttribute("data-type") === "fold") {
                return;
            }
            if (!window.siyuan.ctrlIsPressed && !window.siyuan.altIsPressed && !window.siyuan.shiftIsPressed) {
                this.renderMenu(protyle, buttonElement);
                window.siyuan.menus.menu.element.classList.remove("fn__none");
                setPosition(window.siyuan.menus.menu.element, event.clientX - window.siyuan.menus.menu.element.clientWidth - 16, event.clientY - 16);
            }
            event.preventDefault();
            event.stopPropagation();
        });
        this.element.addEventListener("mouseover", (event: MouseEvent & { target: HTMLInputElement }) => {
            const buttonElement = hasClosestByTag(event.target, "BUTTON");
            if (!buttonElement || buttonElement?.getAttribute("data-type") === "fold") {
                return;
            }
            let nodeElement: Element;
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${buttonElement.getAttribute("data-node-id")}"]`)).find(item => {
                if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                    nodeElement = item;
                    return true;
                }
            });
            if (!nodeElement) {
                return;
            }
            nodeElement.classList.add("protyle-wysiwyg--hl");
            event.preventDefault();
        });
        this.element.addEventListener("mouseout", (event: MouseEvent & { target: HTMLInputElement }) => {
            const buttonElement = hasClosestByTag(event.target, "BUTTON");
            if (!buttonElement || buttonElement?.getAttribute("data-type") === "fold") {
                return;
            }
            let nodeElement: Element;
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${buttonElement.getAttribute("data-node-id")}"]`)).find(item => {
                if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                    nodeElement = item;
                    return true;
                }
            });
            if (!nodeElement) {
                return;
            }
            nodeElement.classList.remove("protyle-wysiwyg--hl");
            event.preventDefault();
            event.stopPropagation();
        });
    }

    private turnInto(options: { icon: string, label: string, protyle: IProtyle, nodeElement: Element, id: string, type: string, level?: number }) {
        return {
            icon: options.icon,
            label: options.label,
            click() {
                turnIntoTransaction(options);
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
                turnsIntoTransaction(options);
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
    }) {
        return {
            icon: options.icon,
            label: options.label,
            click() {
                let html = "";
                const doOperations: IOperation[] = [];
                const undoOperations: IOperation[] = [];
                options.selectsElement.forEach((item, index) => {
                    if (item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
                        setFold(options.protyle, item);
                    }
                    item.classList.remove("protyle-wysiwyg--select");
                    html += item.outerHTML;
                    const id = item.getAttribute("data-node-id");
                    undoOperations.push({
                        action: "update",
                        id,
                        data: item.outerHTML
                    });

                    if ((options.type === "Blocks2Ps" || options.type === "Blocks2Hs") && !options.isContinue) {
                        // @ts-ignore
                        item.outerHTML = options.protyle.lute[options.type](item.outerHTML, options.level);
                    } else {
                        if (index === options.selectsElement.length - 1) {
                            const tempElement = document.createElement("div");
                            // @ts-ignore
                            tempElement.innerHTML = options.protyle.lute[options.type](html, options.level);
                            item.outerHTML = tempElement.innerHTML;
                        } else {
                            item.remove();
                        }
                    }
                });
                undoOperations.forEach(item => {
                    const nodeElement = options.protyle.wysiwyg.element.querySelector(`[data-node-id="${item.id}"]`);
                    doOperations.push({
                        action: "update",
                        id: item.id,
                        data: nodeElement.outerHTML
                    });
                });
                transaction(options.protyle, doOperations, undoOperations);
                processRender(options.protyle.wysiwyg.element);
                highlightRender(options.protyle.wysiwyg.element);
                blockRender(options.protyle, options.protyle.wysiwyg.element);
                focusBlock(options.protyle.wysiwyg.element.querySelector(`[data-node-id="${options.selectsElement[0].getAttribute("data-node-id")}"]`));
                hideElements(["gutter"], options.protyle);
            }
        };
    }

    private renderMultipleMenu(protyle: IProtyle, selectsElement: Element[]) {
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
        if (!isList && !window.siyuan.config.readonly) {
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
                    protyle,
                    selectsElement,
                    type: "Blocks2Ps",
                    isContinue
                }));
            }
            turnIntoSubmenu.push(this.turnsInto({
                icon: "iconH1",
                label: window.siyuan.languages.heading1,
                protyle,
                selectsElement,
                level: 1,
                type: "Blocks2Hs",
                isContinue
            }));
            turnIntoSubmenu.push(this.turnsInto({
                icon: "iconH2",
                label: window.siyuan.languages.heading2,
                protyle,
                selectsElement,
                level: 2,
                type: "Blocks2Hs",
                isContinue
            }));
            turnIntoSubmenu.push(this.turnsInto({
                icon: "iconH3",
                label: window.siyuan.languages.heading3,
                protyle,
                selectsElement,
                level: 3,
                type: "Blocks2Hs",
                isContinue
            }));
            turnIntoSubmenu.push(this.turnsInto({
                icon: "iconH4",
                label: window.siyuan.languages.heading4,
                protyle,
                selectsElement,
                level: 4,
                type: "Blocks2Hs",
                isContinue
            }));
            turnIntoSubmenu.push(this.turnsInto({
                icon: "iconH5",
                label: window.siyuan.languages.heading5,
                protyle,
                selectsElement,
                level: 5,
                type: "Blocks2Hs",
                isContinue
            }));
            turnIntoSubmenu.push(this.turnsInto({
                icon: "iconH6",
                label: window.siyuan.languages.heading6,
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
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
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
        }).element);
        if (window.siyuan.config.readonly) {
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
                    protyle.breadcrumb.hide();
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
                protyle.toolbar.showFile(protyle, selectsElement, getEditorRange(selectsElement[0]));
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.delete,
            icon: "iconTrashcan",
            accelerator: "⌫",
            click: () => {
                protyle.breadcrumb.hide();
                removeBlock(protyle, selectsElement[0], getEditorRange(selectsElement[0]));
            }
        }).element);

        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        const appearanceElement = new MenuItem({
            label: window.siyuan.languages.appearance,
            submenu: this.genCardStyle(selectsElement, protyle).concat(this.genFontStyle(selectsElement, protyle)).concat(this.genBGStyle(selectsElement, protyle))
        }).element;
        window.siyuan.menus.menu.append(appearanceElement);
        appearanceElement.lastElementChild.classList.add("b3-menu__submenu--row");
        this.genAlign(selectsElement, protyle);
        this.genWidths(selectsElement, protyle);
        return window.siyuan.menus.menu;
    }

    public renderMenu(protyle: IProtyle, buttonElement: Element) {
        hideElements(["hint"], protyle);
        window.siyuan.menus.menu.remove();
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
                if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
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
        // "heading1-6", "list", "ordered-list", "check", "quote", "code", "table", "line", "math", "paragraph"
        if (type === "NodeParagraph" && !window.siyuan.config.readonly) {
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
            turnIntoSubmenu.push(this.turnInto({
                icon: "iconH1",
                label: window.siyuan.languages.heading1,
                protyle,
                nodeElement,
                id,
                level: 1,
                type: "P2H"
            }));
            turnIntoSubmenu.push(this.turnInto({
                icon: "iconH2",
                label: window.siyuan.languages.heading2,
                protyle,
                nodeElement,
                id,
                level: 2,
                type: "P2H"
            }));
            turnIntoSubmenu.push(this.turnInto({
                icon: "iconH3",
                label: window.siyuan.languages.heading3,
                protyle,
                nodeElement,
                id,
                level: 3,
                type: "P2H"
            }));
            turnIntoSubmenu.push(this.turnInto({
                icon: "iconH4",
                label: window.siyuan.languages.heading4,
                protyle,
                nodeElement,
                id,
                level: 4,
                type: "P2H"
            }));
            turnIntoSubmenu.push(this.turnInto({
                icon: "iconH5",
                label: window.siyuan.languages.heading5,
                protyle,
                nodeElement,
                id,
                level: 5,
                type: "P2H"
            }));
            turnIntoSubmenu.push(this.turnInto({
                icon: "iconH6",
                label: window.siyuan.languages.heading6,
                protyle,
                nodeElement,
                id,
                level: 6,
                type: "P2H"
            }));
        } else if (type === "NodeHeading" && !window.siyuan.config.readonly) {
            turnIntoSubmenu.push(this.turnInto({
                icon: "iconParagraph",
                label: window.siyuan.languages.paragraph,
                protyle,
                nodeElement,
                id,
                type: "H2P"
            }));
            if (subType !== "h1") {
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconH1",
                    label: window.siyuan.languages.heading1,
                    protyle,
                    nodeElement,
                    id,
                    level: 1,
                    type: "HLevel"
                }));
            }
            if (subType !== "h2") {
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconH2",
                    label: window.siyuan.languages.heading2,
                    protyle,
                    nodeElement,
                    id,
                    level: 2,
                    type: "HLevel"
                }));
            }
            if (subType !== "h3") {
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconH3",
                    label: window.siyuan.languages.heading3,
                    protyle,
                    nodeElement,
                    id,
                    level: 3,
                    type: "HLevel"
                }));
            }
            if (subType !== "h4") {
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconH4",
                    label: window.siyuan.languages.heading4,
                    protyle,
                    nodeElement,
                    id,
                    level: 4,
                    type: "HLevel"
                }));
            }
            if (subType !== "h5") {
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconH5",
                    label: window.siyuan.languages.heading5,
                    protyle,
                    nodeElement,
                    id,
                    level: 5,
                    type: "HLevel"
                }));
            }
            if (subType !== "h6") {
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconH6",
                    label: window.siyuan.languages.heading6,
                    protyle,
                    nodeElement,
                    id,
                    level: 6,
                    type: "HLevel"
                }));
            }
        } else if (type === "NodeList" && !window.siyuan.config.readonly) {
            turnIntoSubmenu.push(this.turnInto({
                icon: "iconParagraph",
                label: window.siyuan.languages.paragraph,
                protyle,
                nodeElement,
                id,
                type: "CancelList"
            }));
            if (nodeElement.getAttribute("data-subtype") === "o") {
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconList",
                    label: window.siyuan.languages.list,
                    protyle,
                    nodeElement,
                    id,
                    type: "OL2UL"
                }));
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconCheck",
                    label: window.siyuan.languages.check,
                    protyle,
                    nodeElement,
                    id,
                    type: "UL2TL"
                }));
            } else if (nodeElement.getAttribute("data-subtype") === "t") {
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconList",
                    label: window.siyuan.languages.list,
                    protyle,
                    nodeElement,
                    id,
                    type: "TL2UL"
                }));
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconOrderedList",
                    label: window.siyuan.languages["ordered-list"],
                    protyle,
                    nodeElement,
                    id,
                    type: "TL2OL"
                }));
            } else {
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconOrderedList",
                    label: window.siyuan.languages["ordered-list"],
                    protyle,
                    nodeElement,
                    id,
                    type: "UL2OL"
                }));
                turnIntoSubmenu.push(this.turnInto({
                    icon: "iconCheck",
                    label: window.siyuan.languages.check,
                    protyle,
                    nodeElement,
                    id,
                    type: "OL2TL"
                }));
            }
        } else if (type === "NodeBlockquote" && !window.siyuan.config.readonly) {
            turnIntoSubmenu.push(this.turnInto({
                icon: "iconParagraph",
                label: window.siyuan.languages.paragraph,
                protyle,
                nodeElement,
                id,
                type: "CancelBlockquote"
            }));
        }
        if (turnIntoSubmenu.length > 0 && !window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconRefresh",
                label: window.siyuan.languages.turnInto,
                type: "submenu",
                submenu: turnIntoSubmenu
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
            type: "submenu",
            submenu: (copySubMenu(id, nodeElement.querySelector(".protyle-attr--name")?.textContent, true, nodeElement) as IMenu[]).concat([{
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
                label: window.siyuan.languages.duplicate,
                disabled: window.siyuan.config.readonly,
                click() {
                    const tempElement = nodeElement.cloneNode(true) as HTMLElement;
                    const newId = Lute.NewNodeID();
                    tempElement.setAttribute("data-node-id", newId);
                    tempElement.querySelectorAll("[data-node-id]").forEach(item => {
                        item.setAttribute("data-node-id", Lute.NewNodeID());
                    });
                    nodeElement.after(tempElement);
                    scrollCenter(protyle);
                    transaction(protyle, [{
                        action: "insert",
                        data: nodeElement.nextElementSibling.outerHTML,
                        id: newId,
                        previousID: id,
                    }], [{
                        action: "delete",
                        id: newId,
                    }]);
                    focusBlock(tempElement);
                }
            }])
        }).element);
        if (!window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.cut,
                accelerator: "⌘X",
                icon: "iconCut",
                click: () => {
                    if (isNotEditBlock(nodeElement)) {
                        writeText(protyle.lute.BlockDOM2StdMd(removeEmbed(nodeElement)).trimEnd());
                        removeBlock(protyle, nodeElement, getEditorRange(nodeElement));
                        protyle.breadcrumb.hide();
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
                    protyle.toolbar.showFile(protyle, [nodeElement], getEditorRange(nodeElement));
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.delete,
                icon: "iconTrashcan",
                accelerator: "⌫",
                click: () => {
                    protyle.breadcrumb.hide();
                    removeBlock(protyle, nodeElement, getEditorRange(nodeElement));
                }
            }).element);
        }
        if (type === "NodeSuperBlock" && !window.siyuan.config.readonly) {
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
        } else if (type === "NodeCodeBlock" && !window.siyuan.config.readonly && !nodeElement.getAttribute("data-subtype")) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            const linewrap = nodeElement.getAttribute("linewrap");
            const ligatures = nodeElement.getAttribute("ligatures");
            const linenumber = nodeElement.getAttribute("linenumber");

            window.siyuan.menus.menu.append(new MenuItem({
                type: "submenu",
                icon: "iconCode",
                label: window.siyuan.languages.code,
                submenu: [{
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
        } else if (type === "NodeCodeBlock" && !window.siyuan.config.readonly && ["echarts", "mindmap"].includes(nodeElement.getAttribute("data-subtype"))) {
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
                            (nodeElement.firstElementChild as HTMLElement).style.height = newHeight;
                            updateTransaction(protyle, id, nodeElement.outerHTML, html);
                            html = nodeElement.outerHTML;
                            event.stopPropagation();
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
        } else if (type === "NodeTable" && !window.siyuan.config.readonly) {
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
        } else if ((type === "NodeVideo" || type === "NodeAudio") && !window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "assetSubMenu",
                type: "submenu",
                icon: type === "NodeVideo" ? "iconVideo" : "iconRecord",
                label: window.siyuan.languages.assets,
                submenu: videoMenu(protyle, nodeElement, type)
            }).element);
        } else if (type === "NodeIFrame" && !window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "assetSubMenu",
                type: "submenu",
                icon: "iconLanguage",
                label: window.siyuan.languages.assets,
                submenu: iframeMenu(protyle, nodeElement)
            }).element);
        } else if (type === "NodeHTMLBlock" && !window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconHTML5",
                label: "HTML",
                click() {
                    protyle.toolbar.showRender(protyle, nodeElement);
                }
            }).element);
        } else if (type === "NodeBlockQueryEmbed" && !window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
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
                }]
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            accelerator: `${updateHotkeyTip(window.siyuan.config.keymap.general.enter.custom)}/${updateHotkeyTip("⌘Click")}`,
            label: window.siyuan.languages.enter,
            click() {
                zoomOut(protyle, id);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            accelerator: window.siyuan.config.keymap.general.enterBack.custom,
            label: window.siyuan.languages.enterBack,
            click() {
                zoomOut(protyle, protyle.block.parent2ID, id);
            }
        }).element);
        if (!window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconBefore",
                label: window.siyuan.languages["insert-before"],
                accelerator: window.siyuan.config.keymap.editor.general.insertBefore.custom,
                click() {
                    insertEmptyBlock(protyle, "beforebegin", id);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconAfter",
                label: window.siyuan.languages["insert-after"],
                accelerator: window.siyuan.config.keymap.editor.general.insertAfter.custom,
                click() {
                    insertEmptyBlock(protyle, "afterend", id);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);

            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.fold,
                accelerator: `${updateHotkeyTip("⌘↑")}/${updateHotkeyTip("⌥Click")}`,
                click() {
                    setFold(protyle, nodeElement);
                    focusBlock(nodeElement);
                }
            }).element);

            if (type !== "NodeThematicBreak") {
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.attr,
                    accelerator: window.siyuan.config.keymap.editor.general.attr.custom + "/" + updateHotkeyTip("⇧Click"),
                    click() {
                        openAttr(nodeElement, protyle);
                    }
                }).element);
            }

            const appearanceElement = new MenuItem({
                label: window.siyuan.languages.appearance,
                submenu: this.genCardStyle([nodeElement], protyle).concat(this.genFontStyle([nodeElement], protyle)).concat(this.genBGStyle([nodeElement], protyle))
            }).element;
            window.siyuan.menus.menu.append(appearanceElement);
            appearanceElement.lastElementChild.classList.add("b3-menu__submenu--row");
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
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        }
        let updateHTML = nodeElement.getAttribute("updated") || "";
        if (updateHTML) {
            updateHTML = `${window.siyuan.languages.modifiedAt} ${dayjs(updateHTML).format("YYYY-MM-DD HH:mm:ss")}<br>`;
        }
        window.siyuan.menus.menu.append(new MenuItem({
            type: "readonly",
            label: `<div style="margin-left: -18px;white-space: nowrap;">${updateHTML}${window.siyuan.languages.createdAt} ${dayjs(id.substr(0, 14)).format("YYYY-MM-DD HH:mm:ss")}</div>`,
        }).element);
        return window.siyuan.menus.menu;
    }

    private genClick(nodeElements: Element[], protyle: IProtyle, cb: (e: HTMLElement) => void) {
        const operations: IOperation[] = [];
        const undoOperations: IOperation[] = [];
        nodeElements.forEach((element) => {
            const id = element.getAttribute("data-node-id");
            element.classList.remove("protyle-wysiwyg--select");
            undoOperations.push({
                action: "update",
                id,
                data: element.outerHTML
            });
            cb(element as HTMLElement);
            operations.push({
                action: "update",
                id,
                data: element.outerHTML
            });
        });
        transaction(protyle, operations, undoOperations);
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
            }]
        }).element);
    }

    private genBGStyle(nodeElements: Element[], protyle: IProtyle) {
        const styles: IMenu[] = [];
        ["var(--b3-font-background1)", "var(--b3-font-background2)", "var(--b3-font-background3)", "var(--b3-font-background4)",
            "var(--b3-font-background5)", "var(--b3-font-background6)", "var(--b3-font-background7)", "var(--b3-font-background8)",
            "var(--b3-font-background9)", "var(--b3-font-background10)", "var(--b3-font-background11)", "var(--b3-font-background12)",
            "var(--b3-font-background13)"].forEach((item, index) => {
            styles.push({
                label: `<div class="fn__flex" data-type="a" aria-label="${window.siyuan.languages.colorPrimary} ${index + 1}">
    <span style="background-color:${item};" class="b3-color__square fn__flex-center">A</span>
</div>`,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.backgroundColor = item;
                    });
                }
            });
        });
        styles.push({
            type: "separator"
        });
        styles.push({
            label: `<div class="fn__flex" data-type="a" aria-label="${window.siyuan.languages.clearFontStyle}">
    <span class="b3-color__square fn__flex-center">A</span>
</div>`,
            click: () => {
                this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                    e.style.textShadow = "";
                    e.style.color = "";
                    e.style.webkitBackgroundClip = "";
                    e.style.backgroundImage = "";
                    e.style.webkitTextFillColor = "";
                    e.style.webkitTextStroke = "";
                    e.style.textShadow = "";
                    e.style.backgroundColor = "";
                });
            }
        });
        return styles;
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
                label: `<div aria-label="${width}%" class="b3-tooltips b3-tooltips__n fn__size200">
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

    private genFontStyle(nodeElements: Element[], protyle: IProtyle) {
        const styles: IMenu[] = [];
        ["var(--b3-font-color1)", "var(--b3-font-color2)", "var(--b3-font-color3)", "var(--b3-font-color4)",
            "var(--b3-font-color5)", "var(--b3-font-color6)", "var(--b3-font-color7)", "var(--b3-font-color8)",
            "var(--b3-font-color9)", "var(--b3-font-color10)", "var(--b3-font-color11)", "var(--b3-font-color12)",
            "var(--b3-font-color13)"].forEach((item, index) => {
            styles.push({
                label: `<div class="fn__flex" data-type="a" aria-label="${window.siyuan.languages.colorFont} ${index + 1}">
    <span style="color:${item};" class="b3-color__square fn__flex-center">A</span>
</div>`,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.color = item;
                    });
                }
            });
        });
        styles.push({
            type: "separator"
        });
        return styles;
    }

    private genCardStyle(nodeElements: Element[], protyle: IProtyle) {
        const styles: IMenu[] = [];
        ["error", "warning", "info", "success"].forEach((item) => {
            styles.push({
                label: `<div class="fn__flex" data-type="a" aria-label="${window.siyuan.languages[item + "Style"]}">
    <span style="color: var(--b3-card-${item}-color);background-color: var(--b3-card-${item}-background);" class="b3-color__square fn__flex-center">A</span>    
</div>`,
                click: () => {
                    this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                        e.style.color = `var(--b3-card-${item}-color)`;
                        e.style.backgroundColor = `var(--b3-card-${item}-background)`;
                    });
                }
            });
        });
        styles.push({
            type: "separator"
        });
        return styles.concat([{
            label: `<div class="fn__flex" data-type="a" aria-label="${window.siyuan.languages.hollow}">
    <span style="-webkit-text-stroke: 0.2px var(--b3-theme-on-background);-webkit-text-fill-color : transparent;" class="b3-color__square fn__flex-center">A</span>
</div>`,
            click: () => {
                this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                    e.style.webkitTextStroke = "0.2px var(--b3-theme-on-background)";
                    e.style.webkitTextFillColor = "transparent";
                });
            }
        }, {
            label: `<div class="fn__flex" data-type="a" aria-label="${window.siyuan.languages.shadow}">
    <span style="text-shadow: 1px 1px var(--b3-border-color), 2px 2px var(--b3-border-color), 3px 3px var(--b3-border-color), 4px 4px var(--b3-border-color)" class="b3-color__square fn__flex-center">A</span>
</div>`,
            click: () => {
                this.genClick(nodeElements, protyle, (e: HTMLElement) => {
                    e.style.textShadow = "1px 1px var(--b3-border-color), 2px 2px var(--b3-border-color), 3px 3px var(--b3-border-color), 4px 4px var(--b3-border-color)";
                });
            }
        }, {
            type: "separator"
        }]);
    }

    public render(element: Element, wysiwyg: HTMLElement) {
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
                    html = `<button ${window.siyuan.config.readonly ? "" : 'draggable="true"'} data-type="${type}"  data-subtype="${nodeElement.getAttribute("data-subtype")}" data-node-id="${nodeElement.getAttribute("data-node-id")}"><svg><use xlink:href="#${getIconByType(type, nodeElement.getAttribute("data-subtype"))}"></use></svg></button>` + html;
                }
                let foldHTML = "";
                if (type === "NodeListItem" && nodeElement.childElementCount > 3 || type === "NodeHeading") {
                    const fold = nodeElement.getAttribute("fold");
                    foldHTML = `<button data-type="fold"><svg style="width:10px${fold && fold === "1" ? "" : ";transform:rotate(90deg)"}"><use xlink:href="#iconPlay"></use></svg></button>`;
                }
                if (type === "NodeListItem" || type === "NodeList") {
                    listItem = nodeElement;
                    if (type === "NodeListItem" && nodeElement.childElementCount > 3) {
                        html = `<button ${window.siyuan.config.readonly ? "" : 'draggable="true"'} data-type="${type}"  data-subtype="${nodeElement.getAttribute("data-subtype")}" data-node-id="${nodeElement.getAttribute("data-node-id")}"><svg><use xlink:href="#${getIconByType(type, nodeElement.getAttribute("data-subtype"))}"></use></svg></button>${foldHTML}`;
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
        this.element.style.top = `${Math.max(rect.top, wysiwyg.parentElement.getBoundingClientRect().top + 16) + marginHeight}px`;
        let left = rect.left - this.element.clientWidth - space;
        if (nodeElement.getAttribute("data-type") === "NodeBlockQueryEmbed" && this.element.childElementCount === 1) {
            // 嵌入块为列表时
            left = nodeElement.getBoundingClientRect().left - this.element.clientWidth - space;
        }
        this.element.style.left = `${left}px`;
        if (left < this.element.parentElement.getBoundingClientRect().left) {
            this.element.style.width = "24px";
            this.element.style.left = `${rect.left - this.element.clientWidth - space / 2}px`;
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
