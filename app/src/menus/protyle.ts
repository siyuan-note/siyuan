import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
    hasTopClosestByClassName,
    isInEmbedBlock
} from "../protyle/util/hasClosest";
import {MenuItem} from "./Menu";
import {focusBlock, focusByRange, focusByWbr, getEditorRange, selectAll,} from "../protyle/util/selection";
import {
    deleteColumn,
    deleteRow,
    getColIndex,
    insertColumn,
    insertRow,
    insertRowAbove,
    moveColumnToLeft,
    moveColumnToRight,
    moveRowToDown,
    moveRowToUp,
    setTableAlign
} from "../protyle/util/table";
import {mathRender} from "../protyle/render/mathRender";
import {transaction, updateTransaction} from "../protyle/wysiwyg/transaction";
import {openMenu} from "./commonMenuItem";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {Constants} from "../constants";
import {copyPlainText, readClipboard, setStorageVal, updateHotkeyTip, writeText} from "../protyle/util/compatibility";
import {preventScroll} from "../protyle/scroll/preventScroll";
import {onGet} from "../protyle/util/onGet";
import {getAllModels} from "../layout/getAll";
import {paste, pasteAsPlainText, pasteEscaped} from "../protyle/util/paste";
/// #if !MOBILE
import {openFileById, updateBacklinkGraph} from "../editor/util";
import {openGlobalSearch} from "../search/util";
import {openNewWindowById} from "../window/openNewWindow";
/// #endif
import {getSearch, isMobile} from "../util/functions";
import {removeFoldHeading} from "../protyle/util/heading";
import {lineNumberRender} from "../protyle/render/highlightRender";
import * as dayjs from "dayjs";
import {blockRender} from "../protyle/render/blockRender";
import {renameAsset} from "../editor/rename";
import {electronUndo} from "../protyle/undo";
import {pushBack} from "../mobile/util/MobileBackFoward";
import {copyPNGByLink, exportAsset} from "./util";
import {removeInlineType} from "../protyle/toolbar/util";
import {alignImgCenter, alignImgLeft} from "../protyle/wysiwyg/commonHotkey";
import {checkFold, renameTag} from "../util/noRelyPCFunction";
import {hideElements} from "../protyle/ui/hideElements";
import {emitOpenMenu} from "../plugin/EventBus";
import {openMobileFileById} from "../mobile/editor";
import {openBacklink, openGraph} from "../layout/dock/util";
import {renderAssetsPreview} from "../asset/renderAssets";
import {upDownHint} from "../util/upDownHint";
import {hintRenderAssets} from "../protyle/hint/extend";
import {Menu} from "../plugin/Menu";
import {getFirstBlock} from "../protyle/wysiwyg/getBlock";
import {popSearch} from "../mobile/menu/search";
import {showMessage} from "../dialog/message";
import {img3115} from "../boot/compatibleVersion";
import {hideTooltip} from "../dialog/tooltip";
import {clearSelect} from "../protyle/util/clear";
import {scrollCenter} from "../util/highlightById";
import {base64ToURL} from "../util/image";

