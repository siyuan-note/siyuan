import {hotKey2Electron, isCtrl, isMac, updateHotkeyTip} from "../protyle/util/compatibility";
import {Constants} from "../constants";
import {showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {ipcRenderer} from "electron";
import {exportLayout} from "../layout/util";

export const keymap = {
    element: undefined as Element,
    _genItem(keymap: Record<string, IKeymapItem>, keys: string) {
        let html = "";
        Object.keys(keymap).forEach(key => {
            if (window.siyuan.languages[key]) {
                html += `<li class="b3-list-item b3-list-item--hide-action">
    <span class="b3-list-item__text">${window.siyuan.languages[key]}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-key="${keys + Constants.ZWSP + key}" data-value="${keymap[key].custom}" data-default="${keymap[key].default}" class="b3-text-field" value="${updateHotkeyTip(keymap[key].custom)}">
    <span class="fn__space"></span>
    <span data-type="reset" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.reset}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="clear" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>
</li>`;
            }
        });
        return html;
    },
    genHTML() {
        return `<div class="fn__flex b3-label">
    <span class="fn__flex-center">${window.siyuan.languages.keymapTip}</span>
    <span class="fn__flex-1"></span>
    <button id="keymapRefreshBtn" class="b3-button b3-button--outline fn__flex-center fn__size200">
        <svg><use xlink:href="#iconRefresh"></use></svg>
        ${window.siyuan.languages.refresh}
    </button>
</div>
<div class="fn__flex b3-label">
    <span class="fn__flex-center">${window.siyuan.languages.keymapTip2}</span>
    <span class="fn__flex-1"></span>
    <span class="fn__space"></span>
    <button id="keymapResetBtn" class="b3-button b3-button--outline fn__flex-center fn__size200">
        <svg><use xlink:href="#iconUndo"></use></svg>
        ${window.siyuan.languages.reset}
    </button>
</div>
<div class="b3-label file-tree config-keymap" id="keymapList">
    <label class="b3-form__icon" style="display:block;">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <input id="keymapInput" class="b3-form__icon-input b3-text-field fn__block" placeholder="${window.siyuan.languages.search}">
    </label>
    <div class="fn__hr"></div>
    <ul class="b3-list b3-list--border b3-list--background">
        <li class="b3-list-item toggle">
            <span class="b3-list-item__toggle"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span>
            <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.general}</span>
        </li>
        <ul class="fn__none">${keymap._genItem(window.siyuan.config.keymap.general, "general")}</ul>
    </ul>
    <ul class="b3-list b3-list--border b3-list--background">
        <li class="b3-list-item toggle">
            <span class="b3-list-item__toggle">
                <svg class="b3-list-item__arrow b3-list-item__arrow--open"><use xlink:href="#iconRight"></use></svg>
            </span>
            <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.editor}</span>
        </li>
        <ul>
            <li class="b3-list-item toggle">
                <span class="b3-list-item__toggle">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.general}</span>
            </li>
            <ul class="fn__none">${keymap._genItem(window.siyuan.config.keymap.editor.general, "editor" + Constants.ZWSP + "general")}</ul>
            <li class="b3-list-item toggle">
                <span class="b3-list-item__toggle">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.insert}</span>
            </li>
            <ul class="fn__none">${keymap._genItem(window.siyuan.config.keymap.editor.insert, "editor" + Constants.ZWSP + "insert")}</ul>
            <li class="b3-list-item toggle">
                <span class="b3-list-item__toggle">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.headings}</span>
            </li>
            <ul class="fn__none">${keymap._genItem(window.siyuan.config.keymap.editor.heading, "editor" + Constants.ZWSP + "heading")}</ul>
            <li class="b3-list-item toggle">
                <span class="b3-list-item__toggle">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.list1}</span>
            </li>
            <ul class="fn__none">${keymap._genItem(window.siyuan.config.keymap.editor.list, "editor" + Constants.ZWSP + "list")}</ul>
            <li class="b3-list-item toggle">
                <span class="b3-list-item__toggle">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.table}</span>
            </li>
            <ul class="fn__none">${keymap._genItem(window.siyuan.config.keymap.editor.table, "editor" + Constants.ZWSP + "table")}</ul>
        </ul>
    </ul>
</div>`;
    },
    _setkeymap() {
        const data: IKeymap = Object.assign({}, Constants.SIYUAN_KEYMAP);
        keymap.element.querySelectorAll("ul input").forEach((item) => {
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
            ipcRenderer.send(Constants.SIYUAN_HOTKEY, hotKey2Electron(window.siyuan.config.keymap.general.toggleWin.custom));
            /// #endif
        });
    },
    _search(value: string) {
        keymap.element.querySelectorAll("#keymapList .b3-list-item--hide-action > .b3-list-item__text").forEach(item => {
            if (item.textContent.toLowerCase().indexOf(value.toLowerCase()) > -1 || value === "") {
                item.parentElement.classList.remove("fn__none");
                item.parentElement.parentElement.classList.remove("fn__none");
            } else {
                item.parentElement.classList.add("fn__none");
            }
        });
    },
    bindEvent() {
        keymap.element.querySelector("#keymapRefreshBtn").addEventListener("click", () => {
            exportLayout(true);
        });
        const searchElement = keymap.element.querySelector("#keymapInput") as HTMLInputElement;
        this.element.addEventListener("compositionend", () => {
            keymap._search(searchElement.value);
        });
        searchElement.addEventListener("input", (event: InputEvent) => {
            if (event.isComposing) {
                return;
            }
            keymap._search(searchElement.value);
        });
        keymap.element.querySelector("#keymapResetBtn").addEventListener("click", () => {
            window.siyuan.config.keymap = Constants.SIYUAN_KEYMAP;
            fetchPost("/api/setting/setKeymap", {
                data: Constants.SIYUAN_KEYMAP,
            }, () => {
                window.location.reload();
                /// #if !BROWSER
                ipcRenderer.send(Constants.SIYUAN_HOTKEY, hotKey2Electron(window.siyuan.config.keymap.general.toggleWin.custom));
                /// #endif
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
        keymapListElement.querySelectorAll("ul input").forEach(item => {
            item.addEventListener("keydown", function (event: KeyboardEvent) {
                event.stopPropagation();
                event.preventDefault();
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
                    } else if (event.code === "BracketLeft") {
                        keymapStr += "[";
                    } else if (event.code === "BracketRight") {
                        keymapStr += "]";
                    } else if (event.key === "Backspace") {
                        keymapStr += "⌫";
                    } else if (event.key === "Delete") {
                        keymapStr += "⌦";
                    } else if (event.key === "Enter") {
                        keymapStr += "↩";
                    } else if (event.altKey) {
                        const codeKey = event.code.substr(event.code.length - 1, 1).toUpperCase();
                        if (event.key === "Enter") {
                            keymapStr += "↩";
                        } else if (event.key.startsWith("F") && event.key.length > 1) {
                            keymapStr += event.key;
                        } else if (event.code === "Period") {
                            keymapStr += ".";
                        } else if (codeKey !== "I" && codeKey !== "E" && codeKey !== "N" && codeKey !== "U") {
                            keymapStr += codeKey;
                        } else if (event.which === 229) {
                            setTimeout(() => {
                                this.value = "";
                            });
                        }
                    } else if (event.key === "》") {
                        keymapStr += ">";
                    } else if (event.key === "《") {
                        keymapStr += "<";
                    } else if (event.key === "—") {
                        keymapStr += "-";
                    } else {
                        keymapStr += event.key.length > 1 ? event.key : event.key.toUpperCase();
                    }
                }

                this.setAttribute("data-value", keymapStr);
                if (event.key === "—") {
                    // Mac 中文下会添加"——"
                    setTimeout(() => {
                        this.value = updateHotkeyTip(keymapStr);
                    });
                } else {
                    this.value = updateHotkeyTip(keymapStr);
                }
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
                        ["⌘A", "⌘X", "⌘C", "⌘V", "⌘/", "⇧↑", "⇧↓", "⇧→", "⇧←", "⇧⇥", "⇧⌘⇥", "⌃⇥", "⌃⌘⇥", "⇧⌘→", "⇧⌘←", "⌘Home", "⌘End", "⇧↩", "↩", "PageUp", "PageDown", "⌫", "⌦"].includes(keymapStr)) {
                        showMessage(tip + "] " + window.siyuan.languages.invalid);
                        return;
                    }
                    const hasConflict = Array.from(keymap.element.querySelectorAll("ul input")).find(inputItem => {
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
};
