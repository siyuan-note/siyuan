import {isMac, updateHotkeyTip} from "../protyle/util/compatibility";
import {Constants} from "../constants";
import {hideMessage, showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {exportLayout} from "../layout/util";
import {confirmDialog} from "../dialog/confirmDialog";
import {App} from "../index";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {sendGlobalShortcut} from "../boot/globalEvent/keydown";

export const keymap = {
    element: undefined as Element,
    _genItem(keymap: Record<string, Config.IKey>, keys: string) {
        let html = "";
        Object.keys(keymap).forEach(key => {
            if (window.siyuan.languages[key]) {
                const keyValue = updateHotkeyTip(keymap[key].custom);
                let keymapName = window.siyuan.languages[key];
                if ("editor" + Constants.ZWSP + "general" === keys && key === "duplicate") {
                    keymapName = `${window.siyuan.languages.duplicate} / ${window.siyuan.languages.duplicateMirror}`;
                }
                html += `<label class="b3-list-item b3-list-item--narrow b3-list-item--hide-action">
    <span class="b3-list-item__text">${keymapName}</span>
    <span data-type="reset" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.reset}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
    <span data-type="clear" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>
    <span data-type="update" class="config-keymap__key">${keyValue}</span>
    <input data-key="${keys + Constants.ZWSP + key}" data-value="${keymap[key].custom}" data-default="${keymap[key].default}" class="b3-text-field fn__none" value="${keyValue}" spellcheck="false">
</label>`;
            }
        });
        return html;
    },
    genHTML(app: App) {
        let pluginHtml = "";
        app.plugins.forEach(item => {
            let commandHTML = "";
            item.commands.forEach(command => {
                const keyValue = updateHotkeyTip(command.customHotkey);
                commandHTML += `<label class="b3-list-item b3-list-item--narrow b3-list-item--hide-action">
    <span class="b3-list-item__text">${command.langText || (item.i18n ? item.i18n[command.langKey] : "") || command.langKey}</span>
    <span data-type="reset" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.reset}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
    <span data-type="clear" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>
    <span data-type="update" class="config-keymap__key">${keyValue}</span>
    <input data-key="plugin${Constants.ZWSP}${item.name}${Constants.ZWSP}${command.langKey}" data-value="${command.customHotkey}" data-default="${command.hotkey}" class="b3-text-field fn__none" value="${keyValue}" spellcheck="false">
</label>`;
            });
            Object.keys(item.docks).forEach(key => {
                const dockConfig = item.docks[key].config;
                if (!dockConfig.hotkey) {
                    return;
                }
                const dockKeymap = window.siyuan.config.keymap.plugin[item.name][key];
                const keyValue = updateHotkeyTip(dockKeymap.custom);
                commandHTML += `<label class="b3-list-item b3-list-item--narrow b3-list-item--hide-action">
    <span class="b3-list-item__text">${dockConfig.title}</span>
    <span data-type="reset" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.reset}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
    <span data-type="clear" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>
    <span data-type="update" class="config-keymap__key">${keyValue}</span>
    <input data-key="plugin${Constants.ZWSP}${item.name}${Constants.ZWSP}${key}" data-value="${dockKeymap.custom}" data-default="${dockKeymap.default}" class="b3-text-field fn__none" value="${keyValue}" spellcheck="false">
</label>`;
            });
            if (commandHTML) {
                pluginHtml += `<div class="b3-list-item b3-list-item--narrow toggle">
    <span class="b3-list-item__toggle b3-list-item__toggle--hl">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    <span class="b3-list-item__text ft__on-surface">${item.displayName}</span>
</div>
<div class="fn__none b3-list__panel">
    ${commandHTML}
</div>`;
            }
        });
        if (pluginHtml) {
            pluginHtml = `<div class="b3-list b3-list--border b3-list--background">
    <div class="b3-list-item b3-list-item--narrow toggle">
        <span class="b3-list-item__toggle b3-list-item__toggle--hl">
            <svg class="b3-list-item__arrow b3-list-item__arrow--open"><use xlink:href="#iconRight"></use></svg>
        </span>
        <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.plugin}</span>
    </div>
    <div class="b3-list__panel">
        ${pluginHtml}
    </div>
</div>`;
        }
        return `<div class="fn__flex b3-label config__item">
    <span class="fn__flex-center">${window.siyuan.languages.keymapTip}</span>
    <span class="fn__flex-1"></span>
    <button id="keymapRefreshBtn" class="b3-button b3-button--outline fn__flex-center fn__size200">
        <svg><use xlink:href="#iconRefresh"></use></svg>
        ${window.siyuan.languages.refresh}
    </button>
</div>
<div class="fn__flex b3-label config__item">
    <span class="fn__flex-center">${window.siyuan.languages.keymapTip2}</span>
    <span class="fn__flex-1"></span>
    <span class="fn__space"></span>
    <button id="keymapResetBtn" class="b3-button b3-button--outline fn__flex-center fn__size200">
        <svg><use xlink:href="#iconUndo"></use></svg>
        ${window.siyuan.languages.reset}
    </button>
</div>
<div class="b3-label file-tree config-keymap" id="keymapList">
    <div class="fn__flex config__item">
        <label class="b3-form__icon fn__block">
            <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
            <input id="keymapInput" class="b3-form__icon-input b3-text-field fn__block" placeholder="${window.siyuan.languages.search}">
        </label>
        <div class="fn__space"></div>
        <label class="b3-form__icon fn__block searchByKeyLabel">
            <svg class="b3-form__icon-icon"><use xlink:href="#iconKeymap"></use></svg>
            <input id="searchByKey" data-value="" class="b3-form__icon-input b3-text-field fn__block" spellcheck="false" placeholder="${window.siyuan.languages.keymap}">
        </label>
        <div class="fn__space"></div>
        <button id="clearSearchBtn" class="b3-button b3-button--outline fn__flex-center fn__size200">
            <svg style="height: 14px"><use xlink:href="#iconClose"></use></svg>
            ${window.siyuan.languages.clear}
        </button>
    </div>
    <div class="fn__hr"></div>
    <div class="b3-list b3-list--border b3-list--background">
        <div class="b3-list-item b3-list-item--narrow toggle">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span>
            <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.general}</span>
        </div>
        <div class="fn__none b3-list__panel">${keymap._genItem(window.siyuan.config.keymap.general, "general")}</div>
    </div>
    <div class="b3-list b3-list--border b3-list--background">
        <div class="b3-list-item b3-list-item--narrow toggle">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                <svg class="b3-list-item__arrow b3-list-item__arrow--open"><use xlink:href="#iconRight"></use></svg>
            </span>
            <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.editor}</span>
        </div>
        <div class="b3-list__panel">
            <div class="b3-list-item b3-list-item--narrow toggle">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.general}</span>
            </div>
            <div class="fn__none b3-list__panel">${keymap._genItem(window.siyuan.config.keymap.editor.general, "editor" + Constants.ZWSP + "general")}</div>
            <div class="b3-list-item b3-list-item--narrow toggle">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.element}</span>
            </div>
            <div class="fn__none b3-list__panel">${keymap._genItem(window.siyuan.config.keymap.editor.insert, "editor" + Constants.ZWSP + "insert")}</div>
            <div class="b3-list-item b3-list-item--narrow toggle">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.headings}</span>
            </div>
            <div class="fn__none b3-list__panel">${keymap._genItem(window.siyuan.config.keymap.editor.heading, "editor" + Constants.ZWSP + "heading")}</div>
            <div class="b3-list-item b3-list-item--narrow toggle">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.list1}</span>
            </div>
            <div class="fn__none b3-list__panel">${keymap._genItem(window.siyuan.config.keymap.editor.list, "editor" + Constants.ZWSP + "list")}</div>
            <div class="b3-list-item b3-list-item--narrow toggle">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.table}</span>
            </div>
            <div class="fn__none b3-list__panel">${keymap._genItem(window.siyuan.config.keymap.editor.table, "editor" + Constants.ZWSP + "table")}</div>
        </div>
    </div>
    ${pluginHtml}
</div>`;
    },
    _setkeymap(app: App) {
        const data: Config.IKeymap = JSON.parse(JSON.stringify(Constants.SIYUAN_KEYMAP));
        const oldToggleWin = window.siyuan.config.keymap.general.toggleWin.custom;
        keymap.element.querySelectorAll("label.b3-list-item input").forEach((item) => {
            const keys = item.getAttribute("data-key").split(Constants.ZWSP);
            const newHotkey = item.getAttribute("data-value");
            if (keys[0] === "plugin") {
                window.siyuan.config.keymap.plugin[keys[1]][keys[2]].custom = newHotkey;
                data.plugin = window.siyuan.config.keymap.plugin;
                app.plugins.forEach((plugin) => {
                    if (plugin.name === keys[1]) {
                        plugin.commands.forEach(command => {
                            if (command.langKey === keys[2]) {
                                command.customHotkey = newHotkey;
                            }
                        });
                    }
                });
            } else if (keys[0] === "general") {
                data[keys[0]][keys[1]].custom = newHotkey;
            } else if (keys[0] === "editor" && (keys[1] === "general" || keys[1] === "insert" || keys[1] === "heading" || keys[1] === "list" || keys[1] === "table")) {
                data[keys[0]][keys[1]][keys[2]].custom = newHotkey;
            }
        });
        window.siyuan.config.keymap = data;
        fetchPost("/api/setting/setKeymap", {
            data
        }, () => {
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd: "writeLog",
                msg: "user update keymap:" + JSON.stringify(window.siyuan.config.keymap)
            });
            if (oldToggleWin !== window.siyuan.config.keymap.general.toggleWin.custom) {
                ipcRenderer.send(Constants.SIYUAN_CMD, {
                    cmd: "unregisterGlobalShortcut",
                    accelerator: oldToggleWin
                });
            }
            sendGlobalShortcut(app);
        });
    },
    search(value: string, keymapString: string) {
        keymap.element.querySelectorAll("#keymapList .b3-list-item--hide-action > .b3-list-item__text").forEach(item => {
            const liElement = item.parentElement;
            let matchedKeymap = false;
            if (keymapString === "" || liElement.querySelector(".b3-text-field").getAttribute("data-value").indexOf(keymapString) > -1) {
                matchedKeymap = true;
            }
            if ((item.textContent.toLowerCase().indexOf(value.toLowerCase()) > -1 || value.toLowerCase().indexOf(item.textContent.toLowerCase()) > -1 || value === "") && matchedKeymap) {
                liElement.classList.remove("fn__none");
                liElement.parentElement.classList.remove("fn__none");
                liElement.parentElement.parentElement.classList.remove("fn__none");
            } else {
                liElement.classList.add("fn__none");
            }
            if (!liElement.nextElementSibling) {
                const toggleElement = liElement.parentElement.previousElementSibling;
                const toggleIconElement = toggleElement.querySelector(".b3-list-item__arrow");
                if (value === "" && keymapString === "") {
                    // 复原折叠状态
                    if (toggleIconElement.classList.contains("b3-list-item__arrow--open")) {
                        liElement.parentElement.classList.remove("fn__none");
                    } else {
                        liElement.parentElement.classList.add("fn__none");
                    }
                }
                // 隐藏没有子项的快捷键项目
                if (liElement.parentElement.childElementCount === liElement.parentElement.querySelectorAll(".b3-list-item.fn__none").length) {
                    toggleElement.classList.add("fn__none");
                } else {
                    toggleElement.classList.remove("fn__none");
                }
            }
        });
        // 编辑器中三级菜单单独处理
        const editorKeymapElement = keymap.element.querySelector("#keymapList").lastElementChild;
        if (value === "" && keymapString === "") {
            // 复原折叠状态
            if (editorKeymapElement.querySelector(".b3-list-item__arrow").classList.contains("b3-list-item__arrow--open")) {
                editorKeymapElement.lastElementChild.classList.remove("fn__none");
            } else {
                editorKeymapElement.lastElementChild.classList.add("fn__none");
            }
        }
        // 隐藏没有子项的快捷键项目
        if (editorKeymapElement.querySelectorAll(".b3-list-item--hide-action.fn__none").length === editorKeymapElement.querySelectorAll(".b3-list-item--hide-action").length) {
            editorKeymapElement.firstElementChild.classList.add("fn__none");
        } else {
            editorKeymapElement.firstElementChild.classList.remove("fn__none");
        }
    },
    _getTip(element: HTMLElement) {
        const thirdElement = element.parentElement;
        let tip = thirdElement.querySelector(".b3-list-item__text").textContent.trim();
        const secondElement = thirdElement.parentElement.previousElementSibling;
        tip = secondElement.textContent.trim() + "-" + tip;
        const firstElement = secondElement.parentElement.previousElementSibling;
        if (firstElement.classList.contains("b3-list-item")) {
            tip = firstElement.textContent.trim() + "-" + tip;
        }
        return tip;
    },
    bindEvent(app: App) {
        keymap.element.querySelector("#keymapRefreshBtn").addEventListener("click", () => {
            exportLayout({
                cb() {
                    window.location.reload();
                },
                errorExit: false,
            });
        });
        const searchElement = keymap.element.querySelector("#keymapInput") as HTMLInputElement;
        const searchKeymapElement = keymap.element.querySelector("#searchByKey") as HTMLInputElement;
        searchElement.addEventListener("compositionend", () => {
            keymap.search(searchElement.value, searchKeymapElement.dataset.value);
        });
        searchElement.addEventListener("input", (event: InputEvent) => {
            if (event.isComposing) {
                return;
            }
            keymap.search(searchElement.value, searchKeymapElement.dataset.value);
        });
        /// #if !BROWSER
        searchKeymapElement.addEventListener("focus", () => {
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd: "unregisterGlobalShortcut",
                accelerator: window.siyuan.config.keymap.general.toggleWin.custom
            });
        });
        /// #endif
        searchKeymapElement.addEventListener("blur", () => {
            sendGlobalShortcut(app);
        });
        searchKeymapElement.addEventListener("keydown", function (event: KeyboardEvent) {
            event.stopPropagation();
            event.preventDefault();
            const keymapStr = keymap._getKeymapString(event);
            // Mac 中文下会直接输入
            setTimeout(() => {
                this.value = updateHotkeyTip(keymapStr);
            });
            this.dataset.keymap = keymapStr;
            keymap.search(searchElement.value, keymapStr);
        });
        keymap.element.querySelector("#clearSearchBtn").addEventListener("click", () => {
            searchElement.value = "";
            searchKeymapElement.value = "";
            keymap.search("", "");
        });
        keymap.element.querySelector("#keymapResetBtn").addEventListener("click", () => {
            confirmDialog("⚠️ " + window.siyuan.languages.reset, window.siyuan.languages.confirmReset, () => {
                fetchPost("/api/setting/setKeymap", {
                    data: Constants.SIYUAN_KEYMAP,
                }, () => {
                    ipcRenderer.send(Constants.SIYUAN_CMD, {
                        cmd: "writeLog",
                        msg: "user reset keymap"
                    });
                    if (window.siyuan.config.keymap.general.toggleWin.default !== window.siyuan.config.keymap.general.toggleWin.custom) {
                        ipcRenderer.send(Constants.SIYUAN_CMD, {
                            cmd: "unregisterGlobalShortcut",
                            accelerator: window.siyuan.config.keymap.general.toggleWin.custom
                        });
                    }
                    window.location.reload();
                    sendGlobalShortcut(app);
                });
            });
        });
        const keymapListElement = keymap.element.querySelector("#keymapList");
        keymapListElement.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(keymapListElement)) {
                const type = target.getAttribute("data-type");
                if (type === "reset") {
                    const inputElement = target.parentElement.querySelector(".b3-text-field") as HTMLInputElement;
                    inputElement.value = updateHotkeyTip(inputElement.getAttribute("data-default"));
                    inputElement.setAttribute("data-value", inputElement.getAttribute("data-default"));
                    inputElement.previousElementSibling.textContent = inputElement.value;
                    keymap._setkeymap(app);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "clear") {
                    const inputElement = target.parentElement.querySelector(".b3-text-field") as HTMLInputElement;
                    inputElement.value = "";
                    inputElement.previousElementSibling.textContent = "";
                    inputElement.setAttribute("data-value", "");
                    keymap._setkeymap(app);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "update") {
                    target.classList.add("fn__none");
                    const inputElement = target.nextElementSibling as HTMLInputElement;
                    inputElement.classList.remove("fn__none");
                    inputElement.focus();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("b3-list-item--hide-action")) {
                    const inputElement = target.querySelector(".b3-text-field") as HTMLInputElement;
                    inputElement.classList.remove("fn__none");
                    inputElement.focus();
                    inputElement.previousElementSibling.classList.add("fn__none");
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("toggle")) {
                    if (target.nextElementSibling.classList.contains("fn__none")) {
                        target.firstElementChild.firstElementChild.classList.add("b3-list-item__arrow--open");
                        target.nextElementSibling.classList.remove("fn__none");
                    } else {
                        target.firstElementChild.firstElementChild.classList.remove("b3-list-item__arrow--open");
                        target.nextElementSibling.classList.add("fn__none");
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });
        let timeout: number;
        keymapListElement.querySelectorAll("label.b3-list-item input").forEach((item: HTMLInputElement) => {
            item.addEventListener("keydown", function (event: KeyboardEvent) {
                event.stopPropagation();
                event.preventDefault();
                const keymapStr = keymap._getKeymapString(event);
                const adoptKeymapStr = updateHotkeyTip(keymapStr);
                clearTimeout(timeout);
                timeout = window.setTimeout(() => {
                    const keys = this.getAttribute("data-key").split(Constants.ZWSP);
                    if (keys[1] === "list") {
                        keys[1] = "list1";
                    }
                    if (keys[1] === "heading") {
                        keys[1] = "headings";
                    }
                    let hasConflict = false;
                    const isAssistKey = ["⌘", "⇧", "⌥", "⌃"].includes(keymapStr.substr(keymapStr.length - 1, 1))
                    if (isAssistKey ||
                        ["⌘A", "⌘X", "⌘C", "⌘V", "⌘-", "⌘=", "⌘0", "⇧⌘V", "⌘/", "⇧↑", "⇧↓", "⇧→", "⇧←", "⇧⇥", "⌃D", "⇧⌘→", "⇧⌘←", "⌘Home", "⌘End", "⇧↩", "↩", "PageUp", "PageDown", "⌫", "⌦", "Escape"].includes(keymapStr) ||
                        // 跳转到下/上一个编辑页签不能包含 ctrl， 否则不能监听到 keyup
                        (isMac() && keys[0] === "general" && ["goToEditTabNext", "goToEditTabPrev"].includes(keys[1]) && keymapStr.includes("⌘"))
                    ) {
                        if (!isAssistKey) {
                            showMessage(`${window.siyuan.languages.invalid} [${adoptKeymapStr}]`);
                        }
                        hasConflict = true;
                    }
                    Array.from(keymap.element.querySelectorAll("label.b3-list-item input")).find((inputItem: HTMLElement) => {
                        if (!inputItem.isSameNode(this) && inputItem.getAttribute("data-value") === keymapStr) {
                            const inputValueList = inputItem.getAttribute("data-key").split(Constants.ZWSP);
                            if (inputValueList[1] === "list") {
                                inputValueList[1] = "list1";
                            }
                            if (inputValueList[1] === "heading") {
                                inputValueList[1] = "headings";
                            }
                            showMessage(`${window.siyuan.languages.conflict} [${keymap._getTip(inputItem)} ${adoptKeymapStr}]`);
                            hasConflict = true;
                            return true;
                        }
                    });
                    if (hasConflict) {
                        this.value = updateHotkeyTip(this.getAttribute("data-value"));
                        return;
                    }
                    hideMessage();
                    this.setAttribute("data-value", keymapStr);
                    this.value = adoptKeymapStr;
                    keymap._setkeymap(app);
                }, Constants.TIMEOUT_TRANSITION);
            });
            item.addEventListener("blur", function () {
                sendGlobalShortcut(app);
                setTimeout(() => {
                    this.classList.add("fn__none");
                    this.previousElementSibling.textContent = this.value;
                    this.previousElementSibling.classList.remove("fn__none");
                }, Constants.TIMEOUT_INPUT);    // 隐藏的话点击删除无法 target 会为 li
            });
            /// #if !BROWSER
            item.addEventListener("focus", () => {
                ipcRenderer.send(Constants.SIYUAN_CMD, {
                    cmd: "unregisterGlobalShortcut",
                    accelerator: window.siyuan.config.keymap.general.toggleWin.custom
                });
            });
            /// #endif
        });
    },
    _getKeymapString(event: KeyboardEvent) {
        let keymapStr = "";
        if (event.ctrlKey && isMac()) {
            keymapStr += "⌃";
        }
        if (event.altKey) {
            keymapStr += "⌥";
        }
        if (event.shiftKey) {
            keymapStr += "⇧";
        }
        if (event.metaKey || (!isMac() && event.ctrlKey)) {
            keymapStr += "⌘";
        }
        if (event.key !== "Shift" && event.key !== "Alt" && event.key !== "Meta" && event.key !== "Control" && event.key !== "Unidentified") {
            if (event.keyCode === 229) {
                // windows 中文输入法下 shift + - 等
                if (event.code === "Minus") {
                    keymapStr += "-";
                } else if (event.code === "Semicolon") {
                    keymapStr += ";";
                } else if (event.code === "Quote") {
                    keymapStr += "'";
                } else if (event.code === "Comma") {
                    keymapStr += ",";
                } else if (event.code === "Period") {
                    keymapStr += ".";
                } else if (event.code === "Slash") {
                    keymapStr += "/";
                }
            } else {
                keymapStr += Constants.KEYCODELIST[event.keyCode] || (event.key.length > 1 ? event.key : event.key.toUpperCase());
            }
        }
        return keymapStr;
    }
};