const renderAssetList = (element: Element, k: string, position: IPosition, exts: string[] = []) => {
    fetchPost("/api/search/searchAsset", {
        k,
        exts
    }, (response) => {
        let searchHTML = "";
        response.data.forEach((item: { path: string, hName: string }, index: number) => {
            searchHTML += `<div data-value="${item.path}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}"><div class="b3-list-item__text">${item.hName}</div></div>`;
        });

        const listElement = element.querySelector(".b3-list");
        const previewElement = element.querySelector("#preview");
        const inputElement = element.querySelector("input");
        listElement.innerHTML = searchHTML || `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
        if (response.data.length > 0) {
            previewElement.innerHTML = renderAssetsPreview(response.data[0].path);
        } else {
            previewElement.innerHTML = window.siyuan.languages.emptyContent;
        }
        /// #if MOBILE
        window.siyuan.menus.menu.fullscreen();
        /// #else
        window.siyuan.menus.menu.popup(position);
        /// #endif
        if (!k) {
            inputElement.select();
        }
    });
};

export const assetMenu = (protyle: IProtyle, position: IPosition, callback?: (url: string, name: string) => void, exts?: string[]) => {
    const menu = new Menu(Constants.MENU_BACKGROUND_ASSET);
    if (menu.isOpen) {
        return;
    }
    menu.addItem({
        iconHTML: "",
        type: "readonly",
        label: `<div class="fn__flex" style="max-height: ${isMobile() ? "80" : "50"}vh">
<div class="fn__flex-column" style="${isMobile() ? "width:100%" : "min-width: 260px;max-width:420px"}">
    <div class="fn__flex" style="margin: 0 8px 4px 8px">
        <input class="b3-text-field fn__flex-1"/>
        <span class="fn__space"></span>
        <span data-type="previous" class="block__icon block__icon--show"><svg><use xlink:href="#iconLeft"></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="next" class="block__icon block__icon--show"><svg><use xlink:href="#iconRight"></use></svg></span>
    </div>
    <div class="b3-list fn__flex-1 b3-list--background" style="position: relative"><img style="margin: 0 auto;display: block;width: 64px;height: 64px" src="/stage/loading-pure.svg"></div>
</div>
<div id="preview" style="width: 360px;display: ${isMobile() || window.outerWidth < window.outerWidth / 2 + 260 ? "none" : "flex"};padding: 8px;overflow: auto;justify-content: center;align-items: center;word-break: break-all;"></div>
</div>`,
        bind(element) {
            element.style.maxWidth = "none";
            const listElement = element.querySelector(".b3-list");
            const previewElement = element.querySelector("#preview");
            listElement.addEventListener("mouseover", (event) => {
                const target = event.target as HTMLElement;
                const hoverItemElement = hasClosestByClassName(target, "b3-list-item");
                if (!hoverItemElement) {
                    return;
                }
                previewElement.innerHTML = renderAssetsPreview(hoverItemElement.getAttribute("data-value"));
            });
            const inputElement = element.querySelector("input");
            inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                const isEmpty = element.querySelector(".b3-list--empty");
                if (!isEmpty) {
                    const currentElement = upDownHint(listElement, event);
                    if (currentElement) {
                        previewElement.innerHTML = renderAssetsPreview(currentElement.getAttribute("data-value"));
                        event.stopPropagation();
                    }
                }

                if (event.key === "Enter") {
                    if (!isEmpty) {
                        const currentElement = element.querySelector(".b3-list-item--focus");
                        if (callback) {
                            callback(currentElement.getAttribute("data-value"), currentElement.textContent);
                        } else {
                            hintRenderAssets(currentElement.getAttribute("data-value"), protyle);
                            window.siyuan.menus.menu.remove();
                        }
                    } else if (!callback) {
                        window.siyuan.menus.menu.remove();
                        focusByRange(protyle.toolbar.range);
                    }
                    // 空行处插入 mp3 会多一个空的 mp3 块
                    event.preventDefault();
                    event.stopPropagation();
                } else if (event.key === "Escape") {
                    if (!callback) {
                        focusByRange(protyle.toolbar.range);
                    }
                }
            });
            inputElement.addEventListener("input", (event: InputEvent) => {
                if (event.isComposing) {
                    return;
                }
                event.stopPropagation();
                renderAssetList(element, inputElement.value, position, exts);
            });
            inputElement.addEventListener("compositionend", (event: InputEvent) => {
                event.stopPropagation();
                renderAssetList(element, inputElement.value, position, exts);
            });
            element.lastElementChild.addEventListener("click", (event) => {
                const target = event.target as HTMLElement;
                const previousElement = hasClosestByAttribute(target, "data-type", "previous");
                if (previousElement) {
                    inputElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowUp"}));
                    event.stopPropagation();
                    return;
                }
                const nextElement = hasClosestByAttribute(target, "data-type", "next");
                if (nextElement) {
                    inputElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown"}));
                    event.stopPropagation();
                    return;
                }
                const listItemElement = hasClosestByClassName(target, "b3-list-item");
                if (listItemElement) {
                    event.stopPropagation();
                    const currentURL = listItemElement.getAttribute("data-value");
                    if (callback) {
                        callback(currentURL, listItemElement.textContent);
                    } else {
                        hintRenderAssets(currentURL, protyle);
                        window.siyuan.menus.menu.remove();
                    }
                }
            });
            renderAssetList(element, "", position, exts);
        }
    });
};

export const fileAnnotationRefMenu = (protyle: IProtyle, refElement: HTMLElement) => {
    const nodeElement = hasClosestBlock(refElement);
    if (!nodeElement) {
        return;
    }
    hideElements(["util", "toolbar", "hint"], protyle);
    const id = nodeElement.getAttribute("data-node-id");
    let oldHTML = nodeElement.outerHTML;
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_INLINE_FILE_ANNOTATION_REF);
    let anchorElement: HTMLInputElement;
    window.siyuan.menus.menu.append(new MenuItem({
        id: "idAndAnchor",
        iconHTML: "",
        type: "readonly",
        label: `<div>ID</div><textarea spellcheck="false" rows="1" style="margin:4px 0;width: ${isMobile() ? "100%" : "360px"}" class="b3-text-field" readonly>${refElement.getAttribute("data-id") || ""}</textarea><div class="fn__hr"></div><div>${window.siyuan.languages.anchor}</div><textarea rows="1" style="margin:4px 0;width: ${isMobile() ? "100%" : "360px"}" class="b3-text-field"></textarea>`,
        bind(menuItemElement) {
            menuItemElement.style.maxWidth = "none";
            anchorElement = menuItemElement.querySelectorAll(".b3-text-field")[1] as HTMLInputElement;
            anchorElement.value = refElement.textContent;
            const inputEvent = () => {
                if (anchorElement.value) {
                    refElement.innerHTML = Lute.EscapeHTMLStr(anchorElement.value);
                } else {
                    refElement.innerHTML = "*";
                }
            };
            anchorElement.addEventListener("input", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                inputEvent();
                event.stopPropagation();
            });
            anchorElement.addEventListener("compositionend", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                inputEvent();
                event.stopPropagation();
            });
            anchorElement.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                if (event.key === "Enter" && !event.isComposing) {
                    window.siyuan.menus.menu.remove();
                } else if (electronUndo(event)) {
                    return;
                }
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "turnInto",
        label: window.siyuan.languages.turnInto,
        icon: "iconRefresh",
        submenu: [{
            id: "text",
            iconHTML: "",
            label: window.siyuan.languages.text,
            click() {
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                removeInlineType(refElement, "file-annotation-ref", protyle.toolbar.range);
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                oldHTML = nodeElement.outerHTML;
            }
        }, {
            id: "text*",
            iconHTML: "",
            label: window.siyuan.languages.text + " *",
            click() {
                refElement.insertAdjacentHTML("beforebegin", refElement.innerHTML + " ");
                refElement.textContent = "*";
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                oldHTML = nodeElement.outerHTML;
            }
        }]
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "remove",
        icon: "iconTrashcan",
        label: window.siyuan.languages.remove,
        click() {
            refElement.insertAdjacentHTML("afterend", "<wbr>");
            refElement.remove();
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            focusByWbr(nodeElement, protyle.toolbar.range);
            oldHTML = nodeElement.outerHTML;
        }
    }).element);

    if (protyle?.app?.plugins) {
        emitOpenMenu({
            plugins: protyle.app.plugins,
            type: "open-menu-fileannotationref",
            detail: {
                protyle,
                element: refElement,
            },
            separatorPosition: "top",
        });
    }
    /// #if MOBILE
    window.siyuan.menus.menu.fullscreen();
    /// #else
    const rect = refElement.getBoundingClientRect();
    window.siyuan.menus.menu.popup({
        x: rect.left,
        y: rect.top + 26,
        h: 26
    });
    /// #endif
    const popoverElement = hasTopClosestByClassName(protyle.element, "block__popover", true);
    window.siyuan.menus.menu.element.setAttribute("data-from", popoverElement ? popoverElement.dataset.level + "popover" : "app");
    anchorElement.select();
    window.siyuan.menus.menu.removeCB = () => {
        if (nodeElement.outerHTML !== oldHTML) {
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
        }

        const currentRange = getSelection().rangeCount === 0 ? undefined : getSelection().getRangeAt(0);
        if (currentRange && !protyle.element.contains(currentRange.startContainer)) {
            protyle.toolbar.range.selectNodeContents(refElement);
            protyle.toolbar.range.collapse(false);
            focusByRange(protyle.toolbar.range);
        }
    };
};

export const refMenu = (protyle: IProtyle, element: HTMLElement) => {
    const nodeElement = hasClosestBlock(element);
    if (!nodeElement) {
        return;
    }
    hideElements(["util", "toolbar", "hint"], protyle);
    const refBlockId = element.getAttribute("data-id");
    const id = nodeElement.getAttribute("data-node-id");
    let oldHTML = nodeElement.outerHTML;
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_INLINE_REF);
    if (!protyle.disabled) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "anchor",
            iconHTML: "",
            type: "readonly",
            label: `<input style="margin: 4px 0" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.anchor}">`,
            bind(menuItemElement) {
                const inputElement = menuItemElement.querySelector("input");
                inputElement.value = element.getAttribute("data-subtype") === "d" ? "" : element.textContent;
                inputElement.addEventListener("input", () => {
                    if (inputElement.value) {
                        // 不能使用 textContent，否则 < 会变为 &lt;
                        element.innerHTML = Lute.EscapeHTMLStr(inputElement.value).trim() || refBlockId;
                    } else {
                        fetchPost("/api/block/getRefText", {id: refBlockId}, (response) => {
                            element.innerHTML = response.data;
                        });
                    }
                    element.setAttribute("data-subtype", inputElement.value ? "s" : "d");
                });
                inputElement.addEventListener("keydown", (event) => {
                    if (event.isComposing) {
                        return;
                    }
                    if (event.key === "Enter" && !event.isComposing) {
                        window.siyuan.menus.menu.remove();
                    } else if (electronUndo(event)) {
                        return;
                    }
                });
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "separator_1",
            type: "separator"
        }).element);
    }
    /// #if !MOBILE
    window.siyuan.menus.menu.append(new MenuItem({
        id: "openBy",
        label: window.siyuan.languages.openBy,
        icon: "iconOpen",
        accelerator: window.siyuan.config.keymap.editor.general.openBy.custom + "/" + window.siyuan.languages.click,
        click() {
            checkFold(refBlockId, (zoomIn, action, isRoot) => {
                if (!isRoot) {
                    action.push(Constants.CB_GET_HL);
                }
                openFileById({
                    app: protyle.app,
                    id: refBlockId,
                    action,
                    zoomIn
                });
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "refTab",
        label: window.siyuan.languages.refTab,
        icon: "iconEyeoff",
        accelerator: window.siyuan.config.keymap.editor.general.refTab.custom + "/" + updateHotkeyTip("⌘" + window.siyuan.languages.click),
        click() {
            checkFold(refBlockId, (zoomIn) => {
                openFileById({
                    app: protyle.app,
                    id: refBlockId,
                    action: zoomIn ? [Constants.CB_GET_HL, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                    keepCursor: true,
                    zoomIn
                });
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "insertRight",
        label: window.siyuan.languages.insertRight,
        icon: "iconLayoutRight",
        accelerator: window.siyuan.config.keymap.editor.general.insertRight.custom + "/" + updateHotkeyTip("⌥" + window.siyuan.languages.click),
        click() {
            checkFold(refBlockId, (zoomIn, action, isRoot) => {
                if (!isRoot) {
                    action.push(Constants.CB_GET_HL);
                }
                openFileById({
                    app: protyle.app,
                    id: refBlockId,
                    position: "right",
                    action,
                    zoomIn
                });
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "insertBottom",
        label: window.siyuan.languages.insertBottom,
        icon: "iconLayoutBottom",
        accelerator: window.siyuan.config.keymap.editor.general.insertBottom.custom + (window.siyuan.config.keymap.editor.general.insertBottom.custom ? "/" : "") + updateHotkeyTip("⇧" + window.siyuan.languages.click),
        click() {
            checkFold(refBlockId, (zoomIn, action, isRoot) => {
                if (!isRoot) {
                    action.push(Constants.CB_GET_HL);
                }
                openFileById({
                    app: protyle.app,
                    id: refBlockId,
                    position: "bottom",
                    action,
                    zoomIn
                });
            });
        }
    }).element);
    /// #if !BROWSER
    window.siyuan.menus.menu.append(new MenuItem({
        id: "openByNewWindow",
        label: window.siyuan.languages.openByNewWindow,
        icon: "iconOpenWindow",
        click() {
            openNewWindowById(refBlockId);
        }
    }).element);
    /// #endif
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "backlinks",
        icon: "iconLink",
        label: window.siyuan.languages.backlinks,
        accelerator: window.siyuan.config.keymap.editor.general.backlinks.custom,
        click: () => {
            openBacklink({
                app: protyle.app,
                blockId: refBlockId,
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "graphView",
        icon: "iconGraph",
        label: window.siyuan.languages.graphView,
        accelerator: window.siyuan.config.keymap.editor.general.graphView.custom,
        click: () => {
            openGraph({
                app: protyle.app,
                blockId: refBlockId,
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_3", type: "separator"}).element);
    /// #endif
    if (!protyle.disabled) {
        let submenu: IMenu[] = [];
        if (element.getAttribute("data-subtype") === "s") {
            submenu.push({
                id: "turnToDynamic",
                iconHTML: "",
                label: window.siyuan.languages.turnToDynamic,
                click() {
                    element.setAttribute("data-subtype", "d");
                    fetchPost("/api/block/getRefText", {id: refBlockId}, (response) => {
                        element.innerHTML = response.data;
                        nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                        updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                        oldHTML = nodeElement.outerHTML;
                    });
                    focusByRange(protyle.toolbar.range);
                }
            });
        } else {
            submenu.push({
                id: "turnToStatic",
                iconHTML: "",
                label: window.siyuan.languages.turnToStatic,
                click() {
                    element.setAttribute("data-subtype", "s");
                    nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                    updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                    focusByRange(protyle.toolbar.range);
                    oldHTML = nodeElement.outerHTML;
                }
            });
        }
        submenu = submenu.concat([{
            id: "text",
            iconHTML: "",
            label: window.siyuan.languages.text,
            click() {
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                removeInlineType(element, "block-ref", protyle.toolbar.range);
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                oldHTML = nodeElement.outerHTML;
            }
        }, {
            id: "*",
            iconHTML: "",
            label: "*",
            click() {
                element.setAttribute("data-subtype", "s");
                element.textContent = "*";
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                focusByRange(protyle.toolbar.range);
                oldHTML = nodeElement.outerHTML;
            }
        }, {
            id: "text*",
            iconHTML: "",
            label: window.siyuan.languages.text + " *",
            click() {
                element.insertAdjacentHTML("beforebegin", element.innerHTML + " ");
                element.setAttribute("data-subtype", "s");
                element.textContent = "*";
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                focusByRange(protyle.toolbar.range);
                oldHTML = nodeElement.outerHTML;
            }
        }, {
            id: "link",
            label: window.siyuan.languages.link,
            iconHTML: "",
            click() {
                element.outerHTML = `<span data-type="a" data-href="siyuan://blocks/${element.getAttribute("data-id")}">${element.innerHTML}</span><wbr>`;
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                focusByWbr(nodeElement, protyle.toolbar.range);
                oldHTML = nodeElement.outerHTML;
            }
        }]);
        if (element.parentElement.textContent.trim() === element.textContent.trim() && element.parentElement.tagName === "DIV") {
            submenu.push({
                id: "blockEmbed",
                iconHTML: "",
                label: window.siyuan.languages.blockEmbed,
                click() {
                    const html = `<div data-content="select * from blocks where id='${refBlockId}'" data-node-id="${id}" data-type="NodeBlockQueryEmbed" class="render-node" updated="${dayjs().format("YYYYMMDDHHmmss")}">${nodeElement.querySelector(".protyle-attr").outerHTML}</div>`;
                    nodeElement.outerHTML = html;
                    updateTransaction(protyle, id, html, oldHTML);
                    blockRender(protyle, protyle.wysiwyg.element);
                    oldHTML = nodeElement.outerHTML;
                }
            });
        }
        submenu.push({
            id: "defBlock",
            iconHTML: "",
            label: window.siyuan.languages.defBlock,
            click() {
                fetchPost("/api/block/swapBlockRef", {
                    refID: id,
                    defID: refBlockId,
                    includeChildren: false
                });
            }
        });
        submenu.push({
            id: "defBlockChildren",
            iconHTML: "",
            label: window.siyuan.languages.defBlockChildren,
            click() {
                fetchPost("/api/block/swapBlockRef", {
                    refID: id,
                    defID: refBlockId,
                    includeChildren: true
                });
            }
        });
        window.siyuan.menus.menu.append(new MenuItem({
            id: "turnInto",
            label: window.siyuan.languages.turnInto,
            icon: "iconRefresh",
            submenu
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        id: "copy",
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        click() {
            writeText(protyle.lute.BlockDOM2StdMd(element.outerHTML).trim());
        }
    }).element);
    if (!protyle.disabled) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "cut",
            label: window.siyuan.languages.cut,
            icon: "iconCut",
            click() {
                writeText(protyle.lute.BlockDOM2StdMd(element.outerHTML));

                element.insertAdjacentHTML("afterend", "<wbr>");
                element.remove();
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                focusByWbr(nodeElement, protyle.toolbar.range);
                oldHTML = nodeElement.outerHTML;
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "remove",
            label: window.siyuan.languages.remove,
            icon: "iconTrashcan",
            click() {
                element.insertAdjacentHTML("afterend", "<wbr>");
                element.remove();
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                focusByWbr(nodeElement, protyle.toolbar.range);
                oldHTML = nodeElement.outerHTML;
            }
        }).element);
    }
    if (protyle?.app?.plugins) {
        emitOpenMenu({
            plugins: protyle.app.plugins,
            type: "open-menu-blockref",
            detail: {
                protyle,
                element: element,
            },
            separatorPosition: "top",
        });
    }

    /// #if MOBILE
    window.siyuan.menus.menu.fullscreen();
    /// #else
    const rect = element.getBoundingClientRect();
    window.siyuan.menus.menu.popup({
        x: rect.left,
        y: rect.top + 26,
        h: 26
    });
    /// #endif
    const popoverElement = hasTopClosestByClassName(protyle.element, "block__popover", true);
    window.siyuan.menus.menu.data = element;
    window.siyuan.menus.menu.element.setAttribute("data-from", popoverElement ? popoverElement.dataset.level + "popover" : "app");
    if (!protyle.disabled) {
        window.siyuan.menus.menu.element.querySelector("input").select();
        window.siyuan.menus.menu.removeCB = () => {
            if (nodeElement.outerHTML !== oldHTML) {
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            }
            const currentRange = getSelection().rangeCount === 0 ? undefined : getSelection().getRangeAt(0);
            if (currentRange && !protyle.element.contains(currentRange.startContainer)) {
                protyle.toolbar.range.selectNodeContents(element);
                protyle.toolbar.range.collapse(false);
                focusByRange(protyle.toolbar.range);
            }
        };
    }
};

export const contentMenu = (protyle: IProtyle, nodeElement: Element) => {
    const range = getEditorRange(nodeElement);
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_INLINE_CONTEXT);
    /// #if MOBILE
    protyle.toolbar.showContent(protyle, range, nodeElement);
    /// #else
    const oldHTML = nodeElement.outerHTML;
    const id = nodeElement.getAttribute("data-node-id");
    if (range.toString() !== "" || (range.cloneContents().childNodes[0] as HTMLElement)?.classList?.contains("emoji")) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "copy",
            icon: "iconCopy",
            accelerator: "⌘C",
            label: window.siyuan.languages.copy,
            click() {
                // range 需要重新计算 https://ld246.com/article/1644979219025
                focusByRange(getEditorRange(nodeElement));
                document.execCommand("copy");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "copyPlainText",
            label: window.siyuan.languages.copyPlainText,
            accelerator: window.siyuan.config.keymap.editor.general.copyPlainText.custom,
            click() {
                focusByRange(getEditorRange(nodeElement));
                copyPlainText(getSelection().getRangeAt(0).toString());
            }
        }).element);
        if (protyle.disabled) {
            return;
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "cut",
            icon: "iconCut",
            accelerator: "⌘X",
            label: window.siyuan.languages.cut,
            click() {
                focusByRange(getEditorRange(nodeElement));
                document.execCommand("cut");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "delete",
            icon: "iconTrashcan",
            accelerator: "⌫",
            label: window.siyuan.languages.delete,
            click() {
                const currentRange = getEditorRange(nodeElement);
                currentRange.insertNode(document.createElement("wbr"));
                currentRange.extractContents();
                focusByWbr(nodeElement, currentRange);
                focusByRange(currentRange);
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            }
        }).element);
    } else {
        // https://github.com/siyuan-note/siyuan/issues/9630
        const inlineElement = hasClosestByTag(range.startContainer, "SPAN");
        if (inlineElement) {
            const inlineTypes = protyle.toolbar.getCurrentType(range);
            if (inlineTypes.includes("code") || inlineTypes.includes("kbd")) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "copy",
                    label: window.siyuan.languages.copy,
                    icon: "iconCopy",
                    click() {
                        writeText(protyle.lute.BlockDOM2StdMd(inlineElement.outerHTML));
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "copyPlainText",
                    label: window.siyuan.languages.copyPlainText,
                    click() {
                        copyPlainText(inlineElement.textContent);
                    }
                }).element);
                if (!protyle.disabled) {
                    const id = nodeElement.getAttribute("data-node-id");
                    window.siyuan.menus.menu.append(new MenuItem({
                        id: "cut",
                        icon: "iconCut",
                        label: window.siyuan.languages.cut,
                        click() {
                            writeText(protyle.lute.BlockDOM2StdMd(inlineElement.outerHTML));

                            inlineElement.insertAdjacentHTML("afterend", "<wbr>");
                            inlineElement.remove();
                            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                            focusByWbr(nodeElement, protyle.toolbar.range);
                        }
                    }).element);
                    window.siyuan.menus.menu.append(new MenuItem({
                        id: "remove",
                        icon: "iconTrashcan",
                        label: window.siyuan.languages.remove,
                        click() {
                            inlineElement.insertAdjacentHTML("afterend", "<wbr>");
                            inlineElement.remove();
                            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                            focusByWbr(nodeElement, protyle.toolbar.range);
                        }
                    }).element);
                }
                window.siyuan.menus.menu.append(new MenuItem({
                    type: "separator",
                }).element);
            }
        }
    }
    if (!protyle.disabled) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "paste",
            label: window.siyuan.languages.paste,
            icon: "iconPaste",
            accelerator: "⌘V",
            async click() {
                focusByRange(getEditorRange(nodeElement));
                if (document.queryCommandSupported("paste")) {
                    document.execCommand("paste");
                } else {
                    try {
                        const text = await readClipboard();
                        paste(protyle, Object.assign(text, {target: nodeElement as HTMLElement}));
                    } catch (e) {
                        console.log(e);
                    }
                }
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "pasteAsPlainText",
            label: window.siyuan.languages.pasteAsPlainText,
            accelerator: "⇧⌘V",
            click() {
                focusByRange(getEditorRange(nodeElement));
                pasteAsPlainText(protyle);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "pasteEscaped",
            label: window.siyuan.languages.pasteEscaped,
            click() {
                focusByRange(getEditorRange(nodeElement));
                pasteEscaped(protyle, nodeElement);
            }
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        id: "selectAll",
        label: window.siyuan.languages.selectAll,
        icon: "iconSelect",
        accelerator: "⌘A",
        click() {
            selectAll(protyle, nodeElement, range);
        }
    }).element);
    if (nodeElement.classList.contains("table") && !protyle.disabled) {
        const cellElement = hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH");
        if (cellElement) {
            const tableMenus = tableMenu(protyle, nodeElement, cellElement as HTMLTableCellElement, range);
            if (tableMenus.insertMenus.length > 0) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "separator_1",
                    type: "separator",
                }).element);
                tableMenus.insertMenus.forEach((menuItem) => {
                    window.siyuan.menus.menu.append(new MenuItem(menuItem).element);
                });
            }
            if (tableMenus.removeMenus.length > 0) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "separator_2",
                    type: "separator",
                }).element);
                tableMenus.removeMenus.forEach((menuItem) => {
                    window.siyuan.menus.menu.append(new MenuItem(menuItem).element);
                });
            }
            window.siyuan.menus.menu.append(new MenuItem({
                id: "separator_3",
                type: "separator",
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "more",
                type: "submenu",
                icon: "iconMore",
                label: window.siyuan.languages.more,
                submenu: tableMenus.otherMenus.concat(tableMenus.other2Menus)
            }).element);
        }
    }
    /// #endif
    if (protyle?.app?.plugins) {
        emitOpenMenu({
            plugins: protyle.app.plugins,
            type: "open-menu-content",
            detail: {
                protyle,
                range,
                element: nodeElement,
            },
            separatorPosition: "top",
        });
    }
};

