import {hasClosestBlock, hasClosestByMatchTag} from "../protyle/util/hasClosest";
import {MenuItem} from "./Menu";
import {focusBlock, focusByRange, focusByWbr, getEditorRange, selectAll} from "../protyle/util/selection";
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
import {mathRender} from "../protyle/markdown/mathRender";
import {transaction, updateTransaction} from "../protyle/wysiwyg/transaction";
import {openMenu} from "./commonMenuItem";
import {fetchPost} from "../util/fetch";
import {Constants} from "../constants";
import {writeText} from "../protyle/util/compatibility";
import {preventScroll} from "../protyle/scroll/preventScroll";
import {getCurrentWindow} from "@electron/remote";
import {clipboard} from "electron";
import {onGet} from "../protyle/util/onGet";
import {getAllModels} from "../layout/getAll";
import {pasteText} from "../protyle/util/paste";
import {openFileById, updateBacklinkGraph} from "../editor/util";
import {isMobile} from "../util/functions";
import {removeFoldHeading} from "../protyle/util/heading";
import {lineNumberRender} from "../protyle/markdown/highlightRender";
import * as dayjs from "dayjs";
import {blockRender} from "../protyle/markdown/blockRender";
import {isLocalPath} from "../util/pathName";

export const refMenu = (protyle: IProtyle, element: HTMLElement) => {
    const nodeElement = hasClosestBlock(element);
    if (!nodeElement) {
        return;
    }
    const refBlockId = element.getAttribute("data-id");
    const id = nodeElement.getAttribute("data-node-id");
    const oldHTML = nodeElement.outerHTML;
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<input style="margin: 4px 0" class="b3-text-field" placeholder="${window.siyuan.languages.anchor}">`,
        bind(menuItemElement) {
            const inputElement = menuItemElement.querySelector("input");
            inputElement.value = element.getAttribute("data-subtype") === "d" ? "" : element.textContent;
            inputElement.addEventListener("blur", (event) => {
                if (nodeElement.outerHTML !== oldHTML) {
                    nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                    element.setAttribute("data-subtype", inputElement.value ? "s" : "d");
                    updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
                }
                protyle.toolbar.range.selectNodeContents(element);
                protyle.toolbar.range.collapse(false);
                focusByRange(protyle.toolbar.range);
                event.stopPropagation();
            });
            inputElement.addEventListener("input", () => {
                if (inputElement.value) {
                    element.textContent = Lute.EscapeHTMLStr(inputElement.value);
                } else {
                    fetchPost("/api/block/getRefText", {id: refBlockId}, (response) => {
                        element.textContent = Lute.EscapeHTMLStr(response.data);
                    });
                }
            });
            inputElement.addEventListener("keydown", (event) => {
                if (event.key === "Enter" && !event.isComposing) {
                    window.siyuan.menus.menu.remove();
                }
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        type: "separator"
    }).element);
    if (!isMobile()) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.openBy,
            accelerator: "⌘Click",
            click() {
                fetchPost("/api/block/checkBlockFold", {id: refBlockId}, (foldResponse) => {
                    openFileById({
                        id: refBlockId,
                        hasContext: !foldResponse.data,
                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_HL],
                        keepCursor: true,
                        zoomIn: foldResponse.data
                    });
                });
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.insertRight,
            icon: "iconRight",
            accelerator: "⌥Click",
            click() {
                fetchPost("/api/block/checkBlockFold", {id: refBlockId}, (foldResponse) => {
                    openFileById({
                        id: refBlockId,
                        position: "right",
                        hasContext: !foldResponse.data,
                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS],
                        zoomIn: foldResponse.data
                    });
                });
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.insertBottom,
            icon: "iconDown",
            accelerator: "⇧Click",
            click() {
                fetchPost("/api/block/checkBlockFold", {id: refBlockId}, (foldResponse) => {
                    openFileById({
                        id: refBlockId,
                        position: "bottom",
                        hasContext: !foldResponse.data,
                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS],
                        zoomIn: foldResponse.data
                    });
                });
            }
        }).element);
    }
    let submenu: IMenu[] = [];
    if (element.getAttribute("data-subtype") === "s") {
        submenu.push({
            label: window.siyuan.languages.turnToDynamic,
            click() {
                element.setAttribute("data-subtype", "d");
                fetchPost("/api/block/getRefText", {id: refBlockId}, (response) => {
                    element.innerHTML = Lute.EscapeHTMLStr(response.data);
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
            element.outerHTML = `${element.textContent}<wbr>`;
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
            element.insertAdjacentText("beforebegin", element.textContent + " ");
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
            element.outerHTML = `<span data-type="a" data-href="siyuan://blocks/${element.getAttribute("data-id")}">${element.textContent}</span><wbr>`;
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
    window.siyuan.menus.menu.element.classList.remove("fn__none");
    window.siyuan.menus.menu.element.querySelector("input").select();
};

export const contentMenu = (protyle: IProtyle, nodeElement: Element) => {
    const range = getEditorRange(nodeElement);
    window.siyuan.menus.menu.remove();
    if (range.toString() !== "") {
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
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.paste,
        accelerator: "⌘V",
        async click() {
            if (document.queryCommandSupported("paste")) {
                document.execCommand("paste");
            } else {
                try {
                    const clipText = await navigator.clipboard.readText();
                    pasteText(protyle, clipText, nodeElement);
                } catch (e) {
                    console.log(e);
                }
            }
        }
    }).element);
    /// #if !BROWSER
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.pasteAsPlainText,
        accelerator: window.siyuan.config.keymap.editor.general.pasteAsPlainText.custom,
        click() {
            focusByRange(getEditorRange(nodeElement));
            writeText(clipboard.readText());
            setTimeout(() => {
                getCurrentWindow().webContents.pasteAndMatchStyle();
            }, 100);
        }
    }).element);
    /// #endif
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
};

export const zoomOut = (protyle: IProtyle, id: string, focusId?: string, isPushBack = true) => {
    const breadcrumbHLElement = protyle.breadcrumb.element.querySelector(".protyle-breadcrumb__item--active");
    if (breadcrumbHLElement && breadcrumbHLElement.getAttribute("data-node-id") === id) {
        if (id === protyle.block.rootID) {
            return;
        }
        const focusElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${focusId || id}"]`);
        if (focusElement) {
            focusBlock(focusElement);
            focusElement.scrollIntoView();
            return;
        }
    }
    if (window.siyuan.mobileEditor) {
        window.localStorage.setItem(Constants.LOCAL_DOCINFO, JSON.stringify({
            id,
            hasContext: id === protyle.block.rootID,
            action: id === protyle.block.rootID ? [Constants.CB_GET_HL] : [Constants.CB_GET_ALL]
        }));
        window.siyuan.backStack.push({
            id: protyle.block.id,
            scrollTop: protyle.contentElement.scrollTop,
            callback: id === protyle.block.rootID ? [Constants.CB_GET_HL] : [Constants.CB_GET_ALL],
            hasContext: false
        });
    }
    fetchPost("/api/filetree/getDoc", {
        id,
        size: id === protyle.block.rootID ? Constants.SIZE_GET : Constants.SIZE_GET_MAX,
    }, getResponse => {
        if (isPushBack) {
            onGet(getResponse, protyle, id === protyle.block.rootID ? [Constants.CB_GET_FOCUS] : [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS]);
        } else {
            onGet(getResponse, protyle, id === protyle.block.rootID ? [Constants.CB_GET_FOCUS, Constants.CB_GET_UNUNDO] : [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS, Constants.CB_GET_UNUNDO]);
        }
        // https://github.com/siyuan-note/siyuan/issues/4874
        if (focusId) {
            const focusElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${focusId}"]`);
            if (focusElement) {
                focusBlock(focusElement);
                focusElement.scrollIntoView();
            } else if (id === protyle.block.rootID) { // 聚焦返回后，该块是动态加载的，但是没加载出来
                fetchPost("/api/filetree/getDoc", {
                    id: focusId,
                    mode: 3,
                    size: Constants.SIZE_GET,
                }, getFocusResponse => {
                    onGet(getFocusResponse, protyle, isPushBack ? [Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS, Constants.CB_GET_UNUNDO]);
                });
                return;
            }
        }
        if (protyle.model) {
            updateBacklinkGraph(getAllModels(), protyle);
        }
    });
};

