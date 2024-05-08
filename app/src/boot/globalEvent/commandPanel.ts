import {Dialog} from "../../dialog";
import {App} from "../../index";
import {upDownHint} from "../../util/upDownHint";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {isMobile} from "../../util/functions";
import {Constants} from "../../constants";
import {Editor} from "../../editor";
/// #if MOBILE
import {getCurrentEditor} from "../../mobile/editor";
import {openDock} from "../../mobile/dock/util";
import {popMenu} from "../../mobile/menu";
/// #else
import {closeTabByType, getActiveTab, getDockByType} from "../../layout/tabUtil";
import {Custom} from "../../layout/dock/Custom";
import {getAllModels} from "../../layout/getAll";
import {Files} from "../../layout/dock/Files";
import {Search} from "../../search";
import {openSetting} from "../../config";
import {Tab} from "../../layout/Tab";
/// #endif
import {openHistory} from "../../history/history";
import {addEditorToDatabase, addFilesToDatabase} from "../../protyle/render/av/addToDatabase";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {newDailyNote} from "../../util/mount";

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
    let html = "";
    Object.keys(window.siyuan.config.keymap.general).forEach((key) => {
        let keys;
        /// #if MOBILE
        keys = ["addToDatabase", "fileTree", "outline", "bookmark", "tag", "dailyNote", "inbox", "backlinks", "config",
            "dataHistory"];
        /// #else
        keys = ["addToDatabase", "fileTree", "outline", "bookmark", "tag", "dailyNote", "inbox", "backlinks",
            "graphView", "globalGraph", "closeAll", "closeLeft", "closeOthers", "closeRight", "closeTab",
            "closeUnmodified", "config", "dataHistory"];
        /// #endif
        if (keys.includes(key)) {
            html += `<li class="b3-list-item" data-command="${key}">
    <span class="b3-list-item__text">${window.siyuan.languages[key]}</span>
    <span class="b3-list-item__meta${isMobile() ? " fn__none" : ""}">${updateHotkeyTip(window.siyuan.config.keymap.general[key].custom)}</span>
</li>`;
        }
    });
    listElement.insertAdjacentHTML("beforeend", html);
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
    app?: App,
    previousRange?: Range,
    protyle?: IProtyle,
    fileLiElements?: Element[]
}) => {
    /// #if MOBILE
    switch (options.command) {
        case "fileTree":
            openDock("file");
            return;
        case "outline":
        case "bookmark":
        case "tag":
        case "inbox":
            openDock(options.command);
            return;
        case "backlinks":
            openDock("backlink");
            return;
        case "config":
            popMenu();
            return;
    }
    /// #else
    switch (options.command) {
        case "fileTree":
            getDockByType("file").toggleModel("file");
            return;
        case "outline":
            getDockByType("outline").toggleModel("outline");
            return;
        case "bookmark":
        case "tag":
        case "inbox":
            getDockByType(options.command).toggleModel(options.command);
            return;
        case "backlinks":
            getDockByType("backlink").toggleModel("backlink");
            return;
        case "graphView":
            getDockByType("graph").toggleModel("graph");
            return;
        case "globalGraph":
            getDockByType("globalGraph").toggleModel("globalGraph");
            return;
        case "config":
            openSetting(options.app);
            return;
    }
    if (options.command === "closeUnmodified") {
        const tab = getActiveTab(false);
        if (tab) {
            const unmodifiedTabs: Tab[] = [];
            tab.parent.children.forEach((item: Tab) => {
                const editor = item.model as Editor;
                if (!editor || (editor.editor?.protyle && !editor.editor?.protyle.updated)) {
                    unmodifiedTabs.push(item);
                }
            });
            if (unmodifiedTabs.length > 0) {
                closeTabByType(tab, "other", unmodifiedTabs);
            }
        }
        return;
    }
    if (options.command === "closeTab") {
        const activeTabElement = document.querySelector(".layout__tab--active");
        if (activeTabElement && activeTabElement.getBoundingClientRect().width > 0) {
            let type = "";
            Array.from(activeTabElement.classList).find(item => {
                if (item.startsWith("sy__")) {
                    type = item.replace("sy__", "");
                    return true;
                }
            });
            if (type) {
                getDockByType(type)?.toggleModel(type, false, true);
            }
            return;
        }
        const tab = getActiveTab(false);
        if (tab) {
            tab.parent.removeTab(tab.id);
        }
        return;
    }
    if (options.command === "closeOthers" || options.command === "closeAll") {
        const tab = getActiveTab(false);
        if (tab) {
            closeTabByType(tab, options.command);
        }
        return;
    }
    if (options.command === "closeLeft" || options.command === "closeRight") {
        const tab = getActiveTab(false);
        if (tab) {
            const leftTabs: Tab[] = [];
            const rightTabs: Tab[] = [];
            let midIndex = -1;
            tab.parent.children.forEach((item: Tab, index: number) => {
                if (item.id === tab.id) {
                    midIndex = index;
                }
                if (midIndex === -1) {
                    leftTabs.push(item);
                } else if (index > midIndex) {
                    rightTabs.push(item);
                }
            });
            if (options.command === "closeLeft") {
                if (leftTabs.length > 0) {
                    closeTabByType(tab, "other", leftTabs);
                }
            } else {
                if (rightTabs.length > 0) {
                    closeTabByType(tab, "other", rightTabs);
                }
            }
        }
        return;
    }
    /// #endif
    switch (options.command) {
        case "dailyNote":
            newDailyNote(options.app);
            return;
        case "dataHistory":
            openHistory(options.app);
            return;
    }

    const isFileFocus = document.querySelector(".layout__tab--active")?.classList.contains("sy__file");

    let protyle = options.protyle;
    /// #if MOBILE
    if (!protyle) {
        protyle = getCurrentEditor().protyle;
        options.previousRange = protyle.toolbar.range;
    }
    /// #endif
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
                addEditorToDatabase(protyle, range);
            } else {
                addFilesToDatabase(fileLiElements);
            }
            break;
    }
};