export const enterBack = (protyle: IProtyle, id: string) => {
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
};

export const zoomOut = (options: {
    protyle: IProtyle,
    id: string,
    focusId?: string,
    isPushBack?: boolean,
    callback?: () => void,
    reload?: boolean
}) => {
    if (options.protyle.options.backlinkData) {
        return;
    }
    if (typeof options.isPushBack === "undefined") {
        options.isPushBack = true;
    }
    if (typeof options.reload === "undefined") {
        options.reload = false;
    }
    const blockPanelElement = hasClosestByClassName(options.protyle.element, "block__popover", true);
    if (blockPanelElement) {
        const pingElement = blockPanelElement.querySelector('[data-type="pin"]');
        if (pingElement && blockPanelElement.getAttribute("data-pin") !== "true") {
            pingElement.setAttribute("aria-label", window.siyuan.languages.unpin);
            pingElement.querySelector("use").setAttribute("xlink:href", "#iconUnpin");
            blockPanelElement.setAttribute("data-pin", "true");
        }
    }
    const breadcrumbHLElement = options.protyle.breadcrumb?.element.querySelector(".protyle-breadcrumb__item--active");
    if (!options.reload && breadcrumbHLElement && breadcrumbHLElement.getAttribute("data-node-id") === options.id) {
        if (options.id === options.protyle.block.rootID) {
            return;
        }
        const focusElement = options.protyle.wysiwyg.element.querySelector(`[data-node-id="${options.focusId || options.id}"]`);
        if (focusElement) {
            focusBlock(focusElement);
            focusElement.scrollIntoView();
            return;
        }
    }
    if (window.siyuan.mobile?.editor) {
        window.siyuan.storage[Constants.LOCAL_DOCINFO] = {
            id: options.id,
        };
        setStorageVal(Constants.LOCAL_DOCINFO, window.siyuan.storage[Constants.LOCAL_DOCINFO]);
        if (options.isPushBack) {
            pushBack();
        }
    }
    fetchPost("/api/filetree/getDoc", {
        id: options.id,
        size: options.id === options.protyle.block.rootID ? window.siyuan.config.editor.dynamicLoadBlocks : Constants.SIZE_GET_MAX,
    }, async (getResponse) => {
        if (options.isPushBack) {
            onGet({
                data: getResponse,
                protyle: options.protyle,
                action: options.id === options.protyle.block.rootID ? [Constants.CB_GET_FOCUS, Constants.CB_GET_HTML] : [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS, Constants.CB_GET_HTML],
                afterCB: options.callback,
            });
        } else {
            onGet({
                data: getResponse,
                protyle: options.protyle,
                action: options.id === options.protyle.block.rootID ? [Constants.CB_GET_FOCUS, Constants.CB_GET_HTML, Constants.CB_GET_UNUNDO] : [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS, Constants.CB_GET_UNUNDO, Constants.CB_GET_HTML],
                afterCB: options.callback,
            });
        }
        // https://github.com/siyuan-note/siyuan/issues/4874
        if (options.focusId) {
            let focusElement = options.protyle.wysiwyg.element.querySelector(`[data-node-id="${options.focusId}"]`);
            if (!focusElement) {
                const unfoldResponse = await fetchSyncPost("/api/block/getUnfoldedParentID", {id: options.focusId});
                options.focusId = unfoldResponse.data.parentID;
                focusElement = options.protyle.wysiwyg.element.querySelector(`[data-node-id="${unfoldResponse.data.parentID}"]`);
            }
            if (focusElement) {
                // 退出聚焦后块在折叠中 https://github.com/siyuan-note/siyuan/issues/10746
                let showElement = focusElement;
                while (showElement.getBoundingClientRect().height === 0) {
                    showElement = showElement.parentElement;
                }
                if (showElement.classList.contains("protyle-wysiwyg")) {
                    // 闪卡退出聚焦元素被隐藏 https://github.com/siyuan-note/siyuan/issues/10058#issuecomment-2029524211
                    showElement = focusElement.previousElementSibling || focusElement.nextElementSibling;
                } else {
                    showElement = getFirstBlock(showElement);
                }
                focusBlock(showElement);
                const resizeObserver = new ResizeObserver(() => {
                    scrollCenter(options.protyle, focusElement, "start");
                });
                resizeObserver.observe(options.protyle.wysiwyg.element);
                setTimeout(() => {
                    resizeObserver.disconnect();
                }, 1000 * 3);
            } else if (!options.focusId) {
                fetchPost("/api/filetree/getDoc", {
                    id: options.protyle.block.rootID,
                    size: window.siyuan.config.editor.dynamicLoadBlocks,
                }, getFocusResponse => {
                    onGet({
                        data: getFocusResponse,
                        protyle: options.protyle,
                        action: options.isPushBack ? [Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS, Constants.CB_GET_UNUNDO],
                    });
                });
                return;
            } else if (options.id === options.protyle.block.rootID) { // 聚焦返回后，该块是动态加载的，但是没加载出来
                fetchPost("/api/filetree/getDoc", {
                    id: options.focusId,
                    mode: 3,
                    size: window.siyuan.config.editor.dynamicLoadBlocks,
                }, getFocusResponse => {
                    onGet({
                        data: getFocusResponse,
                        protyle: options.protyle,
                        action: options.isPushBack ? [Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS, Constants.CB_GET_UNUNDO],
                    });
                });
                return;
            }
        } else if (options.id !== options.protyle.block.rootID) {
            options.protyle.wysiwyg.element.classList.add("protyle-wysiwyg--animate");
            setTimeout(() => {
                options.protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--animate");
            }, 365);
        }
        /// #if !MOBILE
        if (options.protyle.model) {
            const allModels = getAllModels();
            allModels.outline.forEach(item => {
                if (item.blockId === options.protyle.block.rootID) {
                    item.setCurrent(options.protyle.wysiwyg.element.querySelector(`[data-node-id="${options.focusId || options.id}"]`));
                }
            });
            updateBacklinkGraph(allModels, options.protyle);
        }
        /// #endif
    });
};