export const imgMenu = (protyle: IProtyle, range: Range, assetElement: HTMLElement, position: { clientX: number, clientY: number }) => {
    window.siyuan.menus.menu.remove();
    const nodeElement = hasClosestBlock(assetElement);
    if (!nodeElement) {
        return;
    }
    const id = nodeElement.getAttribute("data-node-id");
    const imgElement = assetElement.querySelector("img");
    const titleElement = assetElement.querySelector(".protyle-action__title") as HTMLElement;

    let html = nodeElement.outerHTML;
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<div class="fn__hr--small"></div><input class="b3-text-field fn__size200" value="${imgElement.getAttribute("src")}" placeholder="${window.siyuan.languages.imageURL}"><div class="fn__hr--small"></div>`,
        bind(element) {
            element.querySelector("input").addEventListener("change", (event) => {
                const value = (event.target as HTMLInputElement).value;
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
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<div class="fn__hr--small"></div><input class="b3-text-field fn__size200" placeholder="${window.siyuan.languages.title}"><div class="fn__hr--small"></div>`,
        bind(element) {
            const inputElement = element.querySelector("input");
            inputElement.value = titleElement.textContent;
            inputElement.addEventListener("input", (event) => {
                const value = (event.target as HTMLInputElement).value;
                imgElement.setAttribute("title", value);
                titleElement.textContent = value;
                mathRender(titleElement);
                assetElement.style.maxWidth = (imgElement.clientWidth + 10) + "px";
            });
            inputElement.addEventListener("change", () => {
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<div class="fn__hr--small"></div><input class="b3-text-field fn__size200" placeholder="${window.siyuan.languages.tooltipText}"><div class="fn__hr--small"></div>`,
        bind(element) {
            const inputElement = element.querySelector("input");
            inputElement.value = imgElement.getAttribute("alt") || "";
            inputElement.addEventListener("change", (event) => {
                imgElement.setAttribute("alt", (event.target as HTMLInputElement).value);
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        click() {
            writeText(protyle.lute.BlockDOM2Md(assetElement.outerHTML));
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.copy + " PNG",
        icon: "iconImage",
        click() {
            const canvas = document.createElement("canvas");
            const tempElement = document.createElement("img");
            tempElement.onload = (e: Event & { target: HTMLImageElement }) => {
                canvas.width = e.target.width;
                canvas.height = e.target.height;
                canvas.getContext("2d").drawImage(e.target, 0, 0, e.target.width, e.target.height);
                canvas.toBlob((blob) => {
                    navigator.clipboard.write([
                        new ClipboardItem({
                            // @ts-ignore
                            ["image/png"]: blob
                        })
                    ]);
                }, "image/png", 1);
            };
            tempElement.src = imgElement.getAttribute("src");
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        click: function () {
            (assetElement as HTMLElement).outerHTML = "<wbr>";
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
            html = nodeElement.outerHTML;
            focusByWbr(protyle.wysiwyg.element, range);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconAlignCenter",
        label: window.siyuan.languages.alignCenter,
        accelerator: window.siyuan.config.keymap.editor.general.alignCenter.custom,
        click() {
            assetElement.style.display = "block";
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
            html = nodeElement.outerHTML;
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconAlignLeft",
        label: window.siyuan.languages.alignLeft,
        accelerator: window.siyuan.config.keymap.editor.general.alignLeft.custom,
        click() {
            assetElement.style.display = "";
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
            html = nodeElement.outerHTML;
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
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    openMenu(imgElement.getAttribute("src"));
    window.siyuan.menus.menu.popup({x: position.clientX, y: position.clientY});
    window.siyuan.menus.menu.element.querySelector("input").focus();
};

export const linkMenu = (protyle: IProtyle, linkElement: HTMLElement, focusText = false) => {
    window.siyuan.menus.menu.remove();
    protyle.toolbar.isNewEmptyInline = false;
    const nodeElement = hasClosestBlock(linkElement);
    if (!nodeElement) {
        return;
    }
    const id = nodeElement.getAttribute("data-node-id");
    let html = nodeElement.outerHTML;
    const linkAddress = linkElement.getAttribute("data-href");
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<div class="fn__hr--small"></div><input class="b3-text-field fn__size200" placeholder="${window.siyuan.languages.link}"><div class="fn__hr--small"></div>`,
        bind(element) {
            const inputElement = element.querySelector("input");
            inputElement.value = linkAddress || "";
            inputElement.addEventListener("change", () => {
                linkElement.setAttribute("data-href", inputElement.value);
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
            });
            inputElement.addEventListener("keydown", (event) => {
                if ((event.key === "Enter" || event.key === "Escape") && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    protyle.toolbar.range.selectNodeContents(linkElement);
                    protyle.toolbar.range.collapse(false);
                    focusByRange(protyle.toolbar.range);
                    window.siyuan.menus.menu.remove();
                }
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<div class="fn__hr--small"></div><input class="b3-text-field fn__size200" placeholder="${window.siyuan.languages.anchor}"><div class="fn__hr--small"></div>`,
        bind(element) {
            const inputElement = element.querySelector("input");
            inputElement.value = linkElement.textContent.replace(Constants.ZWSP, "");
            inputElement.addEventListener("change", () => {
                if (!inputElement.value) {
                    protyle.toolbar.setInlineMark(protyle, "link", "remove");
                    window.siyuan.menus.menu.remove();
                }
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
            });
            inputElement.addEventListener("compositionend", () => {
                linkElement.innerHTML = Lute.EscapeHTMLStr(inputElement.value) || "";
            });
            inputElement.addEventListener("input", (event: KeyboardEvent) => {
                if (!event.isComposing) {
                    linkElement.innerHTML = Lute.EscapeHTMLStr(inputElement.value) || "";
                }
            });
            inputElement.addEventListener("keydown", (event) => {
                if ((event.key === "Enter" || event.key === "Escape") && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    protyle.toolbar.range.selectNodeContents(linkElement);
                    protyle.toolbar.range.collapse(false);
                    focusByRange(protyle.toolbar.range);
                    window.siyuan.menus.menu.remove();
                }
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<div class="fn__hr--small"></div><input class="b3-text-field fn__size200" placeholder="${window.siyuan.languages.title}"><div class="fn__hr--small"></div>`,
        bind(element) {
            const inputElement = element.querySelector("input");
            inputElement.value = Lute.UnEscapeHTMLStr(linkElement.getAttribute("data-title") || "");
            inputElement.addEventListener("change", () => {
                if (inputElement.value) {
                    linkElement.setAttribute("data-title", Lute.EscapeHTMLStr(inputElement.value));
                } else {
                    linkElement.removeAttribute("data-title");
                }
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
            });
            inputElement.addEventListener("keydown", (event) => {
                if ((event.key === "Enter" || event.key === "Escape") && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    protyle.toolbar.range.selectNodeContents(linkElement);
                    protyle.toolbar.range.collapse(false);
                    focusByRange(protyle.toolbar.range);
                    window.siyuan.menus.menu.remove();
                }
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.remove,
        click() {
            protyle.toolbar.setInlineMark(protyle, "link", "remove");
        }
    }).element);
    if (linkAddress?.startsWith("siyuan://blocks/")) {
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconRefresh",
            label: window.siyuan.languages.turnInto + " " + window.siyuan.languages.blockRef,
            click() {
                linkElement.setAttribute("data-subtype", "s");
                linkElement.setAttribute("data-type", "block-ref");
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
    if (isLocalPath(linkAddress)) {
        openMenu(linkAddress);
    }
    window.siyuan.menus.menu.element.classList.remove("fn__none");
    if (focusText || protyle.lute.IsValidLinkDest(linkAddress)) {
        window.siyuan.menus.menu.element.querySelectorAll("input")[1].select();
    } else {
        window.siyuan.menus.menu.element.querySelector("input").select();
    }
};

const genImageWidthMenu = (label: string, assetElement: HTMLElement, imgElement: HTMLElement, protyle: IProtyle, id: string, nodeElement: HTMLElement, html: string) => {
    return {
        label,
        click() {
            assetElement.style.width = label === window.siyuan.languages.default ? "" : label;
            imgElement.style.width = label === window.siyuan.languages.default ? "" : "10000px";
            assetElement.style.maxWidth = label === window.siyuan.languages.default ? (imgElement.clientWidth + 10) + "px" : "";
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
        label: `<div class="fn__hr--small"></div><input style="margin: 4px 0" class="b3-text-field fn__size200" value="${iframeElement.getAttribute("src") || ""}" placeholder="${window.siyuan.languages.link}"><div class="fn__hr--small"></div>`,
        bind(element) {
            element.querySelector("input").addEventListener("change", (event) => {
                const value = (event.target as HTMLInputElement).value;
                const biliMatch = value.match(/(?:www\.|\/\/)bilibili\.com\/video\/(\w+)/);
                if (value.indexOf("bilibili.com") > -1 && (value.indexOf("bvid=") > -1 || (biliMatch && biliMatch[1]))) {
                    const params: IObject = {
                        bvid: value.indexOf("bvid=") > -1 ? value.split("bvid=")[1].split("&")[0] : (biliMatch && biliMatch[1]),
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
    }, {
        type: "separator"
    }];
    return subMenus.concat(openMenu(iframeElement.getAttribute("src") || "", true) as IMenu[]);
};

export const videoMenu = (protyle: IProtyle, nodeElement: Element, type: string) => {
    const id = nodeElement.getAttribute("data-node-id");
    const videoElement = nodeElement.querySelector(type === "NodeVideo" ? "video" : "audio");
    let html = nodeElement.outerHTML;
    const subMenus: IMenu[] = [{
        label: `<input style="margin: 4px 0" class="b3-text-field" value="${videoElement.getAttribute("src")}" placeholder="${window.siyuan.languages.link}">`,
        bind(element) {
            element.querySelector("input").addEventListener("change", (event) => {
                const value = (event.target as HTMLInputElement).value;
                videoElement.setAttribute("src", value);
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                html = nodeElement.outerHTML;
                event.stopPropagation();
            });
        }
    }, {
        type: "separator"
    }];
    return subMenus.concat(openMenu(videoElement.getAttribute("src"), true) as IMenu[]);
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
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
            }
        });
    }
    const thMatchElement = nodeElement.querySelectorAll("col")[colIndex];
    if (thMatchElement.style.width) {
        menus.push({
            label: window.siyuan.languages.useDefaultWidth,
            click: () => {
                const html = nodeElement.outerHTML;
                thMatchElement.style.width = "";
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
            }
        });
    }
    if (cellElement.rowSpan > 1 || cellElement.colSpan > 1 || thMatchElement.style.width) {
        menus.push({
            type: "separator"
        });
    }
    menus.push({
        icon: "iconAlignLeft",
        accelerator: window.siyuan.config.keymap.editor.general.alignLeft.custom,
        label: window.siyuan.languages.alignLeft,
        click: () => {
            setTableAlign(protyle, cellElement, nodeElement, "left", range);
        }
    });
    menus.push({
        icon: "iconAlignCenter",
        label: window.siyuan.languages.alignCenter,
        accelerator: window.siyuan.config.keymap.editor.general.alignCenter.custom,
        click: () => {
            setTableAlign(protyle, cellElement, nodeElement, "center", range);
        }
    });
    menus.push({
        icon: "iconAlignRight",
        label: window.siyuan.languages.alignRight,
        accelerator: window.siyuan.config.keymap.editor.general.alignRight.custom,
        click: () => {
            setTableAlign(protyle, cellElement, nodeElement, "right", range);
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
    if (!hasNone || (hasNone && !hasRowSpan && hasColSpan) || colIsPure) {
        menus.push({
            type: "separator"
        });
    }
    if ((!hasNone && !hasRowSpan) || (hasNone && !hasRowSpan && hasColSpan)) {
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
                getSelection().removeRange(range);
            }
        }
    }
    const id = nodeElement.getAttribute("data-node-id");
    if (nodeElement.getAttribute("data-type") === "NodeHeading") {
        if (fold === "0") {
            nodeElement.insertAdjacentHTML("beforeend", "<div spin=\"1\" style=\"text-align: center\"><img width=\"24px\" src=\"/stage/loading-pure.svg\"></div>");
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
