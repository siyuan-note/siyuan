import {hotKey2Electron, isCtrl, isMac, updateHotkeyTip} from "../protyle/util/compatibility";
import {Constants} from "../constants";
import {showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {exportLayout} from "../layout/util";
/// #if !BROWSER
import {getCurrentWindow} from "@electron/remote";
import {ipcRenderer} from "electron";
/// #endif
import {confirmDialog} from "../dialog/confirmDialog";

export const keymap = {
    element: undefined as Element,
    _genItem(keymap: Record<string, IKeymapItem>, keys: string) {
        let html = "";
        Object.keys(keymap).forEach(key => {
            if (window.siyuan.languages[key]) {
                html += `<label class="b3-list-item b3-list-item--hide-action">
    <span class="b3-list-item__text">${window.siyuan.languages[key]}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-key="${keys + Constants.ZWSP + key}" data-value="${keymap[key].custom}" data-default="${keymap[key].default}" class="b3-text-field fn__size96" value="${updateHotkeyTip(keymap[key].custom)}" spellcheck="false">
    <span data-type="reset" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.reset}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
    <span data-type="clear" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>
</label>`;
            }
        });
        return html;
    },
    genHTML() {
        return `<label class="fn__flex b3-label config__item">
    <span class="fn__flex-center">${window.siyuan.languages.keymapTip}</span>
    <span class="fn__flex-1"></span>
    <button id="keymapRefreshBtn" class="b3-button b3-button--outline fn__flex-center fn__size200">
        <svg><use xlink:href="#iconRefresh"></use></svg>
        ${window.siyuan.languages.refresh}
    </button>
</label>
<label class="fn__flex b3-label config__item">
    <span class="fn__flex-center">${window.siyuan.languages.keymapTip2}</span>
    <span class="fn__flex-1"></span>
    <span class="fn__space"></span>
    <button id="keymapResetBtn" class="b3-button b3-button--outline fn__flex-center fn__size200">
        <svg><use xlink:href="#iconUndo"></use></svg>
        ${window.siyuan.languages.reset}
    </button>
</label>
<div class="b3-label file-tree config-keymap" id="keymapList">
    <div class="fn__flex config__item">
        <label class="b3-form__icon fn__flex-1">
            <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
            <input id="keymapInput" class="b3-form__icon-input b3-text-field fn__block" placeholder="${window.siyuan.languages.search}">
        </label>
        <div class="fn__space"></div>
        <label class="b3-form__icon">
            <svg class="b3-form__icon-icon"><use xlink:href="#iconKeymap"></use></svg>
            <input id="searchByKey" class="b3-form__icon-input b3-text-field" spellcheck="false" placeholder="${window.siyuan.languages.keymap}">
        </label>
        <div class="fn__space"></div>
        <button id="clearSearchBtn" class="b3-button b3-button--outline fn__flex-center fn__size200">
            <svg style="height: 14px"><use xlink:href="#iconClose"></use></svg>
            ${window.siyuan.languages.clear}
        </button>
    </div>
    <div class="fn__hr"></div>
    <div class="b3-list b3-list--border b3-list--background">
        <div class="b3-list-item toggle">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span>
            <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.general}</span>
        </div>
        <div class="fn__none">${keymap._genItem(window.siyuan.config.keymap.general, "general")}</div>
    </div>
    <div class="b3-list b3-list--border b3-list--background">
        <div class="b3-list-item toggle">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                <svg class="b3-list-item__arrow b3-list-item__arrow--open"><use xlink:href="#iconRight"></use></svg>
            </span>
            <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.editor}</span>
        </div>
        <div>
            <label class="b3-list-item toggle">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.general}</span>
            </label>
            <div class="fn__none">${keymap._genItem(window.siyuan.config.keymap.editor.general, "editor" + Constants.ZWSP + "general")}</div>
            <label class="b3-list-item toggle">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.insert}</span>
            </label>
            <div class="fn__none">${keymap._genItem(window.siyuan.config.keymap.editor.insert, "editor" + Constants.ZWSP + "insert")}</div>
            <label class="b3-list-item toggle">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.headings}</span>
            </label>
            <div class="fn__none">${keymap._genItem(window.siyuan.config.keymap.editor.heading, "editor" + Constants.ZWSP + "heading")}</div>
            <label class="b3-list-item toggle">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.list1}</span>
            </label>
            <div class="fn__none">${keymap._genItem(window.siyuan.config.keymap.editor.list, "editor" + Constants.ZWSP + "list")}</div>
            <label class="b3-list-item toggle">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.table}</span>
            </label>
            <div class="fn__none">${keymap._genItem(window.siyuan.config.keymap.editor.table, "editor" + Constants.ZWSP + "table")}</div>
        </div>
    </div>
</div>`;
    },
    _setkeymap() {
        const data: IKeymap = JSON.parse(JSON.stringify(Constants.SIYUAN_KEYMAP));
        keymap.element.querySelectorAll("label.b3-list-item input").forEach((item) => {
            const keys = item.getAttribute("data-key").split(Constants.ZWSP);
            if (keys[0] === "general") {
                data[keys[0]][keys[1]].custom = item.getAttribute("data-value");
            } else if (keys[0] === "editor" && (keys[1] === "general" || keys[1] === "insert" || keys[1] === "heading" || keys[1] === "list" || keys[1] === "table")) {
                data[keys[0]][keys[1]][keys[2]].custom = item.getAttribute("data-value");
            }
        });
        window.siyuan.config.keymap = data;
        fetchPost("/api/setting/setKeymap", {
            data
        }, () => {
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_HOTKEY, {
                languages: window.siyuan.languages["_trayMenu"],
                id: getCurrentWindow().id,
                hotkey: hotKey2Electron(window.siyuan.config.keymap.general.toggleWin.custom)
            });
            /// #endif
        });
    },
    _search(value: string, keymapString: string) {
        keymap.element.querySelectorAll("#keymapList .b3-list-item--hide-action > .b3-list-item__text").forEach(item => {
            const liElement = item.parentElement;
            let matchedKeymap = false;
            if (keymapString === "" || (item.nextElementSibling.nextElementSibling as HTMLInputElement).value.indexOf(updateHotkeyTip(keymapString)) > -1) {
                matchedKeymap = true;
            }
            if ((item.textContent.toLowerCase().indexOf(value.toLowerCase()) > -1 || value === "") && matchedKeymap) {
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
                if (liElement.parentElement.childElementCount === liElement.parentElement.querySelectorAll(".fn__none").length) {
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
    bindEvent() {
        keymap.element.querySelector("#keymapRefreshBtn").addEventListener("click", () => {
            exportLayout(true);
        });
        const searchElement = keymap.element.querySelector("#keymapInput") as HTMLInputElement;
        const searchKeymapElement = keymap.element.querySelector("#searchByKey") as HTMLInputElement;
        searchElement.addEventListener("compositionend", () => {
            keymap._search(searchElement.value, searchKeymapElement.value);
        });
        searchElement.addEventListener("input", (event: InputEvent) => {
            if (event.isComposing) {
                return;
            }
            keymap._search(searchElement.value, searchKeymapElement.value);
        });
        searchKeymapElement.addEventListener("keydown", function (event: KeyboardEvent) {
            event.stopPropagation();
            event.preventDefault();
            const keymapStr = keymap._getKeymapString(event, this);
            keymap._search(searchElement.value, keymapStr);
        });
        keymap.element.querySelector("#clearSearchBtn").addEventListener("click", () => {
            searchElement.value = "";
            searchKeymapElement.value = "";
            keymap._search("", "");
        });
        keymap.element.querySelector("#keymapResetBtn").addEventListener("click", () => {
            confirmDialog(window.siyuan.languages.reset, window.siyuan.languages.confirmReset, () => {
                fetchPost("/api/setting/setKeymap", {
                    data: Constants.SIYUAN_KEYMAP,
                }, () => {
                    window.location.reload();
                    /// #if !BROWSER
                    ipcRenderer.send(Constants.SIYUAN_HOTKEY, {
                        languages: window.siyuan.languages["_trayMenu"],
                        id: getCurrentWindow().id,
                        hotkey: hotKey2Electron(window.siyuan.config.keymap.general.toggleWin.custom)
                    });
                    /// #endif
                });
            });
        });
        const keymapListElement = keymap.element.querySelector("#keymapList");
        keymapListElement.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(keymapListElement)) {
                if (target.classList.contains("b3-tooltips")) {
                    const type = target.getAttribute("data-type");
                    const inputElement = target.parentElement.querySelector(".b3-text-field") as HTMLInputElement;
                    if (type === "reset") {
                        inputElement.value = updateHotkeyTip(inputElement.getAttribute("data-default"));
                        inputElement.setAttribute("data-value", inputElement.getAttribute("data-default"));
                    } else if (type === "clear") {
                        inputElement.value = "";
                        inputElement.setAttribute("data-value", "");
                    }
                    keymap._setkeymap();
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
        keymapListElement.querySelectorAll("label.b3-list-item input").forEach(item => {
            item.addEventListener("keydown", function (event: KeyboardEvent) {
                event.stopPropagation();
                event.preventDefault();
                const keymapStr = keymap._getKeymapString(event, this);
                clearTimeout(timeout);
                timeout = window.setTimeout(() => {
                    const keys = this.getAttribute("data-key").split(Constants.ZWSP);
                    if (keys[1] === "list") {
                        keys[1] = "list1";
                    }
                    if (keys[1] === "heading") {
                        keys[1] = "headings";
                    }
                    let tip = `${window.siyuan.languages.keymap} [${window.siyuan.languages[keys[0]]}-${window.siyuan.languages[keys[1]]}`;
                    if (keys[2]) {
                        tip += `-${window.siyuan.languages[keys[2]]}`;
                    }

                    if (["⌘", "⇧", "⌥", "⌃"].includes(keymapStr.substr(keymapStr.length - 1, 1)) ||
                        ["⌘A", "⌘X", "⌘C", "⌘V", "⇧⌘V", "⌘/", "⇧↑", "⇧↓", "⇧→", "⇧←", "⇧⇥", "⇧⌘⇥", "⌃⇥", "⌘⇥", "⌃⌘⇥", "⇧⌘→", "⇧⌘←", "⌘Home", "⌘End", "⇧↩", "↩", "PageUp", "PageDown", "⌫", "⌦"].includes(keymapStr)) {
                        showMessage(tip + "] " + window.siyuan.languages.invalid);
                        return;
                    }
                    const hasConflict = Array.from(keymap.element.querySelectorAll("label.b3-list-item input")).find(inputItem => {
                        if (!inputItem.isSameNode(this) && inputItem.getAttribute("data-value") === keymapStr) {
                            const inputValueList = inputItem.getAttribute("data-key").split(Constants.ZWSP);
                            if (inputValueList[1] === "list") {
                                inputValueList[1] = "list1";
                            }
                            if (inputValueList[1] === "heading") {
                                inputValueList[1] = "headings";
                            }
                            let conflictTip = `${window.siyuan.languages[inputValueList[0]]}-${window.siyuan.languages[inputValueList[1]]}`;
                            if (inputValueList[2]) {
                                conflictTip += `-${window.siyuan.languages[inputValueList[2]]}`;
                            }
                            showMessage(`${tip}] [${conflictTip}] ${window.siyuan.languages.conflict}`);
                            return true;
                        }
                    });
                    if (hasConflict) {
                        return;
                    }
                    keymap._setkeymap();
                }, 1000);
            });
        });
    },
    _getKeymapString(event: KeyboardEvent, it: HTMLInputElement) {
        let keymapStr = "";
        if (event.ctrlKey && !event.metaKey && isMac()) {
            keymapStr += "⌃";
        }
        if (event.altKey) {
            keymapStr += "⌥";
        }
        if (event.shiftKey) {
            keymapStr += "⇧";
        }
        if (isCtrl(event)) {
            keymapStr += "⌘";
        }
        if (event.key !== "Shift" && event.key !== "Alt" && event.key !== "Meta" && event.key !== "Control") {
            if (event.key === "ArrowUp") {
                keymapStr += "↑";
            } else if (event.key === "ArrowDown") {
                keymapStr += "↓";
            } else if (event.key === "ArrowLeft") {
                keymapStr += "←";
            } else if (event.key === "ArrowRight") {
                keymapStr += "→";
            } else if (event.key === "Tab") {
                keymapStr += "⇥";
            } else if (event.key === "Backspace") {
                keymapStr += "⌫";
            } else if (event.key === "Delete") {
                keymapStr += "⌦";
            } else if (event.key === "Enter") {
                keymapStr += "↩";
            } else if (Constants.KEYCODE[event.keyCode]) {
                if (event.shiftKey) {
                    keymapStr += Constants.KEYCODE[event.keyCode][1];
                } else {
                    keymapStr += Constants.KEYCODE[event.keyCode][0];
                }
            } else if (["/", ".", "+", "-", "*"].includes(event.key)) {
                keymapStr += event.key;
            } else if (event.code.startsWith("Digit") || event.code.startsWith("Key") || event.code.startsWith("Numpad")) {
                // 新版 Electron 可以支持 Alt["I", "E", "N", "U"]，故移除原有判断
                keymapStr += event.code.substring(event.code.length - 1).toUpperCase();
            } else {
                keymapStr += event.key === "Unidentified" ? "" : (event.key.length > 1 ? event.key : event.key.toUpperCase());
            }
        }
        it.setAttribute("data-value", keymapStr);
        // Mac 中文下会直接输入
        setTimeout(() => {
            it.value = updateHotkeyTip(keymapStr);
        });
        return keymapStr;
    }
};