export const imgMenu = (protyle: IProtyle, range: Range, assetElement: HTMLElement, position: {
    clientX: number,
    clientY: number
}) => {
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_INLINE_IMG);
    const nodeElement = hasClosestBlock(assetElement);
    if (!nodeElement) {
        return;
    }
    hideElements(["util", "toolbar", "hint"], protyle);
    const id = nodeElement.getAttribute("data-node-id");
    const imgElement = assetElement.querySelector("img");
    const titleElement = assetElement.querySelector(".protyle-action__title span") as HTMLElement;
    const html = nodeElement.outerHTML;
    let src = imgElement.getAttribute("src");
    if (!src) {
        src = "";
    }
    if (!protyle.disabled) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "imageUrlAndTitleAndTooltipText",
            iconHTML: "",
            type: "readonly",
            label: `<div class="fn__flex">
    <span class="fn__flex-center">${window.siyuan.languages.imageURL}</span>
    <span class="fn__space"></span>
    <span data-action="copy" class="block__icon block__icon--show b3-tooltips b3-tooltips__e fn__flex-center" aria-label="${window.siyuan.languages.copy}">
        <svg><use xlink:href="#iconCopy"></use></svg>
    </span>   
</div><textarea spellcheck="false" style="margin:4px 0;width: ${isMobile() ? "100%" : "360px"}" rows="1" class="b3-text-field">${src}</textarea><div class="fn__hr"></div><div class="fn__flex">
    <span class="fn__flex-center">${window.siyuan.languages.title}</span>
    <span class="fn__space"></span>
    <span data-action="copy" class="block__icon block__icon--show b3-tooltips b3-tooltips__e fn__flex-center" aria-label="${window.siyuan.languages.copy}">
        <svg><use xlink:href="#iconCopy"></use></svg>
    </span>   
</div><textarea style="margin:4px 0;width: ${isMobile() ? "100%" : "360px"}" rows="1" class="b3-text-field"></textarea><div class="fn__hr"></div><div class="fn__flex">
    <span class="fn__flex-center">${window.siyuan.languages.tooltipText}</span>
    <span class="fn__space"></span>
    <span data-action="copy" class="block__icon block__icon--show b3-tooltips b3-tooltips__e fn__flex-center" aria-label="${window.siyuan.languages.copy}">
        <svg><use xlink:href="#iconCopy"></use></svg>
    </span>   
</div><textarea style="margin:4px 0;width: ${isMobile() ? "100%" : "360px"}" rows="1" class="b3-text-field"></textarea>`,
            bind(element) {
                element.style.maxWidth = "none";
                const textElements = element.querySelectorAll("textarea");
                textElements[0].addEventListener("input", (event: InputEvent) => {
                    const value = (event.target as HTMLInputElement).value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "").trim();
                    imgElement.setAttribute("src", value);
                    imgElement.setAttribute("data-src", value);
                    const imgNetElement = assetElement.querySelector(".img__net");
                    if (value.startsWith("assets/") || value.startsWith("data:image/")) {
                        if (imgNetElement) {
                            imgNetElement.remove();
                        }
                    } else if (window.siyuan.config.editor.displayNetImgMark && !imgNetElement) {
                        assetElement.querySelector(".protyle-action__drag").insertAdjacentHTML("afterend", '<span class="img__net"><svg><use xlink:href="#iconLanguage"></use></svg></span>');
                    }
                });
                textElements[1].value = titleElement.innerText;
                textElements[1].addEventListener("input", (event) => {
                    const value = (event.target as HTMLInputElement).value;
                    imgElement.setAttribute("title", value);
                    titleElement.innerText = value;
                    mathRender(titleElement);
                });
                textElements[2].value = imgElement.getAttribute("alt") || "";
                element.addEventListener("click", (event) => {
                    let target = event.target as HTMLElement;
                    while (target) {
                        if (target.dataset.action === "copy") {
                            writeText((target.parentElement.nextElementSibling as HTMLTextAreaElement).value);
                            showMessage(window.siyuan.languages.copied);
                            break;
                        }
                        target = target.parentElement;
                    }
                });
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        id: "copy",
        label: window.siyuan.languages.copy,
        accelerator: "⌘C",
        icon: "iconCopy",
        click() {
            let content = protyle.lute.BlockDOM2StdMd(assetElement.outerHTML);
            // The file name encoding is abnormal after copying the image and pasting it https://github.com/siyuan-note/siyuan/issues/11246
            content = content.replace(/%20/g, " ");
            writeText(content);
        }
    }).element);
    if (protyle.disabled) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "copyImageURL",
            label: window.siyuan.languages.copy + " " + window.siyuan.languages.imageURL,
            icon: "iconLink",
            click() {
                writeText(imgElement.getAttribute("src"));
            }
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        id: "copyAsPNG",
        label: window.siyuan.languages.copyAsPNG,
        accelerator: window.siyuan.config.keymap.editor.general.copyBlockRef.custom,
        icon: "iconImage",
        click() {
            copyPNGByLink(imgElement.getAttribute("src"));
        }
    }).element);
    if (!protyle.disabled) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "cut",
            icon: "iconCut",
            accelerator: "⌘X",
            label: window.siyuan.languages.cut,
            click() {
                let content = protyle.lute.BlockDOM2StdMd(assetElement.outerHTML);
                // The file name encoding is abnormal after copying the image and pasting it https://github.com/siyuan-note/siyuan/issues/11246
                content = content.replace(/%20/g, " ");
                writeText(content);
                (assetElement as HTMLElement).outerHTML = "<wbr>";
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                focusByWbr(protyle.wysiwyg.element, range);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "delete",
            icon: "iconTrashcan",
            accelerator: "⌫",
            label: window.siyuan.languages.delete,
            click: function () {
                (assetElement as HTMLElement).outerHTML = "<wbr>";
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                focusByWbr(protyle.wysiwyg.element, range);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
        const imagePath = imgElement.getAttribute("data-src");
        if (imagePath.startsWith("assets/")) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "rename",
                label: window.siyuan.languages.rename,
                icon: "iconEdit",
                click() {
                    renameAsset(imagePath);
                }
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "ocr",
            label: "OCR",
            submenu: [{
                id: "ocrResult",
                iconHTML: "",
                type: "readonly",
                label: `<textarea spellcheck="false" data-type="ocr" style="margin: 4px 0" rows="1" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.ocrResult}"></textarea>`,
                bind(element) {
                    element.style.maxWidth = "none";
                    fetchPost("/api/asset/getImageOCRText", {
                        path: imgElement.getAttribute("src")
                    }, (response) => {
                        const textarea = element.querySelector("textarea");
                        textarea.value = response.data.text;
                        textarea.dataset.ocrText = response.data.text;
                    });
                }
            }, {
                type: "separator"
            }, {
                id: "reOCR",
                iconHTML: "",
                label: window.siyuan.languages.reOCR,
                click() {
                    fetchPost("/api/asset/ocr", {
                        path: imgElement.getAttribute("src"),
                        force: true
                    });
                }
            }],
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "alignCenter",
            icon: "iconAlignCenter",
            label: window.siyuan.languages.alignCenter,
            accelerator: window.siyuan.config.keymap.editor.general.alignCenter.custom,
            click() {
                alignImgCenter(protyle, nodeElement, [assetElement], id, html);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "alignLeft",
            icon: "iconAlignLeft",
            label: window.siyuan.languages.alignLeft,
            accelerator: window.siyuan.config.keymap.editor.general.alignLeft.custom,
            click() {
                alignImgLeft(protyle, nodeElement, [assetElement], id, html);
            }
        }).element);
        let rangeElement: HTMLInputElement;
        window.siyuan.menus.menu.append(new MenuItem({
            id: "width",
            label: window.siyuan.languages.width,
            submenu: [{
                id: "widthInput",
                iconHTML: "",
                type: "readonly",
                label: `<div class="fn__flex"><input class="b3-text-field fn__flex-1" style="margin: 4px 8px 4px 0" value="${imgElement.parentElement.style.width.endsWith("px") ? parseInt(imgElement.parentElement.style.width) : ""}" type="number" placeholder="${window.siyuan.languages.width}"><span class="fn__flex-center">px</span></div>`,
                bind(element) {
                    const inputElement = element.querySelector("input");
                    inputElement.addEventListener("input", () => {
                        rangeElement.value = "0";
                        rangeElement.parentElement.setAttribute("aria-label", inputElement.value ? (inputElement.value + "px") : window.siyuan.languages.default);

                        img3115(assetElement);
                        imgElement.parentElement.style.width = inputElement.value ? (inputElement.value + "px") : "";
                        imgElement.style.height = "";
                    });
                    inputElement.addEventListener("blur", () => {
                        if (inputElement.value === imgElement.parentElement.style.width.replace("px", "")) {
                            return;
                        }
                        nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                        updateTransaction(protyle, id, nodeElement.outerHTML, html);
                        window.siyuan.menus.menu.remove();
                        focusBlock(nodeElement);
                    });
                }
            },
                genImageWidthMenu("25%", imgElement, protyle, id, nodeElement, html),
                genImageWidthMenu("33%", imgElement, protyle, id, nodeElement, html),
                genImageWidthMenu("50%", imgElement, protyle, id, nodeElement, html),
                genImageWidthMenu("67%", imgElement, protyle, id, nodeElement, html),
                genImageWidthMenu("75%", imgElement, protyle, id, nodeElement, html),
                genImageWidthMenu("100%", imgElement, protyle, id, nodeElement, html), {
                    id: "separator_1",
                    type: "separator",
                }, {
                    id: "widthDrag",
                    iconHTML: "",
                    type: "readonly",
                    label: `<div style="margin: 4px 0;" aria-label="${imgElement.parentElement.style.width ? imgElement.parentElement.style.width.replace("vw", "%").replace("calc(", "").replace(" - 8px)", "") : window.siyuan.languages.default}" class="b3-tooltips b3-tooltips__n"><input style="box-sizing: border-box" value="${(imgElement.parentElement.style.width.indexOf("%") > -1 || imgElement.parentElement.style.width.endsWith("vw")) ? parseInt(imgElement.parentElement.style.width.replace("calc(", "")) : 0}" class="b3-slider fn__block" max="100" min="1" step="1" type="range"></div>`,
                    bind(element) {
                        rangeElement = element.querySelector("input");
                        rangeElement.addEventListener("input", () => {
                            img3115(assetElement);
                            imgElement.parentElement.style.width = `calc(${rangeElement.value}% - 8px)`;
                            imgElement.style.height = "";
                            rangeElement.parentElement.setAttribute("aria-label", `${rangeElement.value}%`);
                        });
                        rangeElement.addEventListener("change", () => {
                            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                            updateTransaction(protyle, id, nodeElement.outerHTML, html);
                            window.siyuan.menus.menu.remove();
                            focusBlock(nodeElement);
                        });
                    }
                }, {
                    id: "separator_2",
                    type: "separator",
                },
                genImageWidthMenu(window.siyuan.languages.default, imgElement, protyle, id, nodeElement, html),
            ]
        }).element);
        let rangeHeightElement: HTMLInputElement;
        window.siyuan.menus.menu.append(new MenuItem({
            id: "height",
            label: window.siyuan.languages.height,
            submenu: [{
                id: "heightInput",
                iconHTML: "",
                type: "readonly",
                label: `<div class="fn__flex"><input class="b3-text-field fn__flex-1" value="${imgElement.style.height.endsWith("px") ? parseInt(imgElement.style.height) : ""}" type="number" style="margin: 4px 8px 4px 0" placeholder="${window.siyuan.languages.height}"><span class="fn__flex-center">px</span></div>`,
                bind(element) {
                    const inputElement = element.querySelector("input");
                    inputElement.addEventListener("input", () => {
                        rangeHeightElement.value = "0";
                        rangeHeightElement.parentElement.setAttribute("aria-label", inputElement.value ? (inputElement.value + "px") : window.siyuan.languages.default);

                        imgElement.style.height = inputElement.value ? (inputElement.value + "px") : "";
                        img3115(assetElement);
                        imgElement.parentElement.style.width = "";
                    });
                    inputElement.addEventListener("blur", () => {
                        if (inputElement.value === imgElement.style.height.replace("px", "")) {
                            return;
                        }
                        nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                        updateTransaction(protyle, id, nodeElement.outerHTML, html);
                        window.siyuan.menus.menu.remove();
                        focusBlock(nodeElement);
                    });
                }
            },
                genImageHeightMenu("25%", imgElement, protyle, id, nodeElement, html),
                genImageHeightMenu("33%", imgElement, protyle, id, nodeElement, html),
                genImageHeightMenu("50%", imgElement, protyle, id, nodeElement, html),
                genImageHeightMenu("67%", imgElement, protyle, id, nodeElement, html),
                genImageHeightMenu("75%", imgElement, protyle, id, nodeElement, html),
                genImageHeightMenu("100%", imgElement, protyle, id, nodeElement, html), {
                    id: "separator_1",
                    type: "separator",
                }, {
                    id: "heightDrag",
                    iconHTML: "",
                    type: "readonly",
                    label: `<div style="margin: 4px 0;" aria-label="${imgElement.style.height ? imgElement.style.height.replace("vh", "%") : window.siyuan.languages.default}" class="b3-tooltips b3-tooltips__n"><input style="box-sizing: border-box" value="${imgElement.style.height.endsWith("vh") ? parseInt(imgElement.style.height) : 0}" class="b3-slider fn__block" max="100" min="1" step="1" type="range"></div>`,
                    bind(element) {
                        rangeHeightElement = element.querySelector("input");
                        rangeHeightElement.addEventListener("input", () => {
                            img3115(assetElement);
                            imgElement.parentElement.style.width = "";
                            imgElement.style.height = rangeHeightElement.value + "vh";
                            rangeHeightElement.parentElement.setAttribute("aria-label", `${rangeHeightElement.value}%`);
                        });
                        rangeHeightElement.addEventListener("change", () => {
                            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                            updateTransaction(protyle, id, nodeElement.outerHTML, html);
                            window.siyuan.menus.menu.remove();
                            focusBlock(nodeElement);
                        });
                    }
                }, {
                    id: "separator_2",
                    type: "separator",
                },
                genImageHeightMenu(window.siyuan.languages.default, imgElement, protyle, id, nodeElement, html),
            ]
        }).element);
    }
    const imgSrc = imgElement.getAttribute("src");
    if (imgSrc) {
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_3", type: "separator"}).element);
        openMenu(protyle.app, imgSrc, false, false);
    }
    const dataSrc = imgElement.getAttribute("data-src");
    if (dataSrc && dataSrc.startsWith("assets/")) {
        window.siyuan.menus.menu.append(new MenuItem(exportAsset(dataSrc)).element);
    }
    if (protyle?.app?.plugins) {
        emitOpenMenu({
            plugins: protyle.app.plugins,
            type: "open-menu-image",
            detail: {
                protyle,
                element: assetElement,
            },
            separatorPosition: "top",
        });
    }
    /// #if MOBILE
    window.siyuan.menus.menu.fullscreen();
    /// #else
    window.siyuan.menus.menu.popup({x: position.clientX, y: position.clientY});
    /// #endif
    const popoverElement = hasTopClosestByClassName(protyle.element, "block__popover", true);
    window.siyuan.menus.menu.element.setAttribute("data-from", popoverElement ? popoverElement.dataset.level + "popover" : "app");
    if (!protyle.disabled) {
        const textElements = window.siyuan.menus.menu.element.querySelectorAll("textarea");
        if (textElements[0].value) {
            textElements[1].select();
        } else {
            textElements[0].select();
        }
        window.siyuan.menus.menu.removeCB = async () => {
            const newSrc = textElements[0].value;
            if (src !== newSrc && newSrc.startsWith("data:image/")) {
                const base64Src = await base64ToURL([newSrc]);
                imgElement.setAttribute("src", base64Src[0]);
                imgElement.setAttribute("data-src", base64Src[0]);
                assetElement.querySelector(".img__net")?.remove();
            }

            const ocrElement = window.siyuan.menus.menu.element.querySelector('[data-type="ocr"]') as HTMLTextAreaElement;
            if (ocrElement && ocrElement.dataset.ocrText !== ocrElement.value) {
                fetchPost("/api/asset/setImageOCRText", {
                    path: imgElement.getAttribute("src"),
                    text: ocrElement.value
                });
            }
            imgElement.setAttribute("alt", textElements[2].value.replace(/\n|\r\n|\r|\u2028|\u2029/g, ""));
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
        };
    }
};

