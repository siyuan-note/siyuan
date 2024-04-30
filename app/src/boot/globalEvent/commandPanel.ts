import {Dialog} from "../../dialog";
import {App} from "../../index";
import {upDownHint} from "../../util/upDownHint";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {isMobile} from "../../util/functions";
import {Constants} from "../../constants";
import {getActiveTab, getDockByType} from "../../layout/tabUtil";
import {Editor} from "../../editor";
import {Search} from "../../search";
/// #if !MOBILE
import {Custom} from "../../layout/dock/Custom";
import {getAllModels} from "../../layout/getAll";
import {openSearchAV} from "../../protyle/render/av/relation";
import {transaction} from "../../protyle/wysiwyg/transaction";
import {focusByRange} from "../../protyle/util/selection";
import {hasClosestBlock, hasClosestByClassName} from "../../protyle/util/hasClosest";
import * as dayjs from "dayjs";
import {Files} from "../../layout/dock/Files";
/// #endif

export const commandPanel = (app: App) => {
    const range = getSelection().getRangeAt(0);
    const dialog = new Dialog({
        width: isMobile() ? "92vw" : "80vw",
        height: isMobile() ? "80vh" : "70vh",
        title: window.siyuan.languages.commandPanel,
        content: `<div class="fn__flex-column">
    <div class="b3-form__icon search__header" style="border-top: 0;border-bottom: 1px solid var(--b3-theme-surface-lighter);">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <input class="b3-text-field b3-text-field--text" style="padding-left: 32px !important;">
    </div>
    <ul class="b3-list b3-list--background search__list" id="commands"></ul>
    <div class="search__tip">
        <kbd>↑/↓</kbd> ${window.siyuan.languages.searchTip1}
        <kbd>Enter/Click</kbd> ${window.siyuan.languages.confirm}
        <kbd>Esc</kbd> ${window.siyuan.languages.close}
    </div>
</div>`
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_COMMANDPANEL);
    const listElement = dialog.element.querySelector("#commands");
    /// #if !MOBILE
//     let html = ""
//     Object.keys(window.siyuan.config.keymap.general).forEach((key) => {
//         html += `<li class="b3-list-item" data-command="${key}">
//     <span class="b3-list-item__text">${window.siyuan.languages[key]}</span>
//     <span class="b3-list-item__meta${isMobile() ? " fn__none" : ""}">${updateHotkeyTip(window.siyuan.config.keymap.general[key].custom)}</span>
// </li>`;
//     });
//     listElement.insertAdjacentHTML("beforeend", html);
    /// #endif
    app.plugins.forEach(plugin => {
        plugin.commands.forEach(command => {
            const liElement = document.createElement("li");
            liElement.classList.add("b3-list-item");
            liElement.innerHTML = `<span class="b3-list-item__text">${plugin.displayName}: ${command.langText || plugin.i18n[command.langKey]}</span>
<span class="b3-list-item__meta${isMobile() ? " fn__none" : ""}">${updateHotkeyTip(command.customHotkey)}</span>`;
            liElement.addEventListener("click", () => {
                if (command.callback) {
                    command.callback();
                } else if (command.globalCallback) {
                    command.globalCallback();
                }
                dialog.destroy();
            });
            listElement.insertAdjacentElement("beforeend", liElement);
        });
    });

    if (listElement.childElementCount === 0) {
        const liElement = document.createElement("li");
        liElement.classList.add("b3-list-item", "b3-list-item--focus");
        liElement.innerHTML = `<span class="b3-list-item__text" style="-webkit-line-clamp: inherit;">${window.siyuan.languages._kernel[122]}</span>`;
        liElement.addEventListener("click", () => {
            dialog.destroy();
        });
        listElement.insertAdjacentElement("beforeend", liElement);
    } else {
        listElement.firstElementChild.classList.add("b3-list-item--focus");
    }

    const inputElement = dialog.element.querySelector(".b3-text-field") as HTMLInputElement;
    inputElement.focus();
    /// #if !MOBILE
    listElement.addEventListener("click", (event: KeyboardEvent) => {
        const liElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
        if (liElement) {
            const command = liElement.getAttribute("data-command");
            if (command) {
                execByCommand({command, app, previousRange: range});
                dialog.destroy();
                event.preventDefault();
                event.stopPropagation();
            }
        }
    });
    /// #endif
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.isComposing) {
            return;
        }
        upDownHint(listElement, event);
        if (event.key === "Enter") {
            const currentElement = listElement.querySelector(".b3-list-item--focus");
            if (currentElement) {
                const command = currentElement.getAttribute("data-command");
                if (command) {
                    execByCommand({command, app, previousRange: range});
                } else {
                    currentElement.dispatchEvent(new CustomEvent("click"));
                }
            }
            dialog.destroy();
        } else if (event.key === "Escape") {
            dialog.destroy();
        }
    });
    inputElement.addEventListener("compositionend", () => {
        filterList(inputElement, listElement);
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        event.stopPropagation();
        filterList(inputElement, listElement);
    });
};

