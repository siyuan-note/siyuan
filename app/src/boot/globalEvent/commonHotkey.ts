import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
/// #if !BROWSER
import {sendGlobalShortcut} from "./keydown";
import {ipcRenderer} from "electron";
/// #endif
import {App} from "../../index";
import {isMac, isNotCtrl, isOnlyMeta} from "../../protyle/util/compatibility";
import {showPopover} from "../../block/popover";

const matchKeymap = (keymap: Config.IKeys, key1: "general" | "editor", key2?: "general" | "insert" | "heading" | "list" | "table") => {
    if (key1 === "general") {
        if (!window.siyuan.config.keymap[key1]) {
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd: "writeLog",
                msg: "window.siyuan.config.keymap.general is not found"
            });
            /// #endif
            window.siyuan.config.keymap[key1] = keymap as Config.IKeymapGeneral;
            return false;
        }
    } else {
        if (!window.siyuan.config.keymap[key1]) {
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd: "writeLog",
                msg: "window.siyuan.config.keymap.editor is not found"
            });
            /// #endif
            window.siyuan.config.keymap[key1] = JSON.parse(JSON.stringify(Constants.SIYUAN_KEYMAP.editor));
            return false;
        }
        if (!window.siyuan.config.keymap[key1][key2]) {
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd: "writeLog",
                msg: `window.siyuan.config.keymap.editor.${key2} is not found`
            });
            /// #endif
            (window.siyuan.config.keymap[key1][key2] as Config.IKeymapEditor[typeof key2]) = keymap as Config.IKeymapEditor[typeof key2];
            return false;
        }
    }
    let match = true;
    Object.keys(keymap).forEach(key => {
        if (key1 === "general") {
            if (!window.siyuan.config.keymap[key1][key] || window.siyuan.config.keymap[key1][key].default !== keymap[key].default) {
                /// #if !BROWSER
                ipcRenderer.send(Constants.SIYUAN_CMD, {
                    cmd: "writeLog",
                    msg: `window.siyuan.config.keymap.${key1}.${key} is not found or match: ${window.siyuan.config.keymap[key1][key]?.default}`
                });
                /// #endif
                match = false;
                window.siyuan.config.keymap[key1][key] = keymap[key];
            }
        } else {
            if (!window.siyuan.config.keymap[key1][key2][key] || window.siyuan.config.keymap[key1][key2][key].default !== keymap[key].default) {
                /// #if !BROWSER
                ipcRenderer.send(Constants.SIYUAN_CMD, {
                    cmd: "writeLog",
                    msg: `window.siyuan.config.keymap.${key1}.${key2}.${key} is not found or match: ${window.siyuan.config.keymap[key1][key2][key]?.default}`
                });
                /// #endif
                match = false;
                window.siyuan.config.keymap[key1][key2][key] = keymap[key];
            }
        }
    });
    return match;
};

const hasKeymap = (keymap: Record<string, IKeymapItem>, key1: "general" | "editor", key2?: "general" | "insert" | "heading" | "list" | "table") => {
    let match = true;
    if (key1 === "editor") {
        if (Object.keys(window.siyuan.config.keymap[key1][key2]).length !== Object.keys(Constants.SIYUAN_KEYMAP[key1][key2]).length) {
            Object.keys(window.siyuan.config.keymap[key1][key2]).forEach(item => {
                if (!Constants.SIYUAN_KEYMAP[key1][key2][item]) {
                    match = false;
                    delete window.siyuan.config.keymap[key1][key2][item];
                }
            });
        }
    } else {
        if (Object.keys(window.siyuan.config.keymap[key1]).length !== Object.keys(Constants.SIYUAN_KEYMAP[key1]).length) {
            Object.keys(window.siyuan.config.keymap[key1]).forEach(item => {
                if (!Constants.SIYUAN_KEYMAP[key1][item]) {
                    match = false;
                    delete window.siyuan.config.keymap[key1][item];
                }
            });
        }
    }
    return match;
};