export const linkMenu = (protyle: IProtyle, linkElement: HTMLElement, focusText = false) => {
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_INLINE_A);
    const nodeElement = hasClosestBlock(linkElement);
    if (!nodeElement) {
        return;
    }
    hideTooltip();
    hideElements(["util", "toolbar", "hint"], protyle);
    const id = nodeElement.getAttribute("data-node-id");
    let html = nodeElement.outerHTML;
    const linkAddress = linkElement.getAttribute("data-href");
    let inputElements: NodeListOf<HTMLTextAreaElement>;
    if (!protyle.disabled) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "linkAndAnchorAndTitle",
            iconHTML: "",
            type: "readonly",
            label: `<div class="fn__flex">
    <span class="fn__flex-center">${window.siyuan.languages.link}</span>
    <span class="fn__space"></span>
    <span data-action="copy" class="block__icon block__icon--show b3-tooltips b3-tooltips__e fn__flex-center" aria-label="${window.siyuan.languages.copy}">
        <svg><use xlink:href="#iconCopy"></use></svg>
    </span>   
</div><textarea spellcheck="false" rows="1" 
style="margin:4px 0;width: ${isMobile() ? "100%" : "360px"}" class="b3-text-field"></textarea><div class="fn__hr"></div><div class="fn__flex">
    <span class="fn__flex-center">${window.siyuan.languages.anchor}</span>
    <span class="fn__space"></span>
    <span data-action="copy" class="block__icon block__icon--show b3-tooltips b3-tooltips__e fn__flex-center" aria-label="${window.siyuan.languages.copy}">
        <svg><use xlink:href="#iconCopy"></use></svg>
    </span>   
</div><textarea style="width: ${isMobile() ? "100%" : "360px"};margin: 4px 0;" rows="1" class="b3-text-field"></textarea><div class="fn__hr"></div><div class="fn__flex">
    <span class="fn__flex-center">${window.siyuan.languages.title}</span>
    <span class="fn__space"></span>
    <span data-action="copy" class="block__icon block__icon--show b3-tooltips b3-tooltips__e fn__flex-center" aria-label="${window.siyuan.languages.copy}">
        <svg><use xlink:href="#iconCopy"></use></svg>
    </span>   
</div><textarea style="width: ${isMobile() ? "100%" : "360px"};margin: 4px 0;" rows="1" class="b3-text-field"></textarea>`,
            bind(element) {
                element.style.maxWidth = "none";
                inputElements = element.querySelectorAll("textarea");
                inputElements[0].value = Lute.UnEscapeHTMLStr(linkAddress) || "";
                inputElements[0].addEventListener("keydown", (event) => {
                    if ((event.key === "Enter" || event.key === "Escape") && !event.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        window.siyuan.menus.menu.remove();
                    } else if (event.key === "Tab" && !event.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        inputElements[1].focus();
                    } else if (electronUndo(event)) {
                        return;
                    }
                });

                // https://github.com/siyuan-note/siyuan/issues/6798
                let anchor = linkElement.textContent.replace(Constants.ZWSP, "");
                if (!anchor && linkAddress) {
                    anchor = decodeURIComponent(linkAddress.replace("https://", "").replace("http://", ""));
                    if (anchor.length > Constants.SIZE_LINK_TEXT_MAX) {
                        anchor = anchor.substring(0, Constants.SIZE_LINK_TEXT_MAX) + "...";
                    }
                    linkElement.innerHTML = Lute.EscapeHTMLStr(anchor);
                }
                inputElements[1].value = anchor;
                inputElements[1].addEventListener("compositionend", () => {
                    linkElement.innerHTML = Lute.EscapeHTMLStr(inputElements[1].value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "").trim() || "*");
                });
                inputElements[1].addEventListener("input", (event: KeyboardEvent) => {
                    if (!event.isComposing) {
                        // https://github.com/siyuan-note/siyuan/issues/4511
                        linkElement.innerHTML = Lute.EscapeHTMLStr(inputElements[1].value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "").trim()) || "*";
                    }
                });
                inputElements[1].addEventListener("keydown", (event) => {
                    if ((event.key === "Enter" || event.key === "Escape") && !event.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        window.siyuan.menus.menu.remove();
                    } else if (event.key === "Tab" && !event.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.shiftKey) {
                            inputElements[0].focus();
                        } else {
                            inputElements[2].focus();
                        }
                    } else if (electronUndo(event)) {
                        return;
                    }
                });

                inputElements[2].value = Lute.UnEscapeHTMLStr(linkElement.getAttribute("data-title") || "");
                inputElements[2].addEventListener("keydown", (event) => {
                    if ((event.key === "Enter" || event.key === "Escape") && !event.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        window.siyuan.menus.menu.remove();
                    } else if (event.key === "Tab" && event.shiftKey && !event.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        inputElements[1].focus();
                    } else if (electronUndo(event)) {
                        return;
                    }
                });

                element.addEventListener("click", (event) => {
                    let target = event.target as HTMLElement;
                    while (target) {
                        if (target.dataset.action === "copy") {
                            writeText((target.parentElement.nextElementSibling as HTMLTextAreaElement).value);
                            showMessage(window.siyuan.languages.copied);
                            break;
                        }
                        target = target.parentElement;
                    }
                });
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        id: "copy",
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        click() {
            const range = document.createRange();
            range.selectNode(linkElement);
            focusByRange(range);
            document.execCommand("copy");
        }
    }).element);
    if (protyle.disabled) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "copyAHref",
            label: window.siyuan.languages.copyAHref,
            icon: "iconLink",
            click() {
                writeText(linkAddress);
            }
        }).element);
    }
    if (!protyle.disabled) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "cut",
            icon: "iconCut",
            label: window.siyuan.languages.cut,
            click() {
                const range = document.createRange();
                range.selectNode(linkElement);
                focusByRange(range);
                document.execCommand("cut");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "remove",
            icon: "iconTrashcan",
            label: window.siyuan.languages.remove,
            click() {
                linkElement.insertAdjacentHTML("afterend", "<wbr>");
                linkElement.remove();
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                focusByWbr(nodeElement, protyle.toolbar.range);
                html = nodeElement.outerHTML;
            }
        }).element);
        if (linkAddress?.startsWith("assets/")) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "rename",
                label: window.siyuan.languages.rename,
                icon: "iconEdit",
                click() {
                    renameAsset(linkAddress);
                }
            }).element);
        }
        if (linkAddress?.startsWith("siyuan://blocks/")) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "turnIntoRef",
                label: `${window.siyuan.languages.turnInto} <b>${window.siyuan.languages.ref}</b>`,
                icon: "iconRef",
                click() {
                    linkElement.setAttribute("data-subtype", "s");
                    const types = linkElement.getAttribute("data-type").split(" ");
                    types.push("block-ref");
                    types.splice(types.indexOf("a"), 1);
                    linkElement.setAttribute("data-type", types.join(" "));
                    linkElement.setAttribute("data-id", inputElements[0].value.replace("siyuan://blocks/", ""));
                    inputElements[0].value = "";
                    inputElements[2].value = "";
                    linkElement.removeAttribute("data-href");
                    linkElement.removeAttribute("data-title");
                    nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                    updateTransaction(protyle, id, nodeElement.outerHTML, html);
                    protyle.toolbar.range.selectNode(linkElement);
                    protyle.toolbar.range.collapse(false);
                    focusByRange(protyle.toolbar.range);
                    html = nodeElement.outerHTML;
                }
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "turnIntoText",
            label: `${window.siyuan.languages.turnInto} <b>${window.siyuan.languages.text}</b>`,
            icon: "iconRefresh",
            click() {
                inputElements[0].value = "";
                inputElements[2].value = "";
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                removeInlineType(linkElement, "a", protyle.toolbar.range);
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
            }
        }).element);
    }

    if (linkAddress) {
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
        openMenu(protyle.app, linkAddress, false, true);
        if (linkAddress?.startsWith("assets/")) {
            window.siyuan.menus.menu.append(new MenuItem(exportAsset(linkAddress)).element);
        }
    }

    if (!protyle.disabled && protyle?.app?.plugins) {
        emitOpenMenu({
            plugins: protyle.app.plugins,
            type: "open-menu-link",
            detail: {
                protyle,
                element: linkElement,
            },
            separatorPosition: "top",
        });
    }
    /// #if MOBILE
    window.siyuan.menus.menu.fullscreen();
    /// #else
    const rect = linkElement.getBoundingClientRect();
    window.siyuan.menus.menu.popup({
        x: rect.left,
        y: rect.top + 26,
        h: 26
    });
    /// #endif

    const popoverElement = hasTopClosestByClassName(protyle.element, "block__popover", true);
    window.siyuan.menus.menu.element.setAttribute("data-from", popoverElement ? popoverElement.dataset.level + "popover" : "app");
    if (protyle.disabled) {
        return;
    }
    if (focusText || protyle.lute.GetLinkDest(linkAddress) || linkAddress?.startsWith("assets/")) {
        inputElements[1].select();
    } else {
        inputElements[0].select();
    }
    window.siyuan.menus.menu.removeCB = () => {
        if (inputElements[2].value) {
            linkElement.setAttribute("data-title", Lute.EscapeHTMLStr(inputElements[2].value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "")));
        } else {
            linkElement.removeAttribute("data-title");
        }
        if (linkElement.getAttribute("data-type").indexOf("a") > -1) {
            linkElement.setAttribute("data-href", Lute.EscapeHTMLStr(inputElements[0].value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "")));
        } else {
            linkElement.removeAttribute("data-href");
        }
        if (!inputElements[1].value && (inputElements[0].value || inputElements[2].value)) {
            linkElement.textContent = "*";
        }
        const currentRange = getSelection().rangeCount === 0 ? undefined : getSelection().getRangeAt(0);
        if (currentRange && !protyle.element.contains(currentRange.startContainer)) {
            protyle.toolbar.range.selectNodeContents(linkElement);
            protyle.toolbar.range.collapse(false);
            focusByRange(protyle.toolbar.range);
        }
        if (!inputElements[1].value && !inputElements[0].value && !inputElements[2].value) {
            linkElement.remove();
        }
        if (html !== nodeElement.outerHTML) {
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
        }
    };
};

