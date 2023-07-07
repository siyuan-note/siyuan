import {hasClosestBlock, hasClosestByMatchTag} from "../protyle/util/hasClosest";
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
import {fetchPost} from "../util/fetch";
import {Constants} from "../constants";
import {copyPlainText, readText, setStorageVal, writeText} from "../protyle/util/compatibility";
import {preventScroll} from "../protyle/scroll/preventScroll";
import {onGet} from "../protyle/util/onGet";
import {getAllModels} from "../layout/getAll";
import {pasteAsPlainText, pasteText} from "../protyle/util/paste";
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
import {copyPNG, exportAsset} from "./util";
import {removeLink} from "../protyle/toolbar/Link";
import {alignImgCenter, alignImgLeft} from "../protyle/wysiwyg/commonHotkey";
import {renameTag} from "../util/noRelyPCFunction";
import {hideElements} from "../protyle/ui/hideElements";
import {emitOpenMenu} from "../plugin/EventBus";

export const fileAnnotationRefMenu = (protyle: IProtyle, refElement: HTMLElement) => {
    const nodeElement = hasClosestBlock(refElement);
    if (!nodeElement) {
        return;
    }
    hideElements(["util", "toolbar", "hint"], protyle);
    const id = nodeElement.getAttribute("data-node-id");
    const oldHTML = nodeElement.outerHTML;
    window.siyuan.menus.menu.remove();
    let anchorElement: HTMLInputElement;
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<input style="margin: 4px 0" class="b3-text-field fn__block" value="${refElement.getAttribute("data-id") || ""}" readonly placeholder="ID">`,
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<input style="margin: 4px 0" class="b3-text-field fn__block" data-type="anchor" placeholder="${window.siyuan.languages.anchor}">`,
        bind(menuItemElement) {
            anchorElement = menuItemElement.querySelector("input");
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
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.remove,
        click() {
            refElement.outerHTML = refElement.textContent + "<wbr>";
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

    const rect = refElement.getBoundingClientRect();
    window.siyuan.menus.menu.popup({
        x: rect.left,
        y: rect.top + 26,
        h: 26
    });

    anchorElement.select();
    window.siyuan.menus.menu.removeCB = () => {
        if (nodeElement.outerHTML !== oldHTML) {
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
        }

        const currentRange = getSelection().rangeCount === 0 ? undefined : getSelection().getRangeAt(0);
        if (currentRange && !protyle.element.contains(currentRange.startContainer)) {
            if (refElement.parentElement) {
                protyle.toolbar.range.selectNodeContents(refElement);
                protyle.toolbar.range.collapse(false);
                focusByRange(protyle.toolbar.range);
            } else {
                focusByWbr(nodeElement, protyle.toolbar.range);
            }
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
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<input style="margin: 4px 0" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.anchor}">`,
        bind(menuItemElement) {
            const inputElement = menuItemElement.querySelector("input");
            inputElement.value = element.getAttribute("data-subtype") === "d" ? "" : element.textContent;
            inputElement.addEventListener("input", () => {
                if (inputElement.value) {
                    // 不能使用 textContent，否则 < 会变为 &lt;
                    element.innerHTML = Lute.EscapeHTMLStr(inputElement.value);
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
        type: "separator"
    }).element);
    /// #if !MOBILE
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.openBy,
        accelerator: window.siyuan.config.keymap.editor.general.openBy.custom + "/Click",
        click() {
            fetchPost("/api/block/checkBlockFold", {id: refBlockId}, (foldResponse) => {
                openFileById({
                    app: protyle.app,
                    id: refBlockId,
                    action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                    zoomIn: foldResponse.data
                });
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.refTab,
        accelerator: window.siyuan.config.keymap.editor.general.refTab.custom + "/⌘Click",
        click() {
            fetchPost("/api/block/checkBlockFold", {id: refBlockId}, (foldResponse) => {
                openFileById({
                    app: protyle.app,
                    id: refBlockId,
                    action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT],
                    keepCursor: true,
                    zoomIn: foldResponse.data
                });
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.insertRight,
        icon: "iconLayoutRight",
        accelerator: window.siyuan.config.keymap.editor.general.insertRight.custom + "/⌥Click",
        click() {
            fetchPost("/api/block/checkBlockFold", {id: refBlockId}, (foldResponse) => {
                openFileById({
                    app: protyle.app,
                    id: refBlockId,
                    position: "right",
                    action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                    zoomIn: foldResponse.data
                });
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.insertBottom,
        icon: "iconLayoutBottom",
        accelerator: window.siyuan.config.keymap.editor.general.insertBottom.custom + (window.siyuan.config.keymap.editor.general.insertBottom.custom ? "/" : "") + "⇧Click",
        click() {
            fetchPost("/api/block/checkBlockFold", {id: refBlockId}, (foldResponse) => {
                openFileById({
                    app: protyle.app,
                    id: refBlockId,
                    position: "bottom",
                    action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                    zoomIn: foldResponse.data
                });
            });
        }
    }).element);
    /// #if !BROWSER
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.openByNewWindow,
        icon: "iconOpenWindow",
        click() {
            openNewWindowById(refBlockId);
        }
    }).element);
    /// #endif
    /// #endif
    let submenu: IMenu[] = [];
    if (element.getAttribute("data-subtype") === "s") {
        submenu.push({
            label: window.siyuan.languages.turnToDynamic,
            click() {
                element.setAttribute("data-subtype", "d");
                fetchPost("/api/block/getRefText", {id: refBlockId}, (response) => {
                    element.innerHTML = response.data;
                    nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                    updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                });
                focusByRange(protyle.toolbar.range);
            }
        });
    } else {
        submenu.push({
            label: window.siyuan.languages.turnToStatic,
            click() {
                element.setAttribute("data-subtype", "s");
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                focusByRange(protyle.toolbar.range);
            }
        });
    }
    submenu = submenu.concat([{
        label: window.siyuan.languages.text,
        click() {
            element.outerHTML = `${element.innerHTML}<wbr>`;
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            focusByWbr(nodeElement, protyle.toolbar.range);
        }
    }, {
        label: "*",
        click() {
            element.setAttribute("data-subtype", "s");
            element.textContent = "*";
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            focusByRange(protyle.toolbar.range);
        }
    }, {
        label: window.siyuan.languages.text + " *",
        click() {
            element.insertAdjacentHTML("beforebegin", element.innerHTML + " ");
            element.setAttribute("data-subtype", "s");
            element.textContent = "*";
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            focusByRange(protyle.toolbar.range);
        }
    }, {
        label: window.siyuan.languages.link,
        icon: "iconLink",
        click() {
            element.outerHTML = `<span data-type="a" data-href="siyuan://blocks/${element.getAttribute("data-id")}">${element.innerHTML}</span><wbr>`;
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            focusByWbr(nodeElement, protyle.toolbar.range);
        }
    }]);
    if (element.parentElement.textContent.trim() === element.textContent.trim() && element.parentElement.tagName === "DIV") {
        submenu.push({
            label: window.siyuan.languages.blockEmbed,
            icon: "iconSQL",
            click() {
                const html = `<div data-content="select * from blocks where id='${refBlockId}'" data-node-id="${id}" data-type="NodeBlockQueryEmbed" class="render-node" updated="${dayjs().format("YYYYMMDDHHmmss")}">${nodeElement.querySelector(".protyle-attr").outerHTML}</div>`;
                nodeElement.outerHTML = html;
                updateTransaction(protyle, id, html, oldHTML);
                blockRender(protyle, protyle.wysiwyg.element);
            }
        });
    }
    submenu.push({
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
        label: window.siyuan.languages.turnInto,
        icon: "iconRefresh",
        submenu
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        click() {
            const quote = element.getAttribute("data-subtype") === "s" ? '"' : "'";
            writeText(`((${refBlockId} ${quote}${element.textContent}${quote}))`);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.remove,
        icon: "iconTrashcan",
        click() {
            element.insertAdjacentHTML("afterend", "<wbr>");
            element.remove();
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            focusByWbr(nodeElement, protyle.toolbar.range);
        }
    }).element);

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

    const rect = element.getBoundingClientRect();
    window.siyuan.menus.menu.popup({
        x: rect.left,
        y: rect.top + 26,
        h: 26
    });
    window.siyuan.menus.menu.element.querySelector("input").select();
    window.siyuan.menus.menu.removeCB = () => {
        if (nodeElement.outerHTML !== oldHTML) {
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            oldHTML = nodeElement.outerHTML;
        }
        const currentRange = getSelection().rangeCount === 0 ? undefined : getSelection().getRangeAt(0);
        if (currentRange && !protyle.element.contains(currentRange.startContainer)) {
            protyle.toolbar.range.selectNodeContents(element);
            protyle.toolbar.range.collapse(false);
            focusByRange(protyle.toolbar.range);
        }
    };
};

export const contentMenu = (protyle: IProtyle, nodeElement: Element) => {
    const range = getEditorRange(nodeElement);
    window.siyuan.menus.menu.remove();
    if (range.toString() !== "" || (range.cloneContents().childNodes[0] as HTMLElement)?.classList?.contains("emoji")) {
        window.siyuan.menus.menu.append(new MenuItem({
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
            label: window.siyuan.languages.copyPlainText,
            accelerator: window.siyuan.config.keymap.editor.general.copyPlainText.custom,
            click() {
                focusByRange(getEditorRange(nodeElement));
                const cloneContents = getSelection().getRangeAt(0).cloneContents();
                cloneContents.querySelectorAll('[data-type="backslash"]').forEach(item => {
                    item.firstElementChild.remove();
                });
                copyPlainText(cloneContents.textContent);
            }
        }).element);
        if (protyle.disabled) {
            return;
        }
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconCut",
            accelerator: "⌘X",
            label: window.siyuan.languages.cut,
            click() {
                focusByRange(getEditorRange(nodeElement));
                document.execCommand("cut");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconTrashcan",
            accelerator: "⌫",
            label: window.siyuan.languages.delete,
            click() {
                const currentRange = getEditorRange(nodeElement);
                currentRange.insertNode(document.createElement("wbr"));
                const oldHTML = nodeElement.outerHTML;
                currentRange.extractContents();
                focusByWbr(nodeElement, currentRange);
                focusByRange(currentRange);
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
            }
        }).element);
    }
    if (!protyle.disabled) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.paste,
            accelerator: "⌘V",
            async click() {
                if (document.queryCommandSupported("paste")) {
                    document.execCommand("paste");
                } else {
                    try {
                        const clipText = await readText();
                        pasteText(protyle, clipText, nodeElement);
                    } catch (e) {
                        console.log(e);
                    }
                }
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.pasteAsPlainText,
            accelerator: "⇧⌘V",
            click() {
                focusByRange(getEditorRange(nodeElement));
                pasteAsPlainText(protyle);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.pasteEscaped,
            async click() {
                try {
                    // * _ [ ] ! \ ` < > & ~ { } ( ) = # $ ^ |
                    let clipText = await readText();
                    // https://github.com/siyuan-note/siyuan/issues/5446
                    // A\B\C\D\
                    // E
                    // task-blog-2~default~baiduj 无法原义粘贴含有 `~foo~` 的文本 https://github.com/siyuan-note/siyuan/issues/5523

                    // 这里必须多加一个反斜杆，因为 Lute 在进行 Markdown 嵌套节点转换平铺标记节点时会剔除 Backslash 节点，
                    // 多加入的一个反斜杆会作为文本节点保留下来，后续 Spin 时刚好用于转义标记符 https://github.com/siyuan-note/siyuan/issues/6341
                    clipText = clipText.replace(/\\/g, "\\\\\\\\")
                        .replace(/\*/g, "\\\\\\*")
                        .replace(/\_/g, "\\\\\\_")
                        .replace(/\[/g, "\\\\\\[")
                        .replace(/\]/g, "\\\\\\]")
                        .replace(/\!/g, "\\\\\\!")
                        .replace(/\`/g, "\\\\\\`")
                        .replace(/\</g, "\\\\\\<")
                        .replace(/\>/g, "\\\\\\>")
                        .replace(/\&/g, "\\\\\\&")
                        .replace(/\~/g, "\\\\\\~")
                        .replace(/\{/g, "\\\\\\{")
                        .replace(/\}/g, "\\\\\\}")
                        .replace(/\(/g, "\\\\\\(")
                        .replace(/\)/g, "\\\\\\)")
                        .replace(/\=/g, "\\\\\\=")
                        .replace(/\#/g, "\\\\\\#")
                        .replace(/\$/g, "\\\\\\$")
                        .replace(/\^/g, "\\\\\\^")
                        .replace(/\|/g, "\\\\\\|");
                    pasteText(protyle, clipText, nodeElement);
                } catch (e) {
                    console.log(e);
                }
            }
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.selectAll,
        accelerator: "⌘A",
        click() {
            selectAll(protyle, nodeElement, range);
        }
    }).element);
    if (nodeElement.classList.contains("table")) {
        const cellElement = hasClosestByMatchTag(range.startContainer, "TD") || hasClosestByMatchTag(range.startContainer, "TH");
        if (cellElement) {
            window.siyuan.menus.menu.append(new MenuItem({
                type: "submenu",
                icon: "iconTable",
                label: window.siyuan.languages.table,
                submenu: tableMenu(protyle, nodeElement, cellElement as HTMLTableCellElement, range) as IMenu[]
            }).element);
        }
    }
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
    }, getResponse => {
        if (options.isPushBack) {
            onGet({
                data: getResponse,
                protyle: options.protyle,
                action: options.id === options.protyle.block.rootID ? [Constants.CB_GET_FOCUS, Constants.CB_GET_HTML] : [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS, Constants.CB_GET_HTML],
            });
        } else {
            onGet({
                data: getResponse,
                protyle: options.protyle,
                action: options.id === options.protyle.block.rootID ? [Constants.CB_GET_FOCUS, Constants.CB_GET_HTML, Constants.CB_GET_UNUNDO] : [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS, Constants.CB_GET_UNUNDO, Constants.CB_GET_HTML],
            });
        }
        // https://github.com/siyuan-note/siyuan/issues/4874
        if (options.focusId) {
            const focusElement = options.protyle.wysiwyg.element.querySelector(`[data-node-id="${options.focusId}"]`);
            if (focusElement) {
                focusBlock(focusElement);
                focusElement.scrollIntoView();
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
        if (options.callback) {
            options.callback();
        }
    });
};

export const imgMenu = (protyle: IProtyle, range: Range, assetElement: HTMLElement, position: {
    clientX: number,
    clientY: number
}) => {
    window.siyuan.menus.menu.remove();
    const nodeElement = hasClosestBlock(assetElement);
    if (!nodeElement) {
        return;
    }
    hideElements(["util", "toolbar", "hint"], protyle);
    const id = nodeElement.getAttribute("data-node-id");
    const imgElement = assetElement.querySelector("img");
    const titleElement = assetElement.querySelector(".protyle-action__title") as HTMLElement;
    const html = nodeElement.outerHTML;
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: `<textarea style="margin: 4px 0" rows="1" class="b3-text-field fn__size200" placeholder="${window.siyuan.languages.imageURL}">${imgElement.getAttribute("src")}</textarea>`,
        bind(element) {
            element.querySelector("textarea").addEventListener("change", (event) => {
                const value = (event.target as HTMLInputElement).value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "");
                imgElement.setAttribute("src", value);
                imgElement.setAttribute("data-src", value);
                if (value.startsWith("assets/")) {
                    const imgNetElement = assetElement.querySelector(".img__net");
                    if (imgNetElement) {
                        imgNetElement.remove();
                    }
                } else if (window.siyuan.config.editor.displayNetImgMark) {
                    assetElement.querySelector(".protyle-action__drag").insertAdjacentHTML("afterend", '<span class="img__net"><svg><use xlink:href="#iconLanguage"></use></svg></span>');
                }
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: `<textarea style="margin: 4px 0" rows="1" class="b3-text-field fn__size200" placeholder="${window.siyuan.languages.title}"></textarea>`,
        bind(element) {
            const inputElement = element.querySelector("textarea");
            inputElement.value = titleElement.textContent;
            inputElement.addEventListener("input", (event) => {
                const value = (event.target as HTMLInputElement).value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "");
                imgElement.setAttribute("title", value);
                titleElement.textContent = value;
                mathRender(titleElement);
                assetElement.style.maxWidth = (imgElement.clientWidth + 10) + "px";
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: `<textarea style="margin: 4px 0" rows="1" class="b3-text-field fn__size200" placeholder="${window.siyuan.languages.tooltipText}"></textarea>`,
        bind(element) {
            element.querySelector("textarea").value = imgElement.getAttribute("alt") || "";
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.copy,
        accelerator: "⌘C",
        icon: "iconCopy",
        click() {
            writeText(protyle.lute.BlockDOM2StdMd(assetElement.outerHTML));
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.copy + " PNG",
        accelerator: window.siyuan.config.keymap.editor.general.copyBlockRef.custom,
        icon: "iconImage",
        click() {
            copyPNG(imgElement);
        }
    }).element);
    /// #if !BROWSER
    window.siyuan.menus.menu.append(new MenuItem({
        label: "OCR",
        submenu: [{
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.reOCR,
            click() {
                fetchPost("/api/asset/getImageOCRText", {
                    path: imgElement.getAttribute("src"),
                    force: true
                });
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: `<textarea data-type="ocr" style="margin: 4px 0" rows="1" class="b3-text-field fn__size200" placeholder="${window.siyuan.languages.ocrResult}"></textarea>`,
            bind(element) {
                fetchPost("/api/asset/getImageOCRText", {
                    path: imgElement.getAttribute("src"),
                    force: false
                }, (response) => {
                    element.querySelector("textarea").value = response.data.text;
                });
            }
        }],
    }).element);
    window.siyuan.menus.menu.append(new MenuItem(exportAsset(imgElement.getAttribute("data-src"))).element);
    /// #endif
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconCut",
        accelerator: "⌘X",
        label: window.siyuan.languages.cut,
        click() {
            writeText(protyle.lute.BlockDOM2StdMd(assetElement.outerHTML));
            (assetElement as HTMLElement).outerHTML = "<wbr>";
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
            focusByWbr(protyle.wysiwyg.element, range);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
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
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    const imagePath = imgElement.getAttribute("data-src");
    if (imagePath.startsWith("assets/")) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.rename,
            click() {
                renameAsset(imagePath);
            }
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconAlignCenter",
        label: window.siyuan.languages.alignCenter,
        accelerator: window.siyuan.config.keymap.editor.general.alignCenter.custom,
        click() {
            alignImgCenter(protyle, nodeElement, [assetElement], id, html);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconAlignLeft",
        label: window.siyuan.languages.alignLeft,
        accelerator: window.siyuan.config.keymap.editor.general.alignLeft.custom,
        click() {
            alignImgLeft(protyle, nodeElement, [assetElement], id, html);
        }
    }).element);
    const width = parseInt(assetElement.style.width || "0");
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.width,
        submenu: [genImageWidthMenu("25%", assetElement, imgElement, protyle, id, nodeElement, html),
            genImageWidthMenu("33%", assetElement, imgElement, protyle, id, nodeElement, html),
            genImageWidthMenu("50%", assetElement, imgElement, protyle, id, nodeElement, html),
            genImageWidthMenu("67%", assetElement, imgElement, protyle, id, nodeElement, html),
            genImageWidthMenu("75%", assetElement, imgElement, protyle, id, nodeElement, html),
            genImageWidthMenu("100%", assetElement, imgElement, protyle, id, nodeElement, html), {
                type: "separator",
            }, {
                label: `<div aria-label="${width === 0 ? window.siyuan.languages.default : width + "%"}" class="b3-tooltips b3-tooltips__n${isMobile() ? "" : " fn__size200"}">
    <input style="box-sizing: border-box" value="${width}" class="b3-slider fn__block" max="100" min="1" step="1" type="range">
</div>`,
                bind(element) {
                    const rangeElement = element.querySelector("input");
                    rangeElement.addEventListener("input", () => {
                        assetElement.style.width = rangeElement.value + "%";
                        imgElement.style.width = "10000px";
                        assetElement.style.maxWidth = "";
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
                type: "separator",
            },
            genImageWidthMenu(window.siyuan.languages.default, assetElement, imgElement, protyle, id, nodeElement, html),
        ]
    }).element);
    const imgSrc = imgElement.getAttribute("src");
    if (imgSrc) {
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        openMenu(protyle.app, imgSrc, false, false);
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

    window.siyuan.menus.menu.popup({x: position.clientX, y: position.clientY});
    const textElements = window.siyuan.menus.menu.element.querySelectorAll("textarea");
    textElements[0].focus();
    window.siyuan.menus.menu.removeCB = () => {
        const ocrElemennt = window.siyuan.menus.menu.element.querySelector('[data-type="ocr"]') as HTMLTextAreaElement;
        if (ocrElemennt) {
            fetchPost("/api/asset/setImageOCRText", {
                path: imgElement.getAttribute("src"),
                text: ocrElemennt.value
            });
        }
        imgElement.setAttribute("alt", textElements[2].value.replace(/\n|\r\n|\r|\u2028|\u2029/g, ""));
        nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(protyle, id, nodeElement.outerHTML, html);
    };
};

export const linkMenu = (protyle: IProtyle, linkElement: HTMLElement, focusText = false) => {
    window.siyuan.menus.menu.remove();
    const nodeElement = hasClosestBlock(linkElement);
    if (!nodeElement) {
        return;
    }
    hideElements(["util", "toolbar", "hint"], protyle);
    const id = nodeElement.getAttribute("data-node-id");
    const html = nodeElement.outerHTML;
    const linkAddress = linkElement.getAttribute("data-href");
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: `<textarea rows="1" style="margin:4px 0;width: ${isMobile() ? "200" : "360"}px" class="b3-text-field" placeholder="${window.siyuan.languages.link}"></textarea>`,
        bind(element) {
            const inputElement = element.querySelector("textarea");
            inputElement.value = Lute.UnEscapeHTMLStr(linkAddress) || "";
            inputElement.addEventListener("keydown", (event) => {
                if ((event.key === "Enter" || event.key === "Escape") && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    window.siyuan.menus.menu.remove();
                } else if (event.key === "Tab" && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    element.nextElementSibling.querySelector("textarea").focus();
                } else if (electronUndo(event)) {
                    return;
                }
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: `<textarea style="width: ${isMobile() ? "200" : "360"}px;margin: 4px 0;" rows="1" class="b3-text-field" placeholder="${window.siyuan.languages.anchor}"></textarea>`,
        bind(element) {
            const inputElement = element.querySelector("textarea");
            // https://github.com/siyuan-note/siyuan/issues/6798
            let anchor = linkElement.textContent.replace(Constants.ZWSP, "");
            if (!anchor && linkAddress) {
                anchor = linkAddress.replace("https://", "").replace("http://", "");
                if (anchor.length > 24) {
                    anchor = anchor.substring(0, Constants.SIZE_LINK_TEXT_MAX) + "...";
                }
                linkElement.innerHTML = Lute.EscapeHTMLStr(anchor);
            }
            inputElement.value = anchor;
            inputElement.addEventListener("compositionend", () => {
                linkElement.innerHTML = Lute.EscapeHTMLStr(inputElement.value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "") || "");
            });
            inputElement.addEventListener("input", (event: KeyboardEvent) => {
                if (!event.isComposing) {
                    // https://github.com/siyuan-note/siyuan/issues/4511
                    linkElement.innerHTML = Lute.EscapeHTMLStr(inputElement.value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "")) || "";
                }
            });
            inputElement.addEventListener("keydown", (event) => {
                if ((event.key === "Enter" || event.key === "Escape") && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    window.siyuan.menus.menu.remove();
                } else if (event.key === "Tab" && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.shiftKey) {
                        element.previousElementSibling.querySelector("textarea").focus();
                    } else {
                        element.nextElementSibling.querySelector("textarea").focus();
                    }
                } else if (electronUndo(event)) {
                    return;
                }
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: `<textarea style="width: ${isMobile() ? "200" : "360"}px;margin: 4px 0;" rows="1" class="b3-text-field" placeholder="${window.siyuan.languages.title}"></textarea>`,
        bind(element) {
            const inputElement = element.querySelector("textarea");
            inputElement.value = Lute.UnEscapeHTMLStr(linkElement.getAttribute("data-title") || "");
            inputElement.addEventListener("keydown", (event) => {
                if ((event.key === "Enter" || event.key === "Escape") && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    window.siyuan.menus.menu.remove();
                } else if (event.key === "Tab" && event.shiftKey && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    element.previousElementSibling.querySelector("textarea").focus();
                } else if (electronUndo(event)) {
                    return;
                }
            });
        }
    }).element);
    if (linkAddress) {
        openMenu(protyle.app, linkAddress, false, true);
    }
    if (linkAddress?.startsWith("siyuan://blocks/")) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: `${window.siyuan.languages.turnInto} <b>${window.siyuan.languages.ref}</b>`,
            icon: "iconRef",
            click() {
                linkElement.setAttribute("data-subtype", "s");
                const types = linkElement.getAttribute("data-type").split(" ");
                types.push("block-ref");
                types.splice(types.indexOf("a"), 1);
                linkElement.setAttribute("data-type", types.join(" "));
                linkElement.setAttribute("data-id", linkAddress?.replace("siyuan://blocks/", ""));
                linkElement.removeAttribute("data-href");
                linkElement.removeAttribute("data-title");
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                protyle.toolbar.range.selectNode(linkElement);
                protyle.toolbar.range.collapse(false);
                focusByRange(protyle.toolbar.range);
            }
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        label: `${window.siyuan.languages.turnInto} <b>${window.siyuan.languages.text}</b>`,
        icon: "iconRefresh",
        click() {
            removeLink(linkElement, protyle.toolbar.range);
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
        }
    }).element);
    if (linkAddress?.startsWith("assets/")) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.rename,
            click() {
                renameAsset(linkAddress);
            }
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.remove,
        click() {
            const oldHTML = nodeElement.outerHTML;
            linkElement.insertAdjacentHTML("afterend", "<wbr>");
            linkElement.remove();
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            focusByWbr(nodeElement, protyle.toolbar.range);
        }
    }).element);

    if (protyle?.app?.plugins) {
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
    const rect = linkElement.getBoundingClientRect();
    window.siyuan.menus.menu.popup({
        x: rect.left,
        y: rect.top + 26,
        h: 26
    });
    const textElements = window.siyuan.menus.menu.element.querySelectorAll("textarea");
    if (focusText || protyle.lute.IsValidLinkDest(linkAddress)) {
        textElements[1].select();
    } else {
        textElements[0].select();
    }
    window.siyuan.menus.menu.removeCB = () => {
        if (textElements[2].value) {
            linkElement.setAttribute("data-title", Lute.EscapeHTMLStr(textElements[2].value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "")));
        } else {
            linkElement.removeAttribute("data-title");
        }
        linkElement.setAttribute("data-href", Lute.EscapeHTMLStr(textElements[0].value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "")));
        const currentRange = getSelection().rangeCount === 0 ? undefined : getSelection().getRangeAt(0);
        if (linkElement.textContent === "" || linkElement.textContent === Constants.ZWSP) {
            removeLink(linkElement, (currentRange && !protyle.element.contains(currentRange.startContainer)) ? protyle.toolbar.range : undefined);
        } else if (currentRange && !protyle.element.contains(currentRange.startContainer)) {
            protyle.toolbar.range.selectNodeContents(linkElement);
            protyle.toolbar.range.collapse(false);
            focusByRange(protyle.toolbar.range);
        }
        nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(protyle, id, nodeElement.outerHTML, html);
    };
};

export const tagMenu = (protyle: IProtyle, tagElement: HTMLElement) => {
    window.siyuan.menus.menu.remove();
    const nodeElement = hasClosestBlock(tagElement);
    if (!nodeElement) {
        return;
    }
    hideElements(["util", "toolbar", "hint"], protyle);
    const id = nodeElement.getAttribute("data-node-id");
    let html = nodeElement.outerHTML;
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<input class="b3-text-field fn__size200" style="margin: 4px 0" placeholder="${window.siyuan.languages.tag}">`,
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
    /// #if !MOBILE
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.search,
        accelerator: "Click",
        icon: "iconSearch",
        click() {
            openGlobalSearch(protyle.app, `#${tagElement.textContent}#`, false);
        }
    }).element);
    /// #endif
    window.siyuan.menus.menu.append(new MenuItem({
        label: `${window.siyuan.languages.turnInto} <b>${window.siyuan.languages.text}</b>`,
        icon: "iconRefresh",
        click() {
            protyle.toolbar.range.setStart(tagElement.firstChild, 0);
            protyle.toolbar.range.setEnd(tagElement.lastChild, tagElement.lastChild.textContent.length);
            protyle.toolbar.setInlineMark(protyle, "tag", "range");
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.rename,
        click() {
            renameTag(tagElement.textContent.replace(Constants.ZWSP, ""));
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
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

    const rect = tagElement.getBoundingClientRect();
    window.siyuan.menus.menu.popup({
        x: rect.left,
        y: rect.top + 26,
        h: 26
    });
    window.siyuan.menus.menu.element.querySelector("input").select();
};

const genImageWidthMenu = (label: string, assetElement: HTMLElement, imgElement: HTMLElement, protyle: IProtyle, id: string, nodeElement: HTMLElement, html: string) => {
    return {
        label,
        click() {
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            if (label === window.siyuan.languages.default) {
                if (assetElement.style.display === "block") {
                    assetElement.style.width = "";
                    assetElement.style.maxWidth = "";
                } else {
                    assetElement.removeAttribute("style");
                }
                imgElement.removeAttribute("style");
            } else {
                assetElement.style.width = label;
                assetElement.style.maxWidth = "";
                imgElement.style.width = "10000px";
            }
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
        iconHTML: "",
        label: `<textarea rows="1" class="b3-text-field fn__size200" placeholder="${window.siyuan.languages.link}" style="margin: 4px 0">${iframeElement.getAttribute("src") || ""}</textarea>`,
        bind(element) {
            element.querySelector("textarea").addEventListener("change", (event) => {
                const value = (event.target as HTMLTextAreaElement).value.replace(/\n|\r\n|\r|\u2028|\u2029/g, "");
                const biliMatch = value.match(/(?:www\.|\/\/)bilibili\.com\/video\/(\w+)/);
                if (value.indexOf("bilibili.com") > -1 && (value.indexOf("bvid=") > -1 || (biliMatch && biliMatch[1]))) {
                    const params: IObject = {
                        bvid: getSearch("bvid", value) || (biliMatch && biliMatch[1]),
                        page: "1",
                        high_quality: "1",
                        as_wide: "1",
                        allowfullscreen: "true"
                    };
                    if (value.indexOf("player.bilibili.com/player.html") > -1) {
                        // https://github.com/siyuan-note/siyuan/issues/4434
                        new URL(value.startsWith("http") ? value : "https:" + value).search.split("&").forEach((item, index) => {
                            if (index === 0) {
                                item = item.substr(1);
                            }
                            const keyValue = item.split("=");
                            params[keyValue[0]] = keyValue[1];
                        });
                    }
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
        iconHTML: "",
        label: `<textarea rows="1" style="margin: 4px 0" class="b3-text-field" placeholder="${window.siyuan.languages.link}">${videoElement.getAttribute("src")}</textarea>`,
        bind(element) {
            element.querySelector("textarea").addEventListener("change", (event) => {
                videoElement.setAttribute("src", (event.target as HTMLTextAreaElement).value.replace(/\n|\r\n|\r|\u2028|\u2029/g, ""));
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
                event.stopPropagation();
            });
        }
    }];
    const src = videoElement.getAttribute("src");
    if (src.startsWith("assets/")) {
        subMenus.push({
            type: "separator"
        });
        subMenus.push({
            label: window.siyuan.languages.rename,
            click() {
                renameAsset(src);
            }
        });
    }
    /// #if !BROWSER
    subMenus.push(exportAsset(src));
    /// #endif
    const VideoSrc = videoElement.getAttribute("src");
    if (VideoSrc) {
        return subMenus.concat(openMenu(protyle.app, VideoSrc, true, false) as IMenu[]);
    }
    return subMenus;
};

export const tableMenu = (protyle: IProtyle, nodeElement: Element, cellElement: HTMLTableCellElement, range: Range) => {
    const menus: IMenu[] = [];
    const colIndex = getColIndex(cellElement);
    if (cellElement.rowSpan > 1 || cellElement.colSpan > 1) {
        menus.push({
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
                        while (!prueTrElement.isSameNode(theadElement.lastElementChild)) {
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
    if (thMatchElement.style.width || thMatchElement.style.minWidth) {
        menus.push({
            label: window.siyuan.languages.useDefaultWidth,
            click: () => {
                const html = nodeElement.outerHTML;
                thMatchElement.style.width = "";
                thMatchElement.style.minWidth = "";
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
            }
        });
    }
    const isPinHead = nodeElement.getAttribute("custom-pinthead");
    menus.push({
        icon: "iconPin",
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
    menus.push({type: "separator"});
    menus.push({
        icon: "iconAlignLeft",
        accelerator: window.siyuan.config.keymap.editor.general.alignLeft.custom,
        label: window.siyuan.languages.alignLeft,
        click: () => {
            setTableAlign(protyle, [cellElement], nodeElement, "left", range);
        }
    });
    menus.push({
        icon: "iconAlignCenter",
        label: window.siyuan.languages.alignCenter,
        accelerator: window.siyuan.config.keymap.editor.general.alignCenter.custom,
        click: () => {
            setTableAlign(protyle, [cellElement], nodeElement, "center", range);
        }
    });
    menus.push({
        icon: "iconAlignRight",
        label: window.siyuan.languages.alignRight,
        accelerator: window.siyuan.config.keymap.editor.general.alignRight.custom,
        click: () => {
            setTableAlign(protyle, [cellElement], nodeElement, "right", range);
        }
    });
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
    menus.push({
        icon: "iconBefore",
        label: window.siyuan.languages.insertRowAbove,
        accelerator: window.siyuan.config.keymap.editor.table.insertRowAbove.custom,
        click: () => {
            insertRowAbove(protyle, range, cellElement, nodeElement);
        }
    });
    if (!nextHasNone || (nextHasNone && !nextHasRowSpan && nextHasColSpan)) {
        menus.push({
            icon: "iconAfter",
            label: window.siyuan.languages.insertRowBelow,
            accelerator: window.siyuan.config.keymap.editor.table.insertRowBelow.custom,
            click: () => {
                insertRow(protyle, range, cellElement, nodeElement);
            }
        });
    }
    if (colIsPure || previousColIsPure) {
        menus.push({
            icon: "iconInsertLeft",
            label: window.siyuan.languages.insertColumnLeft,
            accelerator: window.siyuan.config.keymap.editor.table.insertColumnLeft.custom,
            click: () => {
                insertColumn(protyle, nodeElement, cellElement, "beforebegin", range);
            }
        });
    }
    if (colIsPure || nextColIsPure) {
        menus.push({
            icon: "iconInsertRight",
            label: window.siyuan.languages.insertColumnRight,
            accelerator: window.siyuan.config.keymap.editor.table.insertColumnRight.custom,
            click: () => {
                insertColumn(protyle, nodeElement, cellElement, "afterend", range);
            }
        });
    }
    if (((!hasNone || (hasNone && !hasRowSpan && hasColSpan)) &&
            (!previousHasNone || (previousHasNone && !previousHasRowSpan && previousHasColSpan))) ||
        ((!hasNone || (hasNone && !hasRowSpan && hasColSpan)) &&
            (!nextHasNone || (nextHasNone && !nextHasRowSpan && nextHasColSpan))) ||
        (colIsPure && previousColIsPure) ||
        (colIsPure && nextColIsPure)
    ) {
        menus.push({
            type: "separator"
        });
    }

    if ((!hasNone || (hasNone && !hasRowSpan && hasColSpan)) &&
        (!previousHasNone || (previousHasNone && !previousHasRowSpan && previousHasColSpan))) {
        menus.push({
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
        menus.push({
            icon: "iconDown",
            label: window.siyuan.languages.moveToDown,
            accelerator: window.siyuan.config.keymap.editor.table.moveToDown.custom,
            click: () => {
                moveRowToDown(protyle, range, cellElement, nodeElement);
            }
        });
    }
    if (colIsPure && previousColIsPure) {
        menus.push({
            icon: "iconLeft",
            label: window.siyuan.languages.moveToLeft,
            accelerator: window.siyuan.config.keymap.editor.table.moveToLeft.custom,
            click: () => {
                moveColumnToLeft(protyle, range, cellElement, nodeElement);
            }
        });
    }
    if (colIsPure && nextColIsPure) {
        menus.push({
            icon: "iconRight",
            label: window.siyuan.languages.moveToRight,
            accelerator: window.siyuan.config.keymap.editor.table.moveToRight.custom,
            click: () => {
                moveColumnToRight(protyle, range, cellElement, nodeElement);
            }
        });
    }
    if ((cellElement.parentElement.parentElement.tagName !== "THEAD" &&
        ((!hasNone && !hasRowSpan) || (hasNone && !hasRowSpan && hasColSpan))) || colIsPure) {
        menus.push({
            type: "separator"
        });
    }
    if (cellElement.parentElement.parentElement.tagName !== "THEAD" &&
        ((!hasNone && !hasRowSpan) || (hasNone && !hasRowSpan && hasColSpan))) {
        menus.push({
            icon: "iconDeleteRow",
            label: window.siyuan.languages["delete-row"],
            accelerator: window.siyuan.config.keymap.editor.table["delete-row"].custom,
            click: () => {
                deleteRow(protyle, range, cellElement, nodeElement);
            }
        });
    }
    if (colIsPure) {
        menus.push({
            icon: "iconDeleteColumn",
            label: window.siyuan.languages["delete-column"],
            accelerator: window.siyuan.config.keymap.editor.table["delete-column"].custom,
            click: () => {
                deleteColumn(protyle, range, nodeElement, cellElement);
            }
        });
    }
    return menus;
};

export const setFold = (protyle: IProtyle, nodeElement: Element, isOpen?: boolean, isRemove?: boolean) => {
    if (nodeElement.getAttribute("data-type") === "NodeListItem" && nodeElement.childElementCount < 4) {
        // 没有子列表或多个块的列表项不进行折叠
        return -1;
    }
    if (nodeElement.getAttribute("data-type") === "NodeThematicBreak") {
        return -1;
    }
    // 0 正常；1 折叠
    let fold = "0";
    if (nodeElement.getAttribute("fold") === "1") {
        if (typeof isOpen === "boolean" && !isOpen) {
            return -1;
        }
        nodeElement.removeAttribute("fold");
        // https://github.com/siyuan-note/siyuan/issues/4411
        nodeElement.querySelectorAll(".protyle-linenumber").forEach((item: HTMLElement) => {
            lineNumberRender(item);
        });
    } else {
        if (typeof isOpen === "boolean" && isOpen) {
            return -1;
        }
        fold = "1";
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
        nodeElement.querySelectorAll(".img--select").forEach((item) => {
            item.classList.remove("img--select");
        });
    }
    const id = nodeElement.getAttribute("data-node-id");
    if (nodeElement.getAttribute("data-type") === "NodeHeading") {
        if (fold === "0") {
            nodeElement.insertAdjacentHTML("beforeend", '<div spin="1" style="text-align: center"><img width="24px" src="/stage/loading-pure.svg"></div>');
            transaction(protyle, [{
                action: "unfoldHeading",
                id,
                data: isRemove ? "remove" : undefined,
            }], [{
                action: "foldHeading",
                id
            }]);
        } else {
            transaction(protyle, [{
                action: "foldHeading",
                id
            }], [{
                action: "unfoldHeading",
                id
            }]);
            removeFoldHeading(nodeElement);
        }
    } else {
        transaction(protyle, [{
            action: "setAttrs",
            id,
            data: JSON.stringify({fold})
        }], [{
            action: "setAttrs",
            id,
            data: JSON.stringify({fold: fold === "0" ? "1" : "0"})
        }]);
    }
    // 折叠后，防止滚动条滚动后调用 get 请求 https://github.com/siyuan-note/siyuan/issues/2248
    preventScroll(protyle);
    return fold;
};