export const correctHotkey = (app: App) => {
    const matchKeymap1 = matchKeymap(Constants.SIYUAN_KEYMAP.general, "general");
    const matchKeymap2 = matchKeymap(Constants.SIYUAN_KEYMAP.editor.general, "editor", "general");
    const matchKeymap3 = matchKeymap(Constants.SIYUAN_KEYMAP.editor.insert, "editor", "insert");
    const matchKeymap4 = matchKeymap(Constants.SIYUAN_KEYMAP.editor.heading, "editor", "heading");
    const matchKeymap5 = matchKeymap(Constants.SIYUAN_KEYMAP.editor.list, "editor", "list");
    const matchKeymap6 = matchKeymap(Constants.SIYUAN_KEYMAP.editor.table, "editor", "table");

    const hasKeymap1 = hasKeymap(Constants.SIYUAN_KEYMAP.general, "general");
    const hasKeymap2 = hasKeymap(Constants.SIYUAN_KEYMAP.editor.general, "editor", "general");
    const hasKeymap3 = hasKeymap(Constants.SIYUAN_KEYMAP.editor.insert, "editor", "insert");
    const hasKeymap4 = hasKeymap(Constants.SIYUAN_KEYMAP.editor.heading, "editor", "heading");
    const hasKeymap5 = hasKeymap(Constants.SIYUAN_KEYMAP.editor.list, "editor", "list");
    const hasKeymap6 = hasKeymap(Constants.SIYUAN_KEYMAP.editor.table, "editor", "table");
    if (!window.siyuan.config.readonly &&
        (!matchKeymap1 || !matchKeymap2 || !matchKeymap3 || !matchKeymap4 || !matchKeymap5 || !matchKeymap6 ||
            !hasKeymap1 || !hasKeymap2 || !hasKeymap3 || !hasKeymap4 || !hasKeymap5 || !hasKeymap6)) {
        /// #if !BROWSER
        ipcRenderer.send(Constants.SIYUAN_CMD, {
            cmd: "writeLog",
            msg: "update keymap"
        });
        /// #endif
        fetchPost("/api/setting/setKeymap", {
            data: window.siyuan.config.keymap
        }, () => {
            /// #if !BROWSER
            sendGlobalShortcut(app);
            /// #endif
        });
    }
};

export const filterHotkey = (event: KeyboardEvent, app: App) => {
    // https://github.com/siyuan-note/siyuan/issues/9848 忘记为什么要阻止了 .av__mask 的情况，测了下没问题就先移除
    if (document.getElementById("progress") || document.getElementById("errorLog") || event.isComposing) {
        return true;
    }
    const target = event.target as HTMLElement;
    // 点击最近的文档列表会 dispatch keydown 的 Enter https://github.com/siyuan-note/siyuan/issues/12967
    if (event.isTrusted && isNotCtrl(event) && !event.shiftKey && !event.altKey &&
        !["INPUT", "TEXTAREA"].includes(target.tagName) &&
        ["0", "1", "2", "3", "4", "j", "k", "l", ";", "s", " ", "p", "enter", "a", "s", "d", "f", "q", "x"].includes(event.key.toLowerCase())) {
        let cardElement: Element;
        window.siyuan.dialogs.find(item => {
            if (item.element.getAttribute("data-key") === Constants.DIALOG_OPENCARD) {
                cardElement = item.element;
                return true;
            }
        });
        if (!cardElement) {
            cardElement = document.querySelector(`.layout__wnd--active div[data-key="${Constants.DIALOG_OPENCARD}"]:not(.fn__none)`);
        }
        if (cardElement) {
            event.preventDefault();
            cardElement.firstElementChild.dispatchEvent(new CustomEvent("click", {detail: event.key.toLowerCase()}));
            return true;
        }
    }

    // 仅处理以下快捷键操作
    if (isNotCtrl(event) && event.key !== "Escape" && !event.shiftKey && !event.altKey &&
        Constants.KEYCODELIST[event.keyCode] !== "PageUp" &&
        Constants.KEYCODELIST[event.keyCode] !== "PageDown" &&
        event.key !== "Home" && event.key !== "End" &&
        !/^F\d{1,2}$/.test(event.key) && event.key.indexOf("Arrow") === -1 && event.key !== "Enter" && event.key !== "Backspace" && event.key !== "Delete") {
        return true;
    }

    if (!event.altKey && !event.shiftKey && isOnlyMeta(event)) {
        if ((isMac() ? event.key === "Meta" : event.key === "Control") || isOnlyMeta(event)) {
            window.siyuan.ctrlIsPressed = true;
            if ((event.key === "Meta" || event.key === "Control") &&
                window.siyuan.config.editor.floatWindowMode === 1 && !event.repeat) {
                showPopover(app);
            }
        } else {
            window.siyuan.ctrlIsPressed = false;
        }
    }

    if (!event.altKey && event.shiftKey && isNotCtrl(event)) {
        if (event.key === "Shift") {
            window.siyuan.shiftIsPressed = true;
            if (!event.repeat) {
                showPopover(app, true);
            }
        } else {
            window.siyuan.shiftIsPressed = false;
        }
    }

    if (event.altKey && !event.shiftKey && isNotCtrl(event)) {
        if (event.key === "Alt") {
            window.siyuan.altIsPressed = true;
        } else {
            window.siyuan.altIsPressed = false;
        }
    }
};