export const tagMenu = (protyle: IProtyle, tagElement: HTMLElement) => {
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_INLINE_TAG);
    const nodeElement = hasClosestBlock(tagElement);
    if (!nodeElement) {
        return;
    }
    hideElements(["util", "toolbar", "hint"], protyle);
    const id = nodeElement.getAttribute("data-node-id");
    let html = nodeElement.outerHTML;
    window.siyuan.menus.menu.append(new MenuItem({
        id: "tag",
        iconHTML: "",
        type: "readonly",
        label: `<input class="b3-text-field fn__block" style="margin: 4px 0" placeholder="${window.siyuan.languages.tag}">`,
        bind(element) {
            const inputElement = element.querySelector("input");
            inputElement.value = tagElement.textContent.replace(Constants.ZWSP, "");
            inputElement.addEventListener("change", () => {
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
            });
            inputElement.addEventListener("compositionend", () => {
                tagElement.innerHTML = Constants.ZWSP + Lute.EscapeHTMLStr(inputElement.value || "");
            });
            inputElement.addEventListener("input", (event: KeyboardEvent) => {
                if (!event.isComposing) {
                    // https://github.com/siyuan-note/siyuan/issues/4511
                    tagElement.innerHTML = Constants.ZWSP + Lute.EscapeHTMLStr(inputElement.value || "");
                }
            });
            inputElement.addEventListener("keydown", (event) => {
                if ((event.key === "Enter" || event.key === "Escape") && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!inputElement.value) {
                        const oldHTML = nodeElement.outerHTML;
                        tagElement.insertAdjacentHTML("afterend", "<wbr>");
                        tagElement.remove();
                        nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                        updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                        focusByWbr(nodeElement, protyle.toolbar.range);
                    } else {
                        protyle.toolbar.range.selectNodeContents(tagElement);
                        protyle.toolbar.range.collapse(false);
                        focusByRange(protyle.toolbar.range);
                    }
                    window.siyuan.menus.menu.remove();
                } else if (electronUndo(event)) {
                    return;
                }
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);

    window.siyuan.menus.menu.append(new MenuItem({
        id: "search",
        label: window.siyuan.languages.search,
        accelerator: window.siyuan.languages.click,
        icon: "iconSearch",
        click() {
            /// #if !MOBILE
            openGlobalSearch(protyle.app, `#${tagElement.textContent}#`, false, {method: 0});
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
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "rename",
        label: window.siyuan.languages.rename,
        icon: "iconEdit",
        click() {
            renameTag(tagElement.textContent.replace(Constants.ZWSP, ""));
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "turnIntoText",
        label: `${window.siyuan.languages.turnInto} <b>${window.siyuan.languages.text}</b>`,
        icon: "iconRefresh",
        click() {
            protyle.toolbar.range.setStart(tagElement.firstChild, 0);
            protyle.toolbar.range.setEnd(tagElement.lastChild, tagElement.lastChild.textContent.length);
            protyle.toolbar.setInlineMark(protyle, "tag", "range");
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "copy",
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        click() {
            const range = document.createRange();
            range.selectNode(tagElement);
            focusByRange(range);
            document.execCommand("copy");
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "cut",
        label: window.siyuan.languages.cut,
        icon: "iconCut",
        click() {
            const range = document.createRange();
            range.selectNode(tagElement);
            focusByRange(range);
            document.execCommand("cut");
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "remove",
        icon: "iconTrashcan",
        label: window.siyuan.languages.remove,
        click() {
            const oldHTML = nodeElement.outerHTML;
            tagElement.insertAdjacentHTML("afterend", "<wbr>");
            tagElement.remove();
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            focusByWbr(nodeElement, protyle.toolbar.range);
        }
    }).element);

    if (protyle?.app?.plugins) {
        emitOpenMenu({
            plugins: protyle.app.plugins,
            type: "open-menu-tag",
            detail: {
                protyle,
                element: tagElement,
            },
            separatorPosition: "top",
        });
    }

    /// #if MOBILE
    window.siyuan.menus.menu.fullscreen();
    /// #else
    const rect = tagElement.getBoundingClientRect();
    window.siyuan.menus.menu.popup({
        x: rect.left,
        y: rect.top + 26,
        h: 26
    });
    /// #endif
    const popoverElement = hasTopClosestByClassName(protyle.element, "block__popover", true);
    window.siyuan.menus.menu.element.setAttribute("data-from", popoverElement ? popoverElement.dataset.level + "popover" : "app");
    window.siyuan.menus.menu.element.querySelector("input").select();
};

export const inlineMathMenu = (protyle: IProtyle, element: Element) => {
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_INLINE_MATH);
    const nodeElement = hasClosestBlock(element);
    if (!nodeElement) {
        return;
    }
    const id = nodeElement.getAttribute("data-node-id");
    const html = nodeElement.outerHTML;
    window.siyuan.menus.menu.append(new MenuItem({
        id: "copy",
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        click() {
            const range = document.createRange();
            range.selectNode(element);
            focusByRange(range);
            document.execCommand("copy");
        }
    }).element);
    if (!protyle.disabled) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "cut",
            icon: "iconCut",
            label: window.siyuan.languages.cut,
            click() {
                const range = document.createRange();
                range.selectNode(element);
                focusByRange(range);
                document.execCommand("cut");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "remove",
            icon: "iconTrashcan",
            label: window.siyuan.languages.remove,
            click() {
                element.insertAdjacentHTML("afterend", "<wbr>");
                element.remove();
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                focusByWbr(nodeElement, protyle.toolbar.range);
            }
        }).element);
    }
    const rect = element.getBoundingClientRect();
    window.siyuan.menus.menu.popup({
        x: rect.left,
        y: rect.top + 26,
        h: 26
    });
};

const genImageWidthMenu = (label: string, imgElement: HTMLElement, protyle: IProtyle, id: string, nodeElement: HTMLElement, html: string) => {
    return {
        id: label === window.siyuan.languages.default ? "default" : "width_" + label,
        iconHTML: "",
        label,
        click() {
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            img3115(imgElement.parentElement.parentElement);
            imgElement.parentElement.style.width = label === window.siyuan.languages.default ? "" : `calc(${label} - 8px)`;
            imgElement.style.height = "";
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
            focusBlock(nodeElement);
        }
    };
};

const genImageHeightMenu = (label: string, imgElement: HTMLElement, protyle: IProtyle, id: string, nodeElement: HTMLElement, html: string) => {
    return {
        id: label === window.siyuan.languages.default ? "default" : "width_" + label,
        iconHTML: "",
        label,
        click() {
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            imgElement.style.height = label === window.siyuan.languages.default ? "" : parseInt(label) + "vh";
            img3115(imgElement.parentElement.parentElement);
            imgElement.parentElement.style.width = "";
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
            focusBlock(nodeElement);
        }
    };
};

export const iframeMenu = (protyle: IProtyle, nodeElement: Element) => {
    const id = nodeElement.getAttribute("data-node-id");
    const iframeElement = nodeElement.querySelector("iframe");
    let html = nodeElement.outerHTML;
    const subMenus: IMenu[] = [{
        id: "asset",
        iconHTML: "",
        type: "readonly",
        label: `<textarea spellcheck="false" rows="1" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.link}" style="margin: 4px 0">${iframeElement.getAttribute("src") || ""}</textarea>`,
        bind(element) {
            element.style.maxWidth = "none";
            element.querySelector("textarea").addEventListener("change", (event) => {
                const value = (event.target as HTMLTextAreaElement).value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "").trim();
                const biliMatch = value.match(/(?:www\.|\/\/)bilibili\.com\/video\/(\w+)/);
                if (value.indexOf("bilibili.com") > -1 && (value.indexOf("bvid=") > -1 || (biliMatch && biliMatch[1]))) {
                    const params: IObject = {
                        bvid: getSearch("bvid", value) || (biliMatch && biliMatch[1]),
                        page: "1",
                        high_quality: "1",
                        as_wide: "1",
                        allowfullscreen: "true",
                        autoplay: "0"
                    };
                    // `//player.bilibili.com/player.html?aid=895154192&bvid=BV1NP4y1M72N&cid=562898119&page=1`
                    // `https://www.bilibili.com/video/BV1ys411472E?t=3.4&p=4`
                    new URL(value.startsWith("http") ? value : "https:" + value).search.split("&").forEach((item, index) => {
                        if (!item) {
                            return;
                        }
                        if (index === 0) {
                            item = item.substr(1);
                        }
                        const keyValue = item.split("=");
                        params[keyValue[0]] = keyValue[1];
                    });
                    let src = "https://player.bilibili.com/player.html?";
                    const keys = Object.keys(params);
                    keys.forEach((key, index) => {
                        src += `${key}=${params[key]}`;
                        if (index < keys.length - 1) {
                            src += "&";
                        }
                    });
                    iframeElement.setAttribute("src", src);
                    iframeElement.setAttribute("sandbox", "allow-top-navigation-by-user-activation allow-same-origin allow-forms allow-scripts allow-popups");
                    if (!iframeElement.style.height) {
                        iframeElement.style.height = "360px";
                    }
                    if (!iframeElement.style.width) {
                        iframeElement.style.width = "640px";
                    }
                } else {
                    iframeElement.setAttribute("src", value);
                }

                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
                event.stopPropagation();
            });
        }
    }];
    const iframeSrc = iframeElement.getAttribute("src");
    if (iframeSrc) {
        subMenus.push({
            type: "separator"
        });
        return subMenus.concat(openMenu(protyle.app, iframeSrc, true, false) as IMenu[]);
    }
    return subMenus;
};

export const videoMenu = (protyle: IProtyle, nodeElement: Element, type: string) => {
    const id = nodeElement.getAttribute("data-node-id");
    const videoElement = nodeElement.querySelector(type === "NodeVideo" ? "video" : "audio");
    let html = nodeElement.outerHTML;
    const subMenus: IMenu[] = [{
        id: "asset",
        iconHTML: "",
        type: "readonly",
        label: `<textarea spellcheck="false" rows="1" style="margin: 4px 0" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.link}">${videoElement.getAttribute("src")}</textarea>`,
        bind(element) {
            element.style.maxWidth = "none";
            element.querySelector("textarea").addEventListener("change", (event) => {
                videoElement.setAttribute("src", (event.target as HTMLTextAreaElement).value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "").trim());
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
                event.stopPropagation();
            });
        }
    }];
    const src = videoElement.getAttribute("src");
    if (src && src.startsWith("assets/")) {
        subMenus.push({
            type: "separator"
        });
        subMenus.push({
            id: "rename",
            label: window.siyuan.languages.rename,
            icon: "iconEdit",
            click() {
                renameAsset(src);
            }
        });
    }
    if (src) {
        subMenus.push({
            id: "openBy",
            label: window.siyuan.languages.openBy,
            icon: "iconOpen",
            submenu: openMenu(protyle.app, src, true, false) as IMenu[]
        });
    }
    if (src && src.startsWith("assets/")) {
        subMenus.push(exportAsset(src));
    }
    return subMenus;
};

export const tableMenu = (protyle: IProtyle, nodeElement: Element, cellElement: HTMLTableCellElement, range: Range) => {
    const otherMenus: IMenu[] = [];
    const colIndex = getColIndex(cellElement);
    if (cellElement.rowSpan > 1 || cellElement.colSpan > 1) {
        otherMenus.push({
            id: "cancelMerged",
            label: window.siyuan.languages.cancelMerged,
            click: () => {
                const oldHTML = nodeElement.outerHTML;
                let rowSpan = cellElement.rowSpan;
                let currentRowElement: Element = cellElement.parentElement;
                const orgColSpan = cellElement.colSpan;
                while (rowSpan > 0 && currentRowElement) {
                    let currentCellElement = currentRowElement.children[colIndex] as HTMLTableCellElement;
                    let colSpan = orgColSpan;
                    while (colSpan > 0 && currentCellElement) {
                        currentCellElement.classList.remove("fn__none");
                        currentCellElement.colSpan = 1;
                        currentCellElement.rowSpan = 1;
                        currentCellElement = currentCellElement.nextElementSibling as HTMLTableCellElement;
                        colSpan--;
                    }
                    currentRowElement = currentRowElement.nextElementSibling;
                    rowSpan--;
                }
                cellElement.rowSpan = 1;
                cellElement.colSpan = 1;
                if (cellElement.tagName === "TH") {
                    let prueTrElement: HTMLElement;
                    Array.from(nodeElement.querySelectorAll("thead tr")).find((item: HTMLElement) => {
                        prueTrElement = item;
                        Array.from(item.children).forEach((cellElement: HTMLTableCellElement) => {
                            if (cellElement.rowSpan !== 1 || cellElement.classList.contains("fn__none")) {
                                prueTrElement = undefined;
                            }
                        });
                        if (prueTrElement) {
                            return true;
                        }
                    });
                    if (prueTrElement) {
                        const tbodyElement = nodeElement.querySelector("tbody");
                        const theadElement = nodeElement.querySelector("thead");
                        while (prueTrElement !== theadElement.lastElementChild) {
                            tbodyElement.insertAdjacentElement("afterbegin", theadElement.lastElementChild);
                        }
                    }
                }
                focusByRange(range);
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
            }
        });
    }
    const thMatchElement = nodeElement.querySelectorAll("col")[colIndex];
    if (thMatchElement.style.width || thMatchElement.style.minWidth !== "60px") {
        otherMenus.push({
            id: "useDefaultWidth",
            label: window.siyuan.languages.useDefaultWidth,
            click: () => {
                const html = nodeElement.outerHTML;
                thMatchElement.style.width = "";
                thMatchElement.style.minWidth = "60px";
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
            }
        });
    }
    const isPinHead = nodeElement.getAttribute("custom-pinthead");
    otherMenus.push({
        id: isPinHead ? "unpinTableHead" : "pinTableHead",
        icon: isPinHead ? "iconUnpin" : "iconPin",
        label: isPinHead ? window.siyuan.languages.unpinTableHead : window.siyuan.languages.pinTableHead,
        click: () => {
            const html = nodeElement.outerHTML;
            if (isPinHead) {
                nodeElement.removeAttribute("custom-pinthead");
            } else {
                nodeElement.setAttribute("custom-pinthead", "true");
            }
            updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
        }
    });
    otherMenus.push({id: "separator_1", type: "separator"});
    otherMenus.push({
        id: "alignLeft",
        icon: "iconAlignLeft",
        accelerator: window.siyuan.config.keymap.editor.general.alignLeft.custom,
        label: window.siyuan.languages.alignLeft,
        click: () => {
            setTableAlign(protyle, [cellElement], nodeElement, "left", range);
        }
    });
    otherMenus.push({
        id: "alignCenter",
        icon: "iconAlignCenter",
        label: window.siyuan.languages.alignCenter,
        accelerator: window.siyuan.config.keymap.editor.general.alignCenter.custom,
        click: () => {
            setTableAlign(protyle, [cellElement], nodeElement, "center", range);
        }
    });
    otherMenus.push({
        id: "alignRight",
        icon: "iconAlignRight",
        label: window.siyuan.languages.alignRight,
        accelerator: window.siyuan.config.keymap.editor.general.alignRight.custom,
        click: () => {
            setTableAlign(protyle, [cellElement], nodeElement, "right", range);
        }
    });
    otherMenus.push({
        id: "useDefaultAlign",
        icon: "",
        label: window.siyuan.languages.useDefaultAlign,
        click: () => {
            setTableAlign(protyle, [cellElement], nodeElement, "", range);
        }
    });
    const menus: IMenu[] = [];
    menus.push(...otherMenus);
    menus.push({
        type: "separator"
    });
    const tableElement = nodeElement.querySelector("table");
    const hasNone = cellElement.parentElement.querySelector(".fn__none");
    let hasColSpan = false;
    let hasRowSpan = false;
    Array.from(cellElement.parentElement.children).forEach((item: HTMLTableCellElement) => {
        if (item.colSpan > 1) {
            hasColSpan = true;
        }
        if (item.rowSpan > 1) {
            hasRowSpan = true;
        }
    });
    let previousHasNone: false | Element = false;
    let previousHasColSpan = false;
    let previousHasRowSpan = false;
    let previousRowElement = cellElement.parentElement.previousElementSibling;
    if (!previousRowElement && cellElement.parentElement.parentElement.tagName === "TBODY") {
        previousRowElement = tableElement.querySelector("thead").lastElementChild;
    }
    if (previousRowElement) {
        previousHasNone = previousRowElement.querySelector(".fn__none");
        Array.from(previousRowElement.children).forEach((item: HTMLTableCellElement) => {
            if (item.colSpan > 1) {
                previousHasColSpan = true;
            }
            if (item.rowSpan > 1) {
                previousHasRowSpan = true;
            }
        });
    }
    let nextHasNone: false | Element = false;
    let nextHasColSpan = false;
    let nextHasRowSpan = false;
    let nextRowElement = cellElement.parentElement.nextElementSibling;
    if (!nextRowElement && cellElement.parentElement.parentElement.tagName === "THEAD") {
        nextRowElement = tableElement.querySelector("tbody")?.firstElementChild;
    }
    if (nextRowElement) {
        nextHasNone = nextRowElement.querySelector(".fn__none");
        Array.from(nextRowElement.children).forEach((item: HTMLTableCellElement) => {
            if (item.colSpan > 1) {
                nextHasColSpan = true;
            }
            if (item.rowSpan > 1) {
                nextHasRowSpan = true;
            }
        });
    }
    let colIsPure = true;
    Array.from(tableElement.rows).find(item => {
        const cellElement = item.cells[colIndex];
        if (cellElement.classList.contains("fn__none") || cellElement.colSpan > 1 || cellElement.rowSpan > 1) {
            colIsPure = false;
            return true;
        }
    });
    let nextColIsPure = true;
    Array.from(tableElement.rows).find(item => {
        const cellElement = item.cells[colIndex + 1];
        if (cellElement && (cellElement.classList.contains("fn__none") || cellElement.colSpan > 1 || cellElement.rowSpan > 1)) {
            nextColIsPure = false;
            return true;
        }
    });
    let previousColIsPure = true;
    Array.from(tableElement.rows).find(item => {
        const cellElement = item.cells[colIndex - 1];
        if (cellElement && (cellElement.classList.contains("fn__none") || cellElement.colSpan > 1 || cellElement.rowSpan > 1)) {
            previousColIsPure = false;
            return true;
        }
    });
    const insertMenus = [];
    insertMenus.push({
        id: "insertRowAbove",
        icon: "iconBefore",
        label: window.siyuan.languages.insertRowAbove,
        accelerator: window.siyuan.config.keymap.editor.table.insertRowAbove.custom,
        click: () => {
            insertRowAbove(protyle, range, cellElement, nodeElement);
        }
    });
    if (!nextHasNone || (nextHasNone && !nextHasRowSpan && nextHasColSpan)) {
        insertMenus.push({
            id: "insertRowBelow",
            icon: "iconAfter",
            label: window.siyuan.languages.insertRowBelow,
            accelerator: window.siyuan.config.keymap.editor.table.insertRowBelow.custom,
            click: () => {
                insertRow(protyle, range, cellElement, nodeElement);
            }
        });
    }
    if (colIsPure || previousColIsPure) {
        insertMenus.push({
            id: "insertColumnLeft",
            icon: "iconInsertLeft",
            label: window.siyuan.languages.insertColumnLeft,
            accelerator: window.siyuan.config.keymap.editor.table.insertColumnLeft.custom,
            click: () => {
                insertColumn(protyle, nodeElement, cellElement, "beforebegin", range);
            }
        });
    }
    if (colIsPure || nextColIsPure) {
        insertMenus.push({
            id: "insertColumnRight",
            icon: "iconInsertRight",
            label: window.siyuan.languages.insertColumnRight,
            accelerator: window.siyuan.config.keymap.editor.table.insertColumnRight.custom,
            click: () => {
                insertColumn(protyle, nodeElement, cellElement, "afterend", range);
            }
        });
    }
    menus.push(...insertMenus);
    const other2Menus: IMenu[] = [];
    if (((!hasNone || (hasNone && !hasRowSpan && hasColSpan)) &&
            (!previousHasNone || (previousHasNone && !previousHasRowSpan && previousHasColSpan))) ||
        ((!hasNone || (hasNone && !hasRowSpan && hasColSpan)) &&
            (!nextHasNone || (nextHasNone && !nextHasRowSpan && nextHasColSpan))) ||
        (colIsPure && previousColIsPure) ||
        (colIsPure && nextColIsPure)
    ) {
        other2Menus.push({
            id: "separator_2",
            type: "separator"
        });
    }

    if ((!hasNone || (hasNone && !hasRowSpan && hasColSpan)) &&
        (!previousHasNone || (previousHasNone && !previousHasRowSpan && previousHasColSpan))) {
        other2Menus.push({
            id: "moveToUp",
            icon: "iconUp",
            label: window.siyuan.languages.moveToUp,
            accelerator: window.siyuan.config.keymap.editor.table.moveToUp.custom,
            click: () => {
                moveRowToUp(protyle, range, cellElement, nodeElement);
            }
        });
    }
    if ((!hasNone || (hasNone && !hasRowSpan && hasColSpan)) &&
        (!nextHasNone || (nextHasNone && !nextHasRowSpan && nextHasColSpan))) {
        other2Menus.push({
            id: "moveToDown",
            icon: "iconDown",
            label: window.siyuan.languages.moveToDown,
            accelerator: window.siyuan.config.keymap.editor.table.moveToDown.custom,
            click: () => {
                moveRowToDown(protyle, range, cellElement, nodeElement);
            }
        });
    }
    if (colIsPure && previousColIsPure) {
        other2Menus.push({
            id: "moveToLeft",
            icon: "iconLeft",
            label: window.siyuan.languages.moveToLeft,
            accelerator: window.siyuan.config.keymap.editor.table.moveToLeft.custom,
            click: () => {
                moveColumnToLeft(protyle, range, cellElement, nodeElement);
            }
        });
    }
    if (colIsPure && nextColIsPure) {
        other2Menus.push({
            id: "moveToRight",
            icon: "iconRight",
            label: window.siyuan.languages.moveToRight,
            accelerator: window.siyuan.config.keymap.editor.table.moveToRight.custom,
            click: () => {
                moveColumnToRight(protyle, range, cellElement, nodeElement);
            }
        });
    }
    menus.push(...other2Menus);
    if ((cellElement.parentElement.parentElement.tagName !== "THEAD" &&
        ((!hasNone && !hasRowSpan) || (hasNone && !hasRowSpan && hasColSpan))) || colIsPure) {
        menus.push({
            type: "separator"
        });
    }
    const removeMenus = [];
    if (cellElement.parentElement.parentElement.tagName !== "THEAD" &&
        ((!hasNone && !hasRowSpan) || (hasNone && !hasRowSpan && hasColSpan))) {
        removeMenus.push({
            id: "deleteRow",
            icon: "iconDeleteRow",
            label: window.siyuan.languages["delete-row"],
            accelerator: window.siyuan.config.keymap.editor.table["delete-row"].custom,
            click: () => {
                deleteRow(protyle, range, cellElement, nodeElement);
            }
        });
    }
    if (colIsPure) {
        removeMenus.push({
            id: "deleteColumn",
            icon: "iconDeleteColumn",
            label: window.siyuan.languages["delete-column"],
            accelerator: window.siyuan.config.keymap.editor.table["delete-column"].custom,
            click: () => {
                deleteColumn(protyle, range, nodeElement, cellElement);
            }
        });
    }
    menus.push(...removeMenus);
    return {menus, removeMenus, insertMenus, otherMenus, other2Menus};
};

export const setFoldById = (data: {
    id: string,
    currentNodeID: string,
}, protyle: IProtyle) => {
    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${data.id}"]`)).find((item: Element) => {
        if (!isInEmbedBlock(item)) {
            const operations = setFold(protyle, item, true, false, true, true);
            operations.doOperations[0].context = {
                focusId: data.currentNodeID,
            };
            transaction(protyle, operations.doOperations, operations.undoOperations);
            return true;
        }
    });
};