const filterList = (inputElement: HTMLInputElement, listElement: Element) => {
    const inputValue = inputElement.value.toLowerCase();
    listElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
    let hasFocus = false;
    Array.from(listElement.children).forEach((element: HTMLElement) => {
        const elementValue = element.querySelector(".b3-list-item__text").textContent.toLowerCase();
        if (inputValue.indexOf(elementValue) > -1 || elementValue.indexOf(inputValue) > -1) {
            if (!hasFocus) {
                element.classList.add("b3-list-item--focus");
            }
            hasFocus = true;
            element.classList.remove("fn__none");
        } else {
            element.classList.add("fn__none");
        }
    });
};

export const execByCommand = (options: {
    command: string,
    app: App,
    previousRange?: Range,
    protyle?: IProtyle,
    fileLiElements?: Element[]
}) => {
    /// #if !MOBILE
    const isFileFocus = document.querySelector(".layout__tab--active")?.classList.contains("sy__file");

    let protyle = options.protyle;
    const range: Range = options.previousRange || getSelection().getRangeAt(0);
    let fileLiElements = options.fileLiElements;
    if (!isFileFocus && !protyle) {
        if (range) {
            window.siyuan.dialogs.find(item => {
                if (item.editors) {
                    Object.keys(item.editors).find(key => {
                        if (item.editors[key].protyle.element.contains(range.startContainer)) {
                            protyle = item.editors[key].protyle;
                            return true;
                        }
                    });
                    if (protyle) {
                        return true;
                    }
                }
            });
        }
        const activeTab = getActiveTab();
        if (!protyle && activeTab) {
            if (activeTab.model instanceof Editor) {
                protyle = activeTab.model.editor.protyle;
            } else if (activeTab.model instanceof Search) {
                if (activeTab.model.element.querySelector("#searchUnRefPanel").classList.contains("fn__none")) {
                    protyle = activeTab.model.editors.edit.protyle;
                } else {
                    protyle = activeTab.model.editors.unRefEdit.protyle;
                }
            } else if (activeTab.model instanceof Custom && activeTab.model.editors?.length > 0) {
                if (range) {
                    activeTab.model.editors.find(item => {
                        if (item.protyle.element.contains(range.startContainer)) {
                            protyle = item.protyle;
                            return true;
                        }
                    });
                }
            }
            if (!protyle) {
                return;
            }
        } else if (!protyle) {
            if (!protyle && range) {
                window.siyuan.blockPanels.find(item => {
                    item.editors.find(editorItem => {
                        if (editorItem.protyle.element.contains(range.startContainer)) {
                            protyle = editorItem.protyle;
                            return true;
                        }
                    });
                    if (protyle) {
                        return true;
                    }
                });
            }
            const models = getAllModels();
            if (!protyle) {
                models.backlink.find(item => {
                    if (item.element.classList.contains("layout__tab--active")) {
                        if (range) {
                            item.editors.find(editor => {
                                if (editor.protyle.element.contains(range.startContainer)) {
                                    protyle = editor.protyle;
                                    return true;
                                }
                            });
                        }
                        if (!protyle && item.editors.length > 0) {
                            protyle = item.editors[0].protyle;
                        }
                        return true;
                    }
                });
            }
            if (!protyle) {
                models.editor.find(item => {
                    if (item.parent.headElement.classList.contains("item--focus")) {
                        protyle = item.editor.protyle;
                        return true;
                    }
                });
            }
            if (!protyle) {
                return false;
            }
        }
    }
    if (isFileFocus && !fileLiElements) {
        const dockFile = getDockByType("file");
        if (!dockFile) {
            return false;
        }
        const files = dockFile.data.file as Files;
        fileLiElements = Array.from(files.element.querySelectorAll(".b3-list-item--focus"));
    }

    switch (options.command) {
        case "addToDatabase":
            if (!isFileFocus) {
                if (protyle.title?.editElement.contains(range.startContainer)) {
                    openSearchAV("", protyle.breadcrumb.element, (listItemElement) => {
                        const avID = listItemElement.dataset.avId;
                        transaction(protyle, [{
                            action: "insertAttrViewBlock",
                            avID,
                            ignoreFillFilter: true,
                            srcs: [{
                                id: protyle.block.rootID,
                                isDetached: false
                            }],
                            blockID: listItemElement.dataset.blockId
                        }, {
                            action: "doUpdateUpdated",
                            id: listItemElement.dataset.blockId,
                            data: dayjs().format("YYYYMMDDHHmmss"),
                        }], [{
                            action: "removeAttrViewBlock",
                            srcIDs: [protyle.block.rootID],
                            avID,
                        }]);
                        focusByRange(range);
                    });
                } else {
                    const selectElement: Element[] = [];
                    protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                        selectElement.push(item);
                    });
                    if (selectElement.length === 0) {
                        const nodeElement = hasClosestBlock(range.startContainer);
                        if (nodeElement) {
                            selectElement.push(nodeElement);
                        }
                    }
                    if (selectElement.length === 0) {
                        return;
                    }
                    openSearchAV("", selectElement[0] as HTMLElement, (listItemElement) => {
                        const srcIDs: string[] = [];
                        const srcs: IOperationSrcs[] = [];
                        selectElement.forEach(item => {
                            srcIDs.push(item.getAttribute("data-node-id"));
                            srcs.push({
                                id: item.getAttribute("data-node-id"),
                                isDetached: false
                            });
                        });
                        const avID = listItemElement.dataset.avId;
                        transaction(protyle, [{
                            action: "insertAttrViewBlock",
                            avID,
                            ignoreFillFilter: true,
                            srcs,
                            blockID: listItemElement.dataset.blockId
                        }, {
                            action: "doUpdateUpdated",
                            id: listItemElement.dataset.blockId,
                            data: dayjs().format("YYYYMMDDHHmmss"),
                        }], [{
                            action: "removeAttrViewBlock",
                            srcIDs,
                            avID,
                        }]);
                        focusByRange(range);
                    });
                }
            } else {
                const srcs: IOperationSrcs[] = [];
                fileLiElements.forEach(item => {
                    const id = item.getAttribute("data-node-id");
                    if (id) {
                        srcs.push({
                            id,
                            isDetached: false
                        });
                    }
                });
                if (srcs.length > 0) {
                    openSearchAV("", fileLiElements[0] as HTMLElement, (listItemElement) => {
                        const avID = listItemElement.dataset.avId;
                        transaction(undefined, [{
                            action: "insertAttrViewBlock",
                            avID,
                            ignoreFillFilter: true,
                            srcs,
                            blockID: listItemElement.dataset.blockId
                        }, {
                            action: "doUpdateUpdated",
                            id: listItemElement.dataset.blockId,
                            data: dayjs().format("YYYYMMDDHHmmss"),
                        }]);
                    });
                }
            }
            break;
    }
    /// #endif
};