export const setFold = (protyle: IProtyle, nodeElement: Element, isOpen?: boolean,
                        isRemove?: boolean, addLoading = true, getOperations = false) => {
    if (nodeElement.getAttribute("data-type") === "NodeListItem" && nodeElement.childElementCount < 4 &&
        // 该情况需要强制展开 https://github.com/siyuan-note/siyuan/issues/12327
        !isOpen) {
        // 没有子列表或多个块的列表项不进行折叠
        return {fold: -1};
    }
    if (nodeElement.getAttribute("data-type") === "NodeThematicBreak") {
        return {fold: -1};
    }
    const hasFold = nodeElement.getAttribute("fold") === "1";
    if (hasFold) {
        if (typeof isOpen === "boolean" && !isOpen) {
            return {fold: -1};
        }
        nodeElement.removeAttribute("fold");
        // https://github.com/siyuan-note/siyuan/issues/4411
        nodeElement.querySelectorAll(".protyle-linenumber__rows").forEach((item: HTMLElement) => {
            lineNumberRender(item.parentElement);
        });
    } else {
        if (typeof isOpen === "boolean" && isOpen) {
            return {fold: -1};
        }
        nodeElement.setAttribute("fold", "1");
        // 光标在子列表中，再次 focus 段尾的时候不会变 https://ld246.com/article/1647099132461
        if (getSelection().rangeCount > 0) {
            const range = getSelection().getRangeAt(0);
            const blockElement = hasClosestBlock(range.startContainer);
            if (blockElement && blockElement.getBoundingClientRect().width === 0) {
                // https://github.com/siyuan-note/siyuan/issues/5833
                focusBlock(nodeElement, undefined, false);
            }
        }
        clearSelect(["img", "av"], nodeElement);
        scrollCenter(protyle, nodeElement);
    }
    const id = nodeElement.getAttribute("data-node-id");
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    if (nodeElement.getAttribute("data-type") === "NodeHeading") {
        if (hasFold) {
            if (addLoading) {
                nodeElement.insertAdjacentHTML("beforeend", '<div spin="1" style="text-align: center"><img width="24px" height="24px" src="/stage/loading-pure.svg"></div>');
            }
            doOperations.push({
                action: "unfoldHeading",
                id,
                data: isRemove ? "remove" : undefined,
            });
            undoOperations.push({
                action: "foldHeading",
                id
            });
        } else {
            doOperations.push({
                action: "foldHeading",
                id
            });
            undoOperations.push({
                action: "unfoldHeading",
                id
            });
            removeFoldHeading(nodeElement);
        }
    } else {
        doOperations.push({
            action: "setAttrs",
            id,
            data: JSON.stringify({fold: hasFold ? "" : "1"})
        });
        undoOperations.push({
            action: "setAttrs",
            id,
            data: JSON.stringify({fold: hasFold ? "1" : ""})
        });
    }
    if (!getOperations) {
        transaction(protyle, doOperations, undoOperations);
    }
    // 折叠后，防止滚动条滚动后调用 get 请求 https://github.com/siyuan-note/siyuan/issues/2248
    preventScroll(protyle);
    return {fold: !hasFold ? 1 : 0, undoOperations, doOperations};
};
